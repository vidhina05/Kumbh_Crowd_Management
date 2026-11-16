"use client";
import { useCallback, useEffect, useState } from "react";
import { api, istDateTime, istTime } from "./client";
import PhotoInput from "./PhotoInput";
import { faceTemplate } from "@/shared/client/face";

type Match = { id: string; memberId: string; score: number; strength: "strong" | "possible"; status: string; name: string; age: number; relation: string; hasPhoto: boolean; family: { id: string; passCode: string; leaderName: string; phoneLast4: string; meetingPoint: string } };

/** Match a found person's photo against families who opted in to face matching. Suggestions for a person to check. */
export function FaceSearch({ caseId, onChanged }: { caseId: string; onChanged: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [state, setState] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => api<{ matches: Match[] }>(`/api/admin/lost/${caseId}/face-search`).then((r) => setMatches(r.matches)).catch(() => setMatches([])), [caseId]);
  useEffect(() => { setPhoto(null); setMatches(null); setPhotos({}); setErr(null); void load(); }, [load]);
  useEffect(() => () => Object.values(photos).forEach((u) => URL.revokeObjectURL(u)), [photos]);

  const search = async (dataUrl: string) => {
    setPhoto(dataUrl); setErr(null); setState("Finding the face on this console…");
    try {
      const f = await faceTemplate(dataUrl);
      if (!f.ok) { setErr(f.message); return; }
      setState("Comparing with families who opted in…");
      const r = await api<{ matches: Match[] }>(`/api/admin/lost/${caseId}/face-search`, { body: { template: f.template, photo: dataUrl.length < 420_000 ? dataUrl : undefined } });
      setMatches(r.matches);
      if (!r.matches.length) setErr("No likely match among families who opted in. Keep searching the usual way.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Search failed."); }
    finally { setState(null); }
  };
  const showPhoto = async (m: Match) => {
    const res = await fetch(`/api/admin/members/${m.memberId}/photo`, { credentials: "same-origin" });
    if (res.ok) { const u = URL.createObjectURL(await res.blob()); setPhotos((p) => ({ ...p, [m.id]: u })); }
    else setErr("That photo can't be shown.");
  };
  const review = async (m: Match, decision: "confirmed" | "rejected") => {
    try { const r = await api<{ matches: Match[] }>(`/api/admin/face-matches/${m.id}`, { body: { decision } }); setMatches(r.matches); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
  };

  return (
    <div className="a-note" style={{ display: "grid", gap: 10 }}>
      <b><span className="icon sm">face</span> Face match</b>
      <div className="muted" style={{ fontSize: 12 }}>Compares a photo of the found person with families who agreed to face matching at registration. Runs on this console; only a face template is sent. Results are suggestions: always check by eye and with the wristband or family.</div>
      <PhotoInput onPhoto={search} label="Photo of the found person" />
      {photo && <img src={photo} alt="Found person" style={{ maxWidth: 160, borderRadius: 10 }} />}
      {state && <div className="muted" role="status">{state}</div>}
      {err && <div className="banner warn" style={{ fontSize: 13 }}>{err}</div>}
      {matches && matches.length > 0 && (
        <div className="a-face-grid">
          {matches.map((m) => (
            <div key={m.id} className="a-face">
              {photos[m.id] ? <img src={photos[m.id]} alt={`Registration photo of ${m.name}`} /> : m.hasPhoto ? <button className="btn btn-outlined small" onClick={() => showPhoto(m)}>Show registration photo</button> : <div className="muted" style={{ fontSize: 12 }}>No photo kept</div>}
              <div className="a-row" style={{ gap: 6 }}><b style={{ flex: 1 }}>{m.name}, {m.age}</b><span className={`chip ${m.strength === "strong" ? "good" : "warn"}`}>{m.strength === "strong" ? "Strong" : "Possible"} · {m.score}%</span></div>
              <div className="muted" style={{ fontSize: 12 }}>{m.relation} of {m.family.leaderName} · pass <span className="mono">{m.family.passCode}</span> · phone ••{m.family.phoneLast4}<br />Meeting point: {m.family.meetingPoint}</div>
              {m.status === "suggested" ? (
                <div className="a-row" style={{ gap: 6 }}>
                  <button className="btn btn-filled small" onClick={() => review(m, "confirmed")}>It&apos;s them</button>
                  <button className="btn btn-text small" onClick={() => review(m, "rejected")}>Not them</button>
                </div>
              ) : <span className={`chip ${m.status === "confirmed" ? "good" : ""}`}>{m.status === "confirmed" ? "Confirmed by staff" : "Rejected"}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Timeline = {
  id: string; code: string; personName: string; age: number | null; status: string; reporterName: string; reporterPhoneLast4: string | null; foundLocation: string | null;
  hasFoundPhoto: boolean; family: { passCode: string; leaderName: string; meetingPoint: string } | null; member: { name: string; age: number; bandId: string | null } | null;
  kiosk: { id: string; location: string } | null; assignee: string | null;
  times: { reportedAt: string; foundAt: string | null; reunitedAt: string | null; minutesToReunite: number | null };
  faceMatch: { score: number } | null; thanksSentAt: string | null;
};

/** The "Reunited" summary: how long it took, how they were found, and a thank-you to the person who reported. */
export function Reunited({ caseId }: { caseId: string }) {
  const [t, setT] = useState<Timeline | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<Timeline>(`/api/admin/lost/${caseId}/timeline`).then(setT).catch(() => setT(null)), [caseId]);
  useEffect(() => { void load(); }, [load]);
  if (!t) return null;
  const thanks = async () => {
    try {
      const r = await api<{ sms: string }>(`/api/admin/lost/${caseId}/thanks`, { body: {} });
      setMsg(r.sms === "sent" ? "Thank-you SMS sent." : r.sms === "not_connected" ? "Recorded. SMS isn't connected, so no message was sent." : r.sms === "no_phone" ? "Recorded. The reporter didn't leave a phone number." : "Recorded, but the SMS failed.");
      void load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <div className="a-note" style={{ display: "grid", gap: 8, background: "var(--success-container)" }}>
      <b style={{ fontSize: 18 }}><span className="icon">favorite</span> Reunited{t.times.minutesToReunite !== null ? ` in ${t.times.minutesToReunite} min` : ""}</b>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 14 }}>
        <li>{istTime(t.times.reportedAt)} · reported by {t.reporterName}{t.kiosk ? ` at kiosk ${t.kiosk.id} (${t.kiosk.location})` : ""}</li>
        {t.times.foundAt && <li>{istTime(t.times.foundAt)} · found{t.foundLocation ? ` at ${t.foundLocation}` : ""}{t.faceMatch ? ` · face match ${t.faceMatch.score}% confirmed by staff` : ""}</li>}
        {t.times.reunitedAt && <li>{istTime(t.times.reunitedAt)} · back with {t.family ? `${t.family.leaderName}'s family` : "family"}{t.assignee ? ` · handled by ${t.assignee}` : ""}</li>}
      </ol>
      {t.thanksSentAt ? <div className="muted" style={{ fontSize: 13 }}>Thank-you recorded {istDateTime(t.thanksSentAt)}.</div> : <button className="btn btn-tonal small" style={{ justifySelf: "start" }} onClick={thanks}><span className="icon sm">sms</span> Thank {t.reporterName}{t.reporterPhoneLast4 ? ` (••${t.reporterPhoneLast4})` : ""}</button>}
      {msg && <div className="muted" style={{ fontSize: 13 }} role="status">{msg}</div>}
    </div>
  );
}

/** A volunteer found someone with no report yet: open a case so the family can be traced. */
export function FoundForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ description: "", foundLocation: "", age: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api<{ id: string }>("/api/admin/lost/found", { body: { description: f.description.trim(), foundLocation: f.foundLocation.trim(), ...(f.age ? { age: Number(f.age) } : {}), ...(f.name.trim() ? { name: f.name.trim() } : {}) } });
      onCreated(r.id);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Couldn't open the case."); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="glass a-pane" style={{ display: "grid", gap: 12 }} aria-labelledby="found-h">
      <h2 id="found-h">Someone has been found</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Open a case for a person a volunteer is looking after. You can then try a face match and link the family.</p>
      <div className="a-row" style={{ alignItems: "stretch" }}>
        <div className="field" style={{ flex: 2 }}><label htmlFor="f-name">Name, if they can say it</label><input id="f-name" className="input" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="f-age">Age (about)</label><input id="f-age" className="input" inputMode="numeric" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></div>
      </div>
      <div className="field"><label htmlFor="f-desc">What they look like / wearing</label><input id="f-desc" className="input" required minLength={3} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="field"><label htmlFor="f-loc">Where they are now</label><input id="f-loc" className="input" required minLength={2} maxLength={200} value={f.foundLocation} onChange={(e) => setF({ ...f, foundLocation: e.target.value })} placeholder="e.g. Lost & found tent, Sector 4" /></div>
      {err && <div className="banner bad">{err}</div>}
      <div className="a-row"><button className="btn btn-filled" disabled={busy}>Open case</button><button type="button" className="btn btn-text" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
