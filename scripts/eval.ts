// Runs the labelled cases through Jev and prints accuracy.
//   pnpm eval              uses data/jev-cache.json, records misses when TYPESAFE_API_KEY is set
//   pnpm eval --reversed   also asks the verdict with the options in reverse order (option-order check)
import { readFileSync } from "node:fs";
import { cachedJev, liveJev, MODEL } from "../src/jev.ts";
import { createJudge, type Passage, stripAttribution, tagPassages, verdictQuestion } from "../src/judge.ts";
import { CASES } from "../test/cases.ts";

const passages: Passage[] = JSON.parse(readFileSync("data/passages.json", "utf8"));
const ask = cachedJev("data/jev-cache.json", process.env.TYPESAFE_API_KEY ? liveJev() : undefined);
const judge = createJudge(passages, ask);
const reversed = process.argv.includes("--reversed");

let verdictOk = 0;
let passageOk = 0;
let passageTotal = 0;
let flips = 0;
let tokens = 0;
const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3);

const results = await Promise.all(
  CASES.map(async (c) => {
    const r = await judge(c.phrase);
    const flip = reversed
      ? (await ask({ state: tagPassages(passages), questions: { verdict: verdictQuestion(stripAttribution(c.phrase), true) } }))
          .answers.verdict.choice
      : undefined;
    return { c, r, flip };
  }),
);

for (const { c, r, flip } of results) {
  const okV = r.verdict === c.verdict;
  const okP = c.passage ? r.passage.id === c.passage : undefined;
  verdictOk += okV ? 1 : 0;
  if (okP !== undefined) {
    passageTotal++;
    passageOk += okP ? 1 : 0;
  }
  if (flip && flip !== r.verdict) flips++;
  tokens += r.inputTokens;
  const p = r.verdictProbabilities;
  console.log(
    `${okV ? "✓" : "✗"} ${c.verdict.padEnd(5)}→${r.verdict.padEnd(5)} [s${pct(p.said)} c${pct(p.close)} n${pct(p.never)}]` +
      ` ${okP === undefined ? " " : okP ? "✓" : "✗"} ${r.passage.id.padEnd(7)}${flip && flip !== r.verdict ? ` FLIP→${flip}` : ""}  ${c.phrase.slice(0, 70)}`,
  );
}
console.log(
  `\nmodel ${results[0].r.model} (asked as ${MODEL}) · verdict ${verdictOk}/${CASES.length} · passage ${passageOk}/${passageTotal}` +
    `${reversed ? ` · flips when options reversed ${flips}/${CASES.length}` : ""} · avg ${Math.round(tokens / CASES.length)} input tokens/check`,
);
