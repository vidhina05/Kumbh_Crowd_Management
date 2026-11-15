import { handler, json } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { integrations } from "@/server/env";
import { kioskAlerts } from "@/server/services/admin";
import { ghatStatus } from "@/server/services/overview";
import { istDate } from "@/shared/time";

/** Everything a kiosk needs on its home screen: who it is, live alerts, crowd levels and which integrations are on. */
export const GET = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const [alerts, ghats] = await Promise.all([kioskAlerts(), ghatStatus()]);
  return json({
    kiosk: { id: kiosk.id, name: kiosk.name, location: kiosk.location },
    integrations: integrations(),
    today: istDate(),
    alerts,
    ghats: ghats.map((g) => ({ id: g.id, name: g.name, nameHi: g.nameHi, percent: g.percent, level: g.level, source: g.source, updatedMinutesAgo: g.updatedMinutesAgo })),
  });
});
