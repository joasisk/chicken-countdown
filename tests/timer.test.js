import test from "node:test";
import assert from "node:assert/strict";
import { Countdown, durationFromParts, timeParts } from "../public/timer.js";

test("counts down using deadlines, including time spent in an inactive tab", () => {
  const timer = new Countdown(10_000);
  timer.start(1000);
  assert.equal(timer.snapshot(6500).remaining, 4500);
  assert.deepEqual(timer.snapshot(30_000), {
    status: "finished",
    remaining: 0,
    progress: 1,
  });
  assert.equal(timer.snapshot(40_000).status, "finished");
});

test("pausing preserves precise time and resuming establishes a new deadline", () => {
  const timer = new Countdown(10_000);
  timer.start(1000);
  timer.pause(3500);
  assert.equal(timer.snapshot(100_000).remaining, 7500);
  assert.equal(timer.status, "paused");
  timer.start(100_000);
  assert.equal(timer.snapshot(101_000).remaining, 6500);
  assert.equal(timer.snapshot(107_500).status, "finished");
});

test("reset and restart restore the chosen duration", () => {
  const timer = new Countdown(1000);
  timer.start(0);
  timer.snapshot(1000);
  timer.start(2000);
  assert.equal(timer.snapshot(2000).remaining, 1000);
  timer.reset();
  assert.deepEqual(timer.snapshot(99_000), {
    status: "idle",
    remaining: 1000,
    progress: 0,
  });
  timer.configure(5000);
  assert.equal(timer.duration, 5000);
});

test("pause at the deadline completes instead of preserving an expired countdown", () => {
  const timer = new Countdown(1000);
  timer.start(500);
  timer.pause(1500);
  assert.equal(timer.status, "finished");
});

test("starting an already running countdown does not extend it", () => {
  const timer = new Countdown(1000);
  timer.start(500);
  timer.start(1000);
  assert.equal(timer.snapshot(1500).status, "finished");
});

test("formats hours, minutes and seconds without displaying zero early", () => {
  assert.deepEqual(timeParts(3_661_000), ["01", "01", "01"]);
  assert.deepEqual(timeParts(1), ["00", "00", "01"]);
  assert.deepEqual(timeParts(-1), ["00", "00", "00"]);
  assert.deepEqual(timeParts(60_001), ["00", "01", "01"]);
});

test("custom duration rejects zero, fractions and out-of-range parts", () => {
  assert.equal(durationFromParts("1", "2", "3"), 3_723_000);
  for (const parts of [
    [0, 0, 0],
    [-1, 0, 1],
    [100, 0, 0],
    [0, 60, 0],
    [0, 0, 60],
    [0, 0, 1.5],
    ["bad", 1, 0],
  ]) {
    assert.throws(() => durationFromParts(...parts), RangeError);
  }
  assert.throws(() => new Countdown(0), RangeError);
});
