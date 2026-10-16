import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { transformSync } from "esbuild";
import { cachedJev, liveJev } from "./jev.ts";
import { createJudge, type Passage } from "./judge.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8787);
const MAX_PHRASE = 500;

if (!process.env.TYPESAFE_API_KEY) {
  console.warn("TYPESAFE_API_KEY is not set: only phrases recorded in data/jev-cache.json will work.");
}
const passages: Passage[] = JSON.parse(readFileSync(join(ROOT, "data/passages.json"), "utf8"));
// Every answer is recorded, so a repeated phrase (the famous ones) costs nothing.
const judge = createJudge(
  passages,
  cachedJev(join(ROOT, "data/jev-cache.json"), process.env.TYPESAFE_API_KEY ? liveJev() : undefined),
);

// The browser code is TypeScript too; esbuild strips the types on request.
const clientJs = () =>
  transformSync(readFileSync(join(ROOT, "src/client/app.ts"), "utf8"), { loader: "ts", format: "esm" }).code;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
};

// A small per-IP limit, because each check spends ~15k input tokens.
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { "content-type": type });
    res.end(body);
  };

  if (req.method === "POST" && url.pathname === "/api/judge") {
    if (limited(req.socket.remoteAddress ?? "?")) return send(429, "application/json",'{"error":"Too many checks. Wait a minute."}');
    let body = "";
    for await (const chunk of req) body += chunk;
    const phrase = String(JSON.parse(body || "{}").phrase ?? "").slice(0, MAX_PHRASE);
    if (!phrase.trim()) return send(400, "application/json", '{"error":"Type a phrase."}');
    const started = Date.now();
    try {
      const result = await judge(phrase);
      console.log(`${result.verdict.padEnd(6)} ${result.passage.id.padEnd(7)} ${Date.now() - started}ms ${result.inputTokens}tok  ${phrase}`);
      return send(200, "application/json", JSON.stringify({ ...result, ms: Date.now() - started }));
    } catch (err) {
      console.error(err);
      return send(502, "application/json", JSON.stringify({ error: "The scroll did not answer. Try again." }));
    }
  }

  if (req.method !== "GET") return send(405, "text/plain", "Method not allowed");
  if (url.pathname === "/app.js") return send(200, TYPES[".js"], clientJs());
  const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  if (path.includes("..")) return send(400, "text/plain", "Bad path");
  try {
    return send(200, TYPES[extname(path)] ?? "application/octet-stream", readFileSync(join(ROOT, "public", path)));
  } catch {
    return send(404, "text/plain", "Not found");
  }
}).listen(PORT, () => console.log(`Did Sun Tzu Say That? (Jev edition) → http://localhost:${PORT}`));
