"use client";
import { useState } from "react";
import { api, istDateTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";

type Alert = { id: string; severity: string; title: string; message: string; ghatId: string | null; audience: string; status: string; createdAt: string; createdByName: string | null; resolvedAt: string | null };
type Ov = { ghats: { id: string; name: string }[] };

export default function AlertsPage() {
  const { can } = useMe();
  const [tab, setTab] = useState<"active" | "resolved">("active");
  const { data, error, reload } = usePoll<{ alerts: Alert[] }>(`/api/admin/alerts?status=${tab}`, 10_000);
  const ghats = usePoll<Ov>("/api/admin/overview", 60_000).data?.ghats ?? [];
  const [form, setForm] = useState({ severity: "warning", title: "", message: "", ghatId: "", audience: "staff" });
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    try {
      await api("/api/admin/alerts", { body: { ...form, ghatId: form.ghatId || null } });
      setForm({ severity: "warning", title: "", message: "", ghatId: "", audience: "staff" });
      setConfirm(false);
      setTab("active");
      await reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); setConfirm(false); }
  };
  const resolve = async (id: string) => {
    try { await api(`/api/admin/alerts/${id}/resolve`, { body: {} }); await reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  const valid = form.title.trim().length >= 3 && form.message.trim().length >= 3;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Alerts</h1>
        <div className="a-tabs">{(["active", "resolved"] as const).map((k) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{k === "active" ? "Active" : "Resolved"}</button>)}</div>
      </div>
      <div className="a-grid-2">
        <section className="glass a-pane">
          {error && <div className="banner bad">{error}</div>}
          {msg && <div className="banner bad">{msg}</div>}
          {!data ? <div className="a-empty">Loading…</div> : data.alerts.length === 0 ? <div className="a-empty">No {tab} alerts.</div> : data.alerts.map((a) => (
            <div key={a.id} className={`banner ${a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}`} style={{ alignItems: "flex-start" }}>
              <span className="icon">{a.severity === "critical" ? "error" : "campaign"}</span>
              <div style={{ flex: 1 }}>
                <b>{a.title}</b> <span className="chip" style={{ marginLeft: 6 }}>{a.audience === "both" ? "Staff + kiosks" : a.audience === "kiosk" ? "Kiosks" : "Staff only"}</span>
                <div>{a.message}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{istDateTime(a.createdAt)} · {a.createdByName ?? "—"}{a.ghatId ? ` · ${ghats.find((g) => g.id === a.ghatId)?.name ?? a.ghatId}` : ""}{a.resolvedAt ? ` · resolved ${istDateTime(a.resolvedAt)}` : ""}</div>
              </div>
              {a.status === "active" && can("alerts.manage") && <button className="btn btn-text" onClick={() => resolve(a.id)}>Resolve</button>}
            </div>
          ))}
        </section>
        {can("alerts.manage") && (
          <section className="glass a-pane">
            <h2>New alert</h2>
            <div className="field"><label htmlFor="sev">Severity</label>
              <select id="sev" className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
              </select></div>
            <div className="field"><label htmlFor="title">Title</label><input id="title" className="input" maxLength={80} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Sangam is full" /></div>
            <div className="field"><label htmlFor="msg">Message</label><textarea id="msg" className="input" maxLength={400} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What should people do?" /></div>
            <div className="field"><label htmlFor="ghat">Ghat (optional)</label>
              <select id="ghat" className="input" value={form.ghatId} onChange={(e) => setForm({ ...form, ghatId: e.target.value })}>
                <option value="">Whole Mela</option>{ghats.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="aud">Who sees it</label>
              <select id="aud" className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                <option value="staff">Staff only</option><option value="kiosk">Pilgrims at every kiosk</option><option value="both">Staff and kiosks</option>
              </select>
              <span className="help">Kiosk alerts are shown in English on all kiosks. Translate the message yourself for now.</span>
            </div>
            <button className="btn btn-filled" disabled={!valid} onClick={() => (form.audience === "staff" ? create() : setConfirm(true))}>Publish alert</button>
          </section>
        )}
      </div>
      {confirm && (
        <div className="dialog-scrim"><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="c-t">
          <h2 id="c-t">Show this on every kiosk?</h2>
          <p className="muted">Pilgrims at every kiosk will see “{form.title}” until someone resolves it.</p>
          <div className="actions"><button className="btn btn-text" onClick={() => setConfirm(false)}>Cancel</button><button className="btn btn-filled" onClick={create}>Publish</button></div>
        </div></div>
      )}
    </>
  );
}
