/**
 * Seeds reference data (ghats + bathing slots for 8 days), the first super admin and the first kiosk.
 * Re-run daily (or from a cron) to keep a week of slots open. Never creates pilgrims or cases.
 *
 *   SEED_ADMIN_EMAIL=you@example.org SEED_ADMIN_PASSWORD='a-long-password-1' npm run db:seed
 *
 * The kiosk device token is printed ONCE. Copy it into the kiosk's setup screen; it can't be shown again
 * (a super admin can issue a new one from Admin → Kiosks).
 */
import { ensureKiosk, ensureSuperAdmin, seedReferenceData } from "../src/server/seed";

async function main() {
  const ref = await seedReferenceData();
  console.log(`Ghats: ${ref.ghats}. New bathing slots: ${ref.slotsCreated}.`);

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const created = await ensureSuperAdmin(email, process.env.SEED_ADMIN_NAME ?? "Control room admin", password);
    console.log(created ? `Super admin created: ${email}` : "Admin users already exist — skipped.");
  } else {
    console.log("No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD given — no admin created.");
  }

  if (process.argv.includes("--no-kiosk")) {
    console.log("Skipping kiosk creation (--no-kiosk). Add kiosks from Admin → Kiosks.");
    process.exit(0);
  }
  const kioskId = process.env.SEED_KIOSK_ID ?? "K-17";
  const token = await ensureKiosk(kioskId, process.env.SEED_KIOSK_NAME ?? "Registration kiosk", process.env.SEED_KIOSK_LOCATION ?? "Sector 4 entry plaza");
  if (token) {
    console.log(`\nKiosk ${kioskId} created. Device token (shown once, keep it private):\n${token}\n`);
  } else {
    console.log(`Kiosk ${kioskId} already exists — token unchanged.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
