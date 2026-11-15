"use client";
import { kioskFetch } from "./api";
import { LANGUAGES, type LangCode } from "@/shared/languages";

/**
 * Voice on the kiosk.
 * - Speaking: Bhashini text-to-speech through our server when configured; otherwise the browser's
 *   built-in voice if it has one for the language; otherwise voice is hidden.
 * - Listening: Bhashini speech-to-text only (browser speech recognition sends audio to third parties
 *   and is unreliable for Indian languages, so it is not used).
 */
const lang = (code: LangCode) => LANGUAGES.find((l) => l.code === code)!;

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  current?.pause();
  current = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

export function browserVoiceFor(code: LangCode): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const target = lang(code).speech.toLowerCase();
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang.toLowerCase() === target) ?? voices.find((v) => v.lang.toLowerCase().startsWith(code)) ?? null;
}

export async function speak(text: string, code: LangCode, serverVoice: boolean): Promise<"server" | "browser" | "none"> {
  stopSpeaking();
  if (serverVoice) {
    try {
      const { audio } = await kioskFetch<{ audio: string }>("/api/voice/tts", { body: { text, lang: lang(code).bhashini } });
      current = new Audio(`data:audio/wav;base64,${audio}`);
      await current.play();
      return "server";
    } catch {
      /* fall through to the browser voice */
    }
  }
  const v = browserVoiceFor(code);
  if (v) {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v;
    u.lang = v.lang;
    u.rate = 0.95;
    speechSynthesis.speak(u);
    return "browser";
  }
  return "none";
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
