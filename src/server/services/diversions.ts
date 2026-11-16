import "server-only";
import bcrypt from "bcryptjs";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, randomCode } from "../crypto";
import { HttpError, badRequest, conflict, forbidden, notFound } from "../http";
import { audit } from "../audit";
import { can, type Role } from "@/shared/rbac";
import { istDate, istTime } from "@/shared/time";
import { sendTextSms } from "../integrations/sms";
import { verifyTotpForUser } from "./mfa";

/**
 * Batch plan and diversions.
 *
 * A "batch" is one 30-minute bathing slot at one ghat. Its fill is the number of people booked into it
 * against the slot's capacity. A diversion moves every family booked on chosen batches at one ghat to the
 * same times at another ghat, after a second staff member approves it (two-person rule).
 */
export const OVERFULL_PCT = 90;
const AVOID_PCT = 90;

type SlotRow = typeof schema.slots.$inferSelect;
const pct = (s: { booked: number; capacity: number }) => (s.capacity > 0 ? Math.round((s.booked / s.capacity) * 100) : 0);
const nowHHMM = () => istTime(new Date());

export function slotPhase(s: { startTime: string; endTime: string; day: string }, today = istDate(), now = nowHHMM()) {
  if (s.day < today) return "done" as const;
  if (s.day > today) return "later" as const;
  if (s.endTime <= now) return "done" as const;
  if (s.startTime <= now) return "bathing" as const;
  return "later" as const;
}

export async function batchPlan(day: string) {
  const db = await getDb();
  const ghats = await db.select().from(schema.ghats).orderBy(asc(schema.ghats.sortOrder));
  const slots = await db.select().from(schema.slots).where(eq(schema.slots.day, day)).orderBy(asc(schema.slots.startTime));
  const today = istDate();
  const now = nowHHMM();
  const rows = ghats.map((g) => ({
    ghatId: g.id,
    name: g.name,
    slots: slots
      .filter((s) => s.ghatId === g.id)
      .map((s) => ({ id: s.id, start: s.startTime, end: s.endTime, batchNo: s.batchNo, booked: s.booked, capacity: s.capacity, percent: pct(s), phase: slotPhase(s, today, now) })),
  }));
  const busiest = [...rows].sort((a, b) => b.slots.reduce((x, s) => x + s.percent, 0) - a.slots.reduce((x, s) => x + s.percent, 0));

  // "Fix these first": upcoming slots over the limit, each with a concrete move.
  const fixes: { slotId: string; ghatId: string; ghatName: string; start: string; end: string; batchNo: number; percent: number; label: "Over-full" | "At limit"; action: string; suggestion: { kind: "move" | "delay"; toGhatId?: string; toGhatName?: string; toSlotId?: string } | null }[] = [];
  for (const r of rows) {
    for (const s of r.slots) {
      if (s.phase === "done" || s.percent < OVERFULL_PCT - 5) continue;
      // Same rule as the diversion planner (targetOptions): the whole batch must fit and stay under the avoid line.
      const roomFor = (t: { booked: number; capacity: number }) => t.booked + s.booked <= t.capacity && Math.round(((t.booked + s.booked) / t.capacity) * 100) <= AVOID_PCT;
      const sameTime = rows
        .filter((o) => o.ghatId !== r.ghatId)
        .map((o) => ({ o, slot: o.slots.find((x) => x.start === s.start) }))
        .filter((x) => x.slot && roomFor(x.slot))
        .sort((a, b) => (a.slot!.booked + s.booked) / a.slot!.capacity - (b.slot!.booked + s.booked) / b.slot!.capacity)[0];
      const next = r.slots.find((x) => x.start > s.start && x.phase !== "done" && roomFor(x));
      const suggestion = sameTime
        ? { kind: "move" as const, toGhatId: sameTime.o.ghatId, toGhatName: sameTime.o.name, toSlotId: sameTime.slot!.id }
        : next
          ? { kind: "delay" as const, toGhatId: r.ghatId, toGhatName: r.name, toSlotId: next.id }
          : null;
      fixes.push({
        slotId: s.id,
        ghatId: r.ghatId,
        ghatName: r.name,
        start: s.start,
        end: s.end,
        batchNo: s.batchNo,
        percent: s.percent,
        label: s.percent >= OVERFULL_PCT ? "Over-full" : "At limit",
        action: sameTime ? `Move batch ${s.batchNo} to ${sameTime.o.name}` : next ? `Move batch ${s.batchNo} to ${next.start}` : "No room nearby — hold at camp",
        suggestion,
      });
    }
  }
  fixes.sort((a, b) => b.percent - a.percent);
  const all = rows.flatMap((r) => r.slots);
  const doneCount = all.filter((s) => s.phase === "done").length;
  return {
    day,
    now: day === today ? now : null,
    ghats: busiest,
    fixes,
    totals: { batches: all.length, done: doneCount, overfull: all.filter((s) => s.phase !== "done" && s.percent >= OVERFULL_PCT).length, booked: all.reduce((a, s) => a + s.booked, 0) },
  };
}

/** Batches at a ghat that can still be diverted (not started yet), with how many families each has. */
export async function divertableBatches(ghatId: string, day: string) {
  const db = await getDb();
  const slots = await db.select().from(schema.slots).where(and(eq(schema.slots.ghatId, ghatId), eq(schema.slots.day, day))).orderBy(asc(schema.slots.startTime));
  const counts = await db
    .select({ slotId: schema.families.slotId, families: sql<number>`count(*)::int` })
    .from(schema.families)
    .where(inArray(schema.families.slotId, slots.map((s) => s.id).concat(["00000000-0000-0000-0000-000000000000"])))
    .groupBy(schema.families.slotId);
  const today = istDate();
  const now = nowHHMM();
  return slots
    .filter((s) => slotPhase(s, today, now) !== "done")
    .map((s) => ({ id: s.id, batchNo: s.batchNo, start: s.startTime, end: s.endTime, booked: s.booked, capacity: s.capacity, percent: pct(s), families: counts.find((c) => c.slotId === s.id)?.families ?? 0, phase: slotPhase(s, today, now) }));
}

/** For each other ghat: where it is now and where it would be if these batches moved there. */
export async function targetOptions(fromGhatId: string, slotIds: string[]) {
  const db = await getDb();
  const moving = slotIds.length ? await db.select().from(schema.slots).where(inArray(schema.slots.id, slotIds)) : [];
  if (moving.some((s) => s.ghatId !== fromGhatId)) throw badRequest("All batches must be at the same ghat.");
  const people = moving.reduce((a, s) => a + s.booked, 0);
  const day = moving[0]?.day ?? istDate();
  const ghats = await db.select().from(schema.ghats).orderBy(asc(schema.ghats.sortOrder));
  const daySlots = await db.select().from(schema.slots).where(eq(schema.slots.day, day));
  const from = ghats.find((g) => g.id === fromGhatId);
  if (!from) throw notFound();
  const fromSlots = daySlots.filter((s) => s.ghatId === fromGhatId && moving.some((m) => m.startTime === s.startTime));
  const fromBefore = fromSlots.length ? Math.round(fromSlots.reduce((a, s) => a + pct(s), 0) / fromSlots.length) : 0;
  const options = ghats
    .filter((g) => g.id !== fromGhatId)
    .map((g) => {
      const targets = moving.map((m) => daySlots.find((s) => s.ghatId === g.id && s.startTime === m.startTime));
      if (targets.some((t) => !t)) return null;
      const before = Math.round(targets.reduce((a, t) => a + pct(t!), 0) / targets.length);
      const after = Math.round(targets.reduce((a, t, i) => a + Math.round(((t!.booked + moving[i].booked) / t!.capacity) * 100), 0) / targets.length);
      const fits = targets.every((t, i) => t!.booked + moving[i].booked <= t!.capacity);
      return { ghatId: g.id, name: g.name, gate: g.gate, walkNote: g.walkNote, before, after, fits, avoid: after > AVOID_PCT || !fits };
    })
    .filter(Boolean) as { ghatId: string; name: string; gate: string; walkNote: string; before: number; after: number; fits: boolean; avoid: boolean }[];
  options.sort((a, b) => Number(a.avoid) - Number(b.avoid) || a.after - b.after);
  const best = options.find((o) => !o.avoid)?.ghatId ?? null;
  const fromAfter = fromSlots.length
    ? Math.round(fromSlots.reduce((a, s) => a + Math.round(((s.booked - (moving.find((m) => m.id === s.id)?.booked ?? 0)) / s.capacity) * 100), 0) / fromSlots.length)
    : 0;
  const familiesRows = slotIds.length
    ? await db.select({ n: sql<number>`count(*)::int` }).from(schema.families).where(inArray(schema.families.slotId, slotIds))
    : [{ n: 0 }];
  return { from: { ghatId: from.id, name: from.name, before: fromBefore, after: fromAfter }, people, families: familiesRows[0].n, options, best };
}

async function nextCode(prefix: string, table: typeof schema.diversions) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return `${prefix}-${String(n + 1).padStart(4, "0")}-${randomCode(2)}`;
}

export async function createDiversion(input: { fromGhatId: string; slotIds: string[]; toGhatId: string; reason: string }, user: { id: string; role: Role }) {
  if (!input.slotIds.length) throw badRequest("Pick at least one batch.");
  const plan = await targetOptions(input.fromGhatId, input.slotIds);
  const opt = plan.options.find((o) => o.ghatId === input.toGhatId);
  if (!opt) throw badRequest("That ghat has no matching batch times.");
  if (!opt.fits) throw conflict(`${opt.name} doesn't have room for everyone at those times.`);
  const db = await getDb();
  const slots = await db.select().from(schema.slots).where(inArray(schema.slots.id, input.slotIds));
  const today = istDate();
  if (slots.some((s) => slotPhase(s, today) !== "later")) throw conflict("A batch has already started bathing, so it can't be diverted.");
  const code = await nextCode("D", schema.diversions);
  const [d] = await db
    .insert(schema.diversions)
    .values({
      code,
      fromGhatId: input.fromGhatId,
      toGhatId: input.toGhatId,
      day: slots[0].day,
      reason: input.reason,
      familiesCount: plan.families,
      peopleCount: plan.people,
      projection: { fromBefore: plan.from.before, fromAfter: plan.from.after, toBefore: opt.before, toAfter: opt.after, slotIds: input.slotIds, batches: slots.map((s) => s.batchNo).sort((a, b) => a - b) },
      createdBy: user.id,
    })
    .returning();
  await db.insert(schema.diversionEvents).values({ diversionId: d.id, kind: "created", message: `Plan made: batches ${slots.map((s) => s.batchNo).join(", ")} to ${opt.name}. Waiting for a second check.`, actorId: user.id });
  await audit({ actorType: "admin", actorId: user.id, action: "diversion.create", entityType: "diversion", entityId: d.id, details: { families: plan.families, to: input.toGhatId } });
  return diversionDetail(d.id);
}

/** Second check: a DIFFERENT staff member, with permission to divert, confirms with their own password (and code, if they use two-step sign-in). */
export async function approveDiversion(id: string, approver: { email: string; password: string; code?: string }, sessionUserId: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.diversions).where(eq(schema.diversions.id, id));
  if (!d) throw notFound();
  if (d.status !== "awaiting_approval") throw conflict("This diversion is not waiting for approval.");
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.email, approver.email.toLowerCase().trim()));
  const ok = u && u.active && (await bcrypt.compare(approver.password, u.passwordHash));
  if (!ok) throw new HttpError(401, "invalid_login", "That staff email or password is not right.");
  if (u.id === d.createdBy) throw forbidden("A second check must be done by a different person.");
  if (!can(u.role, "diversions.approve")) throw forbidden(`${u.name}'s role can't approve diversions.`);
  if (u.mfaEnabled) await verifyTotpForUser(u.id, approver.code ?? "");
  await db.update(schema.diversions).set({ approvedBy: u.id, approvedAt: new Date() }).where(eq(schema.diversions.id, id));
  await db.insert(schema.diversionEvents).values({ diversionId: id, kind: "approved", message: `Second check by ${u.name}`, actorId: u.id });
  await audit({ actorType: "admin", actorId: u.id, action: "diversion.approve", entityType: "diversion", entityId: id, details: { onConsoleOf: sessionUserId } });
  return sendDiversion(id, u.id);
}

async function sendDiversion(id: string, actorId: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.diversions).where(eq(schema.diversions.id, id));
  const slotIds = (d.projection as { slotIds: string[] }).slotIds;
  const [toGhat] = await db.select().from(schema.ghats).where(eq(schema.ghats.id, d.toGhatId));
  const [fromGhat] = await db.select().from(schema.ghats).where(eq(schema.ghats.id, d.fromGhatId));
  const moved = await db.transaction(async (tx) => {
    const fromSlots = await tx.select().from(schema.slots).where(inArray(schema.slots.id, slotIds));
    if (fromSlots.some((s) => slotPhase(s) !== "later")) throw conflict("A batch has started bathing since this was planned. Make a new plan.");
    const toSlots = await tx.select().from(schema.slots).where(and(eq(schema.slots.ghatId, d.toGhatId), eq(schema.slots.day, d.day)));
    const fams = await tx
      .select({ id: schema.families.id, slotId: schema.families.slotId, people: sql<number>`(select count(*)::int from members m where m.family_id = ${schema.families.id})` })
      .from(schema.families)
      .where(inArray(schema.families.slotId, slotIds));
    const out: { familyId: string; from: string; to: string; people: number }[] = [];
    for (const s of fromSlots) {
      const target = toSlots.find((t) => t.startTime === s.startTime);
      if (!target) throw conflict(`${toGhat.name} has no batch at ${s.startTime}.`);
      const group = fams.filter((f) => f.slotId === s.id);
      const people = group.reduce((a, f) => a + f.people, 0) || s.booked;
      const upd = await tx
        .update(schema.slots)
        .set({ booked: sql`${schema.slots.booked} + ${people}` })
        .where(and(eq(schema.slots.id, target.id), sql`${schema.slots.booked} + ${people} <= ${schema.slots.capacity}`))
        .returning({ id: schema.slots.id });
      if (!upd.length) throw conflict(`${toGhat.name} filled up at ${s.startTime}. Make a new plan.`);
      await tx.update(schema.slots).set({ booked: sql`greatest(${schema.slots.booked} - ${people}, 0)` }).where(eq(schema.slots.id, s.id));
      for (const f of group) {
        await tx.update(schema.families).set({ slotId: target.id, meetingPoint: toGhat.meetingPoint }).where(eq(schema.families.id, f.id));
        out.push({ familyId: f.id, from: s.id, to: target.id, people: f.people });
      }
    }
    if (out.length) {
      for (let i = 0; i < out.length; i += 500) {
        await tx.insert(schema.diversionMoves).values(out.slice(i, i + 500).map((m) => ({ diversionId: id, familyId: m.familyId, fromSlotId: m.from, toSlotId: m.to, people: m.people })));
      }
    }
    await tx.update(schema.diversions).set({ status: "sent", sentAt: new Date(), familiesCount: out.length || d.familiesCount }).where(eq(schema.diversions.id, id));
    return out;
  });

  const batches = (d.projection as { batches: number[] }).batches;
  await db.insert(schema.diversionEvents).values({ diversionId: id, kind: "sent", message: `Diversion sent: ${moved.length} families moved from ${fromGhat.name} to ${toGhat.name}`, actorId });

  // Tell the families. SMS only goes out if an SMS provider is connected; otherwise we record that honestly.
  let sms = 0;
  let notConnected = 0;
  for (const m of moved) {
    const [f] = await db.select({ phoneEnc: schema.families.phoneEnc, passCode: schema.families.passCode }).from(schema.families).where(eq(schema.families.id, m.familyId));
    const r = await sendTextSms(decrypt(f.phoneEnc), "diversion", { ghat: toGhat.name, gate: toGhat.gate, pass: f.passCode });
    const status = r.sent ? "sent" : r.reason === "not_configured" ? "not_connected" : "failed";
    if (r.sent) sms++;
    else if (r.reason === "not_configured") notConnected++;
    await db.update(schema.diversionMoves).set({ smsStatus: status }).where(and(eq(schema.diversionMoves.diversionId, id), eq(schema.diversionMoves.familyId, m.familyId)));
  }
  await db.insert(schema.diversionEvents).values({
    diversionId: id,
    kind: "notified",
    message: sms ? `${sms} families messaged by SMS` : `SMS not connected — ${notConnected} families will see the change at kiosks and on their pass page`,
    actorId,
  });
  // Kiosks and staff screens show it straight away.
  await db.insert(schema.alerts).values({
    severity: "warning",
    title: `Batches ${batches.join(", ")} now go to ${toGhat.name}`,
    message: `Families booked at ${fromGhat.name} for batches ${batches.join(", ")} now bathe at ${toGhat.name}, ${toGhat.gate}. Same time. Ask a volunteer if unsure.`,
    ghatId: d.toGhatId,
    audience: "both",
    createdBy: actorId,
  });
  await audit({ actorType: "admin", actorId, action: "diversion.send", entityType: "diversion", entityId: id, details: { families: moved.length, sms, notConnected } });
  return diversionDetail(id);
}

export async function rejectDiversion(id: string, userId: string) {
  const db = await getDb();
  const [d] = await db.update(schema.diversions).set({ status: "rejected" }).where(and(eq(schema.diversions.id, id), eq(schema.diversions.status, "awaiting_approval"))).returning();
  if (!d) throw conflict("Only a plan waiting for approval can be cancelled.");
  await db.insert(schema.diversionEvents).values({ diversionId: id, kind: "rejected", message: "Plan cancelled", actorId: userId });
  await audit({ actorType: "admin", actorId: userId, action: "diversion.reject", entityType: "diversion", entityId: id });
  return diversionDetail(id);
}

export async function undoDiversion(id: string, userId: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.diversions).where(eq(schema.diversions.id, id));
  if (!d) throw notFound();
  if (d.status !== "sent") throw conflict("Only a sent diversion can be undone.");
  const moves = await db.select().from(schema.diversionMoves).where(eq(schema.diversionMoves.diversionId, id));
  const [fromGhat] = await db.select().from(schema.ghats).where(eq(schema.ghats.id, d.fromGhatId));
  await db.transaction(async (tx) => {
    const fromSlots = await tx.select().from(schema.slots).where(inArray(schema.slots.id, [...new Set(moves.map((m) => m.fromSlotId))].concat(["00000000-0000-0000-0000-000000000000"])));
    if (fromSlots.some((s) => slotPhase(s) !== "later")) throw conflict("The original batches have started, so this can't be undone. Make a new plan instead.");
    for (const m of moves) {
      await tx.update(schema.slots).set({ booked: sql`greatest(${schema.slots.booked} - ${m.people}, 0)` }).where(eq(schema.slots.id, m.toSlotId));
      await tx.update(schema.slots).set({ booked: sql`${schema.slots.booked} + ${m.people}` }).where(eq(schema.slots.id, m.fromSlotId));
      await tx.update(schema.families).set({ slotId: m.fromSlotId, meetingPoint: fromGhat.meetingPoint }).where(eq(schema.families.id, m.familyId));
    }
    await tx.update(schema.diversions).set({ status: "undone", undoneBy: userId, undoneAt: new Date() }).where(eq(schema.diversions.id, id));
  });
  await db.insert(schema.diversionEvents).values({ diversionId: id, kind: "undone", message: `Diversion undone: ${moves.length} families back to ${fromGhat.name}`, actorId: userId });
  await db.insert(schema.alerts).values({ severity: "info", title: `Back to ${fromGhat.name}`, message: `The earlier move is cancelled. Families go to ${fromGhat.name}, ${fromGhat.gate}, at their booked time.`, ghatId: d.fromGhatId, audience: "both", createdBy: userId });
  await audit({ actorType: "admin", actorId: userId, action: "diversion.undo", entityType: "diversion", entityId: id, details: { families: moves.length } });
  return diversionDetail(id);
}

/** A family saw the change (pass page or kiosk). */
export async function confirmDiversionForFamily(familyId: string) {
  const db = await getDb();
  await db
    .update(schema.diversionMoves)
    .set({ confirmedAt: new Date() })
    .where(and(eq(schema.diversionMoves.familyId, familyId), sql`${schema.diversionMoves.confirmedAt} is null`));
}

export async function listDiversions(limit = 30) {
  const db = await getDb();
  const rows = await db.select().from(schema.diversions).orderBy(desc(schema.diversions.createdAt)).limit(limit);
  const ghats = await db.select({ id: schema.ghats.id, name: schema.ghats.name }).from(schema.ghats);
  const name = (id: string) => ghats.find((g) => g.id === id)?.name ?? id;
  return rows.map((d) => ({ id: d.id, code: d.code, from: name(d.fromGhatId), to: name(d.toGhatId), status: d.status, families: d.familiesCount, people: d.peopleCount, createdAt: d.createdAt.toISOString(), batches: (d.projection as { batches?: number[] }).batches ?? [] }));
}

export async function diversionDetail(id: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.diversions).where(eq(schema.diversions.id, id));
  if (!d) throw notFound();
  const ghats = await db.select().from(schema.ghats);
  const users = await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name }).from(schema.adminUsers);
  const uname = (x: string | null) => (x ? users.find((u) => u.id === x)?.name ?? "Staff" : null);
  const events = await db.select().from(schema.diversionEvents).where(eq(schema.diversionEvents.diversionId, id)).orderBy(asc(schema.diversionEvents.at));
  const [stats] = await db
    .select({
      families: sql<number>`count(*)::int`,
      confirmed: sql<number>`count(${schema.diversionMoves.confirmedAt})::int`,
      smsSent: sql<number>`count(*) filter (where ${schema.diversionMoves.smsStatus} = 'sent')::int`,
      smsNotConnected: sql<number>`count(*) filter (where ${schema.diversionMoves.smsStatus} = 'not_connected')::int`,
      people: sql<number>`coalesce(sum(${schema.diversionMoves.people}),0)::int`,
    })
    .from(schema.diversionMoves)
    .where(eq(schema.diversionMoves.diversionId, id));
  const g = (gid: string) => {
    const x = ghats.find((y) => y.id === gid)!;
    return { id: x.id, name: x.name, gate: x.gate, percent: Math.round((x.occupancy / x.capacity) * 100), source: x.occupancySource, safeLimitPct: x.safeLimitPct };
  };
  return {
    id: d.id,
    code: d.code,
    status: d.status,
    day: d.day,
    reason: d.reason,
    from: g(d.fromGhatId),
    to: g(d.toGhatId),
    familiesPlanned: d.familiesCount,
    peoplePlanned: d.peopleCount,
    projection: d.projection,
    createdBy: uname(d.createdBy),
    createdById: d.createdBy,
    approvedBy: uname(d.approvedBy),
    approvedAt: d.approvedAt?.toISOString() ?? null,
    sentAt: d.sentAt?.toISOString() ?? null,
    undoneAt: d.undoneAt?.toISOString() ?? null,
    stats,
    events: events.map((e) => ({ at: e.at.toISOString(), kind: e.kind, message: e.message, by: uname(e.actorId) })),
  };
}

export async function upcomingSlotsToday() {
  const db = await getDb();
  return db.select().from(schema.slots).where(and(eq(schema.slots.day, istDate()), gte(schema.slots.startTime, nowHHMM())));
}

export type { SlotRow };
