# CLAUDE.md — Hyper Hop

## What this is

Hyper Hop is a Geometry Dash-style auto-runner: a cube scrolls right automatically,
tap/space to jump, spikes kill you, reach the finish flag. It is a family project
built by a professor and two 9-year-old co-developers (his son and his son's friend),
who own level design and parameter tuning. It plays in iPad and Android tablet
browsers.

It is a small **client–server app**: a vanilla HTML/CSS/JS game (in `public/`)
talking to a tiny **Node + Express** server that stores everyone's levels,
accounts and coins in flat JSON files. This lets the kids save levels straight
from their tablets, no laptop or git in the loop. It runs on a DigitalOcean
droplet (see `deploy/`).

Everyone has an **account** with a password, and playing earns **coins** that buy
cosmetic bits for your cube. The security is family-grade — but the fundamentals
are done properly: hashed passwords, an httpOnly session cookie, and every
permission checked on the server, never just in the buttons.

The code is split into small **ES modules** — one job per file, no build step.

## Non-negotiable conventions

1. **Kid-readable code.** The 9-year-olds read and edit this code. Comments and
   constant names must be understandable by a bright 9-year-old. Prefer
   `JUMP_POWER` over `initialVerticalVelocity`. Keep the playful comment style in
   `js/config.js` (e.g. "Moon = 1500, Earth = 5000, Jupiter = 12000").
2. **All tunables live in `CONFIG`** (`public/js/config.js`). Never hardcode a magic
   number in the engine if it could be a named constant there. When adding a
   feature, add its parameters to CONFIG with a kid-friendly comment.
   **CONFIG is the one and only place these numbers are set** — there is no
   server-wide override any more (there used to be; see "A level's own rules").
   A *level* may borrow a few of them while you play it, and that's all.
   **The one exception is money.** What things *cost* lives in `data/prices.json`
   on the server (hand-editable, hot-reloaded — the same spirit as CONFIG, just
   server-side), because `config.js` is sent to the tablets and anyone could edit
   it in their browser to hand themselves a million coins. CONFIG keeps only how
   coins *look* (`COIN_SILVER_COLOR`, `COIN_HUD_COLOR`).
3. **The client stays vanilla — no build step, no frameworks, no client
   dependencies.** Everything in `public/` is plain HTML/CSS/JS with canvas
   rendering, loaded as native ES modules. Because it uses modules it must be
   **served over HTTP** (`npm start`), not opened as a `file://` page. The *server*
   is allowed exactly one dependency, Express, and no build step either — plain
   `node server/server.js`. Passwords use Node's built-in `crypto` (scrypt) and
   cookies are parsed by hand (`lib/cookies.js`) rather than adding a package.
4. **The server owns everything that matters; the tablet owns almost nothing.**
   Levels, accounts, coins and scores live on the server
   (`data/*.json`) and are reached through the API below. Your login is an
   **httpOnly cookie** — the game's own JavaScript cannot read it, so nothing on
   the page can steal it. **Coins are server-authoritative:** the client reports
   what it collected, the server decides what it's worth.
   `localStorage` is allowed for **convenience only**, and currently holds exactly
   one thing: `hh_last_account`, the name to preselect on the login screen. Never
   put auth tokens, coins, or anything gameplay-authoritative there. The editor's
   "Copy code" export stays as a manual backup path.
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
L  ceiling up-ramp   (the mirror of `/`, hanging from the roof; only while gravity is flipped)
7  ceiling down-ramp (the mirror of `\`, likewise)
^  spike (death; forgiving inner hitbox, see CONFIG.SPIKE_MERCY)
v  upside-down spike — the mirror of `^`, hanging point-down from the top of its square.
   Deadly **always**, whichever way gravity points: a spike is a hazard, not a surface, so
   unlike the ceiling ramps `L`/`7` there is no "only while flipped" rule. Same SPIKE_MERCY,
   same color; the one difference is which end of the hitbox is flush with the square.
o  bounce pad (launches upward at CONFIG.PAD_POWER)
*  coin (collectible; a level may hold at most `maxCoinsPerLevel` of them — see Coin cap)
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
f  fly portal    (become a rocket: HOLD to climb, let go to drop)
c  cube portal   (back to a normal jumping cube)
h  hole gate     (the ground switches OFF — nothing to stand on)
g  ground gate   (the ground comes back)
!  sign          (a message for whoever plays; the words live beside the grid — see Signs)
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

Flight gates (`f` `c`) are the same kind of full-column gate and are also
absolute, not toggles. Between an `f` and a `c` the cube is a little rocket:
**holding** the button accelerates it toward the current "up" at
CONFIG.FLY_THRUST (instead of gravity), letting go drops it normally, and its
vertical speed is clamped to ±CONFIG.FLY_MAX_SPEED. While flying:

- the floor **and** the roof of the world are soft walls — the cube slides along
  them with `vy = 0`, never dies, and **never sets `onGround`**. That one fact is
  what keeps a tap from becoming a jump and stops the hold-to-keep-jumping timer
  in `input.js` from firing; `requestJump` also returns `false` outright.
- a `#` block's **top and underside are soft walls too**, by the same rule: the
  rocket scrapes along them with `vy = 0`, stays alive, and still never sets
  `onGround` (so it rests on a block without being able to jump off it). Its
  **sides** are the end of the run. Which one you hit is decided the same way a
  cube's landing is — were you moving down onto the top, or up into the underside,
  and were you clear of it a step ago?
- spikes and saws still kill.
- pads, catapults and ramps do nothing; `=`/`-` platforms are pass-through
  (bridges still fade as you fly past).
- the cube tips its nose toward its vertical speed (±CONFIG.FLY_TILT) instead of
  spinning.
- a `u`/`n` gate flips the rocket too, because the thrust is multiplied by
  `gravityDir` — there is no third mode. Note this **inverts the controls**: with
  gravity flipped, holding pushes you toward the roof's opposite side.

Flight is part of the checkpoint snapshot, so dying inside a flight section
respawns you flying. Level start is always cube mode.

The physics needs to know whether the button is held, which it could not see
before: `input.js` reports every press and release through a `setHolding`
callback, and `simState` exposes it as `state.holding`. `input.js` also releases
on `pointercancel` and `blur`, so a finger sliding off a tablet cannot leave the
rocket thrusting by itself.

Ground gates (`h` `g`) are full-column gates too, and absolute like the rest.
**The "ground" is whichever surface gravity pulls you onto** — normally the floor
at y = 0, and under flipped gravity the roof of the world. An `h` switches that
surface off; a `g` builds it back. This applies to **everyone**, a running cube as
much as a rocket: with no ground there is simply nothing to stand on, so you drop
through and, once you are fully past where the ground would have been, you have
fallen out of the world and die.

The *other* side of the world is not ground and is unaffected by `h`/`g`: it stays
a soft wall while flying (so a rocket can never shoot out through the top), and in
cube play it does not exist at all. Blocks, platforms and pads still work normally
over a hole, so `h` is also how you build a gap to jump or a run of floating
platforms. Ground state is part of the checkpoint snapshot, and a level always
starts with the ground on.

`groundSpans(level)` in `js/game/level.js` answers "is the ground on at column N?"
for the renderer, by the same last-gate-wins rule the physics follows as you run
past them; it is worked out once per level and remembered, because `draw()` needs
it every frame. **The ground is drawn column by column inside the world transform**
(in runs, so there are no seams) rather than as one screen-wide rectangle — that
is what makes a hole actually look like a hole.

**The editor sizes itself to the tablet.** `ED.cell` is never a fixed number — it
is worked out each redraw so at zoom 0 the *whole* level fits the space available
(`fitCell()`), with 🔍−/🔍+ steps on top that go far past that, up to `MAX_CELL`,
so you can get right in close. This matters because the grid is 14 rows tall and a
tablet's editor area is only a few hundred pixels. One guard: `computeCell()` also
caps the cell so the canvas never exceeds `MAX_CANVAS` pixels on its longest side —
a tablet silently draws **nothing** above that, and a 300-square level zoomed right
in would otherwise go blank. `zoomBy()` notices when a zoom step changed nothing and
puts it back, so 🔍− always works on the next tap.

**A finger on the editor canvas always paints** — dragging draws a whole run of
blocks, which is the whole point on a touch screen. So `#editorCanvas` keeps
`touch-action: none` permanently, and moving around is done with **our own scroll
bars** (`js/ui/scrollbars.js`, one per axis, hidden when that axis fits) plus
**edge auto-scroll**: painting within `EDGE` pixels of the edge of
`#editorGridWrap` slides the grid along under your finger. Don't hand the canvas
back to the browser's panning (`pan-x pan-y`) — that is exactly what made drawing
impossible before. The browser's own bars on `#editorGridWrap` stay hidden
(`scrollbar-width: none` + `::-webkit-scrollbar`), because they're both ugly and
untouchable on a tablet.

**Every palette button shows its name under its picture** (`.tileIcon` +
`.tileLabel`). There is no hover on an iPad, so a `title=` tooltip is invisible;
if you add a tile, give it a short label that fits a 58-pixel button.

**The bottom row of buttons must never leave the screen.** ▶ Play and ⇩ Save live
in `#editorBottom`, and the editor is a flex column of top bar → grid → buttons.
`#editorBottom` is `flex: 0 0 auto` (never shrinks, never squeezed out) and
`#editorTop` is `flex: 0 1 auto; overflow-y: auto` — **the top is what gives way**.
On top of that `checkEditorFits()` in `js/ui/editor.js` *measures* where the
buttons actually landed and, if they are off the bottom, adds a `compact` class
and then caps `#editorTop`'s height. That measurement exists because no CSS media
query can see that the *browser itself* is zoomed in (Safari's own "aA" page-zoom
setting, for one). It is a fixed two-step check, never a loop — the boot test's
pretend DOM answers every measurement with a stub, so a loop would hang there.
It runs from `layoutEditor()` (open the editor, come back from a test play, and
on resize), not from `drawEditor()`, so painting a run of blocks stays fast.

**Two zoom rules, and they are not the same zoom.** 🔍+ / 🔍− in the editor make
the *level's squares* bigger. The *browser's* zoom is `js/ui/zoomguard.js`'s job,
and the page is supposed to never have any: `initZoomGuard()` says no to Safari's
`gesturestart`/`gesturechange`/`gestureend` (the `user-scalable=no` in the viewport
tag looks like it should do this, but **iPads have ignored it since iOS 10**), and
`touch-action` in the CSS handles double-tap. It deliberately does *not* swallow
quick double taps in JavaScript — `preventDefault()` on a tap throws away the
button press with it, so 🔍+ tapped twice fast would only count once.
**Any writing box on the page must use a font of 16px or bigger**: an iPad zooms
the whole page in the moment you tap a smaller one, and never zooms back out —
that was how the editor's bottom buttons used to disappear. If it somehow gets
zoomed anyway, `#zoomResetBtn` appears *inside the part you can still see* (from
`visualViewport.offsetLeft/offsetTop`, which is the whole trick) and tries the
viewport-meta reset; there is no web API that guarantees this, so if the zoom is
still there 400ms later it says "pinch with two fingers" instead of failing quietly.

**The coin cap.** A level may hold at most `maxCoinsPerLevel` coins (the price
list, default 25), so nobody can carpet a level in `*` and turn it into a coin
machine. The editor keeps you inside the limit as you draw rather than telling
you off: painting a coin when the level is already full takes the **first** coin
away and puts the new one down, with a toast to say so — but only **once per
finger-stroke** (`swappedThisStroke`), or dragging along at the limit would drag
the level's coins with you. A `★ N / 25` chip (`#coinCount`) shows while the coin
tool is held, and stays visible in red while a level is over the limit. "The
first coin" always means `firstCoin()`: leftmost column first, top to bottom
within a column — the order you meet them running right. **Levels made before the
limit keep working**; the cap only bites when one is saved again, and
`trimCoinsIfNeeded()` asks first, so coins never vanish without a "yes".
The server checks the count again on every save (`validateLevel`, counting with
`coinKeysFor`), because the tablet is never the one that decides.

Jump-through platforms (`=` `-`) are one-way: the cube lands on the top when
falling, but passes straight through them from below and from the sides, and they
never kill. Landing needs **both** halves of the test — you were above the slab a
step ago *and* you have actually reached it now. (With only the first half, any
cube falling anywhere over that column was snatched down onto the slab, which read
as a jump being cut short.) The `-` bridge is a `=` that fades out after the cube runs past it
(purely a look — a faded bridge still holds you up); bridges reset to solid on death
or respawn.

Ramps (`/` `\`) are sloped ground. They only ever push the cube up — no side or
bottom death, ever. Running off the top of a `/` gives a small pop
(CONFIG.RAMP_LAUNCH); descending a `\` "glues" the cube to the slope so it doesn't
micro-hop (CONFIG.RAMP_GLUE). A jump always overrides the glue. A `/` at the foot of
a block stack lets the cube run up onto the stack instead of dying on its side. In
stored JSON and in the server's seed levels, a down-ramp `\` must be written as
`\\` so a literal backslash survives encoding.

**A block right next door to a ramp never kills you from the side** — that is
`rampBeside()` in `physics.js`, and it is not a nicety, it is what makes ramps
work at all. A ramp's slope is *lower* than the top of the block it climbs to, so
a cube standing on the slope is always poking a little way into that block. While
the ramp is holding you (`player.onRamp`) that overlap is ignored — but the moment
you **jump**, the ramp lets go of you (a jump beats the glue) while you are still
standing in that same corner, and the block used to kill you for it. So the block
pass asks two questions now: "is a ramp holding me?" *and* "am I over a ramp square
right beside this block, in the same row?". Same row, next door only: a block one
row **higher** than the ramp's top is a real wall, and running into that still ends
the run. `test/golden/ramp-jump.json` is the trace that keeps this honest.

Ceiling ramps (`L` `7`) are those same two ramps turned upside down, for running
along the roof after a `u` gate: `L` is the mirror of `/` (it climbs as you go
right) and `7` the mirror of `\`. **Only the family that matches the way gravity is
pointing exists** — with gravity normal an `L` or a `7` is simply not there, and
with gravity flipped a `/` or a `\` is not there. There is still one ramp loop in
`physics.js`, not two: `up = state.gravityDir` picks the pair of characters and
mirrors the surface, the stick test, the snap and the tilt, so with normal gravity
every expression collapses to exactly the code that was there before (which is what
keeps the golden traces identical). Ramps of either kind still never kill, and
still do nothing at all while flying.

**Signs (`!`).** A `!` in the grid is a signpost; the *words* live beside the grid
in the level's `messages`, a little map of `"col,row" → text` — the same key shape
coins use. Keeping the words out of the grid is what makes signs safe: the grid is
still a plain rectangle of characters, so `coinKeysFor`, every row/column number and
every level that existed before signs are untouched, and a level with no `messages`
field simply has no signs. `parseLevel(text, messages)` takes them as an optional
second argument and tidies them (`level.messages`, read with `messageAt`);
`render.js` collects the signs while drawing tiles and paints them **last**, so a
tile in the next column can't scribble over the words. The physics has never heard
of `!` — you run straight through one. In the editor the 💬 tool paints a `!` and
opens a pop-up to type the words; painting anything else over that square (the
eraser included) throws the message away too, so the two can never drift apart.

**Spinning.** In the air the cube turns at `CONFIG.SPIN_SPEED` and lines back up
with the world when it lands. Two different things happen, though: a jump, a pad,
a catapult or a ramp pop sends you **upward**, and those spin freely the whole way
round; simply **running off the edge** of a block is one tidy quarter-turn — the
cube turns 90° and then holds that angle until it lands, however far it falls.
`player.flipTo` is the angle it stops at (`null` = spin freely), set at the end of
a step when you left the ground without heading upward, and cleared the moment you
land. Landing goes through `landRotation()`, which finishes an unfinished
quarter-turn rather than snapping to the nearest 90°. Sliding on a ramp is not
falling, so it never flips — a ramp just tilts the cube ±45°.

The floor is implicit: the bottom row of the grid sits on an automatic ground
plane. Rows are top-to-bottom; all rows in a level must be the same length.

The **sky**, by contrast, is not the grid's height. `cellTop()` is anchored to the
bottom, so a level's tiles sit at the same world position no matter how many rows
are above them, and `skyTop(level)` (in `js/game/level.js`) returns the roof of
the world: `CONFIG.LEVEL_ROWS` tall, or the level's own height if it is taller.
That roof is what a flipped-gravity cube lands on and what a flying cube scrapes;
in normal cube play there is no ceiling at all. Because the grid itself is never
padded, row indices, `"col,row"` coin keys and stored level strings are unaffected
— which keeps the client in step with the server's `coinKeysFor()`.

## A level's own rules

A level may **bend some of the game's numbers while you are inside it** — moon
gravity, a giant jump, a fiercer rocket. They live beside the grid in the level's
`rules`, a flat little map of CONFIG name → number (`{"GRAVITY": 1500}`), the
same shape `settings.json` used to have. **Only the numbers a level actually
changes are stored**, so a level with no `rules` (every level made before this
existed) plays exactly as it always did.

There used to be a *world-wide* version of this — a ★ "Save for everyone" button
writing `data/settings.json`. **That is gone.** One shared set of numbers meant a
moon level and a heavy level could not both exist, and one tap changed the game
for everybody. `CONFIG` in `js/config.js` is now simply *the* numbers; a level is
the only thing that may bend them, and only for as long as you are playing it.

**How it works: the level borrows.** `js/rules.js` owns both halves —
`LEVEL_RULES` (which numbers, and each one's friendly slider range) and the
borrowing itself. `applyLevelRules(rules)` remembers what each number was, writes
the level's number into `CONFIG`, and `clearLevelRules()` hands every one of them
back. `main.js` calls the first in `startLevel()` and the second in `leaveGame()`.
Nothing else in the game knows any of this is happening — `physics.js` and
`render.js` read `CONFIG` exactly as they always did, which is why **the golden
traces are untouched by this feature**.

Two things about that are load-bearing:

- `applyLevelRules` **gives back first, then borrows**. "Play All" goes straight
  from one level into the next without passing through `leaveGame()`, and without
  the restore-first the second level would pile its numbers on top of the first
  one's and the originals would be lost.
- The ⚙ Settings panel and `LEVEL_RULES` **share no keys at all**. Settings is
  sound and comfort (volume, music, beat pulse, trail, screen shake); rules are
  movement and feel. That is what makes them safe to use at the same time, and
  it's why "Reset" in the panel puts back only the panel's own keys instead of
  the whole of `CONFIG` — a whole-CONFIG reset mid-play would wipe the rules of
  the level you're standing in.

**Movement and feel only.** No `TILE`, `PLAYER_SIZE` or `LEVEL_ROWS` (those would
move the level's own tiles about), and no colors — the 🎨 theme owns those.

In the editor it's the **⚙ Rules** button, which shows a count when a level bends
anything ("⚙ Rules 3"). Its pop-up builds itself from `LEVEL_RULES`, one slider a
row: a slider you have never touched says **normal** and is not saved, and a ↺
puts one back to normal. **▶ Try it** shuts the pop-up and test-plays, so a kid
can feel the change straight away. The rules ride along in "Copy code" / Import
on one line, next to `reward:`, and code copied before this existed still imports.

**The server checks it again** (`cleanLevelRules` in `lib/validate.js`), by the
same rule as signs and looks: a number that isn't in the list is **dropped**, one
that is out of range is **clamped**, and nothing is ever refused — an odd rule
should never stop a kid saving their level. `LEVEL_RULE_LIMITS` there is
deliberately *wider* than the editor's slider ranges: the sliders are the
friendly range a kid drags in, the limits are only "don't be silly", so the two
lists never have to be kept in exact step. **Adding a tunable a level should be
able to bend means adding it to BOTH** `LEVEL_RULES` (client) and
`LEVEL_RULE_LIMITS` (server) — the server drops anything it doesn't know.

## The file map

**Client** (`public/` — plain ES modules, no build step):

| File | What it owns |
| ---- | ------------ |
| `index.html` | Markup + styles only. One `<script type="module" src="js/main.js">`. No inline JS. |
| `js/config.js` | `CONFIG` (every tunable number), `DEFAULTS`, `THEMES`, and the cube-skin option lists. The kids' control panel. |
| `js/rules.js` | Which of those numbers a **level** may bend, and the borrowing that makes it happen: `LEVEL_RULES`, `applyLevelRules`, `clearLevelRules`, `countRules`. |
| `js/main.js` | The app shell: game state, starting/resetting a level, checkpoints, the game loop, the menu + player picker, and startup. Wires every other module together. |
| `js/api.js` | Every `fetch`: `apiGet`, `apiWrite` (family PIN + one retry), `apiPost` (scores, no PIN). Owns the PIN and the PIN / "are you sure?" pop-ups. |
| `js/input.js` | Taps and keys → actions: jump, hold-to-keep-jumping, reporting held-ness (`setHolding`, for flight), Escape, Z/X checkpoints, in-game buttons. |
| `js/music.js` | The chiptune synth (`Music`) and the `SONGS` list. |
| `js/game/level.js` | The level format: `parseLevel`, the tile legend, and the `tileAt` / `cellTop` / `skyTop` / `groundSpans` lookups. |
| `js/game/physics.js` | **Pure.** The rules of the world at a fixed 240 Hz: `stepPhysics(state, dt)`, `requestJump(state)`. No DOM, canvas, sound or fetch. |
| `js/game/render.js` | Drawing a frame: sky, ground, every tile, HUD, and the win/death overlays. |
| `js/game/player.js` | How a cube *looks*: `drawPlayer`, `normalizeSkin`, `hslToHex`. Shared by the game, the previews and the picker buttons. |
| `js/game/effects.js` | The trail and the death explosion (`drawTrail`, `spawnExplosion`, `renderParticles`). |
| `js/ui/editor.js` | The level editor: paint grid, palette, tune/theme/🎭-look/⚙-rules buttons, zoom, signs, test-play, copy/paste, save. |
| `js/ui/scrollbars.js` | Scroll bars you can drag with a finger (the editor's grid). Knows nothing about levels. |
| `js/ui/skins.js` | The cube editor, its live-preview cube, the **My Looks** row — and, in `forLevel` mode, designing the look a level is played as. |
| `js/ui/settings.js` | The ⚙ Settings panel — **sound and comfort only** (volume, music, beat pulse, trail, screen shake), just for this tablet, saved nowhere. |
| `js/ui/toast.js` | The little "Saved!" pop-up. |
| `js/ui/zoomguard.js` | Keeps the *browser's own* zoom from running away: blocks pinching, and shows a "Reset zoom" button (placed where you can still see it) if the page gets zoomed anyway. |

**Server** (`server/` — Node + Express, one dependency, no build step):

| File | What it owns |
| ---- | ------------ |
| `server.js` | Bootstrap: env vars, static files, mounts the routers, the JSON 404/error handlers, starts listening. |
| `routes/auth.js` | `/api/me`, `/api/accounts` (list + signup), `/api/login`, `/api/set-password`, `/api/logout`. Owns the 5-tries lockout. |
| `routes/levels.js` | `/api/levels` — list, create (+ bounty), reorder, update, delete. |
| `routes/accounts.js` | `/api/accounts/:id` — change your name/cube. **This is the shop:** it prices what changed and takes the coins. |
| `routes/runs.js` | `/api/runs` — "I finished a level with these coins" → coins credited, and the level's look handed over. |
| `routes/scores.js` | `/api/scores` — best % per player per level. |
| `routes/leaderboard.js` | `/api/leaderboard` — everyone ranked by coins earned ever. |
| `routes/prices.js` | `/api/prices` — the shop price list, so the Save button can show a price. |
| `lib/storage.js` | The JSON files: the file table, read, `updateJson`, write-with-backup, backup rotation, first-run seeding. The only place that touches disk. |
| `lib/validate.js` | Everything a tablet sends is checked here. **The allowed tile list lives here, once**, and so does `coinKeysFor` (where a level's coins are). |
| `lib/auth.js` | **The one place that decides who may do what:** roles, `can()`, the login guards, and `publicAccount`/`meView` (the only way an account is sent to a tablet). |
| `lib/passwords.js` | Scrambling and checking passwords (scrypt, from Node's own `crypto`). |
| `lib/sessions.js` | Who's logged in. Stores a *fingerprint* of each token, never the token. |
| `lib/cookies.js` | Reading and writing the login cookie by hand (httpOnly, SameSite=Lax). |
| `lib/prices.js` | The price list, re-read whenever `data/prices.json` changes on disk. |
| `lib/looks.js` | **What cubes you own** ("My Looks"): `sameSkin`, `looksOf`, `ownsLook`, `addLook`. The shop and the runs route both ask here. |
| `lib/migrate.js` | The one-time move from the old `profiles.json` to `accounts.json`. |
| `lib/errors.js` | `NotFound` (404) and `NotAllowed` (403), so routes can `throw` and still answer properly. |

**Other:**

- `data/` — runtime state, created/seeded on first run and **gitignored**:
  - `levels.json` — `{id, name, author, level, song, theme, messages, reward, rules, ownerId, updatedAt}`.
    Array order is the play order (changed via the reorder endpoint). `ownerId` is
    who may edit it; `null` means admin-only (the built-in levels). `messages` is
    the level's signs (`{"col,row": "words"}`) and is missing on older levels.
    `reward` is the look this level is played as and gives you for finishing it
    (`{name, skin}`, or null) — see "My Looks" under Skins. `rules` is the numbers
    this level bends (`{"GRAVITY": 1500}`, or `{}`) — see "A level's own rules".
  - `scores.json` — `{levelId, accountId, player, percent, updatedAt}`: each
    player's **best % completion** per level (100 = finished). One row per
    (level, player); the server keeps the max. `accountId` may be `null` on rows
    saved before accounts existed — the name is the fallback.
  - `accounts.json` — **the players.** See "Accounts, jobs and coins" below.
  - `sessions.json` — who's logged in. Holds a *fingerprint* of each login token,
    never the token itself, so an old backup is not a pile of working keys.
  - `prices.json` — **the coin control panel.** Hand-edit it and the shop notices
    immediately, no restart.
  - `meta.json` — the game's own notes: `nextLevelId` (never reused) and when the
    one-time move to accounts happened.
  - `profiles.json.migrated` — the old players file, kept but never read again.
  - `backups/` — timestamped copies of the above, newest 200 kept per file.
- `test/` — the safety net (see Testing below).
- `deploy/` — `hyper-hop.service` (systemd), `Caddyfile` (HTTPS reverse proxy),
  and `SETUP.md` (droplet instructions).

### How the pieces talk

Physics runs at a fixed 240 Hz (`FIXED_DT`), decoupled from drawing, so all tablets
play identically. One full-screen canvas; the camera puts the floor at 78% of screen
height and then **zooms the world so the whole sky fits above it** — one scale
factor, `zoom = floorY / -skyTop(level)`, applied as a single canvas transform
around the world layer so tiles, outlines, glyphs and particles all scale
together. There is no camera Y and no follow/smoothing state to reset. World
coordinates: floor at y = 0, up is negative y. The HUD and the overlays are drawn
after that transform is popped, so they are never zoomed or shaken.

Sideways, the camera is worked out **from the cube**, not from `camX`:
`camLeft = player.x - W * CONFIG.CAMERA_X / zoom` is the world x at the left edge
of the screen, so the cube sits the same fraction of the way across on a little
phone and on a big tablet (`CAMERA_X: 0.33` ≈ a third). `camX` is still the
physics' own "how far the world has scrolled" — it drives the parallax dots and
rides along in the checkpoint snapshots — but it no longer decides where the cube
is drawn. Note the trade: a bigger `CAMERA_X` means less warning of what's ahead.

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
background sky + ground colors. Theme `0` ("Default") means "use the `CONFIG`
colors", so old levels look unchanged. The menu has a **Play All** button that runs
every level in order (adventure mode).

**Caching.** Tablets cache JavaScript hard. The server sends `Cache-Control: no-cache`
for everything under `public/js/`, so a refresh on iPad Safari always picks up new
code. If you add client files outside `js/`, they will NOT get that header.

**One more rule, about changing a saved file.** Every mutation goes through
`updateJson(file, change)` in `lib/storage.js`, which reads, changes and saves in
one uninterrupted go. **The `change` callback must never `await`.** Node does one
thing at a time and `fs.*Sync` never pauses, so a synchronous read-modify-write
can't be interrupted — but one stray `await` in the middle reopens the gap and two
tablets finishing a level at the same moment can wipe out each other's coins.
Return the `SKIP_SAVE` sentinel to mean "nothing changed, don't write" — that's
what keeps the backups folder from filling up with 200 identical copies every time
someone replays a level.

## Accounts, jobs and coins

**Everybody has an account** and logs in with a password (minimum 4 characters —
these are 9-year-olds). A row in `accounts.json` looks like:

```
{ id, name, passwordHash|null, role, extraPerms: [],
  skin: {...}, coins, coinsEarnedTotal,
  collectedCoins: { "<levelId>": ["col,row", ...] },   // coins already paid for
  looks: [ { skin, name, from } ],                     // every cube you own (My Looks)
  bountiesPaid,                                        // how many level bounties earned
  createdAt, updatedAt }
```

`passwordHash: null` means **unclaimed** — the name exists but nobody has picked a
password for it yet. The login screen shows those with a "tap to claim" hint, and
tapping one offers "pick a password so this name is yours". That's how everyone who
played before accounts existed keeps their scores and their levels.

**The three jobs.** Change somebody's `role` by hand in `data/accounts.json` — it
takes effect on their next request, no restart. There is deliberately no button
for it.

| role | may |
| ---- | --- |
| `player` | make levels; edit/delete **their own**; edit their own name + cube; report runs |
| `editor` | everything a player may, plus edit/delete **anybody's** level |
| `admin` | everything an editor may, plus reordering levels and editing any account |

`extraPerms` is a list of extra powers for one person, so you can give a kid
`"level.reorder"` without making them a full admin. **`lib/auth.js` is the only
place that decides any of this** (`can(account, action, thing)`); the client's
`may()` in `js/ui/login.js` mirrors it purely to hide buttons — if you change one,
change the other, but the server is the one that really decides.

**Coins are server-authoritative.** The client says which coins it picked up; the
server checks them against the level's real coin positions and against what you've
already been paid for, then credits the difference. So:

- Coins pay **once**. Replaying a level is still fun, but the coins you've already
  earned draw **silver** and add nothing.
- Finishing matters: an unfinished run credits nothing (and writes nothing).
- Making a **brand-new** level pays `levelCreateBounty`. This is counted, not
  listed by id: you're paid when you own more levels than you've been paid for —
  so making a level, deleting it and making it again earns nothing.
- A level may hold at most `maxCoinsPerLevel` coins, so a level can't be turned
  into a coin machine. The editor keeps you inside it; the server checks it too.
- The **trophy board** ranks by `coinsEarnedTotal` (lifetime earnings), never by
  the balance in your purse, so buying a cube can't cost you your place. If it
  did, nobody would ever buy anything.

**The shop.** Saving your cube is also buying it: the server compares the cube you
sent with the one it has saved and charges for the parts that actually *changed*,
at the prices in `data/prices.json`. Keeping a part the same is free, so **the
default green cube is free forever**, and changing your mind back costs nothing.
**A look you already own is free too**, whatever it looks like — `priceTheChanges`
asks `ownsLook` before it prices anything, and a cube you pay for is added to your
looks in the same breath (see "My Looks" under Skins).
The Save button shows the live price ("Save — 45 coins") and goes to
"Need 20 more" when you can't afford it. Prices are hand-edited in
`data/prices.json` and picked up without a restart:

```
{ "startingCoins": 50, "coinValue": 1, "levelCreateBounty": 25,
  "maxCoinsPerLevel": 25,
  "skin": { "bodyColor": 5, "outlineColor": 5, "faceColor": 5,
            "shape": 20, "face": 10, "emoji": 15, "trail": 25, "explosion": 25 } }
```

**A trap worth knowing about.** `validateAccountEdit` returns a *patch* (only the
fields that were sent) and the route **merges** it onto the saved account. It used
to rebuild the record from scratch, which would now silently wipe out everybody's
password, coins and role every time they saved their cube. The same applies to
levels and `ownerId`. There's a tripwire in `routes/accounts.js` that throws if a
merge ever loses `passwordHash` or `coinsEarnedTotal` — leave it there.

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
from `CONFIG.PLAYER_COLOR`/`PLAYER_EYE_COLOR`, so a colour changed in `config.js`
still recolors no-profile players (like theme 0). Trails and the death explosion are
parameterized by the active skin's style; `CONFIG.TRAIL` and
`CONFIG.PARTICLES_ON_DEATH` still govern the master on/off and piece count. The
skin editor is a third full screen (`#skinScreen`), reached from the picker.

### My Looks, and the look a level is played as

A **look** is a saved skin. Owning one is forever: **wearing a look you already
own is free**, so the cube editor is a wardrobe as well as a shop. Looks arrive
two ways, and an account's list lives in `accounts.json`:

```
looks: [ { skin: {...}, name: "",          from: "shop"  },   // you bought it
         { skin: {...}, name: "The Crow",  from: "level" } ]  // a level gave it to you
```

`server/lib/looks.js` is **the only place that decides what somebody owns**:
`sameSkin`, `looksOf`, `ownsLook`, `addLook`. Two rules are baked into it. An
account with no `looks` yet simply owns the cube it is wearing (`looksOf`'s
fallback), so nothing had to be migrated. And the list caps at `MAX_LOOKS` (30),
dropping the oldest **bought** look — never a level's prize, never the cube you
are wearing right now. `sameSkin` is mirrored in `public/js/game/player.js` so the
Save button can say "free!" before you tap; as always the server is the one that
really decides.

**A level can be played as its own character.** A level record may carry:

```
reward: { name: "The Crow", skin: {...} }    // or null — most levels have none
```

and then *everybody* plays it as that cube — the author included, every time,
**even after they have won it** (the level keeps its character; that's the point).
Finishing it hands the look over for keeps. In the client this is one line in
`activeSkin()` in `main.js`: a level's look beats your own cube, and the trail and
explosion follow because they read `activeSkin` too. `S.reward` is set by
`startLevel(…, levelId, reward)`.

The look is designed in the **level** editor's 🎭 button, which borrows the **cube**
editor to do it: `openSkinEditor(profile, {forLevel: true, name, skin, onDone,
onCancel})`. In that mode nothing is bought and nothing is sent to `/api/accounts`
— the answer goes back to the level editor through `onDone`, and `onDone(null)`
("✖ No look") takes the look off the level again. `main.js` wires the two together
via the editor's `editLook` dep, so `editor.js` still imports no other UI module.
A level's look is the one look that **has a name**, because winning it has to
announce itself; looks you buy are shown as cubes only.

`cleanReward` in `lib/validate.js` tidies it, and follows the signs' rule:
anything odd is **dropped, not refused**. `validateLevel` always returns `reward`
(null when there is none) so that saving a level that used to have one really
does take it away.

The prize is handed over in `routes/runs.js`, inside the same `updateJson` as the
coins. Note the ordering trap there: that callback used to `return SKIP_SAVE` the
moment there were no fresh coins, which would have meant **the tenth replay could
never unlock anything**. It now skips only when there were neither new coins nor a
new look.

## The API

All reads are open. Every **mutation needs you to be logged in** (the browser sends
the `hh_session` cookie automatically) *and* to be allowed to do that particular
thing — see `can()` in `lib/auth.js`. Everything that changes something is refused
with a friendly 403 when `READ_ONLY=true`.

| Method | Path                | Who                | What it does                          |
| ------ | ------------------- | ------------------ | ------------------------------------- |
| GET    | `/api/me`           | anyone             | who am I? (`null` if nobody, always 200) |
| GET    | `/api/accounts`     | anyone             | everyone's name + cube, for the login screen |
| POST   | `/api/accounts`     | anyone             | make a new player `{name, password}` and log in |
| POST   | `/api/login`        | anyone             | `{name, password}` → sets the cookie   |
| POST   | `/api/set-password` | anyone             | claim a name that has no password yet  |
| POST   | `/api/logout`       | anyone             | forget this login                      |
| PUT    | `/api/accounts/:id` | yourself / admin   | change your name and/or cube — **this is the shop** |
| GET    | `/api/levels`       | anyone             | all levels                            |
| POST   | `/api/levels`       | `level.create`     | create a level (+ the new-level bounty) |
| PUT    | `/api/levels/order` | `level.reorder`    | reorder all levels (send `{order:[ids]}`) |
| PUT    | `/api/levels/:id`   | owner / editor     | update a level                        |
| DELETE | `/api/levels/:id`   | owner / editor     | delete a level                        |
| GET    | `/api/scores`       | anyone             | all high scores                       |
| POST   | `/api/scores`       | logged in          | save a `{levelId, percent}` best (see note) |
| POST   | `/api/runs`         | logged in          | `{levelId, collectedCoinKeys, completed}` → `{credited, unlocked, balance}` |
| GET    | `/api/leaderboard`  | anyone             | everyone ranked by coins earned ever   |
| GET    | `/api/prices`       | anyone             | the shop price list                    |

**Logging in still works when `READ_ONLY=true`** — you can come in and play, you
just can't change anything. (It does write `sessions.json`; that's the one write
allowed while frozen, and it's commented as such.)

**Scores never say who they're for.** The tablet sends only the level and the
percent; the server puts *your* name on it, from the cookie. The server only writes
when a score beats that player's old best, so backup churn stays low.

**Passwords.** Scrambled with scrypt from Node's built-in `crypto`
(`lib/passwords.js`), stored as `scrypt$N$r$p$salt$hash` so the settings can change
later, and compared with `timingSafeEqual`. Five wrong guesses locks that name for
60 seconds (in memory only — it forgets on restart). A wrong name and a wrong
password give the *same* message, so guessing can't discover who exists.

Server-side level validation (`lib/validate.js`, returns clear messages): only the
characters `. # ^ v o * | / \ L 7 = - p U s @ ! > < u n f c h g`, all rows equal length,
at most one `|`, ≤ 500 columns, ≤ 30 rows, and at most `maxCoinsPerLevel` coins.
The allowed-character list is defined
**once** (`LEVEL_CHARS`) and the error message is generated from it, so the two
can't drift. The coin limit is handed **in** (`validateLevel(body, { maxCoins })`,
from `routes/levels.js`, which already has `getPrices()`) rather than looked up
here: `validate.js` mustn't require `prices.js`, because that requires
`storage.js`, which requires `validate.js`. With no limit passed there is no cap
at all, which is why only the two save routes enforce it — reading a level that
was already over the limit never re-validates it. A level's signs go through `cleanMessages`: ≤ 30 of them, ≤ 120
letters each, keys that really are a square inside this level. Anything odd is
**dropped, not refused** (like an unknown skin field) — a strange sign should never
stop a kid saving their level.

Server-side profile validation (`validateProfile`/`cleanSkin`, clear messages):
`name` 1–20 characters; colors must match `#rrggbb`; `shape`/`face`/`trail`/
`explosion` must be from the enums above; `emoji` at most **one emoji grapheme**
(counted with `Intl.Segmenter`, so 👍🏽 / 🇸🇪 / 👨‍👩‍👧 count as one; a 50-char
"emoji" is rejected). Unknown extra skin fields are **stripped, not rejected**
(forward-compatible), and a missing/odd non-color field falls back to its default.

Env vars: `PORT` (default 3000), `FAMILY_PIN` (default `1234` for local dev, with a
warning — always set a real one in production), `READ_ONLY` (`true` freezes writes).

`LEVEL_RULE_LIMITS` in `lib/validate.js` is the server's list of numbers a level
may bend, and `LEVEL_RULES` in `public/js/rules.js` is the tablet's. **Whenever
you add a tunable to `CONFIG` that a level should be able to change, add it to
both** — the server silently drops anything it doesn't know, so a slider added on
only one side would appear to work and then vanish on save. Everything else in
`CONFIG` is set in `config.js` and nowhere else.

## Testing

Two automatic checks, both run by `npm test`:

- **`test/golden.js` — did the physics change?** Replays fixture levels through the
  real physics with a fixed jump script (`jumpAt`) and, for the flying levels, a
  fixed hold script (`holdAt`: pairs of `[fromStep, toStep]`), and compares the
  cube's position every few steps against saved traces in `test/golden/`. These
  must stay **byte-identical**. If they differ, the change altered how the game
  plays — find out why. Only regenerate them (`node test/golden.js`) when you
  MEANT to change the game.
  Note the sampled field list in `traceFor()` is effectively frozen: `JSON.stringify`
  emits keys in insertion order, so adding even one field rewrites every trace.
  New state (like `flying`) goes in `newState()`, not in the sample.
- **`test/boot.js` — does the game still hold together?** Loads the real modules with
  a pretend browser and actually runs them: plays a level to the finish and dies on
  another (so the win and death screens draw), then opens the menu bar, login
  screen, trophy board, cube editor and level editor. It then **runs the whole
  thing again in a fresh process with nobody logged in** (`HH_BOOT_LOGGED_OUT=1`),
  so the login screen is exercised too. It doesn't look at pixels — it catches
  *missing* things: a bad import path, a renamed export, or a leftover reference to
  a variable that now lives in another file.

  Two things about it are load-bearing. Its pretend `fetch` answers each `/api/…`
  address with the **shape** the real server sends (an object for `/me`, a list for
  `/levels`), because a stub that says `[]` to everything quietly turns `me.coins`
  into `undefined` and hides real mistakes. And `init()` in `main.js` must **never
  `await` a pop-up** — pop-ups only ever open from a tap. Against the pretend
  browser a pop-up promise never resolves, so an awaited login prompt at start-up
  would hang forever *and* look like a pass.

## Workflow

- Run locally with `npm install` then `npm start`, and open
  `http://localhost:3000`. During sessions the kids reach the laptop over the LAN
  (`http://<laptop-ip>:3000`); between sessions they use the droplet URL.
- Everyone taps their name on the login screen and types their password. The first
  time (or for a name that came across from the old players file) it asks them to
  **pick** a password instead. A login lasts 90 days and survives a server restart.
- Kids build levels in the in-game editor and tap **Save to server** (it asks for a
  name + author once). Tuning is per level now — the editor's **⚙ Rules** button —
  and rides along with the level when it's saved. Everything persists server-side
  and is backed up automatically — no git round-trip needed.
- **Changing the game's numbers for real** (the ones a level can't bend, or the
  starting point every level plays from) is a grown-up job done by editing
  `public/js/config.js` and reloading. There is no button for it on purpose.
- **Grown-up jobs, done by hand in `data/`. None of them need a restart** — the
  server re-reads these files as it goes (the person should reload the page to see
  their new buttons, but the server enforces the change immediately):
  - give somebody a different job → change their `"role"` in `accounts.json`
    (`player` / `editor` / `admin`), or add one power to `"extraPerms"`;
  - change what things cost → edit `prices.json`;
  - forgotten password → set that account's `"passwordHash"` back to `null` and
    they can claim it again with a new one.
- When the kids are present, explain changes as you make them; small readable
  diffs beat clever refactors.

## Testing checklist before any commit

- `npm test` passes (golden traces identical + the game boots and runs).
- `npm start` starts clean and the game loads with no console errors.
- All shipped levels are completable (play or reason through them).
- Jump, pad bounce, spike death, coin pickup, and finish all work by tap alone.
- The newer tiles behave: saw, small pad, catapult, `@` checkpoint respawn, speed
  portals, and a gravity flip (landing on the ceiling) and back.
- Ground gates (`h` … `g`): the floor visibly disappears after an `h`; a running
  cube falls through it and dies; a rocket can fly over the gap; a `g` brings the
  ground back and you can land on it. Upside-down (after a `u`) an `h` takes the
  ROOF away instead and you fall upward out of the world.
- Flying (`f` … `c`): holding climbs and letting go drops; the cube scrapes the
  floor, the roof, and the top and underside of a `#` block without dying (and
  cannot jump off a block it is resting on); spikes, saws and block *sides* still
  kill; pads and ramps do nothing; a `u` mid-flight reverses the thrust; a `@`
  inside a flight section respawns you **flying**; after `c` the cube jumps and
  spins again.
- Upside-down spikes (`v`): a row of them along the roof kills when you jump up
  into it and is harmless to run underneath — and it still kills after a `u`, when
  you are running along the roof and meet it from the other side. Its mercy feels
  the same as a floor spike's.
- Ceiling ramps (`L` `7`): after a `u`, the cube runs up an `L` and down a `7`
  along the roof without dying, and a jump still beats the glue. With gravity
  normal, `L` and `7` do nothing at all (and still never kill); with gravity
  flipped, `/` and `\` likewise do nothing.
- Tapping jump the whole way up a `/` onto the blocks it leads to never kills —
  including right at the very top, where the cube is already inside the first
  block. The same going off the far end down a `\`, and on `L`/`7` after a `u`.
  A ramp into a block stack **one row higher** still kills, as it always has.
- Signs (`!`): the 💬 tool paints a signpost and asks for the words; the sign and
  its words are drawn in the level and the cube runs straight through them. Save,
  go back to the menu, re-open for edit → the words are still there. "Copy code"
  includes a `messages:` line and Import brings the signs back; code copied
  *before* signs existed still imports fine.
- The page itself never zooms: pinch with two fingers on the menu, in a level and
  in the editor → nothing moves. Open the editor, tap **Copy code**, close it, tap
  **Import**, close it → the page is still life-size (this used to zoom in and stay
  there). Tapping 🔍+ twice quickly still zooms the grid twice.
- Turn the tablet both ways in the editor, and try a small window: the bottom row
  (▶ Play … ← Menu) stays on the screen, the tiles shrink or scroll instead.
- The editor by finger: dragging draws a run of blocks (it never pans); both
  scroll bars appear once the grid overflows and drag smoothly; painting at the
  edge of the box slides the grid along; 🔍+ zooms in past "the whole level fits"
  and 🔍− comes back; every palette button shows its name.
- Jumping right over a `=` or a `-`: the arc reaches its full height instead of
  being snatched down onto the slab, and landing on the slab still works.
- Running off the edge of a block gives exactly one 90° flip, held until landing;
  a jump still spins freely; a `\` ramp still just tilts the cube.
- The cube sits about a third of the way across the screen, on a big tablet and a
  small phone alike (`CONFIG.CAMERA_X`).
- Holding thrust for several seconds on a tablet does not select text, scroll, or
  pop the magnifier; sliding a finger off the screen stops the rocket.
- A short old level still looks right with the taller sky (more room above, world
  slightly zoomed), and its gravity-flip sections still work at the new roof.
- Save to server and Edit work by touch; a wrong PIN re-prompts.
- Picking a level theme (🎨 in the editor) changes its background; it survives a save
  and reopen; a "Default"-theme level still follows the `CONFIG` colors.
- **A level's own rules (⚙ Rules):** drag Gravity down → ▶ Try it → the cube
  floats; ↺ → normal again. Save, go back to the menu and play it: still floaty,
  and the button says "⚙ Rules 1" when you reopen it. Play a *different* level
  straight afterwards and it is normal — likewise "Play All" running from a rules
  level into a plain one, and dying and respawning inside a rules level.
  "Copy code" carries the rules and Import brings them back; code copied before
  rules existed still imports. A level with no rules plays exactly as before.
- ⚙ Settings holds **only** sound and comfort (volume, music, beat pulse, trail,
  screen shake) — no gravity/jump sliders and no ★ "for everyone" buttons, even
  for an admin. Opening it mid-play on a rules level and tapping **Reset** leaves
  that level's gravity alone. `curl -X PUT .../api/settings` answers 404.
- Reorder (▲/▼), delete (🗑 with the "are you sure?" pop-up), and **Play All**
  (adventure mode) all work by touch; reorder/delete persist after a reload.
- `READ_ONLY=true` refuses writes with the friendly message; **logging in and
  reading still work**; balances are unchanged.
- The cube editor: each shape/face/trail/explosion changes the live preview; tap the
  preview to jump and **💀 Try it out** fires the explosion; the emoji face renders
  (check iPad Safari + Android Chrome).
- **My Looks**: the row appears once you own two cubes, a level's prize wears a 🏅,
  and tapping one loads it with "You've already got this one — free!" (the purse
  does not move when you save it). Buy something new → it joins the row.
- **A level's look** (🎭 in the level editor): design one, name it, "⇩ Use this
  look" → the button reads 🎭 The Crow and Play tests it wearing that cube, not
  yours. Save, go back, re-open for edit → still there. "✖ No look" takes it off
  and the level goes back to your own cube. Copy code has a `reward:` line and
  Import brings it back; code copied *before* looks existed still imports.
- **Winning a look**: on another account, that level shows 🔒 The Crow on the menu,
  is played as The Crow, and finishing it says "New look: The Crow! 🎭" — then it's
  in that player's My Looks with a 🏅 and free to wear. Replay it: still played as
  The Crow, no second unlock, no new file in `data/backups/` if no coins were fresh.
- Two accounts made on two browsers both show on the login screen after a reload;
  logging in as one shows its cube in-game and its name on the scoreboard/as author.

**Accounts, jobs and coins:**

- Claim a migrated name on the iPad while a second account is logged in on Android;
  both stay logged in independently.
- Five wrong passwords → the friendly 60-second lockout; after a minute it works.
- A reload keeps you logged in; so does restarting the server.
- `document.cookie` in the console shows **nothing** (the login cookie is httpOnly),
  and `localStorage` holds only `hh_last_account`.
- Finish a level with coins: the HUD shows your purse, the win screen says
  "+N coins!", and the menu bar agrees. Replay it: those coins are **silver**, no
  "+N", and the purse doesn't move.
- Die halfway with coins collected → nothing credited, no new file in `data/backups/`.
- The coin cap: pick the coin tool → the `★ N / 25` chip appears and counts up.
  Paint a 26th coin → the first coin (leftmost column, top to bottom) disappears
  and a toast says so; **dragging** on at the limit swaps exactly one, not a whole
  row. A level saved before the limit opens with a red `30 / 25`, plays fine, and
  asks before trimming when you save. A hand-made `curl` save with too many coins
  is refused by the server.
- Make a brand-new level → the bounty toast. Delete it and make another → **no**
  second bounty. (Making a genuinely additional level does pay again.)
- Cube shop: change one thing → the Save button shows the price and the itemised
  list; spend down until something is unaffordable → "Need N more" and the button
  is disabled; change your mind back → free again. Buy something and check the
  purse. Reopen the editor → free (no changes).
- As a `player`: no ▲/▼ on any level, ✎/🗑 only on your own. Then
  `curl -X DELETE` somebody else's level **with that player's cookie** → a
  friendly 403. (Hiding buttons is not the security; this is.)
- Hand-edit an account to `"editor"` → ✎/🗑 on every level. Add
  `"extraPerms": ["level.reorder"]` to a `player` → ▲/▼ appear.
- Edit `data/prices.json` while the server runs → the cube editor shows the new
  price without a restart.
- The trophy board ranks by coins **earned**, and buying a cube does not move you
  down it.
- A skin is cosmetic only: a circle/diamond cube dies and lands exactly where a
  square would (hitbox is always `CONFIG.PLAYER_SIZE`).
- A refresh on the iPad picks up new code (the `js/` no-cache header is working).
- `CONFIG` in `public/js/config.js` still reads as the kids' control panel, comments
  intact.
