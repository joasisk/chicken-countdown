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
      animations: "disabled",
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
      assert.equal(await page.locator("#audio-message").isVisible(), false);
      assert.equal(await page.locator("#audio-message").textContent(), "");
      assert.equal(
        await page.locator("#default-sound").getAttribute("aria-checked"),
        "true",
      );
      assert.equal(await page.locator("#custom-sound").isVisible(), false);
      assert.match(
        await page.evaluate(() => window.__alarmAudio.src),
        /screaming-chickens\.mp3$/,
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
      await page.locator("#audio-file").setInputFiles({
        name: "invalid.mp3",
        mimeType: "audio/mpeg",
        buffer: Buffer.from("not audio"),
      });
      await page.waitForFunction(() =>
        document
          .getElementById("audio-message")
          .textContent.includes("cannot be played"),
      );
      // Reproduce entering full screen with a message, a parked pointer, and keyboard focus.
      await page.locator("#theme-light").focus();
      const button = await page.locator("#theme-light").boundingBox();
      await page.mouse.move(
        button.x + button.width / 2,
        button.y + button.height / 2,
      );
      await page.evaluate(() => document.documentElement.requestFullscreen());
      await page.waitForFunction(() => document.fullscreenElement);
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".dock-controls")).opacity ===
          "0",
      );
      assert.equal(await page.locator("#audio-message").isVisible(), false);
      const hint = await page.locator(".keyboard-hint").boundingBox();
      const dock = await page.locator("#control-dock").boundingBox();
      assert.ok(
        Math.abs(hint.x + hint.width / 2 - (dock.x + dock.width / 2)) < 1,
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
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".dock-controls")).opacity ===
          "1",
      );
      await page.waitForTimeout(3300);
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.classList.contains("fullscreen-idle")),
        true,
      );
      await page.locator("#volume").focus();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".dock-controls")).opacity ===
          "1",
      );
      await page.waitForFunction(() =>
        document.body.classList.contains("fullscreen-idle"),
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.locator("#volume").inputValue(), "61");
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".dock-controls")).opacity ===
          "1",
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

  async function setAgenda(page, text) {
    if (!(await page.locator('#agenda-panel').isVisible())) await page.locator('#agenda-toggle').click();
    await page.locator('#stop').click();
    await page.locator('#agenda-input').fill(text);
    await page.locator('#agenda-input').blur();
  }
  async function assertTransport(page, previous, eject, next) {
    for (const [action, enabled] of Object.entries({ previous, eject, next }))
      assert.equal(await page.locator(`#agenda-${action}`).isEnabled(), enabled, action);
  }

  await t.test('agenda opens locked, Stop unlocks, sample commits, and show/hide preserves timing', async (t) => {
    const { page, errors } = await open(t);
    const input = page.locator('#agenda-input');
    assert.equal(await page.locator('#agenda-panel').isVisible(), false);
    await page.locator('#agenda-toggle').click();
    assert.equal(await input.getAttribute('readonly'), '');
    assert.equal(await page.locator('#stop').isEnabled(), true);
    assert.equal(await page.locator('#agenda-hint').textContent(), 'PRESS STOP TO EDIT');
    await assertTransport(page, true, true, true);
    await page.locator('#stop').click();
    assert.equal(await input.evaluate(el => el === document.activeElement), true);
    await input.fill('05:00 Welcome\n10:00 Discussion\n08:00 Decisions\n02:00 Wrap-up');
    await input.blur();
    assert.equal(await page.locator('#timer-display').textContent(), '05:00');
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 25:00');
    assert.match(await page.locator('#agenda-selection').textContent(), /Selected item 1: Welcome/);
    assert.equal(await input.inputValue(), '05:00 Welcome\n10:00 Discussion\n08:00 Decisions\n02:00 Wrap-up');
    await screenshot(page, 'agenda-dark');
    await page.locator('#theme-light').click();
    const headingPng = await page.locator('#agenda-heading').screenshot();
    const whitePixels = await page.evaluate(async dataUrl => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) count++;
      return count;
    }, `data:image/png;base64,${headingPng.toString('base64')}`);
    assert.ok(whitePixels > 30, 'white pixel text remains painted after theme switching');
    await screenshot(page, 'agenda-light');
    assert.equal(await input.evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
    await page.locator('#start').click();
    assert.equal(await input.evaluate(el => el.readOnly), true);
    await advance(page, 30000);
    await page.locator('#agenda-toggle').click();
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'running');
    assert.equal(await page.locator('#timer-display').textContent(), '04:30');
    await page.locator('#agenda-toggle').click();
    await page.locator('#pause').click();
    assert.equal(await input.evaluate(el => el.readOnly), true);
    await assertTransport(page, true, true, true);
    await page.locator('#stop').click();
    await input.blur();
    assert.equal(await page.locator('#timer-display').textContent(), '04:30');
    await page.locator('#reset').click();
    assert.equal(await page.locator('#timer-display').textContent(), '05:00');
    assert.equal(await input.evaluate(el => el.readOnly), true);
    assert.deepEqual(errors, []);
  });

  await t.test('natural expiry and repeated navigation acknowledge sound, and Eject clears silently', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '00:01 Welcome\n00:02 Discussion\n00:03 Wrap-up');
    await page.locator('#start').click();
    await advance(page, 1000);
    await waitState(page, 'overtime');
    await page.waitForFunction(() => !window.__alarmAudio.paused && window.__alarmAudio.currentTime > 0);
    await assertTransport(page, true, false, true);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:02');
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'idle');
    assert.equal(await page.evaluate(() => window.__alarmAudio.paused), true);
    await assertTransport(page, true, true, true);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:03');
    await page.locator('#agenda-previous').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:02');
    await page.locator('#mute').click();
    await page.locator('#start').click();
    await advance(page, 2000);
    await waitState(page, 'overtime');
    await assertTransport(page, true, false, true);
    await page.locator('#agenda-previous').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:01');
    await assertTransport(page, true, true, true);
    for (const seconds of [1, 2]) {
      await page.locator('#start').click();
      await advance(page, seconds * 1000);
      await waitState(page, 'overtime');
      await page.locator('#agenda-next').click();
      await assertTransport(page, true, true, true);
    }
    await page.locator('#start').click();
    await advance(page, 3000);
    await waitState(page, 'overtime');
    await assertTransport(page, true, false, true);
    await screenshot(page, 'agenda-expired');
    await page.locator('#pause').click();
    await page.locator('#agenda-eject').click();
    assert.equal(await page.locator('#agenda-panel').isVisible(), true);
    assert.equal(await page.locator('#agenda-input').inputValue(), '');
    assert.equal(await page.locator('#agenda-input').evaluate(el => el.readOnly), true);
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 00:00');
    assert.equal(await page.locator('#timer-display').textContent(), '00:00');
    await assertTransport(page, true, true, true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#timer-display').textContent(), '00:00');
    assert.equal(await page.evaluate(() => window.__audiblePlays), 1);
    assert.deepEqual(errors, []);
  });

  await t.test('navigation can end items early and Eject is blocked only while running', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '05:00 First\n10:00 Second\n03:00 Last');
    await assertTransport(page, true, true, true);
    await page.locator('#agenda-previous').click();
    assert.equal(await page.locator('#timer-display').textContent(), '05:00');
    await page.locator('#start').click();
    await advance(page, 30000);
    await assertTransport(page, true, false, true);
    await page.locator('#agenda-eject').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 18:00');
    await waitState(page, 'running');
    await page.locator('#agenda-next').click();
    await waitState(page, 'idle');
    assert.equal(await page.locator('#timer-display').textContent(), '14:30');
    await advance(page, 600000);
    await waitState(page, 'idle');
    assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
    await page.locator('#start').click();
    await page.locator('#pause').click();
    await assertTransport(page, true, true, true);
    await page.locator('#agenda-previous').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:30');
    await page.locator('#start').click();
    await page.locator('#pause').click();
    await page.locator('#agenda-eject').click();
    await waitState(page, 'idle');
    assert.equal(await page.locator('#agenda-input').inputValue(), '');
    assert.equal(await page.locator('#timer-display').textContent(), '00:00');
    await assertTransport(page, true, true, true);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:00');
    assert.deepEqual(errors, []);
  });

  await t.test('invalid drafts retain saved entries, survive hiding, block Start, and cancel with Reset/Escape', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '05:00 Úvod — café!\n10:00 Discussion  & decisions');
    const input = page.locator('#agenda-input');
    await input.fill('05:00 Valid\n10:99 Bad seconds');
    await input.blur();
    assert.match(await page.locator('#agenda-error').textContent(), /Line 2/);
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 15:00');
    assert.equal(await page.locator('#timer-display').textContent(), '05:00');
    await page.locator('#agenda-toggle').click();
    assert.equal(await page.locator('#agenda-panel').isVisible(), false);
    await page.locator('#start').click();
    assert.equal(await page.locator('#agenda-panel').isVisible(), true);
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'idle');
    assert.equal(await input.inputValue(), '05:00 Valid\n10:99 Bad seconds');
    await page.locator('#reset').click();
    assert.equal(await input.inputValue(), '05:00 Úvod — café!\n10:00 Discussion  & decisions');
    assert.equal(await input.evaluate(el => el.readOnly), true);
    assert.equal(await page.locator('#agenda-error').isVisible(), false);
    await page.locator('#stop').click();
    await input.fill('99:00 Long\n36:00 Longer');
    await input.blur();
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 135:00');
    await input.fill('unfinished');
    await input.press('Escape');
    assert.equal(await input.inputValue(), '99:00 Long\n36:00 Longer');
    assert.equal(await page.locator('#timer-display').textContent(), '00:00');
    assert.equal(await input.evaluate(el => el.readOnly), true);
    await assertTransport(page, true, true, true);
    await page.locator('#agenda-eject').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 00:00');
    await page.locator('#stop').click();
    await input.fill('');
    await input.blur();
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 00:00');
    assert.deepEqual(errors, []);
  });

  await t.test('Space types in the agenda while timer shortcuts work outside the text field', async (t) => {
    const { page, errors } = await open(t);
    await page.locator('#agenda-toggle').click();
    await page.locator('#stop').click();
    const input = page.locator('#agenda-input');
    await input.pressSequentially('00:01');
    await input.press('Space');
    await input.pressSequentially('Úvod');
    await input.press('Enter');
    await input.pressSequentially('00:02');
    await input.press('Space');
    await input.pressSequentially('Café');
    assert.equal(await input.inputValue(), '00:01 Úvod\n00:02 Café');
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'idle');
    assert.equal(await input.evaluate(el => el.readOnly), false);
    await input.press('ControlOrMeta+z');
    assert.notEqual(await input.inputValue(), '00:01 Úvod\n00:02 Café');
    await input.fill('00:01 Úvod\n00:02 Café');
    await input.press('Space');
    assert.equal(await input.inputValue(), '00:01 Úvod\n00:02 Café ');
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'idle');
    await input.press('Backspace');
    await page.locator('#start').click();
    await waitState(page, 'running');
    assert.equal(await input.evaluate(el => el.readOnly), true);
    await input.focus();
    await input.press('Space');
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'running');
    assert.equal(await input.inputValue(), '00:01 Úvod\n00:02 Café');
    await page.locator('#pause').click();
    await waitState(page, 'paused');
    await input.focus();
    await input.press('Space');
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'paused');
    await page.locator('#start').focus();
    await page.keyboard.press('Space');
    await waitState(page, 'running');
    await advance(page, 1000);
    await waitState(page, 'overtime');
    await page.locator('#agenda-next').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#timer-display').textContent(), '00:02');
    await assertTransport(page, true, true, true);
    await page.keyboard.press('Space');
    await waitState(page, 'running');
    await page.getByRole('button', { name: 'Pause timer', exact: true }).dblclick();
    await waitState(page, 'idle');
    assert.equal(await input.evaluate(el => el.readOnly), true);
    assert.equal(await page.locator('#timer-display').textContent(), '00:02');
    await page.locator('#stop').click();
    await input.fill('not committed');
    await page.keyboard.press('Escape');
    assert.equal(await input.inputValue(), '00:01 Úvod\n00:02 Café');
    assert.deepEqual(errors, []);
  });

  await t.test('overtime counts up, pauses precisely, alarms once, and reduces breaks on Next', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '01:00 Talk\n03:00 Next\n01:00 Coffee break\n02:00 Open discussion');
    await page.locator('#start').click();
    await advance(page, 75000);
    await waitState(page, 'overtime');
    assert.equal(await page.locator('#timer-display').textContent(), '00:15');
    assert.match(await page.locator('#status-label').textContent(), /^OVERTIME/);
    assert.match(await page.locator('#timer-display').getAttribute('aria-label'), /15 seconds overtime/);
    assert.equal(await page.title(), '+00:15 · Chicken Countdown');
    await page.waitForFunction(() => window.__audiblePlays === 1);
    await page.locator('#pause').click();
    await advance(page, 120000);
    await waitState(page, 'paused');
    assert.equal(await page.locator('#timer-display').textContent(), '00:15');
    await page.locator('#start').click();
    await advance(page, 5000);
    await page.waitForFunction(() => document.getElementById('timer-display').textContent === '00:20');
    assert.equal(await page.evaluate(() => window.__audiblePlays), 1);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '03:00');
    assert.match(await page.locator('#agenda-measure').textContent(), /00:40 Coffee break/);
    assert.match(await page.locator('#agenda-input').inputValue(), /01:00 Coffee break/);
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 07:00');
    await page.reload();
    await page.locator('#agenda-toggle').click();
    assert.match(await page.locator('#agenda-measure').textContent(), /00:40 Coffee break/);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:40');
    assert.deepEqual(errors, []);
  });

  await t.test('overtime label and transparent outlined digits appear without moving the layout', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '00:15 Talk\n01:00 Next');
    const geometry = () => page.evaluate(() => ['time-field', 'timer-display', 'agenda-panel', 'control-dock'].map(id => {
      const box = document.getElementById(id).getBoundingClientRect();
      return { id, x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
    }));
    for (const theme of ['dark', 'light']) {
      await page.locator(`#theme-${theme}`).click();
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await page.locator('#reset').click();
        await page.locator('#start').click();
        assert.equal(await page.locator('#overtime-label').isVisible(), false);
        const before = await geometry();
        await advance(page, 20000);
        await waitState(page, 'overtime');
        assert.equal(await page.locator('#overtime-label').isVisible(), true);
        assert.equal(await page.locator('#overtime-label').textContent(), 'OVERTIME');
        assert.deepEqual(await geometry(), before);
        const label = await page.locator('#overtime-label').boundingBox();
        const digits = await page.locator('#timer-display').boundingBox();
        assert.ok(label.y + label.height <= digits.y);
        const styles = await page.locator('#timer-display, #timer-glow').evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          return { background: style.backgroundImage, fill: style.webkitTextFillColor, stroke: style.webkitTextStrokeWidth,
            color: style.webkitTextStrokeColor, labelColor: getComputedStyle(document.getElementById('overtime-label')).color };
        }));
        for (const style of styles) {
          assert.equal(style.background, 'none');
          assert.equal(style.fill, 'rgba(0, 0, 0, 0)');
          assert.equal(style.stroke, '10px');
          assert.equal(style.color, style.labelColor);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (viewport.width === 1280) await screenshot(page, `overtime-outline-${theme}`);
        if (viewport.width === 390) await screenshot(page, `overtime-outline-mobile-${theme}`);
        await page.locator('#pause').click();
        assert.equal(await page.locator('#overtime-label').isVisible(), true);
        await page.locator('#stop').click();
        assert.equal(await page.locator('#overtime-label').isVisible(), true);
      }
    }
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#overtime-label').isVisible(), false);
    assert.equal(await page.locator('#timer-display').evaluate(el => getComputedStyle(el).webkitTextStrokeWidth), '0px');
    assert.deepEqual(errors, []);
  });

  await t.test('recognized breaks glow green while active and paused, including a green halo in overtime', async (t) => {
    for (const [theme, green] of [['dark', 'rgb(145, 237, 174)'], ['light', 'rgb(39, 136, 78)']]) {
      const { page, errors } = await open(t, { reducedMotion: 'reduce' });
      await page.locator(`#theme-${theme}`).click();
      await setAgenda(page, '00:20 Teraz KÁVA\n00:20 Next talk');
      const glow = () => page.locator('#timer-glow').evaluate(element => {
        const style = getComputedStyle(element);
        return { gradient: style.backgroundImage, opacity: Number(style.opacity), filter: style.filter, animation: style.animationName };
      });
      assert.equal((await glow()).opacity, 0);
      await page.locator('#start').click();
      let style = await glow();
      assert.ok(style.gradient.includes(green));
      assert.ok(style.opacity > 0.8);
      assert.ok(style.filter.includes('drop-shadow'));
      await screenshot(page, `break-green-${theme}`);
      await page.locator('#pause').click();
      style = await glow();
      assert.ok(style.gradient.includes(green));
      assert.ok(style.opacity > 0.8);
      assert.equal(style.animation, 'none');
      await page.locator('#start').click();
      await advance(page, 25000);
      await waitState(page, 'overtime');
      assert.equal(await page.locator('#overtime-label').isVisible(), true);
      style = await glow();
      assert.equal(style.gradient, 'none');
      assert.ok(style.filter.includes('drop-shadow'));
      assert.equal(await page.locator('#timer-face').evaluate(el => getComputedStyle(el).getPropertyValue('--glow-solid').trim()),
        theme === 'dark' ? '#68df98' : '#237d48');
      assert.equal(await page.locator('#timer-display').evaluate(el => getComputedStyle(el).webkitTextStrokeWidth), '10px');
      await screenshot(page, `break-overtime-${theme}`);
      await page.locator('#agenda-next').click();
      assert.equal((await glow()).opacity, 0);
      assert.equal(await page.locator('#overtime-label').isVisible(), false);
      await page.locator('#start').click();
      assert.equal((await glow()).opacity, 0);
      assert.deepEqual(errors, []);
    }
  });

  await t.test('multilingual break words anywhere in titles absorb overtime and preserve original spelling', async (t) => {
    const { page, errors } = await open(t);
    const titles = ['Team lunch together', 'Teraz PRESTÁVKA', 'Jetzt Mittagspause', 'Tempo per CAFFÈ', 'Ahora café', 'Teraz ŚNIADANIE'];
    const text = ['01:00 Talk', '03:00 Next', ...titles.map(title => `00:20 ${title}`), '02:00 Open discussion'].join('\n');
    await setAgenda(page, text);
    await page.locator('#start').click();
    await page.evaluate(() => {
      window.__timeOffset += 190000;
      document.getElementById('agenda-next').click();
    });
    assert.equal(await page.locator('#timer-display').textContent(), '03:00');
    const adjusted = await page.locator('#agenda-measure').textContent();
    for (const title of titles) assert.ok(adjusted.includes(`00:00 ${title}`), title);
    assert.ok(adjusted.includes('01:50 Open discussion'));
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 08:00');
    assert.equal(await page.locator('#agenda-input').inputValue(), text);
    await page.reload();
    await page.locator('#agenda-toggle').click();
    assert.equal(await page.locator('#agenda-input').inputValue(), text);
    assert.ok((await page.locator('#agenda-measure').textContent()).includes('00:00 Teraz ŚNIADANIE'));
    assert.deepEqual(errors, []);
  });

  await t.test('Next snapshots late clicks, uses final open discussion, and divides overtime without buffers', async (t) => {
    const { page, errors } = await open(t);
    for (const [text, expected, rows] of [
      ['01:00 Talk\n03:00 Next\n02:00 Open discussion', '03:00', ['01:00 Open discussion']],
      ['01:00 Talk\n03:00 Next\n02:00 Last', '02:30', ['01:30 Last']],
    ]) {
      await setAgenda(page, text);
      await page.locator('#agenda-previous').click();
      await page.locator('#start').click();
      // Click in the same event before the animation frame refreshes the timer.
      await page.evaluate(() => {
        window.__timeOffset += 120000;
        document.getElementById('agenda-next').click();
      });
      assert.equal(await page.locator('#timer-display').textContent(), expected);
      for (const row of rows) assert.ok((await page.locator('#agenda-measure').textContent()).includes(row));
      assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 06:00');
    }
    assert.equal(await page.evaluate(() => window.__audiblePlays), 0);
    assert.deepEqual(errors, []);
  });

  await t.test('Stop preserves early savings and overtime; reset and unstarted navigation make no transfers', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '01:00 Talk\n02:00 Next\n03:00 Last');
    await page.locator('#start').click();
    await advance(page, 20000);
    await page.locator('#stop').click();
    await advance(page, 600000);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '02:40');
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '03:00');
    await page.locator('#agenda-previous').click();
    assert.equal(await page.locator('#timer-display').textContent(), '02:40');
    await page.locator('#start').click();
    await advance(page, 200000);
    await page.locator('#stop').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:40');
    await advance(page, 120000);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '02:20');
    await page.locator('#start').click();
    await advance(page, 200000);
    await page.locator('#reset').click();
    assert.equal(await page.locator('#timer-display').textContent(), '02:20');
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 06:00');
    assert.deepEqual(errors, []);
  });

  await t.test('exhausted slots stay at zero and Finish records an unavoidable meeting extension', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '01:00 Talk\n00:10 Break\n00:20 Last');
    await page.locator('#start').click();
    await advance(page, 120000);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:00');
    assert.equal(await page.locator('#start').isDisabled(), true);
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 02:00');
    assert.match(await page.locator('#announcer').textContent(), /Meeting extended by 00:30/);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#timer-display').textContent(), '00:00');
    await page.locator('#agenda-previous').click();
    await page.locator('#agenda-previous').click();
    await page.locator('#stop').click();
    await page.locator('#agenda-input').fill('01:00 Only');
    await page.locator('#agenda-input').blur();
    await page.locator('#start').click();
    await advance(page, 90000);
    await page.locator('#agenda-next').click();
    assert.equal(await page.locator('#agenda-next-label').textContent(), 'Finish');
    assert.equal(await page.locator('#timer-face').getAttribute('data-state'), 'idle');
    assert.equal(await page.locator('#agenda-total').textContent(), 'TOTAL 01:30');
    assert.match(await page.locator('#announcer').textContent(), /Agenda complete/);
    assert.deepEqual(errors, []);
  });

  await t.test('agenda reload restores the selected duration read-only and manual timer edits preserve its plan', async (t) => {
    const { page, errors } = await open(t);
    await setAgenda(page, '00:01 First\n10:00 Discussion\n08:00 Decisions');
    await page.locator('#mute').click();
    await page.locator('#start').click();
    await advance(page, 1000);
    await waitState(page, 'overtime');
    await page.locator('#agenda-next').click();
    await page.locator('#theme-light').click();
    await page.reload();
    assert.equal(await page.locator('#agenda-panel').isVisible(), false);
    assert.equal(await page.locator('#timer-display').textContent(), '10:00');
    await page.locator('#agenda-toggle').click();
    assert.equal(await page.locator('#agenda-input').evaluate(el => el.readOnly), true);
    assert.match(await page.locator('#agenda-selection').textContent(), /Selected item 2: Discussion/);
    await setTime(page, '03:00');
    await page.locator('#start').click();
    await advance(page, 30000);
    await page.locator('#stop').click();
    await page.locator('#agenda-input').blur();
    assert.equal(await page.locator('#timer-display').textContent(), '02:30');
    await page.locator('#reset').click();
    assert.equal(await page.locator('#timer-display').textContent(), '03:00');
    assert.match(await page.locator('#agenda-input').inputValue(), /10:00 Discussion/);
    await page.locator('#stop').click();
    await page.locator('#agenda-input').fill('01:00 Replacement');
    await page.locator('#agenda-input').blur();
    assert.match(await page.locator('#agenda-selection').textContent(), /Selected item 1: Replacement/);
    assert.equal(await page.locator('#timer-display').textContent(), '01:00');
    assert.deepEqual(errors, []);
  });

  await t.test('Unicode and long agendas scroll inside black glass, captions sit below caps, and mobile fits', async (t) => {
    const { page, errors } = await open(t, { mobile: true, reducedMotion: 'reduce' });
    const text = Array.from({ length: 20 }, (_, i) => `01:00 ${i ? 'Item ' + i : 'Úvod — café! Discussion with a long title that wraps beneath the title column'}`).join('\n');
    await setAgenda(page, text);
    assert.equal(await page.locator('#agenda-input').inputValue(), text);
    const input = page.locator('#agenda-input');
    await input.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
    assert.match(await page.locator('#agenda-selection').textContent(), /Selected item 1: Úvod/);
    assert.equal(await input.evaluate(el => el.scrollHeight > el.clientHeight), true);
    const linePositions = await page.locator('#agenda-measure').evaluate(el => {
      const ranges = [...el.children].slice(0, 2).map(row => {
        const range = document.createRange();
        range.selectNodeContents(row);
        return [...range.getClientRects()].map(rect => ({ x: rect.x, y: rect.y }));
      });
      return ranges;
    });
    assert.equal(linePositions[0][0].x, linePositions[1][0].x, 'duration columns align');
    assert.ok(linePositions[0][1].x > linePositions[0][0].x, 'wrapped title is indented');
    assert.equal(await page.locator('#agenda-panel').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.locator('#start').click();
    await screenshot(page, 'agenda-mobile');
    await page.locator('#theme-light').click();
    assert.equal(await input.evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(size);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const stage = await page.locator('#timer-stage').boundingBox();
      const dock = await page.locator('#control-dock').boundingBox();
      assert.ok(stage.y + stage.height <= dock.y);
    }
    for (const selector of ['#start', '#pause', '#stop', '#reset', '#mute', '#sound-selector', '#agenda-toggle', '#theme-dark', '#agenda-previous', '#agenda-eject', '#agenda-next']) {
      const button = page.locator(selector);
      const face = await button.locator('.key-face').boundingBox();
      const caption = await button.locator('.key-caption').boundingBox();
      assert.ok(caption.y >= face.y + face.height);
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    await screenshot(page, 'agenda-long-light');
    assert.deepEqual(errors, []);
  });


  await t.test('showing or hiding Agenda at the deadline preserves the natural completion alarm', async (t) => {
    const { page, errors } = await open(t);
    for (let attempt = 0; attempt < 2; attempt++) {
      await setTime(page, '00:01');
      await page.locator('#start').click();
      await page.evaluate(() => {
        window.__timeOffset += 1000;
        document.getElementById('agenda-toggle').click();
      });
      await waitState(page, 'finished');
      await page.waitForFunction(() => !window.__alarmAudio.paused && window.__alarmAudio.currentTime > 0);
      assert.equal(await page.evaluate(() => window.__audiblePlays), attempt + 1);
      assert.equal(await page.locator('#agenda-panel').isVisible(), attempt === 0);
      await page.locator('#reset').click();
    }
    assert.deepEqual(errors, []);
  });

});
