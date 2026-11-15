"use client";
import { useEffect, useState } from "react";
import { api, ago, istDateTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { AssignSelect, Notes } from "@/admin/CaseTools";

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

export default function LostPage() {
  const { can } = useMe();
  const [status, setStatus] = useState<"active" | "reunited" | "">("active");
  const [q, setQ] = useState("");
  const { data, error, reload } = usePoll<{ cases: Case[] }>(`/api/admin/lost?${status ? `status=${status}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`, 8_000);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState("");
  const [familyMembers, setFamilyMembers] = useState<{ id: string; name: string; age: number }[]>([]);
  const c = data?.cases.find((x) => x.id === sel) ?? null;
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
    const res = await fetch(`/api/admin/lost/${c.id}/photo`, { credentials: "same-origin" });
    if (!res.ok) { setMsg("The photo can't be shown."); return; }
    setPhoto(URL.createObjectURL(await res.blob()));
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28, flex: 1 }}>Lost &amp; found</h1>
        <input className="input" style={{ height: 40, maxWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or case number" aria-label="Search cases" />
        <div className="a-tabs" role="group" aria-label="Filter">
          {([["active", "Open"], ["reunited", "Reunited"], ["", "All"]] as const).map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
      </div>
      <div className="a-grid-2">
        <section className="glass a-pane">
          {error && <div className="banner bad">{error}</div>}
          {!data ? <div className="a-empty">Loading…</div> : data.cases.length === 0 ? <div className="a-empty">No cases. Reports from kiosks appear here within 10 seconds.</div> : (
            <table className="tbl">
              <thead><tr><th>Person</th><th>Last seen</th><th>Open for</th><th>Status</th></tr></thead>
              <tbody>
                {data.cases.map((x) => (
                  <tr key={x.id} className={`clickable${sel === x.id ? " selected" : ""}`} onClick={() => setSel(x.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(x.id)}>
                    <td><b>{x.personName}</b>{x.age !== null && `, ${x.age}`} <span className="mono muted">{x.code}</span><div className="muted" style={{ fontSize: 12 }}>{x.description}</div></td>
                    <td>{x.lastSeen}<div className="muted" style={{ fontSize: 12 }}>{x.kioskId ? `Reported at kiosk ${x.kioskId}` : ""}</div></td>
                    <td>{x.closedAt ? "—" : ago(x.createdAt)}</td>
                    <td><span className={`chip ${CHIP[x.status]}`}>{x.status}</span><div className="muted" style={{ fontSize: 12 }}>{x.assigneeName ?? "Unassigned"}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="glass a-pane a-detail">
          {!c ? <div className="a-empty">Select a case to see it.</div> : (
            <>
              <h2 style={{ fontSize: 22, fontWeight: 400 }}>{c.personName}{c.age !== null && `, ${c.age}`} · <span className="mono">{c.code}</span></h2>
              {msg && <div className="banner bad">{msg}</div>}
              <dl>
                <dt>Wearing</dt><dd>{c.description}</dd>
                <dt>Last seen</dt><dd>{c.lastSeen}</dd>
                <dt>Reported by</dt><dd>{c.reporterName}{c.reporterPhoneLast4 && ` · phone ••${c.reporterPhoneLast4}`}</dd>
                <dt>Reported</dt><dd>{istDateTime(c.createdAt)}{c.kioskId && ` at kiosk ${c.kioskId}`}</dd>
                <dt>Family</dt>
                <dd>
                  {c.passCode ? <><a href="/admin/families">{c.passCode}</a>{c.memberName ? ` · ${c.memberName}` : " · person not matched yet"}</> : "Not linked to a registration"}
                  {editable && !c.passCode && (
                    <form style={{ display: "flex", gap: 8, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void patch({ passCode: linkCode }); }}>
                      <input className="input" style={{ height: 36, maxWidth: 200 }} value={linkCode} onChange={(e) => setLinkCode(e.target.value.toUpperCase())} placeholder="Pass no. KMB-…" aria-label="Pass number to link" />
                      <button className="btn btn-tonal" style={{ height: 36 }} disabled={linkCode.length < 5}>Link to registered family</button>
                    </form>
                  )}
                  {editable && c.passCode && !c.memberId && familyMembers.length > 0 && (
                    <select className="input" style={{ height: 36, maxWidth: 260, marginTop: 8 }} defaultValue="" onChange={(e) => e.target.value && patch({ memberId: e.target.value })} aria-label="Which family member is missing">
                      <option value="">Which family member is missing?</option>
                      {familyMembers.map((m) => <option key={m.id} value={m.id}>{m.name}, {m.age}</option>)}
                    </select>
                  )}
                </dd>
                <dt>Assigned to</dt><dd><AssignSelect value={c.assignedTo} disabled={!editable} onChange={(id) => patch({ assignedTo: id })} /></dd>
                <dt>Status</dt><dd><span className={`chip ${CHIP[c.status]}`}>{c.status}</span></dd>
              </dl>
              {c.hasPhoto && ["open", "searching", "found"].includes(c.status) && (
                <div style={{ display: "grid", gap: 8 }}>
                  {photo ? <img src={photo} alt={`Photo of ${c.personName} from registration`} style={{ maxWidth: 220, borderRadius: 12 }} /> : (
                    <button className="btn btn-outlined" onClick={showPhoto} style={{ justifySelf: "start" }}><span className="icon">photo_camera</span> Show registration photo</button>
                  )}
                  <span className="muted" style={{ fontSize: 12 }}>Opening the photo is logged. Photos are only available while the case is open.</span>
                </div>
              )}
              {editable && NEXT[c.status]?.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {NEXT[c.status].map((n) => <button key={n.to} className={`btn ${n.to === "reunited" || n.to === "found" ? "btn-filled" : n.to === "closed" ? "btn-text" : "btn-tonal"}`} onClick={() => patch({ status: n.to })}>{n.label}</button>)}
                </div>
              )}
              <Notes kind="lost" id={c.id} canWrite={editable} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
