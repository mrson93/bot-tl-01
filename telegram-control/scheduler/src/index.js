function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function forward(controller, env, path) {
  const secret = String(env.SCHEDULER_SHARED_SECRET || "");
  if (!secret) throw new Error("scheduler_secret_not_configured");
  if (!env.CONTROLLER?.fetch) throw new Error("controller_binding_not_configured");

  const scheduledTime = Number(controller?.scheduledTime || Date.now());
  const response = await env.CONTROLLER.fetch(new Request(`https://controller.internal${path}`, {
    method: "POST",
    headers: {
      "X-Internal-Scheduler-Secret": secret,
      "X-Scheduled-Time": String(scheduledTime),
    },
  }));
  if (!response.ok) throw new Error(`controller_${response.status}`);
  console.log(JSON.stringify({ event: "schedule_forwarded", path, scheduledTime }));
}

export function forwardScheduledEvent(controller, env) {
  return forward(controller, env, "/internal/scheduled");
}

export function forwardUsageMonitor(controller, env) {
  return forward(controller, env, "/internal/usage-monitor");
}

export default {
  fetch() {
    return textResponse("not found", 404);
  },
  async scheduled(controller, env) {
    try {
      // A chamada separada protege as publicações contra falhas do monitor.
      // A verificação por minuto recupera mais rápido o histórico ainda não
      // contabilizado, sem alterar o intervalo das ofertas.
      const resultados = await Promise.allSettled([
        forwardScheduledEvent(controller, env),
        forwardUsageMonitor(controller, env),
      ]);
      const falha = resultados.find((resultado) => resultado.status === "rejected");
      if (falha) throw falha.reason;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "schedule_forward_error";
      console.error(JSON.stringify({ event: "schedule_forward_failed", reason }));
      throw error;
    }
  },
};
