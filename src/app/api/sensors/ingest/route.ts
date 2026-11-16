import { handler, json, parseBody } from "@/server/http";
import { assertSensorHeaders, ingest, ingestInput } from "@/server/services/sensors";

/**
 * Crowd sensor ingest. Each device authenticates with its own key:
 *   POST /api/sensors/ingest
 *   X-Sensor-Id: S-0001
 *   Authorization: Bearer sk_…
 *   { "peopleIn": 42, "peopleOut": 37 }        (gate counter, per minute)
 *   { "occupancy": 31840 }                      (zone counter / camera counter)
 */
export const POST = handler(async (req: Request) => {
  const { id, key } = assertSensorHeaders(req);
  const body = await parseBody(req, ingestInput);
  return json(await ingest(id, key, body), 202);
});
