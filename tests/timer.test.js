import test from "node:test";
import assert from "node:assert/strict";
import {
  Countdown,
  durationFromInput,
  formatTime,
  MAX_DURATION,
} from "../public/timer.js";

test("first use is stopped at zero and cannot start", () => {
  const timer = new Countdown();
  assert.deepEqual(timer.snapshot(100), { status: "idle", remaining: 0 });
  assert.equal(timer.start(100), false);
});

test("counts down from a deadline even after a background delay", () => {
  const timer = new Countdown(10_000);
  timer.start(1000);
  assert.equal(timer.snapshot(6500).remaining, 4500);
  assert.deepEqual(timer.snapshot(30_000), {
    status: "finished",
    remaining: 0,
  });
  assert.equal(timer.snapshot(40_000).status, "finished");
});

test("pause and resume preserve precise remaining time", () => {
  const timer = new Countdown(10_000);
  timer.start(1000);
  timer.pause(3501);
  assert.equal(timer.snapshot(100_000).remaining, 7499);
  timer.start(100_000);
  assert.equal(timer.snapshot(101_000).remaining, 6499);
  assert.equal(timer.snapshot(107_499).status, "finished");
});

test("Stop snaps the remainder upward and Reset retains the original duration", () => {
  const timer = new Countdown(1_500_000);
  timer.start(0);
  timer.stop(746_250);
  assert.equal(formatTime(timer.remaining), "12:34");
  assert.equal(timer.duration, 1_500_000);
  assert.equal(timer.status, "idle");
  timer.start(800_000);
  assert.equal(timer.snapshot(801_000).remaining, 753_000);
  timer.reset();
  assert.equal(formatTime(timer.remaining), "25:00");
});

test("Stop, Reset and Clear cancel a deadline without completing", () => {
  for (const action of ["stop", "reset", "clear"]) {
    const timer = new Countdown(1000);
    timer.start(0);
    timer[action](1000);
    assert.equal(timer.snapshot(99_000).status, "idle");
  }
  const timer = new Countdown(1000);
  timer.clear();
  timer.reset();
  assert.equal(timer.duration, 0);
  assert.equal(timer.remaining, 0);
});

test("restart after completion restores the original duration", () => {
  const timer = new Countdown(1000);
  timer.start(0);
  timer.snapshot(1000);
  timer.start(2000);
  assert.equal(timer.snapshot(2000).remaining, 1000);
});

test("starting an already running countdown does not extend it", () => {
  const timer = new Countdown(1000);
  timer.start(500);
  timer.start(1000);
  assert.equal(timer.snapshot(1500).status, "finished");
});

test("MM:SS rounds up and never displays zero prematurely", () => {
  assert.equal(formatTime(1), "00:01");
  assert.equal(formatTime(60_001), "01:01");
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(MAX_DURATION), "99:59");
});

test("validates unambiguous minute/second inputs and the 99:59 limit", () => {
  assert.equal(durationFromInput("2500"), 1_500_000);
  assert.equal(durationFromInput("25:00"), 1_500_000);
  assert.equal(durationFromInput("1:2"), 62_000);
  assert.equal(durationFromInput("00:00"), 0);
  assert.equal(durationFromInput("99:59"), MAX_DURATION);
  for (const value of [
    "90",
    "00:60",
    "100:00",
    "__:00",
    "bad",
    "1.5:00",
    "-1:00",
    "25000",
  ])
    assert.throws(() => durationFromInput(value), RangeError);
  for (const value of [-1, MAX_DURATION + 1, Infinity, 0.5])
    assert.throws(() => new Countdown(value), RangeError);
});

test("agenda countdowns measure overtime from the original deadline after a background delay", () => {
  const timer = new Countdown();
  timer.configure(10_000, { allowOvertime: true });
  assert.equal(timer.elapsed, 0);
  assert.equal(timer.overtime, false);
  timer.start(1000);
  assert.deepEqual(timer.snapshot(11_000), { status: "running", remaining: 0 });
  assert.equal(timer.overtime, true);
  assert.equal(timer.elapsed, 10_000);
  assert.deepEqual(timer.snapshot(31_250), { status: "running", remaining: -20_250 });
  assert.equal(timer.elapsed, 30_250);
  assert.equal(timer.start(40_000), false);
  assert.equal(timer.deadline, 11_000);
});

test("pausing before and during overtime excludes paused time, and Stop preserves precise elapsed time", () => {
  const timer = new Countdown();
  timer.configure(10_000, { allowOvertime: true });
  timer.start(0);
  timer.pause(6250);
  assert.equal(timer.elapsed, 6250);
  timer.start(100_000);
  timer.pause(106_125);
  assert.equal(timer.remaining, -2375);
  assert.equal(timer.snapshot(999_999).remaining, -2375);
  timer.start(200_000);
  timer.stop(201_125);
  assert.equal(timer.remaining, -3500);
  assert.equal(timer.elapsed, 13_500);
  assert.equal(timer.snapshot(999_999).status, "idle");
  timer.start(300_000);
  assert.equal(timer.snapshot(301_000).remaining, -4500);
  timer.reset();
  assert.equal(timer.hasStarted, false);
  assert.equal(timer.overtime, false);
  assert.equal(timer.remaining, 10_000);
  timer.clear();
  assert.equal(timer.allowOvertime, false);
});

test("overtime can resume at zero and agenda extensions can exceed the input limit", () => {
  const timer = new Countdown();
  timer.configure(MAX_DURATION + 120_000, { allowOvertime: true });
  assert.equal(formatTime(timer.remaining), "101:59");
  timer.start(0);
  timer.stop(timer.duration);
  assert.equal(timer.start(9_000_000), true);
  assert.equal(timer.snapshot(9_001_000).remaining, -1000);
  timer.configure(0, { allowOvertime: true });
  assert.equal(timer.start(), false);
  assert.equal(timer.elapsed, 0);
  assert.equal(timer.overtime, false);
});
