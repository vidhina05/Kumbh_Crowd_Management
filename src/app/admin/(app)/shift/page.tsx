"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, istDateTime, istTime, usePoll } from "@/admin/client";
import { LineChart } from "@/admin/charts";
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
  const reg = r ? (typeof r.registrations === "number" ? r.registrations : r.registrations.families ?? 0) : 0;
  const viewingOld = Boolean(reportId && reportId !== cur.data?.shift?.id);

  return (
    <>
      <div className="a-row no-print">
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>{viewingOld ? "Shift report" : "My shift"}</h1>
        {r && <button className="btn btn-tonal" onClick={() => print()}><span className="icon">print</span> Print report</button>}
        {viewingOld && <Link className="btn btn-text" href="/admin/shift">Back to my shift</Link>}
      </div>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`} role="alert">{msg.text}</div>}
      {cur.data?.handover && !viewingOld && (
        <div className="banner info" style={{ alignItems: "flex-start" }}>
          <span className="icon">handshake</span>
          <div><b>Handed over to you by {cur.data.handover.from}</b>{cur.data.handover.endedAt ? ` at ${istTime(cur.data.handover.endedAt)}` : ""}<div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{cur.data.handover.notes || "No notes."}</div></div>
        </div>
      )}
      {!cur.data ? <div className="a-empty">Loading…</div> : !cur.data.shift && !viewingOld ? (
        <section className="glass a-pane" style={{ maxWidth: 520 }}>
          <h2>Start your shift</h2>
          <p className="muted" style={{ margin: 0 }}>Starting a shift builds a report of what happened while you were on duty, and lets you hand over to the next person.</p>
          <div className="field"><label htmlFor="room">Control room</label><input id="room" className="input" value={room} maxLength={60} onChange={(e) => setRoom(e.target.value)} /></div>
          <button className="btn btn-filled" disabled={busy || room.trim().length < 2} onClick={startShift}><span className="icon">play_arrow</span> Start shift</button>
        </section>
      ) : !r ? <div className="a-empty">Building report…</div> : (
        <>
          <div className="muted">{r.user} · {r.controlRoom} · {istDateTime(r.startedAt)} – {r.endedAt ? istDateTime(r.endedAt) : "now"}</div>
          <div className="a-kpis">
            <div className="a-kpi"><div className="l">Peak crowd</div><div className="v">{r.peak.total.toLocaleString("en-IN")}</div><div className="l">at {istTime(r.peak.at)}</div></div>
            <div className="a-kpi"><div className="l">Help requests</div><div className="v">{r.help.total}</div><div className="l">{r.help.closed} closed · {r.help.medical} medical</div></div>
            <div className="a-kpi"><div className="l">Lost people</div><div className="v">{r.lost.total}</div><div className="l">{r.lost.reunited} reunited</div></div>
            <div className="a-kpi"><div className="l">Diversions sent</div><div className="v">{r.diversions.n}</div><div className="l">{r.diversions.families} families moved</div></div>
            <div className="a-kpi"><div className="l">Registrations</div><div className="v">{reg.toLocaleString("en-IN")}</div><div className="l">families</div></div>
            <div className="a-kpi"><div className="l">Alerts raised</div><div className="v">{r.alerts}</div></div>
          </div>
          <div className="a-split">
            <section className="glass a-pane">
              <h2>People at all ghats during the shift</h2>
              {r.series.length > 1 ? <LineChart history={r.series.map((s) => ({ at: s.at, occupancy: s.total }))} capacity={Math.max(...r.series.map((s) => s.total)) * 1.2} safeLimitPct={100} height={200} /> : <div className="muted">Not enough readings yet. The chart fills in every 15 minutes.</div>}
              {r.markers.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{r.markers.map((m, i) => <li key={i}>{istTime(m.at)} · {m.label}</li>)}</ul>}
            </section>
            <div style={{ display: "grid", gap: 16 }}>
              <section className="glass a-pane">
                <h2>Still open for the next shift</h2>
                {r.stillOpen.help.length + r.stillOpen.lost.length === 0 && <div className="muted">Nothing open.</div>}
                {r.stillOpen.lost.map((l) => <Link key={l.id} href="/admin/lost" className="a-row" style={{ color: "inherit" }}><span className="chip bad">{l.code}</span> {l.personName}{l.age !== null ? `, ${l.age}` : ""} · {l.status}</Link>)}
                {r.stillOpen.help.map((h) => <Link key={h.id} href="/admin/help" className="a-row" style={{ color: "inherit" }}><span className="chip">{h.code}</span> {h.type.replace("_", " ")} · {h.status}{h.location ? ` · ${h.location}` : ""}</Link>)}
              </section>
              {!viewingOld && cur.data?.shift && !r.endedAt && (
                <section className="glass a-pane no-print">
                  <h2>End shift and hand over</h2>
                  <div className="field"><label htmlFor="to">Hand over to</label>
                    <select id="to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                      <option value="">Nobody (just end the shift)</option>
                      {list.data?.staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {ROLE_LABELS[s.role]}</option>)}
                    </select></div>
                  <div className="field"><label htmlFor="notes">Notes for them</label><textarea id="notes" className="input" rows={4} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What to watch, what's promised, who to call." /></div>
                  <button className="btn btn-filled" disabled={busy} onClick={endShift}><span className="icon">logout</span> End shift</button>
                </section>
              )}
              {r.endedAt && r.handoverNotes && <section className="glass a-pane"><h2>Handover notes</h2><div style={{ whiteSpace: "pre-wrap" }}>{r.handoverNotes}</div></section>}
            </div>
          </div>
        </>
      )}
      {list.data && list.data.shifts.length > 0 && (
        <section className="glass a-pane no-print">
          <h2>Recent shifts</h2>
          <table className="a-table"><thead><tr><th>Who</th><th>Started</th><th>Ended</th><th /></tr></thead>
            <tbody>{list.data.shifts.map((s) => <tr key={s.id}><td>{s.user}</td><td>{istDateTime(s.startedAt)}</td><td>{s.endedAt ? istDateTime(s.endedAt) : <span className="chip good">On duty</span>}</td><td><Link className="btn btn-text small" href={`/admin/shift?report=${s.id}`}>Report</Link></td></tr>)}</tbody></table>
        </section>
      )}
    </>
  );
}
