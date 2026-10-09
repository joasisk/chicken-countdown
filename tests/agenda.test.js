import test from "node:test";
import assert from "node:assert/strict";
import { Agenda, parseAgenda } from "../public/agenda.js";
import { formatTime } from "../public/timer.js";

test("strict agenda parsing preserves Unicode, internal spaces, order and duplicates", () => {
  const { entries, errors } = parseAgenda("\r\n 05:00\tÚvod — café!  \r\n10:00 Discussion  & decisions\r\n05:00\tÚvod — café!\r\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(entries, [
    { durationSeconds: 300, title: "Úvod — café!" },
    { durationSeconds: 600, title: "Discussion  & decisions" },
    { durationSeconds: 300, title: "Úvod — café!" },
  ]);
  const malformed = ["5:00 Short", "05:0 Short", "00:60 Seconds", "100:00 Minutes", "00:00 Zero", "05:00", "05:00\t ", "05:00Title"];
  const result = parseAgenda(`\n${malformed.join("\n")}\n99:59 Valid`);
  assert.deepEqual(result.errors.map(error => error.line), malformed.map((_, i) => i + 2));
  assert.deepEqual(result.entries, [{ durationSeconds: 5999, title: "Valid" }]);
});

test("commits are atomic, unchanged drafts retain time, and totals exceed two digits", () => {
  const agenda = new Agenda();
  assert.equal(agenda.updateDraft("05:00 Welcome"), false);
  agenda.editingUnlocked = true;
  agenda.updateDraft("05:00 Welcome\n10:00 Discussion\n08:00 Decisions\n02:00 Wrap-up");
  assert.deepEqual(agenda.commit(), { valid: true, changed: true, duration: 300000 });
  assert.equal(formatTime(agenda.totalSeconds * 1000), "25:00");
  assert.deepEqual(agenda.commit(), { valid: true, changed: false });
  const saved = agenda.saved();
  agenda.updateDraft("05:00 Valid\n10:99 Invalid");
  assert.equal(agenda.commit().valid, false);
  assert.deepEqual(agenda.saved(), saved);
  assert.equal(agenda.entries.length, 4);
  assert.match(agenda.draftText, /Invalid/);
  agenda.lock({ discard: true });
  assert.equal(agenda.draftText, saved.text);
  assert.equal(agenda.editingUnlocked, false);
  agenda.editingUnlocked = true;
  agenda.updateDraft("99:00 Long\n36:00 Longer");
  agenda.commit();
  assert.equal(formatTime(agenda.totalSeconds * 1000), "135:00");
  agenda.activeIndex = 1;
  agenda.updateDraft("02:00 Single");
  assert.equal(agenda.commit().duration, 120000);
  assert.equal(agenda.activeIndex, 0);
  agenda.updateDraft("\n  ");
  assert.equal(agenda.commit().duration, 0);
  assert.equal(agenda.activeIndex, null);
});

test("only natural expiry permits one adjacent navigation, with guards inside handlers", () => {
  const agenda = new Agenda({ text: "00:01 First\n00:02 Second\n00:03 Last", activeIndex: 0 });
  for (const status of ["idle", "stopped", "running", "paused"]) {
    assert.deepEqual(agenda.permissions(status, 0), { previous: false, next: false, eject: false });
    assert.equal(agenda.navigate(1, status, 0), null);
    assert.equal(agenda.eject(status, 0), false);
  }
  assert.equal(agenda.navigate(1, "finished", 1), null);
  assert.equal(agenda.navigate(-1, "finished", 0), null);
  assert.equal(agenda.navigate(2, "finished", 0), null);
  assert.equal(agenda.navigate(1, "finished", 0), 2000);
  assert.equal(agenda.navigate(1, "idle", 2000), null);
  assert.equal(agenda.editingUnlocked, false);
  assert.equal(agenda.navigate(1, "finished", 0), 3000);
  assert.equal(agenda.permissions("finished", 0).next, false);
  assert.equal(agenda.navigate(-1, "finished", 0), 2000);
  assert.equal(agenda.eject("finished", 0), true);
  assert.equal(agenda.visible, true);
  assert.deepEqual(agenda.saved(), { text: "", activeIndex: null });
  assert.equal(agenda.totalSeconds, 0);
});

test("reload restores only validated committed entries and clamps the selection", () => {
  const agenda = new Agenda({ text: "01:00 Café\n02:00 Úvod", activeIndex: 90 });
  assert.equal(agenda.activeIndex, 1);
  assert.equal(agenda.selectedDuration, 120000);
  assert.equal(agenda.editingUnlocked, false);
  assert.equal(agenda.visible, false);
  const invalid = new Agenda({ text: "90 Invalid", activeIndex: 0 });
  assert.deepEqual(invalid.saved(), { text: "", activeIndex: null });
});
