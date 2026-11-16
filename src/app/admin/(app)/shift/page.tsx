"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, istDateTime, istTime, usePoll } from "@/admin/client";
import { ROLE_LABELS, type Role } from "@/shared/rbac";

type Current = { shift: { id: string; startedAt: string; controlRoom: string } | null; handover: { from: string; endedAt: string | null; notes: string | null; summary: unknown } | null };
type Report = {
  id: string; user: string; controlRoom: string; startedAt: string; endedAt: string | null;
  help: { total: number; closed: number; medical: number }; lost: { total: number; reunited: number }; diversions: { n: number; families: number }; alerts: number;
  registrations: { families?: number; people?: number } | number; series: { at: string; total: number }[]; peak: { at: string; total: number };
  markers: { at: string; label: string }[];
  stillOpen: { help: { id: string; code: string; type: string; location: string | null; status: string }[]; lost: { id: string; code: string; personName: string; age: number | null; status: string; createdAt: string }[] };
  handoverNotes: string | null;
};

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><Shift /></Suspense>;
}

function Shift() {
  const router = useRouter();
  const reportId = useSearchParams().get("report");
  const cur = usePoll<Current>("/api/admin/shifts/current", 30_000);
  const list = usePoll<{ shifts: { id: string; user: string; startedAt: string; endedAt: string | null }[]; staff: { id: string; name: string; role: Role }[] }>("/api/admin/shifts", 60_000);
  const shiftId = reportId ?? cur.data?.shift?.id ?? null;
  const rep = usePoll<Report>(shiftId ? `/api/admin/shifts/${shiftId}/report` : null, 30_000);
  const [room, setRoom] = useState("Sangam Control");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (rep.data?.handoverNotes && !notes) setNotes(""); }, [rep.data, notes]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work." }); } finally { setBusy(false); } };
  const startShift = () => run(async () => { await api("/api/admin/shifts/current", { body: { controlRoom: room } }); await cur.reload(); setMsg({ ok: true, text: "Shift started. Everything you do is in this shift's report." }); });
  const endShift = () => run(async () => {
    await api(`/api/admin/shifts/${shiftId}/end`, { body: { handoverTo: to || null, notes } });
    setMsg({ ok: true, text: to ? "Shift ended and handed over. Your colleague sees your notes when they open Shift." : "Shift ended." });
    await cur.reload(); await list.reload();
    router.replace(`/admin/shift?report=${shiftId}`);
  });

  const r = rep.data;
  const reg = r ? (typeof r.registrations === "number" ? { families: r.registrations, people: 0 } : { families: r.registrations.families ?? 0, people: r.registrations.people ?? 0 }) : { families: 0, people: 0 };
  const viewingOld = Boolean(reportId && reportId !== cur.data?.shift?.id);
  const lakh = (n: number) => (n >= 100_000 ? `${(n / 100_000).toFixed(1).replace(/\.0$/, "")} lakh` : n.toLocaleString("en-IN"));
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  const max = r ? Math.max(1, ...r.series.map((x) => x.total)) : 1;
  const nearMarker = (at: string) => r?.markers.some((m) => Math.abs(+new Date(m.at) - +new Date(at)) < 15 * 60_000) ?? false;
  const toName = list.data?.staff.find((x) => x.id === to)?.name;
  const dots = (a: number, b: number) => <span className="sh-dots" aria-hidden>{Array.from({ length: 12 }, (_, i) => <i key={i} className={b && i < Math.round((a / b) * 12) ? "on" : ""} />)}</span>;

  if (!cur.data) return <div className="a-empty">Loading…</div>;
  if (!cur.data.shift && !viewingOld) return (
    <div className="sh">
      <div className="gd-head" style={{ gridColumn: "1 / -1" }}><h1>Shift report</h1><div className="crumb">You're not on shift</div></div>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`} role="alert" style={{ gridColumn: "1 / -1" }}>{msg.text}</div>}
      <section className="dl-card" style={{ maxWidth: 520 }}>
        <h2>Start your shift</h2>
        <p className="muted" style={{ margin: 0 }}>Starting a shift builds a report of what happened while you were on duty, and lets you hand over to the next person.</p>
        <div className="field"><label htmlFor="room">Command post</label><input id="room" className="input" value={room} maxLength={60} onChange={(e) => setRoom(e.target.value)} /></div>
        <button className="btn btn-filled" disabled={busy || room.trim().length < 2} onClick={startShift}><span className="icon">play_arrow</span> Start shift</button>
      </section>
      <Recent shifts={list.data?.shifts} />
    </div>
  );
  if (!r) return <div className="a-empty">Building report…</div>;
  const open = r.stillOpen.help.length + r.stillOpen.lost.length;

  return (
    <div className="sh">
      <div className="gd-head" style={{ gridColumn: "1 / -1" }}>
        <h1>Shift report</h1>
        <div className="crumb">{r.user} · {hhmm(r.startedAt)} to {r.endedAt ? hhmm(r.endedAt) : "now"} · {r.controlRoom}{viewingOld && <> · <Link href="/admin/shift">Back to my shift</Link></>}</div>
      </div>
      {cur.data.handover && !viewingOld && (
        <div className="banner info no-print" style={{ gridColumn: "1 / -1", alignItems: "flex-start" }}>
          <span className="icon">handshake</span>
          <div><b>Handed over to you by {cur.data.handover.from}</b>{cur.data.handover.endedAt ? ` at ${istTime(cur.data.handover.endedAt)}` : ""}<div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{cur.data.handover.notes || "No notes."}</div></div>
        </div>
      )}
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`} role="alert" style={{ gridColumn: "1 / -1" }}>{msg.text}</div>}
      <div className="sh-main">
        <div><div className="sh-hero">{lakh(r.peak.total)}</div><div className="sh-sub">at the ghats at the busiest moment</div></div>
        <p className="sh-story">{r.help.medical ? `${r.help.medical} medical request${r.help.medical === 1 ? "" : "s"}. ` : "No medical requests. "}Busiest moment: {lakh(r.peak.total)} at once, at {hhmm(r.peak.at)}. {r.diversions.n ? `${r.diversions.n} diversion${r.diversions.n === 1 ? "" : "s"} moved ${r.diversions.families.toLocaleString("en-IN")} families.` : "No diversions were needed."} {reg.families ? `${reg.families.toLocaleString("en-IN")} families registered.` : ""}</p>
        <div className="sh-kpis">
          <Link href="/admin/help" className="sh-kpi"><small>Help requests</small><b>{r.help.closed}/{r.help.total}</b><span>closed</span>{dots(r.help.closed, r.help.total)}</Link>
          <Link href="/admin/lost" className="sh-kpi"><small>Lost people</small><b>{r.lost.reunited}/{r.lost.total}</b><span>reunited</span>{dots(r.lost.reunited, r.lost.total)}</Link>
          <Link href="/admin/diversions" className="sh-kpi"><small>Diversions</small><b>{r.diversions.n}</b><span>· {r.diversions.families.toLocaleString("en-IN")} families</span>{dots(r.diversions.n, Math.max(r.diversions.n, 1))}</Link>
          <Link href="/admin/alerts" className="sh-kpi"><small>Alerts sent</small><b>{r.alerts}</b><span>this shift</span>{dots(r.alerts, Math.max(r.alerts, 1))}</Link>
        </div>
        <section className="dl-card sh-chart" aria-labelledby="sc">
          <div className="a-row" style={{ justifyContent: "space-between" }}><h2 id="sc">Crowd through the shift</h2>{r.series.length > 1 && <span style={{ color: "var(--primary)" }}>Peak {hhmm(r.peak.at)}</span>}</div>
          {r.series.length < 2 ? <div className="muted">Not enough readings yet. The chart fills in every 15 minutes.</div> : (
            <>
              <div className="sh-bars" role="img" aria-label={`People at all ghats every 15 minutes. Peak ${r.peak.total.toLocaleString("en-IN")} at ${hhmm(r.peak.at)}.`}>
                {r.series.map((x) => <i key={x.at} title={`${hhmm(x.at)} · ${x.total.toLocaleString("en-IN")}`} className={x.at === r.peak.at ? "peak" : nearMarker(x.at) ? "mark" : ""} style={{ height: `${(x.total / max) * 100}%` }} />)}
              </div>
              <div className="sh-axis">{[0, Math.floor(r.series.length / 2), r.series.length - 1].map((i) => <span key={i}>{hhmm(r.series[i].at)}</span>)}</div>
            </>
          )}
          {r.markers.length > 0 && <div className="fm-chips">{r.markers.slice(0, 6).map((m, i) => <span key={i} className="chip mono">{hhmm(m.at)} · {m.label}</span>)}</div>}
        </section>
      </div>

      <aside className="dl-card sh-hand" aria-labelledby="ho">
        <h2 id="ho" style={{ fontSize: 26 }}>{r.endedAt ? "Handed over" : "Hand over"}</h2>
        {!r.endedAt && !viewingOld && (
          <div className="field"><label htmlFor="to">To</label>
            <select id="to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Nobody (just end the shift)</option>
              {list.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {ROLE_LABELS[s.role]}</option>)}
            </select></div>
        )}
        <small className="muted">Still open</small>
        {open === 0 && <div className="sh-open">Nothing open.</div>}
        {r.stillOpen.help.map((h) => <Link key={h.id} href="/admin/help" className="sh-open"><span className="icon">{h.type === "medical" ? "medical_services" : h.type === "wheelchair" ? "accessible" : "support_agent"}</span><span><b>{h.type.replace("_", " ")}, {h.code}</b><small>{h.location ?? ""} · {h.status.replace("_", " ")}</small></span></Link>)}
        {r.stillOpen.lost.map((l) => <Link key={l.id} href={`/admin/lost?q=${l.code}`} className="sh-open"><span className="icon">person_search</span><span><b>{l.personName}{l.age !== null ? `, ${l.age}` : ""}, {l.code}</b><small>{l.status} · since {hhmm(l.createdAt)}</small></span></Link>)}
        {r.endedAt ? (r.handoverNotes && <><small className="muted">Notes</small><div className="sh-notes">{r.handoverNotes}</div></>) : !viewingOld && (
          <div className="field"><label htmlFor="notes">Notes for {toName?.split(" ")[0] ?? "the next shift"}</label><textarea id="notes" className="input" rows={6} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to watch, what's promised, who to call." /></div>
        )}
        <div style={{ flex: 1 }} />
        {!r.endedAt && !viewingOld && cur.data.shift && <button className="btn btn-filled no-print" disabled={busy} onClick={endShift}><span className="icon sm">logout</span>{to ? "End shift and hand over" : "End shift"}</button>}
        <button className="btn btn-text no-print" onClick={() => print()}><span className="icon sm">download</span>Download report (PDF)</button>
      </aside>
      <Recent shifts={list.data?.shifts} />
    </div>
  );
}

function Recent({ shifts }: { shifts?: { id: string; user: string; startedAt: string; endedAt: string | null }[] }) {
  if (!shifts?.length) return null;
  return (
    <section className="dl-card no-print" style={{ gridColumn: "1 / -1" }}>
      <h2>Recent shifts</h2>
      <table className="a-table"><thead><tr><th>Who</th><th>Started</th><th>Ended</th><th /></tr></thead>
        <tbody>{shifts.map((s) => <tr key={s.id}><td>{s.user}</td><td>{istDateTime(s.startedAt)}</td><td>{s.endedAt ? istDateTime(s.endedAt) : <span className="chip good">On duty</span>}</td><td><Link className="btn btn-text small" href={`/admin/shift?report=${s.id}`}>Report</Link></td></tr>)}</tbody></table>
    </section>
  );
}
