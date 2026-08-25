// PM2 process manager config for a self-managed VPS deployment.
//
// Usage:
//   cd server
//   npm install
//   npm run migrate                 # run once (and again after any schema change)
//   pm2 start ecosystem.config.js
//   pm2 save                        # persist the process list across reboots
//   pm2 startup                     # generates the OS boot-hook command to run once
//
// IMPORTANT: this intentionally runs `src/app.js` directly (not `npm start`,
// which also runs migrations). Migrations are idempotent but re-running them
// on every PM2 restart/reload is unnecessary and slows down restarts — run
// `npm run migrate` explicitly as a deploy step instead.
//
// instances is 1 (fork mode), not cluster, on purpose: express-rate-limit's
// default in-memory store is per-process. In cluster mode each worker would
// keep its own counters, so the effective login rate limit would become
// (configured max) × (worker count) instead of the intended value. If you
// need to scale to multiple instances, switch express-rate-limit to a shared
// store (e.g. rate-limit-redis) first, then raise `instances` here.
module.exports = {
  apps: [
    {
      name: 'turnidsp',
      script: 'src/app.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        // FORCE_HTTPS is deliberately NOT set here. Add it to your real .env
        // file (not this config) only after confirming Nginx forwards
        // X-Forwarded-Proto correctly — see docs/VPS.md.
      },
      // .env is loaded by the app itself via dotenv; PM2 doesn't need to
      // inject secrets here as long as a real .env file sits next to
      // package.json in this same `server/` directory.
      max_memory_restart: '400M',
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '10s',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
