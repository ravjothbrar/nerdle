// Procedural sound effects via the Web Audio API — no audio files to load,
// nothing to license, instant start. The context is created lazily on the
// first user gesture (browsers block audio before that).

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (muted) return null;
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, { at = 0, dur = 0.15, type = 'sine', gain = 0.3, slide = 0 } = {}) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.2, gain = 0.3, filter = 900 } = {}) {
    const c = ensure();
    if (!c) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(master);
    src.start();
  }

  const note = (semi) => 523.25 * 2 ** (semi / 12); // from C5

  return {
    unlock: ensure,
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    get muted() {
      return muted;
    },
    /** Correct lane: a two-note chime that climbs with the streak. */
    coin(streak = 1) {
      const i = Math.min(PENTATONIC.length - 2, (streak - 1) % 8);
      tone(note(PENTATONIC[i]), { dur: 0.12, type: 'triangle', gain: 0.22 });
      tone(note(PENTATONIC[i + 1] + 12), { at: 0.06, dur: 0.22, type: 'sine', gain: 0.18 });
    },
    multiplier() {
      [0, 4, 7, 12].forEach((s, k) => tone(note(s + 12), { at: k * 0.05, dur: 0.18, type: 'triangle', gain: 0.16 }));
    },
    lane() {
      tone(900, { dur: 0.05, type: 'sine', gain: 0.05, slide: 1.3 });
    },
    bump() {
      tone(160, { dur: 0.08, type: 'square', gain: 0.05 });
    },
    jump() {
      tone(330, { dur: 0.18, type: 'sine', gain: 0.12, slide: 2 });
    },
    duck() {
      tone(420, { dur: 0.14, type: 'sine', gain: 0.1, slide: 0.5 });
    },
    shield() {
      noise({ dur: 0.25, gain: 0.35, filter: 1400 });
      tone(700, { dur: 0.3, type: 'triangle', gain: 0.15, slide: 0.4 });
    },
    death() {
      noise({ dur: 0.4, gain: 0.3, filter: 600 });
      [0, -3, -7, -12].forEach((s, k) =>
        tone(note(s - 5), { at: 0.08 + k * 0.12, dur: 0.22, type: 'triangle', gain: 0.18 }),
      );
    },
    unlockOp() {
      [7, 12, 16, 19, 24].forEach((s, k) => tone(note(s), { at: k * 0.06, dur: 0.2, type: 'sine', gain: 0.14 }));
    },
    start() {
      [0, 7, 12].forEach((s, k) => tone(note(s), { at: k * 0.07, dur: 0.16, type: 'triangle', gain: 0.16 }));
    },
  };
}
