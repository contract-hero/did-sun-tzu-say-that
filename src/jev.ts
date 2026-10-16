import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Questions, type SystemOneRequest, type SystemOneResult, TypeSafeClient } from "@typesafe-ai/sdk";
import { type AskJev, cleanPassages, createJudge, type Passage } from "./judge.ts";

export const MODEL = process.env.JEV_MODEL ?? "jev-1.14.0";
export const ROOT = join(import.meta.dirname, "..");
const CACHE_FILE = join(ROOT, "data/jev-cache.json");
const MAX_LIVE_ENTRIES = 2_000; // answers learned while serving; bounded, never written to disk

export function loadPassages(): Passage[] {
  return cleanPassages(JSON.parse(readFileSync(join(ROOT, "data/passages.json"), "utf8")));
}

/**
 * The recorded answers in data/jev-cache.json, keyed by the exact request, in front of a live
 * client when TYPESAFE_API_KEY is set (the key is read by the SDK and never leaves the server).
 * A miss without a key is an error, so tests never spend tokens by accident.
 * `record` (pnpm eval) adds new answers to the file on `save()`; otherwise they stay in a bounded
 * in-memory map, so a public server cannot grow the file.
 */
export function createJev({ record = false } = {}) {
  const recorded: Record<string, unknown> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  const learned = new Map<string, unknown>();
  const client = process.env.TYPESAFE_API_KEY ? new TypeSafeClient({ defaultModel: MODEL, timeout: 30_000 }) : null;
  let dirty = false;

  async function ask<Q extends Questions>(request: SystemOneRequest<Q>): Promise<SystemOneResult<Q> & { cached: boolean }> {
    const key = createHash("sha256").update(JSON.stringify({ model: MODEL, ...request })).digest("hex");
    const hit = recorded[key] ?? learned.get(key);
    // The cache holds what the SDK returned for this same request, so the stored shape matches.
    if (hit) return { ...(hit as SystemOneResult<Q>), cached: true };
    if (!client) throw new Error(`No recorded Jev answer for this request (${CACHE_FILE}). Set TYPESAFE_API_KEY to call Jev.`);
    const { model, answers, usage } = await client.systemOne(request);
    const result = { model, answers, usage };
    if (record) {
      recorded[key] = result;
      dirty = true;
    } else {
      if (learned.size >= MAX_LIVE_ENTRIES) learned.delete(learned.keys().next().value!);
      learned.set(key, result);
    }
    return { ...result, cached: false };
  }

  const save = () => {
    if (dirty) writeFileSync(CACHE_FILE, `${JSON.stringify(recorded, null, 1)}\n`);
    dirty = false;
  };

  return { ask: ask satisfies AskJev, save };
}

export function createDefaultJudge(options?: { record?: boolean }) {
  const jev = createJev(options);
  return { judge: createJudge(loadPassages(), jev.ask), ask: jev.ask, save: jev.save };
}
