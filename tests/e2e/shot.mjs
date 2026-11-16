// Screenshot pages of the built site: node tests/e2e/shot.mjs /admin/ /admin/map/ ...   (signs in as the demo super admin first)
import puppeteer from "puppeteer-core";
const SITE = process.env.SITE ?? "http://localhost:8765/Kumbh_Crowd_Management";
const theme = process.env.THEME ?? "light";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 1024) });
page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 200)));
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 300)));
await page.goto(SITE + "/admin/login/", { waitUntil: "networkidle2" });
if (process.env.LOGIN_SHOT) { await new Promise((r) => setTimeout(r, 2500)); await page.screenshot({ path: "/tmp/shots/login.png" }); }
await page.evaluate((t) => localStorage.setItem("theme", t), theme);
if (!process.argv.slice(2).every((p) => p.startsWith("/kiosk") || p.startsWith("/pass"))) {
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Kavita")), { timeout: 90000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Kavita")).click());
  await page.waitForFunction(() => document.querySelector(".a-rail") || document.body.innerText.includes("Start shift"), { timeout: 60000 });
  if (process.env.START_SHIFT !== "0" && await page.evaluate(() => !document.querySelector(".a-rail"))) { await page.screenshot({ path: "/tmp/shots/start-shift.png" }); await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Start shift")).click()); await page.waitForSelector(".a-rail", { timeout: 60000 }); }
}
for (const p of process.argv.slice(2)) {
  await page.goto(SITE + p, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 3000)));
  const name = (p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home") + `-${theme}`;
  await page.screenshot({ path: `/tmp/shots/${name}.png` });
  console.log("shot", name);
}
await browser.close();
