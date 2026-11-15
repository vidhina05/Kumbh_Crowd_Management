"use client";
import { useState } from "react";
import { api, ago, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";

type Kiosk = { id: string; name: string; location: string; active: boolean; online: boolean; lastSeenAt: string | null; lastSeenVersion: string | null; registrations24h: number };

export default function KiosksPage() {
  const { can } = useMe();
  const { data, error, reload } = usePoll<{ kiosks: Kiosk[] }>("/api/admin/kiosks", 15_000);
  const [form, setForm] = useState({ id: "", name: "Registration kiosk", location: "" });
  const [token, setToken] = useState<{ id: string; token: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    try { setToken(await api<{ id: string; token: string }>("/api/admin/kiosks", { body: form })); setForm({ id: "", name: "Registration kiosk", location: "" }); await reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  const rotate = async (id: string) => {
    if (!confirm(`Issue a new token for ${id}? The kiosk stops working until staff enter the new token on it.`)) return;
    try { setToken(await api<{ id: string; token: string }>(`/api/admin/kiosks/${id}/rotate`, { body: {} })); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  const toggle = async (k: Kiosk) => {
    try { await api(`/api/admin/kiosks/${k.id}`, { method: "PATCH", body: { active: !k.active } }); await reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <>
      <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28 }}>Kiosks</h1>
      <div className="a-grid-2">
        <section className="glass a-pane">
          {error && <div className="banner bad">{error}</div>}
          {msg && <div className="banner bad">{msg}</div>}
          {!data ? <div className="a-empty">Loading…</div> : data.kiosks.length === 0 ? <div className="a-empty">No kiosks yet.</div> : (
            <table className="tbl">
              <thead><tr><th>Kiosk</th><th>Status</th><th>Last heartbeat</th><th>Registrations (24 h)</th>{can("kiosks.manage") && <th />}</tr></thead>
              <tbody>
                {data.kiosks.map((k) => (
                  <tr key={k.id}>
                    <td><b className="mono">{k.id}</b> {k.name}<div className="muted" style={{ fontSize: 12 }}>{k.location}</div></td>
                    <td>{!k.active ? <span className="chip">Disabled</span> : k.online ? <span className="chip good"><span className="dot" /> Online</span> : <span className="chip bad"><span className="dot" /> Offline</span>}</td>
                    <td>{ago(k.lastSeenAt)}{k.lastSeenVersion && <div className="muted mono" style={{ fontSize: 11 }}>v{k.lastSeenVersion}</div>}</td>
                    <td>{k.registrations24h}</td>
                    {can("kiosks.manage") && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn btn-text" onClick={() => rotate(k.id)}>New token</button>
                        <button className="btn btn-text" onClick={() => toggle(k)}>{k.active ? "Disable" : "Enable"}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="a-provenance"><span className="icon sm">info</span> A kiosk counts as online if it sent a heartbeat in the last 90 seconds.</div>
        </section>
        {can("kiosks.manage") && (
          <section className="glass a-pane">
            <h2>Add a kiosk</h2>
            <div className="field"><label htmlFor="kid">Kiosk ID</label><input id="kid" className="input" placeholder="K-18" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase() })} /></div>
            <div className="field"><label htmlFor="kn">Name</label><input id="kn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="kl">Location</label><input id="kl" className="input" placeholder="Sector 4 entry plaza" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <button className="btn btn-filled" disabled={!/^K-\d{1,4}$/.test(form.id) || form.location.length < 2} onClick={create}>Create kiosk</button>
          </section>
        )}
      </div>
      {token && (
        <div className="dialog-scrim"><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="tok-t">
          <h2 id="tok-t">Device token for {token.id}</h2>
          <p className="muted">Enter this on the kiosk at <span className="mono">/kiosk?setup=1</span>. It is shown only once and can't be recovered.</p>
          <div className="card mono" style={{ wordBreak: "break-all", userSelect: "all" }}>{token.token}</div>
          <div className="actions">
            <button className="btn btn-text" onClick={() => navigator.clipboard?.writeText(token.token)}>Copy</button>
            <button className="btn btn-filled" onClick={() => setToken(null)}>I've saved it</button>
          </div>
        </div></div>
      )}
    </>
  );
}
