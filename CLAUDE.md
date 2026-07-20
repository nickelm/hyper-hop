# CLAUDE.md — Hyper Hop

## What this is

Hyper Hop is a Geometry Dash-style auto-runner: a cube scrolls right automatically,
tap/space to jump, spikes kill you, reach the finish flag. It is a family project
built by a professor and two 9-year-old co-developers (his son and his son's friend),
who own level design and parameter tuning. It plays in iPad and Android tablet
browsers.

It is a small **client–server app**: a vanilla HTML/CSS/JS game (in `public/`)
talking to a tiny **Node + Express** server that stores everyone's levels, players
and shared settings in flat JSON files. This lets the kids save levels and settings
straight from their tablets, no laptop or git in the loop. It runs on a DigitalOcean
droplet (see `deploy/`).

The code is split into small **ES modules** — one job per file, no build step.

## Non-negotiable conventions

1. **Kid-readable code.** The 9-year-olds read and edit this code. Comments and
   constant names must be understandable by a bright 9-year-old. Prefer
   `JUMP_POWER` over `initialVerticalVelocity`. Keep the playful comment style in
   `js/config.js` (e.g. "Moon = 1500, Earth = 5000, Jupiter = 12000").
2. **All tunables live in `CONFIG`** (`public/js/config.js`). Never hardcode a magic
   number in the engine if it could be a named constant there. When adding a
   feature, add its parameters to CONFIG with a kid-friendly comment.
3. **The client stays vanilla — no build step, no frameworks, no client
   dependencies.** Everything in `public/` is plain HTML/CSS/JS with canvas
   rendering, loaded as native ES modules. Because it uses modules it must be
   **served over HTTP** (`npm start`), not opened as a `file://` page. The *server*
   is allowed exactly one dependency, Express, and no build step either — plain
   `node server/server.js`.
4. **No client storage, with one exception.** Levels, players and shared settings
   live on the server (`data/*.json`) and are reached through the API below — never
   in `localStorage`/`sessionStorage`. The family PIN is held only in a JS variable
   for the session (inside `js/api.js`). The **one** allowed per-device value is the
   **player name**, stored in `localStorage` under `hh_player`: it's this tablet's
   identity (whose scores these are, who's the author), not shareable data, so it
   can't live on the server. The editor's "Copy code" export stays as a manual
   backup path.
5. **Touch-first.** Every feature must work with taps on a tablet. Keyboard support
   is secondary. Keep `touch-action: none` and pointer events intact.
6. **New code goes in the module that owns that concern.** If a change is about
   drawing, it belongs in `render.js`; about the rules of the world, `physics.js`;
   about talking to the server, `api.js`; and so on. **If no module fits, propose a
   new one — don't grow `main.js`.** `main.js` is wiring and the app shell, not a
   dumping ground.
7. **The physics module stays pure.** `js/game/physics.js` must never import the
   DOM, canvas, audio, or fetch. It takes a state object and changes it; anything
   that needs a sound or a splash is left as a note in `state.events` for the game
   loop to act on. This is what keeps the game identical on every tablet — and
   testable (see `test/golden.js`).

## The level format

Levels are ASCII grids, one character per tile. This format is the kids' primary
interface to the project; never change it without a very good reason, and never
break existing level strings.

```
.  empty air
#  solid block (stand on top; hitting the side = death)
/  up-ramp   (slope from bottom-left to top-right; ground, never deadly)
\  down-ramp (slope from top-left to bottom-right; ground, never deadly)
^  spike (death; forgiving inner hitbox, see CONFIG.SPIKE_MERCY)
o  bounce pad (launches upward at CONFIG.PAD_POWER)
*  coin (collectible)
|  finish line
=  jump-through platform (thin slab; land on top, pass through from below/sides; never deadly)
-  disappearing bridge (same physics as `=`; fades away once passed, CONFIG.BRIDGE_FADE_TIME; cosmetic)
p  small bounce pad (like `o`, gentler, CONFIG.SMALL_PAD_POWER; pink)
U  catapult (a huge launch at CONFIG.CATAPULT_POWER; yellow bucket, dramatic sound + cosmetic squash-stretch)
s  saw blade (death; circular hitbox radius CONFIG.SAW_RADIUS*TILE, circle-vs-box; spinning disc, spin is cosmetic)
@  checkpoint (silent respawn snapshot: x/y, gravity, speed, coins; NOT bridges. Death respawns here; a full
   restart or level change clears it and restarts music. Small flag, lit once activated)
>  fast portal   (scroll speed becomes SCROLL_SPEED * CONFIG.FAST_MULT)
<  slow portal   (scroll speed becomes SCROLL_SPEED * CONFIG.SLOW_MULT)
u  flip-gravity portal   (gravity points UP: the cube falls upward)
n  normal-gravity portal (gravity points down again)
```

Speed portals (`>` `<`) are full-column gates: crossing the column's midline (at
any height) sets the scroll speed **absolutely** (not stacking) to the most
recently passed portal's multiplier. Speed resets to normal only via a portal of
the other kind, on death (restoring the checkpoint snapshot's speed), or on a full
restart. Portals never kill.

Gravity portals (`u` `n`) are the same kind of full-column gate and set gravity
**absolutely** via a single `gravityDir` (+1 down / −1 up) that multiplies gravity
and mirrors every landing test — floor↔ceiling, block tops↔undersides, and the
under-sides of `=`/`-` platforms — so there is one code path, not two. `u` flips
gravity, `n` restores it (hitting `u` twice is harmless). Under flipped gravity an
implicit ceiling at the top of the grid mirrors the floor; spikes, saws, pads,
catapults, coins, checkpoints and the finish all still work (pads/catapults push
toward the current "up"). **Limitation: ramps (`/` `\`) are ignored while gravity
is flipped** — they do nothing (and still never kill). Gravity direction is part of
the checkpoint snapshot and resets to normal on a full restart (level start =
normal).

Jump-through platforms (`=` `-`) are one-way: the cube lands on the top when
falling, but passes straight through them from below and from the sides, and they
never kill. The `-` bridge is a `=` that fades out after the cube runs past it
(purely a look — a faded bridge still holds you up); bridges reset to solid on death
or respawn.

Ramps (`/` `\`) are sloped ground. They only ever push the cube up — no side or
bottom death, ever. Running off the top of a `/` gives a small pop
(CONFIG.RAMP_LAUNCH); descending a `\` "glues" the cube to the slope so it doesn't
micro-hop (CONFIG.RAMP_GLUE). A jump always overrides the glue. A `/` at the foot of
a block stack lets the cube run up onto the stack instead of dying on its side. In
stored JSON and in the server's seed levels, a down-ramp `\` must be written as
`\\` so a literal backslash survives encoding.

The floor is implicit: the bottom row of the grid sits on an automatic ground
plane. Rows are top-to-bottom; all rows in a level must be the same length.

## The file map

**Client** (`public/` — plain ES modules, no build step):

| File | What it owns |
| ---- | ------------ |
| `index.html` | Markup + styles only. One `<script type="module" src="js/main.js">`. No inline JS. |
| `js/config.js` | `CONFIG` (every tunable number), `DEFAULTS`, `THEMES`, and the cube-skin option lists. The kids' control panel. |
| `js/main.js` | The app shell: game state, starting/resetting a level, checkpoints, the game loop, the menu + player picker, and startup. Wires every other module together. |
| `js/api.js` | Every `fetch`: `apiGet`, `apiWrite` (family PIN + one retry), `apiPost` (scores, no PIN). Owns the PIN and the PIN / "are you sure?" pop-ups. |
| `js/input.js` | Taps and keys → actions: jump, hold-to-keep-jumping, Escape, Z/X checkpoints, in-game buttons. |
| `js/music.js` | The chiptune synth (`Music`) and the `SONGS` list. |
| `js/game/level.js` | The level format: `parseLevel`, the tile legend, and the `tileAt` / `cellTop` lookups. |
| `js/game/physics.js` | **Pure.** The rules of the world at a fixed 240 Hz: `stepPhysics(state, dt)`, `requestJump(state)`. No DOM, canvas, sound or fetch. |
| `js/game/render.js` | Drawing a frame: sky, ground, every tile, HUD, and the win/death overlays. |
| `js/game/player.js` | How a cube *looks*: `drawPlayer`, `normalizeSkin`, `hslToHex`. Shared by the game, the previews and the picker buttons. |
| `js/game/effects.js` | The trail and the death explosion (`drawTrail`, `spawnExplosion`, `renderParticles`). |
| `js/ui/editor.js` | The level editor: paint grid, palette, tune/theme buttons, test-play, copy/paste, save. |
| `js/ui/skins.js` | The cube editor and its little live-preview cube. |
| `js/ui/settings.js` | The Control Panel: sliders, colors, switches, "Save/Reset for everyone". |
| `js/ui/toast.js` | The little "Saved!" pop-up. |

**Server** (`server/` — Node + Express, one dependency, no build step):

| File | What it owns |
| ---- | ------------ |
| `server.js` | Bootstrap: env vars, static files, mounts the routers, starts listening. |
| `routes/levels.js` | `/api/levels` — list, create, reorder, update, delete. |
| `routes/profiles.js` | `/api/profiles` — the players and their cube skins. |
| `routes/scores.js` | `/api/scores` — best % per player per level. |
| `routes/settings.js` | `/api/settings` — the shared "for everyone" numbers. |
| `lib/storage.js` | The JSON files: read, write-with-backup, backup rotation, first-run seeding. The only place that touches disk. |
| `lib/validate.js` | Everything a tablet sends is checked here. **The allowed tile list lives here, once.** |
| `lib/auth.js` | The family-PIN and READ_ONLY guards. |

**Other:**

- `data/` — runtime state, created/seeded on first run and **gitignored**:
  - `levels.json` — `{id, name, author, level, song, theme, updatedAt}`. Array order
    is the play order (changed via the reorder endpoint).
  - `settings.json` — CONFIG overrides saved "for everyone" (a flat subset).
  - `scores.json` — `{levelId, player, percent, updatedAt}`: each player's **best %
    completion** per level (100 = finished). One row per (level, player); the server
    keeps the max.
  - `profiles.json` — `{id, name, skin, updatedAt}`: the named players and their
    **cosmetic cube skins**.
  - `backups/` — timestamped copies of the above, newest 200 kept per file.
- `test/` — the safety net (see Testing below).
- `deploy/` — `hyper-hop.service` (systemd), `Caddyfile` (HTTPS reverse proxy),
  and `SETUP.md` (droplet instructions).

### How the pieces talk

Physics runs at a fixed 240 Hz (`FIXED_DT`), decoupled from drawing, so all tablets
play identically. One full-screen canvas; the camera puts the floor at 78% of screen
height. World coordinates: floor at y = 0, up is negative y.

`physics.js` is pure, so `main.js` bridges it to the game with two small **live
views** of its variables — reading or writing a field on them reads or writes the
real variable:

- `simState` — what the physics may touch (player, camera, speed, gravity, coins…).
  The physics leaves notes in `simState.events` (`"coin"`, `"pad"`, `"die"`, …) and
  `drainSimEvents()` in `main.js` turns those into sounds, score saves and splashes.
- `gameView` — what `render.js` needs to draw a frame.

The UI modules never reach into `main.js`'s variables. Each gets what it needs via
an `init…({ … })` call at startup (e.g. `initEditor({ S, showScreen, startLevel, … })`),
and hands results back through a callback (e.g. the editor's `onSaved`).

The client works out its API base from the page URL (`js/api.js`), so it runs the
same at the site root, in a subfolder, or on a custom port.

Each level carries a `theme` (an index into `THEMES` in `js/config.js`) that sets its
background sky + ground colors. Theme `0` ("Default") means "use the Control Panel
colors", so old levels look unchanged. The menu has a **Play All** button that runs
every level in order (adventure mode).

**Caching.** Tablets cache JavaScript hard. The server sends `Cache-Control: no-cache`
for everything under `public/js/`, so a refresh on iPad Safari always picks up new
code. If you add client files outside `js/`, they will NOT get that header.

**Players & skins.** The menu shows a "Who's playing?" row: one cube button per
saved profile plus "+ New player". Picking a profile is the identity layer over the
per-device `hh_player` name — it sets `currentProfile` (its skin is used in-game)
**and** the name used for scores + level authorship (also written to `hh_player`),
so the cube you see and the name on the leaderboard always match. No profile chosen
= the default cube + today's name-only behavior. A tablet that already has an
`hh_player` name but no matching profile shows that name as a *provisional* cube
(default skin); it becomes a real server profile the first time it's saved (writes
are PIN-gated, so nothing is created on load). "Edit my cube" opens the skin editor.

## Skins

A **skin** is how a player's cube looks. **Skins are cosmetic only: they never
affect physics, hitboxes, or difficulty.** The cube always collides as a
`CONFIG.PLAYER_SIZE` square no matter what shape is drawn — the physics only ever
uses `PLAYER_SIZE`. This rule is commented at the top of `drawPlayer()` in
`public/js/game/player.js`; keep it true.

A skin is a JSON object (defaults reproduce the classic green cube exactly):

```
{
  bodyColor:    "#rrggbb",
  outlineColor: "#rrggbb",
  faceColor:    "#rrggbb",
  shape:     "square" | "rounded" | "circle" | "diamond" | "hex",
  face:      "none" | "happy" | "cool" | "angry" | "silly" | "sleepy" | "robot" | "emoji",
  emoji:     "<one emoji>",   // used only when face (or explosion) is "emoji"
  trail:     "off" | "fade" | "rainbow" | "bubbles",
  explosion: "squares" | "stars" | "confetti" | "emoji"
}
```

`drawPlayer(ctx, x, y, rot, skin, size?)` draws the cube (game, editor preview, and
picker buttons all share it); `normalizeSkin(raw)` fills every missing/invalid part
from `DEFAULT_SKIN` and never throws, so **a missing or malformed skin anywhere
falls back to the default without errors**. The default cube reads its colors live
from `CONFIG.PLAYER_COLOR`/`PLAYER_EYE_COLOR`, so "Save for everyone" color tweaks
still recolor no-profile players (like theme 0). Trails and the death explosion are
parameterized by the active skin's style; `CONFIG.TRAIL` and
`CONFIG.PARTICLES_ON_DEATH` still govern the master on/off and piece count. The
skin editor is a third full screen (`#skinScreen`), reached from the picker.

## The API

All reads are open. All **mutations require the header `X-Family-Pin`** matching the
server's `FAMILY_PIN` env var, and are refused with a friendly 403 when
`READ_ONLY=true`.

| Method | Path                | What it does                          |
| ------ | ------------------- | ------------------------------------- |
| GET    | `/api/levels`       | all levels                            |
| POST   | `/api/levels`       | create a level (server assigns `id`)  |
| PUT    | `/api/levels/order` | reorder all levels (send `{order:[ids]}`) |
| PUT    | `/api/levels/:id`   | update a level                        |
| DELETE | `/api/levels/:id`   | delete a level                        |
| GET    | `/api/settings`     | current CONFIG overrides              |
| PUT    | `/api/settings`     | replace CONFIG overrides              |
| GET    | `/api/scores`       | all high scores                       |
| POST   | `/api/scores`       | save a `{levelId, player, percent}` best (see note) |
| GET    | `/api/profiles`     | all player profiles                   |
| POST   | `/api/profiles`     | create a profile (server assigns `id`) |
| PUT    | `/api/profiles/:id` | update a profile's name and/or skin   |
| DELETE | `/api/profiles/:id` | delete a profile                      |

**Scores are the one PIN-free write.** Kids play (and beat their best) constantly,
so saving a score needs no `X-Family-Pin` — but it's still refused when
`READ_ONLY=true`. The server only writes when a score beats that player's old best,
so backup churn stays low.

Server-side level validation (`lib/validate.js`, returns clear messages): only the
characters `. # ^ o * | / \ = - p U s @ > < u n`, all rows equal length, at most one
`|`, ≤ 500 columns, ≤ 30 rows. The allowed-character list is defined **once**
(`LEVEL_CHARS`) and the error message is generated from it, so the two can't drift.

Server-side profile validation (`validateProfile`/`cleanSkin`, clear messages):
`name` 1–20 characters; colors must match `#rrggbb`; `shape`/`face`/`trail`/
`explosion` must be from the enums above; `emoji` at most **one emoji grapheme**
(counted with `Intl.Segmenter`, so 👍🏽 / 🇸🇪 / 👨‍👩‍👧 count as one; a 50-char
"emoji" is rejected). Unknown extra skin fields are **stripped, not rejected**
(forward-compatible), and a missing/odd non-color field falls back to its default.

Env vars: `PORT` (default 3000), `FAMILY_PIN` (default `1234` for local dev, with a
warning — always set a real one in production), `READ_ONLY` (`true` freezes writes).

**Known gap:** `KNOWN_SETTING_KEYS` in `lib/validate.js` (what "Save for everyone"
accepts) has not been updated for the newer tunables — `SMALL_PAD_POWER`,
`CATAPULT_POWER`, `FAST_MULT`, `SLOW_MULT`, `SAW_RADIUS` and the new colors. They
can be changed in the Control Panel for this visit, but not shared. Add them when
you want them shareable.

## Testing

Two automatic checks, both run by `npm test`:

- **`test/golden.js` — did the physics change?** Replays fixture levels through the
  real physics with a fixed jump script and compares the cube's position every few
  steps against saved traces in `test/golden/`. These must stay **byte-identical**.
  If they differ, the change altered how the game plays — find out why. Only
  regenerate them (`node test/golden.js`) when you MEANT to change the game.
- **`test/boot.js` — does the game still hold together?** Loads the real modules with
  a pretend browser and actually runs them: plays a level to the finish and dies on
  another (so the win and death screens draw), then opens the menu, player picker,
  cube editor and level editor. It doesn't look at pixels — it catches *missing*
  things: a bad import path, a renamed export, or a leftover reference to a variable
  that now lives in another file.

## Workflow

- Run locally with `npm install` then `npm start` (or
  `FAMILY_PIN=1234 node server/server.js`), and open `http://localhost:3000`. During
  sessions the kids reach the laptop over the LAN (`http://<laptop-ip>:3000`);
  between sessions they use the droplet URL.
- Kids build levels in the in-game editor and tap **Save to server** (it asks for a
  name + author once, then the family PIN once per session). Shared tuning is saved
  from the Control Panel's **Save for everyone**. Both persist server-side and are
  backed up automatically — no git round-trip needed for levels.
- When the kids are present, explain changes as you make them; small readable
  diffs beat clever refactors.

## Testing checklist before any commit

- `npm test` passes (golden traces identical + the game boots and runs).
- `npm start` starts clean and the game loads with no console errors.
- All shipped levels are completable (play or reason through them).
- Jump, pad bounce, spike death, coin pickup, and finish all work by tap alone.
- The newer tiles behave: saw, small pad, catapult, `@` checkpoint respawn, speed
  portals, and a gravity flip (landing on the ceiling) and back.
- Save to server, Edit, and Save for everyone work by touch; a wrong PIN re-prompts.
- Picking a level theme (🎨 in the editor) changes its background; it survives a save
  and reopen; a "Default"-theme level still follows the Control Panel colors.
- Reorder (▲/▼), delete (🗑 with the "are you sure?" pop-up), and **Play All**
  (adventure mode) all work by touch; reorder/delete persist after a reload.
- `READ_ONLY=true` refuses writes with the friendly message; reads still work.
- With **no profile chosen**, the cube looks pixel-identical to before (default look).
- The cube editor: each shape/face/trail/explosion changes the live preview; tap the
  preview to jump and **💀 Try it out** fires the explosion; the emoji face renders
  (check iPad Safari + Android Chrome); Save asks the PIN once and survives a reload.
- Two profiles made on two browsers both show in "Who's playing?" after a reload;
  picking one shows its cube in-game and its name on the scoreboard/as author.
- A skin is cosmetic only: a circle/diamond cube dies and lands exactly where a
  square would (hitbox is always `CONFIG.PLAYER_SIZE`).
- A refresh on the iPad picks up new code (the `js/` no-cache header is working).
- `CONFIG` in `public/js/config.js` still reads as the kids' control panel, comments
  intact.
