const PRIVATE_SINCE = Date.parse("2026-10-03T12:27:08Z");
const OCTOBER_PUBLIC_BASELINE = 236;
const FREE_MINUTES = 2000;
const PUBLIC_AT_MINUTES = Math.ceil(FREE_MINUTES * 0.99);
const STATE_VARIABLE = "ACTIONS_PRIVATE_USAGE_STATE";

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

function monthStart(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function githubUrl(owner, repo, suffix) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

async function githubJson(fetchImpl, url, token, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "deal-signal-usage-monitor",
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  if (!response.ok) throw new Error(`github_usage_http_${response.status}`);
  return response.status === 204 ? null : response.json();
}

export function billedPrivateMinutes(summary, period) {
  if (!Array.isArray(summary?.usageItems)) throw new Error("github_usage_invalid_summary");
  const gross = summary.usageItems
    .filter((item) => item.product === "Actions" && item.unitType === "minutes")
    .reduce((total, item) => total + Number(item.grossQuantity || 0), 0);
  if (!Number.isFinite(gross)) throw new Error("github_usage_invalid_quantity");
  const baseline = period === "2026-10" ? OCTOBER_PUBLIC_BASELINE : 0;
  return Math.max(0, Math.ceil(gross - baseline));
}

export function jobMinutes(jobs) {
  if (!Array.isArray(jobs)) throw new Error("github_usage_invalid_jobs");
  return jobs.reduce((total, job) => {
    if (job.conclusion === "skipped" || !job.started_at) return total;
    const start = Date.parse(job.started_at);
    const end = Date.parse(job.completed_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error("github_usage_invalid_job_time");
    }
    return total + Math.ceil((end - start) / 60000);
  }, 0);
}

async function otherPrivateMinutes(fetchImpl, owner, repo, token, now) {
  const url = `https://api.github.com/users/${encodeURIComponent(owner)}`
    + `/settings/billing/usage?year=${now.getUTCFullYear()}`
    + `&month=${now.getUTCMonth() + 1}`;
  const report = await githubJson(fetchImpl, url, token);
  if (!Array.isArray(report?.usageItems)) throw new Error("github_usage_invalid_account_report");
  const amounts = new Map();
  for (const item of report.usageItems) {
    if (item.product !== "Actions" || item.unitType !== "minutes") continue;
    const name = String(item.repositoryName || "");
    const quantity = Number(item.quantity);
    if (!name || !Number.isFinite(quantity) || quantity < 0) {
      throw new Error("github_usage_invalid_account_item");
    }
    if (name.toLowerCase() === `${owner}/${repo}`.toLowerCase()) continue;
    amounts.set(name, (amounts.get(name) || 0) + quantity);
  }
  let total = 0;
  for (const [name, minutes] of amounts) {
    const parts = name.split("/");
    if (parts.length !== 2 || parts[0].toLowerCase() !== owner.toLowerCase()) {
      throw new Error("github_usage_unexpected_repository");
    }
    let metadata;
    try {
      metadata = await githubJson(fetchImpl, githubUrl(parts[0], parts[1], ""), token);
    } catch (error) {
      // O token restrito a este bot recebe 404 para outros repositórios
      // privados. Contá-los é conservador; outras falhas impedem a medição.
      if (error.message !== "github_usage_http_404") throw error;
      total += minutes;
      continue;
    }
    if (metadata.private === true) total += minutes;
    else if (metadata.private !== false) throw new Error("github_usage_invalid_visibility");
  }
  return Math.ceil(total);
}

function parseState(raw, period) {
  try {
    const state = JSON.parse(raw || "null");
    if (state?.period === period && Number.isSafeInteger(state.minutes)
        && state.minutes >= 0 && Array.isArray(state.accounted)
        && state.accounted.every(Number.isSafeInteger)) {
      return state;
    }
  } catch {
    // Reconstitui o estado pelas execuções do mês.
  }
  return { period, minutes: 0, accounted: [] };
}

export async function checkUsageLimit({ env, scheduledTime, fetchImpl, getVariables, setVariable, notify }) {
  const now = new Date(scheduledTime);
  if (!Number.isFinite(now.getTime())) throw new Error("github_usage_invalid_time");

  const token = String(env.GITHUB_BILLING_TOKEN || "").trim();
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  if (!token || !owner || !repo) throw new Error("github_usage_not_configured");
  const repoUrl = githubUrl(owner, repo, "");
  const metadata = await githubJson(fetchImpl, repoUrl, token);
  if (metadata.private === false) return false;
  if (metadata.private !== true) throw new Error("github_usage_invalid_visibility");

  const period = monthKey(now);
  const start = Math.max(monthStart(now), PRIVATE_SINCE);
  const summaryUrl = `https://api.github.com/users/${encodeURIComponent(owner)}`
    + `/settings/billing/usage/summary?year=${now.getUTCFullYear()}`
    + `&month=${now.getUTCMonth() + 1}&repository=${encodeURIComponent(`${owner}/${repo}`)}`;
  const summary = await githubJson(fetchImpl, summaryUrl, token);
  const billed = billedPrivateMinutes(summary, period);
  const otherPrivate = await otherPrivateMinutes(fetchImpl, owner, repo, token, now);

  const variables = await getVariables();
  const state = parseState(variables[STATE_VARIABLE], period);
  const accounted = new Set(state.accounted);
  let changed = false;
  let runningMinutes = 0;
  let exhausted = true;
  for (let page = 1; page <= 50; page += 1) {
    const data = await githubJson(fetchImpl,
      githubUrl(owner, repo, `/actions/runs?per_page=100&page=${page}`), token);
    if (!Array.isArray(data.workflow_runs)) throw new Error("github_usage_invalid_runs");
    for (const run of data.workflow_runs) {
      const created = Date.parse(run.created_at);
      if (!Number.isFinite(created)) throw new Error("github_usage_invalid_run_time");
      if (created < start) { exhausted = false; break; }
      if (accounted.has(run.id)) continue;
      const jobs = await githubJson(fetchImpl,
        githubUrl(owner, repo, `/actions/runs/${run.id}/jobs?per_page=100`), token);
      if (!Array.isArray(jobs.jobs) || jobs.total_count > 100) {
        throw new Error("github_usage_invalid_jobs_page");
      }
      if (run.status === "completed") {
        state.minutes += jobMinutes(jobs.jobs);
        accounted.add(run.id);
        changed = true;
      } else {
        runningMinutes += jobs.jobs.reduce((total, job) => {
          if (!job.started_at || job.completed_at) return total;
          const elapsed = now.getTime() - Date.parse(job.started_at);
          if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("github_usage_invalid_job_time");
          return total + Math.ceil(elapsed / 60000);
        }, 0);
      }
    }
    if (!exhausted || data.workflow_runs.length < 100) { exhausted = false; break; }
  }
  if (exhausted) throw new Error("github_usage_runs_pagination_limit");
  if (changed) {
    state.accounted = [...accounted];
    await setVariable(STATE_VARIABLE, JSON.stringify(state));
  }

  // O relatório do repositório pode estar atrasado em relação aos jobs deste bot.
  // Soma somente a parte dos jobs concluídos que ainda falta no relatório do
  // repositório, mais os jobs em andamento (ainda não consolidados).
  const minutes = billed + Math.max(0, state.minutes - billed) + runningMinutes + otherPrivate;
  if (minutes < PUBLIC_AT_MINUTES) return false;
  await githubJson(fetchImpl, repoUrl, token, {
    method: "PATCH", body: JSON.stringify({ visibility: "public" }),
  });
  const confirmed = await githubJson(fetchImpl, repoUrl, token);
  if (confirmed.private !== false) throw new Error("github_usage_visibility_unconfirmed");
  await notify(`⚠️ GitHub Actions chegou a ${minutes}/${FREE_MINUTES} minutos estimados `
    + `(${(minutes / FREE_MINUTES * 100).toFixed(1)}%). O repositório ${owner}/${repo} `
    + "foi alterado para público automaticamente.");
  return true;
}
