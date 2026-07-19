/* ================================================================
   music.js — Hyper Hop's built-in chiptune band
   ================================================================
   No audio files! This makes music out of math, like a Game Boy.
   The tunes are written in the SONGS list below. Edit them, or add
   your own — every level picks a song to play.

   How to write music here:
   - Notes look like  E4  G4  C5  F#4  Bb3  (letter + optional #/b + octave)
   - A dot  .  means silence (a rest)
   - The | bars are just to help you count; the computer ignores them
   - Every note is one "step" = an eighth note. 8 steps = 1 bar.
   - All tracks loop forever, so patterns can be different lengths
     (the drums are 1 bar, the melody is 4 bars — they still fit!)

   About BPM (how fast the song goes):
   - At the default speed (SCROLL_SPEED 360, TILE 40) the cube travels
     540 / BPM tiles every beat. Pick a BPM that divides evenly so
     obstacles land ON the beat:
         BPM 90  -> 6 tiles per beat  (slow)
         BPM 108 -> 5 tiles per beat  (relaxed)
         BPM 135 -> 4 tiles per beat  (normal — the classic Hyper Hop feel)
         BPM 180 -> 3 tiles per beat  (fast)
   ================================================================ */

const MUSIC = {
  ON: true,          // master switch for ALL music. false = total silence
  VOLUME: 0.5,       // 0 = silent, 1 = loud (the game can change this live)
};

// The jukebox! Each song is a little band of tracks that play at once.
// Levels choose a song by its position in this list (0 = the first one).
const SONGS = [

  {
    name: "Hyper Hop",          // the classic theme — bright and bouncy (E minor)
    BPM: 135,                   // 4 tiles per beat
    LEAD: `E4 .  G4 A4 B4 .  A4 G4 | E4 .  G4 A4 B4 .  D5 B4 |
           C5 .  B4 A4 G4 .  A4 B4 | A4 .  F#4 A4 E4 .  .  . `,
    BASS: `E2 E2 E3 E2 E2 E2 E3 E2 | E2 E2 E3 E2 E2 E2 E3 E2 |
           C2 C2 C3 C2 C2 C2 C3 C2 | D2 D2 D3 D2 D2 D2 D3 D2`,
    KICK:  `x . . . x . . .`,
    SNARE: `. . x . . . x .`,
    HAT:   `x x x x x x x x`,
  },

  {
    name: "Sky Runner",         // fast and sunny (C major) — feels like flying
    BPM: 180,                   // 3 tiles per beat
    LEAD: `G4 .  E4 G4 C5 .  G4 E4 | F4 .  A4 F4 D5 .  A4 F4 |
           E4 G4 C5 E5 D5 .  B4 G4 | C5 .  G4 E4 C4 .  .  . `,
    BASS: `C2 C2 C3 C2 C2 C2 C3 C2 | F2 F2 F3 F2 F2 F2 F3 F2 |
           G2 G2 G3 G2 G2 G2 G3 G2 | C2 C2 C3 C2 G2 G2 B2 B2`,
    KICK:  `x . . . x . . .`,
    SNARE: `. . x . . . x .`,
    HAT:   `x . x x x . x x`,
  },

  {
    name: "Bounce Party",       // springy and playful (G major), lots of rests
    BPM: 108,                   // 5 tiles per beat
    LEAD: `G4 .  D5 .  B4 .  G4 .  | E4 .  B4 .  G4 .  E4 .  |
           C5 .  G4 .  E4 .  C5 .  | D5 .  A4 .  F#4 . D4 . `,
    BASS: `G2 G2 G3 G2 G2 G2 G3 G2 | E2 E2 E3 E2 E2 E2 E3 E2 |
           C2 C2 C3 C2 C2 C2 C3 C2 | D2 D2 D3 D2 D2 D2 D3 D2`,
    KICK:  `x . . x x . . x`,
    SNARE: `. . x . . . x .`,
    HAT:   `x . x . x . x .`,
  },

  {
    name: "Boss Rush",          // dark and driving (D minor) — busy drums
    BPM: 135,                   // 4 tiles per beat
    LEAD: `D4 .  D4 F4 A4 .  F4 D4 | Bb3 . Bb3 D4 F4 .  D4 Bb3 |
           C4 .  C4 E4 G4 .  E4 C4 | A3 .  C4 E4 A4 G4 F4 E4`,
    BASS: `D2 D2 D3 D2 A2 A2 D3 D2 | Bb1 Bb1 Bb2 Bb1 F2 F2 Bb2 Bb1 |
           C2 C2 C3 C2 G2 G2 C3 C2 | A1 A1 A2 A1 E2 E2 A2 A1`,
    KICK:  `x . x x x . x x`,
    SNARE: `. . x . . . x .`,
    HAT:   `x x x x x x x x`,
  },

  {
    name: "Magical Sound Shower",   // Outrun cruising theme — bright & breezy (C major)
    BPM: 135,                       // 4 tiles per beat — that classic Hyper Hop feel
    LEAD: `G4 .  C5 .  E5 D5 C5 .  | D5 .  E5 .  C5 .  .  . |
           A4 .  D5 .  F5 E5 D5 .  | E5 .  C5 .  G4 .  .  . `,
    BASS: `C2 C2 C3 C2 G2 G2 C3 C2 | A1 A1 A2 A1 E2 E2 A2 A1 |
           D2 D2 D3 D2 F2 F2 D3 D2 | G2 G2 G3 G2 D2 D2 G2 G2`,
    KICK:  `x . . x . . x .`,
    SNARE: `. . x . . . x .`,
    HAT:   `x x x x x x x x`,
  },

  {
    name: "Axel F",                 // Beverly Hills Cop — that sneaky bouncy hook (F minor)
    BPM: 108,                       // 5 tiles per beat — relaxed and cool
    LEAD: `F4 .  Ab4 . F4 .  Bb4 F4 | Eb4 . F4 .  .  .  .  . |
           F4 .  C5 .  F4 .  Db5 C5 | Ab4 . F4 .  Eb4 . F4 . `,
    BASS: `F2 F2 F3 F2 F2 F2 F3 F2 | F2 F2 F3 F2 F2 F2 F3 F2 |
           Ab1 Ab1 Ab2 Ab1 Ab1 Ab1 Ab2 Ab1 | Db2 Db2 Db3 Db2 C2 C2 C3 C2`,
    KICK:  `x . . . x . . .`,
    SNARE: `. . x . . . x .`,
    HAT:   `x . x x x . x x`,
  },

];

/* ================================================================
   The music engine. Uses the "two clocks" trick: a slow JavaScript
   timer wakes up often and schedules notes a little into the
   future on the audio clock, which is sample-accurate. This is why
   the beat never wobbles even when the game is working hard.
   ================================================================ */

const Music = (() => {
  let ctx = null, master = null;
  let timer = null, nextStepTime = 0, step = 0;
  let song = SONGS[0];                            // the song playing right now
  let bpmOverride = 0;                            // 0 = each song keeps its own BPM; otherwise force this beat
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
  function compile(s) {
    song = s;
    lead = parse(s.LEAD); bass = parse(s.BASS);
    kick = parse(s.KICK); snare = parse(s.SNARE); hat = parse(s.HAT);
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
    const bpm = bpmOverride || song.BPM;            // the "Music speed" setting can force a beat
    const stepDur = 60 / bpm / 2;                   // 2 steps per beat (eighths)
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      playStep(step, nextStepTime, stepDur);
      nextStepTime += stepDur;
      step++;
    }
  }

  // Turn a song choice (a number 0,1,2... or a name) into one of the SONGS.
  function pickSong(which) {
    if (typeof which === "string") {
      const found = SONGS.find(s => s.name === which);
      if (found) return found;
    }
    const n = Number(which) || 0;
    return SONGS[((n % SONGS.length) + SONGS.length) % SONGS.length];
  }

  return {
    onStep: null,   // assign a function(stepIndex) to react to the beat
    // Start (or restart) a song from the very beginning. `which` is the
    // song number or name; `volume` (0..1) is optional.
    start(which, volume) {
      if (!MUSIC.ON) return;
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.connect(ctx.destination);
      }
      this.setVolume(volume === undefined ? MUSIC.VOLUME : volume);
      if (ctx.state === "suspended") ctx.resume();
      compile(pickSong(which));
      this.stop();
      step = 0; nextStepTime = ctx.currentTime + 0.05;
      timer = setInterval(tick, LOOKAHEAD_MS);
    },
    // Change how loud the music is, even while it's playing.
    setVolume(v) {
      MUSIC.VOLUME = v;
      if (master) master.gain.value = v * 0.5;
    },
    // Force every song to a chosen beat (BPM). Pass 0 to let each song keep
    // its own speed. Takes effect on the next steps, even mid-song.
    setBpm(v) { bpmOverride = Number(v) || 0; },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
})();
