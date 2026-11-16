"use client";
import { withBase } from "@/shared/base";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ago, istDateTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { AssignSelect, Notes } from "@/admin/CaseTools";
import { FaceSearch, FoundForm, Reunited } from "@/admin/LostTools";

type Case = {
  id: string; code: string; personName: string; age: number | null; description: string; lastSeen: string; reporterName: string; reporterPhoneLast4: string | null;
  status: string; kioskId: string | null; familyId: string | null; passCode: string | null; memberId: string | null; memberName: string | null; assignedTo: string | null; assigneeName: string | null;
  hasPhoto: boolean; createdAt: string; closedAt: string | null;
};
const NEXT: Record<string, { to: string; label: string }[]> = {
  open: [{ to: "searching", label: "Start search" }, { to: "found", label: "Found" }, { to: "closed", label: "Close" }],
  searching: [{ to: "found", label: "Found" }, { to: "closed", label: "Close" }],
  found: [{ to: "reunited", label: "Reunited with family" }, { to: "searching", label: "Back to searching" }],
  reunited: [],
  closed: [{ to: "open", label: "Reopen" }],
};
const CHIP: Record<string, string> = { open: "bad", searching: "warn", found: "info", reunited: "good", closed: "" };

export default function Page() {
  return <Suspense fallback={<div className="a-empty">Loading…</div>}><LostPage /></Suspense>;
}

/** Figma "Admin / 12 Lost and found": one case at a time; "All cases" shows the list. */
function LostPage() {
  const { can } = useMe();
  const initialQ = useSearchParams().get("q") ?? "";
  const [status, setStatus] = useState<"active" | "reunited" | "">("active");
  const [q, setQ] = useState(initialQ);
  const [showList, setShowList] = useState(!initialQ);
  const { data, error, reload } = usePoll<{ cases: Case[] }>(`/api/admin/lost?${status ? `status=${status}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`, 8_000);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState("");
  const [foundOpen, setFoundOpen] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<{ id: string; name: string; age: number }[]>([]);
  const c = data?.cases.find((x) => x.id === sel) ?? (initialQ && data?.cases.length === 1 ? data.cases[0] : null);
  const editable = can("lost.update");
  useEffect(() => { setPhoto((p) => { if (p) URL.revokeObjectURL(p); return null; }); setLinkCode(""); }, [sel]);
  useEffect(() => {
    if (c?.familyId && !c.memberId && editable) api<{ members: { id: string; name: string; age: number }[] }>(`/api/admin/families/${c.familyId}`).then((f) => setFamilyMembers(f.members)).catch(() => setFamilyMembers([]));
    else setFamilyMembers([]);
  }, [c?.familyId, c?.memberId, editable]);

  const patch = async (body: Record<string, unknown>) => {
    if (!c) return;
    setMsg(null);
    try { await api(`/api/admin/lost/${c.id}`, { method: "PATCH", body }); await reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  const showPhoto = async () => {
    if (!c) return;
    const res = await fetch(withBase(`/api/admin/lost/${c.id}/photo`), { credentials: "same-origin" });
    if (!res.ok) { setMsg("The photo can't be shown."); return; }
    setPhoto(URL.createObjectURL(await res.blob()));
  };

  // A case that changes state (e.g. reunited) can leave the current filter; keep showing it by switching to All.
  useEffect(() => { if (sel && data && !data.cases.some((x) => x.id === sel) && status !== "") setStatus(""); }, [sel, data, status]);
  const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  const ini = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const STATUS_TXT: Record<string, string> = { open: "Reported", searching: "Searching", found: "Found", reunited: "Reunited", closed: "Closed" };
  const list = data?.cases ?? [];
  const showingList = showList || !c;

  return (
    <div className="lf">
      <div className="gd-head" style={{ gridColumn: "1 / -1" }}>
        <h1>Lost &amp; found</h1>
        <div className="crumb">{c && !showingList ? <><button className="linkish" onClick={() => setShowList(true)}>‹ All cases</button> · Case {c.code} · {c.status === "reunited" || c.status === "closed" ? c.status : `open ${mins(c.createdAt)} min`}</> : `${list.length} ${status === "reunited" ? "reunited" : status === "active" ? "open" : ""} cases`}</div>
      </div>
      {msg && <div className="banner bad" role="alert" style={{ gridColumn: "1 / -1" }}>{msg}</div>}
      {foundOpen && <div style={{ gridColumn: "1 / -1" }}><FoundForm onCancel={() => setFoundOpen(false)} onCreated={(id) => { setFoundOpen(false); setStatus("active"); setSel(id); setShowList(false); void reload(); }} /></div>}

      {showingList ? (
        <section className="dl-card" style={{ gridColumn: "1 / -1" }} aria-labelledby="cases-h">
          <div className="a-row" style={{ justifyContent: "space-between" }}>
            <h2 id="cases-h">Cases</h2>
            <div className="a-row">
              <input className="input" style={{ height: 40, maxWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or case number" aria-label="Search cases" />
              <div className="fm-chips" role="group" aria-label="Filter">{([["active", "Open"], ["reunited", "Reunited"], ["", "All"]] as const).map(([k, l]) => <button key={k} className="m-chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
              {editable && <button className="btn btn-filled" onClick={() => setFoundOpen(true)}><span className="icon sm">person_pin_circle</span>Someone found</button>}
            </div>
          </div>
          {error && <div className="banner bad">{error}</div>}
          {!data ? <div className="a-empty">Loading…</div> : list.length === 0 ? <div className="a-empty">No cases.</div> : (
            <div className="lf-grid">
              {list.map((x) => (
                <button key={x.id} className="lf-tile" onClick={() => { setSel(x.id); setShowList(false); }}>
                  <span className="av">{ini(x.personName)}</span>
                  <span className="t"><b>{x.personName}{x.age !== null ? `, ${x.age}` : ""}</b><small>{x.code} · {x.lastSeen || x.description}</small></span>
                  <span className={`chip ${CHIP[x.status] ?? ""}`}>{STATUS_TXT[x.status] ?? x.status}{x.status === "open" || x.status === "searching" ? ` · ${mins(x.createdAt)} min` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : c && (
        <>
          <section className="dl-card lf-case" aria-labelledby="case-h">
            <div className="a-row" style={{ justifyContent: "space-between" }}>
              <span className={`chip ${CHIP[c.status] ?? ""}`}>{STATUS_TXT[c.status] ?? c.status}{c.status === "open" || c.status === "searching" ? ` · ${mins(c.createdAt)} min` : ""}</span>
              <button className="btn btn-text small" onClick={() => setShowList(true)}><span className="icon sm">list</span>All cases</button>
            </div>
            {c.assigneeName && <small className="muted">{c.assigneeName} is on this case</small>}
            <div><h2 id="case-h" className="lf-name">{c.personName.split(" ")[0]}</h2><div className="lf-sub">{c.personName.split(" ").slice(1).join(" ") || "Name not known"}{c.age !== null ? `, ${c.age} years` : ""}</div></div>
            <div className="lf-avatar">{photo ? <img src={photo} alt={`Photo of ${c.personName} from registration`} /> : <span>{ini(c.personName)}</span>}</div>
            {c.hasPhoto && !photo && <button className="btn btn-text small" style={{ alignSelf: "center" }} onClick={showPhoto}><span className="icon sm">photo_camera</span>Show registration photo (logged)</button>}
            <p className="lf-last">{c.lastSeen ? `Last seen: ${c.lastSeen}.` : "Where they were last seen isn't known."}</p>
            <div className="fm-chips">{c.description.split(/[,.;]/).map((d) => d.trim()).filter(Boolean).slice(0, 6).map((d) => <span key={d} className="chip">{d}</span>)}</div>
            <div className="lf-rep"><span className="av">{ini(c.reporterName)}</span><span className="t"><b>{c.reporterName}{c.memberName ? `, family of ${c.memberName}` : ""}</b><small>Reported {istDateTime(c.createdAt)}{c.kioskId ? ` at kiosk ${c.kioskId}` : ""}{c.reporterPhoneLast4 ? ` · phone ••${c.reporterPhoneLast4}` : ""}</small></span></div>
            <div className="lf-with">
              <small>Family</small>
              {c.passCode ? <span><a href={withBase(`/admin/families/?q=${c.passCode}`)} className="mono">{c.passCode}</a>{c.memberName ? ` · ${c.memberName}` : " · person not matched yet"}</span> : <span className="muted">Not linked to a registration</span>}
              {editable && !c.passCode && (
                <form className="a-row" onSubmit={(e) => { e.preventDefault(); void patch({ passCode: linkCode }); }}>
                  <input className="input" style={{ height: 36, maxWidth: 180 }} value={linkCode} onChange={(e) => setLinkCode(e.target.value.toUpperCase())} placeholder="Pass no. KMB-…" aria-label="Pass number to link" />
                  <button className="btn btn-tonal" style={{ height: 36 }} disabled={linkCode.length < 5}>Link family</button>
                </form>
              )}
              {editable && c.passCode && !c.memberId && familyMembers.length > 0 && (
                <select className="input" style={{ height: 36, maxWidth: 260 }} defaultValue="" onChange={(e) => e.target.value && patch({ memberId: e.target.value })} aria-label="Which family member is missing">
                  <option value="">Which family member is missing?</option>
                  {familyMembers.map((m) => <option key={m.id} value={m.id}>{m.name}, {m.age}</option>)}
                </select>
              )}
              <small>On this case</small>
              <AssignSelect value={c.assignedTo} disabled={!editable} onChange={(id) => patch({ assignedTo: id })} />
            </div>
            {c.status === "reunited" && <Reunited caseId={c.id} />}
            <div style={{ flex: 1 }} />
            {editable && NEXT[c.status]?.length > 0 && (
              <div className="a-row">{NEXT[c.status].map((n) => <button key={n.to} className={`btn ${n.to === "reunited" || n.to === "found" ? "btn-outlined" : n.to === "closed" ? "btn-text" : "btn-tonal"}`} onClick={() => patch({ status: n.to })}>{n.to === "found" ? "Mark as found" : n.label}</button>)}</div>
            )}
          </section>
          <section className="dl-card lf-sight" aria-labelledby="sight-h">
            <div className="a-row" style={{ justifyContent: "space-between" }}><h2 id="sight-h">Face matches</h2><small className="muted">Families who said yes to face matching at registration</small></div>
            {can("faces.search") && ["open", "searching", "found"].includes(c.status) ? <FaceSearch caseId={c.id} onChanged={reload} /> : <div className="muted">{c.status === "reunited" ? "This person is back with their family." : "Face matching isn't available for this case."}</div>}
          </section>
          <section className="dl-card lf-time" aria-labelledby="tl-h">
            <h2 id="tl-h">Timeline</h2>
            <div className="lf-steps">
              <span className="done"><i className="icon sm">campaign</i><b>{new Date(c.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}</b><small>Reported{c.kioskId ? ` at kiosk ${c.kioskId}` : ""}</small></span>
              <span className={c.status !== "open" ? "done" : ""}><i className="icon sm">search</i><b>{c.status !== "open" ? "Searching" : "—"}</b><small>{c.assigneeName ?? "Not assigned yet"}</small></span>
              <span className={["found", "reunited"].includes(c.status) ? "done" : ""}><i className="icon sm">person_pin_circle</i><b>{["found", "reunited"].includes(c.status) ? "Found" : "—"}</b><small>Found</small></span>
              <span className={c.status === "reunited" ? "done" : ""}><i className="icon sm">favorite</i><b>{c.closedAt ? new Date(c.closedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "—"}</b><small>Reunited</small></span>
            </div>
            <Notes kind="lost" id={c.id} canWrite={editable} />
          </section>
        </>
      )}
    </div>
  );
}
