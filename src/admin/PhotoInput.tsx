"use client";
import { useEffect, useRef, useState } from "react";

/** Take a photo with the console camera, or choose an image file. Returns a JPEG data URL, max 640 px wide. */
export function toJpeg(src: CanvasImageSource & { videoWidth?: number; naturalWidth?: number; width?: number }, w0: number, h0: number, max = 640): string {
  const scale = Math.min(1, max / w0);
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * scale);
  c.height = Math.round(h0 * scale);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

export default function PhotoInput({ onPhoto, label = "Photo" }: { onPhoto: (dataUrl: string) => void; label?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  const open = async () => {
    setErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
      setStream(s);
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play(); } });
    } catch { setErr("The camera isn't available here. Choose a photo file instead."); }
  };
  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    onPhoto(toJpeg(v, v.videoWidth, v.videoHeight));
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };
  const file = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErr("Choose an image file."); return; }
    const url = URL.createObjectURL(f);
    try {
      const img = new Image(); img.src = url; await img.decode();
      onPhoto(toJpeg(img, img.naturalWidth, img.naturalHeight));
    } catch { setErr("That image couldn't be read."); }
    finally { URL.revokeObjectURL(url); }
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {stream && <video ref={video} playsInline muted style={{ width: "100%", maxWidth: 420, borderRadius: 12, background: "#000" }} aria-label={`${label}: camera preview`} />}
      <div className="a-row" style={{ gap: 8 }}>
        {!stream ? <button type="button" className="btn btn-tonal small" onClick={open}><span className="icon sm">photo_camera</span> Use camera</button>
          : <><button type="button" className="btn btn-filled small" onClick={snap}><span className="icon sm">photo_camera</span> Take photo</button><button type="button" className="btn btn-text small" onClick={() => { stream.getTracks().forEach((t) => t.stop()); setStream(null); }}>Cancel</button></>}
        <label className="btn btn-text small" style={{ cursor: "pointer" }}>
          <span className="icon sm">upload</span> Choose file
          <input type="file" accept="image/*" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} onChange={(e) => { void file(e.target.files?.[0]); e.target.value = ""; }} aria-label={`${label}: choose an image file`} />
        </label>
      </div>
      {err && <div className="banner warn" style={{ fontSize: 13 }}>{err}</div>}
    </div>
  );
}
