import Link from "next/link";

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="glass" style={{ padding: 40, maxWidth: 560, width: "100%" }}>
        <p className="muted" style={{ margin: 0, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Maha Kumbh · crowd management</p>
        <h1 style={{ fontWeight: 400, fontSize: 36, margin: "8px 0 8px" }}>Sangam Seva</h1>
        <p className="muted" style={{ marginTop: 0 }}>Choose the part of the system you want to open.</p>
        <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
          <Link className="btn btn-filled" href="/kiosk" style={{ height: 56, fontSize: 16 }}>
            <span className="icon">touch_app</span> Registration kiosk
          </Link>
          <Link className="btn btn-tonal" href="/admin" style={{ height: 56, fontSize: 16 }}>
            <span className="icon">space_dashboard</span> Control room (staff sign-in)
          </Link>
        </div>
      </div>
    </main>
  );
}
