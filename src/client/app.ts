import type { Judgement, Verdict } from "../judge.ts";

type Result = Judgement & { ms: number };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const COPY: Record<Verdict, { verdict: string; label: string; seal: [string, string]; leads: string[] }> = {
  said: {
    verdict: "Sun Tzu said this.",
    label: "Said it",
    seal: ["真", "言"], // "true words"
    leads: ["Word for word, more or less:", "Genuine. It is right here:"],
  },
  close: {
    verdict: "Close enough.",
    label: "Said it differently",
    seal: ["近", "似"], // "approximately"
    leads: ["A paraphrase. What Giles actually wrote:", "The spirit is there. The words are these:"],
  },
  never: {
    verdict: "Sun Tzu never said that.",
    label: "Never said it",
    seal: ["偽", "言"], // "false words"
    leads: ["The closest thing he actually wrote:", "Not in the scroll. He was busy saying this:"],
  },
};

const EXAMPLES = [
  "All warfare is based on deception.",
  "Know your enemy and know yourself",
  "Keep your friends close and your enemies closer",
  "If you wait by the river long enough, the bodies of your enemies will float by",
  "The supreme art of war is to subdue the enemy without fighting",
  "Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt.",
  "Never interrupt your enemy when he is making a mistake",
  "Speed is the essence of war",
  "When you surround an army, leave an outlet free.",
  "Appear weak when you are strong, and strong when you are weak.",
  "Move fast and break things",
];

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function render(r: Result) {
  const copy = COPY[r.verdict];
  const card = $("card");
  card.dataset.verdict = r.verdict;
  const seal = $("seal");
  seal.children[0].textContent = copy.seal[0];
  seal.children[1].textContent = copy.seal[1];
  $("verdict").textContent = copy.verdict;
  $("asked").textContent = `“${r.phrase}”`;

  // Jev returns a probability for every verdict; showing all three is the point of this edition.
  const odds = $("odds");
  odds.replaceChildren(
    ...(["said", "close", "never"] as const satisfies readonly Verdict[]).map((v) => {
      const pct = Math.round(r.verdictProbabilities[v] * 100);
      const row = document.createElement("div");
      row.className = `odd${v === r.verdict ? " picked" : ""}`;
      row.innerHTML = `<span class="odd-label"></span><span class="bar"><i style="width:${pct}%"></i></span><span class="pct">${pct}%</span>`;
      row.querySelector(".odd-label")!.textContent = COPY[v].label;
      return row;
    }),
  );

  $("lead").textContent = pick(copy.leads);
  $("passage").textContent = r.passage.text;
  $("cite").textContent = `— The Art of War, ch. ${r.passage.chapterRoman}, ${r.passage.chapterTitle}, § ${r.passage.verse}`;
  $("meta").textContent = `${r.model} · ${r.inputTokens.toLocaleString()} tokens read · ${r.cached ? "cached answer" : `${(r.ms / 1000).toFixed(1)} s`}`;

  $("placeholder").hidden = true;
  card.hidden = false;
  $("actions").hidden = false;
}

let pending = false;

async function check(phrase: string) {
  // requestSubmit() submits even while #go is disabled, so guard here: one check at a time.
  if (pending) return;
  pending = true;
  const go = $<HTMLButtonElement>("go");
  go.disabled = true;
  go.textContent = "Jev is reading the scroll…";
  $("result").classList.add("busy");
  try {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(body?.error ?? `The server answered with HTTP ${res.status}. Try again later.`);
    render(body as Result);
    history.replaceState(null, "", `?q=${encodeURIComponent(phrase)}`);
  } catch (err) {
    console.error("check failed", err);
    const offline = err instanceof TypeError && /fetch|load failed|network/i.test(err.message);
    $("placeholder").hidden = false;
    $("card").hidden = true;
    $("actions").hidden = true;
    $("placeholder").querySelector("p")!.textContent = offline
      ? "Could not reach the server. Check your connection and try again."
      : err instanceof Error
        ? err.message
        : String(err);
  } finally {
    pending = false;
    go.disabled = false;
    go.textContent = "Consult the scroll";
    $("result").classList.remove("busy");
  }
}

const input = $<HTMLTextAreaElement>("phrase");
$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  if (input.value.trim()) check(input.value.trim());
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $<HTMLFormElement>("ask").requestSubmit();
  }
});
$("random").addEventListener("click", () => {
  input.value = pick(EXAMPLES.filter((x) => x !== input.value));
  $<HTMLFormElement>("ask").requestSubmit();
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $("copied").textContent = "Copied.";
  } catch (err) {
    // No permission, or a plain-HTTP page such as the Tailscale URL.
    console.error("clipboard write failed", err);
    $("copied").textContent = "Could not copy. Copy the address bar instead.";
  }
  setTimeout(() => ($("copied").textContent = ""), 2000);
});

const q = new URLSearchParams(location.search).get("q");
if (q) {
  input.value = q;
  check(q);
}
