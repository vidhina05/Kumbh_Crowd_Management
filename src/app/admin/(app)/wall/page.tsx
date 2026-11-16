"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePoll } from "@/admin/client";
import CrowdMap from "@/admin/CrowdMap";
import { LEVEL, SOURCE_LABEL, fmt, type Live } from "@/admin/types";

/** Full-screen view for the control-room wall: big numbers, no controls, refreshes every 5 seconds. */
export default function Wall() {
  const { data, error } = usePoll<Live>("/api/admin/live", 5_000);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  useEffect(() => { const iv = setInterval(() => setMode((m) => (m === "2d" ? "3d" : "2d")), 30_000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "f") void document.documentElement.requestFullscreen?.().catch(() => undefined); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  if (!data) return <div className="wall" style={{ placeItems: "center" }}>{error ?? "Loading…"}</div>;
  const ranked = [...data.ghats].sort((a, b) => b.percent - a.percent);
  return (
    <div className="wall" role="region" aria-label="Wall view">
      <header style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 16 }}>
        <h1 style={{ flex: 1 }}>Sangam Command · live</h1>
        <span style={{ fontSize: 28, fontWeight: 600 }} className="mono">{data.now} IST</span>
        {data.totals.sources.includes("simulated") && <span className="chip">Includes simulated numbers</span>}
        <Link className="btn btn-tonal" href="/admin">Exit wall view</Link>
      </header>
      <section className="glass a-pane" style={{ minHeight: 0 }}>
        <CrowdMap ghats={data.ghats} mode={mode} />
        <div className="muted" style={{ fontSize: 14 }}>Switches between plan and 3D every 30 s · press F for full screen</div>
      </section>
      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        <div className="glass a-pane"><div className="muted">People at the ghats</div><div className="big">{fmt(data.totals.people)}</div><div className="muted">{data.totals.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" + ")}</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="glass a-pane"><div className="muted">Help open</div><div className="big">{data.help.open}</div></div>
          <div className="glass a-pane" style={data.lostOpen.length ? { outline: "3px solid var(--error)" } : undefined}><div className="muted">Lost, searching</div><div className="big">{data.lostOpen.length}</div></div>
        </div>
        <div className="glass a-pane">
          {ranked.map((g) => (
            <div key={g.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px", alignItems: "center", gap: 8, fontSize: 20 }}>
              <div><b>{g.name}</b><div className="bar" style={{ height: 10, marginTop: 4 }}><i className={`level-${g.level}-bg`} style={{ width: `${Math.min(100, g.percent)}%` }} /></div></div>
              <div className={`level-${g.level}`} style={{ fontSize: 28, fontWeight: 700, textAlign: "right" }} aria-label={`${g.percent}% ${LEVEL[g.level].label}`}>{g.percent}%</div>
            </div>
          ))}
        </div>
        {data.alerts[0] && <div className={`banner ${data.alerts[0].severity === "critical" ? "bad" : "warn"}`} style={{ fontSize: 18 }}><b>{data.alerts[0].title}</b> {data.alerts[0].message}</div>}
      </div>
    </div>
  );
}
