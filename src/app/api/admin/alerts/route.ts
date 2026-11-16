import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createAlert, listAlerts } from "@/server/services/admin";

export const GET = handler(async (req: Request) => {
  await requireUser("alerts.view");
  const { status } = parseQuery(req.url, z.object({ status: z.enum(["active", "resolved"]).optional() }));
  return json({ alerts: await listAlerts(status) });
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("alerts.manage");
  const input = await parseBody(
    req,
    z.object({
      severity: z.enum(["info", "warning", "critical"]),
      title: z.string().trim().min(3).max(80),
      message: z.string().trim().min(3).max(400),
      ghatId: z.string().max(40).nullable().optional(),
      audience: z.enum(["staff", "kiosk", "both"]),
      translations: z.record(z.string().regex(/^[a-z]{2,3}$/), z.object({ title: z.string().trim().max(80), message: z.string().trim().max(400) })).optional(),
      startsAt: z.string().datetime().nullable().optional(),
      ghatIds: z.array(z.string().max(40)).max(20).optional(),
    }),
  );
  return json(await createAlert(user, input), 201);
});
