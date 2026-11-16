"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, istTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";

type G = { id: string; name: string; gate: string; percent: number; source: string; safeLimitPct: number };
type Detail = {
  id: string; code: string; status: string; day: string; reason: string; from: G; to: G; familiesPlanned: number; peoplePlanned: number;
  projection: { batches?: number[]; fromBefore?: number; fromAfter?: number; toBefore?: number; toAfter?: number };
  createdBy: string; createdById: string; approvedBy: string | null; approvedAt: string | null; sentAt: string | null; undoneAt: string | null;
  stats: { families: number; confirmed: number; smsSent: number; smsNotConnected: number; people: number };
  events: { at: string; kind: string; message: string; by: string | null }[];
};
const LABEL: Record<string, [string, string]> = { awaiting_approval: ["Waiting for second check", "warn"], sent: ["Sent to families", "good"], rejected: ["Rejected", ""], undone: ["Undone", ""] };

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><DiversionView /></Suspense>;
}

function DiversionView() {
  const id = useSearchParams().get("id");
  const { me, can } = useMe();
  const { data, error, reload } = usePoll<Detail>(id ? `/api/admin/diversions/${encodeURIComponent(id)}` : null, 5_000);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);

  if (!id) return <div className="banner warn">No diversion chosen. <Link href="/admin/diversions">See all diversions</Link>.</div>;
  if (error && !data) return <div className="banner bad" role="alert">{error}</div>;
  if (!data) return <div className="a-empty" aria-busy="true">Loading diversion…</div>;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); setPassword(""); setCode(""); await reload(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work." }); }
    finally { setBusy(false); setConfirmUndo(false); }
  };
  const approve = (e: React.FormEvent) => { e.preventDefault(); void act(() => api(`/api/admin/diversions/${data.id}/approve`, { body: { email, password, ...(code ? { code } : {}) } }), "Approved and sent. Families are being told now."); };
  const pct = data.stats.families ? Math.round((data.stats.confirmed / data.stats.families) * 100) : 0;
  const [label, chip] = LABEL[data.status] ?? [data.status, ""];

  return (
    <>
      <div className="a-row">
        <Link className="icon-btn" href="/admin/diversions" aria-label="Back"><span className="icon">arrow_back</span></Link>
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Diversion <span className="mono">{data.code}</span></h1>
        <span className={`chip ${chip}`}>{label}</span>
      </div>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`} role={msg.ok ? "status" : "alert"}><span className="icon">{msg.ok ? "check_circle" : "error"}</span> {msg.text}</div>}

      <div className="a-kpis">
        <div className="a-kpi"><div className="l">From</div><div className="v" style={{ fontSize: 22 }}>{data.from.name}</div><div className="l">now {data.from.percent}% · {data.from.gate}</div></div>
        <div className="a-kpi"><div className="l">To</div><div className="v" style={{ fontSize: 22 }}>{data.to.name}</div><div className="l">now {data.to.percent}% · {data.to.gate}</div></div>
        <div className="a-kpi"><div className="l">Families · people</div><div className="v">{data.familiesPlanned} · {data.peoplePlanned}</div><div className="l">batches {data.projection.batches?.join(", ") ?? "—"}</div></div>
        <div className="a-kpi"><div className="l">Families who&apos;ve seen it</div><div className="v">{data.stats.confirmed} / {data.stats.families}</div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${pct}%` }} /></div></div>
        <div className="a-kpi"><div className="l">SMS</div><div className="v">{data.stats.smsSent}</div><div className="l">{data.stats.smsNotConnected ? `${data.stats.smsNotConnected} not sent: SMS isn't connected` : "sent"}</div></div>
      </div>

      <div className="a-split">
        <section className="glass a-pane">
          {data.status === "awaiting_approval" && (
            <>
              <h2>Second check</h2>
              <p className="muted" style={{ margin: 0 }}>A different staff member who can approve diversions signs in here, on this console, to confirm. {data.createdById === me.id ? "You made this plan, so someone else must approve it." : ""}</p>
              {can("diversions.create") && (
                <form onSubmit={approve} style={{ display: "grid", gap: 12, maxWidth: 420 }} autoComplete="off">
                  <div className="field"><label htmlFor="ap-email">Approver&apos;s work email</label><input id="ap-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
                  <div className="field"><label htmlFor="ap-pw">Approver&apos;s password</label><input id="ap-pw" className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
                  <div className="field"><label htmlFor="ap-code">6-digit code (only if they use two-step sign-in)</label><input id="ap-code" className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></div>
                  <div className="a-row">
                    <button className="btn btn-filled" disabled={busy || !email || !password}><span className="icon">verified_user</span> {busy ? "Checking…" : "Approve and send"}</button>
                    <button type="button" className="btn btn-text" disabled={busy} onClick={() => act(() => api(`/api/admin/diversions/${data.id}/reject`, { body: {} }), "Rejected. Nothing was sent.")}>Reject</button>
                  </div>
                </form>
              )}
            </>
          )}
          {data.status === "sent" && (
            <>
              <h2>Live</h2>
              <p style={{ margin: 0 }}>Families in these batches now have <b>{data.to.name}</b> on their pass. Kiosks show the change when they look themselves up, and they can tap &ldquo;I&apos;ve seen the change&rdquo;.</p>
              {can("diversions.create") && !confirmUndo && <button className="btn btn-tonal" onClick={() => setConfirmUndo(true)}><span className="icon">undo</span> Undo this diversion</button>}
              {confirmUndo && (
                <div className="banner warn" role="alertdialog" aria-label="Confirm undo">
                  <span className="icon">undo</span>
                  <span style={{ flex: 1 }}>Move all {data.stats.families} families back to {data.from.name}? They&apos;ll be told again.</span>
                  <button className="btn btn-filled small" disabled={busy} onClick={() => act(() => api(`/api/admin/diversions/${data.id}/undo`, { body: {} }), "Undone. Families are back on their first ghat.")}>Yes, undo</button>
                  <button className="btn btn-text small" onClick={() => setConfirmUndo(false)}>Cancel</button>
                </div>
              )}
            </>
          )}
          {(data.status === "undone" || data.status === "rejected") && <div className="banner info"><span className="icon">info</span> This diversion is {data.status}. Nothing is active.</div>}
          {data.reason && <div className="muted" style={{ fontSize: 13 }}>Reason: {data.reason}</div>}
          <div className="muted" style={{ fontSize: 13 }}>Planned by {data.createdBy}{data.approvedBy ? ` · approved by ${data.approvedBy} at ${istTime(data.approvedAt!)}` : ""}</div>
        </section>
        <section className="glass a-pane" aria-labelledby="log-h">
          <h2 id="log-h">Log</h2>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10 }}>
            {data.events.map((e, i) => <li key={i}><b>{istTime(e.at)}</b> · {e.message}{e.by ? <span className="muted"> · {e.by}</span> : null}</li>)}
          </ol>
        </section>
      </div>
    </>
  );
}
