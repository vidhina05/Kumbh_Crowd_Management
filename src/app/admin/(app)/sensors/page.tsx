"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ago, api, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import type { Live } from "@/admin/types";

type Sensor = { id: string; name: string; kind: string; ghatId: string; ghatName: string; gateId: string | null; gateName: string | null; active: boolean; simulated: boolean; lastSeenAt: string | null; lastReading: Record<string, number> | null; readingsLastHour: number; status: string };
const KIND: Record<string, string> = { gate_counter: "Gate counter (in/out)", zone_counter: "Zone counter (whole ghat)", camera_counter: "Camera counter (people in view)" };

export default function Sensors() {
  const { can } = useMe();
  const { data, error, reload } = usePoll<{ sensors: Sensor[]; gates: { id: string; ghatId: string; name: string }[] }>("/api/admin/sensors", 15_000);
  const live = usePoll<Live>("/api/admin/live", 60_000);
  const [filter, setFilter] = useState<"all" | "real" | "simulated" | "offline">("all");
  const [form, setForm] = useState({ name: "", kind: "camera_counter", ghatId: "", gateId: "" });
  const [secret, setSecret] = useState<{ id: string; key: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (data?.sensors ?? []).filter((s) => filter === "all" || (filter === "real" ? !s.simulated : filter === "simulated" ? s.simulated : s.status !== "online")), [data, filter]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); await reload(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work." }); } finally { setBusy(false); } };
  const create = (e: React.FormEvent) => { e.preventDefault(); void run(async () => {
    const r = await api<{ id: string; key: string }>("/api/admin/sensors", { body: { name: form.name.trim(), kind: form.kind, ghatId: form.ghatId, gateId: form.gateId || null } });
    setSecret(r); setForm({ name: "", kind: form.kind, ghatId: form.ghatId, gateId: "" });
  }); };
  const counts = { real: data?.sensors.filter((s) => !s.simulated).length ?? 0, sim: data?.sensors.filter((s) => s.simulated).length ?? 0, off: data?.sensors.filter((s) => s.status !== "online").length ?? 0 };

  return (
    <>
      <div className="a-row">
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Crowd sensors</h1>
        <Link className="btn btn-tonal" href="/camera" target="_blank"><span className="icon">videocam</span> Open camera counter</Link>
      </div>
      <div className="banner info" style={{ fontSize: 13 }}><span className="icon sm">info</span>
        <span>Devices post readings to <code className="mono">/api/sensors/ingest</code> with their own key. Gate counters send people in/out per minute, zone counters send the whole ghat&apos;s count, and camera counters (any phone or laptop running the camera page) send how many people they see. <b>Simulated</b> sensors are the training simulator; a real reading always wins.</span>
      </div>
      {msg && <div className={`banner ${msg.ok ? "good" : "bad"}`} role="alert">{msg.text}</div>}
      {secret && (
        <div className="banner warn" role="status" style={{ alignItems: "flex-start" }}>
          <span className="icon">key</span>
          <div style={{ flex: 1, display: "grid", gap: 6 }}>
            <b>Copy this key now. It won&apos;t be shown again.</b>
            <div>Sensor <span className="mono">{secret.id}</span> · key <code className="mono" style={{ userSelect: "all", wordBreak: "break-all" }}>{secret.key}</code></div>
            <div className="a-row">
              <button className="btn btn-tonal small" onClick={() => navigator.clipboard?.writeText(secret.key).then(() => setMsg({ ok: true, text: "Key copied." }))}>Copy key</button>
              <Link className="btn btn-text small" href={`/camera?sensor=${secret.id}`} target="_blank">Set up a camera with it</Link>
              <button className="btn btn-text small" onClick={() => setSecret(null)}>I&apos;ve saved it</button>
            </div>
          </div>
        </div>
      )}
      <div className="a-split">
        <section className="glass a-pane">
          <div className="a-row">
            <div className="a-tabs" role="group" aria-label="Filter">
              {([["all", `All ${data?.sensors.length ?? ""}`], ["real", `Real ${counts.real}`], ["simulated", `Simulated ${counts.sim}`], ["offline", `Not reporting ${counts.off}`]] as const).map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </div>
          {error && <div className="banner bad">{error}</div>}
          {!data ? <div className="a-empty">Loading…</div> : (
            <div style={{ overflowX: "auto" }}>
              <table className="a-table">
                <thead><tr><th>ID</th><th>Name</th><th>Where</th><th>Last reading</th><th>Seen</th><th>Status</th>{can("sensors.manage") && <th />}</tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>{s.id}</td>
                      <td><b>{s.name}</b><br /><small className="muted">{KIND[s.kind] ?? s.kind}{s.simulated ? " · Simulated" : ""}</small></td>
                      <td>{s.ghatName}{s.gateName ? ` · ${s.gateName}` : ""}</td>
                      <td>{s.lastReading ? Object.entries(s.lastReading).map(([k, v]) => `${k === "peopleIn" ? "in" : k === "peopleOut" ? "out" : "people"} ${v}`).join(" · ") : "—"}</td>
                      <td>{s.lastSeenAt ? ago(s.lastSeenAt) : "never"}<br /><small className="muted">{s.readingsLastHour}/h</small></td>
                      <td><span className={`chip ${!s.active ? "" : s.status === "online" ? "good" : "warn"}`}>{!s.active ? "Off" : s.status === "online" ? "Reporting" : "Silent"}</span></td>
                      {can("sensors.manage") && (
                        <td><div className="a-row" style={{ gap: 4, flexWrap: "nowrap" }}>
                          {!s.simulated && <button className="btn btn-text small" disabled={busy} onClick={() => run(async () => { setSecret(await api(`/api/admin/sensors/${s.id}/rotate`, { body: {} })); })}>New key</button>}
                          <button className="btn btn-text small" disabled={busy} onClick={() => run(async () => { await api(`/api/admin/sensors/${s.id}`, { method: "PATCH", body: { active: !s.active } }); })}>{s.active ? "Turn off" : "Turn on"}</button>
                        </div></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {can("sensors.manage") && (
          <section className="glass a-pane" aria-labelledby="add-h">
            <h2 id="add-h">Register a device</h2>
            <form onSubmit={create} style={{ display: "grid", gap: 12 }}>
              <div className="field"><label htmlFor="s-name">Name</label><input id="s-name" className="input" required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sangam G1 camera" /></div>
              <div className="field"><label htmlFor="s-kind">Type</label>
                <select id="s-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label htmlFor="s-ghat">Ghat</label>
                <select id="s-ghat" className="input" required value={form.ghatId} onChange={(e) => setForm({ ...form, ghatId: e.target.value, gateId: "" })}>
                  <option value="">Choose…</option>{live.data?.ghats.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
              {form.kind === "gate_counter" && (
                <div className="field"><label htmlFor="s-gate">Gate</label>
                  <select id="s-gate" className="input" required value={form.gateId} onChange={(e) => setForm({ ...form, gateId: e.target.value })}>
                    <option value="">Choose…</option>{data?.gates.filter((g) => g.ghatId === form.ghatId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
              )}
              <button className="btn btn-filled" disabled={busy || !form.ghatId || form.name.trim().length < 2}><span className="icon">add</span> Register and get key</button>
            </form>
            <details>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Example request from a device</summary>
              <pre className="mono" style={{ fontSize: 12, whiteSpace: "pre-wrap", background: "var(--surface-high)", padding: 12, borderRadius: 8 }}>{`POST /api/sensors/ingest
X-Sensor-Id: S-0046
Authorization: Bearer sk_…
Content-Type: application/json

{ "peopleIn": 42, "peopleOut": 37 }   // gate counter, per minute
{ "occupancy": 31840 }                // zone or camera counter`}</pre>
            </details>
          </section>
        )}
      </div>
    </>
  );
}
