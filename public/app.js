import { Countdown, durationFromParts, timeParts } from "./timer.js";
import { AlarmAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const timer = new Countdown();
let previousStatus = "idle";
let testing = false;
let alarmStopped = false;
const audio = new AlarmAudio({
  onMessage: (message) => {
    $("sound-status").textContent = message;
  },
  onSampleEnd: () => {
    testing = false;
    $("test-sound").querySelector("span").textContent = "Test sound";
  },
});
document.querySelector('input[name="sound"][value="default"]').checked = true;

function stopAudio() {
  audio.stop();
  testing = false;
  $("test-sound").querySelector("span").textContent = "Test sound";
}

function render() {
  const { status, remaining, progress } = timer.snapshot();
  const [hours, minutes, seconds] = timeParts(remaining);
  $("display-hours").textContent = hours;
  $("display-minutes").textContent = minutes;
  $("display-seconds").textContent = seconds;
  $("timer-display").setAttribute(
    "aria-label",
    `${Number(hours)} hours, ${Number(minutes)} minutes, ${Number(seconds)} seconds remaining`,
  );
  const percentage = Math.round(progress * 100);
  $("progress-fill").style.width = `${percentage}%`;
  document
    .querySelector(".progress-track")
    .setAttribute("aria-valuenow", percentage);
  $("status-label").textContent = {
    idle: "READY WHEN YOU ARE",
    running: "A LITTLE FOCUS TIME",
    paused: "TAKE A BREATHER",
    finished: "THE BIG FINISH",
  }[status];
  $("timer-message").textContent = {
    idle: "One thing at a time. You've got this.",
    running: "Go do your thing. We’re keeping time.",
    paused: "Your time is waiting right here.",
    finished: "Well done. Time for your grand finale.",
  }[status];
  const button = $("start");
  button.querySelector("span").textContent = {
    idle: "Start countdown",
    running: "Pause countdown",
    paused: "Resume countdown",
    finished: "Start again",
  }[status];
  button
    .querySelector("path")
    .setAttribute(
      "d",
      status === "running" ? "M7 5h4v14H7zM15 5h4v14h-4z" : "m9 5 11 7-11 7z",
    );
  $("timer-card").classList.toggle("finished", status === "finished");
  $("finish-notice").hidden = status !== "finished";
  document
    .querySelectorAll(
      "#duration-form input, #duration-form button, .presets button",
    )
    .forEach((input) => {
      input.disabled = status === "running" || status === "paused";
    });
  document
    .querySelectorAll("input[name=sound], #audio-file")
    .forEach((input) => {
      input.disabled = status === "running" || status === "paused";
    });
  $("test-sound").disabled = status === "running";
  if (status === "finished" && previousStatus !== "finished") {
    stopAudio();
    alarmStopped = false;
    $("stop-alarm").disabled = false;
    $("stop-alarm").textContent = "Stop sound";
    $("announcer").textContent = "Time’s up! Your countdown is complete.";
    void audio.play();
  }
  document.title =
    status === "running" || status === "paused"
      ? `${hours}:${minutes}:${seconds} · Chicken Countdown`
      : status === "finished"
        ? "Time’s up! · Chicken Countdown"
        : "Chicken Countdown";
  previousStatus = status;
}

function resetTimer() {
  stopAudio();
  timer.reset();
  $("announcer").textContent = "Countdown reset.";
  render();
}

function configureDuration(duration) {
  stopAudio();
  timer.configure(duration);
  const [hours, minutes, seconds] = timeParts(duration);
  $("hours").value = Number(hours);
  $("minutes").value = Number(minutes);
  $("seconds").value = Number(seconds);
  document.querySelectorAll("[data-minutes]").forEach((button) => {
    const selected = Number(button.dataset.minutes) * 60_000 === duration;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("duration-error").hidden = true;
  $("announcer").textContent =
    `Countdown set to ${Number(hours)} hours, ${Number(minutes)} minutes, ${Number(seconds)} seconds.`;
  render();
}

$("start").addEventListener("click", () => {
  // Process a deadline that passed between the last render and this click.
  render();
  if (timer.status === "running") {
    timer.pause();
    $("announcer").textContent = "Countdown paused.";
  } else {
    if (audio.mode === "local" && !audio.fileURL) {
      $("sound-status").textContent =
        "Choose an audio file first, or switch to the Chicken alarm.";
      $("audio-file").focus();
      return;
    }
    stopAudio();
    audio.unlock();
    timer.start();
    $("announcer").textContent = "Countdown started.";
  }
  render();
});
$("reset").addEventListener("click", resetTimer);
document
  .querySelectorAll("[data-minutes]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      configureDuration(Number(button.dataset.minutes) * 60_000),
    ),
  );
$("duration-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    configureDuration(
      durationFromParts(
        $("hours").value,
        $("minutes").value,
        $("seconds").value,
      ),
    );
  } catch (error) {
    $("duration-error").textContent = error.message;
    $("duration-error").hidden = false;
  }
});
document.querySelectorAll("input[name=sound]").forEach((input) =>
  input.addEventListener("change", () => {
    stopAudio();
    audio.setMode(input.value);
    $("default-option").hidden = input.value !== "default";
    $("local-option").hidden = input.value !== "local";
    $("sound-status").textContent =
      input.value === "local"
        ? audio.fileURL
          ? "Your custom sound is ready. Test it before starting the countdown."
          : "Choose an audio file from your device. It stays local and works offline."
        : "The chicken alarm is ready. Test the sound before your first countdown.";
  }),
);
$("audio-file").addEventListener("change", () => {
  const file = $("audio-file").files[0];
  if (!file) return;
  stopAudio();
  audio.setFile(file);
  $("file-name").textContent = file.name;
  $("sound-status").textContent =
    "Your audio file is ready. Test it before starting the countdown.";
});
$("volume").addEventListener("input", () => {
  audio.setVolume(Number($("volume").value) / 100);
  $("volume-value").textContent = `${$("volume").value}%`;
});
$("test-sound").addEventListener("click", () => {
  if (testing) {
    stopAudio();
    $("sound-status").textContent = "Sound test stopped.";
    return;
  }
  if (audio.mode === "local" && !audio.fileURL) {
    $("sound-status").textContent = "Choose an audio file first.";
    $("audio-file").focus();
    return;
  }
  stopAudio();
  testing = true;
  $("test-sound").querySelector("span").textContent = "Stop test";
  audio.unlock({ prime: false });
  void audio.play({ sample: true });
});
$("stop-alarm").addEventListener("click", () => {
  if (alarmStopped) return;
  stopAudio();
  alarmStopped = true;
  $("stop-alarm").textContent = "Sound stopped";
  $("stop-alarm").disabled = true;
  $("sound-status").textContent =
    "Alarm stopped. Start again whenever you’re ready.";
});
$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("timer-card").requestFullscreen();
  } catch {
    $("announcer").textContent = "Fullscreen is unavailable in this browser.";
  }
});
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").setAttribute(
    "aria-label",
    document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen",
  );
});
document.addEventListener("visibilitychange", render);
window.addEventListener("pagehide", () => stopAudio());
setInterval(render, 100);
render();
