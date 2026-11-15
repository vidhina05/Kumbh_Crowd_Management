import { sql } from "drizzle-orm";
import { json } from "@/server/http";
import { getDb } from "@/server/db";

/** Liveness for uptime monitors. Reveals nothing about configuration. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return json({ ok: true, db: "up" });
  } catch {
    return json({ ok: false, db: "down" }, 503);
  }
}
