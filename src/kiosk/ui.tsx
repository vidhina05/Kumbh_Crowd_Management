"use client";
import { useEffect, useRef, useState } from "react";
import { startListening } from "./voice";
import type { LangCode } from "@/shared/languages";
import type { T } from "@/i18n";

export function Icon({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return (
    <span className={`icon${size ? ` ${size}` : ""}`} aria-hidden="true">
      {name}
    </span>
  );
}

/** On-screen number pad: many pilgrims are not used to phone keyboards. */
export function Keypad({ value, onChange, max, onDone, t }: { value: string; onChange: (v: string) => void; max: number; onDone?: () => void; t: T }) {
  const press = (k: string) => {
    if (k === "back") onChange(value.slice(0, -1));
    else if (k === "ok") onDone?.();
    else if (value.length < max) onChange(value + k);
  };
  return (
    <div className="k-keypad" role="group" aria-label="Number pad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
        <button type="button" key={k} onClick={() => press(k)}>
          {k}
        </button>
      ))}
      <button type="button" onClick={() => press("back")} aria-label="Delete last digit">
        <Icon name="backspace" />
      </button>
      <button type="button" onClick={() => press("0")}>
        0
      </button>
      <button type="button" onClick={() => press("ok")} aria-label={t("next")} disabled={!onDone}>
        <Icon name="check" />
      </button>
    </div>
  );
}

/** Speech-to-text button for a text field. Only rendered when voice is configured on the server. */
export function MicButton({ lang, onText, t, onError }: { lang: LangCode; onText: (s: string) => void; t: T; onError: (msg: string) => void }) {
  const [rec, setRec] = useState<null | { stop: () => Promise<string> }>(null);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (rec) {
      setBusy(true);
      try {
        const text = await rec.stop();
        if (text) onText(text);
      } catch {
        onError(t("errGeneric"));
      } finally {
        setRec(null);
        setBusy(false);
      }
      return;
    }
    try {
      setRec(await startListening(lang));
    } catch {
      onError(t("voiceOff"));
    }
  };
  return (
    <button type="button" className={`btn small ${rec ? "btn-filled" : "btn-tonal"}`} onClick={toggle} disabled={busy} aria-pressed={Boolean(rec)}>
      <Icon name={rec ? "stop_circle" : "mic"} /> {rec ? t("listening") : t("speak")}
    </button>
  );
}

/**
 * Camera capture for an optional photo (children only, with consent). The image stays in memory,
 * is sent once with the registration, and is never stored on the kiosk.
 */
export function CameraCapture({ onPhoto, t, existing }: { onPhoto: (dataUrl: string | null) => void; t: T; existing?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState(false);
  const [photo, setPhoto] = useState<string | undefined>(existing);

  useEffect(() => () => stream?.getTracks().forEach((tr) => tr.stop()), [stream]);

  const open = async () => {
    setError(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      setStream(s);
      setPhoto(undefined);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      });
    } catch {
      setError(true);
    }
  };
  const capture = () => {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    const w = 360;
    c.width = w;
    c.height = Math.round((v.videoHeight / v.videoWidth) * w) || 270;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.72);
    setPhoto(url);
    onPhoto(url);
    stream?.getTracks().forEach((tr) => tr.stop());
    setStream(null);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {stream && (
        <div className="k-camera">
          <video ref={video} playsInline muted aria-label={t("lookAtCamera")} />
        </div>
      )}
      {photo && !stream && (
        <div className="k-camera" style={{ maxWidth: 200 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={t("photoTaken")} />
        </div>
      )}
      {error && <div className="banner warn"><Icon name="no_photography" /> {t("cameraOff")}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!stream && (
          <button type="button" className="btn small btn-tonal" onClick={open}>
            <Icon name="photo_camera" /> {photo ? t("retakePhoto") : t("takePhoto")}
          </button>
        )}
        {stream && (
          <button type="button" className="btn small btn-filled" onClick={capture}>
            <Icon name="photo_camera" /> {t("takePhoto")}
          </button>
        )}
        {photo && !stream && (
          <button type="button" className="btn small btn-text" onClick={() => { setPhoto(undefined); onPhoto(null); }}>
            {t("removeMember")}
          </button>
        )}
      </div>
    </div>
  );
}

export function Dialog({ title, icon, children, actions }: { title: string; icon?: string; children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div className="dialog-scrim" role="presentation">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        {icon && (
          <div style={{ textAlign: "center", color: "var(--primary)" }}>
            <Icon name={icon} />
          </div>
        )}
        <h2 id="dlg-title">{title}</h2>
        <div className="muted" style={{ fontSize: 16 }}>{children}</div>
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}
