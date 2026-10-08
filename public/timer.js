export function durationFromParts(hours, minutes, seconds) {
  const parts = [hours, minutes, seconds].map(Number);
  if (
    parts.some((value) => !Number.isInteger(value) || value < 0) ||
    parts[0] > 99 ||
    parts[1] > 59 ||
    parts[2] > 59
  ) {
    throw new RangeError("Use 0–99 hours and 0–59 minutes or seconds.");
  }
  const duration = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (duration === 0) throw new RangeError("Set a countdown longer than zero.");
  return duration;
}

export function timeParts(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ].map((part) => String(part).padStart(2, "0"));
}

export class Countdown {
  constructor(duration = 300_000) {
    this.configure(duration);
  }

  configure(duration) {
    if (!Number.isFinite(duration) || duration <= 0)
      throw new RangeError("Duration must be positive.");
    this.duration = duration;
    this.reset();
  }

  reset() {
    this.remaining = this.duration;
    this.deadline = null;
    this.status = "idle";
  }

  start(now = Date.now()) {
    if (this.status === "running") return;
    if (this.status === "finished") this.remaining = this.duration;
    this.deadline = now + this.remaining;
    this.status = "running";
  }

  pause(now = Date.now()) {
    if (this.status !== "running") return;
    this.snapshot(now);
    if (this.status === "finished") return;
    this.deadline = null;
    this.status = "paused";
  }

  snapshot(now = Date.now()) {
    if (this.status === "running") {
      this.remaining = Math.max(0, this.deadline - now);
      if (this.remaining === 0) {
        this.status = "finished";
        this.deadline = null;
      }
    }
    return {
      status: this.status,
      remaining: this.remaining,
      progress: 1 - this.remaining / this.duration,
    };
  }
}
