import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { AskJev, JevResult } from "./judge.ts";

export const MODEL = process.env.JEV_MODEL ?? "jev-1.14.0";

/** Live caller. The key is read from TYPESAFE_API_KEY and never leaves the server. */
export function liveJev(): AskJev {
  const client = new TypeSafeClient({ defaultModel: MODEL, timeout: 30_000 });
  return async (request) => (await client.systemOne(request)) as unknown as JevResult;
}

/**
 * Record/replay cache keyed by the exact request. With `live` it records misses;
 * without it, a miss is an error, so tests never spend tokens by accident.
 */
export function cachedJev(file: string, live?: AskJev): AskJev {
  const cache: Record<string, JevResult> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return async (request) => {
    const key = createHash("sha256").update(JSON.stringify({ model: MODEL, ...request })).digest("hex");
    if (cache[key]) return cache[key];
    if (!live) throw new Error(`No recorded Jev answer for this request (${file}). Run with TYPESAFE_API_KEY to record.`);
    const result = await live(request);
    cache[key] = { model: result.model, answers: result.answers, usage: { input_tokens: result.usage.input_tokens } };
    writeFileSync(file, `${JSON.stringify(cache, null, 1)}\n`);
    return cache[key];
  };
}
