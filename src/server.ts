import { readdirSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { transformSync } from "esbuild";
import { createDefaultJudge, ROOT } from "./jev.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PHRASE = 500;
const MAX_BODY = 4_096;
const RATE_LIMIT = 20; // checks per IP per minute; each live check reads ~19k tokens

if (!process.env.TYPESAFE_API_KEY) {
  console.warn("TYPESAFE_API_KEY is not set: only phrases recorded in data/jev-cache.json will work.");
}
const { judge } = createDefaultJudge();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
};

// Everything static is small, so it is read once at startup. The browser code is TypeScript
// too; esbuild strips the types here, once.
const files = new Map<string, Buffer | string>();
for (const name of readdirSync(join(ROOT, "public"), { recursive: true, encoding: "utf8" })) {
  if (extname(name)) files.set(`/${name}`, readFileSync(join(ROOT, "public", name)));
}
files.set("/", files.get("/index.html")!);
files.set(
  "/app.js",
  transformSync(readFileSync(join(ROOT, "src/client/app.ts"), "utf8"), { loader: "ts", format: "esm" }).code,
);

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) if (times.every((t) => now - t >= 60_000)) hits.delete(ip);
}, 60_000).unref();

const json = (res: ServerResponse, status: number, body: object) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** Reads `{ "phrase": string }`, or returns an HTTP status for a bad request. */
async function readPhrase(req: AsyncIterable<Buffer> & { headers: Record<string, unknown> }): Promise<string | number> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return 413;
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) return 413;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    const phrase = typeof parsed === "object" && parsed !== null ? (parsed as { phrase?: unknown }).phrase : undefined;
    return typeof phrase === "string" && phrase.trim() ? phrase.slice(0, MAX_PHRASE) : 400;
  } catch {
    return 400;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");

  if (req.method === "POST" && url.pathname === "/api/judge") {
    if (limited(req.socket.remoteAddress ?? "?")) return json(res, 429, { error: "Too many checks. Wait a minute." });
    const phrase = await readPhrase(req);
    if (phrase === 413) return json(res, 413, { error: "That is too long." });
    if (typeof phrase === "number") return json(res, 400, { error: "Type a phrase." });
    const started = Date.now();
    try {
      const result = await judge(phrase);
      const ms = Date.now() - started;
      console.log(`${result.verdict.padEnd(6)} ${result.passage.id.padEnd(7)} ${ms}ms ${result.inputTokens}tok ${JSON.stringify(phrase)}`);
      return json(res, 200, { ...result, ms });
    } catch (err) {
      console.error(err);
      return json(res, 502, { error: "The scroll did not answer. Try again." });
    }
  }

  if (req.method !== "GET") {
    res.writeHead(405).end("Method not allowed");
    return;
  }
  const file = files.get(url.pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(url.pathname) || ".html"] ?? "application/octet-stream" });
  res.end(file);
}).listen(PORT, () => console.log(`Did Sun Tzu Say That? (Jev edition) → http://localhost:${PORT}`));
