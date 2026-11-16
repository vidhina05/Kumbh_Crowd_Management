"use client";
import Link from "next/link";
import { useState } from "react";
import { ago, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import type { Fix } from "@/admin/types";

type Slot = { id: string; start: string; end: string; batchNo: number; booked: number; capacity: number; percent: number; phase: "done" | "now" | "later" };
type Plan = { day: string; now: string; ghats: { ghatId: string; name: string; slots: Slot[] }[]; fixes: Fix[]; totals: { batches: number; done: number; overfull: number; booked: number } };

const tone = (p: number) => (p >= 95 ? "var(--error)" : p >= 80 ? "var(--warning)" : p >= 40 ? "color-mix(in srgb, var(--success) 60%, var(--surface))" : "color-mix(in srgb, var(--success) 25%, var(--surface))");

export default function Batches() {
  const { can } = useMe();
  const { data, error, updatedAt } = usePoll<Plan>("/api/admin/batches", 20_000);
  const [hover, setHover] = useState<{ ghat: string; s: Slot } | null>(null);
  if (error && !data) return <div className="banner bad" role="alert">{error}</div>;
  if (!data) return <div className="a-empty" aria-busy="true">Loading today&apos;s batches…</div>;
  const times = data.ghats[0]?.slots.map((s) => s.start) ?? [];
  return (
    <>
      <div className="a-row">
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Batch plan · {data.day}</h1>
        <span className="chip">{data.totals.done} of {data.totals.batches} batches done</span>
        <span className="chip">{data.totals.booked.toLocaleString("en-IN")} people booked</span>
        <span className={`chip ${data.totals.overfull ? "bad" : "good"}`}>{data.totals.overfull} over-full</span>
        <span className="a-provenance"><span className="icon sm">sync</span> {updatedAt ? ago(updatedAt) : "—"}</span>
      </div>
      <div className="a-split">
        <section className="glass a-pane" aria-labelledby="grid-h">
          <h2 id="grid-h">Every 30-minute batch, by ghat · colour shows how full</h2>
          <div style={{ overflowX: "auto" }}>
            <div className="slot-grid" style={{ minWidth: 130 + times.length * 37 }} role="table" aria-label="Batches by ghat and time">
              <div role="rowheader" />
              {times.map((t, i) => <div key={t} className="muted" style={{ fontSize: 10, textAlign: "center" }} role="columnheader">{i % 2 === 0 ? t : ""}</div>)}
              {data.ghats.map((g) => (
                <div key={g.ghatId} role="row" style={{ display: "contents" }}>
                  <Link role="rowheader" href={`/admin/ghat?id=${g.ghatId}`} style={{ fontWeight: 600, color: "inherit", textDecoration: "none", fontSize: 13 }}>{g.name}</Link>
                  {g.slots.map((s) => (
                    <button key={s.id} role="cell" className={`slot-cell ${s.phase}`} style={{ background: tone(s.percent), color: s.percent >= 80 ? "#fff" : undefined }}
                      onMouseEnter={() => setHover({ ghat: g.name, s })} onFocus={() => setHover({ ghat: g.name, s })}
                      aria-label={`${g.name} batch ${s.batchNo}, ${s.start} to ${s.end}: ${s.booked} of ${s.capacity} booked, ${s.percent}%, ${s.phase}`}>
                      {s.percent >= 95 ? "!" : ""}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="a-provenance" aria-live="polite" style={{ minHeight: 20 }}>
            {hover ? <>{hover.ghat} · batch {hover.s.batchNo} · {hover.s.start}–{hover.s.end} · {hover.s.booked} of {hover.s.capacity} booked ({hover.s.percent}%) · {hover.s.phase === "done" ? "finished" : hover.s.phase === "now" ? "happening now" : "upcoming"}</> : "Point at a batch to see its numbers. Faded = finished, outlined = now."}
          </div>
          <div className="a-row" style={{ fontSize: 12, gap: 14 }}>
            {[["Under 40%", 20], ["40–79%", 60], ["80–94%", 85], ["95%+ over-full", 98]].map(([l, p]) => <span key={l as string} className="a-provenance"><span style={{ width: 14, height: 14, borderRadius: 3, background: tone(p as number), display: "inline-block" }} /> {l}</span>)}
          </div>
        </section>
        <section className="glass a-pane" aria-labelledby="fixes-h">
          <h2 id="fixes-h">Suggested fixes ({data.fixes.length})</h2>
          {data.fixes.length === 0 && <div className="muted">Every upcoming batch fits. Nothing to fix.</div>}
          {data.fixes.map((f) => (
            <div key={f.slotId} className="a-note">
              <div className="a-row" style={{ gap: 8 }}><span className="chip bad">{f.percent}%</span><b style={{ flex: 1 }}>{f.ghatName} · batch {f.batchNo} · {f.start}</b></div>
              <div className="muted" style={{ fontSize: 13, margin: "6px 0" }}>{f.action}</div>
              {can("diversions.create") && <Link className="btn btn-tonal small" href={`/admin/diversions/new?from=${f.ghatId}&slot=${f.slotId}${f.suggestion?.toGhatId ? `&to=${f.suggestion.toGhatId}` : ""}`}><span className="icon sm">alt_route</span> Plan this diversion</Link>}
            </div>
          ))}
          <div className="muted" style={{ fontSize: 12 }}>Suggestions are worked out from bookings and capacity. A person decides; every diversion needs a second staff member to approve it.</div>
        </section>
      </div>
    </>
  );
}
