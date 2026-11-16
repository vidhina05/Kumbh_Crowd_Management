"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, createContext, useContext, useEffect, useRef, useState } from "react";
import "./admin.css";
import { api, usePoll } from "./client";
import { AdminI18n, useAdminT, type AdminKey } from "./i18n";
import { SettingsSheet, useLiveSounds, usePrefs } from "./Prefs";
import type { Live } from "./types";
import { can, ROLE_LABELS, type Permission, type Role } from "@/shared/rbac";

export type Me = { id: string; name: string; email: string; role: Role; mfaEnabled?: boolean; mfaSetupRequired?: boolean };
export type Integrations = { sms: boolean; otpDevMode: boolean; voice: boolean; assistant: boolean; aadhaar?: boolean; aadhaarTestCards?: boolean; simulator?: boolean; demo?: boolean };

type ShellCtx = { me: Me; integrations: Integrations; can: (p: Permission) => boolean; live: Live | null; liveUpdatedAt: Date | null; reloadLive: () => Promise<void>; openSahayak: (q?: string) => void };
const Ctx = createContext<ShellCtx | null>(null);
export function useMe() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe outside Shell");
  return v;
}

/** Side rail, as in the Figma "Navigation rail" component. */
const NAV: { href: string; key: AdminKey; icon: string; perm: Permission }[] = [
  { href: "/admin", key: "overview", icon: "space_dashboard", perm: "overview.view" },
  { href: "/admin/families", key: "families", icon: "how_to_reg", perm: "families.view" },
  { href: "/admin/batches", key: "batches", icon: "view_timeline", perm: "batches.view" },
  { href: "/admin/alerts", key: "alerts", icon: "campaign", perm: "alerts.view" },
  { href: "/admin/help", key: "help", icon: "volunteer_activism", perm: "help.view" },
  { href: "/admin/lost", key: "lost", icon: "person_search", perm: "lost.view" },
  { href: "/admin/reports", key: "reports", icon: "summarize", perm: "reports.view" },
];
/** Profile menu (Figma "Profile menu"), plus the admin tools that have no rail slot in the design. */
const TOOLS: { href: string; key: AdminKey; icon: string; perm: Permission }[] = [
  { href: "/admin/diversions", key: "diversions", icon: "alt_route", perm: "batches.view" },
  { href: "/admin/kiosks", key: "kiosks", icon: "desktop_windows", perm: "kiosks.view" },
  { href: "/admin/sensors", key: "sensors", icon: "sensors", perm: "sensors.view" },
  { href: "/admin/users", key: "staff", icon: "badge", perm: "users.manage" },
  { href: "/admin/audit", key: "activity", icon: "history", perm: "audit.view" },
];

const initials = (n: string) => n.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function Shell(props: { me: Me; integrations: Integrations; children: React.ReactNode }) {
  return <AdminI18n><Suspense fallback={null}><ShellInner {...props} /></Suspense></AdminI18n>;
}

function ShellInner({ me, integrations, children }: { me: Me; integrations: Integrations; children: React.ReactNode }) {
  const path = (usePathname().replace(/\/$/, "") || "/admin");
  const qs = useSearchParams();
  const router = useRouter();
  const { t, lang, setLang } = useAdminT();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sahayak, setSahayak] = useState<{ open: boolean; q?: string }>({ open: false });
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [prefs, setPrefs] = usePrefs();
  const live = usePoll<Live>(can(me.role, "map.view") ? "/api/admin/live" : null, 10_000);
  useEffect(() => setTheme((document.documentElement.dataset.theme as "light" | "dark") ?? "light"), []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  const signOut = async () => {
    await api("/api/admin/auth/logout", { body: {} }).catch(() => undefined);
    router.replace("/admin/login");
  };
  useLiveSounds(live.data, prefs);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "/") { e.preventDefault(); setSearchOpen(true); }
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
      else if ((e.key === "s" || e.key === "S") && can(me.role, "assistant.use")) setSahayak({ open: true });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [me.role]);
  const value: ShellCtx = { me, integrations, can: (p) => can(me.role, p), live: live.data, liveUpdatedAt: live.updatedAt, reloadLive: live.reload, openSahayak: (q) => setSahayak({ open: true, q }) };
  const worst = live.data ? [...live.data.ghats].sort((a, b) => b.percent - a.percent)[0] : null;
  const critical = worst && worst.percent >= worst.safeLimitPct ? worst : null;
  const tab = path === "/admin/map" ? (qs.get("view") === "3d" ? "3d" : "map") : path === "/admin" ? "command" : null;
  const badge = (live.data?.pendingDiversions.length ?? 0) + (live.data?.lostOpen.length ?? 0) + (live.data?.help.medical ?? 0) + (live.data?.alerts.filter((a) => a.severity !== "info").length ?? 0);
  const wall = path === "/admin/wall";

  if (wall) return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  return (
    <Ctx.Provider value={value}>
      <div className="a-root">
        <nav className="a-rail" aria-label="Main">
          <div className="logo" aria-hidden="true"><span className="icon">waves</span></div>
          {can(me.role, "assistant.use") && (
            <>
              <button className="a-fab" onClick={() => setSahayak({ open: true })} aria-label={t("sahayak")}><span className="icon">graphic_eq</span></button>
              <span className="a-fab-label">{t("sahayak")}</span>
            </>
          )}
          <span style={{ height: 8, flex: "none" }} />
          {NAV.filter((n) => can(me.role, n.perm)).map((n) => {
            const active = n.href === "/admin" ? path === "/admin" || path === "/admin/map" || path === "/admin/ghat" : path.startsWith(n.href) || (n.href === "/admin/batches" && path.startsWith("/admin/diversions"));
            return (
              <Link key={n.href} href={n.href} className="a-dest" aria-current={active ? "page" : undefined}>
                <span className="pill"><span className="icon">{n.icon}</span></span>
                {t(n.key)}
              </Link>
            );
          })}
          <div className="bottom">
            <div className="a-lang" role="group" aria-label="Language">
              <button aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">EN</button>
              <button aria-pressed={lang === "hi"} onClick={() => setLang("hi")} lang="hi">हिं</button>
            </div>
            <button className="a-avatar" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={`${me.name}, menu`}>{initials(me.name)}</button>
          </div>
        </nav>
        <div className="a-main">
          <header className="a-top">
            <div className="a-tabs-sec" role="tablist" aria-label="Command views">
              <Link role="tab" aria-selected={tab === "command"} href="/admin">{t("command")}</Link>
              <Link role="tab" aria-selected={tab === "map"} href="/admin/map">{t("liveMap")}</Link>
              <Link role="tab" aria-selected={tab === "3d"} href="/admin/map?view=3d">{t("view3d")}</Link>
            </div>
            <div className="sub">Sangam Control · {ROLE_LABELS[me.role]} · {me.name}{live.data ? ` · ${live.data.now} IST` : ""}</div>
            <div className="a-threat-wrap">
              {critical ? (
                <Link className="a-threat" href={`/admin/ghat?id=${critical.id}`}><span className="dot" />{t("critical")} · {critical.name} {critical.percent}%</Link>
              ) : live.data ? <span className="a-threat ok"><span className="dot" />{t("allClear")}</span> : null}
            </div>
            <div className="a-top-actions">
              <button className="a-search" onClick={() => setSearchOpen(true)} aria-label={t("search")}>
                <span className="icon">search</span><span className="ph">{t("search")}</span><span className="icon">mic</span>
              </button>
              <button className="a-theme" onClick={toggleTheme} role="switch" aria-checked={theme === "dark"} aria-label={t("theme")}>
                <span>{t("theme")}</span>
                <span className="track"><span className="handle"><span className="icon sm">{theme === "dark" ? "dark_mode" : "light_mode"}</span></span></span>
              </button>
              <button className="icon-btn a-bell" onClick={() => setNotes((n) => !n)} aria-label={`${t("notifications")}${badge ? `, ${badge}` : ""}`} aria-expanded={notes}>
                <span className="icon">notifications</span>{badge > 0 && <span className="badge">{badge}</span>}
              </button>
            </div>
          </header>
          <main className="a-content">{children}</main>
        </div>
        {menu && <ProfileMenu me={me} onClose={() => setMenu(false)} onSignOut={signOut} onSettings={() => { setMenu(false); setSettings(true); }} />}
        {settings && <SettingsSheet name={me.name} prefs={prefs} set={setPrefs} onClose={() => setSettings(false)} />}
        {notes && <Notifications live={live.data} onClose={() => setNotes(false)} />}
        {searchOpen && <SearchSheet live={live.data} onClose={() => setSearchOpen(false)} />}
        {sahayak.open && <><div className="a-sheet-scrim" onClick={() => setSahayak({ open: false })} aria-hidden="true" /><Sahayak onClose={() => setSahayak({ open: false })} connected={integrations.assistant} initial={sahayak.q} /></>}
      </div>
    </Ctx.Provider>
  );
}

function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    addEventListener("keydown", key);
    const id = setTimeout(() => addEventListener("mousedown", click), 0);
    return () => { removeEventListener("keydown", key); clearTimeout(id); removeEventListener("mousedown", click); };
  }, [onClose]);
  return ref;
}

function ProfileMenu({ me, onClose, onSignOut, onSettings }: { me: Me; onClose: () => void; onSignOut: () => void; onSettings: () => void }) {
  const { t } = useAdminT();
  const ref = useDismiss(onClose);
  const item = (href: string, icon: string, label: string) => <Link role="menuitem" href={href} onClick={onClose}><span className="icon sm">{icon}</span>{label}</Link>;
  return (
    <div className="a-menu" role="menu" ref={ref} aria-label="Profile">
      <div className="who"><span className="a-avatar sm">{initials(me.name)}</span><div><b>{me.name}</b><small>{ROLE_LABELS[me.role]} · Sangam Control</small></div></div>
      {can(me.role, "shifts.use") && item("/admin/shift", "summarize", t("myShiftReport"))}
      {can(me.role, "shifts.use") && item("/admin/shift?switch=1", "swap_horiz", t("switchPost"))}
      <button role="menuitem" onClick={onSettings}><span className="icon sm">settings</span>{t("settings")}</button>
      {can(me.role, "map.view") && item("/admin/wall", "cast", t("castWall"))}
      {TOOLS.some((x) => can(me.role, x.perm)) && <div className="sep">{t("adminTools")}</div>}
      {TOOLS.filter((x) => can(me.role, x.perm)).map((x) => <span key={x.href} style={{ display: "contents" }}>{item(x.href, x.icon, t(x.key))}</span>)}
      <button role="menuitem" onClick={() => { onClose(); void onSignOut(); }}><span className="icon sm">logout</span>{t("signOut")}</button>
    </div>
  );
}

function Notifications({ live, onClose }: { live: Live | null; onClose: () => void }) {
  const { t } = useAdminT();
  const ref = useDismiss(onClose);
  const [tab, setTab] = useState<"action" | "info">("action");
  const action: { href: string; icon: string; title: string; body: string }[] = [];
  const info: typeof action = [];
  if (live) {
    for (const d of live.pendingDiversions) action.push({ href: `/admin/diversions/view?id=${d.id}`, icon: "how_to_reg", title: `Diversion ${d.code}`, body: "Waiting for a second check" });
    for (const l of live.lostOpen) action.push({ href: "/admin/lost", icon: "person_search", title: `${l.code} · ${l.personName}${l.age !== null ? `, ${l.age}` : ""}`, body: `Missing for ${l.minutes} min` });
    for (const g of live.ghats.filter((x) => x.percent >= x.safeLimitPct)) action.push({ href: `/admin/ghat?id=${g.id}`, icon: "warning", title: `${g.name} ${g.percent}%`, body: `Above the ${g.safeLimitPct}% safe limit` });
    if (live.help.medical) action.push({ href: "/admin/help", icon: "medical_services", title: `${live.help.medical} medical request${live.help.medical > 1 ? "s" : ""}`, body: `${live.help.open} help requests open` });
    for (const a of live.alerts) info.push({ href: "/admin/alerts", icon: a.severity === "info" ? "info" : "campaign", title: a.title, body: a.message });
    for (const f of live.fixes) info.push({ href: "/admin/batches", icon: "view_timeline", title: `${f.ghatName} batch ${f.batchNo} · ${f.percent}%`, body: f.action });
  }
  const list = tab === "action" ? action : info;
  return (
    <div className="a-pop a-notes-pop" ref={ref} role="dialog" aria-label={t("notifications")}>
      <div className="a-row" style={{ justifyContent: "space-between" }}><b>{t("notifications")}</b><button className="icon-btn" onClick={onClose} aria-label="Close"><span className="icon">close</span></button></div>
      <div className="a-tabs" role="group">
        <button aria-pressed={tab === "action"} onClick={() => setTab("action")}>{t("needsAction")} {action.length}</button>
        <button aria-pressed={tab === "info"} onClick={() => setTab("info")}>{t("forInfo")} {info.length}</button>
      </div>
      {list.length === 0 ? <div className="muted" style={{ padding: 12 }}>{t("noAlerts")}</div> : list.map((n, i) => (
        <Link key={i} href={n.href} className="a-note-item" onClick={onClose}><span className="icon">{n.icon}</span><span><b>{n.title}</b><small>{n.body}</small></span></Link>
      ))}
    </div>
  );
}

function SearchSheet({ live, onClose }: { live: Live | null; onClose: () => void }) {
  const { t } = useAdminT();
  const { can: allowed } = useMe();
  const ref = useDismiss(onClose);
  const [q, setQ] = useState("");
  const [fam, setFam] = useState<{ id: string; passCode: string; leaderName: string; phoneLast4: string; people?: number }[]>([]);
  const [cases, setCases] = useState<{ id: string; code: string; personName: string; status: string }[]>([]);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFam([]); setCases([]); return; }
    const id = setTimeout(() => {
      if (allowed("families.view")) void api<{ families: typeof fam }>(`/api/admin/families?q=${encodeURIComponent(term)}`).then((r) => setFam(r.families.slice(0, 6))).catch(() => setFam([]));
      if (allowed("lost.view")) void api<{ cases: typeof cases }>(`/api/admin/lost?q=${encodeURIComponent(term)}`).then((r) => setCases(r.cases.slice(0, 6))).catch(() => setCases([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q, allowed]);
  const ghats = (live?.ghats ?? []).filter((g) => q.trim().length >= 1 && (g.name.toLowerCase().includes(q.toLowerCase()) || g.nameHi.includes(q)));
  const dictate = () => {
    type SR = { lang: string; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void };
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!C) return;
    const r = new C();
    r.lang = document.documentElement.lang === "hi" ? "hi-IN" : "en-IN";
    r.onresult = (e) => setQ(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };
  const none = q.trim().length >= 2 && !ghats.length && !fam.length && !cases.length;
  return (
    <div className="a-pop a-search-pop" ref={ref} role="dialog" aria-label={t("search")}>
      <div className="a-search open">
        <span className="icon">search</span>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
        <button className="icon-btn" onClick={dictate} aria-label="Speak" aria-pressed={listening}><span className="icon">{listening ? "graphic_eq" : "mic"}</span></button>
      </div>
      {ghats.length > 0 && <><div className="sep">{t("ghatsLabel")}</div>{ghats.map((g) => <Link key={g.id} className="a-note-item" href={`/admin/ghat?id=${g.id}`} onClick={onClose}><span className="icon">location_on</span><span><b>{g.name}</b><small>{g.percent}% · {g.gate}</small></span></Link>)}</>}
      {fam.length > 0 && <><div className="sep">{t("families")}</div>{fam.map((f) => <Link key={f.id} className="a-note-item" href={`/admin/families?q=${encodeURIComponent(f.passCode)}`} onClick={onClose}><span className="icon">family_restroom</span><span><b>{f.leaderName}</b><small className="mono">{f.passCode} · ••{f.phoneLast4}</small></span></Link>)}</>}
      {cases.length > 0 && <><div className="sep">{t("casesLabel")}</div>{cases.map((c) => <Link key={c.id} className="a-note-item" href={`/admin/lost?q=${encodeURIComponent(c.code)}`} onClick={onClose}><span className="icon">person_search</span><span><b>{c.personName}</b><small>{c.code} · {c.status}</small></span></Link>)}</>}
      {none && <div className="muted" style={{ padding: 12 }}>{t("searchNoResults", { q: q.trim() })}</div>}
    </div>
  );
}

function Sahayak({ onClose, connected, initial }: { onClose: () => void; connected: boolean; initial?: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ q: string; a?: string; err?: string; at?: string; mode?: string; note?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setItems((s) => [...s, { q: question }]);
    setQ("");
    try {
      const r = await api<{ answer: string; basedOn: string; mode: "gemini" | "builtin"; note?: string }>("/api/admin/assistant", { body: { question } });
      setItems((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, a: r.answer, at: r.basedOn, mode: r.mode, note: r.note } : x)));
    } catch (e) {
      setItems((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, err: e instanceof Error ? e.message : "Failed" } : x)));
    } finally {
      setBusy(false);
    }
  };
  const asked = useRef(false);
  useEffect(() => { if (initial && !asked.current) { asked.current = true; void ask(initial); } }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <aside className="glass a-sheet" aria-label="Sahayak assistant">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="k-avatar" style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--primary)", color: "var(--on-primary)", display: "grid", placeItems: "center" }}><span className="icon">graphic_eq</span></div>
        <div style={{ flex: 1 }}><b>Sahayak</b><div className="muted" style={{ fontSize: 12 }}>Answers from live counts · suggestions only{connected ? "" : " · built-in mode"}</div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><span className="icon">close</span></button>
      </div>
      {!connected && (
        <div className="banner info" style={{ fontSize: 13 }}><span className="icon sm">calculate</span> AI isn't connected here, so Sahayak answers from built-in rules over the live numbers (no AI). Add a Gemini key to turn on AI answers.</div>
      )}
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["Which ghat has room right now?", "Summarise the open help requests", "Which crowd numbers are out of date?"].map((s) => (
              <button key={s} className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => ask(s)} disabled={busy}>{s}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto", display: "grid", gap: 12, alignContent: "start" }} aria-live="polite">
            {items.map((it, i) => (
              <div key={i} style={{ display: "grid", gap: 6 }}>
                <div className="chip brand" style={{ justifySelf: "end", height: "auto", padding: "8px 12px", whiteSpace: "normal" }}>{it.q}</div>
                {it.a && <div className="card" style={{ whiteSpace: "pre-wrap" }}>{it.a}<div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{it.mode === "gemini" ? "AI suggestion" : "Built-in answer (no AI)"} · numbers as of {it.at} · check before acting{it.note ? ` · ${it.note}` : ""}</div></div>}
                {it.err && <div className="banner bad">{it.err}</div>}
                {!it.a && !it.err && <div className="muted">Thinking…</div>}
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} style={{ display: "flex", gap: 8 }}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about crowds, batches or cases" maxLength={400} aria-label="Question for Sahayak" />
            <button className="btn btn-filled" disabled={busy || q.trim().length < 3}>Ask</button>
          </form>
        </>
    </aside>
  );
}
