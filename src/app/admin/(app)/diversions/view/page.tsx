"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, istTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { crowdColor } from "@/admin/types";

type G = { id: string; name: string; gate: string; percent: number; source: string; safeLimitPct: number };
type Detail = {
  id: string; code: string; status: string; day: string; reason: string; from: G; to: G; familiesPlanned: number; peoplePlanned: number;
  projection: { batches?: number[]; fromBefore?: number; fromAfter?: number; toBefore?: number; toAfter?: number };
  createdBy: string; createdById: string; approvedBy: string | null; approvedAt: string | null; sentAt: string | null; undoneAt: string | null;
  stats: { families: number; confirmed: number; smsSent: number; smsNotConnected: number; people: number };
  events: { at: string; kind: string; message: string; by: string | null }[];
};
type GhatDetail = { ghat: { capacity: number; safeLimitPct: number; percent: number }; history: { at: string; occupancy: number }[]; projection: { at: string; occupancy: number }[] };
const EVENT_ICON: Record<string, string> = { created: "edit_note", approved: "verified_user", sent: "send", notified: "sms", reminded: "notifications_active", rejected: "block", undone: "undo", confirmed: "done_all" };

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><DiversionLive /></Suspense>;
}

/** Figma "Admin / 07 Diversion live". */
function DiversionLive() {
  const id = useSearchParams().get("id");
  const { me, can } = useMe();
  const { data, error, reload } = usePoll<Detail>(id ? `/api/admin/diversions/${encodeURIComponent(id)}` : null, 5_000);
  const src = usePoll<GhatDetail>(data ? `/api/admin/ghats/${data.from.id}/detail` : null, 15_000);
  const [ap, setAp] = useState({ email: "", password: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  if (!id) return <div className="banner warn">No diversion chosen. <Link href="/admin/diversions">See all diversions</Link>.</div>;
  if (error && !data) return <div className="banner bad" role="alert">{error}</div>;
  if (!data) return <div className="a-empty" aria-busy="true">Loading diversion…</div>;

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { const text = await fn(); setToast({ ok: true, text }); await reload(); }
    catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "That didn't work." }); }
    finally { setBusy(false); setUndoOpen(false); }
  };
  const pct = data.stats.families ? Math.round((data.stats.confirmed / data.stats.families) * 100) : 0;
  const waiting = data.stats.families - data.stats.confirmed;
  const liveMin = data.sentAt ? Math.max(0, Math.round((Date.now() - new Date(data.sentAt).getTime()) / 60_000)) : 0;
  const trend = src.data && src.data.history.length > 2 ? src.data.history[src.data.history.length - 1].occupancy - src.data.history[src.data.history.length - 3].occupancy : 0;
  const watch = data.status === "sent" ? (data.from.percent >= data.from.safeLimitPct ? `Watch · ${data.from.name} ${trend < 0 ? "falling" : "still high"}, ${data.from.percent}%` : `On track · ${data.from.name} ${data.from.percent}%`) : data.status === "awaiting_approval" ? "Waiting for a second check" : data.status === "undone" ? "Undone" : "Rejected";
  const target = data.projection.toAfter ?? null;
  const segs = 60;

  return (
    <div className="dl">
      <div className="dl-head">
        <div className="a-tabs-sec" role="tablist"><Link role="tab" aria-selected={false} href="/admin/batches">Plan</Link><Link role="tab" aria-selected href={`/admin/diversions/view?id=${data.id}`}>Live diversion</Link></div>
        <span className={`dl-watch ${data.status}`}><i />{watch}</span>
        <div className="crumb">{data.from.name} to {data.to.name} · {data.sentAt ? `sent ${istTime(data.sentAt)}` : "not sent yet"} by {data.createdBy}{data.approvedBy ? ` · checked by ${data.approvedBy}` : ""} · <span className="mono">{data.code}</span></div>
      </div>

      <section className="dl-card dl-confirm">
        {data.status === "awaiting_approval" ? (
          <>
            <h2>Second check</h2>
            <p className="muted" style={{ margin: 0 }}>A different staff member who can approve diversions signs in here to confirm. {data.createdById === me.id ? "You made this plan, so someone else must approve it." : ""} Nothing has been sent yet.</p>
            {can("diversions.create") && (
              <form className="dl-approve" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api(`/api/admin/diversions/${data.id}/approve`, { body: { email: ap.email, password: ap.password, ...(ap.code ? { code: ap.code } : {}) } }); setAp({ email: "", password: "", code: "" }); return "Approved and sent. Families are being told now."; }); }}>
                <input id="ap-email" className="input" type="email" required placeholder="Approver's work email" value={ap.email} onChange={(e) => setAp({ ...ap, email: e.target.value })} aria-label="Approver's work email" />
                <input id="ap-pw" className="input" type="password" required placeholder="Their PIN or password" value={ap.password} onChange={(e) => setAp({ ...ap, password: e.target.value })} aria-label="Approver's password" autoComplete="new-password" />
                <input id="ap-code" className="input mono" inputMode="numeric" maxLength={6} placeholder="6-digit code, if they use one" value={ap.code} onChange={(e) => setAp({ ...ap, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} aria-label="Approver's 6-digit code" />
                <div className="a-row"><button className="btn btn-filled" disabled={busy || !ap.email || !ap.password}><span className="icon sm">verified_user</span>{busy ? "Checking…" : "Approve and send"}</button>
                  <button type="button" className="btn btn-text" disabled={busy} onClick={() => act(async () => { await api(`/api/admin/diversions/${data.id}/reject`, { body: {} }); return "Rejected. Nothing was sent."; })}>Reject</button></div>
              </form>
            )}
          </>
        ) : (
          <>
            <div className="a-row" style={{ justifyContent: "space-between" }}><h2>Families who confirmed</h2>{data.status === "sent" && <span className="chip brand"><span className="icon sm">check</span>Live · {liveMin} min</span>}</div>
            <div className="dl-big"><b>{pct}%</b><span><span className="n">{data.stats.confirmed.toLocaleString("en-IN")} of {data.stats.families.toLocaleString("en-IN")}</span><small>{waiting.toLocaleString("en-IN")} still to confirm</small></span></div>
            <div className="dl-segs" aria-hidden="true">{Array.from({ length: segs }, (_, i) => <i key={i} className={i < Math.round((pct / 100) * segs) ? "on" : ""} />)}</div>
            <div className="dl-stats">
              <div><span className="icon sm">sms</span><b>{data.stats.smsSent.toLocaleString("en-IN")}</b><small>{data.stats.smsNotConnected ? "SMS (not connected)" : "SMS delivered"}</small></div>
              <div><span className="icon sm">done_all</span><b>{data.stats.confirmed.toLocaleString("en-IN")}</b><small>Seen at kiosk or pass page</small></div>
              <div><span className="icon sm">groups</span><b>{data.stats.people.toLocaleString("en-IN")}</b><small>People moved</small></div>
              <div><span className="icon sm">view_timeline</span><b>{data.projection.batches?.length ?? 0}</b><small>Batches {data.projection.batches?.join(", ")}</small></div>
            </div>
          </>
        )}
      </section>

      <section className="dl-card dl-time" aria-labelledby="tl-h">
        <div className="a-row" style={{ justifyContent: "space-between" }}><h2 id="tl-h">Timeline</h2><Link className="btn btn-text small" href="/admin/audit">Full log</Link></div>
        <ol>{data.events.map((e, i) => <li key={i}><time>{istTime(e.at)}</time><span className="dot"><span className="icon sm">{EVENT_ICON[e.kind] ?? "circle"}</span></span><span><b>{e.message}</b>{e.by && <small>{e.by}</small>}</span></li>)}</ol>
      </section>

      <section className="dl-card" aria-labelledby="load-h">
        <div className="a-row" style={{ justifyContent: "space-between" }}><h2 id="load-h">{data.from.name} load</h2><span style={{ color: crowdColor(data.from.percent, data.from.safeLimitPct), fontSize: 13 }}>{data.from.percent}% and {trend < 0 ? "falling" : trend > 0 ? "rising" : "steady"}</span></div>
        {src.data ? <LoadChart d={src.data} sentAt={data.sentAt} /> : <div className="a-empty">Loading…</div>}
      </section>

      <section className="dl-card dl-target" aria-labelledby="to-h">
        <h2 id="to-h">{data.to.name}</h2>
        <div className="dl-ring-row">
          <div className="dl-ring" style={{ ["--p" as string]: `${Math.min(100, data.to.percent)}`, ["--c" as string]: crowdColor(data.to.percent, data.to.safeLimitPct) }}><b>{data.to.percent}%</b><small>{target !== null ? `target ${target}%` : `${data.to.gate}`}</small></div>
          <div><b>{data.to.percent < data.to.safeLimitPct ? "Filling as planned" : "Near its limit"}</b><p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>{data.status === "sent" ? `Families in batches ${data.projection.batches?.join(", ")} now come here at the same times through ${data.to.gate}.` : "Nothing has moved here yet."} Safe limit {data.to.safeLimitPct}%.</p></div>
        </div>
        <div style={{ flex: 1 }} />
        {data.status === "sent" && can("diversions.create") && (
          <div className="a-row">
            <button className="btn btn-filled" disabled={busy || waiting === 0} onClick={() => act(async () => { const r = await api<{ pending: number; sent: number; notConnected: number }>(`/api/admin/diversions/${data.id}/remind`, { body: {} }); return r.sent ? `Reminder sent to ${r.sent} families.` : `${r.pending} families still to confirm. SMS isn't connected, so they'll see it at kiosks and on their pass page.`; })}><span className="icon sm">notifications_active</span>Remind {waiting.toLocaleString("en-IN")} families</button>
            <button className="btn btn-outlined" disabled={busy} onClick={() => setUndoOpen(true)}><span className="icon sm">undo</span>Undo diversion</button>
          </div>
        )}
        {(data.status === "undone" || data.status === "rejected") && <div className="banner info"><span className="icon">info</span> This diversion is {data.status}. Nothing is active.</div>}
      </section>

      {undoOpen && (
        <div className="dialog-scrim" role="presentation" onClick={() => setUndoOpen(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="undo-t" onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: "center", color: "var(--primary)" }}><span className="icon">undo</span></div>
            <h2 id="undo-t">Undo this diversion?</h2>
            <div className="muted" style={{ fontSize: 15 }}>All {data.stats.families.toLocaleString("en-IN")} families go back to {data.from.name}, which is at {data.from.percent}% now. They&apos;ll be told again.</div>
            <div className="actions"><button className="btn btn-text" onClick={() => setUndoOpen(false)}>Keep it</button><button className="btn btn-filled" disabled={busy} onClick={() => act(async () => { await api(`/api/admin/diversions/${data.id}/undo`, { body: {} }); return "Undone. Families are back on their first ghat."; })}>Yes, undo</button></div>
          </div>
        </div>
      )}
      {toast && <div className={`a-snack${toast.ok ? "" : " bad"}`} role={toast.ok ? "status" : "alert"}>{toast.text}</div>}
    </div>
  );
}

function LoadChart({ d, sentAt }: { d: GhatDetail; sentAt: string | null }) {
  const cap = d.ghat.capacity;
  const pts = [...d.history.map((h) => ({ ...h, f: false })), ...d.projection.slice(1).map((p) => ({ ...p, f: true }))];
  if (pts.length < 2) return <div className="a-empty">Not enough readings yet.</div>;
  const t0 = new Date(pts[0].at).getTime(), t1 = new Date(pts[pts.length - 1].at).getTime();
  const pcts = pts.map((p) => (p.occupancy / cap) * 100);
  const lo = Math.max(0, Math.floor((Math.min(...pcts, d.ghat.safeLimitPct) - 10) / 10) * 10), hi = Math.min(120, Math.ceil((Math.max(...pcts, d.ghat.safeLimitPct) + 5) / 10) * 10);
  const W = 520, H = 210, L = 36;
  const x = (at: string) => L + ((new Date(at).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L);
  const y = (pct: number) => 8 + (1 - (pct - lo) / Math.max(1, hi - lo)) * (H - 30);
  const past = pts.filter((p) => !p.f), fut = [past[past.length - 1], ...pts.filter((p) => p.f)];
  const path = (a: typeof pts) => a.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y((p.occupancy / cap) * 100).toFixed(1)}`).join(" ");
  const last = past[past.length - 1];
  const ticks = Array.from({ length: Math.floor((hi - lo) / 10) + 1 }, (_, i) => lo + i * 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dl-chart" role="img" aria-label={`Load from ${Math.round(pcts[0])}% to ${Math.round((last.occupancy / cap) * 100)}% now.`}>
      {ticks.map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="ax">{v}%</text></g>)}
      <line x1={L} x2={W} y1={y(d.ghat.safeLimitPct)} y2={y(d.ghat.safeLimitPct)} stroke="var(--crowd-critical)" strokeWidth="1" />
      <text x={W} y={y(d.ghat.safeLimitPct) - 4} textAnchor="end" className="ax" style={{ fill: "var(--crowd-critical)" }}>Safe limit {d.ghat.safeLimitPct}%</text>
      <path d={`${path(past)} L${x(last.at)},${H - 22} L${L},${H - 22} Z`} fill="var(--crowd-high)" opacity=".18" />
      <path d={path(past)} fill="none" stroke="var(--crowd-high)" strokeWidth="2.5" />
      <path d={path(fut)} fill="none" stroke="var(--secondary, #773fbe)" strokeWidth="2" strokeDasharray="5 5" />
      <circle cx={x(last.at)} cy={y((last.occupancy / cap) * 100)} r="4.5" fill="var(--crowd-high)" />
      {sentAt && new Date(sentAt).getTime() > t0 && <line x1={x(sentAt)} x2={x(sentAt)} y1={8} y2={H - 22} stroke="var(--primary)" strokeDasharray="2 3" />}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={L + f * (W - L)} y={H - 6} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} className="ax">{istTime(new Date(t0 + (t1 - t0) * f))}</text>)}
    </svg>
  );
}
