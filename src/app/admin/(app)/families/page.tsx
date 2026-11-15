"use client";
import { useEffect, useState } from "react";
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
const STATUS = { registered: "Registered", on_the_way: "On the way", bathing: "Bathing now", left: "Left the Mela" } as const;

export default function FamiliesPage() {
  const { can } = useMe();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { const h = setTimeout(() => setQuery(q), 300); return () => clearTimeout(h); }, [q]);
  const { data, error } = usePoll<{ families: Row[] }>(`/api/admin/families?q=${encodeURIComponent(query)}`, 15_000);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (sel) api<Detail>(`/api/admin/families/${sel}`).then(setDetail).catch((e) => setMsg(e.message)); else setDetail(null); }, [sel]);

  const setStatus = async (status: string) => {
    if (!detail) return;
    try { setDetail(await api<Detail>(`/api/admin/families/${detail.id}`, { method: "PATCH", body: { status } })); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <>
      <h1 style={{ margin: 0, fontWeight: 400, fontSize: 28 }}>Families</h1>
      <div className="a-grid-2">
        <section className="glass a-pane">
          <div className="field">
            <label htmlFor="fq">Find a family</label>
            <input id="fq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, pass number (KMB-…), last 4 phone digits or home town" />
          </div>
          {error && <div className="banner bad">{error}</div>}
          {!data ? <div className="a-empty">Loading…</div> : data.families.length === 0 ? (
            <div className="a-empty">{query ? "No family matches that search." : "No families have registered yet. Registrations from kiosks appear here."}</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Family</th><th>Pass</th><th>Slot</th><th>Status</th></tr></thead>
              <tbody>
                {data.families.map((f) => (
                  <tr key={f.id} className={`clickable${sel === f.id ? " selected" : ""}`} onClick={() => setSel(f.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(f.id)}>
                    <td><b>{f.leaderName}</b><div className="muted" style={{ fontSize: 12 }}>{f.people} people{f.homeTown ? ` · ${f.homeTown}` : ""} · ••{f.phoneLast4}</div></td>
                    <td className="mono">{f.passCode}</td>
                    <td>{f.ghat}<div className="muted" style={{ fontSize: 12 }}>{f.day} · {f.start} · batch {f.batchNo}</div></td>
                    <td><span className="chip">{STATUS[f.status as keyof typeof STATUS] ?? f.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="glass a-pane a-detail" aria-live="polite">
          {msg && <div className="banner bad">{msg}</div>}
          {!detail ? <div className="a-empty">Select a family to see its details.</div> : (
            <>
              <div><h2 style={{ fontSize: 22, fontWeight: 400 }}>{detail.leaderName} family</h2><div className="muted">Family of {detail.members.length}{detail.homeTown ? ` · ${detail.homeTown}` : ""}</div></div>
              <dl>
                <dt>Pass</dt><dd className="mono">{detail.passCode} · batch {detail.slot.batchNo}</dd>
                <dt>Slot</dt><dd>{detail.slot.day} · {detail.slot.start}–{detail.slot.end} at {detail.ghat.name}, {detail.ghat.gate}</dd>
                <dt>Meeting point</dt><dd>{detail.meetingPoint || "—"}</dd>
                <dt>Phone</dt><dd>•••••• {detail.phoneLast4}</dd>
                <dt>Language</dt><dd>{LANGUAGES.find((l) => l.code === detail.language)?.english ?? detail.language}</dd>
                <dt>Status</dt>
                <dd>
                  {can("families.update") ? (
                    <select className="input" style={{ height: 36, maxWidth: 220 }} value={detail.status} onChange={(e) => setStatus(e.target.value)} aria-label="Family status">
                      {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : STATUS[detail.status as keyof typeof STATUS]}
                </dd>
                <dt>Slot changes left</dt><dd>{detail.slotChangesLeft}</dd>
              </dl>
              <h2>Members</h2>
              <table className="tbl">
                <thead><tr><th>Name</th><th>Age</th><th>Wristband</th><th>Needs</th></tr></thead>
                <tbody>
                  {detail.members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}{m.isLeader && <span className="muted"> · leader</span>}</td>
                      <td>{m.age}</td>
                      <td>{m.bandId ? <span className="chip good mono">{m.bandId}</span> : <span className="muted">No band needed</span>}</td>
                      <td>{m.needs.join(", ") || "—"}{m.hasPhoto && <span className="chip" style={{ marginLeft: 6 }}>photo on file</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(detail.lostCases.length > 0 || detail.helpRequests.length > 0) && (
                <>
                  <h2>Linked cases</h2>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {detail.lostCases.map((c) => <a key={c.id} className="chip bad" href="/admin/lost">{c.code} · {c.personName} · {c.status}</a>)}
                    {detail.helpRequests.map((h) => <a key={h.id} className="chip info" href="/admin/help">{h.code} · {h.type.replace("_", " ")} · {h.status}</a>)}
                  </div>
                </>
              )}
              <div className="card" style={{ fontSize: 13 }}>
                <b>Where this data came from</b>
                <div className="muted">Registered at {detail.kiosk ? `kiosk ${detail.kiosk.id} (${detail.kiosk.location})` : "an unknown kiosk"} on {istDateTime(detail.registeredAt)}. Consent version {detail.consent.version}{detail.consent.photo ? ", photos allowed" : ", no photos"}. All personal data is deleted after {istDateTime(detail.deleteAfter)}.</div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
