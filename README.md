# Hyper Hop

A tiny Geometry Dash-style auto-runner that runs in any browser. A cube scrolls
to the right on its own — **tap or press Space to jump**, dodge the spikes, grab
the coins, and reach the finish flag.

**▶ Play it:** https://cooljaguar.duckdns.org/

> The game (in `public/`) is plain HTML/CSS/JS — no build step, no frameworks, no
> client dependencies. A tiny Node + Express server (`server.js`) stores everyone's
> levels and shared settings so the kids can save straight from their tablets. It's
> a family project: built by a professor with two 9-year-old co-developers who
> design the levels and tune the game.

## Play locally

You need [Node.js](https://nodejs.org) (LTS). Then:

```bash
npm install
FAMILY_PIN=1234 node server.js
```

Then open <http://localhost:3000>. On a tablet on the same network, open
`http://<your-computer-ip>:3000`. The `FAMILY_PIN` is the secret you type to save
levels or shared settings — anyone can play without it.

The first run creates a `data/` folder with four starter levels. Levels and
settings are saved there (and backed up automatically); it's gitignored on purpose.

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
3. Tap **⬇ Save to server** to share it — you name it and say who made it once,
   then type the family PIN. It shows up on everyone's menu.
4. Tap the **✎** next to a level on the menu to open and change it later.

(The **Copy code** button still exports a paste-ready level string as a manual
backup.)

## Shared settings

Tap the **⚙ Settings** gear on the menu (or in-game) to open the Control Panel.
Changes are just for you until you tap **★ Save for everyone**, which saves the
starred settings (speed, gravity, jump, colors, sound, music…) to the server for
all players. **Reset for everyone** puts them back to the defaults.

## Tweaking the game

Open `public/index.html` and look at the `CONFIG` block near the top. Every gameplay
number is there with a kid-friendly comment — gravity, jump power, cube size,
colors, sound, screen shake, and more. Change a number, refresh the page, and see
what happens. (These are the *defaults*; the server's saved settings are layered on
top at startup.)

## Deploying

The game runs as a small Node server behind Caddy (for automatic HTTPS) on a
DigitalOcean droplet. Step-by-step instructions — Ubuntu setup, Node, the systemd
service, firewall, the family PIN, and how to restore from a backup — are in
[`deploy/SETUP.md`](deploy/SETUP.md).

## Credits

Created by **Niklas Elmqvist** with two young co-developers who own level design
and parameter tuning.

## License

[MIT](LICENSE) © 2026 Niklas Elmqvist
