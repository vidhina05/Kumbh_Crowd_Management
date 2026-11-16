"use client";
/**
 * On-device face and person detection (Human / TensorFlow.js). Photos never leave this device for matching:
 * we send a 1024-number face template, and only for families who opted in.
 */
import { BASE_PATH } from "@/shared/base";

type HumanT = import("@vladmandic/human").Human;
let loading: Promise<HumanT> | null = null;

export type FaceResult =
  | { ok: true; template: string; score: number; real: number; live: number; box: [number, number, number, number] }
  | { ok: false; reason: "no_face" | "many_faces" | "low_quality" | "engine" ; message: string };

const BASE_CONFIG = {
  modelBasePath: `${BASE_PATH}/models/`,
  debug: false,
  cacheSensitivity: 0,
  filter: { enabled: true, equalization: true },
  face: {
    enabled: true,
    detector: { modelPath: "blazeface.json", rotation: false, maxDetected: 3, minConfidence: 0.35, return: false },
    mesh: { enabled: true, modelPath: "facemesh.json" },
    iris: { enabled: false },
    attention: { enabled: false },
    emotion: { enabled: false },
    description: { enabled: true, modelPath: "faceres.json" },
    antispoof: { enabled: true, modelPath: "antispoof.json" },
    liveness: { enabled: true, modelPath: "liveness.json" },
    gear: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
};

export function faceEngine(): Promise<HumanT> {
  if (!loading) {
    loading = (async () => {
      const url = `${BASE_PATH}/vendor/human.esm.js`;
      const { Human } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as typeof import("@vladmandic/human");
      const tryBackend = async (backend: string) => {
        const h = new Human({ ...BASE_CONFIG, backend } as never);
        await h.load();
        await h.warmup();
        return h;
      };
      try {
        return await tryBackend("webgl");
      } catch {
        return await tryBackend("wasm").catch(() => tryBackend("cpu"));
      }
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

function toBase64(f: Float32Array): string {
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

/** Face template from a photo or a live video frame. Exactly one clear face is required. */
export async function faceTemplate(input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | string): Promise<FaceResult> {
  let human: HumanT;
  try {
    human = await faceEngine();
  } catch {
    return { ok: false, reason: "engine", message: "Face matching couldn't start on this device." };
  }
  const el = typeof input === "string" ? await loadImage(input) : input;
  const r = await human.detect(el as never, { face: BASE_CONFIG.face } as never);
  const faces = r.face.filter((f) => f.score >= 0.5);
  if (!faces.length) return { ok: false, reason: "no_face", message: "No face found. Face the camera in good light." };
  if (faces.length > 1) return { ok: false, reason: "many_faces", message: "More than one face. Only one person in the photo, please." };
  const f = faces[0];
  if (!f.embedding || f.embedding.length !== 1024) return { ok: false, reason: "low_quality", message: "The face isn't clear enough. Try again closer to the camera." };
  return { ok: true, template: toBase64(Float32Array.from(f.embedding)), score: f.score, real: f.real ?? 0, live: f.live ?? 0, box: f.box as [number, number, number, number] };
}

/**
 * People visible in a frame, for the camera crowd counter. In dense crowds faces are far easier to find than
 * whole bodies, so this counts faces (detector only: no face templates are made, nothing identifies anyone).
 */
export async function countPeople(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<{ count: number; boxes: [number, number, number, number][] }> {
  const human = await faceEngine();
  const r = await human.detect(input as never, {
    face: { enabled: true, detector: { maxDetected: 200, minConfidence: 0.2 }, mesh: { enabled: false }, description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false } },
  } as never);
  return { count: r.face.length, boxes: r.face.map((f) => f.box as [number, number, number, number]) };
}
