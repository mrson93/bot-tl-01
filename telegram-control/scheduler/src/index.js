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

export async function forwardScheduledEvent(controller, env) {
  const secret = String(env.SCHEDULER_SHARED_SECRET || "");
  if (!secret) throw new Error("scheduler_secret_not_configured");
  if (!env.CONTROLLER?.fetch) throw new Error("controller_binding_not_configured");

  const scheduledTime = Number(controller?.scheduledTime || Date.now());
  const response = await env.CONTROLLER.fetch(new Request("https://controller.internal/internal/scheduled", {
    method: "POST",
    headers: {
      "X-Internal-Scheduler-Secret": secret,
      "X-Scheduled-Time": String(scheduledTime),
    },
  }));
  if (!response.ok) throw new Error(`controller_${response.status}`);
  console.log(JSON.stringify({ event: "schedule_forwarded", scheduledTime }));
}

export default {
  fetch() {
    return textResponse("not found", 404);
  },
  async scheduled(controller, env) {
    try {
      await forwardScheduledEvent(controller, env);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "schedule_forward_error";
      console.error(JSON.stringify({ event: "schedule_forward_failed", reason }));
      throw error;
    }
  },
};
