"use client";
import Link from "next/link";
import { istDateTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";

type Row = { id: string; code: string; from: string; to: string; status: string; families: number; people: number; createdAt: string; batches: number[] };
const STATUS: Record<string, { label: string; chip: string }> = {
  awaiting_approval: { label: "Waiting for second check", chip: "warn" },
  sent: { label: "Sent", chip: "good" },
  rejected: { label: "Rejected", chip: "" },
  undone: { label: "Undone", chip: "" },
};

export default function Diversions() {
  const { can } = useMe();
  const { data, error } = usePoll<{ diversions: Row[] }>("/api/admin/diversions", 10_000);
  return (
    <>
      <div className="a-row">
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Diversions</h1>
        {can("diversions.create") && <Link className="btn btn-filled" href="/admin/diversions/new"><span className="icon">add</span> New diversion</Link>}
      </div>
      <div className="banner info" style={{ fontSize: 13 }}><span className="icon sm">info</span> A diversion moves upcoming batches of families to a ghat with room. It always needs a second staff member to approve it, sends each family an SMS (when SMS is connected) and shows the change at every kiosk. It can be undone.</div>
      {error && <div className="banner bad" role="alert">{error}</div>}
      <section className="glass a-pane">
        {!data ? <div className="a-empty">Loading…</div> : data.diversions.length === 0 ? <div className="a-empty">No diversions yet today.</div> : (
          <table className="a-table">
            <thead><tr><th>Code</th><th>From → to</th><th>Batches</th><th>Families</th><th>People</th><th>Status</th><th>Made</th><th /></tr></thead>
            <tbody>
              {data.diversions.map((d) => (
                <tr key={d.id}>
                  <td className="mono"><b>{d.code}</b></td><td>{d.from} → {d.to}</td><td>{d.batches.join(", ") || "—"}</td><td>{d.families}</td><td>{d.people}</td>
                  <td><span className={`chip ${STATUS[d.status]?.chip ?? ""}`}>{STATUS[d.status]?.label ?? d.status}</span></td>
                  <td>{istDateTime(d.createdAt)}</td>
                  <td><Link className="btn btn-text small" href={`/admin/diversions/view?id=${d.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
