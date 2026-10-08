import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createAppServer } from "../../server.js";

function waveFile() {
  const rate = 8000,
    samples = rate * 3;
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
  for (let i = 0; i < samples; i++)
    file.writeInt16LE(
      Math.sin((i * 2 * Math.PI * 440) / rate) * 5000,
      44 + i * 2,
    );
  return file;
}

test("instrument interface works in Chromium without external services", async (t) => {
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

  async function open(
    testContext,
    { mobile = false, reducedMotion = "no-preference" } = {},
  ) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      reducedMotion,
    });
    testContext.after(() => context.close());
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ||
      /^(blob:|data:)/.test(route.request().url())
        ? route.continue()
        : route.abort(),
    );
    await context.addInitScript(() => {
      // Advance deadlines deterministically while leaving real media decoding/playback intact.
      window.__timeOffset = 0;
      Date.now = () => 1_000_000 + window.__timeOffset;
      window.__audiblePlays = 0;
      const NativeAudio = window.Audio;
      window.Audio = function (...args) {
        const audio = new NativeAudio(...args);
        window.__alarmAudio = audio;
        const play = audio.play.bind(audio);
        audio.play = () => {
          if (!audio.muted && audio.volume > 0) window.__audiblePlays++;
          return play();
        };
        return audio;
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
        errors.push(`External request: ${request.url()}`);
    });
    await page.goto(base);
    await page.waitForFunction(() => window.__alarmAudio);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors };
  }
  async function setTime(page, time) {
    await page
      .getByRole("textbox", { name: "Duration, minutes and seconds" })
      .fill(time);
    await page.locator("#duration-input").press("Enter");
    await page.locator("#duration-input").blur();
  }
  async function advance(page, milliseconds) {
    await page.evaluate((ms) => {
      window.__timeOffset += ms;
    }, milliseconds);
  }
  async function waitState(page, state) {
    await page.waitForFunction(
      (value) => document.getElementById("timer-face").dataset.state === value,
      state,
    );
  }
  async function screenshot(page, name) {
    if (!process.env.SCREENSHOT_DIR) return;
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/${name}.png`,
      fullPage: true,
    });
  }

  await t.test(
    "first-use values, masked typing, paste, validation and fixed geometry",
    async (t) => {
      const { page, errors } = await open(t);
      assert.equal(await page.locator("#timer-display").textContent(), "00:00");
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      assert.equal(await page.locator("#volume").inputValue(), "60");
      assert.equal(
        await page.locator("#sound-name").textContent(),
        "chicken orchestra",
      );
      assert.equal(await page.locator("#start").isDisabled(), true);
      const input = page.locator("#duration-input");
      await input.focus();
      await input.press("ControlOrMeta+a");
      await input.pressSequentially("2500");
      assert.equal(await input.inputValue(), "25:00");
      await input.press("Enter");
      const box = await page.locator("#time-field").boundingBox();
      await input.press("ControlOrMeta+a");
      await input.press("Backspace");
      assert.equal(await input.inputValue(), "__:__");
      await input.press("Enter");
      assert.equal(await page.locator("#duration-error").isVisible(), true);
      await input.fill("00:90");
      await input.press("Space");
      assert.equal(
        await page.locator("#timer-face").getAttribute("data-state"),
        "idle",
      );
      assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
      await input.evaluate((element) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "2500");
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await input.press("Enter");
      assert.equal(await input.inputValue(), "25:00");
      assert.deepEqual(await page.locator("#time-field").boundingBox(), box);
      await input.blur();
      await screenshot(page, "dark");
      await page.getByRole("button", { name: "Light", exact: true }).click();
      await screenshot(page, "light");
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "Stop preserves the remainder and unchanged editing preserves Reset's original value",
    async (t) => {
      const { page, errors } = await open(t);
      await setTime(page, "25:00");
      await page.locator("#start").click();
      await advance(page, 746_250);
      await page.locator("#stop").click();
      assert.equal(await page.locator("#duration-input").inputValue(), "12:34");
      await page.locator("#duration-input").focus();
      await page.locator("#duration-input").blur();
      await page.locator("#start").click();
      await advance(page, 1000);
      await page.locator("#pause").click();
      assert.equal(await page.locator("#timer-display").textContent(), "12:33");
      await page.locator("#reset").click();
      assert.equal(await page.locator("#timer-display").textContent(), "25:00");
      assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "display single clicks pause/resume and double clicks reset without a delayed toggle",
    async (t) => {
      const { page, errors } = await open(t);
      await setTime(page, "25:00");
      await page.locator("#start").click();
      await advance(page, 30_000);
      await page
        .getByRole("button", { name: "Pause timer", exact: true })
        .click();
      await waitState(page, "paused");
      await page
        .getByRole("button", { name: "Resume timer", exact: true })
        .dblclick();
      await waitState(page, "running");
      await page
        .getByRole("button", { name: "Pause timer", exact: true })
        .dblclick();
      await waitState(page, "idle");
      await page.waitForTimeout(450);
      assert.equal(await page.locator("#timer-display").textContent(), "25:00");
      assert.equal(
        await page.locator("#timer-face").getAttribute("data-state"),
        "idle",
      );
      assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "global Space and Escape work from editor, volume, menu and theme focus",
    async (t) => {
      const { page, errors } = await open(t);
      await page.locator("#duration-input").fill("00:30");
      await page.locator("#duration-input").press("Space");
      await waitState(page, "running");
      await page.locator("#volume").focus();
      await page.keyboard.press("Space");
      await waitState(page, "paused");
      await page.locator("#sound-selector").click();
      await page.keyboard.press("Space");
      await waitState(page, "running");
      await page.locator("#theme-light").focus();
      await page.keyboard.down("Space");
      await page.keyboard.down("Space");
      await page.keyboard.up("Space");
      await waitState(page, "paused");
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#timer-display").textContent(), "00:00");
      assert.equal(await page.locator("#sound-menu").isVisible(), false);
      assert.equal(await page.locator("#reset").isDisabled(), true);
      assert.equal(await page.evaluate(() => window.__alarmAudio.paused), true);
      await page.locator("#duration-input").fill("__:__");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#duration-input").inputValue(), "00:00");
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "final-ten-second warning, paused warning, light theme and real MP3 alarm once",
    async (t) => {
      const { page, errors } = await open(t);
      await setTime(page, "00:11");
      await page.locator("#start").click();
      assert.equal(
        await page
          .locator("#timer-face")
          .evaluate((el) => el.classList.contains("warning")),
        false,
      );
      await advance(page, 1000);
      await page.waitForFunction(() =>
        document.getElementById("timer-face").classList.contains("pulsing"),
      );
      await page.locator("#pause").click();
      assert.equal(
        await page
          .locator("#timer-face")
          .evaluate((el) => el.classList.contains("warning")),
        true,
      );
      assert.equal(
        await page
          .locator("#timer-face")
          .evaluate((el) => el.classList.contains("pulsing")),
        false,
      );
      await page.locator("#theme-light").click();
      assert.equal(await page.locator("#timer-display").textContent(), "00:10");
      await screenshot(page, "paused-light");
      await page.locator("#start").click();
      await advance(page, 1000);
      await page.waitForFunction(
        () => document.getElementById("timer-display").textContent === "00:09",
      );
      await screenshot(page, "warning-light");
      await page.locator("#theme-dark").click();
      await screenshot(page, "warning-dark");
      await advance(page, 9000);
      await waitState(page, "finished");
      await page.waitForFunction(
        () =>
          !window.__alarmAudio.paused && window.__alarmAudio.currentTime > 0,
      );
      assert.match(
        await page.evaluate(() => window.__alarmAudio.currentSrc),
        /screaming-chickens\.mp3$/,
      );
      assert.equal(await page.evaluate(() => window.__alarmAudio.volume), 0.6);
      assert.equal(await page.evaluate(() => window.__audiblePlays), 1);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__audiblePlays), 1);
      await page.locator("#mute").click();
      assert.equal(await page.evaluate(() => window.__alarmAudio.paused), true);
      await page.locator("#stop").click();
      assert.equal(
        await page
          .locator("#timer-face")
          .evaluate((el) => el.classList.contains("warning")),
        false,
      );
      await page.locator("#reset").click();
      assert.equal(await page.locator("#timer-display").textContent(), "00:11");
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "mute, zero volume and preferences persist without changing the countdown",
    async (t) => {
      const { page, errors } = await open(t);
      await page.locator("#volume").fill("35");
      await page.locator("#mute").click();
      assert.equal(await page.locator("#volume-value").textContent(), "Muted");
      await setTime(page, "00:01");
      await page.locator("#start").click();
      await advance(page, 1000);
      await waitState(page, "finished");
      assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
      await page.locator("#mute").click();
      assert.equal(await page.locator("#volume").inputValue(), "35");
      await page.locator("#volume").fill("0");
      await page.locator("#mute").click();
      assert.equal(await page.locator("#volume").inputValue(), "35");
      await page.locator("#theme-light").click();
      await page.reload();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "light",
      );
      assert.equal(await page.locator("#volume").inputValue(), "35");
      assert.equal(
        await page.locator("#mute").getAttribute("aria-pressed"),
        "false",
      );
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "valid custom audio replaces the sound during a run; invalid and cancelled choices preserve it",
    async (t) => {
      const { page, errors } = await open(t);
      await setTime(page, "00:30");
      await page.locator("#start").click();
      const name = "my-very-long-custom-countdown-alarm.wav";
      await page
        .locator("#audio-file")
        .setInputFiles({ name, mimeType: "audio/wav", buffer: waveFile() });
      await page.waitForFunction(() =>
        document.getElementById("sound-selector").title.endsWith(".wav"),
      );
      assert.equal(
        await page.locator("#sound-selector").getAttribute("title"),
        name,
      );
      assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
      const source = await page.evaluate(() => window.__alarmAudio.src);
      await page
        .locator("#audio-file")
        .setInputFiles({
          name: "invalid.mp3",
          mimeType: "audio/mpeg",
          buffer: Buffer.from("not audio"),
        });
      await page.waitForFunction(() =>
        document
          .getElementById("audio-message")
          .textContent.includes("cannot be played"),
      );
      assert.equal(await page.evaluate(() => window.__alarmAudio.src), source);
      await page.locator("#audio-file").setInputFiles([]);
      assert.equal(await page.evaluate(() => window.__alarmAudio.src), source);
      assert.equal(
        await page.locator("#timer-face").getAttribute("data-state"),
        "running",
      );
      await advance(page, 30_000);
      await waitState(page, "finished");
      await page.waitForFunction(
        () =>
          !window.__alarmAudio.paused && window.__alarmAudio.currentTime > 0,
      );
      assert.equal(
        await page.evaluate(() => window.__alarmAudio.currentSrc),
        source,
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => window.__alarmAudio.paused), true);
      await page.locator("#sound-selector").click();
      await page
        .getByRole("menuitemradio", { name: "chicken orchestra", exact: true })
        .click();
      assert.match(
        await page.evaluate(() => window.__alarmAudio.src),
        /screaming-chickens\.mp3$/,
      );
      await page.locator("#sound-selector").click();
      await page.getByRole("menuitemradio", { name, exact: true }).click();
      assert.equal(await page.evaluate(() => window.__alarmAudio.src), source);
      await page.reload();
      assert.equal(
        await page.locator("#sound-name").textContent(),
        "chicken orchestra",
      );
      assert.match(
        await page.locator("#audio-message").textContent(),
        /Custom sound unavailable/,
      );
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "Stop, Reset and Escape at the deadline suppress a pending completion alarm",
    async (t) => {
      const { page, errors } = await open(t);
      for (const action of ["stop", "reset", "escape"]) {
        await setTime(page, "00:01");
        await page.locator("#start").click();
        await page.evaluate((action) => {
          window.__timeOffset += 1000;
          if (action === "escape")
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
          else document.getElementById(action).click();
        }, action);
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
        assert.equal(
          await page.locator("#timer-face").getAttribute("data-state"),
          "idle",
        );
      }
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "wide-screen digits fit their paint bounds and the centered dock stays compact",
    async (t) => {
      const { page, errors } = await open(t);
      for (const viewport of [
        { width: 1920, height: 1080 },
        { width: 2551, height: 1430 },
      ]) {
        await page.setViewportSize(viewport);
        for (const value of ["00:00", "11:11", "99:59"]) {
          await setTime(page, value);
          const ink = await page.locator("#timer-display").evaluate((el) => {
            const style = getComputedStyle(el);
            const context = document.createElement("canvas").getContext("2d");
            context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const metrics = context.measureText(el.textContent);
            const range = new Range();
            range.selectNodeContents(el);
            const baseline =
              range.getBoundingClientRect().top + metrics.fontBoundingBoxAscent;
            const box = el.getBoundingClientRect();
            return {
              top: baseline - metrics.actualBoundingBoxAscent,
              bottom: baseline + metrics.actualBoundingBoxDescent,
              paintTop: box.top,
              paintBottom: box.bottom,
            };
          });
          assert.ok(ink.top >= ink.paintTop, `${value} is clipped at the top`);
          assert.ok(
            ink.bottom < ink.paintBottom,
            `${value} is clipped at the bottom`,
          );
        }
        const dock = await page.locator("#control-dock").boundingBox();
        assert.ok(dock.width <= 1180);
        assert.ok(Math.abs(dock.x + dock.width / 2 - viewport.width / 2) < 1);
        const groups = await page
          .locator(".dock-controls > div")
          .evaluateAll((elements) =>
            elements.map((el) => ({
              left: el.getBoundingClientRect().left,
              right: el.getBoundingClientRect().right,
            })),
          );
        for (let i = 1; i < groups.length; i++) {
          const gap = groups[i].left - groups[i - 1].right;
          assert.ok(gap >= 0 && gap <= 17, `Unexpected dock gap: ${gap}`);
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await screenshot(page, `wide-${viewport.width}`);
      }
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "warning pulses a separate glow over the original digits every second in both themes",
    async (t) => {
      const { page, errors } = await open(t);
      for (const theme of ["dark", "light"]) {
        await page.locator(`#theme-${theme}`).click();
        await setTime(page, "00:11");
        const base = await page
          .locator("#timer-display")
          .evaluate((el) => getComputedStyle(el).backgroundImage);
        assert.equal(
          await page
            .locator("#timer-glow")
            .evaluate((el) => getComputedStyle(el).opacity),
          "0",
        );
        await page.locator("#start").click();
        await advance(page, 1000);
        await page.waitForFunction(() =>
          document.getElementById("timer-face").classList.contains("pulsing"),
        );
        const phases = await page.locator("#timer-glow").evaluate((el) => {
          const animation = el.getAnimations()[0];
          animation.pause();
          const samples = [0, 600, 1000].map((time) => {
            animation.currentTime = time;
            const style = getComputedStyle(el);
            return { opacity: Number(style.opacity), filter: style.filter };
          });
          return { duration: animation.effect.getTiming().duration, samples };
        });
        assert.equal(phases.duration, 1000);
        assert.ok(phases.samples[0].opacity > 0.8);
        assert.ok(phases.samples[1].opacity < 0.25);
        assert.equal(phases.samples[0].opacity, phases.samples[2].opacity);
        assert.match(phases.samples[0].filter, /drop-shadow/);
        assert.equal(
          await page
            .locator("#timer-display")
            .evaluate((el) => getComputedStyle(el).backgroundImage),
          base,
        );
        assert.equal(
          await page
            .locator("#timer-display")
            .evaluate((el) => getComputedStyle(el).opacity),
          "1",
        );
        assert.equal(
          await page.locator("#timer-glow").getAttribute("aria-hidden"),
          "true",
        );
        assert.equal(await page.locator("#timer-glow").textContent(), "00:10");
        assert.deepEqual(
          await page.locator("#timer-glow").boundingBox(),
          await page.locator("#timer-display").boundingBox(),
        );
        await page.locator("#pause").click();
        assert.equal(
          await page
            .locator("#timer-glow")
            .evaluate((el) => el.getAnimations().length),
          0,
        );
        assert.ok(
          Number(
            await page
              .locator("#timer-glow")
              .evaluate((el) => getComputedStyle(el).opacity),
          ) > 0.8,
        );
        await page.locator("#stop").click();
      }
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "full-screen idle fade leaves faint shortcuts and restores controls for pointer and keyboard use",
    async (t) => {
      const { page, errors } = await open(t);
      await setTime(page, "00:30");
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.documentElement.requestFullscreen());
      await page.waitForFunction(() => document.fullscreenElement);
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".dock-controls")).opacity ===
          "0",
      );
      assert.equal(
        await page
          .locator("#control-dock")
          .evaluate((el) => getComputedStyle(el, "::before").opacity),
        "0",
      );
      const hintOpacity = Number(
        await page
          .locator(".keyboard-hint")
          .evaluate((el) => getComputedStyle(el).opacity),
      );
      assert.ok(hintOpacity > 0 && hintOpacity <= 0.25);
      await screenshot(page, "fullscreen-idle");
      await page.keyboard.press("Space");
      await waitState(page, "running");
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.classList.contains("fullscreen-idle")),
        true,
      );
      await page.keyboard.press("Space");
      await waitState(page, "paused");
      await page.mouse.move(200, 200);
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".dock-controls")).opacity ===
          "1",
      );
      await page.waitForFunction(() =>
        document.body.classList.contains("fullscreen-idle"),
      );
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(3300);
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.classList.contains("fullscreen-idle")),
        false,
      );
      await page.locator("#sound-selector").click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(3300);
      assert.equal(await page.locator("#sound-menu").isVisible(), true);
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.classList.contains("fullscreen-idle")),
        false,
      );
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => !document.fullscreenElement);
      await page.waitForTimeout(3300);
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.classList.contains("fullscreen-idle")),
        false,
      );
      assert.equal(
        await page
          .locator(".keyboard-hint")
          .evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      assert.deepEqual(errors, []);
    },
  );

  await t.test(
    "reduced motion and responsive dock keep the timer and controls visible",
    async (t) => {
      const { page, errors } = await open(t, {
        mobile: true,
        reducedMotion: "reduce",
      });
      await setTime(page, "00:09");
      await page.locator("#start").click();
      assert.equal(
        await page
          .locator("#timer-glow")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const timerBox = await page.locator("#timer-face").boundingBox();
      const dockBox = await page.locator("#control-dock").boundingBox();
      assert.ok(timerBox.y + timerBox.height < dockBox.y);
      assert.ok(dockBox.y + dockBox.height <= 844);
      for (const selector of [
        "#start",
        "#pause",
        "#stop",
        "#reset",
        "#mute",
        "#sound-selector",
        "#theme-dark",
      ]) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.height >= 44);
        assert.ok(box.width >= 44);
      }
      await screenshot(page, "mobile-dark");
      await page.locator("#theme-light").click();
      await screenshot(page, "mobile-light");
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 768, height: 1024 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.setViewportSize({ width: 320, height: 568 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
    },
  );
});
