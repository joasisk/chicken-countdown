import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

async function windowsCheckout(folder) {
  await cp(new URL("../../public/", import.meta.url), path.join(folder, "public"), { recursive: true });
  await mkdir(path.join(folder, "scripts"));
  await cp(new URL("../../scripts/export.mjs", import.meta.url), path.join(folder, "scripts/export.mjs"));
  for (const name of [
    "scripts/export.mjs", "public/index.html", "public/styles.css", "public/chicken.svg",
    "public/app.js", "public/timer.js", "public/agenda.js", "public/audio.js",
    "public/fonts/OFL.txt", "public/fonts/VT323-OFL.txt",
  ]) {
    const filename = path.join(folder, name);
    const source = await readFile(filename, "utf8");
    await writeFile(filename, source.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"));
  }
}

async function assertFitsViewport(page, { verticalScroll = false } = {}) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    elements: [...document.querySelectorAll("#timer-display, #status-label, #control-dock, .dock-controls .cassette-key, #agenda-panel:not([hidden])")]
      .map(element => ({ id: element.id, ...element.getBoundingClientRect().toJSON() })),
  }));
  assert.ok(layout.scrollWidth <= layout.width, "Export must not have horizontal page overflow");
  if (!verticalScroll)
    assert.ok(layout.scrollHeight <= layout.height, "Export must not have vertical page overflow");
  for (const element of layout.elements) {
    assert.ok(element.left >= 0 && element.right <= layout.width, `${element.id} must fit horizontally`);
    if (!verticalScroll)
      assert.ok(element.top >= 0 && element.bottom <= layout.height, `${element.id} must fit vertically`);
  }
}

test("two-file export runs and plays its alarm over file://", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "chicken export "));
  t.after(() => rm(folder, { recursive: true, force: true }));
  execFileSync(process.execPath, ["scripts/export.mjs", folder]);
  assert.deepEqual((await readdir(folder)).sort(), ["chicken-countdown.html", "screaming-chickens.mp3"]);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (/^https?:/.test(request.url())) errors.push(request.url());
  });
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      window.alarmForTest = audio;
      return audio;
    };
  });
  try {
    await page.goto(pathToFileURL(path.join(folder, "chicken-countdown.html")).href);
  } catch (error) {
    if (error.message.includes("ERR_BLOCKED_BY_ADMINISTRATOR")) {
      t.skip("Managed Chromium policy blocks file:// URLs; run on a browser that permits local files.");
      return;
    }
    throw error;
  }
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('800 20px "Barlow Timer"')), true);
  await page.locator("#theme-light").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.locator("#agenda-toggle").click();
  await page.locator("#stop").click();
  await page.locator("#agenda-input").fill("00:01 Welcome\n00:02 Discussion");
  await page.locator("#agenda-input").blur();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('20px "Agenda Pixels"')), true);
  assert.equal(await page.locator("#agenda-total").textContent(), "TOTAL 00:03");
  await page.locator("#start").click();
  await page.waitForFunction(() => document.getElementById("timer-face").dataset.state === "finished");
  await page.locator("#agenda-next").click();
  assert.equal(await page.locator("#timer-display").textContent(), "00:02");
  assert.equal(await page.locator("#agenda-next").isEnabled(), true);
  await page.keyboard.press("Escape");
  await page.locator("#duration-input").fill("00:02");
  await page.locator("#start").click();
  await page.locator("#pause").click();
  assert.equal(await page.locator("#timer-face").getAttribute("data-state"), "paused");
  await page.locator("#start").click();
  await page.waitForFunction(() => document.getElementById("timer-face").dataset.state === "finished");
  await page.waitForFunction(() => window.alarmForTest.currentTime > 0 && !window.alarmForTest.paused);
  assert.match(await page.evaluate(() => window.alarmForTest.src), /\/screaming-chickens\.mp3$/);
  assert.equal(await page.locator("#audio-message").isVisible(), false);
  await page.locator("#reset").click();
  assert.equal((await page.locator("#timer-display").textContent()).trim(), "00:02");
  assert.deepEqual(errors, []);
});

test("Windows CRLF export matches the Unix build, fits the viewport and runs without source assets", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "chicken agenda export "));
  t.after(() => rm(folder, { recursive: true, force: true }));
  execFileSync(process.execPath, ["scripts/export.mjs", folder]);
  const unixHtml = await readFile(path.join(folder, "chicken-countdown.html"));
  const checkout = path.join(folder, "Windows checkout");
  await mkdir(checkout);
  await windowsCheckout(checkout);
  execFileSync(process.execPath, [path.join(checkout, "scripts/export.mjs")]);
  const html = await readFile(path.join(checkout, "dist/chicken-countdown.html"));
  const alarm = await readFile(path.join(checkout, "dist/screaming-chickens.mp3"));
  assert.equal(html.equals(unixHtml), true, "Line endings must not change the generated HTML");
  assert.equal(alarm.equals(await readFile(path.join(folder, "screaming-chickens.mp3"))), true);
  assert.deepEqual((await readdir(path.join(checkout, "dist"))).sort(), ["chicken-countdown.html", "screaming-chickens.mp3"]);
  const server = createServer((request, response) => {
    const name = new URL(request.url, "http://localhost").pathname;
    if (!["/chicken-countdown.html", "/screaming-chickens.mp3"].includes(name)) {
      response.writeHead(404).end();
      return;
    }
    const isHtml = name.endsWith(".html");
    response.writeHead(200, { "Content-Type": isHtml ? "text/html; charset=utf-8" : "audio/mpeg" });
    response.end(isHtml ? html : alarm);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  const base = `http://127.0.0.1:${server.address().port}`;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!request.url().startsWith(base) && !request.url().startsWith("data:")) errors.push(request.url());
  });
  page.on("response", response => {
    if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
  });
  await page.goto(`${base}/chicken-countdown.html`);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator("#timer-display").textContent(), "00:00");
  const viewports = [
    { width: 2560, height: 1304 },
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ];
  // The initial timer must also fit before JavaScript has initialized it.
  const staticPage = await browser.newPage({ javaScriptEnabled: false, viewport: viewports[0] });
  await staticPage.goto(`${base}/chicken-countdown.html`);
  await staticPage.evaluate(() => document.fonts.ready);
  await assertFitsViewport(staticPage);
  await staticPage.close();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await assertFitsViewport(page);
  }
  await page.setViewportSize(viewports[0]);
  await page.locator("#agenda-toggle").click();
  await page.locator("#stop").click();
  await page.locator("#agenda-input").fill("00:01 Úvod\n00:02 Café");
  await page.locator("#agenda-input").blur();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('20px "Agenda Pixels"')), true);
  assert.equal(await page.locator("#agenda-total").textContent(), "TOTAL 00:03");
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    // Narrow screens stack agenda and controls with normal vertical scrolling.
    await assertFitsViewport(page, { verticalScroll: viewport.width <= 700 });
  }
  await page.locator("#mute").click();
  await page.locator("#start").click();
  await page.waitForFunction(() => document.getElementById("timer-face").dataset.state === "finished");
  await page.locator("#agenda-next").click();
  assert.equal(await page.locator("#timer-display").textContent(), "00:02");
  assert.equal(await page.locator("#agenda-next").isEnabled(), true);
  assert.deepEqual(errors, []);
});
