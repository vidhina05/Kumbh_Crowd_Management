import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertSameOrigin, handler, json, notFound, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { audit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

/** Hold or reopen a gate. Holding tells kiosks and staff straight away. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("gates.manage");
  const id = (await ctx.params).id;
  const { status } = await parseBody(req, z.object({ status: z.enum(["open", "held", "closed"]) }));
  const db = await getDb();
  const [gate] = await db.select().from(schema.gates).where(eq(schema.gates.id, id));
  if (!gate) throw notFound();
  const [ghat] = await db.select().from(schema.ghats).where(eq(schema.ghats.id, gate.ghatId));
  await db.update(schema.gates).set({ status, statusChangedAt: new Date(), statusChangedBy: user.id }).where(eq(schema.gates.id, id));
  if (status !== "open") {
    await db.insert(schema.alerts).values({ severity: "warning", title: `${ghat.name} ${gate.name} is ${status === "held" ? "on hold" : "closed"}`, message: `Please wait or use another gate. Volunteers will guide you.`, ghatId: ghat.id, audience: "both", createdBy: user.id });
  } else {
    await db.update(schema.alerts).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: user.id }).where(eq(schema.alerts.title, `${ghat.name} ${gate.name} is on hold`));
  }
  await audit({ actorType: "admin", actorId: user.id, action: `gate.${status}`, entityType: "gate", entityId: id });
  return json({ ok: true, id, status });
});
