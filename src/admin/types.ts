export type Level = "calm" | "moderate" | "busy" | "very_busy";
export type GateLive = { id: string; name: string; kind: string; status: string; mapX: number; mapY: number; inPerMin: number | null; outPerMin: number | null };
export type GhatLive = {
  id: string; name: string; nameHi: string; gate: string; capacity: number; occupancy: number; percent: number; safeLimitPct: number;
  level: Level; source: string; updatedAt: string | null; updatedMinutesAgo: number | null; meetingPoint: string; walkNote: string;
  mapX: number; mapY: number;
  flow: { inPerMin: number; outPerMin: number; source: string } | null;
  projection: { minutesToSafeLimit: number | null; minutesToFull: number | null; trend: "rising" | "falling" | "steady" };
  gates: GateLive[];
};
export type Fix = { slotId: string; ghatId: string; ghatName: string; start: string; end: string; batchNo: number; percent: number; label: string; action: string; suggestion: { kind: string; toGhatId?: string; toGhatName?: string; toSlotId?: string } | null };
export type Live = {
  generatedAt: string; now: string; today: string; ghats: GhatLive[];
  totals: { people: number; sources: string[]; batchesDone: number; batches: number; overfull: number };
  help: { open: number; lost: number; medical: number; oldestMinutes: number | null };
  lostOpen: { code: string; personName: string; age: number | null; minutes: number }[];
  alerts: { id: string; severity: string; title: string; message: string; createdAt: string }[];
  nextPeak: { time: string; people: number } | null;
  kiosks: { total: number; online: number };
  sensors: { total: number; real: number; online: number };
  fixes: Fix[];
  pendingDiversions: { id: string; code: string }[];
  onShift: string[];
  series: { people: number[]; help: number[]; demand: number[]; done: number[] };
  kioskPins: { id: string; location: string; mapX: number; mapY: number; online: boolean }[];
  cameras: { id: string; name: string; ghatId: string; simulated: boolean; mapX: number; mapY: number; count: number | null; online: boolean }[];
};

/** Figma crowd scale: low / moderate / high / critical. */
export const LEVEL: Record<Level, { label: string; chip: string; color: string }> = {
  calm: { label: "Calm", chip: "good", color: "var(--crowd-low)" },
  moderate: { label: "Moderate", chip: "warn", color: "var(--crowd-moderate)" },
  busy: { label: "Busy", chip: "bad", color: "var(--crowd-high)" },
  very_busy: { label: "Critical", chip: "bad", color: "var(--crowd-critical)" },
};
/** Colour by % against the ghat's safe limit (what the callouts and bars use in Figma). */
export function crowdColor(percent: number, safe = 80) {
  return percent >= safe ? "var(--crowd-critical)" : percent >= safe - 10 ? "var(--crowd-high)" : percent >= 50 ? "var(--crowd-moderate)" : "var(--crowd-low)";
}
export function compactPeople(n: number): { v: string; unit: string } {
  if (n >= 100_000) return { v: (n / 100_000).toFixed(1).replace(/\.0$/, ""), unit: "lakh" };
  if (n >= 1_000) return { v: (n / 1_000).toFixed(1).replace(/\.0$/, ""), unit: "thousand" };
  return { v: String(n), unit: "" };
}

export const SOURCE_LABEL: Record<string, string> = { sensor: "Sensor", manual: "Entered by staff", simulated: "Simulated", none: "No data" };

export function fmt(n: number) {
  return n.toLocaleString("en-IN");
}

export function etaText(p: GhatLive["projection"], safeLimitPct: number): string {
  if (p.trend !== "rising") return p.trend === "falling" ? "Emptying" : "Steady";
  if (p.minutesToSafeLimit === 0) return `Above the ${safeLimitPct}% safe limit`;
  if (p.minutesToSafeLimit !== null && p.minutesToSafeLimit <= 180) return `Reaches ${safeLimitPct}% in ~${p.minutesToSafeLimit} min`;
  return "Rising slowly";
}
