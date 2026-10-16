import type { IncomingMessage } from "node:http";
import { stripAttribution } from "./judge.ts";

export const MAX_PHRASE = 500;
export const MAX_BODY = 4_096; // bytes
const RATE_LIMIT = 20; // checks per client per minute; each live check reads ~19k tokens
const WINDOW_MS = 60_000;

type BodySource = AsyncIterable<Buffer> & { headers: IncomingMessage["headers"] };

/** Reads `{ "phrase": string }` and returns the phrase (cut to MAX_PHRASE), or the HTTP status to answer. */
export async function readPhrase(req: BodySource): Promise<string | 400 | 413> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return 413;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) return 413;
      chunks.push(chunk);
    }
  } catch {
    return 400; // the client closed the connection or the stream failed
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const phrase = typeof parsed === "object" && parsed !== null ? (parsed as { phrase?: unknown }).phrase : undefined;
    // A phrase that is only an attribution ("— Sun Tzu") has nothing left to judge.
    return typeof phrase === "string" && stripAttribution(phrase) ? phrase.slice(0, MAX_PHRASE) : 400;
  } catch {
    return 400;
  }
}

/** The client address. Behind a reverse proxy, set TRUST_PROXY=1 to use the hop the proxy added. */
export function clientIp(req: Pick<IncomingMessage, "headers" | "socket">, trustProxy = process.env.TRUST_PROXY === "1"): string {
  const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",").at(-1)?.trim() : "";
  return forwarded || req.socket.remoteAddress || "?";
}

export function createRateLimiter(limit = RATE_LIMIT, now = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    /** True when this client is over the limit; a refused call is not counted. */
    limited(ip: string): boolean {
      const t = now();
      const recent = (hits.get(ip) ?? []).filter((at) => t - at < WINDOW_MS);
      if (recent.length >= limit) return true;
      recent.push(t);
      hits.set(ip, recent);
      return false;
    },
    /** Forgets clients with no call inside the window. */
    sweep() {
      const t = now();
      for (const [ip, times] of hits) if (times.every((at) => t - at >= WINDOW_MS)) hits.delete(ip);
    },
    get size() {
      return hits.size;
    },
  };
}
