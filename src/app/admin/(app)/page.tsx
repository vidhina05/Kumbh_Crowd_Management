"use client";
import { useState } from "react";
import { api, ago, istTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { LANGUAGES } from "@/shared/languages";

type Ghat = { id: string; name: string; gate: string; capacity: number; occupancy: number; percent: number; level: string; source: string; updatedMinutesAgo: number | null; meetingPoint: string };
type Overview = {
  generatedAt: string; today: string; registrationsToday: number; peopleToday: number; bandsToday: number;
  slotsToday: { capacity: number; booked: number }; openHelp: Record<string, number>; openHelpTotal: number; openLost: number;
  alerts: { id: string; severity: string; title: string; message: string; createdAt: string }[];
  kiosks: { online: number; total: number }; ghats: Ghat[]; languagesToday: { language: string; n: number }[];
};

const LEVEL: Record<string, { label: string; chip: string }> = {
  calm: { label: "Calm", chip: "good" },
  moderate: { label: "Moderate", chip: "warn" },
  busy: { label: "Busy", chip: "bad" },
  very_busy: { label: "Very busy", chip: "bad" },
};

export default function OverviewPage() {
  const { can } = useMe();
  const { data, error, reload, updatedAt } = usePoll<Overview>("/api/admin/overview", 10_000);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (g: Ghat) => {
    setMsg(null);
    try {
      await api(`/api/admin/ghats/${g.id}`, { method: "PATCH", body: { occupancy: Number(value) } });
      setEditing(null);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    }
  };

  if (error && !data) return <div className="banner bad">{error}</div>;
  if (!data) return <div className="a-empty">Loading live counts…</div>;
  const worst = [...data.ghats].sort((a, b) => b.percent - a.percent)[0];
  const stale = data.ghats.filter((g) => g.updatedMinutesAgo === null || g.updatedMinutesAgo > 15);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Command overview</h1>
        {worst && worst.updatedMinutesAgo !== null && (
          <span className={`chip ${LEVEL[worst.level].chip}`}><span className="dot" /> {LEVEL[worst.level].label} · {worst.name} {worst.percent}%</span>
        )}
        <span className="a-provenance"><span className="icon sm">sync</span> Updated {updatedAt ? ago(updatedAt) : "—"} · refreshes every 10 s</span>
      </div>
      {error && <div className="banner warn"><span className="icon">cloud_off</span> Showing the last numbers we received. {error}</div>}

      <div className="a-kpis">
        <Kpi label="Families registered today" value={data.registrationsToday} />
        <Kpi label="People registered today" value={data.peopleToday} note={`${data.bandsToday} wristbands`} />
        <Kpi label="Slot seats booked today" value={data.slotsToday.booked.toLocaleString("en-IN")} note={`of ${data.slotsToday.capacity.toLocaleString("en-IN")}`} />
        <Kpi label="Open help requests" value={data.openHelpTotal} note={Object.entries(data.openHelp).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ") || "none"} />
        <Kpi label="Open lost-person cases" value={data.openLost} />
        <Kpi label="Kiosks online" value={`${data.kiosks.online} / ${data.kiosks.total}`} />
      </div>

      <div className="a-grid-2">
        <section className="glass a-pane" aria-labelledby="ghats-h">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 id="ghats-h" style={{ flex: 1 }}>Ghats · crowd now</h2>
          </div>
          <div className="banner info" style={{ fontSize: 13 }}>
            <span className="icon sm">info</span> No crowd sensors are connected. These numbers are typed in by staff, with the time they were entered.
          </div>
          {stale.length > 0 && <div className="banner warn" style={{ fontSize: 13 }}><span className="icon sm">schedule</span> {stale.map((g) => g.name).join(", ")}: not updated in the last 15 minutes.</div>}
          {msg && <div className="banner bad">{msg}</div>}
          <div>
            {data.ghats.map((g) => (
              <div className="a-ghat" key={g.id}>
                <div>
                  <b>{g.name}</b> <span className="muted">· {g.gate} · capacity {g.capacity.toLocaleString("en-IN")}</span>
                  <div className="bar" style={{ margin: "8px 0 6px" }}>{g.updatedMinutesAgo !== null && <i className={`level-${g.level}-bg`} style={{ width: `${Math.min(100, g.percent)}%` }} />}</div>
                  <div className="a-provenance">
                    {g.updatedMinutesAgo === null ? "No count entered yet" : `${g.occupancy.toLocaleString("en-IN")} people · entered by staff ${g.updatedMinutesAgo} min ago`}
                    {can("ghats.update") && editing !== g.id && (
                      <button className="btn btn-text" style={{ height: 28, padding: "0 8px" }} onClick={() => { setEditing(g.id); setValue(String(g.occupancy)); }}>Update count</button>
                    )}
                  </div>
                  {editing === g.id && (
                    <form style={{ display: "flex", gap: 8, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void save(g); }}>
                      <input className="input" style={{ height: 40, maxWidth: 180 }} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} aria-label={`People at ${g.name} now`} autoFocus />
                      <button className="btn btn-filled" disabled={!value}>Save</button>
                      <button type="button" className="btn btn-text" onClick={() => setEditing(null)}>Cancel</button>
                    </form>
                  )}
                </div>
                <div>
                  <div className={g.updatedMinutesAgo === null ? "pct muted" : `pct level-${g.level}`}>{g.updatedMinutesAgo === null ? "—" : `${g.percent}%`}</div>
                  {g.updatedMinutesAgo !== null && <span className={`chip ${LEVEL[g.level].chip}`}>{LEVEL[g.level].label}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div style={{ display: "grid", gap: 16 }}>
          <section className="glass a-pane" aria-labelledby="alerts-h">
            <h2 id="alerts-h">Active alerts</h2>
            {data.alerts.length === 0 ? <div className="muted">No active alerts.</div> : data.alerts.map((a) => (
              <div key={a.id} className={`banner ${a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}`}>
                <span className="icon">{a.severity === "critical" ? "error" : "campaign"}</span>
                <div><b>{a.title}</b><div style={{ fontSize: 13 }}>{a.message}</div><div style={{ fontSize: 11, opacity: 0.8 }}>{istTime(a.createdAt)}</div></div>
              </div>
            ))}
          </section>
          <section className="glass a-pane" aria-labelledby="lang-h">
            <h2 id="lang-h">Languages chosen at kiosks today</h2>
            {data.languagesToday.length === 0 ? <div className="muted">No registrations yet today.</div> : data.languagesToday.map((l) => {
              const max = data.languagesToday[0].n;
              const name = LANGUAGES.find((x) => x.code === l.language)?.english ?? l.language;
              return (
                <div key={l.language} style={{ display: "grid", gridTemplateColumns: "100px 1fr 40px", gap: 8, alignItems: "center" }}>
                  <span>{name}</span><div className="bar"><i style={{ width: `${(l.n / max) * 100}%` }} /></div><b style={{ textAlign: "right" }}>{l.n}</b>
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="a-kpi">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {note && <div className="l">{note}</div>}
    </div>
  );
}
