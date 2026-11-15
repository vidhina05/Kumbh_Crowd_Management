/**
 * End-to-end journeys in a real browser against a production build.
 *   1. npm run build
 *   2. CHROME_PATH=/path/to/chrome npm run test:e2e
 * Uses a throwaway embedded database in .data/e2e and a fake camera/microphone.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import puppeteer from "puppeteer-core";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const SHOTS = "tests/e2e/screenshots";
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "pglite://.data/e2e",
  DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  LOOKUP_HMAC_KEY: randomBytes(32).toString("base64"),
  SESSION_SECRET: randomBytes(32).toString("base64"),
  CRON_SECRET: randomBytes(24).toString("hex"),
  OTP_DEV_MODE: "true",
  ALLOW_OTP_DEV_MODE_IN_PRODUCTION: "yes-i-understand", // e2e only: shows the code on screen
  SMS_PROVIDER: "none",
  SEED_ADMIN_EMAIL: "e2e-admin@example.org",
  SEED_ADMIN_PASSWORD: "E2eAdminPass123",
};
delete env.BHASHINI_USER_ID; delete env.BHASHINI_API_KEY; delete env.GEMINI_API_KEY;

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); throw e; }
};

rmSync(".data/e2e", { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

// The "production" check refuses an embedded database, so migrate/seed run as development.
const seedOut = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/seed.ts"], { env: { ...env, NODE_ENV: "development" }, encoding: "utf8" });
const kioskToken = seedOut.split("\n").find((l) => /^[A-Za-z0-9_-]{43}$/.test(l.trim()))?.trim();
if (!kioskToken) throw new Error("Seed did not print a kiosk token");

const server = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], { env: { ...env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 1000));
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--lang=en-IN"],
});

const clickText = async (page, text, sel = "button") => {
  const ok = await page.evaluate((t, s) => {
    const el = [...document.querySelectorAll(s)].find((b) => b.textContent.replace(/\s+/g, " ").includes(t) && !b.disabled);
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; }
    return false;
  }, text, sel);
  if (!ok) throw new Error(`No enabled ${sel} with text "${text}"`);
};
const waitText = async (page, text, timeout = 15000) => {
  try { await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 300 }, text); }
  catch { throw new Error(`"${text}" never appeared on ${page.url()} — page starts: ${(await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")).catch(() => "")).slice(0, 300)}`); }
};
const type = async (page, sel, value) => {
  await page.click(sel);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(sel, value);
};

let failed = false;
let passCode = "";
try {
  const k = await browser.newPage();
  k.on("response", async (r) => { if (r.url().includes("/api/") && r.status() >= 500) console.log("    [server 5xx]", r.url(), r.status()); });
  k.on("requestfailed", (r) => { if (!r.url().includes("/api/kiosk/heartbeat")) console.log("    [request failed]", r.url(), r.failure()?.errorText); });
  k.on("pageerror", (e) => console.log("    [page error]", e.message));
  await k.setViewport({ width: 1280, height: 800 });

  console.log("\nKiosk");
  await step("security headers are sent", async () => {
    const r = await fetch(`${BASE}/kiosk`);
    for (const h of ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"]) if (!r.headers.get(h)) throw new Error(`missing ${h}`);
    if (r.headers.get("x-powered-by")) throw new Error("x-powered-by leaks the framework");
  });
  await step("staff sets up the kiosk with its device token", async () => {
    await k.goto(`${BASE}/kiosk`);
    await waitText(k, "Set up this kiosk");
    await type(k, "#kid", "K-17");
    await type(k, "#ktok", kioskToken);
    await clickText(k, "Check and save");
    await waitText(k, "स्वागत है");
  });
  await step("welcome screen is in Hindi by default and lists 10 languages", async () => {
    const n = await k.$$eval(".k-lang-grid .k-option", (els) => els.length);
    if (n !== 10) throw new Error(`expected 10 languages, got ${n}`);
    await k.screenshot({ path: `${SHOTS}/01-welcome-hi.png` });
  });
  await step("switches to Tamil from the language dialog, then to English", async () => {
    await k.click('button[aria-label="अपनी भाषा चुनें"]');
    await clickText(k, "தமிழ்", ".dialog .k-option");
    await waitText(k, "வரவேற்கிறோம்");
    await clickText(k, "EN", ".k-seg button");
    await waitText(k, "Welcome");
  });
  await step("consent with photo permission", async () => {
    await clickText(k, "Continue in English");
    await waitText(k, "Your details stay safe");
    await k.click(".k-check input");
    await clickText(k, "I agree");
  });
  await step("phone verification with a one-time code", async () => {
    await waitText(k, "Your mobile number");
    for (const d of "9876543210") await clickText(k, d, ".k-keypad button");
    await clickText(k, "Send code");
    await waitText(k, "Your code is");
    const code = await k.$eval(".banner.info", (el) => el.textContent.match(/(\d{4})/)[1]);
    await type(k, "#otp", code);
    await clickText(k, "Check code");
    await waitText(k, "Who is with you?");
  });
  await step("adds a family of 3 with a child photo from the camera", async () => {
    await k.type('input[id^="n-"]', "Ramesh Sharma");
    await k.type('input[id^="a-"]', "54");
    await clickText(k, "Save");
    const add = async (name, age, rel, wheelchair, photo) => {
      await clickText(k, "Add a member");
      await k.waitForSelector('input[id^="n-"]');
      await k.type('input[id^="n-"]', name);
      await k.type('input[id^="a-"]', String(age));
      await k.select('select[id^="r-"]', rel);
      if (wheelchair) await k.click(".card .k-check input");
      if (photo) {
        await clickText(k, "Take photo");
        await k.waitForSelector(".k-camera video");
        await new Promise((r) => setTimeout(r, 800));
        await clickText(k, "Take photo");
        await k.waitForSelector(".k-camera img");
      }
      await clickText(k, "Save");
    };
    await add("Neel Sharma", 7, "child", false, true);
    await add("Ganga Devi", 78, "parent", true, false);
    await waitText(k, "Your family · 3 people");
    await k.screenshot({ path: `${SHOTS}/02-family.png` });
  });
  await step("chooses a bathing slot (calmest ghat first)", async () => {
    await clickText(k, "Continue");
    await k.waitForSelector(".k-time:not([disabled])");
    await k.click(".k-time:not([disabled])");
    await k.screenshot({ path: `${SHOTS}/03-slot.png` });
    await clickText(k, "Continue");
    await waitText(k, "Check and confirm");
  });
  await step("books and shows the pass with QR, 3 wristbands", async () => {
    await clickText(k, "Book ");
    try { await waitText(k, "Your family is registered"); }
    catch (e) { await k.screenshot({ path: `${SHOTS}/err-book.png` }); console.log("PAGE:", (await k.evaluate(() => document.body.innerText)).slice(0, 800)); throw e; }
    await k.waitForSelector("img.qr");
    const text = await k.evaluate(() => document.body.innerText);
    if (!/KMB-\d+-[A-Z2-9]{4}/.test(text)) throw new Error("no pass code");
    passCode = text.match(/KMB-\d+-[A-Z2-9]{4}/)[0];
    if (!text.includes("3 wristbands")) throw new Error("expected 3 wristbands");
    await k.screenshot({ path: `${SHOTS}/04-pass.png` });
    await clickText(k, "Done");
    await waitText(k, "स्वागत है");
  });
  await step("asks for medical help", async () => {
    await clickText(k, "मदद");
    await clickText(k, "EN", ".k-seg button");
    await clickText(k, "Medical help", ".k-option");
    await k.type("#help-text", "Elderly woman feeling faint");
    await clickText(k, "Call a volunteer");
    await waitText(k, "Help is on the way");
    await clickText(k, "Done");
  });
  await step("reports a missing child", async () => {
    await clickText(k, "मदद");
    await clickText(k, "EN", ".k-seg button");
    await clickText(k, "Someone is missing", ".k-option");
    await k.type("#lost-personName", "Neel Sharma");
    await k.type("#lost-age", "7");
    await k.type("#lost-description", "Red shirt, blue shorts");
    await k.type("#lost-lastSeen", "Near Gate 4");
    await k.type("#lost-reporterName", "Ramesh");
    await clickText(k, "Start search");
    await waitText(k, "We are searching for Neel Sharma");
    await clickText(k, "Done");
  });
  await step("offline: a help request is saved and sent when the connection returns", async () => {
    await clickText(k, "मदद");
    await clickText(k, "EN", ".k-seg button");
    await clickText(k, "Wheelchair", ".k-option");
    await k.setOfflineMode(true);
    await clickText(k, "Call a volunteer");
    await waitText(k, "It will be sent as soon as the internet is back");
    await k.screenshot({ path: `${SHOTS}/05-offline-queued.png` });
    await k.setOfflineMode(false);
    await k.evaluate(() => dispatchEvent(new Event("online")));
    await k.waitForFunction(() => (JSON.parse(localStorage.getItem("kiosk.outbox") || "[]")).length === 0, { timeout: 20000 });
    await clickText(k, "Done");
  });
  await step("find my registration by phone and change the slot once", async () => {
    await clickText(k, "EN", ".k-seg button");
    await clickText(k, "Already registered? Find me");
    for (const d of "9876543210") await clickText(k, d, ".k-keypad button");
    await clickText(k, "Send code");
    await waitText(k, "Your code is");
    const code = await k.$eval(".banner.info", (el) => el.textContent.match(/(\d{4})/)[1]);
    await type(k, "#otp", code);
    await clickText(k, "Check code");
    await waitText(k, "Your registration");
    await clickText(k, "Change time");
    await k.waitForSelector(".k-time:not([disabled])");
    const times = await k.$$(".k-time:not([disabled])");
    await times[times.length > 1 ? 1 : 0].click();
    await clickText(k, "Book ");
    await waitText(k, "Replaces");
    const newCode = (await k.evaluate(() => document.body.innerText)).match(/New pass · (KMB-\d+-[A-Z2-9]{4})/);
    if (!newCode || newCode[1] === passCode) throw new Error("expected a new pass number");
    passCode = newCode[1];
    await clickText(k, "Done");
  });

  console.log("\nAdmin");
  const a = await browser.newPage();
  await a.setViewport({ width: 1440, height: 1000 });
  await step("admin pages require sign-in", async () => {
    await a.goto(`${BASE}/admin/families`);
    await waitText(a, "Sign in to your shift");
  });
  await step("wrong password is rejected without saying which part was wrong", async () => {
    await a.type("#email", "e2e-admin@example.org");
    await a.type("#pw", "not-the-password-1");
    await clickText(a, "Sign in");
    await waitText(a, "Email or password is not right");
  });
  await step("signs in and sees today's real counts", async () => {
    await type(a, "#pw", "E2eAdminPass123");
    await Promise.all([a.waitForNavigation({ waitUntil: "networkidle2" }), clickText(a, "Sign in")]);
    try { await waitText(a, "Command overview"); }
    catch (e) { console.log("PAGE:", a.url(), (await a.evaluate(() => document.body.innerText)).slice(0, 600)); throw e; }
    await waitText(a, "No crowd sensors are connected");
    const kpi = await a.$$eval(".a-kpi", (els) => els.map((e) => e.innerText));
    if (!kpi[0].includes("1")) throw new Error(`expected 1 family today, saw: ${kpi[0]}`);
    await a.screenshot({ path: `${SHOTS}/10-admin-overview.png` });
  });
  await step("staff enters a crowd count; it is labelled as manual with the time", async () => {
    await clickText(a, "Update count");
    await a.waitForSelector('input[aria-label^="People at"]');
    await type(a, 'input[aria-label^="People at"]', "39000");
    await clickText(a, "Save");
    await waitText(a, "entered by staff 0 min ago");
  });
  await step("family registered at the kiosk shows up with provenance and wristbands", async () => {
    await a.goto(`${BASE}/admin/families`);
    await a.type("#fq", "Ramesh");
    await a.waitForSelector("tr.clickable");
    await a.click("tr.clickable");
    await waitText(a, "Registered at kiosk K-17");
    const t = await a.evaluate(() => document.body.innerText);
    if ((t.match(/WB-[A-Z2-9]{6}/g) || []).length !== 3) throw new Error("expected 3 wristband IDs");
    if (!t.includes("photo on file")) throw new Error("expected the child photo on file");
    await a.screenshot({ path: `${SHOTS}/11-admin-family.png` });
  });
  await step("help desk works a help request to resolved", async () => {
    await a.goto(`${BASE}/admin/help`);
    await waitText(a, "Elderly woman feeling faint");
    await clickText(a, "Medical", "tr.clickable");
    await clickText(a, "Start");
    await waitText(a, "in progress");
    await a.type('input[aria-label="New note"]', "Sent Dr. Rao from Medical post 3");
    await clickText(a, "Add");
    await waitText(a, "Sent Dr. Rao");
    await clickText(a, "Mark resolved");
    await a.waitForFunction(() => !document.body.innerText.includes("Elderly woman feeling faint") || document.body.innerText.includes("resolved"), { timeout: 15000 });
  });
  await step("the queued offline request arrived", async () => {
    await a.goto(`${BASE}/admin/help`);
    await waitText(a, "Wheelchair");
  });
  await step("lost child case: search → found → reunited, photo view is logged", async () => {
    await a.goto(`${BASE}/admin/lost`);
    await waitText(a, "Neel Sharma");
    await a.click("tr.clickable");
    await waitText(a, "Not linked to a registration");
    await a.type('input[aria-label="Pass number to link"]', passCode);
    await clickText(a, "Link to registered family");
    await waitText(a, "· Neel Sharma");
    await clickText(a, "Show registration photo");
    await a.waitForSelector('img[alt^="Photo of Neel"]');
    await a.screenshot({ path: `${SHOTS}/12-admin-lost.png` });
    await clickText(a, "Start search");
    await waitText(a, "searching");
    await clickText(a, "Found");
    await waitText(a, "Reunited with family");
    await clickText(a, "Reunited with family");
    await a.waitForFunction(() => !document.body.innerText.includes("Reunited with family"), { timeout: 15000 });
    await a.goto(`${BASE}/admin/audit`);
    await waitText(a, "lost.photo_viewed");
  });
  await step("an alert for kiosks appears on the kiosk", async () => {
    await a.goto(`${BASE}/admin/alerts`);
    await a.type("#title", "Sangam is full");
    await a.type("#msg", "Please choose Ram Ghat or Kila Ghat.");
    await a.select("#aud", "kiosk");
    await clickText(a, "Publish alert");
    await clickText(a, "Publish", ".dialog button");
    await waitText(a, "Sangam is full");
    await k.reload();
    await waitText(k, "Sangam is full");
    await k.screenshot({ path: `${SHOTS}/06-kiosk-alert.png` });
  });
  await step("kiosk fleet shows K-17 online with its registrations", async () => {
    await a.goto(`${BASE}/admin/kiosks`);
    await waitText(a, "Online");
  });
  await step("Sahayak says it is not connected (no fake answers without a key)", async () => {
    await a.goto(`${BASE}/admin`);
    await clickText(a, "Ask Sahayak");
    await waitText(a, "Sahayak is not connected");
  });
  await step("dark theme renders", async () => {
    await a.click('button[title="Theme"]');
    await a.screenshot({ path: `${SHOTS}/13-admin-dark.png` });
  });
  await step("a help-desk account can't open staff management", async () => {
    await a.goto(`${BASE}/admin/users`);
    await a.type("#un", "Desk Person");
    await a.type("#ue", "desk@example.org");
    await a.select("#ur", "help_desk");
    await a.type("#up", "HelpDeskPass123");
    await clickText(a, "Add staff member");
    await waitText(a, "Staff member added");
    const ctx = await browser.createBrowserContext();
    const d = await ctx.newPage();
    await d.goto(`${BASE}/admin/login`);
    await d.type("#email", "desk@example.org");
    await d.type("#pw", "HelpDeskPass123");
    await Promise.all([d.waitForNavigation({ waitUntil: "networkidle2" }), clickText(d, "Sign in")]);
    await waitText(d, "Command overview");
    const nav = await d.$$eval(".a-dest", (els) => els.map((e) => e.textContent));
    if (nav.some((n) => /Staff|Kiosks|Activity/.test(n))) throw new Error(`help desk sees ${nav.join(", ")}`);
    const r = await d.evaluate(() => fetch("/api/admin/users").then((x) => x.status));
    if (r !== 403) throw new Error(`expected 403 from /api/admin/users, got ${r}`);
    await ctx.close();
  });
  await step("mobile width: kiosk stacks panes, admin rail moves to the bottom", async () => {
    await k.setViewport({ width: 390, height: 844 });
    await k.goto(`${BASE}/kiosk`);
    await waitText(k, "स्वागत है");
    await k.screenshot({ path: `${SHOTS}/07-kiosk-mobile.png`, fullPage: true });
    await a.setViewport({ width: 390, height: 844 });
    await a.goto(`${BASE}/admin`);
    await waitText(a, "Command overview");
    await a.screenshot({ path: `${SHOTS}/14-admin-mobile.png`, fullPage: true });
  });
} catch {
  failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  const errors = serverLog.split("\n").filter((l) => /\[api\] unhandled|Error:/.test(l));
  if (errors.length) console.log("\nServer errors:\n" + errors.slice(0, 20).join("\n"));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} journeys passed`);
  process.exit(failed ? 1 : 0);
}
