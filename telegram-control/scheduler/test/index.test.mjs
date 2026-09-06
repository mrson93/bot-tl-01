import assert from "node:assert/strict";
import test from "node:test";

import worker, { forwardScheduledEvent } from "../src/index.js";

test("nao expoe rota publica", async () => {
  const response = await worker.fetch(new Request("https://scheduler.example/"), {});
  assert.equal(response.status, 404);
});

test("encaminha o horario pelo binding interno protegido", async () => {
  let forwardedRequest;
  const env = {
    SCHEDULER_SHARED_SECRET: "segredo-compartilhado",
    CONTROLLER: {
      async fetch(request) {
        forwardedRequest = request;
        return new Response("ok");
      },
    },
  };
  const scheduledTime = Date.parse("2026-09-06T14:00:00Z");
  await forwardScheduledEvent({ scheduledTime }, env);
  assert.equal(new URL(forwardedRequest.url).pathname, "/internal/scheduled");
  assert.equal(forwardedRequest.method, "POST");
  assert.equal(forwardedRequest.headers.get("X-Internal-Scheduler-Secret"), "segredo-compartilhado");
  assert.equal(forwardedRequest.headers.get("X-Scheduled-Time"), String(scheduledTime));
});

test("falha de forma explicita sem segredo ou binding", async () => {
  await assert.rejects(() => forwardScheduledEvent({}, {}), /scheduler_secret_not_configured/);
  await assert.rejects(
    () => forwardScheduledEvent({}, { SCHEDULER_SHARED_SECRET: "segredo" }),
    /controller_binding_not_configured/,
  );
});
