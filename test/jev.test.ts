import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CacheMissError, createDefaultJudge, createJev } from "../src/jev.ts";
import { CASES } from "./cases.ts";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "jev-")), "cache.json");
const request = (state: string) => ({ state, questions: { q: { type: "noul" as const, instructions: "?" } } });
const fakeClient = () => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    systemOne: (async () => {
      calls++;
      return { model: "jev-test", answers: { q: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 1, output_tokens: 0 } };
    }) as never,
  };
};

test("a cache miss without a client throws CacheMissError and writes nothing", async () => {
  const file = tempFile();
  const jev = createJev({ cacheFile: file, client: null });
  await assert.rejects(jev.ask(request("s")), CacheMissError);
  jev.save();
  assert.equal(existsSync(file), false);
});

test("record mode stores an answer once and save() writes it", async () => {
  const file = tempFile();
  const client = fakeClient();
  const jev = createJev({ cacheFile: file, client, record: true });
  assert.equal((await jev.ask(request("s"))).cached, false);
  assert.equal((await jev.ask(request("s"))).cached, true);
  assert.equal(client.calls, 1);
  jev.save();
  assert.equal(Object.keys(JSON.parse(readFileSync(file, "utf8"))).length, 1);
});

test("serving mode keeps answers in memory, bounded, and never writes the file", async () => {
  const file = tempFile();
  const client = fakeClient();
  const jev = createJev({ cacheFile: file, client, maxLive: 2 });
  for (const s of ["a", "b", "c"]) await jev.ask(request(s));
  assert.equal((await jev.ask(request("c"))).cached, true);
  assert.equal((await jev.ask(request("a"))).cached, false); // the oldest answer was dropped
  jev.save();
  assert.equal(existsSync(file), false);
});

test("every labelled case has a recorded answer for the current questions", { skip: Boolean(process.env.TYPESAFE_API_KEY) }, async () => {
  // A prompt edit changes every cache key; without this test the app would silently lose its replays.
  const { judge } = createDefaultJudge();
  for (const c of CASES) assert.equal((await judge(c.phrase)).cached, true, c.phrase);
});
