import assert from "node:assert/strict";
import test from "node:test";

import { billedPrivateMinutes, checkUsageLimit, jobMinutes } from "../src/usage-monitor.js";

const time = Date.parse("2026-10-03T16:00:00Z");
const env = {
  GITHUB_BILLING_TOKEN: "test-token",
  GITHUB_OWNER: "mrson93",
  GITHUB_REPO: "bot-tl-01",
};

function summary(minutes) {
  return { usageItems: [{ product: "Actions", unitType: "minutes", grossQuantity: minutes }] };
}

function monitor({ repoGross = 236, otherUsage = [], runs = [], jobs = {} } = {}) {
  let privateRepo = true;
  let stored;
  const notices = [];
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push(`${options.method || "GET"} ${url.pathname}${url.search}`);
    let body;
    if (url.pathname.endsWith("/billing/usage/summary")) {
      body = summary(repoGross);
    } else if (url.pathname.endsWith("/billing/usage")) {
      body = { usageItems: otherUsage.map(({ name, minutes }) => ({
        product: "Actions", unitType: "minutes", repositoryName: name,
        quantity: minutes,
      })) };
    } else if (url.pathname.endsWith("/actions/runs")) {
      body = { workflow_runs: runs };
    } else if (url.pathname.endsWith("/jobs")) {
      body = { total_count: jobs[url.pathname.split("/").at(-2)]?.length || 0,
        jobs: jobs[url.pathname.split("/").at(-2)] || [] };
    } else if (url.pathname.endsWith("/repos/mrson93/bot-tl-01")) {
      if (options.method === "PATCH") privateRepo = false;
      body = { private: privateRepo };
    } else if (url.pathname.startsWith("/repos/mrson93/")) {
      const other = otherUsage.find(({ name }) => url.pathname === `/repos/${name}`);
      if (!other) throw new Error(`Unexpected URL ${url}`);
      if (other.private) return new Response("not found", { status: 404 });
      body = { private: false };
    } else {
      throw new Error(`Unexpected URL ${url}`);
    }
    return Response.json(body);
  };
  const invoke = () => checkUsageLimit({
    env, scheduledTime: time, fetchImpl,
    getVariables: async () => stored ? { ACTIONS_PRIVATE_USAGE_STATE: stored } : {},
    setVariable: async (_name, value) => { stored = value; },
    notify: async (message) => { notices.push(message); },
  });
  return { invoke, calls, notices, get stored() { return stored; }, get privateRepo() { return privateRepo; } };
}

test("desconta apenas os 236 minutos públicos anteriores em outubro", () => {
  assert.equal(billedPrivateMinutes(summary(250), "2026-10"), 14);
  assert.equal(billedPrivateMinutes(summary(250), "2026-11"), 250);
  assert.throws(() => billedPrivateMinutes({}, "2026-10"));
});

test("arredonda cada job e ignora jobs que não começaram", () => {
  assert.equal(jobMinutes([
    { started_at: "2026-10-03T12:00:00Z", completed_at: "2026-10-03T12:00:01Z" },
    { started_at: "2026-10-03T12:01:00Z", completed_at: "2026-10-03T12:02:01Z" },
    { conclusion: "cancelled", started_at: null, completed_at: null },
  ]), 3);
});

test("fica privado abaixo de 99% e ignora outros repositórios públicos", async () => {
  const subject = monitor({ repoGross: 250,
    otherUsage: [{ name: "mrson93/site", minutes: 1900, private: false }] });
  assert.equal(await subject.invoke(), false);
  assert.equal(subject.privateRepo, true);
  assert.equal(subject.notices.length, 0);
  assert.ok(subject.calls.some((call) => call.includes("repository=mrson93%2Fbot-tl-01")));
});

test("publica somente em 99%, confirma e notifica", async () => {
  const subject = monitor({ repoGross: 2216 });
  assert.equal(await subject.invoke(), true);
  assert.equal(subject.privateRepo, false);
  assert.equal(subject.notices.length, 1);
  assert.equal(await subject.invoke(), false);
  assert.equal(subject.notices.length, 1);
});

test("inclui o consumo de outros repositórios privados", async () => {
  const subject = monitor({ repoGross: 2200,
    otherUsage: [{ name: "mrson93/outro-privado", minutes: 16, private: true }] });
  assert.equal(await subject.invoke(), true);
});

test("contabiliza jobs concluídos sem somá-los duas vezes", async () => {
  const subject = monitor({ repoGross: 2190,
    runs: [{ id: 1, created_at: "2026-10-03T15:00:00Z", status: "completed" }],
    jobs: { 1: [{ started_at: "2026-10-03T15:00:00Z", completed_at: "2026-10-03T15:30:00Z" }] },
  });
  assert.equal(await subject.invoke(), false);
  assert.equal(JSON.parse(subject.stored).minutes, 30);
  assert.deepEqual(JSON.parse(subject.stored).accounted, [1]);
  assert.equal(await subject.invoke(), false);
  assert.equal(subject.calls.filter((call) => call.endsWith("/jobs?per_page=100")).length, 1);
});

test("soma ao relatório atrasado os jobs ainda não faturados", async () => {
  const subject = monitor({ repoGross: 2190,
    runs: [{ id: 2, created_at: "2026-10-03T15:45:00Z", status: "in_progress" }],
    jobs: { 2: [{ started_at: "2026-10-03T15:45:00Z", completed_at: null }] },
  });
  assert.equal(await subject.invoke(), false);
  assert.equal(subject.privateRepo, true);
  const nearLimit = monitor({ repoGross: 2200,
    runs: [{ id: 2, created_at: "2026-10-03T15:45:00Z", status: "in_progress" }],
    jobs: { 2: [{ started_at: "2026-10-03T15:45:00Z", completed_at: null }] },
  });
  assert.equal(await nearLimit.invoke(), false);
  const threshold = monitor({ repoGross: 2201,
    runs: [{ id: 2, created_at: "2026-10-03T15:45:00Z", status: "in_progress" }],
    jobs: { 2: [{ started_at: "2026-10-03T15:45:00Z", completed_at: null }] },
  });
  assert.equal(await threshold.invoke(), true);
});

test("não grava execução concluída enquanto o GitHub não informar o fim do job", async () => {
  const jobs = { 3: [{ started_at: "2026-10-03T15:45:00Z", completed_at: null }] };
  const subject = monitor({ runs: [
    { id: 3, created_at: "2026-10-03T15:44:00Z", status: "completed" },
  ], jobs });
  assert.equal(await subject.invoke(), false);
  assert.equal(subject.stored, undefined);
  jobs[3][0].completed_at = "2026-10-03T15:50:00Z";
  assert.equal(await subject.invoke(), false);
  assert.equal(JSON.parse(subject.stored).minutes, 5);
  assert.deepEqual(JSON.parse(subject.stored).accounted, [3]);
});

test("tolera início do job poucos segundos após o horário do agendamento", async () => {
  const subject = monitor({ runs: [
    { id: 4, created_at: "2026-10-03T15:59:59Z", status: "in_progress" },
  ], jobs: { 4: [{ started_at: "2026-10-03T16:00:01Z", completed_at: null }] } });
  assert.equal(await subject.invoke(), false);
  assert.equal(subject.stored, undefined);
});

test("falha explicitamente se o relatório não puder ser lido", async () => {
  const subject = monitor();
  const broken = () => checkUsageLimit({ env, scheduledTime: time,
    fetchImpl: async () => new Response("forbidden", { status: 403 }),
    getVariables: async () => ({}), setVariable: async () => {}, notify: async () => {} });
  await assert.rejects(broken, /github_usage_http_403/);
  assert.equal(subject.privateRepo, true);
});
