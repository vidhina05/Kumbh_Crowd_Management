"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, kioskFetch } from "./api";
import { Icon } from "./ui";
import type { T } from "@/i18n";
import { QrScanner, readQrFromImage } from "@/shared/client/QrScanner";
import { faceTemplate, faceEngine } from "@/shared/client/face";

export type AadhaarResult = { aadhaarToken: string; verifiedBy: "uidai" | "test" | "unchecked"; person: { name: string; age: number | null; gender: "M" | "F" | "T" | null; last4: string; state: string | null } };

/** Aadhaar Secure QR: camera scan, a photo of the QR, or (demo/staging only) a signed test card. The server checks the signature. */
export function AadhaarScan({ t, testCards, onVerified, onError }: { t: T; testCards: boolean; onVerified: (r: AadhaarResult) => void; onError: (msg: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const verify = useCallback(async (qr: string) => {
    setChecking(true);
    try {
      onVerified(await kioskFetch<AadhaarResult>("/api/kiosk/aadhaar/verify", { body: { qr } }));
    } catch (e) {
      onError(e instanceof ApiError && e.offline ? "offline" : t("aadhaarBad"));
      setScanKey((k) => k + 1);
    } finally {
      setChecking(false);
    }
  }, [onVerified, onError, t]);
  const useTest = async (n: number) => {
    setChecking(true);
    try {
      const c = await kioskFetch<{ qr: string }>(`/api/kiosk/aadhaar/test-card?n=${n}`);
      await verify(c.qr);
    } catch { onError(t("aadhaarBad")); setChecking(false); }
  };
  const fromFile = async (f?: File) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const text = await readQrFromImage(url);
      if (!text) onError(t("aadhaarBad"));
      else await verify(text);
    } finally { URL.revokeObjectURL(url); }
  };
  return (
    <div style={{ display: "grid", gap: 14, justifyItems: "start" }}>
      {checking ? (
        <div className="banner info" role="status"><Icon name="hourglass_top" /> {t("aadhaarChecking")}</div>
      ) : (
        <QrScanner key={scanKey} label={t("aadhaarScanning")} onResult={verify} />
      )}
      <label className="btn btn-text small" style={{ cursor: "pointer", position: "relative" }}>
        <Icon name="upload" /> {t("aadhaarUpload")}
        <input type="file" accept="image/*" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ""; }} aria-label={t("aadhaarUpload")} />
      </label>
      {testCards && (
        <div className="card" style={{ display: "grid", gap: 8, width: "100%" }}>
          <b style={{ fontSize: 14 }}><Icon name="science" size="sm" /> {t("aadhaarTestCards")}</b>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Ramesh Sharma", "Sunita Verma", "Mohan Lal Yadav"].map((n, i) => (
              <button key={n} className="btn btn-tonal small" disabled={checking} onClick={() => useTest(i)}><Icon name="badge" size="sm" /> {n}</button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{t("aadhaarTest")}</span>
        </div>
      )}
    </div>
  );
}

/** Live camera for "find me by face": takes one frame and turns it into a face template on this device. */
export function FaceCapture({ t, onTemplate, onError }: { t: T; onTemplate: (template: string) => void; onError: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let s: MediaStream | null = null;
    let stopped = false;
    void faceEngine().catch(() => undefined); // start loading the model while the camera opens
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false })
      .then((st) => { if (stopped) return st.getTracks().forEach((x) => x.stop()); s = st; video.current!.srcObject = st; return video.current!.play().then(() => setReady(true)); })
      .catch(() => onError(t("cameraOff")));
    return () => { stopped = true; s?.getTracks().forEach((x) => x.stop()); };
  }, [onError, t]);
  const take = async () => {
    if (!video.current) return;
    setBusy(true);
    const r = await faceTemplate(video.current);
    setBusy(false);
    if (!r.ok) onError(t("faceRetake"));
    else onTemplate(r.template);
  };
  return (
    <div style={{ display: "grid", gap: 12, justifyItems: "start" }}>
      <div className="k-camera" style={{ maxWidth: 420 }}><video ref={video} playsInline muted aria-label={t("lookAtCamera")} /></div>
      <button className="btn btn-filled" disabled={!ready || busy} onClick={take}><Icon name="face" /> {busy ? t("faceWorking") : t("findFaceTake")}</button>
    </div>
  );
}

/** Face template from a member photo (registration). */
export async function templateFromPhoto(dataUrl: string): Promise<string | null> {
  const r = await faceTemplate(dataUrl);
  return r.ok ? r.template : null;
}
