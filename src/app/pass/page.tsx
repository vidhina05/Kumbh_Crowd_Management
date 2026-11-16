"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

type Pass = {
  passCode: string; leaderName: string; phoneLast4: string; meetingPoint: string; slotChangesLeft: number;
  slot: { day: string; start: string; end: string; batchNo: number };
  ghat: { name: string; nameHi: string; gate: string; walkNote: string };
  members: { name: string; age: number; relation: string; hasBand: boolean }[];
};
type Res = { pass: Pass; diversion: { code: string; fromGhat: string; confirmed: boolean } | null };

/** Pilgrim's own phone: see the latest pass (including any ghat change) with the pass number + last 4 phone digits. */
export default function Page() {
  return <Suspense fallback={null}><PublicPass /></Suspense>;
}

function PublicPass() {
  const qs = useSearchParams();
  const [code, setCode] = useState((qs.get("p") ?? "").toUpperCase());
  const [last4, setLast4] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (confirm = false) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/public/pass", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passCode: code.trim(), last4, confirm }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error?.message ?? "We couldn't find that pass.");
      setRes(body as Res);
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "start center", padding: "32px 16px" }}>
      <div style={{ width: "min(480px, 100%)", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--primary)", color: "var(--on-primary)", display: "grid", placeItems: "center" }}><span className="icon">waves</span></div>
          <div><b>Sangam Seva</b><div className="muted" style={{ fontSize: 12 }}>My pass · मेरा पास</div></div>
        </div>
        {!res ? (
          <form className="glass" style={{ padding: 24, display: "grid", gap: 14 }} onSubmit={(e) => { e.preventDefault(); void call(); }}>
            <h1 style={{ margin: 0, fontWeight: 400, fontSize: 24 }}>See your pass <span className="muted" style={{ fontSize: 16 }}>· अपना पास देखें</span></h1>
            <div className="field"><label htmlFor="p">Pass number · पास नंबर</label><input id="p" className="input mono" required minLength={5} maxLength={20} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KMB-…" autoComplete="off" /></div>
            <div className="field"><label htmlFor="l4">Last 4 digits of your phone · फ़ोन के आख़िरी 4 अंक</label><input id="l4" className="input mono" required inputMode="numeric" pattern="\d{4}" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ letterSpacing: 8, fontSize: 20 }} /></div>
            {err && <div className="banner bad" role="alert"><span className="icon">error</span> {err}</div>}
            <button className="btn btn-filled" style={{ height: 52 }} disabled={busy || last4.length !== 4 || code.trim().length < 5}>{busy ? "Looking…" : "Show my pass · पास दिखाएँ"}</button>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Both are printed on your pass and in the SMS. Lost? Go to any kiosk or volunteer.</p>
          </form>
        ) : (
          <>
            {res.diversion && !res.diversion.confirmed && (
              <div className="banner warn" role="alert" style={{ alignItems: "flex-start" }}>
                <span className="icon">alt_route</span>
                <div style={{ display: "grid", gap: 8 }}>
                  <b>Your ghat has changed · आपका घाट बदल गया है</b>
                  <span>For everyone&apos;s safety your batch moved from <b>{res.diversion.fromGhat}</b> to <b>{res.pass.ghat.name}</b>. Your time stays {res.pass.slot.start}–{res.pass.slot.end}.</span>
                  <button className="btn btn-filled" disabled={busy} onClick={() => call(true)}>I&apos;ve seen the change · मैंने देख लिया</button>
                </div>
              </div>
            )}
            {res.diversion?.confirmed && <div className="banner good"><span className="icon">check_circle</span> Thank you. The volunteers know you&apos;re coming to {res.pass.ghat.name}.</div>}
            <section className="glass" style={{ padding: 24, display: "grid", gap: 10 }}>
              <span className="muted mono">Pass · {res.pass.passCode}</span>
              <b style={{ fontSize: 26, fontWeight: 400 }}>{res.pass.ghat.name} <span className="muted" style={{ fontSize: 18 }}>· {res.pass.ghat.nameHi}</span></b>
              <span style={{ fontSize: 18 }}>{res.pass.ghat.gate} · {res.pass.slot.day} · {res.pass.slot.start}–{res.pass.slot.end} · batch {res.pass.slot.batchNo}</span>
              <span className="muted">{res.pass.ghat.walkNote}</span>
              <div className="banner info"><span className="icon">location_on</span> If separated, meet at: <b>{res.pass.meetingPoint}</b></div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{res.pass.members.map((m, i) => <li key={i}>{m.name}, {m.age}{m.hasBand ? " · wristband" : ""}</li>)}</ul>
            </section>
            <button className="btn btn-text" onClick={() => { setRes(null); setLast4(""); }}>Look up another pass</button>
          </>
        )}
        <Link href="/" className="muted" style={{ fontSize: 12, textAlign: "center" }}>Sangam Seva home</Link>
      </div>
    </main>
  );
}
