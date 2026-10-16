import type { ChoiceQuestion, ChoiceResponse, SystemOneRequest } from "@typesafe-ai/sdk";

export interface Passage {
  id: string; // "III.18"
  chapter: number;
  chapterRoman: string;
  chapterTitle: string;
  verse: string;
  text: string;
}

export type Verdict = "said" | "close" | "never";

/** The only part of the TypeSafe client the judge needs, so tests can replay recorded answers. */
export interface JevResult {
  model: string;
  answers: Record<string, ChoiceResponse>;
  usage: { input_tokens: number | null };
}
export type AskJev = (request: SystemOneRequest) => Promise<JevResult>;

export interface Judgement {
  phrase: string;
  verdict: Verdict;
  verdictProbabilities: Record<Verdict, number>;
  verdictConfidence: number;
  passage: Passage;
  passageProbability: number;
  chapters: { roman: string; title: string; probability: number }[];
  model: string;
  inputTokens: number;
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

/** `reversed` exists only for the option-order check in scripts/eval.ts. */
export function verdictQuestion(phrase: string, reversed = false): ChoiceQuestion {
  const order: Verdict[] = reversed ? ["never", "close", "said"] : ["said", "close", "never"];
  return {
    type: "choice",
    instructions: { phrase, question: VERDICT_QUESTION },
    criteria: Object.fromEntries(order.map((v) => [v, VERDICT_CRITERIA[v]])),
  };
}

/** Removes attributions people paste with a quote, e.g. '"…" — Sun Tzu, The Art of War'. */
export function stripAttribution(text: string): string {
  return text
    .replace(/\s*[-–—~―]+\s*(sun\s*tz[uŭ]|sunzi|sun\s*wu)\b.*$/is, "")
    .replace(/^\s*(as\s+)?(sun\s*tz[uŭ]|sunzi|sun\s*wu)(\s+(once|famously))?\s+(said|says|wrote)\s*[:,]?\s*/i, "")
    .replace(/,?\s*(said|says|wrote)\s+(sun\s*tz[uŭ]|sunzi)\.?\s*$/i, "")
    .replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, "")
    .trim();
}

// Giles marks italics with underscores; they carry no meaning for the judgement.
const plain = (s: string) => s.replace(/_/g, "");

/** One line per verse, tagged with its id so a Choice can point at it. */
export function tagPassages(passages: Passage[]): string {
  const lines: string[] = [];
  let chapter = 0;
  for (const p of passages) {
    if (p.chapter !== chapter) {
      chapter = p.chapter;
      lines.push(`Chapter ${p.chapterRoman}. ${p.chapterTitle}`);
    }
    lines.push(`${p.id}| ${plain(p.text)}`);
  }
  return lines.join("\n");
}

// Choice caps at 255 options and the book has 383 verses, so the verse is found in two passes:
// first the chapter (in the same request as the verdict), then the verse inside that chapter.
const MAX_CHAPTERS = 3; // the largest three chapters together stay far below 255 verses
const CHAPTER_MASS = 0.9;

export function pickChapters(probabilities: Record<string, number>): string[] {
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const picked: string[] = [];
  let mass = 0;
  for (const [roman, p] of ranked) {
    picked.push(roman);
    mass += p;
    if (mass >= CHAPTER_MASS || picked.length === MAX_CHAPTERS) break;
  }
  return picked;
}

export function createJudge(passages: Passage[], ask: AskJev) {
  const book = tagPassages(passages);
  const chapters = new Map<string, { title: string; verses: Passage[] }>();
  for (const p of passages) {
    const c = chapters.get(p.chapterRoman) ?? { title: p.chapterTitle, verses: [] };
    c.verses.push(p);
    chapters.set(p.chapterRoman, c);
  }
  const byId = new Map(passages.map((p) => [p.id, p]));

  return async function judge(input: string): Promise<Judgement> {
    const phrase = stripAttribution(input);
    if (!phrase) throw new Error("Empty phrase");

    // Request 1: the whole book (~15k tokens). Verdict and chapter are independent, so they share it.
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
          criteria: Object.fromEntries([...chapters].map(([roman, c]) => [roman, c.title])),
        },
      },
    });
    const verdict = first.answers.verdict;
    const picked = pickChapters(first.answers.chapter.probabilities);

    // Request 2: only the picked chapters, one option per verse.
    const verses = picked.flatMap((roman) => chapters.get(roman)!.verses);
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
    const verse = second.answers.verse;

    return {
      phrase,
      verdict: verdict.choice as Verdict,
      verdictProbabilities: verdict.probabilities as Record<Verdict, number>,
      verdictConfidence: verdict.confidence,
      passage: byId.get(verse.choice)!,
      passageProbability: verse.probabilities[verse.choice] ?? 0,
      chapters: picked.map((roman) => ({
        roman,
        title: chapters.get(roman)!.title,
        probability: first.answers.chapter.probabilities[roman] ?? 0,
      })),
      model: first.model,
      inputTokens: (first.usage.input_tokens ?? 0) + (second.usage.input_tokens ?? 0),
    };
  };
}
