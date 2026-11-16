"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/shared/base";
import { useAdminT } from "./i18n";
import { crowdColor, type GhatLive, type Live } from "./types";

/**
 * Figma "Map pane": aerial art of the Sangam, a tint, a coordinate grid, ringed pins with crowd pillars and
 * glass callouts. 3D tilts the ground plane so the pillars stand up (drag to tilt, scroll to zoom).
 * Pin positions are each ghat's map_x / map_y (percent of the pane), taken from the Figma frame.
 */
export type Layer = "crowd" | "gates" | "cameras" | "kiosks";

export default function AerialMap({ live, mode, onMode, selected, onSelect, callouts = 5, route, showLayers = true, children }: {
  live: Live;
  mode: "2d" | "3d";
  onMode?: (m: "2d" | "3d") => void;
  selected?: string | null;
  onSelect?: (id: string) => void;
  callouts?: number;
  route?: { from?: string; to?: string };
  showLayers?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useAdminT();
  const pane = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 860, h: 900 });
  const [layers, setLayers] = useState<Set<Layer>>(new Set(["crowd", "gates"]));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tilt, setTilt] = useState({ x: 52, z: -18 });
  const [dark, setDark] = useState(false);
  const drag = useRef<{ x: number; y: number; tx: number; tz: number; px: number; py: number } | null>(null);

  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const read = () => setDark(document.documentElement.dataset.theme === "dark");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const toggle = (l: Layer) => setLayers((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; });
  const px = (g: { mapX: number; mapY: number }) => ({ x: (g.mapX / 100) * size.w, y: (g.mapY / 100) * size.h });
  const ranked = [...live.ghats].sort((a, b) => b.percent - a.percent);
  const want = ranked.slice(0, callouts).map((g) => g.id);
  if (selected && !want.includes(selected)) want.unshift(selected);
  const spots = placeCallouts(want.map((id) => ({ id, p: px(live.ghats.find((g) => g.id === id)!) })), size);
  const labelled = new Set(spots.keys());
  const is3d = mode === "3d";
  const stage = is3d
    ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom * 0.86}) rotateX(${tilt.x}deg) rotateZ(${tilt.z}deg)`
    : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,a")) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: tilt.x, tz: tilt.z, px: pan.x, py: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (is3d && !e.shiftKey) setTilt({ x: Math.max(20, Math.min(70, d.tx - dy * 0.2)), z: d.tz + dx * 0.25 });
    else setPan({ x: d.px + dx, y: d.py + dy });
  };
  const onWheel = (e: React.WheelEvent) => { setZoom((z) => Math.max(0.6, Math.min(2.5, z * (e.deltaY < 0 ? 1.1 : 0.9)))); };
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); setTilt({ x: 52, z: -18 }); };

  const from = live.ghats.find((g) => g.id === route?.from);
  const to = live.ghats.find((g) => g.id === route?.to);

  return (
    <div className={`m-pane${is3d ? " is3d" : ""}`} ref={pane} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onWheel={onWheel}
      role="group" aria-label={is3d ? "3D map: drag to tilt, scroll to zoom" : "Map of the ghats: drag to move, scroll to zoom"}>
      <div className="m-stage" style={{ transform: stage }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="m-art" src={`${BASE_PATH}/art/aerial-${dark ? "dark" : "light"}.jpg`} alt="" draggable={false} />
        <div className="m-tint" />
        <svg className="m-grid" width={size.w} height={size.h} aria-hidden="true">
          {Array.from({ length: Math.ceil(size.w / 48) }, (_, i) => <line key={`v${i}`} x1={i * 48} x2={i * 48} y1={0} y2={size.h} />)}
          {Array.from({ length: Math.ceil(size.h / 48) }, (_, i) => <line key={`h${i}`} y1={i * 48} y2={i * 48} x1={0} x2={size.w} />)}
          {from && to && (() => {
            const a = px(from), b = px(to);
            return <path className="m-route" d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - 90} ${b.x},${b.y}`} />;
          })()}
          {!is3d && layers.has("crowd") && live.ghats.filter((g) => labelled.has(g.id)).map((g) => {
            const p = px(g), c = spots.get(g.id)!;
            return <polyline key={g.id} className="m-leader" points={`${p.x},${p.y} ${c.ax},${p.y - Math.min(40, Math.abs(p.y - c.ay))} ${c.ax},${c.ay}`} style={{ stroke: crowdColor(g.percent, g.safeLimitPct) }} />;
          })}
        </svg>
        {layers.has("gates") && live.ghats.flatMap((g) => g.gates.map((gt) => {
          const p = px(gt);
          return <span key={gt.id} className={`m-gate ${gt.status}`} style={{ left: p.x, top: p.y }} title={`${g.name} ${gt.name}: ${gt.status}`} aria-label={`${g.name} ${gt.name} ${gt.status}`}><span className="icon">{gt.kind === "exit" ? "logout" : "login"}</span></span>;
        }))}
        {layers.has("cameras") && live.cameras.map((c) => {
          const p = px(c);
          return <span key={c.id} className={`m-cam${c.online ? "" : " off"}`} style={{ left: p.x, top: p.y }} title={`${c.name}${c.count !== null ? `: ${c.count} people in view` : ""}${c.simulated ? " (simulated)" : ""}`}><span className="icon">videocam</span></span>;
        })}
        {layers.has("kiosks") && live.kioskPins.map((k) => {
          const p = px(k);
          return <span key={k.id} className={`m-kiosk${k.online ? "" : " off"}`} style={{ left: p.x, top: p.y }} title={`Kiosk ${k.id} · ${k.location} · ${k.online ? "online" : "offline"}`}><span className="icon">desktop_windows</span></span>;
        })}
        {layers.has("crowd") && live.ghats.map((g) => <Pin key={g.id} g={g} p={px(g)} is3d={is3d} sel={selected === g.id} onSelect={onSelect} label={is3d || !labelled.has(g.id)} flip={px(g).x > size.w - 170} />)}
        {!is3d && layers.has("crowd") && live.ghats.filter((g) => labelled.has(g.id)).map((g) => {
          const c = spots.get(g.id)!;
          return (
            <button key={g.id} className={`m-callout${selected === g.id ? " sel" : ""}`} style={{ left: c.x, top: c.y }} onClick={() => onSelect?.(g.id)} aria-label={`${g.name}: ${g.percent}% full`}>
              <span className="row"><b className="pct" style={{ color: crowdColor(g.percent, g.safeLimitPct) }}>{g.percent}%</b><span className="name">{g.name}</span></span>
              <span className="sub">{status(g)}</span>
            </button>
          );
        })}
      </div>

      <div className="m-hud" aria-hidden="true"><i /><i /><i /><i /></div>
      {showLayers && (
        <div className="m-layers" role="group" aria-label="Map layers">
          {(["crowd", "gates", "cameras", "kiosks"] as Layer[]).map((l) => (
            <button key={l} className="m-chip" aria-pressed={layers.has(l)} onClick={() => toggle(l)}>
              {layers.has(l) && <span className="icon sm">check</span>}{l === "kiosks" ? t("kiosks") : t(l)}
            </button>
          ))}
        </div>
      )}
      {onMode && (
        <div className="m-mode" role="group" aria-label="2D or 3D">
          <button aria-pressed={!is3d} onClick={() => onMode("2d")}>2D</button>
          <button aria-pressed={is3d} onClick={() => onMode("3d")}>3D</button>
        </div>
      )}
      <div className="m-ctrls" role="group" aria-label="Map controls">
        <button className="icon-btn" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, z * 1.2))}><span className="icon">add</span></button>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, z / 1.2))}><span className="icon">remove</span></button>
        <button className="icon-btn" aria-label="Centre the map" onClick={reset}><span className="icon">my_location</span></button>
        {onMode && <button className="icon-btn" aria-label={is3d ? "Flat view" : "3D view"} aria-pressed={is3d} onClick={() => onMode(is3d ? "2d" : "3d")}><span className="icon">view_in_ar</span></button>}
      </div>
      <div className="m-coords" aria-hidden="true"><span>25.4290° N&nbsp;&nbsp;81.8850° E</span><span className="scale"><i />500 m</span></div>
      <span className="m-north" aria-hidden="true">N ↑</span>
      {children}
    </div>
  );

  function status(g: GhatLive) {
    if (g.percent >= g.safeLimitPct) return g.projection.trend === "rising" ? `Over limit · rising` : "Over the safe limit";
    if (g.projection.trend === "rising" && g.projection.minutesToSafeLimit !== null && g.projection.minutesToSafeLimit < 120) return `${g.safeLimitPct}% in ~${g.projection.minutesToSafeLimit} min`;
    const room = Math.max(0, Math.round(((g.safeLimitPct - g.percent) / 100) * g.capacity));
    return `${g.projection.trend === "steady" ? "Steady · " : g.projection.trend === "falling" ? "Emptying · " : ""}room for ${room.toLocaleString("en-IN")}`;
  }
}

/** Place callouts next to their pins without overlapping each other, the HUD or the number slabs. */
function placeCallouts(pins: { id: string; p: { x: number; y: number } }[], size: { w: number; h: number }) {
  const W = 210, H = 62, placed: { x: number; y: number }[] = [];
  const out = new Map<string, { x: number; y: number; ax: number; ay: number }>();
  const hit = (x: number, y: number) => placed.some((r) => x < r.x + W + 8 && x + W + 8 > r.x && y < r.y + H + 8 && y + H + 8 > r.y);
  for (const { id, p } of pins) {
    const cands = [[64, -100], [-64 - W, -100], [64, 30], [-64 - W, 30], [64, -170], [-64 - W, -170], [64, 90], [-64 - W, 90]];
    let best: { x: number; y: number } | null = null;
    for (const [dx, dy] of cands) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 16 || x + W > size.w - 70 || y < 60 || y + H > size.h - 170) continue;
      if (!hit(x, y)) { best = { x, y }; break; }
    }
    if (!best) continue;
    placed.push(best);
    const right = best.x > p.x;
    out.set(id, { ...best, ax: right ? best.x : best.x + W, ay: best.y + H / 2 });
  }
  return out;
}

function Pin({ g, p, is3d, sel, onSelect, label, flip }: { g: GhatLive; p: { x: number; y: number }; is3d: boolean; sel: boolean; onSelect?: (id: string) => void; label: boolean; flip: boolean }) {
  const color = g.updatedMinutesAgo === null ? "var(--outline)" : crowdColor(g.percent, g.safeLimitPct);
  const over = g.percent >= g.safeLimitPct;
  const h = 18 + Math.min(110, g.percent) * (is3d ? 1.6 : 1.05);
  return (
    <div className={`m-pin${sel ? " sel" : ""}${over ? " over" : ""}`} style={{ left: p.x, top: p.y, ["--c" as string]: color }}>
      <span className="ring outer" />
      <span className="ring inner" />
      <span className="pillar" style={{ height: h }}>{is3d && label && <span className="cap"><b>{g.percent}%</b> {g.name}</span>}</span>
      <button className="dot" onClick={() => onSelect?.(g.id)} aria-label={`${g.name}: ${g.percent}% full`} />
      {!is3d && label && <span className={`tag${flip ? " flip" : ""}`}>{g.name} · {g.percent}%</span>}
    </div>
  );
}
