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
  { id: "sangam", name: "Sangam", nameHi: "संगम", gate: "Gate 3", capacity: 45000, walkNote: "Long walk, busiest ghat", meetingPoint: "Yellow tower, Sector 1", sortOrder: 1 },
  { id: "ram-ghat", name: "Ram Ghat", nameHi: "राम घाट", gate: "Gate 6", capacity: 20000, walkNote: "Short walk, no steps", meetingPoint: "Blue tower, Sector 4", sortOrder: 2 },
  { id: "kila-ghat", name: "Kila Ghat", nameHi: "किला घाट", gate: "Gate 4", capacity: 18000, walkNote: "12-minute walk", meetingPoint: "Green tower, Sector 2", sortOrder: 3 },
  { id: "arail-ghat", name: "Arail Ghat", nameHi: "अरैल घाट", gate: "Gate 9", capacity: 25000, walkNote: "Across the pontoon bridge", meetingPoint: "Red tower, Sector 7", sortOrder: 4 },
  { id: "dashashwamedh", name: "Dashashwamedh", nameHi: "दशाश्वमेध", gate: "Gate 2", capacity: 15000, walkNote: "Steps to the water", meetingPoint: "White tower, Sector 3", sortOrder: 5 },
];

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
  for (const g of GHATS) await db.insert(schema.ghats).values(g).onConflictDoNothing();
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
