export const MAX_DURATION = 5_999_000;

export function durationFromInput(value) {
  const text = String(value).trim();
  const match =
    /^(\d{1,2}):(\d{1,2})$/.exec(text) || /^(\d{2})(\d{2})$/.exec(text);
  if (!match || Number(match[2]) > 59)
    throw new RangeError("Enter a complete time from 00:00 to 99:59.");
  return (Number(match[1]) * 60 + Number(match[2])) * 1000;
}

export function formatTime(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export class Countdown {
  constructor(duration = 0) {
    this.configure(duration);
  }

  configure(duration) {
    if (!Number.isInteger(duration) || duration < 0 || duration > MAX_DURATION)
      throw new RangeError("Duration must be between 00:00 and 99:59.");
    this.duration = duration;
    this.reset();
  }

  reset() {
    this.remaining = this.duration;
    this.deadline = null;
    this.status = "idle";
  }

  clear() {
    this.configure(0);
  }

  start(now = Date.now()) {
    if (this.status === "running") return false;
    if (this.status === "finished") this.remaining = this.duration;
    if (this.remaining === 0) return false;
    this.deadline = now + this.remaining;
    this.status = "running";
    return true;
  }

  pause(now = Date.now()) {
    if (this.status !== "running") return;
    this.snapshot(now);
    if (this.status === "finished") return;
    this.deadline = null;
    this.status = "paused";
  }

  stop(now = Date.now()) {
    if (this.status === "running")
      this.remaining = Math.max(0, this.deadline - now);
    this.remaining = Math.ceil(this.remaining / 1000) * 1000;
    this.deadline = null;
    this.status = "idle";
  }

  snapshot(now = Date.now()) {
    if (this.status === "running") {
      this.remaining = Math.max(0, this.deadline - now);
      if (this.remaining === 0) {
        this.status = "finished";
        this.deadline = null;
      }
    }
    return { status: this.status, remaining: this.remaining };
  }
}
