# Hyper Hop

A tiny Geometry Dash-style auto-runner that runs in any browser. A cube scrolls
to the right on its own — **tap or press Space to jump**, dodge the spikes, grab
the coins, and reach the finish flag.

**▶ Play it:** https://cooljaguar.duckdns.org/

> The game (in `public/`) is plain HTML/CSS/JS — no build step, no frameworks, no
> client dependencies. A tiny Node + Express server (`server/`) stores everyone's
> levels and shared settings so the kids can save straight from their tablets. It's
> a family project: built by a professor with two 9-year-old co-developers who
> design the levels and tune the game.

## Play locally

You need [Node.js](https://nodejs.org) (LTS). Then:

```bash
npm install
npm start
```

Then open <http://localhost:3000>. On a tablet on the same network, open
`http://<your-computer-ip>:3000`.

The first thing you'll see is **Who's playing?** — tap **+ New player**, pick a
name and a password (4 letters or more), and you're in. Everybody gets their own
account, their own cube, and their own purse of coins.

The first run creates a `data/` folder with the starter levels. Levels, accounts,
scores and settings are saved there (and backed up automatically); it's gitignored
on purpose.

## Coins

Playing earns coins, and coins buy new looks for your cube:

- **Collect a coin and finish the level** → it pays. Each coin only ever pays
  once, so coins you've already earned show up **silver** on a replay.
- **Make a brand-new level** → a bounty (25 coins by default).
- **The cube editor is the shop.** Changing a part of your cube costs coins;
  keeping it the same is free, so the classic green cube is free forever. The Save
  button always tells you the price before you tap it.
- **🏆 Trophies** ranks everyone by coins *earned ever*, so buying things never
  costs you your place.

Prices live in `data/prices.json` and a grown-up can change them at any time — the
shop notices straight away, no restart needed.

## Controls

| Action | Input |
| ------ | ----- |
| Jump   | Tap / click, or press **Space** / **↑** |
| Keep hopping | Hold down — the cube jumps again each time it lands |
| Continue after winning | Tap / click |

Everything works by tap alone — it's designed touch-first for iPad and Android
tablets.

## Level format

Levels are ASCII grids, one character per tile:

```
.  empty air
#  solid block (stand on top; hitting the side = death)
^  spike (death; has a forgiving inner hitbox)
o  bounce pad (launches you upward)
*  coin (collectible)
|  finish line (you win!)
```

The floor is automatic — you don't draw it; the bottom row of the grid sits on
the ground. All rows in a level must be the same length. Add more rows to make a
taller level. Levels live on the server in `data/levels.json` (seeded with four
starter levels on first run) and are downloaded when the game starts.

## Built-in level editor

Tap **✎ Level Editor** on the menu to open it:

1. Pick a tile from the palette and **tap-to-paint** on the grid (use **Wider +**
   to add length).
2. Tap **▶ Play** to test your level immediately.
3. Tap **⬇ Save to server** to share it — you name it and say who made it once.
   It shows up on everyone's menu, and a brand-new level earns you a coin bounty.
4. Tap the **✎** next to a level on the menu to open and change it later. You get
   a **✎** on your own levels; grown-ups get one on everybody's.

(The **Copy code** button still exports a paste-ready level string as a manual
backup.)

## Shared settings

Tap the **⚙ Settings** gear on the menu (or in-game) to open the Control Panel.
Changes are just for you until you tap **★ Save for everyone**, which saves the
starred settings (speed, gravity, jump, colors, sound, music…) to the server for
all players. **Reset for everyone** puts them back to the defaults.

## Tweaking the game

Open `public/js/config.js` — that one file is the game's control panel. Every
gameplay number is there with a kid-friendly comment — gravity, jump power, cube
size, colors, sound, screen shake, and more. Change a number, refresh the page, and
see what happens. (These are the *defaults*; the server's saved settings are layered
on top at startup.)

The rest of the game is split into small files under `public/js/`, one job each —
`game/physics.js` is the rules of the world, `game/render.js` draws it, `ui/editor.js`
is the level editor, and so on. See CLAUDE.md for the full map.

## Deploying

The game runs as a small Node server behind Caddy (for automatic HTTPS) on a
DigitalOcean droplet. Step-by-step instructions — Ubuntu setup, Node, the systemd
service, firewall, and how to restore from a backup — are in
[`deploy/SETUP.md`](deploy/SETUP.md).

## Credits

Created by **Niklas Elmqvist** with two young co-developers who own level design
and parameter tuning.

## License

[MIT](LICENSE) © 2026 Niklas Elmqvist
