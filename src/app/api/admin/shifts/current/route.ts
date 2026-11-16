import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { currentShift, handoverForMe, startShift } from "@/server/services/shifts";

export const GET = handler(async () => {
  const user = await requireUser("shifts.use");
  const s = await currentShift(user.id);
  return json({ shift: s ? { id: s.id, startedAt: s.startedAt.toISOString(), controlRoom: s.controlRoom } : null, handover: await handoverForMe(user.id) });
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("shifts.use");
  const { controlRoom } = await parseBody(req, z.object({ controlRoom: z.string().trim().min(2).max(60).default("Sangam Control") }));
  const s = await startShift(user.id, controlRoom);
  return json({ shift: { id: s.id, startedAt: s.startedAt.toISOString(), controlRoom: s.controlRoom } });
});
