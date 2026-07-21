# Deploying Hyper Hop to a DigitalOcean droplet

This walks you through putting Hyper Hop on a fresh **Ubuntu 24.04** droplet so
the kids can play and save levels from their tablets at
`https://cooljaguar.duckdns.org/`.

You only do steps 1–9 once. After that, updating the game is just step 10.

Everything below is run over SSH as `root` (or with `sudo`).

---

## 1. Create the droplet and log in

- In DigitalOcean, create the smallest Ubuntu 24.04 droplet (the $6 one is plenty).
- Point **DuckDNS** at it: in your DuckDNS dashboard set `cooljaguar` to the
  droplet's public IP address. (DNS can take a few minutes to take effect.)
- SSH in:

  ```bash
  ssh root@<droplet-ip>
  ```

## 2. Install Node (LTS) and git

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt install -y nodejs git
node --version    # should print v20.x or newer
```

## 3. Install Caddy (the HTTPS reverse proxy)

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

## 4. Make a user for the game and grab the code

We run the game as a normal user called `hyperhop`, not as root.

```bash
adduser --system --group --home /opt/hyper-hop hyperhop
git clone https://github.com/<your-username>/hyper-hop.git /opt/hyper-hop
chown -R hyperhop:hyperhop /opt/hyper-hop
```

## 5. Install the server's one dependency (Express)

```bash
cd /opt/hyper-hop
sudo -u hyperhop npm install --omit=dev
```

The client (the game itself) has no dependencies and no build step — only the
server uses Express.

## 6. Set the switches

Create `/etc/hyper-hop.env`. There is **no server password to set** — everybody
has their own account and picks their own password the first time they play — so
this file is just a couple of switches.

```bash
cat > /etc/hyper-hop.env <<'EOF'
PORT=8080
READ_ONLY=false
EOF
chmod 600 /etc/hyper-hop.env
```

- **`READ_ONLY`** — leave `false` normally. Set it to `true` to **freeze editing**
  (see the freeze switch section below). Logging in and playing still work.
- **`PORT`** — the port the Node server listens on. Must match the Caddyfile.

To change either of these later, edit this file and run
`sudo systemctl restart hyper-hop`.

### The first grown-up

The first time the new server starts it moves the old players file into
`data/accounts.json`, and makes the account named **Nick** an `admin`. Everybody
else starts as a `player`.

To change somebody's job later, edit `data/accounts.json` by hand:

```bash
sudo -u hyperhop nano /opt/hyper-hop/data/accounts.json   # change "role"
```

**No restart needed** — the server re-reads the file on every request, so the new
job applies to the very next thing that person does. (They should reload the page
to see the new buttons appear, but the server is already enforcing it.)

`"role"` is `"player"`, `"editor"` (may fix anybody's level) or `"admin"` (may also
change the level order and edit any account). To hand out one power without a
whole promotion, add it to that account's `"extraPerms"`, e.g.
`"extraPerms": ["level.reorder"]`.

Do the edit when nobody is mid-save if you can — you and the server are both
writing the same file, and last-one-to-save wins.

If somebody forgets their password, set their `"passwordHash"` to `null` — the
login screen will then offer to let them pick a new one.

### What things cost

`data/prices.json` is the coin price list. Edit it and the game picks it up
**immediately** — no restart:

```bash
sudo -u hyperhop nano /opt/hyper-hop/data/prices.json
```

## 7. Turn on the game server (systemd)

```bash
cp /opt/hyper-hop/deploy/hyper-hop.service /etc/systemd/system/hyper-hop.service
systemctl daemon-reload
systemctl enable --now hyper-hop
systemctl status hyper-hop      # should say "active (running)"
```

The server now starts on boot and restarts itself if it ever crashes. On its very
first run it creates `/opt/hyper-hop/data/` with the four starter levels.

## 8. Point Caddy at the game

```bash
cp /opt/hyper-hop/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

The default Caddyfile serves the game at `https://cooljaguar.duckdns.org/`. If you
want a plain port or a subfolder instead, read the comments inside the Caddyfile
and pick one of the alternatives.

## 9. Open the firewall

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

Now open **https://cooljaguar.duckdns.org/** on a tablet — you should see the
**Who's playing?** screen. Tap your name and pick a password the first time; after
that the tablet stays logged in for 90 days, even across server restarts.

---

## Updating the game later

```bash
cd /opt/hyper-hop
sudo -u hyperhop git pull
sudo -u hyperhop npm install --omit=dev
systemctl restart hyper-hop
```

Your levels, accounts and scores live in `data/` and are **not** touched by an update.

## The freeze switch (READ_ONLY)

To temporarily stop anyone from changing levels or cubes (e.g. during a demo):

```bash
sed -i 's/READ_ONLY=false/READ_ONLY=true/' /etc/hyper-hop.env
systemctl restart hyper-hop
```

The game still plays normally; every attempt to save gets a friendly "editing is
frozen" message. Flip it back to `false` and restart to allow saving again.

## Restoring a level or account file from a backup

Every time anything is saved, the server first copies the old file into
`data/backups/` with a timestamp, and keeps the newest 200 copies. To roll back:

```bash
systemctl stop hyper-hop

# See the available backups (newest last):
ls -1 /opt/hyper-hop/data/backups | grep levels.json

# Copy the one you want back over the live file:
sudo -u hyperhop cp \
  /opt/hyper-hop/data/backups/levels.json.<timestamp>.json \
  /opt/hyper-hop/data/levels.json

systemctl start hyper-hop
```

The same works for `accounts.json` or `scores.json` (swap the filename in both spots).

## Handy commands

```bash
systemctl status hyper-hop      # is it running?
journalctl -u hyper-hop -f      # watch the server's log live
systemctl restart hyper-hop     # after changing /etc/hyper-hop.env
```
