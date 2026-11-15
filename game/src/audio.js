// All sound is synthesized with WebAudio: no audio files, nothing fetched.
// One shared AudioContext, created on the first user gesture; every effect is a
// short node graph that frees itself. Distance attenuates enemy shots.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate * 0.5;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(dur, filterFreq, gainValue, when = 0, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, gainValue, when = 0, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function volumeFor(distance) {
    if (distance == null) return 1;
    return Math.max(0.08, 1 - distance / 55);
  }

  return {
    unlock() { ensure(); },
    shot(kind, distance) {
      const v = volumeFor(distance);
      if (kind === 'sniper') {
        noise(0.28, 900, 0.9 * v);
        tone(160, 0.16, 0.5 * v, 0, 'sawtooth', 55);
      } else if (kind === 'smg') {
        noise(0.09, 2400, 0.5 * v);
        tone(220, 0.06, 0.25 * v, 0, 'square', 110);
      } else if (kind === 'pistol') {
        noise(0.12, 1800, 0.65 * v);
        tone(190, 0.08, 0.3 * v, 0, 'square', 90);
      } else {
        noise(0.14, 1500, 0.8 * v);
        tone(140, 0.1, 0.4 * v, 0, 'sawtooth', 60);
      }
    },
    dryFire() { tone(900, 0.04, 0.12, 0, 'square'); },
    reload() {
      tone(520, 0.05, 0.14, 0, 'square');
      tone(380, 0.05, 0.14, 0.35, 'square');
      tone(640, 0.05, 0.16, 1.55, 'square');
    },
    hit() { tone(1250, 0.06, 0.22, 0, 'sine'); },
    kill() {
      tone(880, 0.09, 0.25, 0, 'sine');
      tone(1318, 0.12, 0.25, 0.09, 'sine');
    },
    hurt() {
      noise(0.12, 500, 0.4);
      tone(110, 0.14, 0.3, 0, 'sawtooth', 70);
    },
    step(run) { noise(0.05, run ? 700 : 420, run ? 0.1 : 0.06); },
    plantBeep(final) {
      tone(final ? 1560 : 1040, 0.09, 0.22, 0, 'sine');
    },
    defuseBeep() { tone(1240, 0.07, 0.2, 0, 'sine'); },
    explosion(distance) {
      const v = volumeFor(distance);
      noise(1.1, 320, 1.0 * v);
      tone(70, 0.9, 0.8 * v, 0, 'sine', 32);
      noise(0.4, 2400, 0.3 * v, 0.05, 'highpass');
    },
    grenadeThrow() { noise(0.08, 900, 0.2); },
    flash() {
      // The pop, then a high ringing that fades over a couple of seconds.
      noise(0.18, 3200, 0.7, 0, 'highpass');
      tone(3400, 1.4, 0.12, 0.05, 'sine');
      tone(2550, 1.1, 0.08, 0.05, 'sine');
    },
    radio() {
      tone(1180, 0.05, 0.1, 0, 'sine');
      tone(1560, 0.06, 0.1, 0.07, 'sine');
    },
    bounce() { tone(240, 0.05, 0.12, 0, 'triangle'); },
    buy() {
      tone(660, 0.07, 0.2, 0, 'sine');
      tone(990, 0.1, 0.2, 0.07, 'sine');
    },
    roundWin() {
      tone(523, 0.14, 0.22, 0, 'triangle');
      tone(659, 0.14, 0.22, 0.13, 'triangle');
      tone(784, 0.24, 0.26, 0.26, 'triangle');
    },
    roundLose() {
      tone(392, 0.16, 0.22, 0, 'triangle');
      tone(311, 0.16, 0.22, 0.15, 'triangle');
      tone(233, 0.3, 0.24, 0.3, 'triangle');
    },
    tick() { tone(980, 0.05, 0.14, 0, 'sine'); },
  };
}
