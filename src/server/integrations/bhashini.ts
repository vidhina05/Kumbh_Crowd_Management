import "server-only";
import { env } from "../env";
import { unavailable } from "../http";

/**
 * Bhashini (Government of India, MeitY) — speech-to-text, text-to-speech and translation for Indian languages.
 * Two calls: a "pipeline config" call returns the serviceId + an inference key for a task and language,
 * then a "compute" call does the work. Config results are cached in memory for an hour.
 * Docs: https://bhashini.gitbook.io/bhashini-apis/
 *
 * Not verified against the live service in this repository (no credentials were available while building);
 * see README → "Connect Bhashini" for how to test it once you have keys.
 */
const CONFIG_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";

type TaskConfig = { serviceId: string; callbackUrl: string; authName: string; authValue: string };
const cache = new Map<string, { at: number; cfg: TaskConfig }>();

function creds() {
  const e = env();
  if (!e.BHASHINI_USER_ID || !e.BHASHINI_API_KEY) throw unavailable("voice_not_configured", "Voice is not connected on this server.");
  return e;
}

async function taskConfig(task: "asr" | "tts" | "translation", language: Record<string, string>): Promise<TaskConfig> {
  const e = creds();
  const key = `${task}:${JSON.stringify(language)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.cfg;
  const res = await fetch(CONFIG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", userID: e.BHASHINI_USER_ID!, ulcaApiKey: e.BHASHINI_API_KEY! },
    body: JSON.stringify({ pipelineTasks: [{ taskType: task, config: { language } }], pipelineRequestConfig: { pipelineId: e.BHASHINI_PIPELINE_ID } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw unavailable("voice_failed", "The voice service is not answering right now.");
  const data = (await res.json()) as {
    pipelineResponseConfig?: { config?: { serviceId?: string }[] }[];
    pipelineInferenceAPIEndPoint?: { callbackUrl?: string; inferenceApiKey?: { name?: string; value?: string } };
  };
  const serviceId = data.pipelineResponseConfig?.[0]?.config?.[0]?.serviceId;
  const ep = data.pipelineInferenceAPIEndPoint;
  if (!serviceId || !ep?.callbackUrl || !ep.inferenceApiKey?.name || !ep.inferenceApiKey.value) {
    throw unavailable("voice_unsupported", "This language is not available for voice yet.");
  }
  // SSRF guard: only ever call Bhashini's own inference hosts, whatever the config response says.
  let host = "";
  try {
    const u = new URL(ep.callbackUrl);
    host = u.protocol === "https:" ? u.hostname : "";
  } catch { /* invalid URL */ }
  if (!host || !(host === "bhashini.gov.in" || host.endsWith(".bhashini.gov.in"))) {
    console.error("[bhashini] refused unexpected callback host");
    throw unavailable("voice_failed", "The voice service is not answering right now.");
  }
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(ep.inferenceApiKey.name)) throw unavailable("voice_failed", "The voice service is not answering right now.");
  const cfg = { serviceId, callbackUrl: ep.callbackUrl, authName: ep.inferenceApiKey.name, authValue: ep.inferenceApiKey.value };
  cache.set(key, { at: Date.now(), cfg });
  return cfg;
}

async function compute(cfg: TaskConfig, body: unknown) {
  const res = await fetch(cfg.callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", [cfg.authName]: cfg.authValue },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw unavailable("voice_failed", "The voice service is not answering right now.");
  return (await res.json()) as { pipelineResponse?: { output?: { source?: string; target?: string }[]; audio?: { audioContent?: string }[] }[] };
}

/** Text → speech. Returns base64 WAV audio. */
export async function textToSpeech(text: string, lang: string, gender: "female" | "male" = "female"): Promise<string> {
  const cfg = await taskConfig("tts", { sourceLanguage: lang });
  const out = await compute(cfg, {
    pipelineTasks: [{ taskType: "tts", config: { language: { sourceLanguage: lang }, serviceId: cfg.serviceId, gender, samplingRate: 8000 } }],
    inputData: { input: [{ source: text }] },
  });
  const audio = out.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
  if (!audio) throw unavailable("voice_failed", "No audio came back from the voice service.");
  return audio;
}

/** Speech (base64 16 kHz mono WAV) → text. */
export async function speechToText(audioBase64: string, lang: string): Promise<string> {
  const cfg = await taskConfig("asr", { sourceLanguage: lang });
  const out = await compute(cfg, {
    pipelineTasks: [{ taskType: "asr", config: { language: { sourceLanguage: lang }, serviceId: cfg.serviceId, audioFormat: "wav", samplingRate: 16000 } }],
    inputData: { audio: [{ audioContent: audioBase64 }] },
  });
  return out.pipelineResponse?.[0]?.output?.[0]?.source?.trim() ?? "";
}

export async function translate(text: string, from: string, to: string): Promise<string> {
  if (from === to) return text;
  const cfg = await taskConfig("translation", { sourceLanguage: from, targetLanguage: to });
  const out = await compute(cfg, {
    pipelineTasks: [{ taskType: "translation", config: { language: { sourceLanguage: from, targetLanguage: to }, serviceId: cfg.serviceId } }],
    inputData: { input: [{ source: text }] },
  });
  return out.pipelineResponse?.[0]?.output?.[0]?.target ?? "";
}
