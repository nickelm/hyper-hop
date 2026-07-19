/* ================================================================
   music.js — Hyper Hop's built-in chiptune band
   ================================================================
   No audio files! This makes music out of math, like a Game Boy.
   The tune is written in the MUSIC block below. Edit it!

   How to write music here:
   - Notes look like  E4  G4  C5  F#4  Bb3  (letter + optional #/b + octave)
   - A dot  .  means silence (a rest)
   - The | bars are just to help you count; the computer ignores them
   - Every note is one "step" = an eighth note. 8 steps = 1 bar.
   - All tracks loop forever, so patterns can be different lengths
     (the drums are 1 bar, the melody is 4 bars — they still fit!)
   ================================================================ */

const MUSIC = {
  ON: true,
  BPM: 135,          // beats per minute. At 135 BPM the cube travels exactly
                     // 4 tiles per beat (with SCROLL_SPEED 360 and TILE 40),
                     // so obstacles placed every 4 tiles land ON the beat!
  VOLUME: 0.5,       // 0 = silent, 1 = loud

  // The band: four tracks playing at once
  LEAD: `E4 .  G4 A4 B4 .  A4 G4 | E4 .  G4 A4 B4 .  D5 B4 |
         C5 .  B4 A4 G4 .  A4 B4 | A4 .  F#4 A4 E4 .  .  . `,

  BASS: `E2 E2 E3 E2 E2 E2 E3 E2 | E2 E2 E3 E2 E2 E2 E3 E2 |
         C2 C2 C3 C2 C2 C2 C3 C2 | D2 D2 D3 D2 D2 D2 D3 D2`,

  KICK:  `x . . . x . . .`,
  SNARE: `. . x . . . x .`,
  HAT:   `x x x x x x x x`,
};

/* ================================================================
   The music engine. Uses the "two clocks" trick: a slow JavaScript
   timer wakes up often and schedules notes a little into the
   future on the audio clock, which is sample-accurate. This is why
   the beat never wobbles even when the game is working hard.
   ================================================================ */

const Music = (() => {
  let ctx = null, master = null;
  let timer = null, nextStepTime = 0, step = 0;
  const LOOKAHEAD_MS = 25, SCHEDULE_AHEAD = 0.12;

  const NOTE_INDEX = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  function freq(name) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(name);
    if (!m) return null;
    let semi = NOTE_INDEX[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    const midi = 12 * (parseInt(m[3]) + 1) + semi;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  const parse = s => s.replace(/\|/g, " ").trim().split(/\s+/);

  let lead, bass, kick, snare, hat;
  function compile() {
    lead = parse(MUSIC.LEAD); bass = parse(MUSIC.BASS);
    kick = parse(MUSIC.KICK); snare = parse(MUSIC.SNARE); hat = parse(MUSIC.HAT);
  }

  function tone(f, t, dur, type, vol, decay) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (decay || dur));
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
  }
  function noise(t, dur, vol, highpass) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = highpass;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  function playStep(i, t, stepDur) {
    const L = lead[i % lead.length], B = bass[i % bass.length];
    if (L !== ".") { const f = freq(L); if (f) tone(f, t, stepDur * 0.9, "square", 0.14, stepDur * 0.85); }
    if (B !== ".") { const f = freq(B); if (f) tone(f, t, stepDur * 0.9, "triangle", 0.30, stepDur * 0.5); }
    if (kick[i % kick.length]  === "x") {           // a sine that dives = boom
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
    }
    if (snare[i % snare.length] === "x") noise(t, 0.12, 0.35, 1200);
    if (hat[i % hat.length]     === "x") noise(t, 0.04, 0.18, 6000);

    // tell the game a step happened (for pulsing backgrounds etc.)
    if (typeof Music.onStep === "function") {
      const delay = Math.max(0, (t - ctx.currentTime) * 1000);
      setTimeout(() => Music.onStep(i), delay);
    }
  }

  function tick() {
    const stepDur = 60 / MUSIC.BPM / 2;             // 2 steps per beat (eighths)
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      playStep(step, nextStepTime, stepDur);
      nextStepTime += stepDur;
      step++;
    }
  }

  return {
    onStep: null,   // assign a function(stepIndex) to react to the beat
    start() {
      if (!MUSIC.ON) return;
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.connect(ctx.destination);
      }
      master.gain.value = MUSIC.VOLUME * 0.5;
      if (ctx.state === "suspended") ctx.resume();
      compile();
      this.stop();
      step = 0; nextStepTime = ctx.currentTime + 0.05;
      timer = setInterval(tick, LOOKAHEAD_MS);
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
})();
