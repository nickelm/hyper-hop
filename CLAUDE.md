# CLAUDE.md — Hyper Hop

## What this is

Hyper Hop is a Geometry Dash-style auto-runner: a cube scrolls right automatically,
tap/space to jump, spikes kill you, reach the finish flag. It is a family project
built by a professor and two 9-year-old co-developers (his son and his son's friend),
who own level design and parameter tuning. It plays in iPad and Android tablet
browsers.

It is now a small **client–server app**: a vanilla HTML/CSS/JS game (in `public/`)
talking to a tiny **Node + Express** server that stores everyone's levels and shared
settings in flat JSON files. This lets the kids save levels and settings straight
from their tablets, no laptop or git in the loop. It runs on a DigitalOcean droplet
(see `deploy/`).

## Non-negotiable conventions

1. **Kid-readable code.** The 9-year-olds read and edit this code. Comments and
   constant names must be understandable by a bright 9-year-old. Prefer
   `JUMP_POWER` over `initialVerticalVelocity`. Keep the playful comment style in
   the CONFIG block (e.g. "Moon = 1500, Earth = 5000, Jupiter = 12000").
2. **All tunables live in `CONFIG`.** Never hardcode a magic number in the engine
   if it could be a named constant in the CONFIG block at the top of the file.
   When adding a feature, add its parameters to CONFIG with a kid-friendly comment.
3. **The client stays vanilla — no build step, no frameworks, no client
   dependencies.** Everything in `public/` is plain HTML/CSS/JS with canvas
   rendering; it must run by opening `public/index.html` (served over HTTP). The
   *server* (`server.js`) is allowed exactly one dependency, Express, and no build
   step either — plain `node server.js`.
4. **No client storage, with one exception.** Levels and shared settings live on
   the server (`data/levels.json`, `data/settings.json`) and are reached through the
   API below — never in `localStorage`/`sessionStorage`. The family PIN is held only
   in a JS variable for the session. The **one** allowed per-device value is the
   **player name**, stored in `localStorage` under `hh_player`: it's this tablet's
   identity (whose scores these are, who's the author), not shareable data, so it
   can't live on the server. The editor's "Copy code" export stays as a manual
   backup path.
5. **Touch-first.** Every feature must work with taps on a tablet. Keyboard support
   is secondary. Keep `touch-action: none` and pointer events intact.

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
```

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
stored JSON and in `server.js` template-literal levels, a down-ramp `\` must be
written as `\\` so a literal backslash survives encoding.

The floor is implicit: the bottom row of the grid sits on an automatic ground
plane. Rows are top-to-bottom; all rows in a level must be the same length.

## Architecture

Files:

- `server.js` — the Node + Express server. Serves `public/`, exposes the API
  below, validates levels, gates writes behind the family PIN, and backs up each
  data file before changing it. No database — just JSON files in `data/`.
- `public/index.html` — the whole client: styles, CONFIG, engine, editor, and the
  Control Panel. On load it fetches settings + levels + scores from the server.
- `public/music.js` — the chiptune synth (`Music`) and the `SONGS` list.
- `data/` — runtime state, created/seeded on first run and **gitignored**:
  - `levels.json` — array of `{id, name, author, level, song, theme, updatedAt}`.
    Array order is the play order (changed via the reorder endpoint below).
  - `settings.json` — CONFIG overrides saved "for everyone" (a flat subset).
  - `scores.json` — array of `{levelId, player, percent, updatedAt}`: each player's
    **best % completion** per level (100 = finished). One row per (level, player);
    the server keeps the max. Seeded to `[]`.
  - `profiles.json` — array of `{id, name, skin, updatedAt}`: the named players and
    their **cosmetic cube skins** (see Skins below). Seeded to `[]`.
  - `backups/` — timestamped copies of the above, newest 200 kept per file.
- `deploy/` — `hyper-hop.service` (systemd), `Caddyfile` (HTTPS reverse proxy),
  and `SETUP.md` (droplet instructions).

Engine (unchanged): fixed-timestep physics at 240 Hz (`FIXED_DT`), decoupled from
rendering, so all tablets play identically. One full-screen canvas; camera places
the floor at 78% of screen height. World coordinates: floor at y = 0, up is
negative y. `parseLevel()` turns an ASCII string into `{grid, cols, rows}`.

The client works out its API base from the page URL (`API_BASE`), so it runs the
same at the site root, in a subfolder, or on a custom port.

Each level carries a `theme` (an index into the client's `THEMES` list in
`public/index.html`) that sets its background sky + ground colors. Theme `0`
("Default") means "use the Control Panel colors", so old levels look unchanged and
the shared `SKY_TOP`/`SKY_BOTTOM`/`GROUND_COLOR` still apply to them. The menu has a
**Play All** button that runs every level in order (adventure mode).

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
`CONFIG.PLAYER_SIZE` square no matter what shape is drawn — `physicsStep()` only
ever uses `PLAYER_SIZE`. This rule is commented at the top of `drawPlayer()` in
`public/index.html`; keep it true.

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

Server-side level validation (returns clear messages): only the characters
`. # / \ ^ o * | = -`, all rows equal length, at most one `|`, ≤ 500 columns, ≤ 30 rows.

Server-side profile validation (`validateProfile`/`cleanSkin`, clear messages):
`name` 1–20 characters; colors must match `#rrggbb`; `shape`/`face`/`trail`/
`explosion` must be from the enums above; `emoji` at most **one emoji grapheme**
(counted with `Intl.Segmenter`, so 👍🏽 / 🇸🇪 / 👨‍👩‍👧 count as one; a 50-char
"emoji" is rejected). Unknown extra skin fields are **stripped, not rejected**
(forward-compatible), and a missing/odd non-color field falls back to its default.

Env vars: `PORT` (default 3000), `FAMILY_PIN` (default `1234` for local dev, with a
warning — always set a real one in production), `READ_ONLY` (`true` freezes writes).

## Workflow

- Run locally with `npm install` then `FAMILY_PIN=1234 node server.js`, and open
  `http://localhost:3000`. During sessions the kids reach the laptop over the LAN
  (`http://<laptop-ip>:3000`); between sessions they use the droplet URL.
- Kids build levels in the in-game editor and tap **Save to server** (it asks for a
  name + author once, then the family PIN once per session). Shared tuning is saved
  from the Control Panel's **Save for everyone**. Both persist server-side and are
  backed up automatically — no git round-trip needed for levels.
- When the kids are present, explain changes as you make them; small readable
  diffs beat clever refactors.

## Testing checklist before any commit

- `node server.js` starts clean and the game loads with no console errors.
- All shipped levels are completable (play or reason through them).
- Jump, pad bounce, spike death, coin pickup, and finish all work by tap alone.
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
- The CONFIG block still sits at the top of `public/index.html`, comments intact.
