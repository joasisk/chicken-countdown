import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

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
