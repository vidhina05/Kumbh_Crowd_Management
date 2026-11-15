"use client";
import { istDateTime, usePoll } from "@/admin/client";

type E = { id: number; at: string; actorType: string; actorId: string | null; actorName: string | null; action: string; entityType: string | null; entityId: string | null; details: Record<string, unknown> };

export default function AuditPage() {
  const { data, error } = usePoll<{ entries: E[] }>("/api/admin/audit", 30_000);
  return (
    <>
      <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28 }}>Activity log</h1>
      <p className="muted" style={{ margin: 0 }}>Every sign-in, change and photo view, newest first. Entries can't be edited or deleted from the app. No personal data is written here.</p>
      <section className="glass a-pane">
        {error && <div className="banner bad">{error}</div>}
        {!data ? <div className="a-empty">Loading…</div> : (
          <table className="tbl">
            <thead><tr><th>When (IST)</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{istDateTime(e.at)}</td>
                  <td>{e.actorType === "admin" ? e.actorName ?? "Former staff" : e.actorType === "kiosk" ? `Kiosk ${e.actorId}` : "System"}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{e.action}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{e.entityType ? `${e.entityType} ${e.entityId?.slice(0, 8) ?? ""}` : "—"}</td>
                  <td className="muted mono" style={{ fontSize: 11 }}>{Object.keys(e.details).length ? JSON.stringify(e.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
