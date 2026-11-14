/** Tiny synthesized sound layer; no external audio files or network requests. */
export class SoundFX {
  constructor() { this.context = null; this.enabled = true; }
  _ctx() {
    if (!this.enabled) return null;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      this.context ||= new AudioContext();
      if (this.context.state === 'suspended') this.context.resume();
      return this.context;
    } catch { return null; }
  }
  tone({ frequency = 220, end = 80, duration = .18, type = 'sawtooth', volume = .08, delay = 0 } = {}) {
    const ctx = this._ctx(); if (!ctx) return;
    const start = ctx.currentTime + delay, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, start); osc.frequency.exponentialRampToValueAtTime(Math.max(25, end), start + duration);
    gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + .015); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(start); osc.stop(start + duration + .03);
  }
  attack() { this.tone({ frequency: 520, end: 130, duration: .22, type: 'triangle', volume: .055 }); }
  impact() { this.tone({ frequency: 115, end: 38, duration: .24, type: 'sawtooth', volume: .12 }); this.tone({ frequency: 760, end: 180, duration: .12, type: 'square', volume: .035 }); }
  ultimate() { this.tone({ frequency: 95, end: 620, duration: .55, type: 'sawtooth', volume: .1 }); this.tone({ frequency: 440, end: 70, duration: .7, type: 'triangle', volume: .07, delay: .18 }); }
  round() { [330,440,660].forEach((f,i)=>this.tone({frequency:f,end:f*1.4,duration:.22,type:'sine',volume:.045,delay:i*.12})); }
}
