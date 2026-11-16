"use client";
import { kioskFetch } from "./api";
import { LANGUAGES, type LangCode } from "@/shared/languages";

/**
 * Voice on the kiosk, in whatever language the person picked.
 * Speaking, in order of preference:
 *   1. Bhashini text-to-speech through our server (all 22 scheduled languages) when it is configured.
 *   2. A browser voice for the language itself (e.g. ta-IN).
 *   3. A browser voice that reads the same script (a Hindi voice for Maithili, Sanskrit, Bhojpuri…), so the
 *      words are still read in that language, with a Hindi accent. The guide pane says which voice is used.
 *   4. Otherwise no voice; the screen says so plainly. Text is always on screen.
 * Listening: Bhashini speech-to-text when configured, else the browser's speech recognition for that language
 * (in Chrome this is Google's speech service; the kiosk says so on first use).
 */
const lang = (code: LangCode) => LANGUAGES.find((l) => l.code === code)!;

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  current?.pause();
  current = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/** Browser voices load asynchronously; resolve once they're available (or after 1.5 s). */
export function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((res) => {
    const done = () => res(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

export type VoiceChoice = { voice: SpeechSynthesisVoice; exact: boolean } | null;

export function browserVoiceFor(code: LangCode): VoiceChoice {
  if (typeof speechSynthesis === "undefined") return null;
  const L = lang(code);
  const voices = speechSynthesis.getVoices();
  const by = (tag: string) => voices.find((v) => v.lang.toLowerCase().replace("_", "-") === tag.toLowerCase()) ?? null;
  const prefix = (p: string) => voices.find((v) => v.lang.toLowerCase().startsWith(p.toLowerCase() + "-") || v.lang.toLowerCase() === p.toLowerCase()) ?? null;
  const exact = by(L.speech) ?? prefix(code);
  if (exact) return { voice: exact, exact: true };
  for (const f of L.voiceFallback as readonly string[]) { const v = by(f) ?? prefix(f.split("-")[0]); if (v) return { voice: v, exact: false }; }
  return null;
}

export type SpokenWith = { how: "server" | "browser" | "none"; voiceName?: string; exact?: boolean };

export async function speak(text: string, code: LangCode, serverVoice: boolean, onEnd?: () => void): Promise<SpokenWith> {
  stopSpeaking();
  if (serverVoice) {
    try {
      const { audio } = await kioskFetch<{ audio: string }>("/api/voice/tts", { body: { text: text.slice(0, 600), lang: lang(code).bhashini } });
      current = new Audio(`data:audio/wav;base64,${audio}`);
      current.onended = () => onEnd?.();
      await current.play();
      return { how: "server", voiceName: "Bhashini", exact: true };
    } catch {
      /* fall through to the browser voice */
    }
  }
  await voicesReady();
  const c = browserVoiceFor(code);
  if (c) {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = c.voice;
    u.lang = c.voice.lang;
    u.rate = 0.95;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    speechSynthesis.speak(u);
    return { how: "browser", voiceName: c.voice.name, exact: c.exact };
  }
  onEnd?.();
  return { how: "none" };
}

type SR = { lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: (e: { error: string }) => void; onend: () => void; start: () => void; stop: () => void; abort: () => void };
const SRClass = (): (new () => SR) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export const canListen = (serverVoice: boolean) => serverVoice || Boolean(SRClass());

/**
 * Listen once. With Bhashini: record until stop() (or 15 s) and transcribe on the server.
 * Without: the browser's recognizer for this language, which stops by itself after a pause.
 */
export async function listen(code: LangCode, serverVoice: boolean): Promise<{ stop: () => Promise<string>; result: Promise<string> }> {
  if (serverVoice) {
    const r = await startListening(code);
    let p: Promise<string> | null = null;
    const stop = () => (p ??= r.stop());
    return { stop, result: new Promise<string>((res) => setTimeout(() => void stop().then(res, () => res("")), 6000)) };
  }
  const C = SRClass();
  if (!C) throw new Error("no_recognition");
  const rec = new C();
  rec.lang = lang(code).speech;
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  const result = new Promise<string>((res, rej) => {
    let got = "";
    rec.onresult = (e) => { got = [...Array.from(e.results)].map((r) => Array.from(r).map((a) => a.transcript).join(" | ")).join(" "); };
    rec.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? res("") : rej(new Error(e.error)));
    rec.onend = () => res(got);
  });
  rec.start();
  return { stop: async () => { rec.stop(); return result; }, result };
}

/** Record from the microphone until stop() is called (or 15 s), then transcribe with Bhashini. */
export async function startListening(code: LangCode): Promise<{ stop: () => Promise<string> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  const auto = setTimeout(() => rec.state === "recording" && rec.stop(), 15_000);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  return {
    stop: async () => {
      clearTimeout(auto);
      if (rec.state === "recording") rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      const wav = await toWav16k(new Blob(chunks, { type: rec.mimeType }));
      const { text } = await kioskFetch<{ text: string }>("/api/voice/asr", { body: { audio: wav, lang: lang(code).bhashini }, timeoutMs: 30_000 });
      return text;
    },
  };
}

/** Decode any recorded audio, resample to 16 kHz mono and encode as base64 16-bit PCM WAV. */
async function toWav16k(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf);
  await ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const out = (await off.startRendering()).getChannelData(0);
  const bytes = new ArrayBuffer(44 + out.length * 2);
  const v = new DataView(bytes);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + out.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i])) * 0x7fff, true);
  let bin = "";
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Which message to show for a recognition failure. */
export function voiceErrorKey(e: unknown): "micBlocked" | "voiceNeedsNet" | "voiceNoLang" | "voiceOff" {
  const code = e instanceof Error ? e.message : "";
  if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture" || (e instanceof DOMException && e.name === "NotAllowedError")) return "micBlocked";
  if (code === "network") return "voiceNeedsNet";
  if (code === "language-not-supported") return "voiceNoLang";
  return "voiceOff";
}
