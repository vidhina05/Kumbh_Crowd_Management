"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { istTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import type { Fix } from "@/admin/types";

type Slot = { id: string; start: string; end: string; batchNo: number; booked: number; capacity: number; percent: number; phase: "done" | "now" | "later" };
type Plan = { day: string; now: string; ghats: { ghatId: string; name: string; slots: Slot[] }[]; fixes: Fix[]; totals: { batches: number; done: number; overfull: number; booked: number } };

const dotColor = (p: number) => (p > 90 ? "var(--crowd-critical)" : p >= 75 ? "var(--crowd-high)" : p >= 60 ? "var(--crowd-moderate)" : "var(--crowd-low)");
const dayOffset = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

/** Figma "Admin / 08 Batch plan". */
export default function BatchPlan() {
  const { can } = useMe();
  const [day, setDay] = useState(0);
  const [allGhats, setAllGhats] = useState(false);
  const [more, setMore] = useState(false);
  const [hover, setHover] = useState<{ ghat: string; s: Slot } | null>(null);
  const { data, error, updatedAt } = usePoll<Plan>(`/api/admin/batches?day=${dayOffset(day)}`, 20_000);
  const ghats = useMemo(() => {
    if (!data) return [];
    const peak = (g: Plan["ghats"][number]) => Math.max(0, ...g.slots.filter((s) => s.phase !== "done").map((s) => s.percent));
    const sorted = [...data.ghats].sort((a, b) => peak(b) - peak(a));
    return allGhats ? sorted : sorted.slice(0, 8);
  }, [data, allGhats]);
  if (error && !data) return <div className="banner bad" role="alert">{error}</div>;
  if (!data) return <div className="a-empty" aria-busy="true">Loading batches…</div>;

  const times = data.ghats[0]?.slots.map((s) => s.start) ?? [];
  const nowIdx = times.findIndex((t, i) => t <= data.now && (times[i + 1] ?? "99") > data.now);
  const fixes = more ? data.fixes : data.fixes.slice(0, 3);
  const booked = data.ghats.flatMap((g) => g.slots).reduce((a, s) => ({ b: a.b + s.booked, c: a.c + s.capacity }), { b: 0, c: 0 });
  const bookedPct = booked.c ? Math.round((booked.b / booked.c) * 100) : 0;
  const overGhats = [...new Set(data.fixes.map((f) => f.ghatName))];
  const first = data.fixes[0];

  return (
    <div className="bp">
      <div className="bp-head">
        <div className="a-tabs-sec" role="tablist"><Link role="tab" aria-selected href="/admin/batches">Plan</Link><Link role="tab" aria-selected={false} href="/admin/diversions">Diversions</Link></div>
        <div className="crumb">{data.day} · {data.totals.batches} batches · {ghats.length === data.ghats.length ? `all ${data.ghats.length}` : `${ghats.length} busiest of ${data.ghats.length}`} ghats</div>
        <div className="bp-chips" role="group" aria-label="Day and ghats">
          <button className="m-chip" aria-pressed={day === 0} onClick={() => setDay(0)}>{day === 0 && <span className="icon sm">check</span>}Today</button>
          <button className="m-chip" aria-pressed={day === 1} onClick={() => setDay(1)}>{day === 1 && <span className="icon sm">check</span>}Tomorrow</button>
          <button className="m-chip" aria-pressed={day === 2} onClick={() => setDay(2)}>{day === 2 && <span className="icon sm">check</span>}{new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" })}</button>
          <button className="m-chip" aria-pressed={allGhats} onClick={() => setAllGhats((v) => !v)}>{allGhats && <span className="icon sm">check</span>}All ghats</button>
        </div>
      </div>

      <section className="dl-card bp-grid-card" aria-labelledby="g-h">
        <div className="a-row" style={{ justifyContent: "space-between" }}>
          <h2 id="g-h">How full each ghat gets, every 30 minutes</h2>
          <div className="bp-legend">{[["Under 60%", 40], ["60–75%", 65], ["75–90%", 80], ["Over 90%", 95]].map(([l, p]) => <span key={l as string}><i style={{ background: dotColor(p as number) }} />{l}</span>)}</div>
        </div>
        <div className="bp-scroll">
          <div className="bp-grid" style={{ gridTemplateColumns: `130px repeat(${times.length}, 22px)` }} role="table" aria-label="Batches by ghat and time">
            {ghats.map((g) => (
              <div key={g.ghatId} role="row" style={{ display: "contents" }}>
                <Link role="rowheader" href={`/admin/ghat?id=${g.ghatId}`} className="bp-name">{g.name.replace(/ Ghat$/, "")}</Link>
                {g.slots.map((s) => {
                  const size = 8 + Math.min(100, s.percent) / 100 * 10;
                  return (
                    <button key={s.id} role="cell" className={`bp-dot ${s.phase}`} onMouseEnter={() => setHover({ ghat: g.name, s })} onFocus={() => setHover({ ghat: g.name, s })} onMouseLeave={() => setHover(null)}
                      aria-label={`${g.name} batch ${s.batchNo}, ${s.start} to ${s.end}: ${s.booked} of ${s.capacity} booked, ${s.percent}%${s.phase === "done" ? ", finished" : s.phase === "now" ? ", now" : ""}`}>
                      <i style={{ width: size, height: size, background: dotColor(s.percent) }} />
                    </button>
                  );
                })}
              </div>
            ))}
            {day === 0 && nowIdx >= 0 && <span className="bp-now" style={{ left: 130 + nowIdx * 22 + 11 }}><b>Now {data.now}</b></span>}
            <div style={{ display: "contents" }}><span />{times.map((t, i) => <span key={t} className="bp-time">{i % 4 === 0 ? t : ""}</span>)}</div>
          </div>
        </div>
        <div className="bp-foot" aria-live="polite">{hover ? `${hover.ghat} · batch ${hover.s.batchNo} · ${hover.s.start}–${hover.s.end} · ${hover.s.booked.toLocaleString("en-IN")} of ${hover.s.capacity.toLocaleString("en-IN")} booked (${hover.s.percent}%)` : "Each dot is one 30-minute slot. Bigger, warmer dots are fuller and the line marks now. Over-full slots are listed in Fix these first."}</div>
      </section>

      <section className="dl-card bp-fix" aria-labelledby="f-h">
        <div className="a-row" style={{ justifyContent: "space-between" }}><h2 id="f-h">Fix these first</h2><span style={{ color: "var(--primary)", fontSize: 13 }}>{data.fixes.length} open</span></div>
        {data.fixes.length === 0 && <div className="muted">Every upcoming slot fits. Nothing to fix.</div>}
        {fixes.map((f) => (
          <Link key={f.slotId} className="bp-fix-item" href={can("diversions.create") ? `/admin/diversions/new?from=${f.ghatId}&slot=${f.slotId}${f.suggestion?.toGhatId ? `&to=${f.suggestion.toGhatId}` : ""}` : `/admin/ghat?id=${f.ghatId}`}>
            <span className={`tag ${f.percent > 100 || f.label === "Over-full" ? "over" : "limit"}`}>{f.label}</span>
            <span className="row"><i style={{ background: dotColor(f.percent) }} /><b>{f.ghatName.replace(/ Ghat$/, "")} · {f.start} to {f.end}</b><span className="p" style={{ color: dotColor(f.percent) }}>{f.percent}%</span></span>
            <span className="sub"><span className="icon sm">subdirectory_arrow_right</span>{f.action}</span>
          </Link>
        ))}
        {data.fixes.length > 3 && <button className="btn btn-text small" onClick={() => setMore((m) => !m)}><span className="icon sm">{more ? "expand_less" : "expand_more"}</span>{more ? "Show less" : `Show ${data.fixes.length - 3} more`}</button>}
        <div style={{ flex: 1 }} />
        <div className="muted" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}><span className="icon sm">sync</span>Rechecks every 20 s · last at {updatedAt ? istTime(updatedAt) : "—"}</div>
      </section>

      <div className="bp-kpis">
        <div className="dl-card bp-kpi"><small>Batches done</small><b style={{ color: "var(--primary)" }}>{data.totals.done}</b><span>of {data.totals.batches}{day === 0 ? "" : " · not started"}</span><Dots n={data.totals.done} of={data.totals.batches} color="var(--primary)" /></div>
        <div className="dl-card bp-kpi"><small>Booked</small><b>{bookedPct}%</b><span>{data.totals.booked.toLocaleString("en-IN")} people of {booked.c.toLocaleString("en-IN")} places</span><Dots n={bookedPct} of={100} color="var(--crowd-low)" /></div>
        <div className="dl-card bp-kpi"><small>Over-full slots</small><b style={{ color: data.totals.overfull ? "var(--crowd-critical)" : undefined }}>{data.totals.overfull}</b><span>{overGhats.length ? `At ${overGhats.slice(0, 2).join(" and ")}${overGhats.length > 2 ? ` +${overGhats.length - 2}` : ""}` : "None"}</span><Dots n={data.totals.overfull} of={Math.max(30, data.totals.overfull)} color="var(--crowd-critical)" /></div>
        <div className="dl-card bp-kpi bp-propose">
          <div className="a-row" style={{ justifyContent: "space-between" }}><span style={{ color: "var(--primary)", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><span className="icon sm">auto_awesome</span>Sahayak proposes</span><span className="chip">From bookings, not AI</span></div>
          <b className="t">{data.fixes.length ? `Fix ${data.fixes.length === 1 ? "the over-full slot" : `the ${data.fixes.length} over-full slots`}` : "Nothing to fix"}</b>
          <span className="muted" style={{ fontSize: 14 }}>{data.fixes.length ? `Start with ${first.ghatName} at ${first.start}: ${first.action.toLowerCase()}. Every move needs a second staff member to approve it.` : "Every batch fits its ghat."}</span>
          {first && can("diversions.create") && <div className="a-row"><Link className="btn btn-filled" href={`/admin/diversions/new?from=${first.ghatId}&slot=${first.slotId}${first.suggestion?.toGhatId ? `&to=${first.suggestion.toGhatId}` : ""}`}><span className="icon sm">visibility</span>Preview the move</Link><Link className="btn btn-text" href="/admin/diversions/new"><span className="icon sm">edit</span>Edit by hand</Link></div>}
        </div>
      </div>
    </div>
  );
}

function Dots({ n, of, color }: { n: number; of: number; color: string }) {
  const total = 30, on = Math.round((Math.min(n, of) / Math.max(1, of)) * total);
  return <span className="bp-dots" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} style={i < on ? { background: color } : undefined} />)}</span>;
}
