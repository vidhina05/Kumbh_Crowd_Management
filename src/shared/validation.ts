import { z } from "zod";
import { LANG_CODES } from "./languages";

/** Input schemas shared by API routes (server) and forms (client). */

const name = z.string().trim().min(1, "Enter a name").max(80);
// Unicode letters, marks (Indic vowel signs), spaces and a few punctuation marks.
const personName = name.regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, "Use letters only");

export const NEEDS = ["wheelchair", "elderly", "child", "medical", "hearing", "vision"] as const;
export const RELATIONS = ["self", "spouse", "parent", "child", "sibling", "grandparent", "grandchild", "relative", "friend", "other"] as const;

// A small JPEG from the kiosk camera, as a data URL. Max ~300 KB.
export const photoDataUrl = z
  .string()
  .max(420_000, "Photo is too large")
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, "Photo must be a JPEG");

export const memberInput = z.object({
  name: personName,
  age: z.number().int().min(0).max(120),
  relation: z.enum(RELATIONS),
  needs: z.array(z.enum(NEEDS)).max(6).default([]),
  photo: photoDataUrl.optional(),
  // Opt-in face template (1024 float32, base64) computed on the kiosk. Needs consent.face.
  face: z.string().min(100).max(8000).optional(),
  gender: z.enum(["M", "F", "T"]).optional(),
});

export const registrationInput = z.object({
  language: z.enum(LANG_CODES),
  consent: z.object({ version: z.literal("2026-01"), accepted: z.literal(true), photo: z.boolean(), face: z.boolean().default(false) }),
  homeTown: z.string().trim().max(80).default(""),
  slotId: z.string().uuid(),
  members: z.array(memberInput).min(1, "Add at least one person").max(12, "Up to 12 people per registration"),
});
export type RegistrationInput = z.infer<typeof registrationInput>;

export const HELP_TYPES = ["medical", "lost_person", "wheelchair", "language", "other"] as const;

export const helpInput = z.object({
  type: z.enum(HELP_TYPES),
  description: z.string().trim().max(500).default(""),
  passCode: z.string().trim().max(20).optional(),
  clientRequestId: z.string().uuid(),
});

export const lostInput = z.object({
  personName: personName,
  age: z.number().int().min(0).max(120).optional(),
  description: z.string().trim().min(3, "Describe their clothes or how to recognise them").max(500),
  lastSeen: z.string().trim().min(2, "Say where you last saw them").max(200),
  reporterName: personName,
  reporterPhone: z.string().trim().max(16).optional(),
  clientRequestId: z.string().uuid(),
});

export const phoneInput = z.object({ phone: z.string().trim().min(10).max(16) });
export const otpVerifyInput = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{4}$/, "Enter the 4-digit code") });
