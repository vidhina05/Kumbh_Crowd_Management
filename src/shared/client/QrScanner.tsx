"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Camera QR scanner. Uses the browser's BarcodeDetector when it has one (fast, handles the dense Aadhaar QR),
 * otherwise jsQR on canvas frames.
 */
export function QrScanner({ onResult, label, onError }: { onResult: (text: string) => void; label: string; onError?: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "scanning" | "denied">("starting");
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let frameNo = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    type BD = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BD };
    const detector = W.BarcodeDetector ? new W.BarcodeDetector({ formats: ["qr_code"] }) : null;

    const tick = async () => {
      if (stopped || done.current) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        let text: string | null = null;
        if (detector) {
          try { text = (await detector.detect(v))[0]?.rawValue ?? null; } catch { /* fall back below */ }
        }
        if (!text) {
          // Aadhaar Secure QR is very dense: read the centre square at full camera resolution (no downscaling),
          // alternating with the whole frame, and try both light-on-dark and dark-on-light.
          frameNo++;
          const vw = v.videoWidth, vh = v.videoHeight;
          const side = Math.min(vw, vh);
          const crop = frameNo % 2 === 0;
          const sx = crop ? (vw - side) / 2 : 0, sy = crop ? (vh - side) / 2 : 0, sw = crop ? side : vw, sh = crop ? side : vh;
          canvas.width = sw; canvas.height = sh;
          ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
          const img = ctx.getImageData(0, 0, sw, sh);
          text = jsQR(img.data, img.width, img.height, { inversionAttempts: frameNo % 4 < 2 ? "dontInvert" : "attemptBoth" })?.data ?? null;
        }
        if (text && !done.current) {
          done.current = true;
          onResult(text);
          return;
        }
      }
      raf = window.setTimeout(() => void tick(), 120) as unknown as number;
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        setState("scanning");
        void tick();
      } catch {
        setState("denied");
        onError?.("The camera isn't available. Ask a volunteer, or use another option.");
      }
    })();
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onResult, onError]);

  return (
    <div className="qr-scan">
      <video ref={video} playsInline muted aria-label={label} />
      <div className="qr-frame" aria-hidden="true" />
      <div className="qr-status" role="status">{state === "starting" ? "Starting camera…" : state === "scanning" ? label : "Camera not available"}</div>
    </div>
  );
}

/** Read a QR from an uploaded image file (for a phone photo of the card, or a test card image). */
export async function readQrFromImage(src: string): Promise<string | null> {
  const img = new Image();
  img.src = src;
  await img.decode();
  type BD = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
  const W = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BD };
  if (W.BarcodeDetector) {
    try { const r = await new W.BarcodeDetector({ formats: ["qr_code"] }).detect(img); if (r[0]) return r[0].rawValue; } catch { /* fall through */ }
  }
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}
