// narrator.js: voiceover (Web Speech API), ambient beds and small sound effects (Web Audio).
// Everything is generated in the browser. No audio files.

export class Narrator {
  constructor() {
    this.voiceOn = true;
    this.ambientOn = true;
    this.sfxOn = true;
    this.rate = 0.92;
    this.pitch = 0.8;
    this.volume = 1;
    this.voiceURI = "";
    this.voices = [];
    this.queue = [];
    this.busy = false;
    this.ac = null;
    this.mood = "off";
    this.baseNight = 55;
    this.baseDay = 196;
    this._beds = null;
    this.onVoices = () => {};
    this._loadVoices();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener?.("voiceschanged", () => this._loadVoices());
    }
  }

  get supported() {
    return "speechSynthesis" in window;
  }

  _loadVoices() {
    if (!this.supported) return;
    this.voices = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang) || !v.lang);
    this.onVoices(this.voices);
  }

  _pickVoice() {
    if (!this.voices.length) return null;
    const chosen = this.voices.find((v) => v.voiceURI === this.voiceURI);
    if (chosen) return chosen;
    const prefer = /(daniel|google uk english male|guy|alex|fred|arthur|male)/i;
    return this.voices.find((v) => prefer.test(v.name)) || this.voices[0];
  }

  /** Call from a click handler: browsers block audio until the user interacts. */
  unlock() {
    this._ensureAudio();
    if (this.ac && this.ac.state === "suspended") this.ac.resume();
    if (this.supported) {
      try {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
      } catch {}
    }
  }

  speak(text) {
    if (!this.voiceOn || !this.supported || !text) return;
    if (this.queue.length > 3) this.queue.shift(); // never fall far behind the game
    this.queue.push(text);
    this._next();
  }

  stop() {
    this.queue = [];
    this.busy = false;
    if (this.supported) window.speechSynthesis.cancel();
  }

  _next() {
    if (this.busy || !this.queue.length) return;
    const text = this.queue.shift();
    const u = new SpeechSynthesisUtterance(text);
    const v = this._pickVoice();
    if (v) u.voice = v;
    u.rate = this.rate;
    u.pitch = this.pitch;
    u.volume = this.volume;
    this.busy = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      this.busy = false;
      setTimeout(() => this._next(), 250);
    };
    // Some browsers never fire onend, so guard with a timeout.
    const guard = setTimeout(finish, 3500 + text.length * 95);
    u.onend = finish;
    u.onerror = finish;
    try {
      window.speechSynthesis.speak(u);
    } catch {
      finish();
    }
  }

  // ---------- Web Audio ----------
  _ensureAudio() {
    if (this.ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ac.destination);
    this._buildBeds();
  }

  _noiseBuffer() {
    const ac = this.ac;
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildBeds() {
    const ac = this.ac;
    const noise = this._noiseBuffer();
    const mk = (freq, noiseHz, noiseGain, droneGain) => {
      const out = ac.createGain();
      out.gain.value = 0;
      out.connect(this.master);
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      lp.connect(out);
      const oscs = [1, 1.5, 2.01].map((m, i) => {
        const o = ac.createOscillator();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = freq * m;
        o.detune.value = (i - 1) * 6;
        const g = ac.createGain();
        g.gain.value = droneGain / (i + 1);
        o.connect(g);
        g.connect(lp);
        o.start();
        return o;
      });
      const src = ac.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = noiseHz;
      bp.Q.value = 0.6;
      const ng = ac.createGain();
      ng.gain.value = noiseGain;
      src.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      src.start();
      return { out, oscs };
    };
    this._beds = {
      night: mk(this.baseNight, 1400, 0.035, 0.05), // low drone + rain-like hiss
      day: mk(this.baseDay, 600, 0.008, 0.018), // soft airy pad
    };
  }

  setBase(night, day) {
    this.baseNight = night || 55;
    this.baseDay = day || 196;
    if (!this._beds) return;
    const t = this.ac.currentTime;
    this._beds.night.oscs.forEach((o, i) => o.frequency.setTargetAtTime(this.baseNight * [1, 1.5, 2.01][i], t, 0.5));
    this._beds.day.oscs.forEach((o, i) => o.frequency.setTargetAtTime(this.baseDay * [1, 1.5, 2.01][i], t, 0.5));
  }

  /** mood: "night" | "day" | "off" */
  setMood(mood) {
    this.mood = mood;
    if (!this.ac) return;
    const m = this.ambientOn ? mood : "off";
    const t = this.ac.currentTime;
    const lvl = { night: 1, day: 1 };
    this._beds.night.out.gain.setTargetAtTime(m === "night" ? lvl.night : 0, t, 1.2);
    this._beds.day.out.gain.setTargetAtTime(m === "day" ? lvl.day : 0, t, 1.2);
  }

  setAmbient(on) {
    this.ambientOn = on;
    this.setMood(this.mood);
  }

  _tone(freq, dur, { type = "sine", gain = 0.18, attack = 0.01, slideTo = null, delay = 0 } = {}) {
    if (!this.sfxOn || !this.ac) return;
    const ac = this.ac;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  sfx(name) {
    if (!this.sfxOn) return;
    this._ensureAudio();
    if (!this.ac) return;
    switch (name) {
      case "night":
        this._tone(196, 3.2, { gain: 0.16, attack: 0.02 });
        this._tone(392.5, 2.4, { gain: 0.06, attack: 0.02 });
        break;
      case "dawn":
        this._tone(392, 1.4, { gain: 0.08, delay: 0 });
        this._tone(523.3, 1.8, { gain: 0.08, delay: 0.35 });
        this._tone(659.3, 2.2, { gain: 0.07, delay: 0.7 });
        break;
      case "death":
        this._tone(220, 1.6, { type: "triangle", gain: 0.14, slideTo: 90 });
        break;
      case "gavel":
        this._tone(140, 0.35, { type: "square", gain: 0.12, slideTo: 60 });
        this._tone(140, 0.35, { type: "square", gain: 0.1, slideTo: 60, delay: 0.22 });
        break;
      case "tick":
        this._tone(880, 0.07, { gain: 0.06, attack: 0.005 });
        break;
      case "win":
        [392, 523.3, 659.3, 784].forEach((f, i) => this._tone(f, 1.6, { gain: 0.07, delay: i * 0.18 }));
        break;
      case "lose":
        [330, 262, 196].forEach((f, i) => this._tone(f, 1.8, { type: "triangle", gain: 0.09, delay: i * 0.3 }));
        break;
    }
  }
}
