"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import "./admin.css";
import { api } from "./client";
import { can, ROLE_LABELS, type Permission, type Role } from "@/shared/rbac";

export type Me = { id: string; name: string; email: string; role: Role };
export type Integrations = { sms: boolean; otpDevMode: boolean; voice: boolean; assistant: boolean };

const Ctx = createContext<{ me: Me; integrations: Integrations; can: (p: Permission) => boolean } | null>(null);
export function useMe() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe outside Shell");
  return v;
}

const NAV: { href: string; label: string; icon: string; perm: Permission }[] = [
  { href: "/admin", label: "Overview", icon: "space_dashboard", perm: "overview.view" },
  { href: "/admin/families", label: "Families", icon: "family_restroom", perm: "families.view" },
  { href: "/admin/help", label: "Help", icon: "volunteer_activism", perm: "help.view" },
  { href: "/admin/lost", label: "Lost & found", icon: "person_search", perm: "lost.view" },
  { href: "/admin/alerts", label: "Alerts", icon: "campaign", perm: "alerts.view" },
  { href: "/admin/kiosks", label: "Kiosks", icon: "desktop_windows", perm: "kiosks.view" },
  { href: "/admin/reports", label: "Reports", icon: "summarize", perm: "reports.view" },
  { href: "/admin/users", label: "Staff", icon: "badge", perm: "users.manage" },
  { href: "/admin/audit", label: "Activity", icon: "history", perm: "audit.view" },
];

export default function Shell({ me, integrations, children }: { me: Me; integrations: Integrations; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sahayak, setSahayak] = useState(false);
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
  const value = { me, integrations, can: (p: Permission) => can(me.role, p) };

  return (
    <Ctx.Provider value={value}>
      <div className="a-root">
        <nav className="a-rail" aria-label="Main">
          <div className="logo" aria-hidden="true"><span className="icon">waves</span></div>
          {NAV.filter((n) => can(me.role, n.perm)).map((n) => {
            const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className="a-dest" aria-current={active ? "page" : undefined}>
                <span className="pill"><span className="icon">{n.icon}</span></span>
                {n.label}
              </Link>
            );
          })}
          <div className="bottom">
            <button className="icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Light theme" : "Dark theme"} title="Theme">
              <span className="icon">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
            </button>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out"><span className="icon">logout</span></button>
          </div>
        </nav>
        <div className="a-main">
          <header className="a-top">
            <div style={{ flex: 1 }}>
              <div className="sub">Sangam Command · signed in as {me.name} · {ROLE_LABELS[me.role]}</div>
            </div>
            {can(me.role, "assistant.use") && (
              <button className="btn btn-tonal" onClick={() => setSahayak(true)}><span className="icon">graphic_eq</span> Ask Sahayak</button>
            )}
          </header>
          <main className="a-content">{children}</main>
        </div>
        {sahayak && <><div className="a-sheet-scrim" onClick={() => setSahayak(false)} aria-hidden="true" /><Sahayak onClose={() => setSahayak(false)} connected={integrations.assistant} /></>}
      </div>
    </Ctx.Provider>
  );
}

function Sahayak({ onClose, connected }: { onClose: () => void; connected: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ q: string; a?: string; err?: string; at?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setItems((s) => [...s, { q: question }]);
    setQ("");
    try {
      const r = await api<{ answer: string; basedOn: string }>("/api/admin/assistant", { body: { question } });
      setItems((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, a: r.answer, at: r.basedOn } : x)));
    } catch (e) {
      setItems((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, err: e instanceof Error ? e.message : "Failed" } : x)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="glass a-sheet" aria-label="Sahayak assistant">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="k-avatar" style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--primary)", color: "var(--on-primary)", display: "grid", placeItems: "center" }}><span className="icon">graphic_eq</span></div>
        <div style={{ flex: 1 }}><b>Sahayak</b><div className="muted" style={{ fontSize: 12 }}>Answers from live counts · suggestions only</div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><span className="icon">close</span></button>
      </div>
      {!connected ? (
        <div className="banner warn"><span className="icon">cloud_off</span> Sahayak is not connected on this server. An administrator needs to add a Gemini API key (see README).</div>
      ) : (
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
                {it.a && <div className="card" style={{ whiteSpace: "pre-wrap" }}>{it.a}<div className="muted" style={{ fontSize: 11, marginTop: 8 }}>AI suggestion · check before acting</div></div>}
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
      )}
    </aside>
  );
}
