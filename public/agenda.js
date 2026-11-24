import { formatTime, MAX_DURATION } from "./timer.js";

const minutesPerDay = 24 * 60;
const clockWindow = /^([^\S\r\n]*)(\d{1,2}:\d{2})[^\S\r\n]*([-–—])[^\S\r\n]*(\d{1,2}:\d{2})([^\S\r\n]+|$)/gm;

function minutesSinceMidnight(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : NaN;
}

export function convertAgendaTimeWindows(text, { includeFirstLine = true } = {}) {
  return text.replace(clockWindow, (prefix, indent, startTime, dash, endTime, gap, offset) => {
    if (offset === 0 && !includeFirstLine) return prefix;
    const elapsedMinutes = (minutesSinceMidnight(endTime) - minutesSinceMidnight(startTime) + minutesPerDay) % minutesPerDay;
    const duration = elapsedMinutes * 60_000;
    if (duration > 0 && duration <= MAX_DURATION)
      return `${indent}${formatTime(duration)}${gap ? " " : ""}`;
    // Keep invalid ranges together so duration validation can flag the row.
    return `${indent}${startTime}${dash}${endTime}${gap}`;
  });
}

export function parseAgenda(text) {
  const entries = [];
  const errors = [];
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const match = /^(\d{2}):(\d{2})[ \t]+(.+)$/.exec(line);
    if (!match || Number(match[2]) > 59) {
      errors.push({ line: index + 1, message: "Use MM:SS followed by a title (00:01–99:59)." });
      return;
    }
    const durationSeconds = Number(match[1]) * 60 + Number(match[2]);
    if (!durationSeconds) {
      errors.push({ line: index + 1, message: "Duration must be greater than 00:00." });
      return;
    }
    entries.push({ durationSeconds, title: match[3].trim() });
  });
  return { entries, errors };
}

const breakWords = new Set([
  // English
  "lunch", "break", "coffee", "lunchbreak", "coffeebreak",
  // Slovak
  "prestavka", "pauza", "cikpauza", "obed", "kava",
  // German
  "pause", "kaffee", "kaffeepause", "mittag", "mittagessen", "mittagspause",
  "raucherpause", "pinkelpause", "toilettenpause", "fruhstuck", "fruehstueck",
  // Italian
  "pausa", "pranzo", "caffe", "intervallo",
  // Spanish
  "descanso", "almuerzo", "comida", "cafe", "recreo",
  // Polish
  "przerwa", "obiad", "kawa", "sniadanie",
]);

export function normalizeAgendaTitle(title) {
  // Fold accents only for matching. Ł and ß do not decompose into ASCII.
  return String(title).toLowerCase().normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/ß/g, "ss");
}

export function isBreakTitle(title) {
  const words = normalizeAgendaTitle(title).match(/[\p{L}\p{N}]+/gu) || [];
  return words.some(word => breakWords.has(word));
}

export class Agenda {
  constructor(saved) {
    this.visible = false;
    this.committedText = "";
    this.draftText = "";
    this.entries = [];
    this.durations = [];
    this.activeIndex = null;
    this.editingUnlocked = false;
    this.errors = [];
    if (typeof saved?.text === "string") {
      const parsed = parseAgenda(saved.text);
      if (!parsed.errors.length) {
        this.committedText = this.draftText = saved.text;
        this.entries = parsed.entries;
        this.durations = this.entries.map(entry => entry.durationSeconds * 1000);
        if (Array.isArray(saved.durations) && saved.durations.length === this.entries.length &&
            saved.durations.every(duration => Number.isSafeInteger(duration) && duration >= 0))
          this.durations = [...saved.durations];
        if (this.entries.length)
          this.activeIndex = Math.min(this.entries.length - 1, Math.max(0,
            Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0));
      }
    }
  }

  get dirty() { return this.draftText !== this.committedText; }
  get totalSeconds() { return this.durations.reduce((sum, duration) => sum + duration, 0) / 1000; }
  get selectedDuration() { return this.durations[this.activeIndex] ?? 0; }
  get adjusted() { return this.entries.some((entry, index) => this.durations[index] !== entry.durationSeconds * 1000); }

  updateDraft(text) {
    if (!this.editingUnlocked) return false;
    this.draftText = text;
    this.errors = [];
    return true;
  }

  commit() {
    if (!this.dirty) {
      this.errors = [];
      return { valid: true, changed: false };
    }
    const { entries, errors } = parseAgenda(this.draftText);
    this.errors = errors;
    if (errors.length) return { valid: false, changed: false };
    this.entries = entries;
    this.durations = entries.map(entry => entry.durationSeconds * 1000);
    this.committedText = this.draftText;
    this.activeIndex = entries.length ? Math.min(this.activeIndex ?? 0, entries.length - 1) : null;
    return { valid: true, changed: true, duration: this.selectedDuration };
  }

  lock({ discard = false } = {}) {
    this.editingUnlocked = false;
    if (discard) {
      this.draftText = this.committedText;
      this.errors = [];
    }
  }

  permissions(status) {
    return {
      previous: true,
      next: true,
      eject: status !== "running",
    };
  }

  navigate(offset, status, remaining) {
    if ((offset !== -1 && offset !== 1) || this.activeIndex === null) return null;
    const nextIndex = this.activeIndex + offset;
    if (nextIndex < 0 || nextIndex >= this.entries.length) return null;
    this.activeIndex += offset;
    this.lock();
    return this.selectedDuration;
  }

  finishActive(elapsed) {
    if (this.activeIndex === null || !Number.isSafeInteger(elapsed) || elapsed < 0) return null;
    const delta = this.selectedDuration - elapsed;
    this.durations[this.activeIndex] = elapsed;
    const saved = Math.max(0, delta);
    const overtime = Math.max(0, -delta);
    const nextIndex = this.activeIndex + 1;
    if (!delta || nextIndex === this.durations.length)
      return { saved, overtime, unrecovered: overtime };

    const following = this.durations.slice(nextIndex).map(BigInt);
    const remaining = following.reduce((sum, duration) => sum + duration, 0n);
    const budget = remaining + BigInt(delta);
    if (budget <= 0n) {
      this.durations.fill(0, nextIndex);
      return { saved, overtime, unrecovered: Number(-budget) };
    }

    // Use the original plan to allocate saved time when every upcoming slot is at zero.
    const weights = remaining > 0n
      ? following
      : this.entries.slice(nextIndex).map(entry => BigInt(entry.durationSeconds));
    const totalWeight = remaining || weights.reduce((sum, weight) => sum + weight, 0n);
    let cumulativeWeight = 0n;
    let allocated = 0n;
    // Round cumulative shares so the slots add up to the exact millisecond budget.
    for (const [index, weight] of weights.entries()) {
      cumulativeWeight += weight;
      const cumulativeDuration = (budget * cumulativeWeight + totalWeight / 2n) / totalWeight;
      this.durations[nextIndex + index] = Number(cumulativeDuration - allocated);
      allocated = cumulativeDuration;
    }
    return { saved, overtime, unrecovered: 0 };
  }

  eject(status, remaining) {
    if (!this.permissions(status, remaining).eject) return false;
    this.visible = true;
    this.committedText = this.draftText = "";
    this.entries = [];
    this.durations = [];
    this.activeIndex = null;
    this.errors = [];
    this.lock();
    return true;
  }

  saved() {
    return { text: this.committedText, activeIndex: this.activeIndex,
      ...(this.adjusted ? { durations: [...this.durations] } : {}) };
  }
}
