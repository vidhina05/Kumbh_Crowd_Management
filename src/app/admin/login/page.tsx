"use client";
import { useState } from "react";
import { api } from "@/admin/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/auth/login", { body: { email, password } });
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/admin") ? next : "/admin";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setBusy(false);
    }
  };
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={submit} className="glass" style={{ width: "min(440px, 100%)", padding: 32, display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--primary)", color: "var(--on-primary)", display: "grid", placeItems: "center" }}><span className="icon">waves</span></div>
          <div><b>Sangam Command</b><div className="muted" style={{ fontSize: 12 }}>Control room · staff only</div></div>
        </div>
        <h1 style={{ margin: "8px 0 0", fontWeight: 400, fontSize: 28 }}>Sign in to your shift</h1>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="banner bad" role="alert"><span className="icon">error</span> {error}</div>}
        <button className="btn btn-filled" style={{ height: 48 }} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Locked out? A super admin can reset your password. Every action is logged against your account.</p>
      </form>
    </main>
  );
}
