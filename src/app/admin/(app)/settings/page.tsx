"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, usePoll } from "@/admin/client";
import { ROLE_LABELS, type Role } from "@/shared/rbac";
import { useEffect, useRef } from "react";
import { faceEngine, faceTemplate } from "@/shared/client/face";

type Settings = {
  me: { id: string; email: string; name: string; role: Role; staffCode: string; faceEnrolled: boolean; mfaEnabled: boolean; mfaSetupRequired: boolean };
  integrations: { id: string; name: string; connected: boolean; detail: string }[];
  retentionHours: number; mfaRequiredRoles: string[]; demo: boolean;
};

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><SettingsPage /></Suspense>;
}

function SettingsPage() {
  const forced = useSearchParams().get("mfa") === "1";
  const { data, error, reload } = usePoll<Settings>("/api/admin/settings", 60_000);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const start = async () => { setBusy(true); setMsg(null); try { setSetup(await api("/api/admin/mfa/setup")); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't start." }); } finally { setBusy(false); } };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api("/api/admin/mfa/setup", { body: { code } }); setSetup(null); setCode(""); setMsg({ ok: true, text: "Two-step sign-in is on. You'll be asked for a code each time you sign in." }); await reload(); if (forced) location.reload(); }
    catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : "That code didn't match." }); }
    finally { setBusy(false); }
  };

  if (error && !data) return <div className="banner bad" role="alert">{error}</div>;
  if (!data) return <div className="a-empty" aria-busy="true">Loading settings…</div>;
  return (
    <>
      <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28 }}>Settings</h1>
      {(forced || data.me.mfaSetupRequired) && !data.me.mfaEnabled && <div className="banner warn" role="alert"><span className="icon">shield</span> Your role ({ROLE_LABELS[data.me.role]}) must use two-step sign-in. Set it up below to continue.</div>}
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`} role="alert">{msg.text}</div>}
      <div className="a-grid-2">
        <section className="glass a-pane" aria-labelledby="acct-h">
          <h2 id="acct-h">Your account</h2>
          <div>{data.me.name} · {data.me.email} · {ROLE_LABELS[data.me.role]}</div>
          <div className="muted" style={{ fontSize: 13 }}>Staff ID <b className="mono">{data.me.staffCode}</b> · use it to sign in</div>
          <h2 style={{ marginTop: 8 }}>Face sign-in</h2>
          <FaceSignInSetup enrolled={data.me.faceEnrolled} onChange={async (text) => { setMsg({ ok: true, text }); await reload(); }} onError={(text) => setMsg({ ok: false, text })} />
          <h2 style={{ marginTop: 8 }}>Two-step sign-in</h2>
          {data.me.mfaEnabled ? (
            <div className="banner good"><span className="icon">verified_user</span> On. Sign-in asks for a 6-digit code from your authenticator app. If you lose your phone, a super admin can reset it from Staff.</div>
          ) : !setup ? (
            <>
              <p className="muted" style={{ margin: 0 }}>Use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, or similar). Required for: {data.mfaRequiredRoles.length ? data.mfaRequiredRoles.map((r) => ROLE_LABELS[r as Role] ?? r).join(", ") : "nobody (optional)"}.</p>
              <button className="btn btn-filled" disabled={busy} onClick={start}><span className="icon">qr_code_2</span> Set up two-step sign-in</button>
            </>
          ) : (
            <form onSubmit={confirm} style={{ display: "grid", gap: 12 }}>
              <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                <li>Open your authenticator app and add an account.</li>
                <li>Scan this code, or type the key below.</li>
                <li>Enter the 6-digit code it shows.</li>
              </ol>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR code to add Sangam Command to an authenticator app" width={220} height={220} style={{ background: "#fff", padding: 8, borderRadius: 12 }} />
              <div className="muted" style={{ fontSize: 13 }}>Key: <code className="mono" style={{ userSelect: "all", wordBreak: "break-all" }}>{setup.secret}</code></div>
              <div className="field"><label htmlFor="mfa-code">6-digit code</label><input id="mfa-code" className="input mono" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ fontSize: 22, letterSpacing: 6, maxWidth: 220 }} /></div>
              <div className="a-row"><button className="btn btn-filled" disabled={busy || code.length !== 6}>Turn on</button><button type="button" className="btn btn-text" onClick={() => setSetup(null)}>Cancel</button></div>
            </form>
          )}
        </section>
        <section className="glass a-pane" aria-labelledby="int-h">
          <h2 id="int-h">Connections</h2>
          {data.integrations.map((i) => (
            <div key={i.id} className="a-row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <span className={`chip ${i.connected ? "good" : ""}`} style={{ minWidth: 112, justifyContent: "center" }}>{i.connected ? "Connected" : "Not connected"}</span>
              <div><b>{i.name}</b><div className="muted" style={{ fontSize: 13 }}>{i.detail}</div></div>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 13 }}>Personal data is deleted {data.retentionHours} hours after the visit day. Keys and passwords are set by the server administrator in environment variables and are never shown here.</div>
          {data.demo && <div className="banner info" style={{ fontSize: 13 }}><span className="icon sm">science</span> This is the in-browser demo: the database lives in this browser and the data is invented.</div>}
        </section>
      </div>
    </>
  );
}

/** Opt in to signing in with your staff ID + a face scan. Only a face template is stored (encrypted), never a photo. */
function FaceSignInSetup({ enrolled, onChange, onError }: { enrolled: boolean; onChange: (msg: string) => void; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!open) return;
    let s: MediaStream | null = null;
    void faceEngine().catch(() => undefined);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false })
      .then((st) => { s = st; if (video.current) { video.current.srcObject = st; void video.current.play(); } })
      .catch(() => { onError("The camera isn't available on this console."); setOpen(false); });
    return () => s?.getTracks().forEach((t) => t.stop());
  }, [open, onError]);
  const save = async () => {
    if (!video.current) return;
    setBusy(true);
    try {
      const f = await faceTemplate(video.current);
      if (!f.ok) { onError(f.message); return; }
      await api("/api/admin/me/face", { body: { template: f.template } });
      setOpen(false);
      onChange("Face sign-in is on. Next time, enter your staff ID and look at the camera.");
    } catch (e) { onError(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api("/api/admin/me/face", { method: "DELETE", body: {} }); onChange("Face sign-in is off. Your face template was deleted."); }
    catch (e) { onError(e instanceof Error ? e.message : "Couldn't remove."); }
    finally { setBusy(false); }
  };
  if (open) return (
    <div style={{ display: "grid", gap: 10 }}>
      <video ref={video} playsInline muted style={{ width: 280, borderRadius: 16, background: "#000", transform: "scaleX(-1)" }} aria-label="Camera preview" />
      <div className="a-row"><button className="btn btn-filled" disabled={busy} onClick={save}><span className="icon sm">face</span>{busy ? "Reading your face…" : "Use this face"}</button><button className="btn btn-text" onClick={() => setOpen(false)}>Cancel</button></div>
      <span className="muted" style={{ fontSize: 12 }}>The face is read on this console. Only a template (a list of numbers) is saved, encrypted. You can remove it any time; your PIN still works.</span>
    </div>
  );
  return enrolled ? (
    <div className="a-row"><span className="chip good"><span className="icon sm">face</span> On</span><button className="btn btn-text" disabled={busy} onClick={() => setOpen(true)}>Update</button><button className="btn btn-text" disabled={busy} onClick={remove}>Turn off</button></div>
  ) : (
    <div className="a-row"><span className="muted" style={{ fontSize: 13 }}>Sign in with your staff ID and a 3-second face scan instead of typing a password.</span><button className="btn btn-tonal" onClick={() => setOpen(true)}><span className="icon sm">face</span>Set up face sign-in</button></div>
  );
}
