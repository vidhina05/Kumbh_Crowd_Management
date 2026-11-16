"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, istDateTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { LANGUAGES } from "@/shared/languages";

type Row = { id: string; passCode: string; leaderName: string; homeTown: string; people: number; status: string; phoneLast4: string; ghat: string; day: string; start: string; batchNo: number };
type Detail = {
  id: string; passCode: string; leaderName: string; phoneLast4: string; homeTown: string; language: string; status: string; meetingPoint: string; slotChangesLeft: number;
  registeredAt: string; kiosk: { id: string; name: string; location: string } | null; consent: { version: string; at: string; photo: boolean }; deleteAfter: string;
  slot: { day: string; start: string; end: string; batchNo: number }; ghat: { name: string; gate: string };
  members: { id: string; name: string; age: number; relation: string; needs: string[]; isLeader: boolean; bandId: string | null; hasPhoto: boolean }[];
  lostCases: { id: string; code: string; status: string; personName: string }[]; helpRequests: { id: string; code: string; status: string; type: string }[];
};
const STATUS: Record<string, { label: string; tone: string }> = {
  registered: { label: "Registered", tone: "info" }, on_the_way: { label: "On the way", tone: "brand" }, bathing: { label: "In bathing slot", tone: "good" }, left: { label: "Left the Mela", tone: "" },
};
const FILTERS = [["all", "All"], ["on_the_way", "On the move"], ["bathing", "Bathing"], ["registered", "Registered"], ["left", "Left"]] as const;
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const NEED: Record<string, string> = { wheelchair: "uses a wheelchair", elderly: "elderly", medical: "medical need", child: "child" };

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><Families /></Suspense>;
}

/** Figma "Admin / 09 Families". */
function Families() {
  const { can, live } = useMe();
  const qs = useSearchParams();
  const [q, setQ] = useState(qs.get("q") ?? "");
  const [query, setQuery] = useState(q);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  useEffect(() => { const h = setTimeout(() => setQuery(q), 300); return () => clearTimeout(h); }, [q]);
  const { data, error } = usePoll<{ families: Row[] }>(`/api/admin/families?q=${encodeURIComponent(query)}`, 15_000);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (sel) api<Detail>(`/api/admin/families/${sel}`).then(setDetail).catch((e) => setToast({ ok: false, text: e.message })); else setDetail(null); }, [sel]);
  useEffect(() => { if (!sel && data?.families.length === 1) setSel(data.families[0].id); }, [data, sel]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  const rows = (data?.families ?? []).filter((f) => filter === "all" || f.status === filter);

  const setStatus = async (status: string) => {
    if (!detail) return;
    setBusy(true);
    try { setDetail(await api<Detail>(`/api/admin/families/${detail.id}`, { method: "PATCH", body: { status } })); setToast({ ok: true, text: `${detail.leaderName} family: ${STATUS[status].label.toLowerCase()}.` }); }
    catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await api<{ sent: boolean; reason: string | null }>(`/api/admin/families/${detail.id}/resend-pass`, { body: {} });
      setToast({ ok: r.sent, text: r.sent ? `Pass sent again to the phone ending ${detail.phoneLast4}.` : r.reason === "not_configured" ? "SMS isn't connected, so nothing was sent. The family can see their pass at any kiosk or on the pass page." : "The SMS provider didn't accept the message." });
    } catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setBusy(false); }
  };

  const steps = detail ? ["Camp", detail.meetingPoint ? detail.meetingPoint.split(",")[0] : "Meeting point", detail.ghat.gate, detail.ghat.name] : [];
  const stepAt = detail ? ({ registered: 0, on_the_way: 1, bathing: 3, left: 4 } as Record<string, number>)[detail.status] ?? 0 : 0;
  const banded = detail?.members.filter((m) => m.bandId) ?? [];
  const needs = detail?.members.filter((m) => m.needs.length) ?? [];

  return (
    <div className="fm">
      <div className="gd-head" style={{ gridColumn: "1 / -1" }}>
        <h1>Families</h1>
        <div className="crumb">{data ? `${data.families.length} shown` : "…"}{live ? ` · ${live.kiosks.online} of ${live.kiosks.total} kiosks online` : ""} · personal data is deleted 48 h after the visit</div>
      </div>
      <section className="dl-card fm-list" aria-labelledby="ff-h">
        <h2 id="ff-h">Find a family</h2>
        <div className="fm-search">
          <span className="icon">search</span>
          <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Name, pass number or last 4 phone digits" aria-label="Search families" />
          {data && q && <span className="muted" style={{ fontSize: 13 }}>{rows.length} found</span>}
          {q && <button className="icon-btn" aria-label="Clear" onClick={() => setQ("")}><span className="icon">close</span></button>}
        </div>
        <div className="fm-chips" role="group" aria-label="Filter">{FILTERS.map(([k, l]) => <button key={k} className="m-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {error && <div className="banner bad">{error}</div>}
        <div className="fm-rows" role="list">
          {!data ? <div className="a-empty">Loading…</div> : rows.length === 0 ? <div className="a-empty">No families match.</div> : rows.map((f) => (
            <button key={f.id} role="listitem" className={`fm-row${sel === f.id ? " on" : ""}`} onClick={() => setSel(f.id)}>
              <span className="av">{initials(f.leaderName)}</span>
              <span className="t"><b>{f.leaderName} family</b><small>{f.people} people{f.homeTown ? ` · ${f.homeTown}` : ""} · <span className="mono">{f.passCode}</span></small></span>
              <span className={`chip ${STATUS[f.status]?.tone ?? ""}`}><span className="dot" />{STATUS[f.status]?.label ?? f.status}</span>
              <span className="icon">chevron_right</span>
            </button>
          ))}
        </div>
        <div className="fm-hint"><span className="icon sm">lightbulb</span>Not the family you need? Search by pass number or the last 4 digits of their phone. For a found person, use face match in Lost &amp; found.</div>
      </section>

      <section className="dl-card fm-detail" aria-live="polite">
        {!detail ? <div className="a-empty" style={{ margin: "auto" }}>Select a family to see their journey.</div> : (
          <>
            <div className="fm-hero">
              <span className="ring" style={{ ["--p" as string]: `${Math.min(100, (stepAt / 4) * 100)}` }}><span className="av">{initials(detail.leaderName)}</span></span>
              <div><h2>{detail.leaderName} family</h2><b className="sub">Family of {detail.members.length}{detail.homeTown ? ` · ${detail.homeTown}` : ""}</b><small>Pass <span className="mono">{detail.passCode}</span> · Batch {detail.slot.batchNo} · registered at {detail.kiosk ? `kiosk ${detail.kiosk.id}` : "a kiosk"}</small></div>
            </div>
            <div className="fm-journey">
              <b><span className="icon sm">directions_walk</span>{detail.status === "left" ? "Left the Mela" : `${STATUS[detail.status]?.label ?? detail.status} · ${detail.ghat.name}, as booked`}</b>
              <div className="steps">{steps.map((s, i) => <span key={i} className={i < stepAt ? "done" : i === stepAt ? "now" : ""}><i />{s}</span>)}</div>
              <small>Slot {detail.slot.day} {detail.slot.start}–{detail.slot.end} at {detail.ghat.name}, {detail.ghat.gate}.{detail.meetingPoint ? ` Meeting point: ${detail.meetingPoint}.` : ""} {detail.slotChangesLeft} slot change{detail.slotChangesLeft === 1 ? "" : "s"} left.</small>
            </div>
            <div className="fm-members">
              <small>{banded.length ? `${banded.length} wristband${banded.length > 1 ? "s" : ""} · ${banded.map((m) => m.name.split(" ")[0]).join(", ")}` : "No wristbands"} · speaks {LANGUAGES.find((l) => l.code === detail.language)?.english ?? detail.language}</small>
              {detail.members.map((m) => (
                <div key={m.id}><span className="av sm">{initials(m.name)}</span><b>{m.name}</b><small>{m.age}{m.isLeader ? ", head of family" : `, ${m.relation}`}{m.needs.length ? `, ${m.needs.map((n) => NEED[n] ?? n).join(", ")}` : ""}{m.hasPhoto ? " · photo on file" : ""}</small>{m.bandId && <span className="icon sm band" title={`Wristband ${m.bandId}`}>watch</span>}</div>
              ))}
            </div>
            {needs.length > 0 && <div className="fm-need"><span className="icon">accessible</span><span><b>{needs.map((m) => `${m.name.split(" ")[0]}: ${m.needs.map((n) => NEED[n] ?? n).join(", ")}`).join(" · ")}</b><small>Asked for at the kiosk. Volunteers at {detail.ghat.gate} see this on their list.</small></span></div>}
            {(detail.lostCases.length > 0 || detail.helpRequests.length > 0) && (
              <div className="fm-chips">
                {detail.lostCases.map((c) => <Link key={c.id} className="chip bad" href={`/admin/lost?q=${c.code}`}>{c.code} · {c.personName} · {c.status}</Link>)}
                {detail.helpRequests.map((h) => <Link key={h.id} className="chip info" href="/admin/help">{h.code} · {h.type.replace("_", " ")} · {h.status}</Link>)}
              </div>
            )}
            <small className="muted">Registered at {detail.kiosk ? `kiosk ${detail.kiosk.id} (${detail.kiosk.location})` : "a kiosk"} on {istDateTime(detail.registeredAt)} · consent given{detail.consent.photo ? ", photos allowed" : ""} · deleted {istDateTime(detail.deleteAfter)}</small>
            <div style={{ flex: 1 }} />
            {can("families.update") && (
              <div className="a-row">
                <button className="btn btn-filled" disabled={busy} onClick={resend}><span className="icon sm">sms</span>Send pass again</button>
                <label className="btn btn-outlined" style={{ cursor: "pointer" }}><span className="icon sm">swap_horiz</span>
                  <select value={detail.status} onChange={(e) => setStatus(e.target.value)} disabled={busy} aria-label="Change status" style={{ border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>
                    {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
              </div>
            )}
          </>
        )}
      </section>
      {toast && <div className={`a-snack${toast.ok ? "" : " bad"}`} role="status">{toast.text}</div>}
    </div>
  );
}
