"use client";
import { usePoll } from "@/admin/client";
import { LANGUAGES } from "@/shared/languages";

type R = {
  today: string;
  hourly: { hour: number; n: number }[];
  byKiosk: { kiosk: string | null; n: number }[];
  helpTimes: { type: string; resolved: number; total: number; avgMinutes: number | null }[];
  lost: { total: number; reunited: number; avgMinutes: number | null };
  languages: { language: string; n: number }[];
};

export default function ReportsPage() {
  const { data, error } = usePoll<R>("/api/admin/reports", 60_000);
  if (error && !data) return <div className="banner bad">{error}</div>;
  if (!data) return <div className="a-empty">Loading…</div>;
  const hours = Array.from({ length: 24 }, (_, h) => data.hourly.find((x) => x.hour === h)?.n ?? 0);
  const max = Math.max(1, ...hours);
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Reports · today</h1>
        <span className="muted">{data.today} (IST) · from live records, refreshed every minute</span>
      </div>
      <section className="glass a-pane">
        <h2>Registrations by hour</h2>
        {hours.every((h) => h === 0) ? <div className="a-empty">No registrations yet today.</div> : (
          <>
            <div className="a-chart" role="img" aria-label={`Registrations by hour: ${hours.map((n, h) => `${h}:00 ${n}`).filter((_, h) => hours[h]).join(", ")}`}>
              {hours.map((n, h) => <div key={h} className="b" style={{ height: `${(n / max) * 100}%` }}>{n > 0 && <span>{n}</span>}</div>)}
            </div>
            <div className="a-axis">{hours.map((_, h) => <span key={h}>{h % 3 === 0 ? h : ""}</span>)}</div>
          </>
        )}
      </section>
      <div className="a-grid-2">
        <section className="glass a-pane">
          <h2>Help requests · response</h2>
          {data.helpTimes.length === 0 ? <div className="muted">No help requests today.</div> : (
            <table className="tbl"><thead><tr><th>Type</th><th>Raised</th><th>Resolved</th><th>Average time to resolve</th></tr></thead>
              <tbody>{data.helpTimes.map((h) => <tr key={h.type}><td>{h.type.replace("_", " ")}</td><td>{h.total}</td><td>{h.resolved}</td><td>{h.avgMinutes === null ? "—" : `${h.avgMinutes} min`}</td></tr>)}</tbody></table>
          )}
          <h2>Lost &amp; found</h2>
          <div>{data.lost.total} cases today · {data.lost.reunited} reunited{data.lost.avgMinutes !== null && ` · average ${data.lost.avgMinutes} min to reunite`}</div>
        </section>
        <section className="glass a-pane">
          <h2>Kiosk use</h2>
          {data.byKiosk.length === 0 ? <div className="muted">No registrations yet today.</div> : data.byKiosk.map((k) => <div key={k.kiosk ?? "none"} style={{ display: "flex", justifyContent: "space-between" }}><span className="mono">{k.kiosk ?? "—"}</span><b>{k.n}</b></div>)}
          <h2>Languages</h2>
          {data.languages.length === 0 ? <div className="muted">—</div> : data.languages.map((l) => <div key={l.language} style={{ display: "flex", justifyContent: "space-between" }}><span>{LANGUAGES.find((x) => x.code === l.language)?.english ?? l.language}</span><b>{l.n}</b></div>)}
        </section>
      </div>
    </>
  );
}
