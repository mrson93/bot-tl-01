import assert from "node:assert/strict";
import test from "node:test";

import { githubFetch } from "../src/github-retry.js";

test("repete leituras após erro 504 com espera curta", async () => {
  let calls = 0;
  const delays = [];
  const response = await githubFetch(async () => {
    calls += 1;
    return new Response("", { status: calls < 3 ? 504 : 200 });
  }, "https://api.github.com/example", { method: "GET" },
  (resolve, delay) => { delays.push(delay); resolve(); });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);
});

test("não repete escritas nem erros permanentes", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("", { status: 504 });
  };
  assert.equal((await githubFetch(fetchImpl, "https://api.github.com/example",
    { method: "POST" })).status, 504);
  assert.equal(calls, 1);
  assert.equal((await githubFetch(async () => {
    calls += 1;
    return new Response("", { status: 403 });
  }, "https://api.github.com/example")).status, 403);
  assert.equal(calls, 2);
});

test("desiste após três respostas temporárias", async () => {
  let calls = 0;
  const response = await githubFetch(async () => {
    calls += 1;
    return new Response("", { status: 503 });
  }, "https://api.github.com/example", {}, (resolve) => resolve());
  assert.equal(response.status, 503);
  assert.equal(calls, 3);
});
