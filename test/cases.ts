import type { Verdict } from "../src/judge.ts";

/** Labelled phrases, taken from Guilherme's matcher tests (passage ids are his). */
export const CASES: { phrase: string; verdict: Verdict; passage?: string }[] = [
  { phrase: "If you know the enemy and know yourself, you need not fear the result of a hundred battles.", verdict: "said", passage: "III.18" },
  { phrase: "All warfare is based on deception.", verdict: "said", passage: "I.18" },
  { phrase: "Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt.", verdict: "said", passage: "VII.19" },
  { phrase: "Rapidity is the essence of war", verdict: "said", passage: "XI.19" },
  { phrase: "When you surround an army, leave an outlet free", verdict: "said", passage: "VII.36" },
  { phrase: "all warfare is based on decepton", verdict: "said", passage: "I.18" },
  { phrase: "“All warfare is based on deception.” — Sun Tzu, The Art of War", verdict: "said", passage: "I.18" },
  { phrase: "Know your enemy and know yourself", verdict: "close", passage: "III.18" },
  { phrase: "Speed is the essence of war", verdict: "close", passage: "XI.19" },
  { phrase: "Know thy enemy and know thyself", verdict: "close", passage: "III.18" },
  { phrase: "The supreme art of war is to subdue the enemy without fighting", verdict: "close", passage: "III.2" },
  { phrase: "Treat your men as you would your own beloved sons. And they will follow you into the deepest valley.", verdict: "close", passage: "X.25" },
  { phrase: "Attack where they are unprepared, appear where you are not expected", verdict: "close", passage: "I.24" },
  { phrase: "Keep your friends close and your enemies closer", verdict: "never" },
  { phrase: "If you wait by the river long enough, the bodies of your enemies will float by", verdict: "never" },
  { phrase: "Never interrupt your enemy when he is making a mistake", verdict: "never" },
  { phrase: "Life is like a box of chocolates", verdict: "never" },
  { phrase: "The best defense is a good offense", verdict: "never" },
  { phrase: "Be like water my friend", verdict: "never" },
  { phrase: "The enemy of my enemy is my friend", verdict: "never" },
  { phrase: "I came, I saw, I conquered", verdict: "never" },
  { phrase: "Move fast and break things", verdict: "never" },
];
