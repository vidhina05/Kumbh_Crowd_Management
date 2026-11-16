"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ago } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import AerialMap from "@/admin/AerialMap";
import { LEVEL, SOURCE_LABEL, etaText, fmt } from "@/admin/types";

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><LiveMap /></Suspense>;
}

/** Live map and 3D view tabs: the whole Mela on the aerial map, with the selected ghat alongside. */
function LiveMap() {
  const { can, live: data, liveUpdatedAt: updatedAt } = useMe();
  const qs = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const mode = qs.get("view") === "3d" ? "3d" : "2d";
  const setMode = (m: "2d" | "3d") => router.replace(m === "3d" ? `${path}?view=3d` : path);
  const [sel, setSel] = useState<string | null>(null);
  if (!data) return <div className="a-empty" aria-busy="true">Loading the map…</div>;
  const g = data.ghats.find((x) => x.id === sel) ?? null;
  return (
    <>
      <div className="ov">
        <AerialMap live={data} mode={mode} onMode={setMode} selected={sel} onSelect={setSel} callouts={mode === "3d" ? 0 : 4}>
          <span className="m-fresh" style={{ bottom: 19 }}><span className="dot" />Live · updated {updatedAt ? ago(updatedAt) : "—"} · {mode === "3d" ? "drag to tilt, scroll to zoom" : "drag to move, scroll to zoom"}</span>
        </AerialMap>
        <section className="sp" aria-live="polite" aria-labelledby="sel-h">
          {!g ? (
            <>
              <h2 id="sel-h">Select a ghat</h2>
              <p className="muted" style={{ margin: 0 }}>Tap a ghat on the map, or pick one below.</p>
              {[...data.ghats].sort((a, b) => b.percent - a.percent).map((x) => (
                <button key={x.id} className="a-pick" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => setSel(x.id)}>
                  <span style={{ textAlign: "left" }}><b>{x.name}</b><br /><small className="muted">{fmt(x.occupancy)} people · {SOURCE_LABEL[x.source] ?? x.source}</small></span>
                  <span className={`chip ${LEVEL[x.level].chip}`}>{x.percent}%</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="a-row">
                <h2 id="sel-h" style={{ flex: 1, fontSize: 20 }}>{g.name} <span className="muted" style={{ fontWeight: 400 }}>· {g.nameHi}</span></h2>
                <button className="icon-btn" onClick={() => setSel(null)} aria-label="Close"><span className="icon">close</span></button>
              </div>
              <div className="a-row"><span className={`chip ${LEVEL[g.level].chip}`}>{LEVEL[g.level].label} · {g.percent}%</span><span className="chip">{SOURCE_LABEL[g.source] ?? g.source} · {g.updatedMinutesAgo ?? "—"} min ago</span></div>
              <div className="a-kpis" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="a-kpi"><div className="l">People now</div><div className="v">{fmt(g.occupancy)}</div><div className="l">of {fmt(g.capacity)}</div></div>
                <div className="a-kpi"><div className="l">Flow per minute</div><div className="v" style={{ fontSize: 22 }}>{g.flow ? `+${fmt(g.flow.inPerMin)} / −${fmt(g.flow.outPerMin)}` : "—"}</div><div className="l">{g.flow ? `in / out · ${SOURCE_LABEL[g.flow.source] ?? g.flow.source}` : "no gate counters"}</div></div>
              </div>
              <div className="banner info" style={{ fontSize: 13 }}><span className="icon sm">insights</span> {etaText(g.projection, g.safeLimitPct)} (straight-line estimate from the last 10 minutes)</div>
              <table className="a-table">
                <thead><tr><th>Gate</th><th>Type</th><th>In/min</th><th>Out/min</th><th>Status</th></tr></thead>
                <tbody>{g.gates.map((gt) => <tr key={gt.id}><td>{gt.name}</td><td>{gt.kind}</td><td>{gt.inPerMin ?? "—"}</td><td>{gt.outPerMin ?? "—"}</td><td><span className={`chip ${gt.status === "open" ? "good" : gt.status === "held" ? "warn" : "bad"}`}>{gt.status}</span></td></tr>)}</tbody>
              </table>
              <div className="a-row">
                <Link className="btn btn-filled" href={`/admin/ghat?id=${g.id}`}><span className="icon">monitoring</span> Full detail</Link>
                {can("diversions.create") && <Link className="btn btn-tonal" href={`/admin/diversions/new?from=${g.id}`}><span className="icon">alt_route</span> Divert batches</Link>}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
