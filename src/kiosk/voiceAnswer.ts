/**
 * Turns a spoken answer into a tap on the screen that is showing. The kiosk reads each screen aloud, the person
 * answers in their own language, and this finds the on-screen choice they named (the button whose words they
 * said), or types the digits they spoke into the number pad. Nothing here guesses beyond what is on screen.
 */

const ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0x1c50, 0xabf0];

/** Any script's digits (०१२, ௧, ০ …) to 0-9. */
export function asciiDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const z = ZEROS.find((z0) => c >= z0 && c <= z0 + 9);
    out += z !== undefined ? String(c - z) : ch;
  }
  return out;
}

const clean = (s: string) =>
  asciiDigits(s)
    .toLowerCase()
    .normalize("NFC")
    .replace(/[“”"'’.,!?।॥:;()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The visible label of a control, without Material icon ligature names. */
function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".icon, [aria-hidden=true]").forEach((n) => n.remove());
  return clean(`${copy.innerText || copy.textContent || ""} ${aria ?? ""}`);
}

const visible = (el: HTMLElement) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type VoiceAnswer = { kind: "tapped"; label: string } | { kind: "digits"; digits: string } | { kind: "none" };

/** Act on what was heard inside `root`. `alternatives` are the recognizer's guesses, best first. */
export async function answerByVoice(root: HTMLElement, alternatives: string[]): Promise<VoiceAnswer> {
  const heard = alternatives.map(clean).filter(Boolean);
  if (!heard.length) return { kind: "none" };

  // 1. Digits for a number pad (phone number, age, booking number).
  const pad = root.querySelector<HTMLElement>(".k-keypad");
  if (pad && visible(pad)) {
    const digits = heard.map((h) => h.replace(/\D/g, "")).find((d) => d.length > 0);
    if (digits) {
      const keys = new Map<string, HTMLElement>();
      pad.querySelectorAll<HTMLElement>("button").forEach((b) => {
        const k = (b.textContent ?? "").trim();
        if (/^\d$/.test(k)) keys.set(k, b);
      });
      for (const d of digits) {
        keys.get(d)?.click();
        await wait(40); // let React apply each press before the next
      }
      return { kind: "digits", digits };
    }
  }

  // 2. A choice on screen whose words were spoken ("Book a bathing slot", "हिन्दी", "Next"...).
  const controls = Array.from(root.querySelectorAll<HTMLElement>("button, [role=radio], [role=option], a[href]")).filter(
    (el) => visible(el) && !el.closest(".k-keypad") && !el.closest(".k-top"),
  );
  let best: { el: HTMLElement; label: string; score: number } | null = null;
  for (const el of controls) {
    const label = labelOf(el);
    if (label.length < 2) continue;
    const words = label.split(" ").filter((w) => w.length > 1);
    for (const h of heard) {
      let score = 0;
      if (h === label) score = 1000;
      else if (h.includes(label)) score = 500 + label.length;
      else if (label.includes(h) && h.length >= 3) score = 300 + h.length;
      else {
        const hw = new Set(h.split(" "));
        const hit = words.filter((w) => hw.has(w)).length;
        if (hit && words.length) score = Math.round((hit / words.length) * 200);
      }
      if (score > (best?.score ?? 99)) best = { el, label, score };
    }
  }
  if (best) {
    best.el.click();
    return { kind: "tapped", label: best.label };
  }
  return { kind: "none" };
}
