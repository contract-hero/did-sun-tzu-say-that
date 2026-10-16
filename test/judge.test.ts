import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPassages } from "../src/jev.ts";
import { type AskJev, createJudge, pickChapters, stripAttribution, tagPassages } from "../src/judge.ts";

const passages = loadPassages();

test("Giles italics are removed when the data loads", () => {
  assert.ok(passages.every((p) => !p.text.includes("_")));
});

test("the whole book fits in one Jev question (32k tokens)", () => {
  const book = tagPassages(passages);
  assert.equal(book.split("\n").filter((l) => /^[IVX]+\.\d/.test(l)).length, 383);
  assert.ok(book.length / 4 < 24_000, `about ${Math.round(book.length / 4)} tokens`);
});

test("attributions are removed", () => {
  assert.equal(stripAttribution("“All warfare is based on deception.” — Sun Tzu, The Art of War"), "All warfare is based on deception.");
  assert.equal(stripAttribution("As Sun Tzu once said, hello"), "hello");
  assert.equal(stripAttribution("hello, said Sun Tzu."), "hello");
  assert.equal(stripAttribution("Sun Tzu's army"), "Sun Tzu's army");
});

test("chapters are picked until 90% of the probability, at most 3", () => {
  assert.deepEqual(pickChapters({ I: 0.95, II: 0.05 }), ["I"]);
  assert.deepEqual(pickChapters({ I: 0.5, II: 0.3, III: 0.15, IV: 0.05 }), ["I", "II", "III"]);
  assert.deepEqual(pickChapters({ I: 0.3, II: 0.3, III: 0.2, IV: 0.2 }), ["I", "II", "III"]);
});

test("the judge asks for the verdict on the whole book, then the verse inside the picked chapter", async () => {
  const seen: { state: unknown; questions: Record<string, { criteria: object }> }[] = [];
  const choice = (choice: string, probabilities: Record<string, number>) => ({ type: "choice", choice, confidence: 0.9, probabilities });
  // A fake Jev: the first call answers the verdict and chapter, the second the verse.
  const fake = (async (req: (typeof seen)[number]) => {
    seen.push(req);
    return seen.length === 1
      ? { model: "jev-test", usage: { input_tokens: 15000 }, answers: { verdict: choice("said", { said: 0.9, close: 0.08, never: 0.02 }), chapter: choice("I", { I: 0.97 }) } }
      : { model: "jev-test", usage: { input_tokens: 900 }, answers: { verse: choice("I.18", { "I.18": 0.93 }) } };
  }) as unknown as AskJev;
  const r = await createJudge(passages, fake)("All warfare is based on deception. — Sun Tzu");
  assert.equal(r.phrase, "All warfare is based on deception.");
  assert.equal(r.verdict, "said");
  assert.equal(r.passage.id, "I.18");
  assert.equal(r.inputTokens, 15900);
  assert.equal(seen[0].state, tagPassages(passages));
  assert.equal(r.cached, false);
  assert.equal(Object.keys(seen[1].questions.verse.criteria).length, 25); // chapter I has 25 verses
});
