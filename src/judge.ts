import type { ChoiceQuestion, Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";

export interface Passage {
  id: string; // "III.18"
  chapter: number;
  chapterRoman: string;
  chapterTitle: string;
  verse: string;
  text: string;
}

export type Verdict = "said" | "close" | "never";

/** The SDK call, plus whether the answer came from the recorded cache. Tests pass a fake. */
export type AskJev = <Q extends Questions>(
  request: SystemOneRequest<Q>,
) => Promise<SystemOneResult<Q> & { cached: boolean }>;

export interface Judgement {
  phrase: string;
  verdict: Verdict;
  verdictProbabilities: Record<Verdict, number>;
  passage: Passage;
  model: string;
  inputTokens: number;
  cached: boolean;
}

// Criteria are written literally (Jev reads them at face value) and each one stands on its own.
const VERDICT_CRITERIA: Record<Verdict, string> = {
  said:
    "A verse of the book contains this phrase word for word. Small differences still count as word for word: " +
    "spelling, punctuation, capital letters, articles such as 'the' or 'a', singular or plural, or a few words left out.",
  close:
    "No verse contains these words, but a verse states the same idea in different words. " +
    "Examples: a paraphrase, a shortened version, modern wording, or the words in a different order.",
  never:
    "No verse of the book states this idea. The phrase comes from somewhere else or is invented, " +
    "even when its topic is war, strategy, or enemies.",
};

const VERDICT_QUESTION =
  "The book in `state` is The Art of War by Sun Tzu (translated by Lionel Giles). " +
  "Does Sun Tzu say `phrase` in this book?";

export function verdictQuestion(phrase: string): ChoiceQuestion<Record<Verdict, string>> {
  return { type: "choice", instructions: { phrase, question: VERDICT_QUESTION }, criteria: VERDICT_CRITERIA };
}

/** The phrase has nothing left to judge (for example, it was only an attribution). */
export class PhraseError extends Error {}

// Name forms people paste. A lookahead in place of \b, because \b treats "ŭ" as a non-word character.
const SUN_TZU = String.raw`(?:sun\s*tz[uŭ]|sunzi|sun\s*wu)(?![\p{L}\p{N}])`;
const ATTRIBUTION_AFTER = new RegExp(String.raw`\s*[-–—~―]+\s*${SUN_TZU}.*$`, "isu");
const ATTRIBUTION_BEFORE = new RegExp(String.raw`^\s*(?:as\s+)?${SUN_TZU}(?:\s+(?:once|famously))?\s+(?:said|says|wrote)\s*[:,]?\s*`, "iu");
const ATTRIBUTION_SAID = new RegExp(String.raw`,?\s*(?:said|says|wrote)\s+${SUN_TZU}\.?\s*$`, "iu");

/** Removes attributions people paste with a quote, e.g. '"…" — Sun Tzu, The Art of War'. */
export function stripAttribution(text: string): string {
  return text
    .replace(ATTRIBUTION_AFTER, "")
    .replace(ATTRIBUTION_BEFORE, "")
    .replace(ATTRIBUTION_SAID, "")
    .replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, "")
    .trim();
}

/** Giles marks italics with underscores; they carry no meaning, so they go when the data loads. */
export function cleanPassages(passages: Passage[]): Passage[] {
  return passages.map((p) => ({ ...p, text: p.text.replace(/_/g, "") }));
}

/** One line per verse, tagged with its id so a Choice can point at it. */
export function tagPassages(passages: Passage[]): string {
  const lines: string[] = [];
  let chapter = "";
  for (const p of passages) {
    if (p.chapterRoman !== chapter) {
      chapter = p.chapterRoman;
      lines.push(`Chapter ${p.chapterRoman}. ${p.chapterTitle}`);
    }
    lines.push(`${p.id}| ${p.text}`);
  }
  return lines.join("\n");
}

// Choice caps at 255 options and the book has 383 verses, so the verse is found in two passes:
// first the chapter (in the same request as the verdict), then the verse inside the picked chapters.
const MAX_CHAPTERS = 3; // the largest three chapters together stay far below 255 verses
const CHAPTER_MASS = 0.9;

export function pickChapters(probabilities: Record<string, number>): string[] {
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const picked: string[] = [];
  let mass = 0;
  for (const [roman, p] of ranked) {
    picked.push(roman);
    mass += p;
    if (mass >= CHAPTER_MASS - 1e-9 || picked.length === MAX_CHAPTERS) break;
  }
  return picked;
}

export function createJudge(passages: Passage[], ask: AskJev) {
  const book = tagPassages(passages);
  const chapters = new Map<string, Passage[]>();
  for (const p of passages) chapters.set(p.chapterRoman, [...(chapters.get(p.chapterRoman) ?? []), p]);
  const chapterCriteria = Object.fromEntries([...chapters].map(([roman, verses]) => [roman, verses[0].chapterTitle]));
  const byId = new Map(passages.map((p) => [p.id, p]));

  return async function judge(input: string): Promise<Judgement> {
    const phrase = stripAttribution(input);
    if (!phrase) throw new PhraseError("Nothing is left once the attribution is removed. Type the quote itself.");

    // Request 1: the whole book (~15.6k tokens). Verdict and chapter are independent, so they share it.
    const first = await ask({
      state: book,
      questions: {
        verdict: verdictQuestion(phrase),
        chapter: {
          type: "choice",
          instructions: {
            phrase,
            question: "Which chapter of the book in `state` has the verse closest in meaning to `phrase`?",
          },
          criteria: chapterCriteria,
        },
      },
    });

    // Request 2: only the picked chapters, one option per verse.
    const picked = pickChapters(first.answers.chapter.probabilities);
    const verses = picked.flatMap((roman) => chapters.get(roman) ?? []);
    if (verses.length === 0) throw new Error(`Jev named no chapter of the book (picked ${JSON.stringify(picked)})`);
    const second = await ask({
      state: tagPassages(verses),
      questions: {
        verse: {
          type: "choice",
          instructions: { phrase, question: "Which verse in `state` is closest in meaning to `phrase`?" },
          criteria: Object.fromEntries(verses.map((v) => [v.id, null])),
        },
      },
    });

    const passage = byId.get(second.answers.verse.choice);
    if (!passage) throw new Error(`Jev picked an unknown verse: ${second.answers.verse.choice}`);
    return {
      phrase,
      verdict: first.answers.verdict.choice,
      verdictProbabilities: first.answers.verdict.probabilities,
      passage,
      model: first.model,
      inputTokens: (first.usage.input_tokens ?? 0) + (second.usage.input_tokens ?? 0),
      cached: first.cached && second.cached,
    };
  };
}
