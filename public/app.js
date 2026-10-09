import { Countdown, durationFromInput, formatTime } from "./timer.js";
import { AlarmAudio } from "./audio.js";
import { Agenda, isBreakTitle } from "./agenda.js";

const $ = (id) => document.getElementById(id);
const timer = new Countdown();
const editor = $("duration-input");
const preferenceKey = "chicken-countdown.preferences";
let preferences = {
  theme: "dark",
  volume: 60,
  muted: false,
  lastNonzero: 60,
  customName: null,
  agenda: null,
};
try {
  const saved = JSON.parse(localStorage.getItem(preferenceKey));
  if (saved) {
    preferences.theme = saved.theme === "light" ? "light" : "dark";
    if (
      Number.isFinite(saved.volume) &&
      saved.volume >= 0 &&
      saved.volume <= 100
    )
      preferences.volume = saved.volume;
    preferences.muted = saved.muted === true || preferences.volume === 0;
    if (
      Number.isFinite(saved.lastNonzero) &&
      saved.lastNonzero > 0 &&
      saved.lastNonzero <= 100
    )
      preferences.lastNonzero = saved.lastNonzero;
    if (typeof saved.customName === "string" && saved.customName)
      preferences.customName = saved.customName;
    preferences.agenda = saved.agenda;
  }
} catch {
  /* Storage is optional; the timer also works without it. */
}

const agenda = new Agenda(preferences.agenda);
const agendaEditor = $("agenda-input");
agendaEditor.value = agenda.draftText;
// Restore adjusted slot budgets, never a stale running countdown.
if (agenda.entries.length) timer.configure(agenda.selectedDuration, { allowOvertime: true });

let completionAnnounced = false;
let warned = false;
let editing = false;
let editorBaseline = "00:00";
let fileRequest = 0;
let clickTimeout;
let gestureInitialState;
const audio = new AlarmAudio({ onMessage: showAudioMessage });

function savePreferences() {
  preferences.agenda = agenda.saved();
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    /* Private browsing may disable storage. */
  }
}

function announce(message) {
  $("announcer").textContent = message;
}
function setText(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}
function showAudioMessage(message = "") {
  $("audio-message").textContent = message;
  $("audio-message").hidden = !message;
}
function clearError() {
  $("duration-error").hidden = true;
  editor.removeAttribute("aria-invalid");
}
function showError(message) {
  $("duration-error").textContent = message;
  $("duration-error").hidden = false;
  editor.setAttribute("aria-invalid", "true");
  announce(message);
}

function renderSettings() {
  document.documentElement.dataset.theme = preferences.theme;
  document.querySelector('meta[name="theme-color"]').content =
    preferences.theme === "dark" ? "#090b0e" : "#e9eaec";
  document.querySelectorAll("[data-theme]").forEach((button) => {
    if (button.tagName === "BUTTON")
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.theme === preferences.theme),
      );
  });
  $("volume").value = preferences.volume;
  $("volume").style.setProperty("--volume-level", `${preferences.volume}%`);
  $("volume-value").textContent = preferences.muted
    ? "Muted"
    : `${preferences.volume}%`;
  $("mute").setAttribute("aria-pressed", String(preferences.muted));
  $("mute").setAttribute(
    "aria-label",
    preferences.muted ? "Unmute sound" : "Mute sound",
  );
  $("mute").title = preferences.muted ? "Unmute sound" : "Mute sound";
  $("mute-label").textContent = preferences.muted ? "Unmute" : "Mute";
  $("mute")
    .querySelector("use")
    .setAttribute("href", preferences.muted ? "#icon-muted" : "#icon-speaker");
  const name = audio.mode === "local" ? audio.fileName : "chicken orchestra";
  const shortened =
    name.length > 26 ? `${name.slice(0, 14)}…${name.slice(-9)}` : name;
  $("sound-name").textContent = shortened;
  $("sound-selector").setAttribute("aria-label", `Alarm sound: ${name}`);
  $("sound-selector").title = name;
  $("default-sound").setAttribute(
    "aria-checked",
    String(audio.mode === "default"),
  );
  $("custom-sound").hidden = !audio.fileURL;
  $("custom-sound").setAttribute(
    "aria-checked",
    String(audio.mode === "local"),
  );
  $("custom-sound").querySelector("span").textContent = audio.fileName || "";
}

function render({ allowAlarm = true } = {}) {
  const { status, remaining } = timer.snapshot();
  const overtime = timer.overtime;
  const breakActive = (status === "running" || status === "paused") &&
    isBreakTitle(agenda.entries[agenda.activeIndex]?.title || "");
  $("overtime-label").hidden = !overtime;
  $("timer-face").classList.toggle("break-active", breakActive);
  const displayTime = formatTime(overtime ? Math.floor(-remaining / 1000) * 1000 : remaining);
  const value =
    editing && status === "idle" && !overtime ? editor.value : displayTime;
  if ($("timer-display").textContent !== value) {
    $("timer-display").textContent = value;
    $("timer-glow").textContent = value;
  }
  const [minutes, seconds] = displayTime.split(":").map(Number);
  $("timer-display").setAttribute(
    "aria-label",
    `${minutes} minutes, ${seconds} seconds ${overtime ? "overtime" : "remaining"}`,
  );
  if (!editing) {
    editor.value = formatTime(remaining);
    editorBaseline = editor.value;
  }
  const editable = !overtime && (status === "idle" || status === "finished");
  editor.hidden = !editable;
  $("display-action").hidden = editable;
  $("display-action").setAttribute(
    "aria-label",
    status === "running" ? "Pause timer" : "Resume timer",
  );
  $("status-label").textContent =
    overtime
      ? { running: "OVERTIME · CLICK TO PAUSE", paused: "OVERTIME PAUSED · CLICK TO RESUME", idle: "OVERTIME STOPPED · NEXT TO FINISH" }[status]
      : editing && status === "idle"
      ? "EDIT DURATION · MM:SS"
      : {
          idle: "STOPPED · CLICK TO EDIT",
          running: "RUNNING · CLICK TO PAUSE",
          paused: "PAUSED · CLICK TO RESUME",
          finished: "TIME’S UP · CLICK TO EDIT",
        }[status];
  $("start-label").textContent =
    status === "paused" || (status === "idle" && overtime) ? "Resume" : "Start";
  const draftChanged = editing && editor.value !== editorBaseline;
  $("start").disabled =
    status === "running" ||
    (status === "idle" && remaining === 0 && !overtime && !draftChanged && !agenda.dirty) ||
    (status === "finished" && timer.duration === 0);
  $("pause").disabled = status !== "running";
  $("stop").disabled = status === "idle" && !agenda.visible && !agenda.editingUnlocked;
  $("reset").disabled =
    status === "idle" &&
    timer.duration === 0 &&
    remaining === 0 &&
    !draftChanged && !agenda.dirty && !agenda.editingUnlocked;
  renderAgenda(status, remaining);
  const warning =
    (status === "running" || status === "paused") &&
    remaining > 0 &&
    remaining <= 10_000;
  if (
    warning &&
    status === "running" &&
    !$("timer-face").classList.contains("pulsing")
  ) {
    // Align each glow peak with the next displayed second, including after a pause.
    $("timer-face").style.setProperty(
      "--pulse-delay",
      `${-((1000 - (remaining % 1000)) % 1000)}ms`,
    );
  }
  $("timer-face").classList.toggle("warning", warning || status === "finished" || overtime);
  $("timer-face").classList.toggle("pulsing", warning && status === "running");
  $("timer-face").classList.toggle("extended-time", value.length > 5);
  $("timer-face").dataset.state = overtime && status === "running" ? "overtime" : status;
  $("timer-face").dataset.overtime = String(overtime);
  if (warning && status === "running" && !warned) {
    warned = true;
    announce("Ten seconds or less remaining.");
  }
  if ((status === "finished" || overtime) && !completionAnnounced) {
    completionAnnounced = true;
    announce(overtime ? "Time’s up! Overtime is being measured. Press Next when the slot ends." : "Time’s up! Your countdown is complete.");
    if (allowAlarm) void audio.play();
  }
  document.title =
    status === "running" || status === "paused"
      ? `${overtime ? "+" : ""}${displayTime} · Chicken Countdown`
      : status === "finished"
        ? "Time’s up! · Chicken Countdown"
        : "Chicken Countdown";
}

function renderAgenda(status = timer.status, remaining = timer.remaining) {
  $("timer-stage").classList.toggle("has-agenda", agenda.visible);
  $("agenda-panel").hidden = !agenda.visible;
  $("agenda-toggle").setAttribute("aria-pressed", String(agenda.visible));
  $("agenda-toggle").setAttribute("aria-expanded", String(agenda.visible));
  agendaEditor.readOnly = !agenda.editingUnlocked;
  setText("agenda-hint", agenda.editingUnlocked
    ? "MM:SS title · Space types a space · Enter adds a line"
    : agenda.adjusted ? "ADJUSTED TIMES · STOP TO EDIT PLAN" : "PRESS STOP TO EDIT");
  setText("agenda-total", `TOTAL ${formatTime(agenda.totalSeconds * 1000)}`);
  $("agenda-error").hidden = !agenda.errors.length;
  setText("agenda-error", agenda.errors.map(error => `Line ${error.line}: ${error.message}`).join(" "));
  agendaEditor.setAttribute("aria-invalid", String(agenda.errors.length > 0));
  const selected = agenda.entries[agenda.activeIndex];
  setText("agenda-selection", selected
    ? `Selected item ${agenda.activeIndex + 1}: ${selected.title}. Duration ${formatTime(agenda.selectedDuration)}.`
    : "No agenda item selected.");
  const permissions = agenda.permissions(status, remaining);
  for (const action of ["previous", "eject", "next"])
    $(`agenda-${action}`).disabled = !permissions[action];
  const finalSlot = agenda.activeIndex !== null && agenda.activeIndex === agenda.entries.length - 1;
  setText("agenda-next-label", finalSlot ? "Finish" : "Next");
  $("agenda-next").setAttribute("aria-label", finalSlot ? "Finish agenda" : "Next agenda item");
}

// The native textarea owns caret, selection, paste and undo. An unfocused text
// mirror gives each title a hanging indent without changing the underlying text.
let agendaMirrorText;
function positionAgendaSelection() {
  const mirror = $("agenda-measure");
  const nativeEditing = agenda.editingUnlocked && document.activeElement === agendaEditor;
  $("agenda-text-region").classList.toggle("native-editing", nativeEditing);
  let entryIndex = 0;
  const displayText = !agenda.dirty && !agenda.editingUnlocked
    ? agenda.draftText.replace(/^([ \t]*)\d{2}:\d{2}([ \t]+.+)$/gm,
      (_, indent, title) => `${indent}${formatTime(agenda.durations[entryIndex++])}${title}`)
    : agenda.draftText;
  if (agendaMirrorText !== displayText) {
    agendaMirrorText = displayText;
    mirror.replaceChildren();
    for (const line of displayText.split(/\r?\n/)) {
      const row = document.createElement("div");
      row.textContent = line || "\u200b";
      mirror.append(row);
    }
  }
  let nonemptyIndex = 0;
  let selectedLine = null;
  for (const row of mirror.children) {
    if (row.textContent.trim() && row.textContent !== "\u200b") {
      if (nonemptyIndex === agenda.activeIndex) selectedLine = row;
      nonemptyIndex++;
    }
  }
  const marker = $("agenda-marker");
  marker.hidden = !selectedLine;
  if (selectedLine) {
    const top = selectedLine.offsetTop - (nativeEditing ? agendaEditor.scrollTop : mirror.scrollTop);
    marker.style.top = `${top}px`;
    marker.hidden = top < 0 || top >= agendaEditor.clientHeight - 8;
  }
  return selectedLine;
}

function revealAgendaSelection() {
  const row = positionAgendaSelection();
  if (!row) return;
  const mirror = $("agenda-measure");
  if (row.offsetTop < mirror.scrollTop || row.offsetTop + 30 > mirror.scrollTop + mirror.clientHeight) {
    mirror.scrollTop = Math.max(0, row.offsetTop - 4);
    if (document.activeElement === agendaEditor) agendaEditor.scrollTop = mirror.scrollTop;
    positionAgendaSelection();
  }
}

function syncAgendaDraft() {
  // Assign only for explicit cancellation/clearing, so commits retain native undo.
  if (agendaEditor.value !== agenda.draftText) agendaEditor.value = agenda.draftText;
  positionAgendaSelection();
}

function configureTimer(duration) {
  timer.configure(duration, { allowOvertime: agenda.activeIndex !== null });
  completionAnnounced = false;
}

function commitAgenda({ revealError = false, allowAlarm = true } = {}) {
  const result = agenda.commit();
  if (!result.valid) {
    if (revealError) {
      agenda.visible = true;
      renderAgenda();
      agendaEditor.focus();
    }
    renderAgenda();
    announce($("agenda-error").textContent);
    return false;
  }
  if (result.changed) {
    audio.stop();
    configureTimer(result.duration);
    discardDraft();
    warned = false;
    savePreferences();
    announce(agenda.entries.length ? `Agenda saved. ${agenda.entries.length} items.` : "Agenda cleared.");
  }
  if (result.changed) revealAgendaSelection();
  else positionAgendaSelection();
  render({ allowAlarm });
  return true;
}

$("agenda-toggle").addEventListener("click", () => {
  if (agenda.visible) commitAgenda();
  agenda.visible = !agenda.visible;
  render();
  positionAgendaSelection();
});
agendaEditor.addEventListener("input", () => {
  if (!agenda.updateDraft(agendaEditor.value)) return;
  render({ allowAlarm: false });
  positionAgendaSelection();
});
agendaEditor.addEventListener("blur", event => {
  $("agenda-measure").scrollTop = agendaEditor.scrollTop;
  if (!["reset", "agenda-eject"].includes(event.relatedTarget?.id) && agenda.editingUnlocked) commitAgenda();
  positionAgendaSelection();
});
agendaEditor.addEventListener("focus", () => {
  agendaEditor.scrollTop = $("agenda-measure").scrollTop;
  positionAgendaSelection();
});
agendaEditor.addEventListener("scroll", positionAgendaSelection);
$("agenda-measure").addEventListener("scroll", positionAgendaSelection);
agendaEditor.addEventListener("wheel", event => {
  if (document.activeElement === agendaEditor) return;
  const mirror = $("agenda-measure");
  const delta = event.deltaY * (event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? mirror.clientHeight : 1);
  const canScroll = delta < 0 ? mirror.scrollTop > 0 : mirror.scrollTop + mirror.clientHeight < mirror.scrollHeight;
  if (canScroll) {
    event.preventDefault();
    mirror.scrollTop += delta;
  }
}, { passive: false });
new ResizeObserver(positionAgendaSelection).observe(agendaEditor);
document.fonts.ready.then(positionAgendaSelection);

function navigateAgenda(offset) {
  const last = agenda.activeIndex === agenda.entries.length - 1;
  if (agenda.activeIndex === null || (offset === -1 && agenda.activeIndex === 0) ||
      (offset === 1 && last && !timer.hasStarted)) return;
  // Only Next/Finish completes a started slot. Browsing an unstarted slot or
  // returning to a previous one never transfers an unused budget.
  timer.snapshot();
  const adjustment = offset === 1 && timer.hasStarted ? agenda.finishActive(timer.elapsed) : null;
  const finishing = offset === 1 && last;
  const duration = finishing ? agenda.selectedDuration : agenda.navigate(offset, timer.status, timer.remaining);
  if (duration === null) return;
  cancelClick();
  audio.stop();
  configureTimer(duration);
  agenda.lock();
  discardDraft();
  warned = false;
  savePreferences();
  const timing = adjustment?.overtime
    ? ` ${formatTime(adjustment.overtime)} overtime.${adjustment.unrecovered ? ` Meeting extended by ${formatTime(adjustment.unrecovered)}.` : ""}`
    : adjustment?.saved ? ` ${formatTime(adjustment.saved)} saved${finishing ? "." : " and added to the next slot."}` : "";
  announce(`${finishing ? "Agenda complete." : `Selected ${agenda.entries[agenda.activeIndex].title}. Press Start.`}${timing}`);
  render({ allowAlarm: false });
  revealAgendaSelection();
}
$("agenda-previous").addEventListener("click", () => navigateAgenda(-1));
$("agenda-next").addEventListener("click", () => navigateAgenda(1));
$("agenda-eject").addEventListener("click", () => {
  if (!agenda.eject(timer.status, timer.remaining)) return;
  cancelClick();
  audio.stop();
  timer.clear();
  completionAnnounced = false;
  discardDraft();
  syncAgendaDraft();
  warned = false;
  savePreferences();
  announce("Agenda and countdown cleared.");
  render({ allowAlarm: false });
});

function discardDraft() {
  editing = false;
  editor.value = formatTime(timer.remaining);
  editorBaseline = editor.value;
  clearError();
}

function commitEditor() {
  if (!editing || editor.value === editorBaseline) {
    clearError();
    return true;
  }
  try {
    const duration = durationFromInput(editor.value);
    configureTimer(duration);
    warned = false;
    editor.value = formatTime(duration);
    editorBaseline = editor.value;
    clearError();
    announce(`Duration set to ${editor.value}.`);
    render({ allowAlarm: false });
    return true;
  } catch (error) {
    showError(error.message);
    queueMicrotask(() => editor.focus());
    return false;
  }
}

function cancelClick() {
  clearTimeout(clickTimeout);
  clickTimeout = null;
}
function startTimer() {
  cancelClick();
  if (timer.status === "running") return;
  if (!commitAgenda({ revealError: true, allowAlarm: false })) return;
  if (timer.status === "idle" && !commitEditor()) return;
  const resuming = timer.status !== "finished" && timer.hasStarted;
  if (timer.status === "finished") completionAnnounced = false;
  audio.stop();
  if (!timer.start()) {
    showError("Set a time greater than 00:00 to start.");
    editor.focus();
    return;
  }
  audio.unlock();
  agenda.lock();
  positionAgendaSelection();
  if (!resuming) warned = false;
  discardDraft();
  showAudioMessage();
  announce(resuming ? "Countdown resumed." : "Countdown started.");
  render({ allowAlarm: false });
}

function pauseTimer() {
  cancelClick();
  agenda.lock();
  timer.pause();
  announce("Countdown paused.");
  render();
}

function stopTimer() {
  cancelClick();
  audio.stop();
  timer.stop();
  agenda.editingUnlocked = true;
  discardDraft();
  warned = false;
  announce(timer.overtime ? "Overtime stopped. Press Next to finish the slot or Resume to continue." : "Countdown stopped. Remaining time is editable.");
  render({ allowAlarm: false });
  if (agenda.visible) agendaEditor.focus();
}

function resetTimer() {
  cancelClick();
  audio.stop();
  timer.reset();
  completionAnnounced = false;
  agenda.lock({ discard: true });
  syncAgendaDraft();
  discardDraft();
  warned = false;
  announce("Countdown reset to your original duration.");
  render({ allowAlarm: false });
}

function clearTimer() {
  cancelClick();
  closeMenu();
  fileRequest++;
  audio.cancelSelection();
  audio.stop();
  timer.clear();
  completionAnnounced = false;
  agenda.lock({ discard: true });
  syncAgendaDraft();
  discardDraft();
  editor.blur();
  warned = false;
  showAudioMessage();
  announce("Countdown cleared.");
  render({ allowAlarm: false });
}

$("start").addEventListener("click", startTimer);
$("pause").addEventListener("click", pauseTimer);
$("stop").addEventListener("click", stopTimer);
$("reset").addEventListener("click", resetTimer);

editor.addEventListener("focus", () => {
  if (timer.status === "finished") {
    audio.stop();
    timer.stop();
  }
  if (!editing) {
    editor.value = formatTime(timer.remaining);
    editorBaseline = editor.value;
    editing = true;
  }
  render({ allowAlarm: false });
});
editor.addEventListener("blur", (event) => {
  if (["stop", "reset"].includes(event.relatedTarget?.id)) discardDraft();
  else if (!commitEditor()) return;
  editing = false;
  render({ allowAlarm: false });
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitEditor();
  }
});
editor.addEventListener("input", () => {
  editing = true;
  if (/^\d{4}$/.test(editor.value))
    editor.value = `${editor.value.slice(0, 2)}:${editor.value.slice(2)}`;
  clearError();
  render({ allowAlarm: false });
});

// Four fixed digit positions: deleting text never removes the colon.
editor.addEventListener("beforeinput", (event) => {
  if (
    !event.inputType.startsWith("insert") &&
    !event.inputType.startsWith("delete")
  )
    return;
  event.preventDefault();
  if (event.inputType === "insertFromPaste") return;
  const positions = [0, 1, 3, 4];
  const chars = (editor.value.length === 5 ? editor.value : "__:__").split("");
  let caret = editor.selectionStart;
  const end = editor.selectionEnd;
  editing = true;
  if (event.inputType.startsWith("insert") && event.data?.length > 1) {
    const match =
      /^(\d{1,2}):(\d{1,2})$/.exec(event.data) ||
      /^(\d{2})(\d{2})$/.exec(event.data);
    if (match) {
      editor.value = `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
      editor.setSelectionRange(5, 5);
      clearError();
      render({ allowAlarm: false });
      return;
    }
  }
  if (event.data === ":") {
    editor.setSelectionRange(3, 3);
    return;
  }
  if (event.inputType.startsWith("insert") && !/^\d+$/.test(event.data || ""))
    return;
  for (const position of positions)
    if (position >= caret && position < end) chars[position] = "_";
  if (event.inputType.startsWith("delete")) {
    if (caret === end) {
      const position = event.inputType.includes("Backward")
        ? positions.filter((p) => p < caret).at(-1)
        : positions.find((p) => p >= caret);
      if (position !== undefined) {
        chars[position] = "_";
        caret = position;
      }
    }
  } else {
    for (const digit of event.data) {
      const position = positions.find((p) => p >= caret);
      if (position === undefined) break;
      chars[position] = digit;
      caret = position + 1;
      if (caret === 2) caret = 3;
    }
  }
  editor.value = chars.join("");
  editor.setSelectionRange(caret, caret);
  clearError();
  render({ allowAlarm: false });
});
editor.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData.getData("text").trim();
  const match =
    /^(\d{1,2}):(\d{1,2})$/.exec(text) || /^(\d{2})(\d{2})$/.exec(text);
  if (!match) {
    editing = true;
    editor.value = "__:__";
    showError("Enter a complete time from 00:00 to 99:59.");
    render({ allowAlarm: false });
    return;
  }
  editing = true;
  editor.value = `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
  editor.setSelectionRange(5, 5);
  clearError();
  render({ allowAlarm: false });
});

$("display-action").addEventListener("click", (event) => {
  if (event.detail > 1) return;
  gestureInitialState = timer.status;
  cancelClick();
  clickTimeout = setTimeout(() => {
    clickTimeout = null;
    if (gestureInitialState === "running" && timer.status === "running")
      pauseTimer();
    else if ((gestureInitialState === "paused" && timer.status === "paused") ||
             (gestureInitialState === "idle" && timer.overtime))
      startTimer();
  }, 300);
});
$("display-action").addEventListener("dblclick", () => {
  cancelClick();
  if (gestureInitialState === "running") resetTimer();
  else if (gestureInitialState === "paused" && timer.status === "paused")
    startTimer();
});

document.addEventListener(
  "keydown",
  (event) => {
    if (event.code === "Space" || event.key === " ") {
      if (event.target === agendaEditor) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (timer.status === "running") pauseTimer();
      else startTimer();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) clearTimer();
    }
  },
  true,
);

$("volume").addEventListener("input", () => {
  preferences.volume = Number($("volume").value);
  preferences.muted = preferences.volume === 0;
  if (preferences.volume > 0) preferences.lastNonzero = preferences.volume;
  audio.setVolume(preferences.volume / 100);
  audio.setMuted(preferences.muted);
  renderSettings();
  savePreferences();
});
$("volume").addEventListener("pointerdown", () =>
  $("control-dock").classList.add("dragging"),
);
document.addEventListener("pointerup", () =>
  $("control-dock").classList.remove("dragging"),
);
$("mute").addEventListener("click", () => {
  preferences.muted = !preferences.muted;
  if (!preferences.muted && preferences.volume === 0)
    preferences.volume = preferences.lastNonzero || 60;
  audio.setVolume(preferences.volume / 100);
  audio.setMuted(preferences.muted);
  renderSettings();
  savePreferences();
});
document.querySelectorAll("button[data-theme]").forEach((button) =>
  button.addEventListener("click", () => {
    preferences.theme = button.dataset.theme;
    renderSettings();
    savePreferences();
  }),
);

function closeMenu({ focus = false } = {}) {
  $("sound-menu").hidden = true;
  $("sound-selector").setAttribute("aria-expanded", "false");
  $("control-dock").classList.remove("menu-open");
  if (focus) $("sound-selector").focus();
}

$("sound-selector").addEventListener("click", () => {
  if (!$("sound-menu").hidden) {
    closeMenu();
    return;
  }
  $("sound-menu").hidden = false;
  $("sound-selector").setAttribute("aria-expanded", "true");
  $("control-dock").classList.add("menu-open");
  $("sound-menu").querySelector('[aria-checked="true"]').focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!$("sound-controls").contains(event.target)) closeMenu();
});
$("sound-menu").addEventListener("keydown", (event) => {
  const items = [...$("sound-menu").querySelectorAll("button:not([hidden])")];
  const index = items.indexOf(document.activeElement);
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  items[next].focus();
});
function selectSound(mode) {
  fileRequest++;
  audio.setMode(mode);
  preferences.customName = mode === "local" ? audio.fileName : null;
  showAudioMessage();
  renderSettings();
  savePreferences();
  closeMenu({ focus: true });
}
$("default-sound").addEventListener("click", () => selectSound("default"));
$("custom-sound").addEventListener("click", () => selectSound("local"));
$("choose-file").addEventListener("click", () => {
  closeMenu({ focus: true });
  $("audio-file").click();
});
$("audio-file").addEventListener("change", async () => {
  const file = $("audio-file").files[0];
  if (!file) return;
  $("audio-file").value = "";
  const request = ++fileRequest;
  showAudioMessage("Checking audio file…");
  try {
    if (!(await audio.selectFile(file)) || request !== fileRequest) return;
    preferences.customName = file.name;
    showAudioMessage();
    renderSettings();
    savePreferences();
  } catch (error) {
    if (request === fileRequest) showAudioMessage(error.message);
  }
});

function setupFullscreenDock() {
  // Chromium also updates this query for browser full screen (F11).
  const displayMode = matchMedia("(display-mode: fullscreen)");
  const dock = $("control-dock");
  let fullscreen = false;
  let idleTimeout;

  function hideWhenIdle() {
    if (
      dock.classList.contains("menu-open") ||
      dock.classList.contains("dragging")
    ) {
      idleTimeout = setTimeout(hideWhenIdle, 2500);
      return;
    }
    document.body.classList.add("fullscreen-idle");
  }
  function reveal() {
    clearTimeout(idleTimeout);
    document.body.classList.remove("fullscreen-idle");
    if (fullscreen) idleTimeout = setTimeout(hideWhenIdle, 2500);
  }
  function syncMode() {
    const wasFullscreen = fullscreen;
    fullscreen = displayMode.matches || Boolean(document.fullscreenElement);
    if (fullscreen && !wasFullscreen) closeMenu();
    reveal();
  }

  displayMode.addEventListener("change", syncMode);
  document.addEventListener("fullscreenchange", syncMode);
  document.addEventListener("pointermove", reveal, { passive: true });
  document.addEventListener("pointerdown", reveal, { passive: true });
  document.addEventListener("focusin", (event) => {
    if (dock.contains(event.target)) reveal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" || dock.contains(event.target)) reveal();
  });
  window.addEventListener("pagehide", () => clearTimeout(idleTimeout));
  syncMode();
}

if (preferences.customName) {
  preferences.customName = null;
  savePreferences();
}
audio.setVolume(preferences.volume / 100);
audio.setMuted(preferences.muted);
renderSettings();
render();
setupFullscreenDock();
setInterval(render, 100);
document.addEventListener("visibilitychange", () => render());
window.addEventListener("pagehide", () => {
  audio.cancelSelection();
  audio.stop();
});
