# Deploying TurniDSP Platform on a self-managed VPS

This is the guide for running TurniDSP on your own server (Ubuntu/Debian assumed
below) with **PM2** as the process manager and **Nginx** as the reverse proxy/TLS
terminator, instead of a managed platform like Render or Railway (see
`RENDER.md` / `RAILWAY.md` for those).

The three files this guide relies on already exist in `server/`:
- `ecosystem.config.js` — PM2 process definition
- `nginx.conf.example` — reference Nginx site config
- `.env.example` — copy to `.env` and fill in

---

## 0. The one gotcha that breaks every VPS deployment if missed

The app can force every request onto HTTPS and send a `Strict-Transport-Security`
header, but **only when you explicitly set `FORCE_HTTPS=true`** in `.env`. Do
**not** set it until both of these are true:

1. You have a real TLS certificate installed and Nginx is serving HTTPS.
2. Nginx's proxy config includes `proxy_set_header X-Forwarded-Proto $scheme;`
   (already in `nginx.conf.example`).

If you set `FORCE_HTTPS=true` before both of those are in place, one of two
things happens: either the site is completely unreachable (redirects to an
`https://` URL nothing is listening on), or — if Nginx is proxying but missing
that header — every request redirect-loops forever. Leave `FORCE_HTTPS` unset
while you first bring the box up over plain HTTP, turn it on only as the very
last step once HTTPS is confirmed working.

---

## 1. Requirements

- **Node.js 18–22** (see `server/package.json` → `engines`)
- **PostgreSQL 14+**, running locally or reachable over the network
- **Nginx**
- **PM2** (`npm install -g pm2`)
- A domain name pointed at the VPS, if you want a real TLS certificate (Let's
  Encrypt via `certbot`)

## 2. Get the code onto the box and install dependencies

```bash
git clone <your-repo-url> turnidsp
cd turnidsp/server
npm install --omit=dev
```

## 3. Configure PostgreSQL

If Postgres runs on the same VPS (the common case), no SSL is needed — the app
defaults SSL to **off** when you configure it via discrete `PG*` variables
instead of `DATABASE_URL` (see `server/src/db/pool.js`).

```bash
sudo -u postgres createuser turnidsp -P     # set a password when prompted
sudo -u postgres createdb turnidsp -O turnidsp
```

## 4. Configure the app

```bash
cp .env.example .env
```

Edit `.env`:
- `JWT_SECRET` — generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `PGHOST=localhost`, `PGUSER=turnidsp`, `PGPASSWORD=<what you set above>`, `PGDATABASE=turnidsp`
- Leave `DATABASE_URL` and `PGSSL` unset (local Postgres, no TLS needed)
- Leave `FORCE_HTTPS` **unset** for now (see section 0)
- `PORT=3000` (or whatever `nginx.conf.example`'s `proxy_pass` should point to)

## 5. Run migrations once

```bash
npm run migrate          # schema only
# npm run seed            # optional: also inserts demo branches/services/admin user
```

This is idempotent — safe to re-run after pulling schema changes, but it does
**not** need to run on every restart, which is why the PM2 config below runs
`src/app.js` directly rather than `npm start` (which also runs migrations).

## 6. Start the app under PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup     # prints an OS-specific command — copy/paste and run it once,
                 # so PM2 (and this app) comes back up automatically on reboot
```

Check it's actually up:

```bash
curl http://127.0.0.1:3000/api/health
# {"ok":true,"ts":"..."}
```

Logs: `pm2 logs turnidsp` (also written to `server/logs/out.log` and `error.log`).

## 7. Configure Nginx (plain HTTP first)

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/turnidsp
sudo ln -s /etc/nginx/sites-available/turnidsp /etc/nginx/sites-enabled/
```

Edit `/etc/nginx/sites-available/turnidsp`:
- Replace `app.tuodominio.it` with your real domain.
- **Comment out the HTTPS `server {}` block for now** (you don't have a
  certificate yet) and temporarily change the HTTP block's
  `location / { return 301 https://...; }` to `proxy_pass http://127.0.0.1:3000;`
  instead, so you can reach the app over plain HTTP first.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://your-domain-or-ip/` — you should land on the login page, and
after logging in, on `app.html` (the SPA shell). If this doesn't work, check
`pm2 logs turnidsp` and confirm the app is bound to the port Nginx is
proxying to.

## 8. Get a TLS certificate and switch to HTTPS

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d app.tuodominio.it
```

Certbot will rewrite the Nginx config to add the HTTPS server block and the
HTTP→HTTPS redirect automatically (or you can restore `nginx.conf.example`'s
original two-`server{}`-block form once you have the certificate paths).
Reload Nginx: `sudo nginx -t && sudo systemctl reload nginx`.

Confirm the app sees the forwarded protocol correctly:

```bash
curl -I https://app.tuodominio.it/
# should NOT redirect, should return 200
```

## 9. Only now, turn on FORCE_HTTPS

```bash
echo "FORCE_HTTPS=true" >> .env
pm2 restart turnidsp
```

Re-test:

```bash
curl -I http://app.tuodominio.it/     # via Nginx's HTTP block, should 301 to https
curl -I https://app.tuodominio.it/    # should 200, and now include
                                       # Strict-Transport-Security in the response
```

If you see a redirect loop at this step, it means Nginx isn't sending
`X-Forwarded-Proto: https` on the HTTPS server block — re-check
`nginx.conf.example` line-by-line against your actual config.

## 10. Uploaded documents (PDFs)

By default, uploads are stored at `server/uploads/`. On a VPS this is fine as
long as it's on persistent local disk (it is, by default). If you want it
elsewhere, set `UPLOAD_DIR=/path/to/uploads` in `.env` and make sure the PM2
process's user can write to it.

## 11. Updating the app later

```bash
cd turnidsp/server
git pull
npm install --omit=dev
npm run migrate          # safe/idempotent, only matters if the schema changed
pm2 restart turnidsp
```

## 12. Scaling beyond one process (optional, do this before raising `instances`)

`ecosystem.config.js` runs a single instance on purpose: `express-rate-limit`
(used for login and password-reset throttling) keeps its counters in memory,
per-process. Running multiple PM2 instances without changing this would let
each instance apply the configured rate limit independently, so the effective
limit across the whole app becomes `configured max × instance count`. If you
need to scale, swap `express-rate-limit`'s store for a shared one (e.g.
`rate-limit-redis` against a Redis instance) first, then raise `instances` in
`ecosystem.config.js` and switch `exec_mode` to `'cluster'`.
