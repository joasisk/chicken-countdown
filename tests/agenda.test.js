import test from "node:test";
import assert from "node:assert/strict";
import { Agenda, isBreakTitle, normalizeAgendaTitle, parseAgenda } from "../public/agenda.js";
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

test("break words match anywhere in a title in all six languages, with or without accents", () => {
  const keywords = [
    "lunch", "break", "coffee", "lunchbreak", "coffeebreak",
    "prestávka", "pauza", "cikpauza", "obed", "káva",
    "Pause", "Kaffee", "Kaffeepause", "Mittag", "Mittagessen", "Mittagspause",
    "Raucherpause", "Pinkelpause", "Toilettenpause", "Frühstück", "Fruehstueck",
    "pausa", "pranzo", "caffè", "intervallo",
    "descanso", "almuerzo", "comida", "café", "recreo",
    "przerwa", "obiad", "kawa", "śniadanie",
  ];
  for (const keyword of keywords) {
    for (const spelling of [keyword, keyword.toUpperCase(), normalizeAgendaTitle(keyword)]) {
      const title = `Team — ${spelling} (15 minutes)`;
      assert.equal(isBreakTitle(title), true, title);
      const agenda = new Agenda({ text: `01:00 Talk\n03:00 Next\n02:00 ${title}\n01:00 Open discussion` });
      agenda.finishActive(90_000);
      assert.deepEqual(agenda.durations, [90_000, 180_000, 90_000, 60_000], title);
      assert.equal(agenda.entries[2].title, title);
      assert.ok(agenda.saved().text.includes(title));
    }
  }
});

test("matching folds extended letters and decomposed accents while retaining word boundaries", () => {
  assert.equal(normalizeAgendaTitle("Á Ä Č Ď É Í Ĺ Ľ Ň Ó Ô Ŕ Š Ť Ú Ý Ž Ł ẞ"),
    "a a c d e i l l n o o r s t u y z l ss");
  for (const title of ["Neskôr čikpauza", "KÁVA pre tím", "prestávka po prezentácii", "Coffee / lunch", "(káva)", "coffee_break", "ŽÓŁTA — ŚNIADANIE"]) {
    assert.equal(isBreakTitle(title), true, title);
    assert.equal(isBreakTitle(title.normalize("NFD")), true, `${title} decomposed`);
  }
  for (const title of ["", "Keynote", "Breakfast roadmap", "Breakthrough research", "Coffeehouse business", "Lunchbox design", "Pausebutton demo", "Kavaleria", "Presentation2coffee", "кофеbreak"]) {
    assert.equal(isBreakTitle(title), false, title);
  }
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

test("early completion adds the precise saved time to the next slot, including breaks", () => {
  const agenda = new Agenda({ text: "05:00 Talk\n02:00 Break\n10:00 Next" });
  assert.deepEqual(agenda.finishActive(210_250), { saved: 89_750, overtime: 0, unrecovered: 0 });
  assert.deepEqual(agenda.durations, [210_250, 209_750, 600_000]);
  assert.equal(agenda.totalSeconds, 1020);
  assert.equal(agenda.navigate(1), 209_750);
  assert.match(agenda.saved().text, /02:00 Break/);
});

test("overtime uses upcoming breaks first and leaves presentations intact", () => {
  const agenda = new Agenda({ text: "05:00 Talk\n10:00 Next\n02:00 Coffee BREAK\n01:00 Break\n05:00 Open discussion" });
  assert.deepEqual(agenda.finishActive(450_000), { saved: 0, overtime: 150_000, unrecovered: 0 });
  assert.deepEqual(agenda.durations, [450_000, 600_000, 0, 30_000, 300_000]);
  assert.equal(agenda.totalSeconds, 1380);
});

test("a final open discussion absorbs overtime after breaks, but ordinary discussions share equally", () => {
  const agenda = new Agenda({ text: "05:00 Talk\n10:00 Next\n01:00 Lunch\n05:00 OPEN DISCUSSION" });
  agenda.finishActive(480_000);
  assert.deepEqual(agenda.durations, [480_000, 600_000, 0, 180_000]);
  const noBreak = new Agenda({ text: "05:00 Talk\n10:00 Next\n05:00 Open discussion" });
  noBreak.finishActive(360_000);
  assert.deepEqual(noBreak.durations, [360_000, 600_000, 240_000]);
  const ordinary = new Agenda({ text: "05:00 Talk\n10:00 Next\n05:00 Discussion" });
  ordinary.finishActive(360_000);
  assert.deepEqual(ordinary.durations, [360_000, 570_000, 270_000]);
  const earlier = new Agenda({ text: "05:00 Talk\n05:00 Open discussion\n10:00 Next" });
  earlier.finishActive(360_000);
  assert.deepEqual(earlier.durations, [360_000, 270_000, 570_000]);
});

test("without buffers every following slot loses an equal share, preserving all milliseconds", () => {
  const agenda = new Agenda({ text: "05:00 Talk\n03:00 A\n04:00 B\n05:00 C" });
  agenda.finishActive(420_001);
  assert.deepEqual(agenda.durations, [420_001, 139_999, 200_000, 260_000]);
  assert.equal(agenda.totalSeconds, 1020);
  const saved = agenda.saved();
  const restored = new Agenda(saved);
  assert.deepEqual(restored.saved(), saved);
  assert.equal(restored.navigate(1), 139_999);
  restored.editingUnlocked = true;
  restored.updateDraft("01:00 Replacement");
  restored.commit();
  assert.deepEqual(restored.durations, [60_000]);
  assert.equal(restored.adjusted, false);
});

test("short slots reach zero; excess is redistributed, with unavoidable extension reported", () => {
  const agenda = new Agenda({ text: "01:00 Talk\n00:10 Short\n01:00 Long\n01:00 Last" });
  assert.deepEqual(agenda.finishActive(150_000), { saved: 0, overtime: 90_000, unrecovered: 0 });
  assert.deepEqual(agenda.durations, [150_000, 0, 20_000, 20_000]);
  const overflow = new Agenda({ text: "01:00 Talk\n00:10 Break\n00:20 Next\n00:30 Open discussion" });
  assert.deepEqual(overflow.finishActive(180_000), { saved: 0, overtime: 120_000, unrecovered: 60_000 });
  assert.deepEqual(overflow.durations, [180_000, 0, 0, 0]);
  assert.equal(overflow.totalSeconds, 180);
});

test("consecutive finishes use adjusted budgets and never change earlier slots", () => {
  const agenda = new Agenda({ text: "01:00 Break\n05:00 Talk\n10:00 Next\n05:00 Last", activeIndex: 1 });
  agenda.finishActive(420_000);
  assert.deepEqual(agenda.durations, [60_000, 420_000, 540_000, 240_000]);
  agenda.navigate(1);
  agenda.finishActive(480_000);
  assert.deepEqual(agenda.durations, [60_000, 420_000, 480_000, 300_000]);
  assert.equal(agenda.totalSeconds, 1260);
});

test("final slot finishes account for meeting length and invalid saved adjustments are ignored", () => {
  const agenda = new Agenda({ text: "01:00 Only" });
  assert.deepEqual(agenda.finishActive(90_000), { saved: 0, overtime: 30_000, unrecovered: 30_000 });
  assert.equal(agenda.totalSeconds, 90);
  assert.equal(agenda.finishActive(-1), null);
  for (const durations of [[-1], [100.5], [], ["60000"], [Number.MAX_SAFE_INTEGER + 1]]) {
    const restored = new Agenda({ text: "01:00 Only", durations });
    assert.equal(restored.selectedDuration, 60_000);
  }
});
