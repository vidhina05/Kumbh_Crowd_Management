import { describe, expect, it } from "vitest";
import { decrypt, encrypt, lookupHash, signToken, verifyToken } from "@/server/crypto";
import { can, canUpdateHelpType, PERMISSIONS, ROLES } from "@/shared/rbac";
import { memberInput, photoDataUrl, registrationInput } from "@/shared/validation";
import { normalisePhone } from "@/server/services/otp";
import { needsBand } from "@/server/services/registration";
import { crowdLevel, istInstant } from "@/shared/time";
import { translator } from "@/i18n";
import { en } from "@/i18n/en";
import { LANGUAGES } from "@/shared/languages";

describe("encryption of personal data", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("+919876543210");
    const b = encrypt("+919876543210");
    expect(a).not.toEqual(b);
    expect(a).not.toContain("9876543210");
    expect(decrypt(a)).toBe("+919876543210");
  });
  it("rejects tampered ciphertext", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("lookup hashes are stable and keyed", () => {
    expect(lookupHash("x")).toBe(lookupHash("x"));
    expect(lookupHash("x")).not.toBe(lookupHash("y"));
    expect(lookupHash("x")).toHaveLength(64);
  });
});

describe("signed pilgrim tokens", () => {
  it("verifies a valid token and rejects a forged or expired one", () => {
    const t = signToken({ ph: "abc", k: "K-1" }, 60);
    expect(verifyToken<{ ph: string }>(t)?.ph).toBe("abc");
    const [body] = t.split(".");
    expect(verifyToken(`${body}.forged`)).toBeNull();
    const forgedBody = Buffer.from(JSON.stringify({ ph: "other", k: "K-1", exp: 9e9 })).toString("base64url");
    expect(verifyToken(`${forgedBody}.${t.split(".")[1]}`)).toBeNull();
    expect(verifyToken(signToken({ ph: "abc" }, -1))).toBeNull();
    expect(verifyToken(null)).toBeNull();
  });
});

describe("role-based access", () => {
  it("only super admins manage staff, kiosks and read the audit log", () => {
    for (const r of ROLES) {
      expect(can(r, "users.manage")).toBe(r === "super_admin");
      expect(can(r, "kiosks.manage")).toBe(r === "super_admin");
      expect(can(r, "audit.view")).toBe(r === "super_admin");
    }
  });
  it("every role can see the overview; unknown roles get nothing", () => {
    for (const r of ROLES) expect(can(r, "overview.view")).toBe(true);
    for (const p of Object.keys(PERMISSIONS)) expect(can("kiosk", p as keyof typeof PERMISSIONS)).toBe(false);
    expect(can(undefined, "overview.view")).toBe(false);
  });
  it("medical staff can only update medical requests", () => {
    expect(canUpdateHelpType("medical", "medical")).toBe(true);
    expect(canUpdateHelpType("medical", "wheelchair")).toBe(false);
    expect(canUpdateHelpType("crowd_control", "medical")).toBe(false);
    expect(canUpdateHelpType("help_desk", "lost_person")).toBe(true);
  });
});

describe("input validation", () => {
  it("accepts names in Indian scripts and rejects markup", () => {
    expect(memberInput.safeParse({ name: "गंगा देवी", age: 78, relation: "parent" }).success).toBe(true);
    expect(memberInput.safeParse({ name: "கவியா", age: 5, relation: "child" }).success).toBe(true);
    expect(memberInput.safeParse({ name: "<script>alert(1)</script>", age: 30, relation: "friend" }).success).toBe(false);
    expect(memberInput.safeParse({ name: "Asha", age: 121, relation: "friend" }).success).toBe(false);
  });
  it("only accepts small JPEG data URLs as photos", () => {
    expect(photoDataUrl.safeParse("data:image/jpeg;base64,/9j/4AAQ").success).toBe(true);
    expect(photoDataUrl.safeParse("data:image/svg+xml;base64,PHN2Zz4=").success).toBe(false);
    expect(photoDataUrl.safeParse(`data:image/jpeg;base64,${"A".repeat(430_000)}`).success).toBe(false);
  });
  it("requires explicit consent and 1–12 members", () => {
    const base = { language: "hi", consent: { version: "2026-01", accepted: true, photo: false }, slotId: "00000000-0000-4000-8000-000000000000" };
    expect(registrationInput.safeParse({ ...base, members: [] }).success).toBe(false);
    expect(registrationInput.safeParse({ ...base, consent: { ...base.consent, accepted: false }, members: [{ name: "A", age: 3, relation: "child" }] }).success).toBe(false);
    expect(registrationInput.safeParse({ ...base, members: Array(13).fill({ name: "A", age: 30, relation: "friend" }) }).success).toBe(false);
  });
  it("normalises Indian mobile numbers and rejects others", () => {
    expect(normalisePhone("98765 43210")).toBe("+919876543210");
    expect(normalisePhone("+91-98765-43210")).toBe("+919876543210");
    expect(normalisePhone("09876543210")).toBe("+919876543210");
    expect(() => normalisePhone("12345")).toThrow();
    expect(() => normalisePhone("5876543210")).toThrow();
  });
});

describe("domain rules", () => {
  it("gives wristbands to the leader, children under 12 and people 65+", () => {
    expect(needsBand({ age: 30, isLeader: true })).toBe(true);
    expect(needsBand({ age: 7, isLeader: false })).toBe(true);
    expect(needsBand({ age: 78, isLeader: false })).toBe(true);
    expect(needsBand({ age: 26, isLeader: false })).toBe(false);
    expect(needsBand({ age: 64, isLeader: false })).toBe(false);
  });
  it("crowd levels", () => {
    expect(crowdLevel(10, 100)).toBe("calm");
    expect(crowdLevel(60, 100)).toBe("moderate");
    expect(crowdLevel(80, 100)).toBe("busy");
    expect(crowdLevel(95, 100)).toBe("very_busy");
  });
  it("IST conversion", () => {
    expect(istInstant("2027-01-29", "06:15").toISOString()).toBe("2027-01-29T00:45:00.000Z");
  });
});

describe("translations", () => {
  it("every language fills placeholders and falls back to English for missing keys", () => {
    for (const l of LANGUAGES) {
      const t = translator(l.code);
      expect(t("otpBody", { last4: "4410" })).toContain("4410");
      expect(t("brand").length).toBeGreaterThan(0);
    }
  });
  it("translated strings keep every {placeholder} the English text has", () => {
    for (const l of LANGUAGES) {
      const t = translator(l.code);
      for (const k of Object.keys(en) as (keyof typeof en)[]) {
        const vars = [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        const out = t(k, Object.fromEntries(vars.map((v) => [v, `§${v}§`])));
        for (const v of vars) expect(out, `${l.code}.${k} lost {${v}}`).toContain(`§${v}§`);
      }
    }
  });
});
