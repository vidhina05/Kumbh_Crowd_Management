"use client";
import { useState } from "react";
import { api, ago, istDateTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { AssignSelect, Notes } from "@/admin/CaseTools";
import { canUpdateHelpType } from "@/shared/rbac";

type Req = {
  id: string; code: string; type: string; description: string; location: string; priority: string; status: string; kioskId: string | null;
  assignedTo: string | null; assigneeName: string | null; passCode: string | null; familyName: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null;
};
const TYPE: Record<string, { label: string; icon: string }> = {
  medical: { label: "Medical", icon: "medical_services" }, lost_person: { label: "Someone missing", icon: "person_search" },
  wheelchair: { label: "Wheelchair", icon: "accessible" }, language: { label: "Language help", icon: "translate" }, other: { label: "Other", icon: "support_agent" },
};
const NEXT: Record<string, { to: string; label: string }[]> = {
  open: [{ to: "in_progress", label: "Start" }, { to: "resolved", label: "Mark resolved" }, { to: "cancelled", label: "Cancel" }],
  assigned: [{ to: "in_progress", label: "Start" }, { to: "resolved", label: "Mark resolved" }, { to: "cancelled", label: "Cancel" }],
  in_progress: [{ to: "resolved", label: "Mark resolved" }, { to: "cancelled", label: "Cancel" }],
  resolved: [{ to: "open", label: "Reopen" }],
  cancelled: [{ to: "open", label: "Reopen" }],
};

export default function HelpPage() {
  const { me } = useMe();
  const [status, setStatus] = useState<"active" | "resolved" | "">("active");
  const { data, error, reload } = usePoll<{ requests: Req[] }>(`/api/admin/help${status ? `?status=${status}` : ""}`, 8_000);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const r = data?.requests.find((x) => x.id === sel) ?? null;
  const editable = r ? canUpdateHelpType(me.role, r.type) : false;

  const patch = async (body: Record<string, unknown>) => {
    if (!r) return;
    setMsg(null);
    try { await api(`/api/admin/help/${r.id}`, { method: "PATCH", body }); await reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Help requests</h1>
        <div className="a-tabs" role="group" aria-label="Filter">
          {([["active", "Open"], ["resolved", "Resolved"], ["", "All"]] as const).map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
      </div>
      <div className="a-grid-2">
        <section className="glass a-pane">
          {error && <div className="banner bad">{error}</div>}
          {!data ? <div className="a-empty">Loading…</div> : data.requests.length === 0 ? <div className="a-empty">No {status === "active" ? "open " : ""}requests. Requests from kiosks appear here within 10 seconds.</div> : (
            <table className="tbl">
              <thead><tr><th>Request</th><th>From</th><th>Waiting</th><th>Status</th></tr></thead>
              <tbody>
                {data.requests.map((h) => (
                  <tr key={h.id} className={`clickable${sel === h.id ? " selected" : ""}`} onClick={() => setSel(h.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(h.id)}>
                    <td><span className="icon sm" aria-hidden="true">{TYPE[h.type]?.icon}</span> <b>{TYPE[h.type]?.label ?? h.type}</b> <span className="mono muted">{h.code}</span>{h.priority !== "normal" && <span className="chip bad" style={{ marginLeft: 6 }}>{h.priority}</span>}<div className="muted" style={{ fontSize: 12 }}>{h.description || "No details given"}</div></td>
                    <td>{h.kioskId ? `Kiosk ${h.kioskId}` : "—"}<div className="muted" style={{ fontSize: 12 }}>{h.location}</div></td>
                    <td>{ago(h.createdAt)}</td>
                    <td><span className={`chip ${h.status === "resolved" ? "good" : h.status === "cancelled" ? "" : "warn"}`}>{h.status.replace("_", " ")}</span><div className="muted" style={{ fontSize: 12 }}>{h.assigneeName ?? "Unassigned"}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="glass a-pane a-detail">
          {!r ? <div className="a-empty">Select a request to assign it or update it.</div> : (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 400 }}>{TYPE[r.type]?.label} · <span className="mono">{r.code}</span></h2>
              {msg && <div className="banner bad">{msg}</div>}
              {!editable && <div className="banner info">Your role can view this request but not change it.</div>}
              <dl>
                <dt>Raised</dt><dd>{istDateTime(r.createdAt)} at {r.kioskId ? `kiosk ${r.kioskId}` : "—"} ({r.location})</dd>
                <dt>Details</dt><dd>{r.description || "—"}</dd>
                <dt>Family</dt><dd>{r.familyName ? `${r.familyName} · ${r.passCode}` : "Not linked"}</dd>
                <dt>Priority</dt>
                <dd>
                  <select className="input" style={{ height: 36, maxWidth: 160 }} value={r.priority} disabled={!editable} onChange={(e) => patch({ priority: e.target.value })} aria-label="Priority">
                    <option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </dd>
                <dt>Assigned to</dt><dd><AssignSelect value={r.assignedTo} disabled={!editable} onChange={(id) => patch({ assignedTo: id })} /></dd>
                <dt>Status</dt><dd><span className="chip">{r.status.replace("_", " ")}</span>{r.resolvedAt && <span className="muted"> · resolved {istDateTime(r.resolvedAt)}</span>}</dd>
              </dl>
              {editable && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {NEXT[r.status]?.map((n) => (
                    <button key={n.to} className={`btn ${n.to === "resolved" ? "btn-filled" : n.to === "cancelled" ? "btn-text" : "btn-tonal"}`} onClick={() => patch({ status: n.to })}>{n.label}</button>
                  ))}
                </div>
              )}
              <Notes kind="help" id={r.id} canWrite={editable} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
