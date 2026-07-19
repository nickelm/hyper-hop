# CLAUDE.md — Hyper Hop

## What this is

Hyper Hop is a Geometry Dash-style auto-runner: a cube scrolls right automatically,
tap/space to jump, spikes kill you, reach the finish flag. It is a family project
built by a professor and two 9-year-old co-developers (his son and his son's friend),
who own level design and parameter tuning. It runs as a single static web page on
iPad and Android tablet browsers, deployed via GitHub Pages.

## Non-negotiable conventions

1. **Kid-readable code.** The 9-year-olds read and edit this code. Comments and
   constant names must be understandable by a bright 9-year-old. Prefer
   `JUMP_POWER` over `initialVerticalVelocity`. Keep the playful comment style in
   the CONFIG block (e.g. "Moon = 1500, Earth = 5000, Jupiter = 12000").
2. **All tunables live in `CONFIG`.** Never hardcode a magic number in the engine
   if it could be a named constant in the CONFIG block at the top of the file.
   When adding a feature, add its parameters to CONFIG with a kid-friendly comment.
3. **No build step, no frameworks, no dependencies.** Vanilla HTML/CSS/JS, canvas
   rendering. The whole game must work by opening `index.html` from a static server.
4. **No localStorage or sessionStorage.** Levels are saved by exporting ASCII text
   and pasting it into `levels.js`, on purpose: the kids' levels flow through git.
5. **Touch-first.** Every feature must work with taps on a tablet. Keyboard support
   is secondary. Keep `touch-action: none` and pointer events intact.

## The level format

Levels are ASCII grids, one character per tile. This format is the kids' primary
interface to the project; never change it without a very good reason, and never
break existing level strings.

```
.  empty air
#  solid block (stand on top; hitting the side = death)
^  spike (death; forgiving inner hitbox, see CONFIG.SPIKE_MERCY)
o  bounce pad (launches upward at CONFIG.PAD_POWER)
*  coin (collectible)
|  finish line
```

The floor is implicit: the bottom row of the grid sits on an automatic ground
plane. Rows are top-to-bottom; all rows in a level must be the same length.

## Architecture

- `index.html` — everything: styles, CONFIG, engine, editor. (Planned: split
  levels into `levels.js` so the kids have a file of their own.)
- Engine: fixed-timestep physics at 240 Hz (`FIXED_DT`), decoupled from
  rendering, so all tablets play identically. Rendering uses one full-screen
  canvas; camera places the floor at 78% of screen height.
- World coordinates: floor at y = 0, up is negative y. `parseLevel()` turns an
  ASCII string into `{grid, cols, rows}`.
- Built-in level editor: tap-to-paint grid, playtest button, and a "Copy code"
  export that emits a paste-ready `LEVELS` entry.
- Sound: tiny WebAudio synth (`beep()`), created lazily on first interaction.

## Workflow

- Development happens in VS Code on the professor's laptop; the kids playtest on
  tablets over the LAN (`python3 -m http.server`) during sessions, and via the
  GitHub Pages URL between sessions.
- Kids build levels in the in-game editor on tablets, tap "Copy code", and the
  exported string gets pasted into the levels list and committed.
- When the kids are present, explain changes as you make them; small readable
  diffs beat clever refactors.

## Testing checklist before any commit

- Game loads with no console errors from a plain static server.
- All shipped levels are completable (play or reason through them).
- Jump, pad bounce, spike death, coin pickup, and finish all work by tap alone.
- The CONFIG block still sits at the top of the file with all comments intact.
