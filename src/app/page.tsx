import Link from "next/link";

export default function Home() {
  const items = [
    { href: "/kiosk", icon: "touch_app", title: "Registration kiosk", text: "Pilgrims register their family, scan Aadhaar or use a phone code, pick a bathing slot and get a pass.", filled: true },
    { href: "/admin", icon: "space_dashboard", title: "Control room", text: "Live map, batches, diversions with a second check, lost & found with face matching, sensors and shift handover. Staff sign-in." },
    { href: "/pass", icon: "confirmation_number", title: "My pass", text: "On a pilgrim's own phone: see the latest pass and any ghat change with the pass number and last 4 phone digits." },
    { href: "/camera", icon: "videocam", title: "Camera crowd counter", text: "Turn a phone or laptop into a crowd sensor. Counts people on the device and sends only the number." },
  ];
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="glass" style={{ padding: 36, maxWidth: 760, width: "100%" }}>
        <p className="muted" style={{ margin: 0, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>Maha Kumbh · crowd management</p>
        <h1 style={{ fontWeight: 400, fontSize: 36, margin: "8px 0 8px" }}>Sangam Seva</h1>
        <p className="muted" style={{ marginTop: 0 }}>Choose the part of the system you want to open.</p>
        <div style={{ display: "grid", gap: 12, marginTop: 20, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {items.map((i) => (
            <Link key={i.href} href={i.href} className={`btn ${i.filled ? "btn-filled" : "btn-tonal"}`} style={{ height: "auto", padding: "16px 18px", justifyContent: "flex-start", alignItems: "flex-start", textAlign: "left", gap: 12, whiteSpace: "normal" }}>
              <span className="icon">{i.icon}</span>
              <span style={{ display: "grid", gap: 4 }}><b style={{ fontSize: 16 }}>{i.title}</b><span style={{ fontSize: 13, fontWeight: 400, opacity: 0.9 }}>{i.text}</span></span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
