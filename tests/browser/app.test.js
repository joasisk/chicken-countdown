import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createAppServer } from "../../server.js";

function waveFile() {
  const rate = 8000;
  const samples = rate * 3;
  const file = Buffer.alloc(44 + samples * 2);
  file.write("RIFF", 0);
  file.writeUInt32LE(file.length - 8, 4);
  file.write("WAVEfmt ", 8);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(rate, 24);
  file.writeUInt32LE(rate * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36);
  file.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    file.writeInt16LE(
      Math.sin((index * 2 * Math.PI * 440) / rate) * 5000,
      44 + index * 2,
    );
  return file;
}

test("countdown works in a real browser without external services", async (t) => {
  const executablePath =
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function open({ mobile = false } = {}) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 1100 },
    });
    t.after(() => context.close());
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ||
      /^(blob:|data:)/.test(route.request().url())
        ? route.continue()
        : route.abort(),
    );
    // Observe real browser audio without replacing decoding or playback.
    await context.addInitScript(() => {
      window.__bellNotes = 0;
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        createOscillator() {
          const oscillator = super.createOscillator();
          const start = oscillator.start.bind(oscillator);
          oscillator.start = (...args) => {
            window.__bellNotes++;
            return start(...args);
          };
          return oscillator;
        }
      };
      const NativeAudio = window.Audio;
      window.Audio = function (...args) {
        window.__alarmAudio = new NativeAudio(...args);
        return window.__alarmAudio;
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        !request.url().startsWith(base) &&
        !/^(blob:|data:)/.test(request.url())
      )
        errors.push(`Unexpected external request: ${request.url()}`);
    });
    await page.goto(base);
    await page.waitForFunction(() => window.__alarmAudio);
    return { page, errors };
  }

  async function setSeconds(page, seconds) {
    await page.locator("#hours").fill("0");
    await page.locator("#minutes").fill("0");
    await page.locator("#seconds").fill(String(seconds));
    await page.getByRole("button", { name: "Apply custom time" }).click();
  }

  async function selectCustom(page) {
    await page.getByLabel("Custom sound", { exact: true }).check();
    await page
      .locator("#audio-file")
      .setInputFiles({
        name: "test-alarm.wav",
        mimeType: "audio/wav",
        buffer: waveFile(),
      });
  }

  await t.test(
    "presets, custom durations, zero validation and custom-file prerequisite",
    async () => {
      const { page, errors } = await open();
      await page.getByRole("button", { name: "15 min", exact: true }).click();
      assert.equal(await page.locator("#display-minutes").textContent(), "15");
      await page.locator("#hours").fill("1");
      await page.locator("#minutes").fill("2");
      await page.locator("#seconds").fill("3");
      await page.getByRole("button", { name: "Apply custom time" }).click();
      assert.equal(await page.locator("#display-hours").textContent(), "01");
      assert.equal(await page.locator("#display-minutes").textContent(), "02");
      assert.equal(await page.locator("#display-seconds").textContent(), "03");
      await setSeconds(page, 0);
      assert.match(
        await page.locator("#duration-error").textContent(),
        /longer than zero/,
      );
      assert.equal(await page.locator("#display-hours").textContent(), "01");
      await page.getByLabel("Custom sound", { exact: true }).check();
      await page.locator("#start").click();
      assert.equal(
        await page.locator("#status-label").textContent(),
        "READY WHEN YOU ARE",
      );
      assert.match(
        await page.locator("#sound-status").textContent(),
        /Choose an audio file first/,
      );
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "pause, resume and actual bundled MP3 playback at zero, stop and reset",
    async () => {
      const { page, errors } = await open();
      await setSeconds(page, 2);
      await page.locator("#start").click();
      assert.equal(await page.locator("#minutes").isDisabled(), true);
      await page.getByRole("button", { name: "Pause countdown" }).click();
      const paused = await page.locator("#display-seconds").textContent();
      await page.waitForTimeout(1100);
      assert.equal(
        await page.locator("#display-seconds").textContent(),
        paused,
      );
      assert.equal(
        await page.locator("#status-label").textContent(),
        "TAKE A BREATHER",
      );
      await page.getByRole("button", { name: "Resume countdown" }).click();
      await page.waitForFunction(
        () =>
          document.getElementById("status-label").textContent ===
            "THE BIG FINISH" &&
          !window.__alarmAudio.paused &&
          window.__alarmAudio.currentTime > 0,
      );
      assert.equal(await page.locator("#display-seconds").textContent(), "00");
      assert.equal(
        await page.locator(".progress-track").getAttribute("aria-valuenow"),
        "100",
      );
      assert.equal(await page.locator("#finish-notice").isVisible(), true);
      const sound = await page.evaluate(() => ({
        src: window.__alarmAudio.currentSrc,
        volume: window.__alarmAudio.volume,
        duration: window.__alarmAudio.duration,
      }));
      assert.match(sound.src, /\/sounds\/screaming-chickens\.mp3$/);
      assert.equal(sound.volume, 0.8);
      assert.ok(sound.duration > 10 && sound.duration < 12);
      await page.getByRole("button", { name: "Stop sound" }).click();
      assert.equal(await page.evaluate(() => window.__alarmAudio.paused), true);
      assert.equal(
        await page.getByRole("button", { name: "Sound stopped" }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      assert.equal(await page.locator("#display-seconds").textContent(), "02");
      assert.equal(await page.locator("#finish-notice").isVisible(), false);
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "custom file plays at zero and switching sounds preserves the selection",
    async () => {
      const { page, errors } = await open();
      await selectCustom(page);
      const customURL = await page.evaluate(() => window.__alarmAudio.src);
      assert.match(customURL, /^blob:/);
      await page.getByLabel("Chicken alarm", { exact: true }).check();
      assert.match(
        await page.evaluate(() => window.__alarmAudio.src),
        /screaming-chickens\.mp3$/,
      );
      await page.getByLabel("Custom sound", { exact: true }).check();
      assert.equal(
        await page.evaluate(() => window.__alarmAudio.src),
        customURL,
      );
      assert.equal(
        await page.locator("#file-name").textContent(),
        "test-alarm.wav",
      );
      await setSeconds(page, 1);
      await page.locator("#start").click();
      await page.waitForFunction(
        () =>
          document.getElementById("status-label").textContent ===
            "THE BIG FINISH" &&
          !window.__alarmAudio.paused &&
          window.__alarmAudio.currentTime > 0,
      );
      assert.equal(
        await page.evaluate(() => window.__alarmAudio.currentSrc),
        customURL,
      );
      await page.locator("#stop-alarm").click();
      assert.equal(await page.evaluate(() => window.__alarmAudio.paused), true);
      assert.equal(
        await page.evaluate(() => window.__alarmAudio.currentTime),
        0,
      );
      await page.reload();
      assert.equal(
        await page.getByLabel("Chicken alarm", { exact: true }).isChecked(),
        true,
      );
      assert.match(
        await page.evaluate(() => window.__alarmAudio.src),
        /screaming-chickens\.mp3$/,
      );
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "invalid audio produces a backup bell that stops on request",
    async () => {
      const { page, errors } = await open();
      await page.getByLabel("Custom sound", { exact: true }).check();
      await page
        .locator("#audio-file")
        .setInputFiles({
          name: "invalid.mp3",
          mimeType: "audio/mpeg",
          buffer: Buffer.from("not audio"),
        });
      await setSeconds(page, 1);
      await page.locator("#start").click();
      await page.waitForFunction(() =>
        document
          .getElementById("sound-status")
          .textContent.includes("Playing the backup bell"),
      );
      assert.match(
        await page.locator("#sound-status").textContent(),
        /can’t be played/,
      );
      assert.ok(await page.evaluate(() => window.__bellNotes >= 3));
      await page.locator("#stop-alarm").click();
      const notes = await page.evaluate(() => window.__bellNotes);
      await page.waitForTimeout(2200);
      assert.equal(await page.evaluate(() => window.__bellNotes), notes);
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "sound tests, volume, natural sample completion and mobile layout",
    async () => {
      const { page, errors } = await open({ mobile: true });
      await page.locator("#volume").fill("40");
      assert.equal(await page.locator("#volume-value").textContent(), "40%");
      await page.getByRole("button", { name: "Test sound" }).click();
      await page.waitForFunction(
        () =>
          !window.__alarmAudio.paused && window.__alarmAudio.currentTime > 0,
      );
      assert.equal(await page.evaluate(() => window.__alarmAudio.volume), 0.4);
      await page.getByRole("button", { name: "Stop test" }).click();
      assert.equal(
        await page.locator("#sound-status").textContent(),
        "Sound test stopped.",
      );
      await selectCustom(page);
      await page.getByRole("button", { name: "Test sound" }).click();
      await page.waitForFunction(
        () =>
          document.getElementById("sound-status").textContent ===
          "Sound test complete.",
      );
      assert.equal(
        await page.getByRole("button", { name: "Test sound" }).isVisible(),
        true,
      );
      await page.getByLabel("Chicken alarm", { exact: true }).check();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      if (process.env.SCREENSHOT_DIR) {
        await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: `${process.env.SCREENSHOT_DIR}/mobile.png`,
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 1280, height: 1100 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      if (process.env.SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.SCREENSHOT_DIR}/desktop.png`,
          fullPage: true,
        });
      assert.deepEqual(errors, []);
    },
  );
});
