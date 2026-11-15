"use client";
import { useState } from "react";
import { api, ago, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { ROLES, ROLE_LABELS, type Role } from "@/shared/rbac";

type U = { id: string; email: string; name: string; role: Role; active: boolean; lastLoginAt: string | null; lockedUntil: string | null };

export default function UsersPage() {
  const { me } = useMe();
  const { data, error, reload } = usePoll<{ users: U[] }>("/api/admin/users", 30_000);
  const [form, setForm] = useState({ name: "", email: "", role: "help_desk" as Role, password: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const create = async () => {
    setMsg(null);
    try { await api("/api/admin/users", { body: form }); setForm({ name: "", email: "", role: "help_desk", password: "" }); setMsg({ ok: true, text: "Staff member added. Give them the password in person." }); await reload(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
  };
  const update = async (id: string, body: Record<string, unknown>) => {
    setMsg(null);
    try { await api(`/api/admin/users/${id}`, { method: "PATCH", body }); setMsg({ ok: true, text: "Saved. Their open sessions were signed out." }); await reload(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
  };
  const resetPw = (u: U) => {
    const pw = prompt(`New password for ${u.name} (at least 12 characters, letters and a number):`);
    if (pw) void update(u.id, { password: pw });
  };

  return (
    <>
      <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28 }}>Staff and roles</h1>
      {msg && <div className={`banner ${msg.ok ? "info" : "bad"}`}>{msg.text}</div>}
      <div className="a-grid-2">
        <section className="glass a-pane">
          {error && <div className="banner bad">{error}</div>}
          {!data ? <div className="a-empty">Loading…</div> : (
            <table className="tbl">
              <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                    <td><b>{u.name}</b>{u.id === me.id && <span className="muted"> (you)</span>}<div className="muted" style={{ fontSize: 12 }}>{u.email}</div></td>
                    <td>
                      <select className="input" style={{ height: 36 }} value={u.role} disabled={u.id === me.id} onChange={(e) => update(u.id, { role: e.target.value })} aria-label={`Role for ${u.name}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td>{ago(u.lastLoginAt)}{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <div className="chip bad">Locked</div>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-text" onClick={() => resetPw(u)}>Reset password</button>
                      {u.id !== me.id && <button className="btn btn-text" onClick={() => update(u.id, { active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="glass a-pane">
          <h2>Add staff</h2>
          <div className="field"><label htmlFor="un">Name</label><input id="un" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="ue">Work email</label><input id="ue" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="ur">Role</label>
            <select id="ur" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
          <div className="field"><label htmlFor="up">First password</label><input id="up" className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><span className="help">At least 12 characters, with letters and a number.</span></div>
          <button className="btn btn-filled" disabled={!form.name || !form.email || form.password.length < 12} onClick={create}>Add staff member</button>
          <div className="card" style={{ fontSize: 13 }}>
            <b>What each role can do</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li><b>Super admin</b>: everything, including staff, kiosks and the activity log.</li>
              <li><b>Operations</b>: families, help, lost &amp; found, alerts, crowd counts, reports, Sahayak.</li>
              <li><b>Crowd control</b>: crowd counts, alerts, Sahayak; can view help requests.</li>
              <li><b>Help desk</b>: families, help requests and lost &amp; found.</li>
              <li><b>Medical</b>: medical help requests; can view the others.</li>
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
