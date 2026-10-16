// Runs the labelled cases through Jev and prints accuracy.
//   pnpm eval              uses data/jev-cache.json, records misses when TYPESAFE_API_KEY is set
//   pnpm eval --reversed   also asks the verdict with the options in reverse order (option-order check)
import { createDefaultJudge, loadPassages, MODEL } from "../src/jev.ts";
import { tagPassages, verdictQuestion } from "../src/judge.ts";
import { CASES } from "../test/cases.ts";

const { judge, ask, save } = createDefaultJudge({ record: true });
const reversed = process.argv.includes("--reversed");
const book = tagPassages(loadPassages());

// Same question, options in the opposite order. Jev can lean toward the first option on borderline phrases.
async function reversedVerdict(phrase: string) {
  const question = verdictQuestion(phrase);
  const criteria = Object.fromEntries(Object.entries(question.criteria).reverse());
  return (await ask({ state: book, questions: { verdict: { ...question, criteria } } })).answers.verdict.choice;
}

const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3);
// allSettled + finally: one failed live call must not lose the answers the run already paid for.
const settled = await Promise.allSettled(
  CASES.map(async (c) => {
    const r = await judge(c.phrase);
    return { c, r, flip: reversed ? await reversedVerdict(r.phrase) : undefined };
  }),
).finally(save);
const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
settled.forEach((s, i) => {
  if (s.status === "rejected") console.error(`✗ ERROR ${CASES[i].phrase.slice(0, 70)}:`, s.reason);
});
if (results.length < CASES.length) process.exitCode = 1;
if (results.length === 0) process.exit();

let verdictOk = 0;
let passageOk = 0;
let passageTotal = 0;
let flips = 0;
let tokens = 0;
for (const { c, r, flip } of results) {
  const okV = r.verdict === c.verdict;
  const okP = c.passage ? r.passage.id === c.passage : undefined;
  verdictOk += okV ? 1 : 0;
  if (okP !== undefined) {
    passageTotal++;
    passageOk += okP ? 1 : 0;
  }
  const flipped = flip !== undefined && flip !== r.verdict;
  if (flipped) flips++;
  tokens += r.inputTokens;
  const p = r.verdictProbabilities;
  console.log(
    `${okV ? "✓" : "✗"} ${c.verdict.padEnd(5)}→${r.verdict.padEnd(5)} [s${pct(p.said)} c${pct(p.close)} n${pct(p.never)}]` +
      ` ${okP === undefined ? " " : okP ? "✓" : "✗"} ${r.passage.id.padEnd(7)}${flipped ? ` FLIP→${flip}` : ""}  ${c.phrase.slice(0, 70)}`,
  );
}
console.log(
  `\nmodel ${results[0].r.model} (asked as ${MODEL}) · verdict ${verdictOk}/${results.length} · passage ${passageOk}/${passageTotal}` +
    `${reversed ? ` · flips when options reversed ${flips}/${results.length}` : ""} · avg ${Math.round(tokens / results.length)} input tokens/check`,
);
