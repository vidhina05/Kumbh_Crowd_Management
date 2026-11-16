"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { countPeople, faceEngine } from "@/shared/client/face";

/**
 * Camera crowd counter: turns any phone or laptop into a sensor. It counts people in view on the device
 * (no video is sent anywhere) and posts the number to /api/sensors/ingest with the sensor's own key.
 */
const STORE = "camera.sensor";

export default function Page() {
  return <Suspense fallback={null}><CameraCounter /></Suspense>;
}

function CameraCounter() {
  const qs = useSearchParams();
  const [cfg, setCfg] = useState<{ id: string; key: string; every: number } | null>(null);
  const [form, setForm] = useState({ id: qs.get("sensor") ?? "", key: "", every: 15 });
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Not started");
  const [count, setCount] = useState<number | null>(null);
  const [sent, setSent] = useState<{ at: Date; ok: boolean; text: string }[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    try { const c = JSON.parse(sessionStorage.getItem(STORE) ?? "null"); if (c?.id && c?.key) setCfg(c); } catch { /* none saved */ }
  }, []);

  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setRunning(false); setStatus("Stopped"); }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    setStatus("Loading the people-detection model…");
    try {
      await faceEngine();
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
      video.current!.srcObject = stream.current;
      await video.current!.play();
      setRunning(true);
      setStatus("Counting");
    } catch (e) {
      setStatus(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was refused." : "Couldn't start the camera or the model on this device.");
    }
  };

  useEffect(() => {
    if (!running || !cfg) return;
    let alive = true;
    const tick = async () => {
      const v = video.current;
      if (!v || !alive) return;
      try {
        const r = await countPeople(v);
        if (!alive) return;
        setCount(r.count);
        const c = canvas.current;
        if (c && v.videoWidth) {
          c.width = v.videoWidth; c.height = v.videoHeight;
          const ctx = c.getContext("2d")!;
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.lineWidth = Math.max(2, c.width / 320);
          ctx.strokeStyle = "#ffd400";
          for (const [x, y, w, h] of r.boxes) ctx.strokeRect(x, y, w, h);
        }
        const res = await fetch("/api/sensors/ingest", { method: "POST", headers: { "Content-Type": "application/json", "X-Sensor-Id": cfg.id, Authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ occupancy: r.count }) });
        const body = await res.json().catch(() => ({}));
        setSent((s) => [{ at: new Date(), ok: res.ok, text: res.ok ? `Sent ${r.count}` : (body as { error?: { message?: string } }).error?.message ?? `Error ${res.status}` }, ...s].slice(0, 6));
        if (res.status === 401) { setStatus("The sensor ID or key was refused. Check them with the control room."); stop(); }
      } catch {
        setSent((s) => [{ at: new Date(), ok: false, text: "Couldn't count or send. Will retry." }, ...s].slice(0, 6));
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), cfg.every * 1000);
    return () => { alive = false; clearInterval(iv); };
  }, [running, cfg, stop]);

  if (!cfg) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <form className="glass" style={{ padding: 28, width: "min(460px, 100%)", display: "grid", gap: 14 }} onSubmit={(e) => { e.preventDefault(); const c = { id: form.id.trim(), key: form.key.trim(), every: form.every }; sessionStorage.setItem(STORE, JSON.stringify(c)); setCfg(c); }}>
          <h1 style={{ margin: 0, fontWeight: 400 }}>Camera crowd counter</h1>
          <p className="muted" style={{ margin: 0 }}>Counts people in view on this device and sends only the number. Get a sensor ID and key from the control room (Sensors → Register a device → Camera counter).</p>
          <div className="field"><label htmlFor="sid">Sensor ID</label><input id="sid" className="input mono" required pattern="S-\d{4,6}" placeholder="S-0046" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label htmlFor="skey">Sensor key</label><input id="skey" className="input mono" required minLength={10} type="password" autoComplete="off" placeholder="sk_…" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></div>
          <div className="field"><label htmlFor="every">Send every</label>
            <select id="every" className="input" value={form.every} onChange={(e) => setForm({ ...form, every: Number(e.target.value) })}>{[5, 10, 15, 30, 60].map((s) => <option key={s} value={s}>{s} seconds</option>)}</select></div>
          <button className="btn btn-filled">Save and continue</button>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>The key is kept only for this browser tab.</p>
        </form>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", padding: 16, display: "grid", gap: 12, alignContent: "start", maxWidth: 1000, margin: "0 auto" }}>
      <div className="a-row" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 400, flex: 1, fontSize: 24 }}>Camera counter · <span className="mono">{cfg.id}</span></h1>
        {!running ? <button className="btn btn-filled" onClick={start}><span className="icon">play_arrow</span> Start counting</button> : <button className="btn btn-tonal" onClick={stop}><span className="icon">stop</span> Stop</button>}
        <button className="btn btn-text" onClick={() => { stop(); sessionStorage.removeItem(STORE); setCfg(null); }}>Change sensor</button>
      </div>
      <div className="glass" style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#000", aspectRatio: "16 / 9" }}>
        <video ref={video} playsInline muted style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} aria-label="Camera view" />
        <canvas ref={canvas} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} aria-hidden="true" />
        <div style={{ position: "absolute", left: 16, top: 16, background: "rgb(0 0 0 / .6)", color: "#fff", padding: "8px 14px", borderRadius: 12 }} role="status" aria-live="polite">
          <div style={{ fontSize: 12 }}>{status}</div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{count ?? "—"} <span style={{ fontSize: 14, fontWeight: 400 }}>people in view</span></div>
        </div>
      </div>
      <section className="glass" style={{ padding: 16 }}>
        <b>Sent to the control room</b>
        {sent.length === 0 ? <div className="muted">Nothing yet.</div> : <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{sent.map((s, i) => <li key={i} style={{ color: s.ok ? undefined : "var(--error)" }}>{s.at.toLocaleTimeString()} · {s.text}</li>)}</ul>}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>No images or video leave this device. Only the count is sent. It counts faces it can see (nobody is identified), so point the camera towards the crowd. A camera&apos;s count is shown for that camera and doesn&apos;t replace the ghat&apos;s total.</p>
      </section>
    </main>
  );
}
