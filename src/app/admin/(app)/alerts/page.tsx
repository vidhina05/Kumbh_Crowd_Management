"use client";
import { useMemo, useState } from "react";
import { api, istTime, usePoll } from "@/admin/client";
import { useMe } from "@/admin/Shell";
import { BASE_PATH } from "@/shared/base";
import { LANGUAGES } from "@/shared/languages";

type Alert = { id: string; severity: string; title: string; message: string; audience: string; status: string; createdAt: string; startsAt: string; ghatIds: string[]; createdByName: string | null; translations: Record<string, { title: string; message: string }> };
type Tr = Record<string, { title: string; message: string }>;
type Template = { key: string; icon: string; name: string; sub: string; severity: "info" | "warning" | "critical"; tr: Tr };

/** Ready-made wording in Hindi and English. Staff can edit, and add any other language. */
const TEMPLATES: Template[] = [
  { key: "heat", icon: "thermostat", name: "Heat", sub: "Water, shade, rest", severity: "warning", tr: {
    hi: { title: "तेज़ गर्मी", message: "तेज़ गर्मी: पानी पिएँ, छाँव में रहें। नज़दीकी पानी केंद्र और छाया के लिए स्वयंसेवक से पूछें।" },
    en: { title: "Heat warning", message: "Heat warning: drink water and stay in the shade. Ask a volunteer for the nearest water point." } } },
  { key: "full", icon: "groups", name: "Ghat is full", sub: "Send people elsewhere", severity: "critical", tr: {
    hi: { title: "घाट भरा हुआ है", message: "यह घाट अभी भरा हुआ है। कृपया अपने पास पर दिया घाट देखें या स्वयंसेवक के बताए घाट पर जाएँ।" },
    en: { title: "Ghat is full", message: "This ghat is full right now. Please check the ghat on your pass, or go where a volunteer points you." } } },
  { key: "lost", icon: "child_care", name: "Lost child", sub: "Description, meeting point", severity: "critical", tr: {
    hi: { title: "बच्चा खो गया है", message: "एक बच्चा अपने परिवार से बिछड़ गया है। अगर आप उसे देखें तो पास के स्वयंसेवक या खोया-पाया केंद्र को बताएँ।" },
    en: { title: "Lost child", message: "A child is separated from their family. If you see them, tell the nearest volunteer or lost-and-found centre." } } },
  { key: "route", icon: "alt_route", name: "Route change", sub: "New gate or path", severity: "warning", tr: {
    hi: { title: "रास्ता बदला गया", message: "रास्ता बदला गया है। संकेतों और स्वयंसेवकों के निर्देश मानें। आपका समय वही रहेगा।" },
    en: { title: "Route change", message: "The route has changed. Follow the signs and volunteers. Your time stays the same." } } },
  { key: "weather", icon: "rainy", name: "Weather", sub: "Rain, wind, fog", severity: "warning", tr: {
    hi: { title: "मौसम चेतावनी", message: "कोहरा और ठंडी हवा। घाट की सीढ़ियाँ फिसलन भरी हो सकती हैं, धीरे चलें।" },
    en: { title: "Weather warning", message: "Fog and cold wind. The ghat steps may be slippery, walk slowly." } } },
  { key: "own", icon: "edit_note", name: "Write your own", sub: "Start from a blank message", severity: "info", tr: { hi: { title: "", message: "" }, en: { title: "", message: "" } } },
];

/** Figma "Admin / 10 Alerts": start from a template, check what a pilgrim sees, then send or schedule. */
export default function Alerts() {
  const { can, live } = useMe();
  const { data, reload } = usePoll<{ alerts: Alert[] }>("/api/admin/alerts", 10_000);
  const [tpl, setTpl] = useState<Template>(TEMPLATES[0]);
  const [tr, setTr] = useState<Tr>(TEMPLATES[0].tr);
  const [langs, setLangs] = useState<string[]>(["hi", "en"]);
  const [editLang, setEditLang] = useState("hi");
  const [moreLangs, setMoreLangs] = useState(false);
  const [ghatIds, setGhatIds] = useState<string[]>([]);
  const [audience, setAudience] = useState<{ kiosk: boolean; staff: boolean }>({ kiosk: true, staff: true });
  const [when, setWhen] = useState<"now" | "at">("now");
  const [at, setAt] = useState(() => { const d = new Date(Date.now() + 330 * 60_000 + 30 * 60_000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(Math.floor(d.getUTCMinutes() / 15) * 15).padStart(2, "0")}`; });
  const [severity, setSeverity] = useState<Template["severity"]>(TEMPLATES[0].severity);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = (t: Template) => { setTpl(t); setTr(t.tr); setSeverity(t.severity); setEditLang("hi"); setToast({ ok: true, text: `Template loaded: ${t.name}. Edit the wording freely.` }); };
  const reach = useMemo(() => (live ? (ghatIds.length ? live.ghats.filter((g) => ghatIds.includes(g.id)) : live.ghats).reduce((a, g) => a + g.occupancy, 0) : 0), [live, ghatIds]);
  const primary = tr[langs[0]] ?? tr.en ?? { title: "", message: "" };
  const english = tr.en?.message ? tr.en : primary;
  const ok = primary.title.trim().length >= 3 && primary.message.trim().length >= 3 && (audience.kiosk || audience.staff);
  const startsAt = when === "at" ? (() => { const [h, m] = at.split(":").map(Number); const ist = new Date(Date.now() + 330 * 60_000); const t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m) - 330 * 60_000; return new Date(t < Date.now() ? t + 86_400_000 : t).toISOString(); })() : null;
  const now = Date.now();
  const upcoming = (data?.alerts ?? []).filter((a) => a.status === "active" && new Date(a.startsAt).getTime() > now);
  const sent = (data?.alerts ?? []).filter((a) => new Date(a.startsAt).getTime() <= now).slice(0, 6);

  const send = async () => {
    setBusy(true);
    try {
      const translations: Tr = {};
      for (const l of langs) if (tr[l]?.message?.trim()) translations[l] = { title: tr[l].title.trim() || english.title, message: tr[l].message.trim() };
      await api("/api/admin/alerts", { body: { severity, title: english.title.trim() || primary.title.trim(), message: english.message.trim() || primary.message.trim(), audience: audience.kiosk && audience.staff ? "both" : audience.kiosk ? "kiosk" : "staff", translations, startsAt, ghatIds } });
      setToast({ ok: true, text: startsAt ? `Alert scheduled for ${istTime(startsAt)} · ${langs.length} languages. You can cancel it until then.` : `Alert sent · ${langs.length} languages · reaches about ${reach.toLocaleString("en-IN")} people.` });
      await reload();
    } catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "Couldn't send." }); }
    finally { setBusy(false); setConfirm(false); }
  };
  const cancel = async (id: string) => { try { await api(`/api/admin/alerts/${id}/resolve`, { body: {} }); await reload(); setToast({ ok: true, text: "Alert cancelled." }); } catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "Failed" }); } };
  const langName = (c: string) => LANGUAGES.find((l) => l.code === c)?.native ?? c;

  return (
    <div className="al">
      <div className="gd-head" style={{ gridColumn: "1 / -1" }}>
        <h1>Alerts</h1>
        <div className="crumb">{sent.length} sent recently{upcoming[0] ? ` · next one scheduled ${istTime(upcoming[0].startsAt)}` : ""} · shown on kiosks in each pilgrim&apos;s language</div>
      </div>

      <section className="dl-card al-start" aria-labelledby="st-h">
        <h2 id="st-h">Start from</h2>
        <div role="radiogroup" aria-label="Template" className="al-tpls">
          {TEMPLATES.map((t) => <button key={t.key} role="radio" aria-checked={tpl.key === t.key} className="al-tpl" onClick={() => pick(t)}><span className="ic"><span className="icon">{t.icon}</span></span><span><b>{t.name}</b><small>{t.sub}</small></span></button>)}
        </div>
        <div style={{ flex: 1 }} />
        {upcoming.length > 0 && <div className="al-log"><small>Coming up</small>{upcoming.map((a) => <div key={a.id}><span className="mono">{istTime(a.startsAt)}</span> {a.title}{can("alerts.manage") && <button className="btn btn-text small" onClick={() => cancel(a.id)}>Cancel</button>}</div>)}</div>}
        <div className="al-log"><small>Sent</small>{sent.length === 0 ? <span className="muted">None yet.</span> : sent.map((a) => <div key={a.id}><span className="mono">{istTime(a.startsAt)}</span> {a.title}{a.status === "active" && can("alerts.manage") ? <button className="btn btn-text small" onClick={() => cancel(a.id)}>Resolve</button> : <span className="muted"> · {a.status}</span>}</div>)}</div>
      </section>

      <section className="dl-card al-edit" aria-labelledby="ed-h">
        <div><h2 id="ed-h" style={{ fontSize: 28 }}>{tpl.key === "own" ? "New alert" : `${tpl.name} alert`}</h2><div style={{ fontSize: 20 }}>{ghatIds.length ? `For ${ghatIds.map((g) => live?.ghats.find((x) => x.id === g)?.name ?? g).join(", ")}` : "For everyone at the Mela"}</div></div>
        <div className="al-msg">
          <div className="tabs" role="tablist">{langs.map((l) => <button key={l} role="tab" aria-selected={editLang === l} onClick={() => setEditLang(l)} lang={l}>{langName(l)}</button>)}</div>
          <input className="t" value={tr[editLang]?.title ?? ""} onChange={(e) => setTr({ ...tr, [editLang]: { title: e.target.value, message: tr[editLang]?.message ?? "" } })} placeholder="Title" maxLength={80} aria-label={`Title in ${langName(editLang)}`} lang={editLang} />
          <textarea value={tr[editLang]?.message ?? ""} onChange={(e) => setTr({ ...tr, [editLang]: { title: tr[editLang]?.title ?? "", message: e.target.value } })} rows={3} maxLength={400} placeholder="Message" aria-label={`Message in ${langName(editLang)}`} lang={editLang} />
          <small>{(tr[editLang]?.message ?? "").length}/400 · languages without text show the English version · written by staff, edit freely</small>
        </div>
        <small className="lbl">Languages</small>
        <div className="fm-chips">
          {(moreLangs ? LANGUAGES : LANGUAGES.filter((l) => ["hi", "en", "bho", "mr", "bn"].includes(l.code) || langs.includes(l.code))).map((l) => (
            <button key={l.code} className="m-chip" aria-pressed={langs.includes(l.code)} lang={l.code} onClick={() => { setLangs((s) => (s.includes(l.code) ? (s.length > 1 ? s.filter((x) => x !== l.code) : s) : [...s, l.code])); setEditLang(l.code); }}>{langs.includes(l.code) && <span className="icon sm">check</span>}{l.native}</button>
          ))}
          <button className="m-chip" onClick={() => setMoreLangs((m) => !m)}>{moreLangs ? "Fewer" : `${LANGUAGES.length - 5} more`}</button>
        </div>
        <div className="al-box">
          <small className="lbl">Who gets it</small>
          <div className="fm-chips">
            {(live?.ghats ?? []).slice().sort((a, b) => b.percent - a.percent).map((g) => <button key={g.id} className="m-chip" aria-pressed={ghatIds.includes(g.id)} onClick={() => setGhatIds((s) => (s.includes(g.id) ? s.filter((x) => x !== g.id) : [...s, g.id]))}>{ghatIds.includes(g.id) && <span className="icon sm">check</span>}{g.name.replace(/ Ghat$/, "")}</button>)}
            <button className="m-chip" aria-pressed={ghatIds.length === 0} onClick={() => setGhatIds([])}>{ghatIds.length === 0 && <span className="icon sm">check</span>}Everyone</button>
          </div>
          <div className="al-reach"><b>{reach >= 100_000 ? `${(reach / 100_000).toFixed(1)} lakh` : reach.toLocaleString("en-IN")}</b><span>people are at {ghatIds.length ? "these ghats" : "the ghats"} now{live?.totals.sources.includes("simulated") ? " (simulated count)" : ""}</span></div>
        </div>
        <div className="al-box">
          <small className="lbl">How it reaches them</small>
          <div className="fm-chips">
            <button className="m-chip" aria-pressed={audience.kiosk} onClick={() => setAudience({ ...audience, kiosk: !audience.kiosk })}>{audience.kiosk && <span className="icon sm">check</span>}Kiosks</button>
            <button className="m-chip" aria-pressed={audience.staff} onClick={() => setAudience({ ...audience, staff: !audience.staff })}>{audience.staff && <span className="icon sm">check</span>}Staff screens</button>
            <span className="chip" title="Broadcast SMS needs a DLT-approved template and a connected provider">SMS · not connected</span>
          </div>
          <small className="muted">Severity:&nbsp;
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Template["severity"])} aria-label="Severity" style={{ border: 0, background: "transparent", font: "inherit", color: "var(--on-surface)" }}><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical</option></select></small>
        </div>
        <small className="lbl">When</small>
        <div className="a-row">
          <div className="gd-seg al-when" role="group"><button aria-pressed={when === "now"} onClick={() => setWhen("now")}>Now</button><button aria-pressed={when === "at"} onClick={() => setWhen("at")}>{when === "at" && <span className="icon sm">check</span>}At</button></div>
          {when === "at" && <input type="time" className="input" style={{ height: 36, width: 130 }} value={at} onChange={(e) => setAt(e.target.value)} aria-label="Time (IST)" />}
        </div>
      </section>

      <section className="dl-card al-preview" aria-label="What a pilgrim sees">
        <small style={{ textAlign: "center" }}>What a pilgrim sees</small>
        <div className="phone" style={{ backgroundImage: `url(${BASE_PATH}/art/aerial-light.jpg)` }}>
          <i className="notch" />
          <div className="clock">{when === "at" ? at : istTime(new Date())}</div>
          <div className="date">{new Date(Date.now()).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</div>
          <div className="note" lang={langs[0]}><span className="from"><span className="icon sm">waves</span> Maha Kumbh · now</span><b>{primary.title || "Title"}</b><span>{primary.message || "Your message appears here."}</span></div>
        </div>
        {can("alerts.manage") && <button className="btn btn-filled" style={{ justifySelf: "center" }} disabled={!ok || busy} onClick={() => setConfirm(true)}><span className="icon sm">{when === "at" ? "schedule_send" : "campaign"}</span>{when === "at" ? `Schedule alert for ${at}` : "Send alert now"}</button>}
        <small className="muted" style={{ textAlign: "center" }}>Reaches about {reach.toLocaleString("en-IN")} people.{when === "at" ? ` You can cancel it until ${at}.` : ""}</small>
      </section>

      {confirm && (
        <div className="dialog-scrim" role="presentation" onClick={() => setConfirm(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ca-t" onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: "center", color: "var(--primary)" }}><span className="icon">campaign</span></div>
            <h2 id="ca-t">{when === "at" ? `Schedule for ${at}?` : "Send this alert now?"}</h2>
            <div className="muted" style={{ fontSize: 15 }}>&ldquo;{primary.title}&rdquo; in {langs.map(langName).join(", ")} to {ghatIds.length ? `${ghatIds.length} ghat${ghatIds.length > 1 ? "s" : ""}` : "everyone"} on {[audience.kiosk && "kiosks", audience.staff && "staff screens"].filter(Boolean).join(" and ")}. About {reach.toLocaleString("en-IN")} people.</div>
            <div className="actions"><button className="btn btn-text" onClick={() => setConfirm(false)}>Cancel</button><button className="btn btn-filled" disabled={busy} onClick={send}>{when === "at" ? "Schedule" : "Send"}</button></div>
          </div>
        </div>
      )}
      {toast && <div className={`a-snack${toast.ok ? "" : " bad"}`} role="status">{toast.text}</div>}
    </div>
  );
}
