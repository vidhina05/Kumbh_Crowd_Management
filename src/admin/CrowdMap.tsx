"use client";
import { useMemo, useState } from "react";
import { LEVEL, fmt, type GhatLive } from "./types";

/**
 * Schematic map of the mela ground: the Ganga and Yamuna meeting at Sangam, ghats coloured by how full they are.
 * 2D is a plan view. 3D is an isometric view with a column per ghat whose height is how full it is.
 * Positions come from the database (ghats.map_x / map_y, percent of the map).
 */
const W = 1000;
const H = 930;
const GANGA: [number, number][] = [[-2, 10], [14, 14], [28, 22], [40, 31], [48, 41], [53.2, 50.7], [64, 52], [78, 53], [90, 57], [102, 62]];
const YAMUNA: [number, number][] = [[-2, 76], [12, 74], [24, 70], [36, 63], [45, 56], [53.2, 50.7]];
const BRIDGES: [[number, number], [number, number]][] = [[[60, 44], [62, 60]], [[72, 47], [73, 59]], [[40, 58], [45, 66]]];

function smooth(pts: [number, number][]) {
  const p = pts.map(([x, y]) => [x * 10, y * 9.3]);
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x, y] = p[i];
    const [nx, ny] = p[i + 1];
    d += ` Q${x},${y} ${(x + nx) / 2},${(y + ny) / 2}`;
  }
  const last = p[p.length - 1];
  return d + ` L${last[0]},${last[1]}`;
}

export default function CrowdMap({ ghats, selected, onSelect, mode = "2d", showGates = false, compact = false, highlight }: {
  ghats: GhatLive[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  mode?: "2d" | "3d";
  showGates?: boolean;
  compact?: boolean;
  highlight?: { from?: string; to?: string };
}) {
  return mode === "3d" ? <Iso ghats={ghats} selected={selected} onSelect={onSelect} /> : <Plan ghats={ghats} selected={selected} onSelect={onSelect} showGates={showGates} compact={compact} highlight={highlight} />;
}

function Plan({ ghats, selected, onSelect, showGates, compact, highlight }: { ghats: GhatLive[]; selected?: string | null; onSelect?: (id: string) => void; showGates: boolean; compact: boolean; highlight?: { from?: string; to?: string } }) {
  const maxCap = Math.max(...ghats.map((g) => g.capacity), 1);
  const from = ghats.find((g) => g.id === highlight?.from);
  const to = ghats.find((g) => g.id === highlight?.to);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crowd-map" role="group" aria-label="Map of ghats and how full they are">
      <defs>
        <pattern id="grid" width="50" height="46.5" patternUnits="userSpaceOnUse"><path d="M50 0H0V46.5" fill="none" stroke="var(--outline-variant)" strokeWidth="1" opacity="0.5" /></pattern>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--primary)" /></marker>
      </defs>
      <rect width={W} height={H} fill="var(--surface-low)" />
      <rect width={W} height={H} fill="url(#grid)" />
      <path d={smooth(GANGA)} className="river" strokeWidth={compact ? 46 : 58} />
      <path d={smooth(YAMUNA)} className="river yamuna" strokeWidth={compact ? 38 : 48} />
      {!compact && <><text x={180} y={150} className="river-label" transform="rotate(26 180 150)">Ganga</text><text x={150} y={660} className="river-label" transform="rotate(-12 150 660)">Yamuna</text></>}
      {BRIDGES.map(([a, b], i) => <line key={i} x1={a[0] * 10} y1={a[1] * 9.3} x2={b[0] * 10} y2={b[1] * 9.3} className="bridge" />)}
      {from && to && (
        <path d={`M${from.mapX * 10},${from.mapY * 9.3} Q${((from.mapX + to.mapX) / 2) * 10},${Math.min(from.mapY, to.mapY) * 9.3 - 120} ${to.mapX * 10},${to.mapY * 9.3}`} fill="none" stroke="var(--primary)" strokeWidth="6" strokeDasharray="14 10" markerEnd="url(#arrow)" className="route" />
      )}
      {ghats.map((g) => {
        const x = g.mapX * 10, y = g.mapY * 9.3;
        const r = (compact ? 16 : 22) + 22 * Math.sqrt(g.capacity / maxCap);
        const color = g.updatedMinutesAgo === null ? "var(--outline)" : LEVEL[g.level].color;
        const pct = Math.min(100, g.percent);
        const sel = selected === g.id;
        const c = 2 * Math.PI * (r + 6);
        return (
          <g key={g.id} className={`ghat-pin${sel ? " sel" : ""}`} transform={`translate(${x} ${y})`} onClick={() => onSelect?.(g.id)}
            role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${g.name}: ${g.percent}% full, ${LEVEL[g.level].label}`}
            onKeyDown={(e) => { if (onSelect && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(g.id); } }}>
            {g.percent >= g.safeLimitPct && <circle r={r + 18} className="pulse" style={{ stroke: color }} />}
            <circle r={r} fill="var(--surface)" stroke={color} strokeWidth={sel ? 6 : 3} />
            <circle r={r + 6} fill="none" stroke="var(--outline-variant)" strokeWidth="5" />
            <circle r={r + 6} fill="none" stroke={color} strokeWidth="5" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90)" strokeLinecap="round" />
            <text y={6} textAnchor="middle" className="pin-pct">{g.updatedMinutesAgo === null ? "—" : `${g.percent}%`}</text>
            {!compact && <text y={r + 30} textAnchor="middle" className="pin-name">{g.name}</text>}
            {!compact && <text y={r + 50} textAnchor="middle" className="pin-sub">{fmt(g.occupancy)} people</text>}
          </g>
        );
      })}
      {showGates && ghats.flatMap((g) => g.gates.map((gt) => (
        <g key={gt.id} transform={`translate(${gt.mapX * 10} ${gt.mapY * 9.3})`} aria-label={`${g.name} ${gt.name} ${gt.status}`}>
          <rect x={-11} y={-11} width={22} height={22} rx={5} fill={gt.status === "closed" ? "var(--error)" : gt.status === "held" ? "var(--warning)" : "var(--primary)"} />
          <text y={5} textAnchor="middle" className="gate-txt">{gt.kind === "exit" ? "↑" : "↓"}</text>
        </g>
      )))}
    </svg>
  );
}

/** Isometric "3D" view drawn in SVG (works everywhere, no WebGL needed). */
function Iso({ ghats, selected, onSelect }: { ghats: GhatLive[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const [angle, setAngle] = useState(0);
  const proj = useMemo(() => {
    const a = (angle * Math.PI) / 180;
    return (x: number, y: number, z = 0): [number, number] => {
      const cx = x - 50, cy = y - 50;
      const rx = cx * Math.cos(a) - cy * Math.sin(a);
      const ry = cx * Math.sin(a) + cy * Math.cos(a);
      return [500 + (rx - ry) * 6.6, 470 + (rx + ry) * 3.3 - z];
    };
  }, [angle]);
  const poly = (pts: [number, number][]) => pts.map((p) => p.join(",")).join(" ");
  const line = (pts: [number, number][]) => pts.map(([x, y]) => proj(x, y)).map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const ground = poly([proj(0, 0), proj(100, 0), proj(100, 100), proj(0, 100)]);
  const sorted = [...ghats].sort((a, b) => { const pa = proj(a.mapX, a.mapY)[1], pb = proj(b.mapX, b.mapY)[1]; return pa - pb; });
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox="0 0 1000 930" className="crowd-map iso" role="group" aria-label="3D view: column height shows how full each ghat is">
        <polygon points={ground} fill="var(--surface-low)" stroke="var(--outline-variant)" />
        <path d={line(GANGA)} className="river" strokeWidth="34" />
        <path d={line(YAMUNA)} className="river yamuna" strokeWidth="28" />
        {sorted.map((g) => {
          const s = 2.4;
          const h = 30 + Math.min(110, g.percent) * 3.4;
          const color = g.updatedMinutesAgo === null ? "var(--outline)" : LEVEL[g.level].color;
          const b = [proj(g.mapX - s, g.mapY - s), proj(g.mapX + s, g.mapY - s), proj(g.mapX + s, g.mapY + s), proj(g.mapX - s, g.mapY + s)];
          const t = [proj(g.mapX - s, g.mapY - s, h), proj(g.mapX + s, g.mapY - s, h), proj(g.mapX + s, g.mapY + s, h), proj(g.mapX - s, g.mapY + s, h)];
          const safe = 30 + g.safeLimitPct * 3.4;
          const sl = [proj(g.mapX - s, g.mapY + s, safe), proj(g.mapX + s, g.mapY + s, safe), proj(g.mapX + s, g.mapY - s, safe)];
          const sel = selected === g.id;
          return (
            <g key={g.id} className={`iso-col${sel ? " sel" : ""}`} onClick={() => onSelect?.(g.id)} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined}
              aria-label={`${g.name}: ${g.percent}% full`} onKeyDown={(e) => { if (onSelect && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(g.id); } }}>
              <polygon points={poly([b[1], b[2], t[2], t[1]])} fill={color} opacity="0.75" />
              <polygon points={poly([b[2], b[3], t[3], t[2]])} fill={color} opacity="0.55" />
              <polygon points={poly(t)} fill={color} stroke={sel ? "var(--on-surface)" : "none"} strokeWidth="3" />
              <polyline points={poly(sl)} fill="none" stroke="var(--on-surface)" strokeWidth="2" strokeDasharray="5 4" opacity="0.7" />
              <text x={t[0][0]} y={t[0][1] - 10} textAnchor="middle" className="pin-name">{g.name}</text>
              <text x={t[0][0]} y={t[0][1] - 30} textAnchor="middle" className="pin-pct">{g.percent}%</text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", gap: 8, alignItems: "center" }} className="glass iso-ctl">
        <button className="icon-btn" aria-label="Rotate left" onClick={() => setAngle((a) => a - 15)}><span className="icon">rotate_left</span></button>
        <button className="icon-btn" aria-label="Rotate right" onClick={() => setAngle((a) => a + 15)}><span className="icon">rotate_right</span></button>
        <span className="muted" style={{ fontSize: 12, paddingRight: 8 }}>Dashed line: safe limit</span>
      </div>
    </div>
  );
}
