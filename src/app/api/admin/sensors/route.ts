import { simulateTick } from "@/server/services/crowd";
import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { SENSOR_KINDS, createSensor, listSensors } from "@/server/services/sensors";
import { getDb, schema } from "@/server/db";

export const GET = handler(async () => {
  await requireUser("sensors.view");
  await simulateTick(); // keep the training simulator's sensors current even when nobody has the map open
  const db = await getDb();
  const gates = await db.select({ id: schema.gates.id, ghatId: schema.gates.ghatId, name: schema.gates.name }).from(schema.gates);
  return json({ sensors: await listSensors(), gates });
});

/** Register a device. The key is shown ONCE in the response. */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("sensors.manage");
  const input = await parseBody(req, z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(SENSOR_KINDS), ghatId: z.string().max(40), gateId: z.string().max(40).nullable().optional() }));
  return json(await createSensor(input, user.id), 201);
});
