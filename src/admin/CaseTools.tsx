"use client";
import { useEffect, useState } from "react";
import { api, istDateTime } from "./client";
import { ROLE_LABELS, type Role } from "@/shared/rbac";

type Staff = { id: string; name: string; role: Role };
let staffCache: Promise<Staff[]> | null = null;

export function AssignSelect({ value, onChange, disabled }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => {
    staffCache ??= api<{ staff: Staff[] }>("/api/admin/staff").then((r) => r.staff).catch(() => []);
    void staffCache.then(setStaff);
  }, []);
  return (
    <select className="input" style={{ height: 40 }} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} aria-label="Assign to">
      <option value="">Not assigned</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {ROLE_LABELS[s.role]}</option>)}
    </select>
  );
}

export function Notes({ kind, id, canWrite }: { kind: "help" | "lost"; id: string; canWrite: boolean }) {
  const [notes, setNotes] = useState<{ id: string; note: string; createdAt: string; author: string | null }[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ notes: typeof notes }>(`/api/admin/${kind}/${id}/notes`).then((r) => setNotes(r.notes)).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api(`/api/admin/${kind}/${id}/notes`, { body: { note: text } }); setText(""); await load(); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <div className="a-notes">
      <h2>Case history</h2>
      {err && <div className="banner bad">{err}</div>}
      {canWrite && (
        <form onSubmit={add} style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ height: 40 }} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Add a note (what you did, who you spoke to)" aria-label="New note" />
          <button className="btn btn-tonal" disabled={!text.trim()}>Add</button>
        </form>
      )}
      {notes.length === 0 ? <div className="muted">No notes yet.</div> : notes.map((n) => (
        <div key={n.id} className="a-note"><div>{n.note}</div><div className="muted" style={{ fontSize: 12 }}>{n.author ?? "Former staff"} · {istDateTime(n.createdAt)}</div></div>
      ))}
    </div>
  );
}
