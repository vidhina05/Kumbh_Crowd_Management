import { and, asc, eq, ne } from "drizzle-orm";
import { handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { recentShifts } from "@/server/services/shifts";

/** Recent shifts and the colleagues a shift can be handed over to (names and roles only). */
export const GET = handler(async () => {
  const user = await requireUser("shifts.use");
  const db = await getDb();
  const staff = await db
    .select({ id: schema.adminUsers.id, name: schema.adminUsers.name, role: schema.adminUsers.role })
    .from(schema.adminUsers)
    .where(and(eq(schema.adminUsers.active, true), ne(schema.adminUsers.id, user.id)))
    .orderBy(asc(schema.adminUsers.name));
  return json({ shifts: await recentShifts(), staff });
});
