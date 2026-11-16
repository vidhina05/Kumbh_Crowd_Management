"use client";
import { LEVEL } from "./types";

export function Legend() {
  return (
    <div className="a-row" style={{ gap: 16, fontSize: 12 }} aria-label="Map legend">
      {(["calm", "moderate", "busy"] as const).map((l) => <span key={l} className="a-provenance"><span style={{ width: 12, height: 12, borderRadius: 6, background: LEVEL[l].color, display: "inline-block" }} /> {l === "busy" ? "Busy / very busy" : LEVEL[l].label}</span>)}
      <span className="a-provenance">Ring = % full · pulsing = above safe limit</span>
    </div>
  );
}

export function Kpi({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="a-kpi" style={tone ? { borderColor: tone === "bad" ? "var(--error)" : "var(--warning)" } : undefined}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {note && <div className="l">{note}</div>}
    </div>
  );
}
