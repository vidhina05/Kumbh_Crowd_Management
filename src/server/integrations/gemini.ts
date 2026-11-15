import "server-only";
import { env } from "../env";
import { unavailable } from "../http";

/**
 * Google Gemini — powers "Sahayak", the control-room assistant.
 * It only sees an aggregate snapshot of operational data (no names, phones or photos)
 * and it can only suggest; staff take every action themselves.
 */
const SYSTEM = `You are Sahayak, an assistant for the Maha Kumbh crowd-management control room.
Answer ONLY from the JSON snapshot provided. If the snapshot does not contain the answer, say so plainly.
Every crowd number has a "source" and an "updatedMinutesAgo": say when a number was typed in by staff ("manual") and how old it is; treat numbers older than 15 minutes as stale.
Keep answers under 120 words. Use short sentences. When you suggest an action, say it is a suggestion for staff to confirm.
Never invent data, people, places or numbers. Never claim to have taken an action.`;

export async function askGemini(question: string, snapshot: unknown): Promise<string> {
  const e = env();
  if (!e.GEMINI_API_KEY) throw unavailable("assistant_not_configured", "Sahayak is not connected on this server.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(e.GEMINI_MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": e.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Snapshot (JSON):\n${JSON.stringify(snapshot)}\n\nQuestion: ${question}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    console.error("[gemini] request failed with status", res.status);
    throw unavailable("assistant_failed", "Sahayak could not answer right now. Please try again.");
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw unavailable("assistant_failed", "Sahayak had no answer for that.");
  return text;
}
