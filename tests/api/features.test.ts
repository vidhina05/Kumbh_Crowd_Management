import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { seedDemo, DEMO_STAFF, DEMO_PASSWORD } from "@/server/demoSeed";
import { ghatsLive, resetSimulatorClockForTests, simulateTick } from "@/server/services/crowd";
import { batchPlan, createDiversion, approveDiversion, divertableBatches, targetOptions, undoDiversion, diversionDetail } from "@/server/services/diversions";
import { createSensor, ingest } from "@/server/services/sensors";
import { istDate, istTime } from "@/shared/time";

let kavita: { id: string; role: "super_admin" };

beforeAll(async () => {
  await seedDemo("demo-kiosk-token-0123456789");
  const db = await getDb();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.email, DEMO_STAFF[0].email));
  kavita = { id: u.id, role: "super_admin" };
}, 120_000);

describe("demo data and crowd simulator", () => {
  it("seeds families with members and booked slots", async () => {
    const db = await getDb();
    const [{ f }] = await db.select({ f: sql<number>`count(*)::int` }).from(schema.families);
    const [{ m }] = await db.select({ m: sql<number>`count(*)::int` }).from(schema.members);
    expect(f).toBeGreaterThan(500);
    expect(m).toBeGreaterThan(f);
  });

  it("simulator writes readings that are labelled simulated", async () => {
    resetSimulatorClockForTests();
    const n = await simulateTick(new Date(), 30);
    expect(n).toBeGreaterThan(100);
    const live = await ghatsLive();
    const sangam = live.find((g) => g.id === "sangam")!;
    expect(sangam.source).toBe("simulated");
    expect(sangam.occupancy).toBeGreaterThan(0);
    expect(sangam.flow?.source).toBe("simulated");
  });

  it("a real sensor reading wins over the simulator", async () => {
    const { id, key } = await createSensor({ name: "Ram zone", kind: "zone_counter", ghatId: "ram-ghat" }, kavita.id);
    await ingest(id, key, { occupancy: 12345 });
    resetSimulatorClockForTests();
    await simulateTick();
    const ram = (await ghatsLive()).find((g) => g.id === "ram-ghat")!;
    expect(ram.occupancy).toBe(12345);
    expect(ram.source).toBe("sensor");
    await expect(ingest(id, "sk_wrong_key_123", { occupancy: 1 })).rejects.toThrow();
  });
});

describe("batch plan and diversions", () => {
  it("finds over-full batches and moves families after a second check, then undoes", async () => {
    const day = istDate();
    const plan = await batchPlan(day);
    expect(plan.ghats.length).toBe(12);
    const batches = (await divertableBatches("sangam", day)).filter((b) => b.families > 0 && b.phase === "later");
    if (!batches.length) return; // late in the day: nothing left to divert
    const pick = batches.slice(0, 2).map((b) => b.id);
    const opts = await targetOptions("sangam", pick);
    const target = opts.options.find((o) => !o.avoid)!;
    expect(target).toBeTruthy();
    const d = await createDiversion({ fromGhatId: "sangam", slotIds: pick, toGhatId: target.ghatId, reason: "test" }, kavita);
    expect(d.status).toBe("awaiting_approval");
    await expect(approveDiversion(d.id, { email: DEMO_STAFF[0].email, password: DEMO_PASSWORD }, kavita.id)).rejects.toThrow(/different person/);
    const sent = await approveDiversion(d.id, { email: DEMO_STAFF[1].email, password: DEMO_PASSWORD }, kavita.id);
    expect(sent.status).toBe("sent");
    expect(sent.stats.families).toBeGreaterThan(0);
    expect(sent.stats.smsNotConnected).toBe(sent.stats.families);
    const db = await getDb();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.families).where(sql`${schema.families.slotId} in ${pick}`);
    expect(n).toBe(0);
    const undone = await undoDiversion(d.id, kavita.id);
    expect(undone.status).toBe("undone");
    const [{ back }] = await db.select({ back: sql<number>`count(*)::int` }).from(schema.families).where(sql`${schema.families.slotId} in ${pick}`);
    expect(back).toBe(sent.stats.families);
    expect((await diversionDetail(d.id)).events.map((e) => e.kind)).toEqual(["created", "approved", "sent", "notified", "undone"]);
    void istTime;
  });
});
