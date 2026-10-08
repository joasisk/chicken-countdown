import { Countdown, durationFromInput, formatTime } from "./timer.js";
import { AlarmAudio } from "./audio.js";

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
  }
} catch {
  /* Storage is optional; the timer also works without it. */
}

let previousStatus = "idle";
let warned = false;
let editing = false;
let editorBaseline = "00:00";
let fileRequest = 0;
let clickTimeout;
let gestureInitialState;
const audio = new AlarmAudio({ onMessage: showAudioMessage });

function savePreferences() {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    /* Private browsing may disable storage. */
  }
}

function announce(message) {
  $("announcer").textContent = message;
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
  const value =
    editing && status === "idle" ? editor.value : formatTime(remaining);
  if ($("timer-display").textContent !== value) {
    $("timer-display").textContent = value;
    $("timer-glow").textContent = value;
  }
  const [minutes, seconds] = formatTime(remaining).split(":").map(Number);
  $("timer-display").setAttribute(
    "aria-label",
    `${minutes} minutes, ${seconds} seconds remaining`,
  );
  if (!editing) {
    editor.value = formatTime(remaining);
    editorBaseline = editor.value;
  }
  const editable = status === "idle" || status === "finished";
  editor.hidden = !editable;
  $("display-action").hidden = editable;
  $("display-action").setAttribute(
    "aria-label",
    status === "paused" ? "Resume timer" : "Pause timer",
  );
  $("status-label").textContent =
    editing && status === "idle"
      ? "EDIT DURATION · MM:SS"
      : {
          idle: "STOPPED · CLICK TO EDIT",
          running: "RUNNING · CLICK TO PAUSE",
          paused: "PAUSED · CLICK TO RESUME",
          finished: "TIME’S UP · CLICK TO EDIT",
        }[status];
  $("start").querySelector("span").textContent =
    status === "paused" ? "Resume" : "Start";
  const draftChanged = editing && editor.value !== editorBaseline;
  $("start").disabled =
    status === "running" ||
    (status === "idle" && remaining === 0 && !draftChanged) ||
    (status === "finished" && timer.duration === 0);
  $("pause").disabled = status !== "running";
  $("stop").disabled = status === "idle";
  $("reset").disabled =
    status === "idle" &&
    timer.duration === 0 &&
    remaining === 0 &&
    !draftChanged;
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
  $("timer-face").classList.toggle("warning", warning || status === "finished");
  $("timer-face").classList.toggle("pulsing", warning && status === "running");
  $("timer-face").dataset.state = status;
  if (warning && status === "running" && !warned) {
    warned = true;
    announce("Ten seconds or less remaining.");
  }
  if (status === "finished" && previousStatus !== "finished") {
    announce("Time’s up! Your countdown is complete.");
    if (allowAlarm) void audio.play();
  }
  document.title =
    status === "running" || status === "paused"
      ? `${formatTime(remaining)} · Chicken Countdown`
      : status === "finished"
        ? "Time’s up! · Chicken Countdown"
        : "Chicken Countdown";
  previousStatus = status;
}

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
    timer.configure(duration);
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
  if (timer.status === "idle" && !commitEditor()) return;
  const resuming = timer.status === "paused";
  audio.stop();
  if (!timer.start()) {
    showError("Set a time greater than 00:00 to start.");
    editor.focus();
    return;
  }
  audio.unlock();
  if (!resuming) warned = false;
  discardDraft();
  showAudioMessage();
  announce(resuming ? "Countdown resumed." : "Countdown started.");
  render({ allowAlarm: false });
}

function pauseTimer() {
  cancelClick();
  timer.pause();
  announce("Countdown paused.");
  render();
}

function stopTimer() {
  cancelClick();
  audio.stop();
  timer.stop();
  discardDraft();
  warned = false;
  announce("Countdown stopped. Remaining time is editable.");
  render({ allowAlarm: false });
}

function resetTimer() {
  cancelClick();
  audio.stop();
  timer.reset();
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
    else if (gestureInitialState === "paused" && timer.status === "paused")
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
    const focused = document.activeElement;
    if (
      dock.matches(":hover") ||
      (dock.contains(focused) && focused.matches(":focus-visible")) ||
      dock.classList.contains("menu-open") ||
      dock.classList.contains("dragging") ||
      !$("audio-message").hidden
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
    fullscreen = displayMode.matches || Boolean(document.fullscreenElement);
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
    if (event.key === "Tab") reveal();
  });
  window.addEventListener("pagehide", () => clearTimeout(idleTimeout));
  syncMode();
}

if (preferences.customName) {
  showAudioMessage("Custom sound unavailable. Using chicken orchestra.");
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
