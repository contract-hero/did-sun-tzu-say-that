import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp, createRateLimiter, readPhrase } from "../src/http.ts";

const body = (text: string, headers: Record<string, string> = {}) =>
  Object.assign(
    (async function* () {
      yield Buffer.from(text);
    })(),
    { headers },
  );

test("readPhrase accepts a phrase and cuts it to 500 characters", async () => {
  assert.equal(await readPhrase(body('{"phrase":"All warfare is based on deception."}')), "All warfare is based on deception.");
  assert.equal(await readPhrase(body(JSON.stringify({ phrase: "a".repeat(600) }))), "a".repeat(500));
});

test("readPhrase answers 400 for a body that holds no phrase", async () => {
  for (const bad of ["not json", "null", '"x"', "[1]", '{"phrase":42}', '{"phrase":"   "}', '{"phrase":"— Sun Tzu"}']) {
    assert.equal(await readPhrase(body(bad)), 400, bad);
  }
});

test("readPhrase answers 413 for a large body, by header or by size", async () => {
  assert.equal(await readPhrase(body("{}", { "content-length": "5000" })), 413);
  assert.equal(await readPhrase(body(JSON.stringify({ phrase: "a".repeat(5000) }))), 413);
});

test("readPhrase answers 400 when the client closes the connection", async () => {
  const aborted = Object.assign(
    (async function* () {
      yield Buffer.from('{"phr');
      throw Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    })(),
    { headers: {} },
  );
  assert.equal(await readPhrase(aborted), 400);
});

test("readPhrase keeps a multi-byte character that is split across chunks", async () => {
  const bytes = Buffer.from('{"phrase":"孫子"}');
  const split = Object.assign(
    (async function* () {
      yield bytes.subarray(0, 12); // ends inside 孫
      yield bytes.subarray(12);
    })(),
    { headers: {} },
  );
  assert.equal(await readPhrase(split), "孫子");
});

test("the rate limit refuses call 21 in a minute, per client, and forgets idle clients", () => {
  let now = 0;
  const rate = createRateLimiter(20, () => now);
  for (let i = 0; i < 20; i++) assert.equal(rate.limited("a"), false);
  assert.equal(rate.limited("a"), true);
  assert.equal(rate.limited("b"), false);
  now = 60_000;
  assert.equal(rate.limited("a"), false);
  now = 200_000;
  rate.sweep();
  assert.equal(rate.size, 0);
});

test("clientIp uses X-Forwarded-For only when the proxy is trusted", () => {
  const req = { headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" }, socket: { remoteAddress: "10.0.0.1" } } as never;
  assert.equal(clientIp(req, false), "10.0.0.1");
  assert.equal(clientIp(req, true), "1.2.3.4");
});
