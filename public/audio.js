export const DEFAULT_SOUND_URL = new URL(
  "./sounds/screaming-chickens.mp3",
  import.meta.url,
).href;

export class AlarmAudio {
  constructor({ onMessage, onSampleEnd }) {
    this.onMessage = onMessage;
    this.onSampleEnd = onSampleEnd;
    this.mode = "default";
    this.volume = 0.8;
    this.audio = new Audio(DEFAULT_SOUND_URL);
    this.audio.preload = "auto";
    this.audio.volume = this.volume;
    this.fileURL = null;
    this.context = null;
    this.oscillators = new Set();
    this.generation = 0;
    this.sampling = false;
    this.audio.addEventListener("ended", () => {
      const sampling = this.sampling;
      this.stop();
      this.onMessage(
        sampling
          ? "Sound test complete."
          : "Alarm finished. Start again whenever you’re ready.",
      );
      if (sampling) this.onSampleEnd?.();
    });
  }

  setMode(mode) {
    this.stop();
    this.mode = mode;
    const source = mode === "default" ? DEFAULT_SOUND_URL : this.fileURL;
    if (source) this.audio.src = source;
    else this.audio.removeAttribute("src");
    this.audio.load();
  }

  setVolume(volume) {
    this.volume = volume;
    this.audio.volume = volume;
  }

  setFile(file) {
    this.stop();
    if (this.fileURL) URL.revokeObjectURL(this.fileURL);
    this.fileURL = URL.createObjectURL(file);
    this.setMode("local");
  }

  // Prime the same media element during a click so later playback can be audible.
  unlock({ prime = true } = {}) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context && !this.context) this.context = new Context();
    this.context?.resume().catch(() => {});
    if (!prime || (this.mode === "local" && !this.fileURL)) return;
    const generation = this.generation;
    this.audio.volume = 0;
    this.audio
      .play()
      .then(() => {
        if (this.generation !== generation) return;
        this.audio.pause();
        this.audio.currentTime = 0;
        this.audio.volume = this.volume;
      })
      .catch(() => {
        if (this.generation === generation) this.audio.volume = this.volume;
      });
  }

  stop() {
    this.generation++;
    this.sampling = false;
    clearInterval(this.bellInterval);
    clearTimeout(this.sampleTimeout);
    this.audio.pause();
    if (this.audio.getAttribute("src")) this.audio.currentTime = 0;
    for (const oscillator of this.oscillators) {
      try {
        oscillator.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.oscillators.clear();
  }

  async play({ sample = false } = {}) {
    this.stop();
    this.sampling = sample;
    const generation = this.generation;
    try {
      if (this.mode === "local" && !this.fileURL)
        throw new Error("Choose an audio file first.");
      this.audio.currentTime = 0;
      this.audio.volume = this.volume;
      await this.audio.play();
      if (generation !== this.generation) return;
      this.onMessage(
        sample
          ? "Playing a short sample. Click Stop test to end it."
          : "Time’s up! Playing your alarm.",
      );
    } catch (error) {
      if (generation !== this.generation) return;
      const message =
        error.name === "NotSupportedError"
          ? "This audio file can’t be played in your browser."
          : error.name === "NotAllowedError"
            ? "Your browser blocked audio playback."
            : "The selected sound couldn’t play.";
      const played = await this.playBell();
      if (generation !== this.generation) return;
      this.onMessage(
        played
          ? `${message} Playing the backup bell. Choose another file or try Test sound again.`
          : `${message} Click Test sound to allow playback, and check your device volume.`,
      );
    }
    if (sample && generation === this.generation) {
      this.sampleTimeout = setTimeout(() => {
        this.stop();
        this.onMessage("Sound test complete.");
        this.onSampleEnd?.();
      }, 8_000);
    }
  }

  async playBell() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    if (!this.context) this.context = new Context();
    const generation = this.generation;
    try {
      await this.context.resume();
      if (generation !== this.generation || this.context.state !== "running")
        return false;
      const ring = () => {
        for (const [index, frequency] of [784, 1047, 1319].entries()) {
          const oscillator = this.context.createOscillator();
          const gain = this.context.createGain();
          const start = this.context.currentTime + index * 0.18;
          oscillator.type = "sine";
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(this.volume * 0.2, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
          oscillator.connect(gain).connect(this.context.destination);
          this.oscillators.add(oscillator);
          oscillator.onended = () => {
            this.oscillators.delete(oscillator);
            oscillator.disconnect();
            gain.disconnect();
          };
          oscillator.start(start);
          oscillator.stop(start + 0.65);
        }
      };
      ring();
      this.bellInterval = setInterval(ring, 2_000);
      return true;
    } catch {
      return false;
    }
  }
}
