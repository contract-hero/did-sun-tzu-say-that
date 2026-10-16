# jev-sun-tzu

"Did Sun Tzu Say That?" with TypeSafe Jev as the judge (copy of guilherme01macedo/maybe-sun-tzu).

## Stack
- TypeScript everywhere, pnpm, Node ≥ 22. No framework: `node:http` server run by `tsx`.
- Browser code is `src/client/app.ts`; the server strips its types with esbuild once, at startup.
- `@typesafe-ai/sdk`, model pinned to `jev-1.14.0` (override with `JEV_MODEL`).
- `TYPESAFE_API_KEY` stays server-side. Never send it to the browser.
- README.md documents how Jev is used; keep it in sync with `src/judge.ts`.
- Jev answers are recorded in `data/jev-cache.json`; `pnpm test` never calls the API.
