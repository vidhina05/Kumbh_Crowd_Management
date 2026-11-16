import { eq } from "drizzle-orm";
import { handler, json, notFound } from "@/server/http";
import { requireUser } from "@/server/auth";
import { crowdSeries, ghatsLive } from "@/server/services/crowd";
import { getDb, schema } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

/** Ghat detail: live number, flows by gate, the last 2 hours, and the straight-line projection for the next hour. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("map.view");
  const id = (await ctx.params).id;
  const all = await ghatsLive();
  const g = all.find((x) => x.id === id);
  if (!g) throw notFound();
  const series = await crowdSeries([id], new Date(Date.now() - 2 * 3600_000), 5);
  const db = await getDb();
  const cameras = await db.select().from(schema.sensors).where(eq(schema.sensors.ghatId, id));
  const net = g.flow ? g.flow.inPerMin - g.flow.outPerMin : 0;
  const projection = Array.from({ length: 7 }, (_, i) => ({ at: new Date(Date.now() + i * 10 * 60_000).toISOString(), occupancy: Math.max(0, Math.round(g.occupancy + net * i * 10)) }));
  return json({
    ghat: g,
    history: series.map((s) => ({ at: s.at, occupancy: s.occupancy, source: s.source })),
    projection,
    sensors: cameras.map((s) => ({ id: s.id, name: s.name, kind: s.kind, simulated: s.isSimulated, lastSeenAt: s.lastSeenAt?.toISOString() ?? null, lastReading: s.lastReading })),
    alternatives: all.filter((x) => x.id !== id).sort((a, b) => a.percent - b.percent).slice(0, 3).map((x) => ({ id: x.id, name: x.name, percent: x.percent })),
  });
});
