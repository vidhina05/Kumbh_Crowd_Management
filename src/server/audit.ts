import "server-only";
import { getDb, schema } from "./db";

/** Append-only activity log. Never put personal data (names, phones, photos) in `details`. */
export async function audit(entry: {
  actorType: "admin" | "kiosk" | "system";
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    details: entry.details ?? {},
  });
}
