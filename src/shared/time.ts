/** The Mela runs on Indian Standard Time (UTC+05:30, no daylight saving). */
export const IST_OFFSET_MIN = 330;

export function istDate(d = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A date + "HH:MM" in IST → the real instant. */
export function istInstant(day: string, hhmm: string): Date {
  return new Date(new Date(`${day}T${hhmm}:00Z`).getTime() - IST_OFFSET_MIN * 60_000);
}

export function istTime(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(11, 16);
}

export function minutesAgo(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60_000));
}

export function crowdLevel(occupancy: number, capacity: number): "calm" | "moderate" | "busy" | "very_busy" {
  const p = capacity > 0 ? occupancy / capacity : 0;
  if (p < 0.5) return "calm";
  if (p < 0.75) return "moderate";
  if (p < 0.9) return "busy";
  return "very_busy";
}
