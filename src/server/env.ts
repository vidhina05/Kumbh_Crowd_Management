import "server-only";
import { z } from "zod";

/**
 * All configuration comes from environment variables. Secrets are never sent to the browser:
 * nothing here is prefixed NEXT_PUBLIC_, and this module is server-only.
 *
 * The app refuses to start with missing or weak required secrets, and the error names the
 * variable without printing its value.
 */
const base64Key32 = z
  .string()
  .refine((v) => {
    try {
      return Buffer.from(v, "base64").length === 32;
    } catch {
      return false;
    }
  }, "must be 32 random bytes, base64-encoded (run: openssl rand -base64 32)");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),

  DATA_ENCRYPTION_KEY: base64Key32,
  LOOKUP_HMAC_KEY: base64Key32,
  SESSION_SECRET: base64Key32,
  CRON_SECRET: z.string().min(24, "must be at least 24 characters"),

  OTP_DEV_MODE: z.enum(["true", "false"]).default("false"),
  SMS_PROVIDER: z.enum(["none", "msg91"]).default("none"),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  BHASHINI_USER_ID: z.string().optional(),
  BHASHINI_API_KEY: z.string().optional(),
  BHASHINI_PIPELINE_ID: z.string().default("64392f96daac500b55c543cd"),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  MSG91_FLOW_DIVERSION: z.string().optional(),
  MSG91_FLOW_PASS: z.string().optional(),
  MSG91_FLOW_THANKS: z.string().optional(),

  RETENTION_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(48),

  // Aadhaar Secure QR: UIDAI's public certificate (PEM, \n allowed) to verify card signatures.
  AADHAAR_UIDAI_CERT_PEM: z.string().optional(),
  // Staging/demo only: accept test cards signed by a local test key (always labelled "Test card").
  AADHAAR_ALLOW_TEST_CARDS: z.enum(["true", "false"]).default("false"),

  // Roles that must use two-step sign-in (comma separated), e.g. "super_admin,operations".
  MFA_REQUIRED_ROLES: z.string().default("super_admin"),

  // Built-in crowd simulator for training and demos. Its numbers are always labelled "Simulated".
  SENSOR_SIMULATOR: z.enum(["true", "false"]).default("false"),

  // Optional shared rate-limit store for multi-instance deployments (Upstash Redis REST API).
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Set only by the in-browser demo build (GitHub Pages). Refused on a real server.
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration. Fix these environment variables (see .env.example):\n${problems}`);
  }
  const e = parsed.data;
  const inBrowser = typeof window !== "undefined";
  if (e.DEMO_MODE === "true" && !inBrowser) {
    throw new Error("Invalid configuration: DEMO_MODE is only for the in-browser demo build.");
  }
  if (e.NODE_ENV === "production" && e.DEMO_MODE !== "true") {
    if (!e.DATABASE_URL || e.DATABASE_URL.startsWith("pglite")) {
      throw new Error("Invalid configuration: DATABASE_URL must point to a Postgres server in production.");
    }
    if (e.OTP_DEV_MODE === "true" && process.env.ALLOW_OTP_DEV_MODE_IN_PRODUCTION !== "yes-i-understand") {
      throw new Error("Invalid configuration: OTP_DEV_MODE must be false in production (it shows codes on screen).");
    }
  }
  if (e.SMS_PROVIDER === "msg91" && (!e.MSG91_AUTH_KEY || !e.MSG91_TEMPLATE_ID)) {
    throw new Error("Invalid configuration: SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.");
  }
  cached = e;
  return e;
}

/** Which optional integrations are configured. Safe to send to clients (booleans only). */
export function integrations() {
  const e = env();
  return {
    sms: e.SMS_PROVIDER !== "none",
    otpDevMode: e.OTP_DEV_MODE === "true",
    voice: Boolean(e.BHASHINI_USER_ID && e.BHASHINI_API_KEY),
    assistant: Boolean(e.GEMINI_API_KEY),
    aadhaar: Boolean(e.AADHAAR_UIDAI_CERT_PEM) || e.AADHAAR_ALLOW_TEST_CARDS === "true",
    aadhaarTestCards: e.AADHAAR_ALLOW_TEST_CARDS === "true",
    simulator: e.SENSOR_SIMULATOR === "true",
    demo: e.DEMO_MODE === "true",
  };
}

export function mfaRequiredFor(role: string): boolean {
  return env()
    .MFA_REQUIRED_ROLES.split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .includes(role);
}

export function resetEnvCacheForTests() {
  cached = null;
}
