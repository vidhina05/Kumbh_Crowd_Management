import { randomBytes } from "node:crypto";

// Test-only configuration: fresh random keys each run, an in-memory database, no external services.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = "pglite://memory";
process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.LOOKUP_HMAC_KEY = randomBytes(32).toString("base64");
process.env.SESSION_SECRET = randomBytes(32).toString("base64");
process.env.CRON_SECRET = randomBytes(24).toString("hex");
process.env.OTP_DEV_MODE = "true";
process.env.SMS_PROVIDER = "none";
process.env.MFA_REQUIRED_ROLES = ""; // two-step sign-in is covered by the browser click-through; these flow tests sign in with a password only
delete process.env.BHASHINI_USER_ID;
delete process.env.BHASHINI_API_KEY;
delete process.env.GEMINI_API_KEY;
