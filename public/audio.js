export const DEFAULT_SOUND_URL = new URL(
  "./sounds/screaming-chickens.mp3",
  import.meta.url,
).href;

export class AlarmAudio {
  constructor({ onMessage }) {
    this.onMessage = onMessage;
    this.mode = "default";
    this.volume = 0.6;
    this.muted = false;
    this.audio = new Audio(DEFAULT_SOUND_URL);
    this.audio.preload = "auto";
    this.audio.volume = this.volume;
    this.fileURL = null;
    this.fileName = null;
    this.generation = 0;
    this.selectionGeneration = 0;
  }

  setMode(mode) {
    this.cancelSelection();
    this.stop();
    this.mode = mode;
    this.audio.src =
      mode === "local" && this.fileURL ? this.fileURL : DEFAULT_SOUND_URL;
    this.audio.load();
  }

  cancelSelection() {
    this.selectionGeneration++;
  }

  async selectFile(file) {
    const generation = ++this.selectionGeneration;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("Audio decoding is unavailable.");
      if (!this.decoder) this.decoder = new Context();
      const decoded = await this.decoder.decodeAudioData(
        await file.arrayBuffer(),
      );
      if (!decoded.duration) throw new Error("Empty audio file.");
      if (generation !== this.selectionGeneration) return false;
      this.stop();
      if (this.fileURL) URL.revokeObjectURL(this.fileURL);
      this.fileURL = URL.createObjectURL(file);
      this.fileName = file.name;
      this.setMode("local");
      return true;
    } catch {
      if (generation !== this.selectionGeneration) return false;
      throw new Error("This audio file cannot be played. Choose another file.");
    }
  }

  setVolume(volume) {
    this.volume = volume;
    this.audio.volume = volume;
  }

  setMuted(muted) {
    if (muted && !this.muted) this.stop();
    this.muted = muted;
    this.audio.muted = muted;
  }

  // Enable this media element during the user's start/resume gesture.
  unlock() {
    if (this.muted || this.volume === 0) return;
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
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  async play() {
    this.stop();
    if (this.muted || this.volume === 0) return;
    const generation = this.generation;
    try {
      this.audio.volume = this.volume;
      this.audio.currentTime = 0;
      await this.audio.play();
    } catch (error) {
      if (generation !== this.generation) return;
      this.onMessage(
        error.name === "NotAllowedError"
          ? "Sound blocked. Check your browser’s audio permissions."
          : "The alarm could not play. Choose another audio file.",
      );
    }
  }
}
