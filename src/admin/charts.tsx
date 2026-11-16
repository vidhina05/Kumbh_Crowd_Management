"use client";
/** Small dependency-free line chart: solid history, dashed projection, and a safe-limit line. */
export function LineChart({ history, projection, capacity, safeLimitPct, height = 220 }: {
  history: { at: string; occupancy: number; source?: string }[];
  projection?: { at: string; occupancy: number }[];
  capacity: number;
  safeLimitPct: number;
  height?: number;
}) {
  const all = [...history, ...(projection ?? [])];
  if (!all.length) return <div className="a-empty">No readings yet.</div>;
  const t0 = new Date(all[0].at).getTime();
  const t1 = Math.max(new Date(all[all.length - 1].at).getTime(), t0 + 60_000);
  const maxY = Math.max(capacity, ...all.map((p) => p.occupancy)) * 1.05;
  const w = 640, h = height, pl = 52, pr = 12, pt = 12, pb = 26;
  const x = (at: string) => pl + ((new Date(at).getTime() - t0) / (t1 - t0)) * (w - pl - pr);
  const y = (v: number) => pt + (1 - v / maxY) * (h - pt - pb);
  const path = (pts: { at: string; occupancy: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.occupancy).toFixed(1)}`).join(" ");
  const safe = (capacity * safeLimitPct) / 100;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  const timeTicks = Array.from({ length: 5 }, (_, i) => new Date(t0 + ((t1 - t0) * i) / 4));
  const last = history[history.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="line-chart" role="img" aria-label={`People over time. Now ${last?.occupancy ?? 0}. Safe limit ${Math.round(safe)}.`}>
      {ticks.map((v) => <g key={v}><line x1={pl} x2={w - pr} y1={y(v)} y2={y(v)} stroke="var(--outline-variant)" strokeWidth="1" /><text x={pl - 6} y={y(v) + 4} textAnchor="end" className="ax">{v >= 1000 ? `${Math.round(v / 1000)}k` : v}</text></g>)}
      {timeTicks.map((d, i) => <text key={i} x={pl + (i / 4) * (w - pl - pr)} y={h - 6} textAnchor="middle" className="ax">{d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}</text>)}
      <line x1={pl} x2={w - pr} y1={y(safe)} y2={y(safe)} stroke="var(--error)" strokeWidth="2" strokeDasharray="6 5" />
      <text x={w - pr} y={y(safe) - 6} textAnchor="end" className="ax" style={{ fill: "var(--error)" }}>Safe limit {safeLimitPct}%</text>
      {history.length > 1 && <path d={`${path(history)} L${x(last.at)},${y(0)} L${x(history[0].at)},${y(0)} Z`} fill="var(--primary)" opacity="0.10" />}
      <path d={path(history)} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinejoin="round" />
      {projection && projection.length > 1 && <path d={path(projection)} fill="none" stroke="var(--primary)" strokeWidth="3" strokeDasharray="8 6" opacity="0.8" />}
      {last && <circle cx={x(last.at)} cy={y(last.occupancy)} r="6" fill="var(--primary)" stroke="var(--surface)" strokeWidth="2" />}
    </svg>
  );
}
