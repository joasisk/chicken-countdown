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

export class Agenda {
  constructor(saved) {
    this.visible = false;
    this.committedText = "";
    this.draftText = "";
    this.entries = [];
    this.activeIndex = null;
    this.editingUnlocked = false;
    this.errors = [];
    if (typeof saved?.text === "string") {
      const parsed = parseAgenda(saved.text);
      if (!parsed.errors.length) {
        this.committedText = this.draftText = saved.text;
        this.entries = parsed.entries;
        if (this.entries.length)
          this.activeIndex = Math.min(this.entries.length - 1, Math.max(0,
            Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0));
      }
    }
  }

  get dirty() { return this.draftText !== this.committedText; }
  get totalSeconds() { return this.entries.reduce((sum, entry) => sum + entry.durationSeconds, 0); }
  get selectedDuration() { return (this.entries[this.activeIndex]?.durationSeconds || 0) * 1000; }

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

  eject(status, remaining) {
    if (!this.permissions(status, remaining).eject) return false;
    this.visible = true;
    this.committedText = this.draftText = "";
    this.entries = [];
    this.activeIndex = null;
    this.errors = [];
    this.lock();
    return true;
  }

  saved() { return { text: this.committedText, activeIndex: this.activeIndex }; }
}
