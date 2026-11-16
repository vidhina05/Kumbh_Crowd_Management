/**
 * Full click-through of the built site in a real browser (headless Chrome), the way a person would use it.
 *   SITE=https://vidhina05.github.io/Kumbh_Crowd_Management node tests/e2e/clickthrough.mjs
 * Optional fake camera feeds (so face matching and people counting run on real images):
 *   FACE_FEED=/path/face.y4m  FACE_JPG=/path/face.jpg  CROWD_FEED=/path/crowd.y4m
 * Exits non-zero if any step fails. Screenshots go to SHOTS (default /tmp/shots).
 */
import puppeteer from "puppeteer-core";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";

const SITE = (process.env.SITE ?? "http://localhost:8765/Kumbh_Crowd_Management").replace(/\/$/, "");
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function launch(feed) {
  const args = ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1440,900"];
  if (feed) args.push(`--use-file-for-fake-video-capture=${feed}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, protocolTimeout: 240_000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.setDefaultTimeout(45_000);
  page.on("workercreated", (w) => process.env.LOG_ALL && console.log("      [worker created]", w.url().replace(SITE, "")));
  page.on("workerdestroyed", (w) => process.env.LOG_ALL && console.log("      [worker destroyed]", w.url().replace(SITE, "")));
  page.on("framenavigated", (f) => process.env.LOG_ALL && f === page.mainFrame() && console.log("      [navigated]", f.url().replace(SITE, "")));
  page.on("pageerror", (e) => pageErrors.push(`[${page.url().replace(SITE, "")}] pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => { if (process.env.LOG_ALL) console.log(`      [console ${m.type()}] ${m.text().slice(0, 300)}`); if (m.type() === "error" && !/favicon/.test(m.text())) pageErrors.push(`[${page.url().replace(SITE, "")}] console: ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("favicon")) pageErrors.push(`[${page.url().replace(SITE, "")}] http ${r.status()} ${r.url().replace(SITE, "")}`); });
  page.on("dialog", (d) => d.accept());
  return { browser, page };
}

const H = (page) => ({
  go: async (path) => { await page.goto(SITE + path, { waitUntil: "networkidle2" }); },
  text: (t, timeout = 45_000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t),
  noText: (t, timeout = 20_000) => page.waitForFunction((x) => !document.body.innerText.includes(x), { timeout }, t),
  click: async (text, sel = "button, a, [role=button], label.btn, [role=radio]") => {
    await page.waitForFunction((s, x) => [...document.querySelectorAll(s)].some((e) => e.textContent.replace(/\s+/g, " ").includes(x) && !e.disabled && e.offsetParent !== null), { timeout: 30_000 }, sel, text);
    await page.evaluate((s, x) => { const el = [...document.querySelectorAll(s)].filter((e) => e.textContent.replace(/\s+/g, " ").includes(x) && !e.disabled && e.offsetParent !== null).pop(); el.scrollIntoView({ block: "center" }); el.click(); }, sel, text);
    await sleep(250);
  },
  type: async (sel, value) => {
    await page.waitForSelector(sel, { visible: true });
    await page.$eval(sel, (el) => { el.focus(); el.select?.(); });
    await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace");
    await page.type(sel, value, { delay: 5 });
  },
  select: (sel, value) => page.select(sel, value),
  shot: (n) => page.screenshot({ path: `${SHOTS}/${n}.png` }),
  noErrorBanner: async () => {
    const bad = await page.evaluate(() => [...document.querySelectorAll(".banner.bad")].map((b) => b.innerText).filter((t) => !/above the safe limit/i.test(t)));
    if (bad.length) throw new Error("Error banner: " + bad.join(" | "));
  },
  api: (method, url, body, headers = {}) => page.evaluate(async (m, u, b, hd, base) => {
    const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json", ...hd }, body: b ? JSON.stringify(b) : undefined, credentials: "same-origin" });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, method, url, body, headers, new URL(SITE).pathname),
});

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: e.message.split("\n")[0].slice(0, 300) });
    console.log(`  ✗ ${name}: ${e.message.split("\n")[0].slice(0, 300)}`);
    if (CUR) await CUR.screenshot({ path: `${SHOTS}/FAIL-${results.length}.png` }).catch(() => undefined);
  }
}

const state = {};
let CUR = null; // page used for failure screenshots

// ---------------------------------------------------------------- Browser A: kiosk + control room (face feed)
const A = await launch(process.env.FACE_FEED);
{
  const page = A.page, h = H(page);
  CUR = page;
  console.log("Browser A — kiosk, control room, public pass");

  await step("Home page opens with all four parts", async () => {
    await h.go("/");
    for (const t of ["Registration kiosk", "Control room", "My pass", "Camera crowd counter"]) await h.text(t);
    await h.shot("a01-home");
  });

  await step("Kiosk starts, configures itself and switches to English", async () => {
    await h.go("/kiosk/");
    await page.waitForSelector(".k-root");
    await h.click("EN", ".k-seg button");
    await h.text("Continue in English");
    await page.waitForFunction(() => !document.body.innerText.includes("Set up this kiosk"));
    await h.shot("a02-kiosk-welcome");
  });

  await step("Kiosk: consent with face matching, Aadhaar test card, phone", async () => {
    await h.click("Continue in English");
    await h.text("I agree");
    await page.evaluate(() => { const cb = [...document.querySelectorAll(".k-check")].find((l) => l.textContent.includes("face matching")).querySelector("input"); cb.click(); });
    await h.click("I agree");
    await h.text("Scan Aadhaar card");
    await h.shot("a03-identify");
    await h.click("Scan Aadhaar card");
    await h.text("Demo test cards");
    await h.shot("a04-aadhaar-scan");
    await h.click("Sunita Verma");
    await h.text("Card checked: Sunita Verma");
    state.phone = "98" + String(Date.now()).slice(-8);
    await h.type("#aphone", state.phone);
    await h.shot("a05-aadhaar-phone");
    await h.click("Continue", ".k-footer button");
    await h.text("Add a member");
    const name = await page.$eval('input[id^="n-"]', (e) => e.value);
    if (!name.includes("Sunita")) throw new Error("Leader name not prefilled from Aadhaar: " + name);
  });

  await step("Kiosk: leader photo turns into a face template on the device", async () => {
    await h.click("Take photo");
    await sleep(1500);
    await h.click("Take photo");
    await page.waitForFunction(() => /Face saved for matching|We couldn't see one clear face/.test(document.body.innerText), { timeout: 120_000 });
    const ok = await page.evaluate(() => document.body.innerText.includes("Face saved for matching"));
    await h.shot("a06-face");
    if (!ok && process.env.FACE_FEED) throw new Error("No face found in the camera feed");
    state.faceSaved = ok;
    await h.click("Save", ".card button");
    await h.text("You · group leader");
  });

  await step("Kiosk: add a child, pick a slot, book, get a pass", async () => {
    await h.click("Add a member");
    await h.type('input[id^="n-"]', "Meera");
    await h.type('input[id^="a-"]', "6");
    await h.click("Save", ".card button");
    await h.click("Continue", ".k-footer button");
    await page.waitForSelector(".k-time:not([disabled])", { timeout: 30_000 });
    // tomorrow, so the slot is always in the future
    await page.evaluate(() => document.querySelectorAll('[role=radiogroup] .k-option')[1].click());
    await page.waitForSelector(".k-time:not([disabled])");
    await page.evaluate(() => document.querySelector(".k-time:not([disabled])").click());
    await h.click("Continue", ".k-footer button");
    await h.text("Book ");
    await h.click("Book ", ".k-footer button");
    await page.waitForFunction(() => /Pass · KMB-/.test(document.body.innerText), { timeout: 30_000 });
    state.pass = await page.evaluate(() => document.body.innerText.match(/KMB-[A-Z0-9-]+/)[0]);
    await h.shot("a07-pass");
    await h.click("Done", ".k-footer button");
  });

  await step("Kiosk: data survives a reload (stored in this browser)", async () => {
    await page.reload({ waitUntil: "networkidle2" });
    await h.click("EN", ".k-seg button");
    await h.click("Already registered? Find me");
    await h.click("Scan the QR on my pass");
    await h.type("#pcode", state.pass);
    await h.type("#l4", state.phone.slice(-4));
    await h.click("Continue", ".k-footer button");
    await h.text(state.pass);
    await h.text("Sunita Verma");
    await h.shot("a08-find-by-pass");
    await h.click("Done", ".k-footer button");
  });

  await step("Kiosk: find me by face", async () => {
    await h.click("EN", ".k-seg button");
    await h.click("Already registered? Find me");
    await h.click("Look at the camera");
    await h.click("Use my face");
    await page.waitForFunction(() => /Face saved for matching|We couldn't see one clear face/.test(document.body.innerText), { timeout: 120_000 });
    if (!(await page.evaluate(() => document.body.innerText.includes("Face saved for matching")))) {
      if (process.env.FACE_FEED) throw new Error("No face found in live camera");
      return;
    }
    await h.type("#l4f", state.phone.slice(-4));
    await h.click("Continue", ".k-footer button");
    await h.text(state.pass, 30_000);
    await h.shot("a09-find-by-face");
    await h.click("Done", ".k-footer button");
  });

  await step("Kiosk: wrong last 4 digits is refused", async () => {
    await h.click("EN", ".k-seg button");
    await h.click("Already registered? Find me");
    await h.click("Scan the QR on my pass");
    await h.type("#pcode", state.pass);
    await h.type("#l4", "0000");
    await h.click("Continue", ".k-footer button");
    await page.waitForSelector(".banner.bad");
    await h.click("Back", ".k-footer button");
    await h.click("Back", ".k-footer button");
  });

  await step("Kiosk: phone code (OTP) registration path", async () => {
    await h.click("EN", ".k-seg button");
    await h.click("Continue in English");
    await h.click("I agree");
    await h.click("Phone number");
    const ph = "97" + String(Date.now()).slice(-8);
    await h.type("#phone", ph);
    await h.click("Send code", ".k-footer button");
    await h.text("Your code is");
    const code = await page.evaluate(() => document.body.innerText.match(/Your code is (\d{4})/)[1]);
    await h.type("#otp", code);
    await h.click("Check code", ".k-footer button");
    await h.text("Add a member");
    await h.click("Start over", ".k-footer button");
  });

  await step("Kiosk: help request and missing-person report", async () => {
    await h.click("EN", ".k-seg button");
    await h.click("Help", ".k-top button");
    await h.click("Medical help");
    await h.type("#help-text", "Elderly man feeling dizzy near gate 3");
    await h.click("Call a volunteer");
    await page.waitForFunction(() => /H-\d+/.test(document.body.innerText));
    await h.click("Done", ".k-footer button");
    await h.click("EN", ".k-seg button");
    await h.click("Help", ".k-top button");
    await h.click("Someone is missing", ".k-option");
    await h.type("#lost-personName", "Gopal");
    await h.type("#lost-age", "9");
    await h.type("#lost-description", "Red shirt, blue shorts");
    await h.type("#lost-lastSeen", "Near Sangam gate 2");
    await h.type("#lost-reporterName", "Radha");
    await h.click("Start search");
    await page.waitForFunction(() => /L-\d+/.test(document.body.innerText));
    state.lostCode = await page.evaluate(() => document.body.innerText.match(/L-\d+/)[0]);
    await h.shot("a10-lost-sent");
    await h.click("Done", ".k-footer button");
  });

  await step("Kiosk: dark theme toggle", async () => {
    await page.click('.k-top .icon-btn');
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "dark") throw new Error("theme not dark");
    await h.shot("a11-kiosk-dark");
    await page.click('.k-top .icon-btn');
  });

  // ----------------------------------------------------------- Control room
  await step("Control room: demo sign-in as super admin", async () => {
    await h.go("/admin/");
    await page.waitForFunction(() => location.pathname.includes("/admin/login"));
    await h.click("Kavita Sharma");
    await h.text("Command overview");
    await sleep(800);
    await h.noErrorBanner();
    await h.shot("b01-overview");
  });

  await step("Overview → tap a ghat on the map → ghat detail with chart", async () => {
    await page.evaluate(() => document.querySelector('.crowd-map .ghat-pin[aria-label^="Sangam"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await h.text("Last 2 hours and the next hour");
    await page.waitForSelector(".line-chart path");
    await h.shot("b02-ghat");
  });

  await step("Ghat detail: hold a gate, alert raised, reopen", async () => {
    await h.click("Hold", "td button");
    await h.text("put on hold");
    await h.text("on hold");
    await h.click("Reopen", "td button");
    await h.text("Gate reopened");
  });

  await step("Ghat detail: staff count overrides the simulator", async () => {
    await h.type("#cnt", "20000");
    await h.click("Save count");
    await h.text("Saved 20,000 people");
    await h.text("Entered by staff");
  });

  await step("Live map: 2D, 3D, rotate, select a ghat", async () => {
    await h.go("/admin/map/");
    await page.waitForSelector(".crowd-map");
    await h.click("3D columns");
    await page.waitForSelector(".crowd-map.iso .iso-col");
    await h.click("", 'button[aria-label="Rotate right"]');
    await page.evaluate(() => document.querySelector(".crowd-map.iso .iso-col").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await h.text("Full detail");
    await h.shot("b03-map-3d");
    await h.click("2D plan");
    await page.waitForSelector(".crowd-map .ghat-pin");
  });

  await step("Batches: grid and suggested fixes", async () => {
    await h.go("/admin/batches/");
    await page.waitForSelector(".slot-cell");
    await h.shot("b04-batches");
  });

  await step("Diversion: plan in 3 steps, second check refuses the same person, another staff approves, undo", async () => {
    await h.go("/admin/batches/");
    await h.click("Plan this diversion");
    await page.waitForFunction(() => location.pathname.includes("/diversions/new"));
    await page.waitForSelector('.a-pick input[type=checkbox]:checked');
    await h.click("Next ·");
    await h.text("Choose a ghat");
    await page.waitForSelector('.a-pick input[type=radio]:checked');
    await h.shot("b05-divert-step2");
    await h.click("Next", ".a-pane button.btn-filled");
    await h.text("Check the plan");
    await h.type("#reason", "Sangam batches over-full");
    await h.click("Send for second check");
    await page.waitForFunction(() => location.pathname.includes("/diversions/view"));
    await h.text("Waiting for second check");
    await h.type("#ap-email", "kavita@demo.sangamseva.in");
    await h.type("#ap-pw", "Sangam-demo-2026");
    await h.click("Approve and send");
    await h.text("different person");
    await h.type("#ap-email", "rohit@demo.sangamseva.in");
    await h.type("#ap-pw", "Sangam-demo-2026");
    await h.click("Approve and send");
    await h.text("Approved and sent");
    await h.text("Sent to families");
    await h.shot("b06-diversion-live");
    await h.click("Undo this diversion");
    await h.click("Yes, undo");
    await h.text("Undone.");
  });

  await step("Diversion reaches a registered family: kiosk notice and confirmation", async () => {
    const info = await page.evaluate(() => window.__demoApi.info());
    const k = { "X-Kiosk-Id": info.kiosk.id, "X-Kiosk-Token": info.kiosk.token };
    const f = await h.api("POST", "/api/kiosk/find/pass", { passCode: "KMB-5-SHRM", last4: "4410" }, k);
    if (f.status !== 200) throw new Error("find Sharma: " + f.status);
    const me = await h.api("GET", "/api/kiosk/registrations/me", null, { ...k, "X-Pilgrim-Token": f.body.pilgrimToken });
    const plan = await h.api("GET", `/api/admin/diversions/plan?ghat=${me.body.ghat.id}&day=${me.body.slot.day}`);
    if (!plan.body.batches.some((b) => b.id === me.body.slot.id)) throw new Error("Sharma batch is not divertable");
    const t = await h.api("POST", "/api/admin/diversions/plan", { fromGhatId: me.body.ghat.id, slotIds: [me.body.slot.id] });
    const d = await h.api("POST", "/api/admin/diversions", { fromGhatId: me.body.ghat.id, toGhatId: t.body.best ?? t.body.options[0].ghatId, slotIds: [me.body.slot.id], reason: "test" });
    if (d.status !== 201) throw new Error("create: " + JSON.stringify(d.body));
    const ap = await h.api("POST", `/api/admin/diversions/${d.body.id}/approve`, { email: "rajesh@demo.sangamseva.in", password: "Sangam-demo-2026" });
    if (ap.status !== 200) throw new Error("approve: " + JSON.stringify(ap.body));
    state.divertedTo = (t.body.options.find((o) => o.ghatId === (t.body.best ?? t.body.options[0].ghatId))).name;
    await h.go("/kiosk/");
    await h.click("EN", ".k-seg button");
    await h.click("Already registered? Find me");
    await h.click("Scan the QR on my pass");
    await h.type("#pcode", "KMB-5-SHRM");
    await h.type("#l4", "4410");
    await h.click("Continue", ".k-footer button");
    await h.text("Your ghat has changed");
    await h.text(state.divertedTo);
    await h.shot("a12-kiosk-diversion");
    await h.click("I've seen the change");
    await h.text("The volunteers know you're coming");
    await h.click("Done", ".k-footer button");
  });

  await step("Public pass page on a pilgrim's phone shows the change", async () => {
    await h.go("/pass/?p=KMB-5-SHRM");
    await h.type("#l4", "4410");
    await h.click("Show my pass");
    await h.text(state.divertedTo);
    await h.text("The volunteers know you're coming");
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await h.shot("c01-public-pass-mobile");
    await page.setViewport({ width: 1440, height: 900 });
  });

  await step("Sensors: register a camera counter and get its key once", async () => {
    await h.go("/admin/");
    await h.text("Command overview");
    await h.go("/admin/sensors/");
    await page.waitForSelector("table.a-table tbody tr");
    await page.waitForSelector('#s-ghat option[value="sangam"]');
    await h.type("#s-name", "Sangam test camera");
    await h.select("#s-kind", "camera_counter");
    await h.select("#s-ghat", "sangam");
    await h.click("Register and get key");
    await h.text("Copy this key now");
    state.sensor = await page.evaluate(() => { const t = document.querySelector(".banner.warn").innerText; return { id: t.match(/S-\d{4,6}/)[0], key: t.match(/sk_[A-Za-z0-9_-]+/)[0] }; });
    await h.shot("b07-sensor-key");
    const r = await h.api("POST", "/api/sensors/ingest", { occupancy: 12 }, { "X-Sensor-Id": state.sensor.id, Authorization: `Bearer ${state.sensor.key}` });
    if (r.status !== 202) throw new Error("ingest " + r.status);
    const bad = await h.api("POST", "/api/sensors/ingest", { occupancy: 12 }, { "X-Sensor-Id": state.sensor.id, Authorization: "Bearer sk_wrongwrongwrong" });
    if (bad.status !== 401) throw new Error("wrong key accepted: " + bad.status);
    await h.click("I've saved it");
  });

  await step("Camera counter page counts people and posts with the sensor key", async () => {
    await h.go(`/camera/?sensor=${state.sensor.id}`);
    await h.type("#skey", state.sensor.key);
    await h.click("Save and continue");
    await h.click("Start counting");
    await page.waitForFunction(() => /Sent \d+|refused|Couldn't/.test(document.body.innerText), { timeout: 180_000 });
    const txt = await page.evaluate(() => document.body.innerText);
    await h.shot("b08-camera-counter");
    if (!/Sent \d+/.test(txt)) throw new Error("camera counter did not send: " + txt.slice(0, 200));
    await h.click("Stop");
  });

  await step("Lost & found: kiosk report is listed, volunteer opens a found-person case", async () => {
    await h.go("/admin/lost/");
    await h.text(state.lostCode ?? "L-");
    await h.click("Someone found");
    await h.type("#f-name", "");
    await h.type("#f-age", "34");
    await h.type("#f-desc", "Woman in a blue saree, looks confused");
    await h.type("#f-loc", "Lost & found tent, Sector 4");
    await h.click("Open case");
    await h.text("Face match");
  });

  await step("Lost & found: face search finds the family who opted in, staff confirm, reunite, thank", async () => {
    if (!process.env.FACE_JPG) return;
    const input = await page.waitForSelector('input[type=file][aria-label*="found person"]');
    await input.uploadFile(process.env.FACE_JPG);
    await page.waitForFunction(() => /Strong ·|Possible ·|No likely match/.test(document.body.innerText), { timeout: 120_000 });
    await h.shot("b09-face-search");
    if (!(await page.evaluate(() => document.body.innerText.includes("Sunita Verma")))) throw new Error("expected Sunita Verma as a face match");
    await h.click("It's them");
    await h.text("Confirmed by staff");
    await h.text("found"); // confirming the match links the family and marks the case found
    await h.text("Sunita Verma");
    await h.click("Reunited with family", ".a-detail button");
    await h.text("Reunited");
    await h.click("Thank ");
    await h.text("Thank-you recorded");
    await h.shot("b10-reunited");
  });

  await step("Shift: start, hand over to a colleague with notes, report", async () => {
    await h.go("/admin/shift/");
    await h.click("Start shift");
    await h.text("Still open for the next shift");
    await h.select("#to", await page.$eval("#to option:nth-child(2)", (o) => o.value));
    await h.type("#notes", "Watch Sangam gate 3 after 06:00.");
    await h.click("End shift");
    await h.text("handed over");
    await h.text("Handover notes");
    await h.shot("b11-shift-report");
  });

  await step("Sahayak answers from live numbers without AI", async () => {
    await h.go("/admin/");
    await h.text("Command overview");
    await h.click("Ask Sahayak");
    await h.click("Which ghat has room right now?");
    await h.text("Built-in answer (no AI)", 30_000);
    await h.shot("b12-sahayak");
    await page.click('aside.a-sheet button[aria-label="Close"]');
  });

  await step("Wall view", async () => {
    await h.go("/admin/wall/");
    await h.text("Sangam Command · live");
    await page.waitForSelector(".wall .crowd-map");
    await h.shot("b13-wall");
    await h.click("Exit wall view");
    await h.text("Command overview");
  });

  await step("Every other control-room page loads without errors", async () => {
    for (const [path, t] of [["/admin/families/", "Families"], ["/admin/help/", "Help"], ["/admin/alerts/", "Alerts"], ["/admin/kiosks/", "Kiosks"], ["/admin/reports/", "Reports"], ["/admin/users/", "Staff"], ["/admin/audit/", "Activity"], ["/admin/diversions/", "Diversions"], ["/admin/settings/", "Connections"]]) {
      await h.go(path);
      await h.text(t);
      await sleep(1200);
      await h.noErrorBanner();
    }
  });

  await step("Settings: turn on two-step sign-in with an authenticator code", async () => {
    await h.go("/admin/settings/");
    await h.click("Set up two-step sign-in");
    await page.waitForSelector('img[alt^="QR code"]');
    state.secret = await page.evaluate(() => document.body.innerText.match(/Key:\s*([A-Z2-7]{16,})/)[1]);
    state.mfaStep = Math.floor(Date.now() / 30000);
    await h.type("#mfa-code", totp(state.secret, state.mfaStep));
    await h.click("Turn on");
    await h.text("Two-step sign-in is on");
    await h.shot("b14-mfa-on");
  });

  await step("Sign out, sign in again with password + 6-digit code", async () => {
    await page.click('button[aria-label="Sign out"]');
    await page.waitForFunction(() => location.pathname.includes("/admin/login"));
    await h.click("Kavita Sharma");
    await h.text("Enter your 6-digit code");
    while (Math.floor(Date.now() / 30000) === state.mfaStep) await sleep(1000); // a code can't be used twice
    await h.type("#code", totp(state.secret));
    await h.click("Verify and sign in");
    await h.text("Command overview");
  });

  await step("A help-desk account sees only its own areas", async () => {
    await page.click('button[aria-label="Sign out"]');
    await page.waitForFunction(() => location.pathname.includes("/admin/login"));
    await h.click("Anjali Gupta");
    await page.waitForSelector(".a-rail");
    const nav = await page.$$eval(".a-rail .a-dest", (as) => as.map((a) => a.textContent.trim()));
    if (nav.includes("Staff") || nav.includes("Diversions") || nav.includes("Sensors")) throw new Error("help desk sees: " + nav.join(", "));
    const r = await h.api("POST", "/api/admin/diversions", { fromGhatId: "sangam", toGhatId: "ram-ghat", slotIds: ["00000000-0000-4000-8000-000000000000"] });
    if (r.status !== 403) throw new Error("help desk could create a diversion: " + r.status);
  });

  await step("Reset demo returns to fresh data", async () => {
    await h.click("Reset demo");
    await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => undefined);
    await page.waitForFunction(() => window.__demoApi, { timeout: 120_000 });
    await h.go("/admin/");
    await page.waitForFunction(() => location.pathname.includes("/admin/login"), { timeout: 30_000 });
  });
}
await A.browser.close();

// ---------------------------------------------------------------- Browser B: crowd feed for the people counter
if (process.env.CROWD_FEED) {
  const B = await launch(process.env.CROWD_FEED);
  const page = B.page, h = H(page);
  CUR = page;
  console.log("Browser B — camera counter on a crowd image");
  await step("Camera counter counts a crowd", async () => {
    await h.go("/admin/login/");
    await h.click("Kavita Sharma");
    await h.text("Command overview");
    const s = await h.api("POST", "/api/admin/sensors", { name: "Crowd cam", kind: "camera_counter", ghatId: "sangam" });
    await h.go(`/camera/?sensor=${s.body.id}`);
    await h.type("#skey", s.body.key);
    await h.click("Save and continue");
    await h.click("Start counting");
    await page.waitForFunction(() => /Sent (\d+)/.test(document.body.innerText), { timeout: 180_000 });
    const n = Number(await page.evaluate(() => document.body.innerText.match(/Sent (\d+)/)[1]));
    await h.shot("d01-crowd-count");
    if (n < 4) throw new Error(`only ${n} people counted in the crowd image`);
    console.log(`    counted ${n} people`);
  });
  await B.browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
const errs = [...new Set(pageErrors)].filter((e) => !/401 \/api\/admin\/(me|live|overview)|\/api\/kiosk\/find\/pass|\/api\/sensors\/ingest|\/api\/admin\/diversions\/[^/]+\/approve|\/api\/admin\/diversions$|Failed to load resource/.test(e));
if (errs.length) console.log("Unexpected browser errors:\n  " + errs.join("\n  "));
process.exit(failed.length || errs.length ? 1 : 0);
