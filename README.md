# Hyper Hop

A tiny Geometry Dash-style auto-runner that runs in any browser. A cube scrolls
to the right on its own — **tap or press Space to jump**, dodge the spikes, grab
the coins, and reach the finish flag.

**▶ Play it:** https://&lt;username&gt;.github.io/hyper-hop/

> The whole game is a single self-contained `index.html` — no build step, no
> frameworks, no dependencies. It's a family project: built by a professor with
> two 9-year-old co-developers who design the levels and tune the game.

## Play locally

No install needed. Either open `index.html` directly in a browser, or serve the
folder (recommended, and how it's played on tablets over the LAN):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. On a tablet on the same network, open
`http://<your-computer-ip>:8000`.

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
taller level. The built-in levels live in the `LEVELS` array near the top of
`index.html`.

## Built-in level editor

Tap **✎ Level Editor** on the menu to open it:

1. Pick a tile from the palette and **tap-to-paint** on the grid (use **Wider +**
   to add length).
2. Tap **▶ Play** to test your level immediately.
3. Tap **Copy code** to export a paste-ready level string.

Paste that string as a new entry in the `LEVELS` array in `index.html`, and your
level ships with the game. (Levels are saved through the code on purpose — there's
no localStorage, so the kids' levels flow through git.)

## Tweaking the game

Open `index.html` and look at the `CONFIG` block at the very top. Every gameplay
number is there with a kid-friendly comment — gravity, jump power, cube size,
colors, sound, screen shake, and more. Change a number, refresh the page, and see
what happens.

## Deploying to GitHub Pages

Because `index.html` is fully self-contained and sits at the repo root, no build
or base-path setup is needed:

1. Push the repo to GitHub.
2. In **Settings → Pages**, set **Source** to **Deploy from a branch**, branch
   **`main`**, folder **`/ (root)`**.
3. The site goes live at `https://<username>.github.io/hyper-hop/` within a minute
   or two.

## Credits

Created by **Niklas Elmqvist** with two young co-developers who own level design
and parameter tuning.

## License

[MIT](LICENSE) © 2026 Niklas Elmqvist
