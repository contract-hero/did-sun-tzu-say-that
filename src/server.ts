import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { transformSync } from "esbuild";
import { clientIp, createRateLimiter, readPhrase } from "./http.ts";
import { CacheMissError, createDefaultJudge, ROOT } from "./jev.ts";
import { PhraseError } from "./judge.ts";

const PORT = Number(process.env.PORT ?? 8787);

if (!process.env.TYPESAFE_API_KEY) {
  console.warn("TYPESAFE_API_KEY is not set: only phrases recorded in data/jev-cache.json will work.");
}
const { judge } = createDefaultJudge();
const rate = createRateLimiter();
setInterval(() => rate.sweep(), 60_000).unref();

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

const json = (res: ServerResponse, status: number, body: object) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const BAD_REQUEST = { 400: "Type a phrase.", 413: "That is too long." } as const;

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");

  if (req.method === "POST" && url.pathname === "/api/judge") {
    if (rate.limited(clientIp(req))) return json(res, 429, { error: "Too many checks. Wait a minute." });
    const phrase = await readPhrase(req);
    if (typeof phrase === "number") return json(res, phrase, { error: BAD_REQUEST[phrase] });
    const started = Date.now();
    try {
      const result = await judge(phrase);
      const ms = Date.now() - started;
      console.log(`${result.verdict.padEnd(6)} ${result.passage.id.padEnd(7)} ${ms}ms ${result.inputTokens}tok ${JSON.stringify(phrase)}`);
      return json(res, 200, { ...result, ms });
    } catch (err) {
      console.error(`judge failed for ${JSON.stringify(phrase)}:`, err);
      if (err instanceof PhraseError) return json(res, 400, { error: err.message });
      if (err instanceof CacheMissError) {
        return json(res, 503, { error: "Live checks are off on this server. Try a famous quote instead." });
      }
      return json(res, 502, { error: "The scroll did not answer. Try again." });
    }
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "content-type": "text/plain" }).end("Method not allowed");
    return;
  }
  const file = files.get(url.pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(url.pathname) || ".html"] ?? "application/octet-stream" });
  res.end(file);
}

createServer((req, res) => {
  // One bad request must never stop the server.
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "Something broke. Try again." });
    else res.destroy();
  });
}).listen(PORT, () => console.log(`Did Sun Tzu Say That? (Jev edition) → http://localhost:${PORT}`));
