"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ago, api } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { useAdminT } from "@/admin/i18n";
import AerialMap from "@/admin/AerialMap";
import { compactPeople, crowdColor, type GhatLive, type Live } from "@/admin/types";

type Targets = { from: { name: string; before: number; after: number }; families: number; people: number; options: { ghatId: string; name: string; walkNote: string; before: number; after: number; fits: boolean; avoid: boolean }[]; best: string | null };

/** Figma "Admin / 04 Command overview": map pane (2/3) + supporting pane (1/3). */
export default function CommandOverview() {
  const router = useRouter();
  const { live, liveUpdatedAt, can, me } = useMe();
  const { t } = useAdminT();
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  if (!live) return <div className="a-empty" aria-busy="true">Loading live counts…</div>;
  return (
    <div className="ov">
      <AerialMap live={live} mode={mode} onMode={setMode} onSelect={(id) => router.push(`/admin/ghat?id=${id}`)} route={undefined}>
        <span className="m-fresh"><span className="dot" />{t("live")} · {t("updated", { t: liveUpdatedAt ? ago(liveUpdatedAt) : "—" })} · {t("sensorsLabel", { n: live.sensors.online })}{live.totals.sources.includes("simulated") ? ` · ${t("simulated")}` : ""}</span>
        <Slabs live={live} />
      </AerialMap>
      <Supporting live={live} canDivert={can("diversions.create")} meName={me.name} />
    </div>
  );
}

function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 54},${12 - ((v - min) / (max - min || 1)) * 12}`).join(" ");
  return <svg className="spark" viewBox="0 0 54 12" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function Slabs({ live }: { live: Live }) {
  const { t } = useAdminT();
  const p = compactPeople(live.totals.people);
  const s = live.series.people;
  const change = s.length > 3 && s[s.length - 4] > 0 ? Math.round(((s[s.length - 1] - s[s.length - 4]) / s[s.length - 4]) * 100) : null;
  const peak = live.nextPeak;
  return (
    <div className="m-slabs">
      <Link className="m-slab" href="/admin/map"><span className="l">{t("pilgrimsInside")}</span><span className="v"><b>{p.v}</b><span>{p.unit === "lakh" ? t("lakh") : p.unit}</span></span><span className="n">{change === null ? `${live.ghats.length} ghats` : `${change >= 0 ? "+" : ""}${change}% in 15 min`}</span><Spark data={s} color="var(--crowd-critical)" /><i className="live" /></Link>
      <Link className="m-slab" href="/admin/batches"><span className="l">{t("batchesDone")}</span><span className="v"><b>{live.totals.batchesDone}</b><span>{t("of", { n: live.totals.batches })}</span></span><span className="n">{live.totals.overfull ? t("overfull", { n: live.totals.overfull }) : t("onSchedule")}</span><Spark data={live.series.done} color="var(--on-surface-variant)" /><i className="live" /></Link>
      <Link className="m-slab" href="/admin/help"><span className="l">{t("helpRequests")}</span><span className="v"><b>{live.help.open}</b><span>{t("open")}</span></span><span className="n">{t("lostMedical", { lost: live.help.lost + live.lostOpen.length, medical: live.help.medical })}</span><Spark data={live.series.help} color="var(--on-surface-variant)" /><i className="live" /></Link>
      <Link className="m-slab" href="/admin/batches"><span className="l">{t("nextPeak")}</span><span className="v"><b>{peak?.time ?? "—"}</b></span><span className="n">{peak ? t("booked", { n: peak.people.toLocaleString("en-IN") }) : t("noPeak")}</span><Spark data={live.series.demand} color="var(--crowd-high)" /><i className="live" /></Link>
    </div>
  );
}

function Supporting({ live, canDivert, meName }: { live: Live; canDivert: boolean; meName: string }) {
  const { t } = useAdminT();
  const ranked = [...live.ghats].sort((a, b) => b.percent - a.percent);
  const g = ranked[0];
  const over = g && g.percent >= g.safeLimitPct;
  const fixes = live.fixes.filter((f) => f.ghatId === g?.id).slice(0, 3);
  const proposalFrom = fixes.length ? g : live.fixes[0] ? live.ghats.find((x) => x.id === live.fixes[0].ghatId) ?? null : null;
  const proposalSlots = (fixes.length ? fixes : live.fixes.filter((f) => f.ghatId === proposalFrom?.id).slice(0, 3)).map((f) => f.slotId);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [used, setUsed] = useState<string[]>([]);
  const key = proposalSlots.join(",");
  useEffect(() => {
    if (!proposalFrom || !proposalSlots.length || !canDivert) { setTargets(null); return; }
    // Try the batches together; if no ghat has room for all of them at once, propose the fullest one alone.
    void (async () => {
      try {
        let r = await api<Targets>("/api/admin/diversions/plan", { body: { fromGhatId: proposalFrom.id, slotIds: proposalSlots } });
        if (!r.best && proposalSlots.length > 1) { r = await api<Targets>("/api/admin/diversions/plan", { body: { fromGhatId: proposalFrom.id, slotIds: proposalSlots.slice(0, 1) } }); setUsed(proposalSlots.slice(0, 1)); }
        else setUsed(proposalSlots);
        setTargets(r);
      } catch { setTargets(null); }
    })();
  }, [key, proposalFrom?.id, canDivert]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return null;
  const best = targets?.options.find((o) => o.ghatId === targets.best);
  const batchNos = live.fixes.filter((f) => used.includes(f.slotId)).map((f) => f.batchNo);
  const firstStart = live.fixes.filter((f) => used.includes(f.slotId)).map((f) => f.start).sort()[0];
  const minsLeft = firstStart ? minutesUntil(firstStart) : null;
  const ratePer10 = g.flow ? Math.round(((g.flow.inPerMin - g.flow.outPerMin) * 10 / g.capacity) * 100) : 0;
  const trend = g.projection.trend === "rising" ? `${t("rising")} ${Math.max(1, ratePer10)}% / 10 min` : t(g.projection.trend);
  const watching = live.onShift.filter((n) => n !== meName).slice(0, 3);
  const others = ranked.slice(1, 4);

  return (
    <aside className="sp" aria-label="Needs attention">
      {over && <div className="danger-glow" aria-hidden="true" />}
      <div className="status">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`needs${over ? "" : " ok"}`}><span className="icon sm">{over ? "priority_high" : "check"}</span>{over ? t("needsYouNow") : t("allClear")}</span>
          <span style={{ flex: 1 }} />
          {watching.length > 0 && <span className="watch"><span style={{ display: "flex" }}>{watching.slice(0, 2).map((n) => <span key={n} className="av">{n.replace(/^Dr\.?\s+/, "").split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>)}</span><span style={{ marginLeft: 10 }}>+ {watching.map((n) => n.replace(/^Dr\.?\s+/, "").split(" ")[0]).join(", ")}</span></span>}
        </div>
        <Link className="hero" href={`/admin/ghat?id=${g.id}`} style={{ textDecoration: "none", color: "inherit", display: "grid" }}>
          <span className="big" style={{ color: crowdColor(g.percent, g.safeLimitPct) }}>{g.percent}%</span>
          <span className="name">{g.name}</span>
        </Link>
        <p className="why">
          {over ? t("overLimit", { limit: g.safeLimitPct, trend }) : t("underLimit", { limit: g.safeLimitPct, trend: trend[0].toUpperCase() + trend.slice(1) })}{" "}
          {g.projection.trend === "rising" && g.projection.minutesToFull !== null && g.projection.minutesToFull <= 240 ? t("fullIn", { m: g.projection.minutesToFull }) : ""}
        </p>
      </div>
      <div className="bar8" aria-hidden="true"><i style={{ width: `${Math.min(100, g.percent)}%`, background: crowdColor(g.percent, g.safeLimitPct) }} /><i /></div>

      {targets && best && batchNos.length > 0 ? (
        <div className="proposal">
          <div className="head"><span className="icon sm">auto_awesome</span>{t("sahayakProposes")}<span className="pill">{best.fits ? "Has room" : "Tight"}</span></div>
          <b style={{ fontSize: 14, fontWeight: 500 }}>Divert batch{batchNos.length > 1 ? "es" : ""} {batchNos.join(", ").replace(/, (\d+)$/, " and $1")} to {best.name}.</b>
          <div className="nums">
            <span><small>{targets.from.name}</small><b style={{ color: "var(--crowd-low)" }}>{targets.from.before} → {targets.from.after}%</b></span>
            <span><small>{best.name}</small><b style={{ color: crowdColor(best.after) }}>{best.before} → {best.after}%</b></span>
            <span><small>Families</small><b>{targets.families}</b></span>
          </div>
          {minsLeft !== null && <div className="count"><span className="track"><i style={{ width: `${Math.max(4, Math.min(100, (minsLeft / 120) * 100))}%` }} /></span>{t("planHolds", { m: minsLeft })}</div>}
          <div className="muted" style={{ fontSize: 11 }}>Worked out from bookings and capacity, not AI. A second staff member must approve.</div>
        </div>
      ) : (
        <div className="proposal"><div className="head"><span className="icon sm">auto_awesome</span>{t("sahayakProposes")}</div><span className="muted" style={{ fontSize: 14 }}>{live.fixes.length && targets && !best ? `${live.fixes.length} batches are over-full, but no ghat has room for them at the same time. Hold them at camp or move them later.` : t("nothingToDivert")}</span></div>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {canDivert && targets && best && <Link className="btn btn-filled" href={`/admin/diversions/new?from=${proposalFrom!.id}&slots=${used.join(",")}&to=${best.ghatId}`}><span className="icon sm">alt_route</span>{used.length === 1 ? "Divert 1 batch" : t("divertN", { n: used.length })}</Link>}
        <Link className="btn btn-text" href={`/admin/ghat?id=${g.id}`}><span className="icon sm">open_in_full</span>{t("viewGhat")}</Link>
      </div>
      <hr />
      <div style={{ display: "flex", alignItems: "center" }}><b style={{ fontSize: 16, fontWeight: 500, flex: 1 }}>{t("otherGhats")}</b><Link className="btn btn-text" href="/admin/map"><span className="icon sm">arrow_forward</span>{t("allN", { n: live.ghats.length })}</Link></div>
      {others.map((o) => <OtherGhat key={o.id} g={o} />)}
    </aside>
  );
}

function OtherGhat({ g }: { g: GhatLive }) {
  const c = crowdColor(g.percent, g.safeLimitPct);
  return (
    <Link className="og" href={`/admin/ghat?id=${g.id}`}>
      <div><span className="t">{g.name}</span><span className="b"><i style={{ width: `${Math.min(100, g.percent) * 0.77}%`, background: c }} /><i /></span></div>
      <span className="p" style={{ color: c }}>{g.percent}%</span>
    </Link>
  );
}

function minutesUntil(hhmm: string) {
  const ist = new Date(Date.now() + 330 * 60_000);
  const [h, m] = hhmm.split(":").map(Number);
  const now = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const d = h * 60 + m - now;
  return d >= 0 ? d : d + 1440;
}
