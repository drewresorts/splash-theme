# Duet's server: the shop wall relay and live streaming

This folder runs on one small server (Oracle Cloud's free tier works). It is
not part of the Shopify theme, and Shopify ignores it.

It runs three things:

- **wall-relay**: passes visitors' changes from the blog page's hidden remote to
  the wall projected in the shop.
- **MediaMTX**: takes a live stream from OBS and turns it into a link the site
  can play.
- **Caddy**: gives both a secure `https://` address, renewed automatically.

Setup takes about an hour, once. Every step is copy and paste.

---

## 1. Get the free server (Oracle Cloud)

1. Sign up at **cloud.oracle.com** → *Start for free*. Pick the **home region**
   nearest to the shop; it can't be changed later. Oracle asks for a card to
   check who you are; the Always Free resources don't charge it.
2. In the Oracle console: **☰ → Compute → Instances → Create instance**.
   - **Name:** `duet-server`
   - **Image:** click *Change image* → **Canonical Ubuntu 24.04**.
   - **Shape:** click *Change shape* → **Ampere** → `VM.Standard.A1.Flex`, with
     **2 OCPUs and 12 GB memory**. It is marked *Always Free-eligible*.
   - **Networking:** leave as is; make sure *Assign a public IPv4 address* is on.
   - **SSH keys:** choose *Generate a key pair for me* and click **Save private
     key**. Keep that file safe: it is the only way into the server.
   - Click **Create**.

   If it says **"Out of capacity"**, try a different *availability domain* in the
   placement section, or try again in a few hours. This is common and does go
   away.
3. When the instance shows **Running**, copy its **Public IP address**
   (for example `129.146.12.34`). You'll need it below.

## 2. Open the server to the internet

Oracle blocks everything by default. Two places need opening.

**In the Oracle console:** on the instance page, click the **subnet** link →
**Security Lists** → **Default Security List** → **Add Ingress Rules**. Add three
rules, each with *Source CIDR* `0.0.0.0/0` and *IP Protocol* `TCP`:

| Destination port | For |
|---|---|
| `80` | secure addresses (certificate checks) |
| `443` | the wall relay and the stream |
| `1935` | OBS sending a live stream (skip if you won't stream) |

**On the server itself:** done in step 4 below.

## 3. Point two addresses at the server

Pick two names on your domain, for example `wall.yourdomain.com` and
`live.yourdomain.com`.

If your domain was bought through Shopify: **Shopify admin → Settings → Domains →**
your domain **→ Domain settings → Edit DNS settings → Add custom record**. If it was
bought elsewhere (GoDaddy, Namecheap…), do the same in their DNS settings.

Add two **A records**:

| Type | Name | Points to |
|---|---|---|
| A | `wall` | your server's public IP |
| A | `live` | your server's public IP |

They can take a few minutes (sometimes an hour) to start working.

## 4. Connect to the server and install

On a Mac, open **Terminal** (Spotlight → "Terminal"). Replace the file name and
IP with yours:

```sh
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@129.146.12.34
```

Type `yes` if it asks about the fingerprint. You are now on the server. Paste
these, one block at a time:

```sh
# Open the ports on the server's own firewall, and keep them open after restarts.
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 1935 -j ACCEPT
sudo netfilter-persistent save
```

```sh
# Install Docker.
curl -fsSL https://get.docker.com | sudo sh
```

```sh
# Get these files.
git clone --depth 1 https://github.com/drewresorts/splash-theme.git
cd splash-theme/streaming
cp .env.example .env
```

## 5. Fill in your settings

```sh
nano .env
```

Change each line to yours. Move with the arrow keys; save with **Ctrl+O**, then
**Enter**, then **Ctrl+X** to leave.

- `WALL_DOMAIN` and `STREAM_DOMAIN`: the two addresses from step 3.
- `WALL_ALLOWED_ORIGINS`: every address your store is reached at, starting
  with `https://` and separated by commas. Include the `.myshopify.com` one,
  since theme previews use it.
- `WALL_ADMIN_PASSWORD`: a long password for staff (see step 8).
- `WALL_OPEN_HOURS`: when visitors can change the wall, for example
  `tue-sat 11:00-19:00, sun 12:00-17:00`. Days are `mon tue wed thu fri sat sun`;
  a range like `mon-fri` works. Leave empty for always.
- `WALL_TIMEZONE`: the shop's time zone, for example `America/New_York`,
  `America/Chicago`, `America/Denver` or `America/Los_Angeles`.
- `PUBLISH_PASS`: a password OBS uses to send a live stream.

## 6. Start it

```sh
sudo docker compose up -d
```

Check it: open `https://wall.yourdomain.com/health` in your browser. It should show
`{"ok":true}`. The first visit can take a minute while the secure certificate is set
up.

It starts again by itself if the server restarts.

## 7. Connect the theme

In the Shopify theme editor:

1. **Online Store → Pages → Add page**: title "Wall", template **wall**. Save.
2. In the theme editor, open that page. In the **Shop wall** section:
   - **Relay address:** `https://wall.yourdomain.com`
   - Add a **Clip** block for each video (upload videos in the block, or in
     **Settings → Files**).
   - Choose the wall's own look.
3. The **Shop wall remote** is already on the blog page. If the wall page's
   address isn't `/pages/wall`, pick it in the remote's **Wall page** setting.

## 8. In the shop

- On the computer connected to the projector, open `yourdomain.com/pages/wall` in
  Chrome and click once for full screen (and sound, if it is on).
- To start it by itself when the computer turns on, use Chrome's kiosk mode:
  `chrome --kiosk --autoplay-policy=no-user-gesture-required https://yourdomain.com/pages/wall`
- **Staff controls:** `https://wall.yourdomain.com/admin` with the staff password.
  - **Lock** stops visitors changing the wall, for a private event for example.
  - **Unlock** lets them back in.
  - **Reset** clears every visitor change at once.

## Live streaming (optional)

In OBS: **Settings → Stream → Service: Custom**:

- **Server:** `rtmp://live.yourdomain.com/cam?user=publisher&pass=YOUR_PUBLISH_PASS`
- **Stream key:** leave empty

While you stream, the site can play it from
`https://live.yourdomain.com/cam/index.m3u8`.

## Updating later

```sh
cd ~/splash-theme && git pull && cd streaming && sudo docker compose up -d --force-recreate
```

## If something isn't working

- **`/health` doesn't load:** check the two A records (step 3) and both sets of
  ports (step 2). To see what's happening, run
  `sudo docker compose logs --tail 50`.
- **The remote says "Can't reach the shop":** the relay address in the Shop wall
  section must match `WALL_DOMAIN`, with `https://`.
- **Changes don't go through:** the store's address must be in
  `WALL_ALLOWED_ORIGINS`, exactly as it shows in the browser. After editing `.env`,
  run `sudo docker compose up -d`.
- **The remote says it's closed:** it is outside `WALL_OPEN_HOURS`, or staff locked it.
