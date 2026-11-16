"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Shell, { type Integrations, type Me } from "@/admin/Shell";
import { AdminApiError, api } from "@/admin/client";

/**
 * Signed-in area. The server checks the session on every API call; this gate only decides what to render.
 * It also sends staff whose role needs two-step sign-in to set it up before anything else.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<{ me: Me; integrations: Integrations } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ user: Me; integrations: Integrations }>("/api/admin/me")
      .then((r) => {
        if (!alive) return;
        setState({ me: r.user, integrations: r.integrations });
        if (r.user.mfaSetupRequired && !path.startsWith("/admin/settings")) router.replace("/admin/settings?mfa=1");
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof AdminApiError && e.status === 401) router.replace(`/admin/login?next=${encodeURIComponent(path)}`);
        else setError(e instanceof Error ? e.message : "Couldn't load your account.");
      });
    return () => { alive = false; };
  }, [path, router]);

  if (error) return <main className="a-empty" style={{ padding: 48 }}><div className="banner bad" role="alert">{error} <button className="btn btn-text" onClick={() => location.reload()}>Try again</button></div></main>;
  if (!state) return <main className="a-empty" style={{ padding: 48 }} aria-busy="true">Checking your sign-in…</main>;
  return <Shell me={state.me} integrations={state.integrations}>{children}</Shell>;
}
