import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { randomToken, sha256 } from "./crypto";
import { hashPassword, passwordProblems } from "./auth";
import { addDays, istDate } from "@/shared/time";

/**
 * Reference data only: ghats, bathing slots and (optionally) the first kiosk and super admin.
 * It never creates pilgrims, cases or crowd numbers — those come from real use.
 * Edit GHATS to match the real Mela plan before going live.
 */
export const GHATS = [
  { id: "sangam", name: "Sangam", nameHi: "संगम", gate: "Gate 3", capacity: 44800, walkNote: "Long walk, busiest ghat", meetingPoint: "Yellow tower, Sector 5", sortOrder: 1, mapX: 53.2, mapY: 50.7 },
  { id: "arail-ghat", name: "Arail Ghat", nameHi: "अरैल घाट", gate: "Gate 9", capacity: 25000, walkNote: "Across the pontoon bridge", meetingPoint: "Red tower, Sector 7", sortOrder: 2, mapX: 71.6, mapY: 60.6 },
  { id: "parade-ghat", name: "Parade Ghat", nameHi: "परेड घाट", gate: "Gate 1", capacity: 30000, walkNote: "Flat path from Parade Ground", meetingPoint: "Orange tower, Sector 2", sortOrder: 3, mapX: 67.8, mapY: 25.3 },
  { id: "dashashwamedh", name: "Dashashwamedh", nameHi: "दशाश्वमेध", gate: "Gate 2", capacity: 15000, walkNote: "Steps to the water", meetingPoint: "White tower, Sector 1", sortOrder: 4, mapX: 30.7, mapY: 31.9 },
  { id: "hanuman-ghat", name: "Hanuman Ghat", nameHi: "हनुमान घाट", gate: "Gate 5", capacity: 14000, walkNote: "8-minute walk, gentle slope", meetingPoint: "Saffron tower, Sector 2", sortOrder: 5, mapX: 55.2, mapY: 23.1 },
  { id: "saraswati-ghat", name: "Saraswati Ghat", nameHi: "सरस्वती घाट", gate: "Gate 8", capacity: 16000, walkNote: "Paved path, some steps", meetingPoint: "Purple tower, Sector 3", sortOrder: 6, mapX: 85.9, mapY: 34.1 },
  { id: "jhusi-ghat", name: "Jhusi Ghat", nameHi: "झूसी घाट", gate: "Gate 11", capacity: 22000, walkNote: "Across the river, long walk", meetingPoint: "Grey tower, Sector 9", sortOrder: 7, mapX: 83.8, mapY: 76.0 },
  { id: "mahavir-ghat", name: "Mahavir Ghat", nameHi: "महावीर घाट", gate: "Gate 7", capacity: 12000, walkNote: "Short walk, no steps", meetingPoint: "Pink tower, Sector 6", sortOrder: 8, mapX: 26.6, mapY: 82.6 },
  { id: "kila-ghat", name: "Kila Ghat", nameHi: "किला घाट", gate: "Gate 4", capacity: 18000, walkNote: "12-minute walk", meetingPoint: "Green tower, Sector 4", sortOrder: 9, mapX: 38.9, mapY: 66.1 },
  { id: "somnath-ghat", name: "Somnath Ghat", nameHi: "सोमनाथ घाट", gate: "Gate 10", capacity: 13000, walkNote: "Ramp to the water", meetingPoint: "Teal tower, Sector 8", sortOrder: 10, mapX: 65.4, mapY: 84.8 },
  { id: "nagvasuki-ghat", name: "Nagvasuki Ghat", nameHi: "नागवासुकी घाट", gate: "Gate 12", capacity: 12000, walkNote: "Near the temple, some steps", meetingPoint: "Brown tower, Sector 1", sortOrder: 11, mapX: 16.4, mapY: 20.9 },
  { id: "ram-ghat", name: "Ram Ghat", nameHi: "राम घाट", gate: "Gate 6", capacity: 20000, walkNote: "Short walk, no steps", meetingPoint: "Blue tower, Sector 4", sortOrder: 12, mapX: 17.4, mapY: 56.2 },
];

/** Gates at each ghat (entry/exit), positioned around the ghat on the control-room map. */
export function gatesFor(g: (typeof GHATS)[number]) {
  const n = g.id === "sangam" ? 6 : g.capacity >= 20000 ? 3 : 2;
  const first = Number(g.gate.replace(/\D/g, "")) || 1;
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = g.id === "sangam" ? 9 : 4.5;
    return {
      id: `${g.id}-g${i + 1}`,
      ghatId: g.id,
      name: g.id === "sangam" ? `G${i + 1}` : `Gate ${first}${String.fromCharCode(65 + i)}`,
      kind: i % 2 === 0 ? "entry" : "exit",
      mapX: Math.max(2, Math.min(98, g.mapX + Math.cos(angle) * r)),
      mapY: Math.max(2, Math.min(98, g.mapY + Math.sin(angle) * r)),
    };
  });
}

/** 30-minute bathing windows from 04:00 to 18:00. */
export function slotTimes() {
  const out: { start: string; end: string }[] = [];
  for (let m = 4 * 60; m < 18 * 60; m += 30) {
    const f = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
    out.push({ start: f(m), end: f(m + 30) });
  }
  return out;
}

export async function seedReferenceData(days = 8) {
  const db = await getDb();
  for (const g of GHATS) {
    await db.insert(schema.ghats).values(g).onConflictDoNothing();
    for (const gate of gatesFor(g)) await db.insert(schema.gates).values(gate).onConflictDoNothing();
  }
  const times = slotTimes();
  const today = istDate();
  let created = 0;
  for (let d = 0; d < days; d++) {
    const day = addDays(today, d);
    const rows = GHATS.flatMap((g) =>
      times.map((t, i) => ({ ghatId: g.id, day, startTime: t.start, endTime: t.end, batchNo: i + 1, capacity: Math.round(g.capacity / 8) })),
    );
    const res = await db.insert(schema.slots).values(rows).onConflictDoNothing().returning({ id: schema.slots.id });
    created += res.length;
  }
  return { ghats: GHATS.length, slotsCreated: created };
}

export async function ensureKiosk(id: string, name: string, location: string): Promise<string | null> {
  const db = await getDb();
  const [k] = await db.select({ id: schema.kiosks.id }).from(schema.kiosks).where(eq(schema.kiosks.id, id));
  if (k) return null;
  const token = randomToken(32);
  await db.insert(schema.kiosks).values({ id, name, location, tokenHash: sha256(token) });
  return token;
}

export async function ensureSuperAdmin(email: string, name: string, password: string) {
  const problem = passwordProblems(password);
  if (problem) throw new Error(`SEED_ADMIN_PASSWORD is too weak: ${problem}`);
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.adminUsers);
  if (n > 0) return false;
  await db.insert(schema.adminUsers).values({ email: email.toLowerCase(), name, role: "super_admin", passwordHash: await hashPassword(password) });
  return true;
}
