import "server-only";
import { eq, sql } from "drizzle-orm";
import { getConn, getDb, schema } from "./db";
import { encrypt, lookupHash, randomToken, sha256 } from "./crypto";
import { hashPassword } from "./auth";
import { GHATS, gatesFor, seedReferenceData } from "./seed";
import { addDays, istDate, istInstant } from "@/shared/time";
import { createSensor } from "./services/sensors";
import { demandCurve } from "./services/crowd";

/**
 * DEMO DATA — used only by the in-browser demo (GitHub Pages) and `npm run db:seed -- --demo` on staging.
 * Everything here is invented and the UI says "Demo data" on every screen of a demo build.
 * Never run this against a production database.
 */
export const DEMO_PASSWORD = "Sangam-demo-2026";
export const DEMO_STAFF = [
  { email: "kavita@demo.sangamseva.in", name: "Kavita Sharma", role: "super_admin" },
  { email: "rohit@demo.sangamseva.in", name: "Rohit Verma", role: "crowd_control" },
  { email: "rajesh@demo.sangamseva.in", name: "Rajesh Kumar", role: "operations" },
  { email: "anjali@demo.sangamseva.in", name: "Anjali Gupta", role: "help_desk" },
  { email: "meena@demo.sangamseva.in", name: "Dr. Meena Rao", role: "medical" },
] as const;

const FIRST = ["Ramesh", "Suresh", "Anita", "Vijay", "Kusum", "Mohan", "Prakash", "Geeta", "Lakshmi", "Arjun", "Savita", "Dinesh", "Kamla", "Rajendra", "Pushpa", "Shankar", "Usha", "Gopal", "Radha", "Hari"];
const LAST = ["Sharma", "Verma", "Yadav", "Gupta", "Mishra", "Patel", "Singh", "Tiwari", "Pandey", "Chauhan", "Joshi", "Dubey", "Nair", "Reddy", "Das", "Kumar"];
const TOWNS = ["Varanasi", "Patna", "Indore", "Jaipur", "Nagpur", "Lucknow", "Bhopal", "Kolkata", "Pune", "Surat", "Ranchi", "Gorakhpur"];
const LANGS = ["hi", "hi", "hi", "hi", "bn", "mr", "gu", "ta", "te", "en", "pa", "kn", "ml"];

export async function isSeeded() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.adminUsers);
  return n > 0;
}

export async function seedDemo(kioskToken: string, opts: { slotCapacityDivisor?: number } = {}) {
  const db = await getDb();
  const { raw } = await getConn();
  await seedReferenceData(4);
  const div = opts.slotCapacityDivisor ?? 160;
  // Demo slots are smaller so a few thousand demo families fill them realistically.
  for (const g of GHATS) {
    await db.update(schema.slots).set({ capacity: Math.max(40, Math.round(g.capacity / div)) }).where(eq(schema.slots.ghatId, g.id));
  }

  const pw = await hashPassword(DEMO_PASSWORD);
  for (const s of DEMO_STAFF) await db.insert(schema.adminUsers).values({ ...s, passwordHash: pw }).onConflictDoNothing();
  await db.insert(schema.kiosks).values({ id: "K-17", name: "Registration kiosk", location: "Sector 4 entry plaza", tokenHash: sha256(kioskToken), mapX: 22, mapY: 62 }).onConflictDoNothing();
  for (const [id, loc, x, y] of [["K-03", "Parade Ground gate", 64, 18], ["K-09", "Arail bridge", 76, 54], ["K-22", "Jhusi parking", 88, 82]] as const) {
    await db.insert(schema.kiosks).values({ id, name: "Registration kiosk", location: loc, tokenHash: sha256(randomToken(32)), mapX: x, mapY: y }).onConflictDoNothing();
  }

  // Simulated sensors: a zone counter per ghat, a counter on every gate, a camera counter at Sangam.
  for (const g of GHATS) {
    await createSensor({ name: `${g.name} zone counter`, kind: "zone_counter", ghatId: g.id, simulated: true }, null);
    for (const gate of gatesFor(g)) await createSensor({ name: `${g.name} ${gate.name} counter`, kind: "gate_counter", ghatId: g.id, gateId: gate.id, simulated: true }, null);
  }
  await createSensor({ name: "Sangam steps camera 04", kind: "camera_counter", ghatId: "sangam", simulated: true }, null);

  // Families booked across today's and tomorrow's batches, following the usual bathing-day curve.
  const today = istDate();
  const phoneEnc = encrypt("+919800000000");
  const phoneHash = lookupHash("demo-family-no-real-phone");
  for (const day of [today, addDays(today, 1)]) {
    const slots = await db.select().from(schema.slots).where(eq(schema.slots.day, day));
    const values: string[] = [];
    let n = 0;
    for (const s of slots) {
      const [h, m] = s.startTime.split(":").map(Number);
      const busy = s.ghatId === "sangam" ? 1.08 : s.ghatId === "arail-ghat" ? 0.98 : s.ghatId === "parade-ghat" || s.ghatId === "dashashwamedh" ? 0.85 : 0.62;
      const fill = Math.min(1.0, demandCurve(h * 60 + m) * busy * (day === today ? 1 : 0.7));
      const people = Math.round(s.capacity * fill);
      const families = Math.max(0, Math.round(people / 3.6));
      for (let i = 0; i < families; i++) {
        n++;
        const leader = `${FIRST[(n * 7) % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`;
        const deleteAfter = new Date(istInstant(day, s.endTime).getTime() + 48 * 3600_000).toISOString();
        values.push(
          `('${s.id}', 'KMB-${s.batchNo}-D${String(n).padStart(5, "0")}${day === today ? "" : "T"}', '${leader}', '${TOWNS[n % TOWNS.length]}', '${LANGS[n % LANGS.length]}', '${String(1000 + ((n * 37) % 9000))}', '${deleteAfter}', ${1 + (n % 6)})`,
        );
      }
    }
    for (let i = 0; i < values.length; i += 400) {
      await raw.exec(`
        WITH input(slot_id, pass_code, leader, town, lang, last4, delete_after, size) AS (VALUES ${values.slice(i, i + 400).join(",")}),
        ins AS (
          INSERT INTO families (pass_code, leader_name, phone_enc, phone_hash, phone_last4, home_town, language, meeting_point, slot_id, kiosk_id, consent_version, consent_at, photo_consent, delete_after, created_at)
          SELECT i.pass_code, i.leader, '${phoneEnc}', '${phoneHash}', i.last4, i.town, i.lang, g.meeting_point, i.slot_id::uuid, 'K-17', '2026-01', now(), false, i.delete_after::timestamptz, now() - (random() * interval '10 hours')
          FROM input i JOIN slots s ON s.id = i.slot_id::uuid JOIN ghats g ON g.id = s.ghat_id
          RETURNING id, leader_name, pass_code
        )
        INSERT INTO members (family_id, name, age, relation, is_leader, band_id, sort_order)
        SELECT ins.id,
               CASE WHEN k = 1 THEN ins.leader_name ELSE (ARRAY['Asha','Neel','Pooja','Ganga','Ravi','Meera','Kiran','Om','Sita','Dev'])[1 + (k * 3 + length(ins.pass_code)) % 10] || ' ' || split_part(ins.leader_name, ' ', 2) END,
               CASE WHEN k = 1 THEN 35 + (length(ins.leader_name) * 7) % 30 WHEN k = 2 THEN 33 + (k * 5) % 20 WHEN k = 3 THEN 6 + (length(ins.pass_code) % 9) ELSE 66 + k END,
               CASE WHEN k = 1 THEN 'self' WHEN k = 2 THEN 'spouse' WHEN k = 3 THEN 'child' ELSE 'parent' END,
               k = 1,
               CASE WHEN k = 1 OR k = 3 OR k >= 4 THEN 'WB-D' || substr(md5(ins.id::text || k::text), 1, 8) ELSE NULL END,
               k - 1
        FROM ins JOIN input i ON i.pass_code = ins.pass_code
        CROSS JOIN LATERAL generate_series(1, i.size) AS k
      `);
    }
    await raw.exec(`UPDATE slots s SET booked = least(s.capacity, sub.n) FROM (SELECT f.slot_id, count(m.id)::int AS n FROM families f JOIN members m ON m.family_id = f.id GROUP BY f.slot_id) sub WHERE sub.slot_id = s.id AND s.day = '${day}'`);
  }

  // The Sharma family from the Figma story, registered at K-17 for tomorrow at Ram Ghat.
  const [ram] = await db.select().from(schema.slots).where(sql`${schema.slots.ghatId} = 'ram-ghat' and ${schema.slots.day} = ${addDays(today, 1)} and ${schema.slots.startTime} = '06:00'`);
  if (ram) {
    const [f] = await db
      .insert(schema.families)
      .values({ passCode: "KMB-5-SHRM", leaderName: "Ramesh Sharma", phoneEnc: encrypt("+919876544410"), phoneHash: lookupHash("+919876544410"), phoneLast4: "4410", homeTown: "Varanasi", language: "hi", meetingPoint: "Blue tower, Sector 4", slotId: ram.id, kioskId: "K-17", consentVersion: "2026-01", consentAt: new Date(), photoConsent: false, deleteAfter: new Date(istInstant(ram.day, ram.endTime).getTime() + 48 * 3600_000), idMethod: "aadhaar", aadhaarLast4: "7731", phoneVerified: false })
      .onConflictDoNothing()
      .returning();
    if (f) {
      await db.insert(schema.members).values([
        { familyId: f.id, name: "Ramesh Sharma", age: 54, relation: "self", isLeader: true, bandId: "WB-SHRM01", sortOrder: 0 },
        { familyId: f.id, name: "Asha Sharma", age: 51, relation: "spouse", sortOrder: 1 },
        { familyId: f.id, name: "Ganga Devi", age: 78, relation: "parent", needs: ["wheelchair"], bandId: "WB-SHRM02", sortOrder: 2 },
        { familyId: f.id, name: "Neel Sharma", age: 7, relation: "child", bandId: "WB-SHRM03", sortOrder: 3 },
        { familyId: f.id, name: "Pooja Sharma", age: 26, relation: "child", sortOrder: 4 },
      ]);
      await db.update(schema.slots).set({ booked: sql`${schema.slots.booked} + 5` }).where(eq(schema.slots.id, ram.id));
      await db.insert(schema.lostCases).values({ code: "L-0655", personName: "Neel Sharma", age: 7, description: "Red shirt, blue shorts", lastSeen: "Near Gate 6 food stalls", reporterName: "Ramesh Sharma", reporterPhoneLast4: "4410", status: "searching", kioskId: "K-17", familyId: f.id });
    }
  }
  const help = [
    { code: "H-0219", type: "lost_person", description: "Girl, 8, lost near Gate 2. Pink frock.", location: "Gate 2, Sangam", priority: "high" },
    { code: "H-0221", type: "wheelchair", description: "Wheelchair to Ram Ghat for an 80-year-old.", location: "Sector 4 entry plaza", priority: "normal" },
    { code: "H-0224", type: "medical", description: "Man slipped on the steps, ankle pain.", location: "Dashashwamedh steps", priority: "high" },
    { code: "H-0226", type: "other", description: "Couple can't find their camp in Sector 7.", location: "Arail bridge", priority: "normal" },
    { code: "H-0229", type: "language", description: "Needs a Tamil interpreter.", location: "Kiosk K-17", priority: "normal" },
  ];
  for (const h of help) await db.insert(schema.helpRequests).values({ ...h, kioskId: "K-17", createdAt: new Date(Date.now() - Math.random() * 40 * 60_000) }).onConflictDoNothing();
  await db.insert(schema.alerts).values({ severity: "info", title: "Heat advisory until 16:00", message: "Drink water. Shade and water points at every sector tower.", audience: "both" });
  return { families: await db.select({ n: sql<number>`count(*)::int` }).from(schema.families).then((r) => r[0].n) };
}
