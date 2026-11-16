"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ago, api, istTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { BASE_PATH } from "@/shared/base";
import { crowdColor, fmt, type GhatLive } from "@/admin/types";

type Detail = {
  ghat: GhatLive;
  history: { at: string; occupancy: number; source: string }[];
  projection: { at: string; occupancy: number }[];
  sensors: { id: string; name: string; kind: string; simulated: boolean; lastSeenAt: string | null; lastReading: Record<string, number> | null }[];
  alternatives: { id: string; name: string; percent: number }[];
};
type Fix = { slotId: string; ghatId: string; start: string; batchNo: number; percent: number };
type Plan = { ghats: { ghatId: string; slots: { id: string; start: string; booked: number; phase: string }[] }[]; fixes: Fix[] };

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><GhatDetail /></Suspense>;
}

/** Figma "Admin / 05 Ghat detail". */
function GhatDetail() {
  const id = useSearchParams().get("id");
  const { can, live } = useMe();
  const { data, error, reload, updatedAt } = usePoll<Detail>(id ? `/api/admin/ghats/${encodeURIComponent(id)}/detail` : null, 10_000);
  const plan = usePoll<Plan>(can("batches.view") ? "/api/admin/batches" : null, 60_000);
  const [scen, setScen] = useState<"none" | "divert">("none");
  const [scrub, setScrub] = useState<number | null>(null);
  const [gateMenu, setGateMenu] = useState<string | null>(null);
  const [confirmHold, setConfirmHold] = useState<string | null>(null);
  const [count, setCount] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); }, [msg]);

  const g = data?.ghat;
  const fixes = useMemo(() => (plan.data?.fixes ?? []).filter((f) => f.ghatId === id).slice(0, 3), [plan.data, id]);
  // "If you divert": the people booked in this ghat's over-full upcoming batches leave the projection from their start time.
  const divertedPeople = useMemo(() => {
    const slots = plan.data?.ghats.find((x) => x.ghatId === id)?.slots ?? [];
    return fixes.map((f) => ({ start: f.start, people: slots.find((s) => s.id === f.slotId)?.booked ?? 0 }));
  }, [fixes, plan.data, id]);
  if (!id) return <div className="banner warn">No ghat chosen. <Link href="/admin/map">Open the live map</Link>.</div>;
  if (error && !data) return <div className="banner bad" role="alert">{error}</div>;
  if (!data || !g) return <div className="a-empty" aria-busy="true">Loading ghat…</div>;

  const projection = scen === "divert" ? data.projection.map((p) => {
    const hhmm = istTime(p.at);
    const minus = divertedPeople.filter((d) => d.start <= hhmm).reduce((a, d) => a + d.people, 0);
    return { ...p, occupancy: Math.max(0, p.occupancy - minus) };
  }) : data.projection;
  const series = [...data.history.map((h) => ({ at: h.at, occupancy: h.occupancy, future: false })), ...projection.slice(1).map((p) => ({ at: p.at, occupancy: p.occupancy, future: true }))];
  const nowIdx = data.history.length - 1;
  const point = scrub !== null ? series[Math.min(series.length - 1, Math.max(0, scrub))] : null;
  const shownPct = point ? Math.round((point.occupancy / g.capacity) * 100) : g.percent;
  const safe = Math.round((g.capacity * g.safeLimitPct) / 100);
  const fullAt = projection.find((p) => p.occupancy >= g.capacity);
  const minsToFull = g.projection.trend === "rising" ? g.projection.minutesToFull : null;
  const color = crowdColor(g.percent, g.safeLimitPct);
  const cams = data.sensors.filter((s) => s.kind === "camera_counter");
  const entryGate = [...g.gates].sort((a, b) => (b.inPerMin ?? 0) - (a.inPerMin ?? 0)).find((x) => x.kind !== "exit") ?? g.gates[0];

  const setGate = async (gateId: string, status: "open" | "held" | "closed") => {
    setBusy(true);
    try {
      await api(`/api/admin/gates/${gateId}`, { method: "PATCH", body: { status } });
      const name = g.gates.find((x) => x.id === gateId)?.name ?? "Gate";
      setMsg({ ok: true, text: status === "open" ? `${name} reopened. The hold alert was cleared.` : `${name} ${status === "held" ? "is on hold" : "is closed"}. Announced at the gate and shown on kiosks.` });
      await reload();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't change the gate." }); }
    finally { setBusy(false); setGateMenu(null); setConfirmHold(null); }
  };
  const saveCount = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api(`/api/admin/ghats/${g.id}`, { method: "PATCH", body: { occupancy: Number(count) } }); setMsg({ ok: true, text: `Saved ${fmt(Number(count))} people as a staff count. It overrides simulated numbers for 15 minutes.` }); setCount(""); await reload(); }
    catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't save." }); }
    finally { setBusy(false); }
  };

  // Map: zoom the aerial art around this ghat; gates sit around the bathing zone in their real directions.
  const art = `${BASE_PATH}/art/aerial-${dark ? "dark" : "light"}.jpg`;
  const gatesAround = g.gates.map((gt, i) => {
    let dx = gt.mapX - g.mapX, dy = gt.mapY - g.mapY;
    if (Math.abs(dx) + Math.abs(dy) < 0.01) { const a = (i / g.gates.length) * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); }
    const len = Math.hypot(dx, dy);
    return { gt, ux: dx / len, uy: dy / len };
  });

  return (
    <div className="gd">
      <div className="gd-head">
        <h1>{g.name} bathing zone</h1>
        <div className="crumb"><Link href="/admin/map">‹ Live map</Link> · {fmt(g.occupancy)} people · safe limit {fmt(safe)} · {g.source === "simulated" ? "simulated" : g.source === "manual" ? "staff count" : "sensors"} · {updatedAt ? ago(updatedAt) : ""}</div>
      </div>
      <section className="gd-map" aria-label={`${g.name} map`}>
        <div className="gd-art" style={{ backgroundImage: `url(${art})`, backgroundPosition: `${g.mapX}% ${g.mapY}%` }} />
        <div className="m-tint" />
        <div className="gd-grid" />
        <div className="gd-zone" style={{ ["--c" as string]: color }}>
          <div className="gd-zone-card"><b style={{ color: crowdColor(shownPct, g.safeLimitPct) }}>{shownPct}%</b><span>{point ? `${point.future ? "Expected" : "At"} ${istTime(point.at)}` : "Bathing zone"}</span></div>
        </div>
        <svg className="gd-lines" viewBox="-50 -50 100 100" preserveAspectRatio="none" aria-hidden="true">
          {gatesAround.map(({ gt, ux, uy }) => <line key={gt.id} x1={ux * 12} y1={uy * 14} x2={ux * 32} y2={uy * 36} style={{ stroke: gt.status === "open" ? (gt.kind === "exit" ? "var(--crowd-high)" : "var(--crowd-low)") : "var(--crowd-critical)" }} />)}
        </svg>
        {gatesAround.map(({ gt, ux, uy }) => (
          <div key={gt.id} className="gd-gate-wrap" style={{ left: `${50 + ux * 36}%`, top: `${50 + uy * 38}%` }}>
            <button className={`gd-gate ${gt.status}`} onClick={() => can("gates.manage") && setGateMenu(gateMenu === gt.id ? null : gt.id)} aria-haspopup={can("gates.manage") ? "menu" : undefined}>
              <i style={{ background: gt.status !== "open" ? "var(--crowd-critical)" : gt.kind === "exit" ? "var(--crowd-high)" : "var(--crowd-low)" }} />
              <b>{gt.name}</b> {gt.kind === "exit" ? "Exit" : "Entry"} · {gt.status === "open" ? `${gt.kind === "exit" ? gt.outPerMin ?? "—" : gt.inPerMin ?? "—"}/min` : gt.status === "held" ? "on hold" : "closed"}
            </button>
            {gateMenu === gt.id && (
              <div className="gd-gate-menu" role="menu">
                {gt.status !== "held" && <button role="menuitem" disabled={busy} onClick={() => setConfirmHold(gt.id)}><span className="icon sm">front_hand</span>Hold {gt.name}</button>}
                {gt.status !== "closed" && <button role="menuitem" disabled={busy} onClick={() => setGate(gt.id, "closed")}><span className="icon sm">block</span>Close {gt.name}</button>}
                {gt.status !== "open" && <button role="menuitem" disabled={busy} onClick={() => setGate(gt.id, "open")}><span className="icon sm">lock_open</span>Reopen {gt.name}</button>}
              </div>
            )}
          </div>
        ))}
        <div className="m-hud" aria-hidden="true"><i /><i /><i /><i /></div>
        <span className="m-fresh" style={{ bottom: 140 }}><span className="dot" />Live · updated {updatedAt ? ago(updatedAt) : "—"} · {data.sensors.length} sensors{g.source === "simulated" ? " · simulated" : ""}</span>
        <div className="m-coords" style={{ bottom: 140 }} aria-hidden="true"><span>25.4290° N&nbsp;&nbsp;81.8850° E</span><span className="scale"><i />100 m</span></div>
        <div className="gd-replay">
          <div className="top">
            <span className="icon sm">history</span><b>Replay 2 hours · look ahead 1 hour</b>
            <span style={{ flex: 1 }} />
            <div className="gd-seg" role="group" aria-label="Scenario">
              <button aria-pressed={scen === "none"} onClick={() => setScen("none")}>If nothing changes</button>
              <button aria-pressed={scen === "divert"} onClick={() => setScen("divert")} disabled={!divertedPeople.length} title={divertedPeople.length ? `Moves batches ${fixes.map((f) => f.batchNo).join(", ")} elsewhere` : "No over-full batches here to divert"}>If you divert</button>
            </div>
            <button className="live" onClick={() => setScrub(null)}>{scrub === null ? `Live ${istTime(new Date())}` : "Back to live"}</button>
          </div>
          <div className="track">
            <div className="past" style={{ width: `${(nowIdx / Math.max(1, series.length - 1)) * 100}%` }} />
            <div className="future" style={{ left: `${(nowIdx / Math.max(1, series.length - 1)) * 100}%` }} />
            <input type="range" min={0} max={series.length - 1} value={scrub ?? nowIdx} onChange={(e) => setScrub(Number(e.target.value) === nowIdx ? null : Number(e.target.value))} aria-label="Scrub through the last 2 hours and the next hour" aria-valuetext={point ? `${istTime(point.at)}: ${shownPct}%` : `Now: ${g.percent}%`} />
          </div>
          <div className="ticks">
            {series.length > 0 && [0, Math.round(nowIdx / 3), Math.round((nowIdx * 2) / 3)].map((i) => <span key={i} style={{ left: `${(i / (series.length - 1)) * 100}%` }}>{istTime(series[i].at)}</span>)}
            <span className="now" style={{ left: `${(nowIdx / Math.max(1, series.length - 1)) * 100}%` }}>{istTime(series[nowIdx]?.at ?? new Date())} now</span>
            <span className="end" style={{ left: "100%" }}>{series.length ? istTime(series[series.length - 1].at) : ""}</span>
          </div>
        </div>
      </section>

      <aside className="sp gd-side" aria-label="Forecast and actions">
        <div>
          <div className="gd-big" style={{ color: minsToFull !== null && minsToFull <= 180 ? "var(--crowd-critical)" : color }}>{minsToFull !== null && minsToFull <= 180 ? `${minsToFull} min` : g.percent >= g.safeLimitPct ? "Over limit" : `${g.percent}%`}</div>
          <div className="gd-big-sub">{minsToFull !== null && minsToFull <= 180 ? `until ${g.name} is full` : g.projection.trend === "falling" ? `${g.name} is emptying` : `${g.name} · ${g.projection.trend === "rising" ? "rising slowly" : "steady"}, below the ${g.safeLimitPct}% safe limit`}</div>
        </div>
        <div className="gd-flow">
          <div><small><span className="icon sm" style={{ color: "var(--crowd-critical)" }}>south_east</span> Coming in</small><b>{g.flow ? fmt(g.flow.inPerMin) : "—"}<span>/min</span></b></div>
          <div><small><span className="icon sm" style={{ color: "var(--crowd-low)" }}>north_east</span> Going out</small><b>{g.flow ? fmt(g.flow.outPerMin) : "—"}<span>/min</span></b></div>
        </div>
        <div className="gd-chart">
          <b>{scen === "divert" ? "If you divert" : "If nothing changes"}</b>
          <MiniChart now={{ at: series[nowIdx]?.at ?? new Date().toISOString(), occupancy: g.occupancy }} projection={projection} capacity={g.capacity} safe={safe} fullAt={fullAt?.at ?? null} />
        </div>
        {cams.length > 0 && (
          <div className="gd-cams">
            {cams.slice(0, 2).map((c, i) => (
              <Link key={c.id} href="/admin/sensors" className="gd-cam">
                <span className="img" style={{ backgroundImage: `url(${art})`, backgroundPosition: `${g.mapX + (i ? 8 : -6)}% ${g.mapY + (i ? 6 : -4)}%` }}>{c.lastSeenAt && Date.now() - new Date(c.lastSeenAt).getTime() < 180_000 && <i>Live</i>}</span>
                <b>{c.name}</b>
                <small>{c.lastReading?.occupancy !== undefined ? `${fmt(c.lastReading.occupancy)} people in view` : "No reading yet"}{c.simulated ? " · simulated" : ""}</small>
              </Link>
            ))}
          </div>
        )}
        {can("ghats.update") && (
          <details className="gd-count">
            <summary>Enter a staff count</summary>
            <form onSubmit={saveCount} className="a-row" style={{ marginTop: 8 }}>
              <input className="input" style={{ height: 40, maxWidth: 160 }} inputMode="numeric" placeholder={String(g.occupancy)} value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 7))} aria-label={`People at ${g.name} now`} />
              <button className="btn btn-tonal" disabled={!count || busy}>Save</button>
            </form>
          </details>
        )}
        <div style={{ flex: 1 }} />
        <div className="a-row">
          {can("diversions.create") && <Link className="btn btn-filled" href={fixes.length ? `/admin/diversions/new?from=${g.id}&slots=${fixes.map((f) => f.slotId).join(",")}` : `/admin/diversions/new?from=${g.id}`}><span className="icon sm">alt_route</span>{fixes.length ? `Divert ${fixes.length} batch${fixes.length > 1 ? "es" : ""}` : "Divert batches"}</Link>}
          {can("gates.manage") && entryGate && (entryGate.status === "open"
            ? <button className="btn btn-outlined" onClick={() => setConfirmHold(entryGate.id)}><span className="icon sm">block</span>Hold {entryGate.name}</button>
            : <button className="btn btn-outlined" onClick={() => setGate(entryGate.id, "open")} disabled={busy}><span className="icon sm">lock_open</span>Reopen {entryGate.name}</button>)}
        </div>
      </aside>

      {confirmHold && (() => {
        const gt = g.gates.find((x) => x.id === confirmHold)!;
        return (
          <div className="dialog-scrim" role="presentation" onClick={() => setConfirmHold(null)}>
            <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="hold-t" onClick={(e) => e.stopPropagation()}>
              <div style={{ textAlign: "center", color: "var(--primary)" }}><span className="icon">front_hand</span></div>
              <h2 id="hold-t">Hold {gt.name}?</h2>
              <div className="muted" style={{ fontSize: 15 }}>New arrivals wait at {gt.name} until you reopen it. {gt.inPerMin ? `About ${fmt(gt.inPerMin)} people a minute will be asked to wait. ` : ""}Kiosks and volunteers are told straight away.</div>
              <div className="actions"><button className="btn btn-text" onClick={() => setConfirmHold(null)}>Cancel</button><button className="btn btn-filled" disabled={busy} onClick={() => setGate(gt.id, "held")}>Hold {gt.name}</button></div>
            </div>
          </div>
        );
      })()}
      {msg && <div className={`a-snack${msg.ok ? "" : " bad"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
    </div>
  );
}

function MiniChart({ now, projection, capacity, safe, fullAt }: { now: { at: string; occupancy: number }; projection: { at: string; occupancy: number }[]; capacity: number; safe: number; fullAt: string | null }) {
  const pts = [now, ...projection.slice(1)];
  const t0 = new Date(pts[0].at).getTime(), t1 = new Date(pts[pts.length - 1].at).getTime();
  const W = 240, H = 90, x = (at: string) => ((new Date(at).getTime() - t0) / Math.max(1, t1 - t0)) * W, y = (v: number) => H - (Math.min(v, capacity) / capacity) * (H - 6);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.occupancy).toFixed(1)}`).join(" ");
  const fx = fullAt ? x(fullAt) : null;
  return (
    <svg viewBox={`-4 -16 ${W + 8} ${H + 36}`} className="gd-mini" role="img" aria-label={`From ${Math.round((now.occupancy / capacity) * 100)}% now${fullAt ? `, full at ${istTime(fullAt)}` : ""}.`}>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="var(--crowd-critical)" opacity=".12" />
      <path d={line} fill="none" stroke="var(--crowd-critical)" strokeWidth="2" />
      <line x1="0" x2={W} y1={y(safe)} y2={y(safe)} stroke="var(--on-surface-variant)" strokeDasharray="3 3" strokeWidth="1" />
      <text x={W} y={y(safe) - 3} textAnchor="end" className="ax">Safe limit {Math.round((safe / capacity) * 100)}%</text>
      <text x="2" y={y(now.occupancy) + 14} className="ax">{Math.round((now.occupancy / capacity) * 100)}% now</text>
      {fx !== null && <><circle cx={fx} cy={y(capacity)} r="4" fill="var(--crowd-critical)" /><text x={Math.min(W - 40, fx)} y={y(capacity) - 6} textAnchor="middle" className="ax strong">Full at {istTime(fullAt!)}</text></>}
      {[0, 0.33, 0.66, 1].map((f) => <text key={f} x={f * W} y={H + 14} textAnchor={f === 1 ? "end" : f === 0 ? "start" : "middle"} className="ax">{istTime(new Date(t0 + (t1 - t0) * f))}</text>)}
    </svg>
  );
}
