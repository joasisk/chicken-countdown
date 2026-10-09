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

test("navigation is always enabled, stays adjacent, and eject only blocks running", () => {
  for (const status of ["idle", "running", "paused", "finished"]) {
    for (const remaining of [0, 500]) {
      const agenda = new Agenda({ text: "00:01 First\n00:02 Second\n00:03 Last", activeIndex: 0 });
      assert.deepEqual(agenda.permissions(status, remaining), {
        previous: true, next: true, eject: status !== "running",
      });
      assert.equal(agenda.navigate(-1, status, remaining), null);
      assert.equal(agenda.navigate(2, status, remaining), null);
      assert.equal(agenda.navigate(1, status, remaining), 2000);
      assert.equal(agenda.navigate(1, status, remaining), 3000);
      assert.equal(agenda.navigate(1, status, remaining), null);
      assert.equal(agenda.navigate(-1, status, remaining), 2000);
      assert.equal(agenda.editingUnlocked, false);
      const saved = agenda.saved();
      assert.equal(agenda.eject(status, remaining), status !== "running");
      assert.deepEqual(agenda.saved(), status === "running" ? saved : { text: "", activeIndex: null });
    }
  }
  const empty = new Agenda();
  assert.deepEqual(empty.permissions("idle"), { previous: true, next: true, eject: true });
  assert.equal(empty.navigate(1, "idle", 0), null);
  assert.equal(empty.navigate(-1, "idle", 0), null);
  assert.equal(empty.eject("idle", 0), true);
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
