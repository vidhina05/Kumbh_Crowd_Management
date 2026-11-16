"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, istTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { Notes } from "@/admin/CaseTools";
import { BASE_PATH } from "@/shared/base";
import { ROLE_LABELS, type Role } from "@/shared/rbac";

type Req = {
  id: string; code: string; type: string; description: string; location: string; priority: string; status: string; kioskId: string | null;
  assignedTo: string | null; assigneeName: string | null; passCode: string | null; familyName: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null;
};
type Staff = { id: string; name: string; role: Role };
const TYPE: Record<string, { label: string; icon: string; tone: string }> = {
  medical: { label: "Medical", icon: "medical_services", tone: "bad" }, lost_person: { label: "Lost person", icon: "person_search", tone: "bad" },
  wheelchair: { label: "Assist", icon: "accessible", tone: "info" }, language: { label: "Language", icon: "translate", tone: "info" }, other: { label: "Other", icon: "support_agent", tone: "" },
};
const TARGET_MIN: Record<string, number> = { medical: 5, lost_person: 5, wheelchair: 10, language: 10, other: 15 };
const RISK: Record<string, number> = { critical: 0, high: 1, normal: 2 };
const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const initials = (n: string) => n.replace(/^Dr\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** Figma "Admin / 11 Help requests". */
export default function HelpPage() {
  const { can, live } = useMe();
  const editable = can("help.update");
  const [filter, setFilter] = useState<"all" | "lost_person" | "medical" | "wheelchair" | "resolved">("all");
  const { data, error, reload } = usePoll<{ requests: Req[] }>(`/api/admin/help${filter === "resolved" ? "?status=resolved" : "?status=active"}`, 8_000);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [helper, setHelper] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (editable) void api<{ staff: Staff[] }>("/api/admin/staff").then((r) => setStaff(r.staff)).catch(() => undefined); }, [editable]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const all = data?.requests ?? [];
  const rows = useMemo(() => [...all].filter((r) => filter === "all" || filter === "resolved" || r.type === filter)
    .sort((a, b) => (filter === "resolved" ? 0 : (a.type === "medical" ? -1 : 0) - (b.type === "medical" ? -1 : 0) || RISK[a.priority] - RISK[b.priority] || +new Date(a.createdAt) - +new Date(b.createdAt))), [all, filter]);
  const r = rows.find((x) => x.id === sel) ?? rows[0] ?? null;
  const count = (t: string) => all.filter((x) => x.type === t).length;
  const longest = all.length ? Math.max(...all.map((x) => mins(x.createdAt))) : 0;
  const helpers = useMemo(() => {
    if (!r) return [];
    const load = (id: string) => all.filter((x) => x.assignedTo === id && x.status !== "resolved").length;
    const fit = (s: Staff) => (r.type === "medical" ? (s.role === "medical" ? 0 : 2) : r.type === "lost_person" ? (s.role === "help_desk" ? 0 : 1) : s.role === "help_desk" || s.role === "operations" ? 0 : 1);
    return staff.map((s) => ({ ...s, load: load(s.id), onShift: live?.onShift.includes(s.name) ?? false })).sort((a, b) => fit(a) - fit(b) || Number(b.onShift) - Number(a.onShift) || a.load - b.load).slice(0, 4);
  }, [staff, r, all, live]);
  const chosen = helpers.find((h) => h.id === helper) ?? helpers[0];

  const patch = async (body: Record<string, unknown>, text: string) => {
    if (!r) return;
    setBusy(true);
    try { await api(`/api/admin/help/${r.id}`, { method: "PATCH", body }); await reload(); setToast({ ok: true, text }); }
    catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setBusy(false); }
  };
  const wait = r ? mins(r.createdAt) : 0;
  const target = r ? TARGET_MIN[r.type] ?? 10 : 10;
  const over = r && r.status !== "resolved" && wait > target;

  return (
    <div className="hp">
      <div className="gd-head" style={{ gridColumn: "1 / -1" }}>
        <h1>Help requests</h1>
        <div className="crumb">{all.length} {filter === "resolved" ? "resolved" : "open"}{filter !== "resolved" && all.length ? ` · longest wait ${longest} min` : ""}</div>
      </div>
      <section className="dl-card hp-list" aria-labelledby="hl">
        <h2 id="hl" className="sr-only">Requests</h2>
        <div className="fm-chips" role="group" aria-label="Filter">
          {([["all", `All ${filter === "resolved" ? "" : all.length}`], ["lost_person", `Lost ${count("lost_person")}`], ["medical", `Medical ${count("medical")}`], ["wheelchair", `Assist ${count("wheelchair")}`], ["resolved", "Resolved"]] as const).map(([k, l]) => <button key={k} className="m-chip" aria-pressed={filter === k} onClick={() => { setFilter(k); setSel(null); }}>{filter === k && <span className="icon sm">check</span>}{l}</button>)}
        </div>
        <small className="muted">Sorted by risk: medical first, then longest wait</small>
        {error && <div className="banner bad">{error}</div>}
        <div className="hp-rows">
          {!data ? <div className="a-empty">Loading…</div> : rows.length === 0 ? <div className="a-empty">Nothing waiting.</div> : rows.map((x) => {
            const w = mins(x.createdAt), late = x.status !== "resolved" && w > (TARGET_MIN[x.type] ?? 10);
            return (
              <button key={x.id} className={`hp-row${r?.id === x.id ? " on" : ""}`} onClick={() => { setSel(x.id); setHelper(null); }}>
                <i className="bar" style={{ background: x.type === "medical" || x.priority === "critical" ? "var(--crowd-critical)" : late ? "var(--crowd-high)" : "var(--crowd-low)" }} />
                <span className="icon">{TYPE[x.type]?.icon ?? "help"}</span>
                <span className="t"><span className={`tag ${TYPE[x.type]?.tone ?? ""}`}>{TYPE[x.type]?.label ?? x.type}</span><b>{x.description || TYPE[x.type]?.label}</b><small>{x.location || (x.kioskId ? `Kiosk ${x.kioskId}` : "")}</small></span>
                <span className="w" style={{ color: late ? "var(--crowd-critical)" : x.status === "resolved" ? undefined : "var(--crowd-high)" }}><b>{x.status === "resolved" ? "Done" : `${w} min`}</b><small>{x.status === "resolved" ? istTime(x.resolvedAt ?? x.updatedAt) : late ? "over target" : x.assigneeName ? `${x.assigneeName.split(" ")[0]} going` : "waiting"}</small></span>
              </button>
            );
          })}
        </div>
        <small className="muted">{rows.length} shown · new requests appear within 8 seconds</small>
      </section>

      <section className="dl-card hp-detail" aria-live="polite">
        {!r ? <div className="a-empty" style={{ margin: "auto" }}>No request selected.</div> : (
          <>
            <div><div className="hp-big" style={{ color: over ? "var(--crowd-critical)" : "var(--crowd-high)" }}>{r.status === "resolved" ? "Resolved" : `${wait} min`}</div><small className="muted">{r.status === "resolved" ? `at ${istTime(r.resolvedAt ?? r.updatedAt)}` : `waiting · target under ${target} min`}</small></div>
            <h2 style={{ fontSize: 22 }}>{r.description || TYPE[r.type]?.label}</h2>
            <ul className="hp-facts">
              {r.familyName && <li><span className="icon sm">person</span>{r.familyName} family{r.passCode ? <> · <Link href={`/admin/families?q=${r.passCode}`} className="mono">{r.passCode}</Link></> : null}</li>}
              <li><span className="icon sm">location_on</span>{r.location || "Location not given"}</li>
              <li><span className="icon sm">campaign</span>Raised {r.kioskId ? `at kiosk ${r.kioskId}` : "by staff"} at {istTime(r.createdAt)} · <span className="mono">{r.code}</span></li>
              {r.assigneeName && <li><span className="icon sm">directions_run</span>{r.assigneeName} · {r.status.replace("_", " ")}</li>}
            </ul>
            <div className="hp-map" style={{ backgroundImage: `url(${BASE_PATH}/art/aerial-light.jpg)` }}><span className="pulse" /><span className="dot" />{chosen && r.status !== "resolved" && <span className="lbl"><span className="icon sm">{chosen.role === "medical" ? "medical_services" : "badge"}</span>{chosen.name.split(" ").slice(0, 2).join(" ")}</span>}</div>
            <div className="hp-time"><b>Timeline</b><Notes kind="help" id={r.id} canWrite={editable} /></div>
          </>
        )}
      </section>

      <section className="dl-card hp-help" aria-labelledby="nh">
        <h2 id="nh">Who can help</h2>
        <small className="muted">Best fit first: the right role, on shift, fewest open cases. Pick one and press Send.</small>
        {!editable ? <div className="muted">You can see requests but not assign them.</div> : !r ? null : (
          <>
            <div role="radiogroup" aria-label="Helper" className="hp-helpers">
              {helpers.map((h) => (
                <button key={h.id} role="radio" aria-checked={chosen?.id === h.id} className="hp-helper" onClick={() => setHelper(h.id)}>
                  <span className="av">{initials(h.name)}</span>
                  <span className="t"><b>{h.name}</b><small>{ROLE_LABELS[h.role]}{h.onShift ? " · on shift" : ""}</small></span>
                  <span className="n">{h.load ? `${h.load} open` : "free"}</span>
                  <span className="bar"><i style={{ width: `${Math.max(8, 100 - h.load * 30)}%` }} /></span>
                </button>
              ))}
            </div>
            <div className="a-row">
              {r.status !== "resolved" && chosen && <button className="btn btn-filled" disabled={busy} onClick={() => patch({ assignedTo: chosen.id, status: "assigned" }, `${chosen.name} is on the way. The request shows on their list.`)}><span className="icon sm">send</span>Send {chosen.name.replace(/^Dr\.?\s+/, "Dr. ").split(" ").slice(0, 2).join(" ")}</button>}
              {r.kioskId && <Link className="btn btn-outlined" href="/admin/kiosks"><span className="icon sm">desktop_windows</span>Kiosk {r.kioskId}</Link>}
            </div>
            <div className="hp-actions">
              {r.status !== "resolved" && r.status !== "in_progress" && <button className="btn btn-text small" disabled={busy} onClick={() => patch({ status: "in_progress" }, "Marked as being handled.")}>Mark in progress</button>}
              {r.status !== "resolved" && <button className="btn btn-text small" disabled={busy} onClick={() => patch({ status: "resolved" }, "Resolved. Thank you.")}>Mark resolved</button>}
              {r.status === "resolved" && <button className="btn btn-text small" disabled={busy} onClick={() => patch({ status: "open" }, "Reopened.")}>Reopen</button>}
              {r.priority !== "critical" && r.status !== "resolved" && <button className="btn btn-text small" disabled={busy} onClick={() => patch({ priority: "critical" }, "Marked critical. It moves to the top.")}>Mark critical</button>}
            </div>
            <div className="hp-backup">Backup: if nobody accepts within {target} minutes the request turns red here and on the overview, so the zone supervisor sees it.</div>
          </>
        )}
      </section>
      {toast && <div className={`a-snack${toast.ok ? "" : " bad"}`} role="status">{toast.text}</div>}
    </div>
  );
}
