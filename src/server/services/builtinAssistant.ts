import "server-only";
import { ghatsLive } from "./crowd";
import { batchPlan } from "./diversions";
import { overview } from "./overview";
import { istDate } from "@/shared/time";

/**
 * Sahayak without AI: deterministic answers calculated from live data, for when no Gemini key is set
 * (or Gemini is down). Clearly labelled "Built-in answer · no AI" in the UI.
 */
export async function builtinAnswer(question: string): Promise<{ answer: string; matched: boolean }> {
  const q = question.toLowerCase();
  const ghats = await ghatsLive();
  const label = (s: string) => (s === "sensor" ? "sensor" : s === "simulated" ? "simulated" : "typed in by staff");
  if (/room|space|calm|least|emptiest|which ghat/.test(q)) {
    const best = [...ghats].filter((g) => g.updatedMinutesAgo !== null).sort((a, b) => a.percent - b.percent).slice(0, 3);
    if (!best.length) return { matched: true, answer: "No crowd numbers yet, so I can't say which ghat has room." };
    return { matched: true, answer: `Most room now: ${best.map((g) => `${g.name} ${g.percent}% (${label(g.source)}, ${g.updatedMinutesAgo} min ago)`).join("; ")}. Check before sending people.` };
  }
  if (/full|busiest|crowd|danger|limit|over/.test(q)) {
    const hot = ghats.filter((g) => g.percent >= g.safeLimitPct).sort((a, b) => b.percent - a.percent);
    if (!hot.length) return { matched: true, answer: "No ghat is over its safe limit right now." };
    return { matched: true, answer: hot.map((g) => `${g.name} is at ${g.percent}% (safe limit ${g.safeLimitPct}%)${g.projection.minutesToFull ? `, full in about ${g.projection.minutesToFull} min if nothing changes` : ""}.`).join(" ") + " Suggestion for staff to confirm: divert upcoming batches from the fullest ghat." };
  }
  if (/stale|old|out of date|updated/.test(q)) {
    const stale = ghats.filter((g) => g.updatedMinutesAgo === null || g.updatedMinutesAgo > 15);
    return { matched: true, answer: stale.length ? `Not updated in 15 minutes: ${stale.map((g) => g.name).join(", ")}.` : "Every ghat's number was updated in the last 15 minutes." };
  }
  if (/help|request|lost|medical|case/.test(q)) {
    const o = await overview();
    const parts = Object.entries(o.openHelp).map(([k, v]) => `${v} ${k.replace("_", " ")}`);
    return { matched: true, answer: `Open help requests: ${o.openHelpTotal}${parts.length ? ` (${parts.join(", ")})` : ""}. Open lost-person cases: ${o.openLost}.` };
  }
  if (/batch|plan|slot|divert/.test(q)) {
    const p = await batchPlan(istDate());
    return { matched: true, answer: p.fixes.length ? `${p.fixes.length} upcoming batches are at or over the limit. First: ${p.fixes.slice(0, 2).map((f) => `${f.ghatName} ${f.start} (${f.percent}%) — ${f.action}`).join("; ")}.` : "No upcoming batch is over the limit." };
  }
  return { matched: false, answer: "I can answer from live numbers about: which ghat has room, which ghats are full, stale counts, help and lost cases, and the batch plan. For free-form questions, connect Gemini (see Settings)." };
}
