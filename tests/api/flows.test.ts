import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

// Admin route handlers read the session cookie through next/headers; tests set it here.
let cookieToken: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "sc_session" && cookieToken ? { value: cookieToken } : undefined) }) }));

import { getDb, schema } from "@/server/db";
import { ensureKiosk, ensureSuperAdmin, seedReferenceData } from "@/server/seed";
import { createUser } from "@/server/services/admin";
import { login, type AdminUser } from "@/server/auth";
import { istDate } from "@/shared/time";
import { resetRateLimitsForTests } from "@/server/ratelimit";

import * as kioskConfig from "@/app/api/kiosk/config/route";
import * as otpStart from "@/app/api/kiosk/otp/start/route";
import * as otpVerify from "@/app/api/kiosk/otp/verify/route";
import * as registrations from "@/app/api/kiosk/registrations/route";
import * as me from "@/app/api/kiosk/registrations/me/route";
import * as changeSlot from "@/app/api/kiosk/registrations/change-slot/route";
import * as help from "@/app/api/kiosk/help/route";
import * as lost from "@/app/api/kiosk/lost/route";
import * as tts from "@/app/api/voice/tts/route";
import * as adminKiosks from "@/app/api/admin/kiosks/route";
import * as adminHelp from "@/app/api/admin/help/route";
import * as adminHelpOne from "@/app/api/admin/help/[id]/route";
import * as adminLost from "@/app/api/admin/lost/route";
import * as adminUsers from "@/app/api/admin/users/route";
import * as adminAssistant from "@/app/api/admin/assistant/route";
import * as adminAlerts from "@/app/api/admin/alerts/route";
import * as cron from "@/app/api/cron/retention/route";

const BASE = "http://localhost:3000";
// Minimal byte sequence with JPEG start/end markers (enough for the server's format check).
const FAKE_JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]).toString("base64")}`;
let kioskToken = "";
const kioskHeaders = (extra: Record<string, string> = {}) => ({ "Content-Type": "application/json", "X-Kiosk-Id": "K-17", "X-Kiosk-Token": kioskToken, ...extra });
const kreq = (path: string, body?: unknown, extra: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: kioskHeaders(extra), body: body === undefined ? undefined : JSON.stringify(body) });
const areq = (path: string, method = "GET", body?: unknown, origin = BASE) =>
  new Request(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, Host: "localhost:3000" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function firstSlot(day = istDate()) {
  const db = await getDb();
  const [s] = await db.select().from(schema.slots).where(eq(schema.slots.day, day)).orderBy(sql`start_time desc`).limit(1);
  return s;
}

async function verifiedPilgrim(phone: string) {
  const start = await (await otpStart.POST(kreq("/api/kiosk/otp/start", { phone }))).json();
  expect(start.devCode).toMatch(/^\d{4}$/);
  const v = await (await otpVerify.POST(kreq("/api/kiosk/otp/verify", { challengeId: start.challengeId, code: start.devCode }))).json();
  return v.pilgrimToken as string;
}

let admin: AdminUser;
let adminToken: string;

beforeAll(async () => {
  await seedReferenceData(2);
  kioskToken = (await ensureKiosk("K-17", "Registration kiosk", "Sector 4 plaza"))!;
  await ensureSuperAdmin("root@example.org", "Root", "SuperSecret123");
  const r = await login("root@example.org", "SuperSecret123");
  if (r.mfaRequired) throw new Error("test admin should not need two-step sign-in");
  admin = r.user;
  adminToken = r.token;
});

describe("kiosk device authentication", () => {
  it("refuses requests without a valid device token", async () => {
    const none = await kioskConfig.GET(new Request(`${BASE}/api/kiosk/config`));
    expect(none.status).toBe(401);
    const wrong = await kioskConfig.GET(new Request(`${BASE}/api/kiosk/config`, { headers: { "X-Kiosk-Id": "K-17", "X-Kiosk-Token": "nope" } }));
    expect(wrong.status).toBe(401);
    const ok = await kioskConfig.GET(kreq("/api/kiosk/config"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.kiosk.id).toBe("K-17");
    expect(body.integrations).toEqual({ sms: false, otpDevMode: true, voice: false, assistant: false });
    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });
  it("a kiosk token cannot reach admin endpoints", async () => {
    cookieToken = undefined;
    const res = await adminHelp.GET(new Request(`${BASE}/api/admin/help`, { headers: kioskHeaders() }));
    expect(res.status).toBe(401);
  });
});

describe("registration journey", () => {
  it("phone OTP → family → slot → pass, with bands, encryption and seat booking", async () => {
    const token = await verifiedPilgrim("9876543210");
    const slot = await firstSlot();
    const before = slot.booked;
    const res = await registrations.POST(
      kreq("/api/kiosk/registrations", {
        language: "hi",
        consent: { version: "2026-01", accepted: true, photo: true },
        homeTown: "Varanasi",
        slotId: slot.id,
        members: [
          { name: "Ramesh Sharma", age: 54, relation: "self" },
          { name: "Asha Sharma", age: 51, relation: "spouse" },
          { name: "Ganga Devi", age: 78, relation: "parent", needs: ["wheelchair"] },
          { name: "Neel Sharma", age: 7, relation: "child", photo: FAKE_JPEG },
          { name: "Pooja Sharma", age: 26, relation: "child" },
        ],
      }, { "X-Pilgrim-Token": token }),
    );
    expect(res.status).toBe(201);
    const pass = await res.json();
    expect(pass.passCode).toMatch(/^KMB-\d+-[A-Z2-9]{4}$/);
    expect(pass.members.filter((m: { hasBand: boolean }) => m.hasBand).map((m: { name: string }) => m.name)).toEqual(["Ramesh Sharma", "Ganga Devi", "Neel Sharma"]);
    expect(pass.phoneLast4).toBe("3210");

    const db = await getDb();
    const [s] = await db.select().from(schema.slots).where(eq(schema.slots.id, slot.id));
    expect(s.booked).toBe(before + 5);
    const [f] = await db.select().from(schema.families).where(eq(schema.families.passCode, pass.passCode));
    expect(f.phoneEnc).not.toContain("9876543210");
    expect(f.phoneHash).not.toContain("9876543210");
    const ms = await db.select().from(schema.members).where(eq(schema.members.familyId, f.id));
    expect(ms.find((m) => m.name === "Neel Sharma")?.photoEnc).toMatch(/^v1\./);
  });

  it("rejects a 'photo' that isn't really a JPEG", async () => {
    const token = await verifiedPilgrim("9555555555");
    const slot = await firstSlot();
    const fake = `data:image/jpeg;base64,${Buffer.from("<svg onload=alert(1)>".repeat(10)).toString("base64")}`;
    const res = await registrations.POST(kreq("/api/kiosk/registrations", { language: "en", consent: { version: "2026-01", accepted: true, photo: true }, slotId: slot.id, members: [{ name: "Ann", age: 30, relation: "self" }, { name: "Kid", age: 5, relation: "child", photo: fake }] }, { "X-Pilgrim-Token": token }));
    expect(res.status).toBe(400);
  });

  it("refuses a registration without a verified phone session", async () => {
    const slot = await firstSlot();
    const res = await registrations.POST(kreq("/api/kiosk/registrations", { language: "en", consent: { version: "2026-01", accepted: true, photo: false }, slotId: slot.id, members: [{ name: "X", age: 30, relation: "self" }] }));
    expect(res.status).toBe(401);
  });

  it("one registration per phone; 'Find me' returns it; one slot change allowed", async () => {
    const token = await verifiedPilgrim("9876543210");
    const slot = await firstSlot();
    const dup = await registrations.POST(kreq("/api/kiosk/registrations", { language: "hi", consent: { version: "2026-01", accepted: true, photo: false }, slotId: slot.id, members: [{ name: "Ramesh", age: 54, relation: "self" }] }, { "X-Pilgrim-Token": token }));
    expect(dup.status).toBe(409);

    const found = await (await me.GET(kreq("/api/kiosk/registrations/me", undefined, { "X-Pilgrim-Token": token }))).json();
    expect(found.leaderName).toBe("Ramesh Sharma");
    expect(JSON.stringify(found)).not.toContain("photo");

    const db = await getDb();
    const [other] = await db.select().from(schema.slots).where(sql`day = ${istDate()} and id <> ${found.slot.id}`).orderBy(sql`start_time desc`).limit(1);
    const changed = await (await changeSlot.POST(kreq("/api/kiosk/registrations/change-slot", { slotId: other.id }, { "X-Pilgrim-Token": token }))).json();
    expect(changed.replaces).toBe(found.passCode);
    expect(changed.passCode).not.toBe(found.passCode);
    expect(changed.slotChangesLeft).toBe(0);
    const again = await changeSlot.POST(kreq("/api/kiosk/registrations/change-slot", { slotId: found.slot.id }, { "X-Pilgrim-Token": token }));
    expect(again.status).toBe(409);
  });

  it("never overbooks a slot", async () => {
    const db = await getDb();
    const slot = await firstSlot(istDate());
    await db.update(schema.slots).set({ booked: slot.capacity - 1 }).where(eq(schema.slots.id, slot.id));
    const token = await verifiedPilgrim("9123456780");
    const res = await registrations.POST(kreq("/api/kiosk/registrations", { language: "en", consent: { version: "2026-01", accepted: true, photo: false }, slotId: slot.id, members: [{ name: "Ann", age: 40, relation: "self" }, { name: "Bob", age: 41, relation: "spouse" }] }, { "X-Pilgrim-Token": token }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("slot_full");
  });

  it("wrong OTP codes are counted and locked out", async () => {
    const start = await (await otpStart.POST(kreq("/api/kiosk/otp/start", { phone: "9000000001" }))).json();
    const wrong = start.devCode === "0000" ? "1111" : "0000";
    for (let i = 0; i < 5; i++) await otpVerify.POST(kreq("/api/kiosk/otp/verify", { challengeId: start.challengeId, code: wrong }));
    const res = await otpVerify.POST(kreq("/api/kiosk/otp/verify", { challengeId: start.challengeId, code: start.devCode }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("otp_locked");
  });
});

describe("help and lost-person requests", () => {
  it("help requests are idempotent (safe to retry after a network drop)", async () => {
    const id = crypto.randomUUID();
    const a = await (await help.POST(kreq("/api/kiosk/help", { type: "medical", description: "Dizzy", clientRequestId: id }))).json();
    const b = await (await help.POST(kreq("/api/kiosk/help", { type: "medical", description: "Dizzy", clientRequestId: id }))).json();
    expect(a.code).toBe(b.code);
    expect(b.duplicate).toBe(true);
  });

  it("missing-person report links to the reporter's family and hides the reporter's phone", async () => {
    const token = await verifiedPilgrim("9876543210");
    const res = await lost.POST(kreq("/api/kiosk/lost", { personName: "Neel Sharma", age: 7, description: "Red shirt, blue shorts", lastSeen: "Near Gate 4", reporterName: "Ramesh", reporterPhone: "9876543210", clientRequestId: crypto.randomUUID() }, { "X-Pilgrim-Token": token }));
    expect(res.status).toBe(201);
    expect((await res.json()).linkedToFamily).toBe(true);
    cookieToken = adminToken;
    const list = await (await adminLost.GET(areq("/api/admin/lost?status=active"))).json();
    const c = list.cases.find((x: { personName: string }) => x.personName === "Neel Sharma");
    expect(c.hasPhoto).toBe(true);
    expect(c.reporterPhoneLast4).toBe("3210");
    expect(JSON.stringify(list)).not.toContain("reporterPhoneEnc");
  });
});

describe("admin access control", () => {
  it("a help-desk user can work help requests but cannot create kiosks or staff", async () => {
    await createUser(admin, { email: "desk@example.org", name: "Desk", role: "help_desk", password: "HelpDeskPass123" });
    const lr = await login("desk@example.org", "HelpDeskPass123");
    if (lr.mfaRequired) throw new Error("unexpected two-step sign-in");
    cookieToken = lr.token;
    expect((await adminKiosks.POST(areq("/api/admin/kiosks", "POST", { id: "K-99", name: "x", location: "y" }))).status).toBe(403);
    expect((await adminUsers.GET()).status).toBe(403);
    expect((await adminAlerts.POST(areq("/api/admin/alerts", "POST", { severity: "info", title: "Hello", message: "World", audience: "staff" }))).status).toBe(403);
    const list = await (await adminHelp.GET(areq("/api/admin/help?status=active"))).json();
    const target = list.requests[0];
    const upd = await adminHelpOne.PATCH(areq(`/api/admin/help/${target.id}`, "PATCH", { status: "in_progress" }), ctx(target.id));
    expect(upd.status).toBe(200);
    const bad = await adminHelpOne.PATCH(areq(`/api/admin/help/${target.id}`, "PATCH", { status: "assigned" }), ctx("not-a-uuid"));
    expect(bad.status).toBe(400);
  });

  it("blocks cross-site (CSRF) mutations even with a valid session", async () => {
    cookieToken = adminToken;
    const res = await adminAlerts.POST(areq("/api/admin/alerts", "POST", { severity: "info", title: "Hello", message: "World", audience: "staff" }, "https://evil.example"));
    expect(res.status).toBe(403);
  });

  it("locks an account after 5 wrong passwords", async () => {
    resetRateLimitsForTests();
    for (let i = 0; i < 5; i++) await expect(login("desk@example.org", "wrong-password-0")).rejects.toThrow();
    await expect(login("desk@example.org", "HelpDeskPass123")).rejects.toMatchObject({ code: "locked" });
  });

  it("lists staff without password hashes and kiosks without token hashes", async () => {
    cookieToken = adminToken;
    expect(JSON.stringify(await (await adminUsers.GET()).json())).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(JSON.stringify(await (await adminKiosks.GET()).json())).not.toContain("tokenHash");
  });
});

describe("integrations without keys", () => {
  it("voice and the assistant say they are not connected instead of faking an answer", async () => {
    const v = await tts.POST(kreq("/api/voice/tts", { text: "नमस्ते", lang: "hi" }));
    expect(v.status).toBe(503);
    expect((await v.json()).error.code).toBe("voice_not_configured");
    cookieToken = adminToken;
    const a = await adminAssistant.POST(areq("/api/admin/assistant", "POST", { question: "Which ghat has room?" }));
    expect(a.status).toBe(503);
    expect((await a.json()).error.code).toBe("assistant_not_configured");
  });
});

describe("data retention", () => {
  it("cron needs the secret, then deletes expired families with their members and photos", async () => {
    expect((await cron.GET(new Request(`${BASE}/api/cron/retention`))).status).toBe(401);
    const db = await getDb();
    await db.update(schema.families).set({ deleteAfter: new Date(Date.now() - 1000) });
    const res = await cron.GET(new Request(`${BASE}/api/cron/retention`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(res.status).toBe(200);
    expect((await res.json()).familiesDeleted).toBeGreaterThan(0);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.members);
    expect(n).toBe(0);
  });
});
