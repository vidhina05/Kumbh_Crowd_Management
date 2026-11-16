"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminApiError, api } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { BASE_PATH } from "@/shared/base";
import { crowdColor } from "@/admin/types";

type Batch = { id: string; batchNo: number; start: string; end: string; booked: number; capacity: number; percent: number; families: number; phase: string };
type Option = { ghatId: string; name: string; gate: string; walkNote: string; before: number; after: number; fits: boolean; avoid: boolean };
type Targets = { from: { ghatId: string; name: string; before: number; after: number }; people: number; families: number; options: Option[]; best: string | null };

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><Divert /></Suspense>;
}

/** Figma "Admin / 06 Divert batches": three steps side by side; the second check is part of step 3. */
function Divert() {
  const qs = useSearchParams();
  const router = useRouter();
  const { live, me, integrations } = useMe();
  const [from, setFrom] = useState(qs.get("from") ?? "");
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [picked, setPicked] = useState<string[]>(qs.get("slot") ? [qs.get("slot")!] : (qs.get("slots")?.split(",").filter(Boolean) ?? []));
  const [targets, setTargets] = useState<Targets | null>(null);
  const [to, setTo] = useState(qs.get("to") ?? "");
  const [approver, setApprover] = useState({ email: "", password: "", code: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!from) return;
    setBatches(null);
    api<{ batches: Batch[] }>(`/api/admin/diversions/plan?ghat=${encodeURIComponent(from)}`).then((r) => setBatches(r.batches)).catch((e) => setErr(e.message));
  }, [from]);
  const key = picked.join(",");
  useEffect(() => {
    if (!from || !picked.length) { setTargets(null); return; }
    api<Targets>("/api/admin/diversions/plan", { body: { fromGhatId: from, slotIds: picked } })
      .then((t) => { setTargets(t); setTo((cur) => (t.options.some((o) => o.ghatId === cur && o.fits) ? cur : t.best ?? t.options.find((o) => o.fits)?.ghatId ?? "")); })
      .catch((e) => setErr(e.message));
  }, [key, from]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => (batches ?? []).filter((b) => b.phase !== "done"), [batches]);
  const toggle = (b: Batch) => {
    if (b.phase !== "later") { setToast(`Batch ${b.batchNo} is bathing now, so it can't be moved.`); return; }
    setPicked((p) => (p.includes(b.id) ? p.filter((x) => x !== b.id) : p.length >= 12 ? p : [...p, b.id]));
  };
  const chosen = list.filter((b) => picked.includes(b.id));
  const opt = targets?.options.find((o) => o.ghatId === to);
  const fromGhat = live?.ghats.find((g) => g.id === from);
  const toGhat = live?.ghats.find((g) => g.id === to);
  const firstStart = chosen.map((b) => b.start).sort()[0];
  const minsToFirst = firstStart ? minutesUntil(firstStart) : null;
  const art = `${BASE_PATH}/art/aerial-${dark ? "dark" : "light"}.jpg`;

  const send = async () => {
    if (!opt) return;
    setBusy(true); setErr(null);
    let createdId: string | null = null;
    try {
      const d = await api<{ id: string }>("/api/admin/diversions", { body: { fromGhatId: from, toGhatId: to, slotIds: picked, reason: "" } });
      createdId = d.id;
      await api(`/api/admin/diversions/${d.id}/approve`, { body: { email: approver.email, password: approver.password, ...(approver.code ? { code: approver.code } : {}) } });
      router.push(`/admin/diversions/view?id=${d.id}`);
    } catch (e) {
      const m = e instanceof AdminApiError ? e.message : "Couldn't send the diversion.";
      setErr(createdId ? `${m} The plan is saved and waiting for a second check.` : m);
      if (createdId) setTimeout(() => router.push(`/admin/diversions/view?id=${createdId}`), 2200);
      setBusy(false);
    }
  };

  return (
    <div className="dv">
      <div className="gd-head" style={{ gridColumn: "1 / -1" }}>
        <h1>Divert batches</h1>
        <div className="crumb"><Link href="/admin/batches">‹ Batch plan</Link> · {fromGhat ? `From ${fromGhat.name}` : "Choose a ghat"} · review all 3 steps, then send</div>
      </div>

      <section className="dv-col" aria-labelledby="s1">
        <span className={`dv-tag${picked.length ? " done" : ""}`}>{picked.length ? "Done" : "To do"}</span>
        <div className="dv-step">Step 1</div>
        <h2 id="s1">Pick batches</h2>
        <select className="input" value={from} onChange={(e) => { setFrom(e.target.value); setPicked([]); }} aria-label="Divert from ghat">
          <option value="">Choose a ghat…</option>
          {[...(live?.ghats ?? [])].sort((a, b) => b.percent - a.percent).map((g) => <option key={g.id} value={g.id}>{g.name} · {g.percent}% now</option>)}
        </select>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>{chosen.length ? `These ${chosen.length} haven't reached the ghat yet, so no one has to turn back mid-crowd.` : "Only batches that haven't started can be moved."}</p>
        <div className="dv-batches">
          {!batches && from && <div className="muted">Loading…</div>}
          {list.map((b) => (
            <label key={b.id} className={`dv-batch${picked.includes(b.id) ? " on" : ""}${b.phase !== "later" ? " locked" : ""}`}>
              <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b)} aria-disabled={b.phase !== "later"} />
              <span className="txt"><b>Batch {b.batchNo}</b><small>{b.families} families · {b.phase !== "later" ? "bathing now" : `${b.booked} people, ${b.percent}% of capacity`}</small></span>
              <span className="t">{b.start}</span>
            </label>
          ))}
        </div>
        <div className="dv-sum">
          <div className="a-row" style={{ justifyContent: "space-between" }}><b>{chosen.length} of {list.length} batches selected</b><b style={{ color: "var(--primary)" }}>{targets?.families ?? 0} families</b></div>
          <small>Batches you leave out stay on plan. Nobody already at the ghat is turned back.</small>
          <div className="segs">{Array.from({ length: Math.min(5, Math.max(1, list.length)) }, (_, i) => <i key={i} className={i < Math.round((chosen.length / Math.max(1, list.length)) * 5) ? "on" : ""} />)}</div>
        </div>
      </section>

      <section className="dv-col" aria-labelledby="s2">
        <span className={`dv-tag${opt ? " done" : ""}`}>{opt ? "Done" : "To do"}</span>
        <div className="dv-step">Step 2</div>
        <h2 id="s2">Choose a ghat</h2>
        {!targets ? <p className="muted" style={{ margin: 0 }}>Pick at least one batch.</p> : (
          <div className="dv-opts" role="radiogroup" aria-label="Ghat to move them to">
            {!targets.options.some((o) => o.fits) && <div className="banner warn" style={{ fontSize: 13 }}>No ghat has room for all of these people at the same times. Choose fewer batches.</div>}
            {targets.options.slice(0, 4).map((o) => {
              const g = live?.ghats.find((x) => x.id === o.ghatId);
              return (
                <label key={o.ghatId} className={`dv-opt${to === o.ghatId ? " on" : ""}${!o.fits ? " no" : ""}`} onClick={() => !o.fits && setToast(`${o.name} would reach ${o.after}%. Choose another ghat.`)}>
                  <span className="thumb" style={{ backgroundImage: `url(${art})`, backgroundPosition: `${g?.mapX ?? 50}% ${g?.mapY ?? 50}%` }} />
                  <span className="txt"><span className="r"><input type="radio" name="to" checked={to === o.ghatId} disabled={!o.fits} onChange={() => { setTo(o.ghatId); setToast(`${o.name} selected${targets.best === o.ghatId ? ": best fit" : ""}.`); }} /><b>{o.name}</b></span><small>{o.fits ? `${o.gate} · ${o.walkNote}` : "Would overflow"}</small></span>
                  {targets.best === o.ghatId ? <span className="chip brand"><span className="icon sm">check</span>Best fit</span> : !o.fits || o.avoid ? <span className="chip">Avoid</span> : null}
                  <span className="nums"><span>{o.before}%</span><span className="icon sm">arrow_forward</span><b style={{ color: crowdColor(o.after) }}>{o.after}%</b><span className="bar"><i style={{ width: `${Math.min(100, o.after)}%`, background: crowdColor(o.after) }} /></span></span>
                </label>
              );
            })}
            {fromGhat && toGhat && (
              <div className="dv-route" style={{ backgroundImage: `url(${art})` }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={`M${fromGhat.mapX},${fromGhat.mapY} Q${(fromGhat.mapX + toGhat.mapX) / 2},${Math.min(fromGhat.mapY, toGhat.mapY) - 12} ${toGhat.mapX},${toGhat.mapY}`} /></svg>
                <span className="pin a" style={{ left: `${fromGhat.mapX}%`, top: `${fromGhat.mapY}%` }} /><span className="pin b" style={{ left: `${toGhat.mapX}%`, top: `${toGhat.mapY}%` }} />
                <span className="lbl" style={{ left: `${toGhat.mapX}%`, top: `${toGhat.mapY}%` }}>{toGhat.name} · {toGhat.gate}</span>
                <span className="lbl top">New route · {fromGhat.name} → {toGhat.name}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="dv-col review" aria-labelledby="s3">
        <span className="dv-tag rev">Review</span>
        <div className="dv-step">Step 3</div>
        <h2 id="s3">What happens</h2>
        {!opt || !targets ? <p className="muted" style={{ margin: 0 }}>Choose batches and a ghat first.</p> : (
          <>
            <div className="dv-big"><span><b>{targets.from.before}%</b><small>{targets.from.name}, these batch times</small></span><span className="icon">arrow_forward</span><span><b style={{ color: "var(--primary)" }}>{targets.from.after}%</b><small>after the move · {opt.name} {opt.before} → {opt.after}%</small></span></div>
            <div className="dv-facts">
              <div><span className="icon">groups</span><span><b>{targets.families.toLocaleString("en-IN")} families, {targets.people.toLocaleString("en-IN")} people</b><small>Batches {chosen.map((b) => b.batchNo).join(", ")}</small></span></div>
              <div><span className="icon">schedule</span><span><b>Same times at {opt.name}</b><small>{chosen.map((b) => b.start).join(", ")} · {opt.gate}</small></span></div>
              <div><span className="icon">badge</span><span><b>Their pass updates</b><small>Kiosks and the pass page show the new ghat</small></span></div>
            </div>
            <small className="muted">How we tell them</small>
            <div className="dv-chips">
              <span className={`chip${integrations.sms ? " brand" : ""}`}><span className="icon sm">{integrations.sms ? "check" : "close"}</span>SMS{integrations.sms ? " in their language" : " (not connected)"}</span>
              <span className="chip brand"><span className="icon sm">check</span>Kiosk</span>
              <span className="chip brand"><span className="icon sm">check</span>Pass page</span>
            </div>
            <div className="dv-wait"><b>If you wait 10 more minutes</b><small>{minsToFirst !== null && minsToFirst <= 10 ? `Batch ${chosen.find((b) => b.start === firstStart)?.batchNo} starts in ${minsToFirst} min and can't be moved after that.` : `${targets.from.name} keeps filling. The first of these batches starts at ${firstStart}.`}</small></div>
            <div className="dv-check">
              <b><span className="icon sm">how_to_reg</span> Second check</b>
              <small>A different staff member who can approve diversions signs in here to confirm. {me.name} can&apos;t approve their own plan.</small>
              <input className="input" type="email" placeholder="Their work email" value={approver.email} onChange={(e) => setApprover({ ...approver, email: e.target.value })} aria-label="Approver's work email" autoComplete="off" />
              <input className="input" type="password" placeholder="Their PIN or password" value={approver.password} onChange={(e) => setApprover({ ...approver, password: e.target.value })} aria-label="Approver's password" autoComplete="new-password" />
              <input className="input mono" inputMode="numeric" placeholder="6-digit code, if they use one" value={approver.code} onChange={(e) => setApprover({ ...approver, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} aria-label="Approver's 6-digit code" />
            </div>
          </>
        )}
        {err && <div className="banner bad" role="alert" style={{ fontSize: 13 }}><span className="icon sm">error</span> {err}</div>}
        <div style={{ flex: 1 }} />
        <div className="a-row" style={{ justifyContent: "space-between" }}>
          <Link className="btn btn-text" href="/admin/batches"><span className="icon sm">arrow_back</span>Back</Link>
          <button className="btn btn-filled" disabled={busy || !opt || !opt.fits || !approver.email || !approver.password} onClick={send}><span className="icon sm">send</span>{busy ? "Sending…" : `Divert ${targets?.families.toLocaleString("en-IN") ?? 0} families`}</button>
        </div>
      </section>
      {toast && <div className="a-snack" role="status">{toast}</div>}
    </div>
  );
}

function minutesUntil(hhmm: string) {
  const ist = new Date(Date.now() + 330 * 60_000);
  const [h, m] = hhmm.split(":").map(Number);
  const d = h * 60 + m - (ist.getUTCHours() * 60 + ist.getUTCMinutes());
  return d >= 0 ? d : d + 1440;
}
