const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

// ── Connection configuration ───────────────────────────────────────────────
// Managed hosts (Render, Railway, Heroku, Supabase, …) provide a single
// DATABASE_URL and REQUIRE SSL. We read DATABASE_URL from the environment and
// enable SSL automatically when it is present.
//
// SSL rules (CA-gated certificate verification, backward compatible):
//   • PGSSL=false            -> SSL off (local Postgres / private nets).
//   • SSL on = PGSSL=true OR a DATABASE_URL is present. When on:
//       – A CA is provided via PG_CA_CERT (PEM string) or PGSSLROOTCERT (file
//         path)  ->  { ca, rejectUnauthorized: true }  — the server cert is
//         VERIFIED against that CA. PGSSL_MODE=verify-ca additionally skips the
//         hostname check, for providers whose connect host doesn't match the
//         cert SAN (e.g. Render's INTERNAL DATABASE_URL host); default is
//         verify-full (CA + hostname).
//       – No CA  ->  { rejectUnauthorized: false }  — encrypt-only, unauthenticated.
//         This is the previous behavior, preserved so existing deployments keep
//         working (Railway has no pinnable public CA, so it stays here).
const hasUrl = !!process.env.DATABASE_URL;

function loadCa() {
  const inline = process.env.PG_CA_CERT;
  if (inline && inline.trim()) return inline;
  const file = process.env.PGSSLROOTCERT;
  if (file) {
    try { return fs.readFileSync(file, 'utf8'); }
    catch (e) { console.error('[db] PGSSLROOTCERT unreadable, falling back to encrypt-only:', e.message); }
  }
  return null;
}

function resolveSsl() {
  if (process.env.PGSSL === 'false') return false;
  const sslOn = process.env.PGSSL === 'true' || hasUrl;
  if (!sslOn) return false;
  const ca = loadCa();
  if (ca) {
    const opts = { ca, rejectUnauthorized: true };
    // verify-ca: authenticate the CA chain but tolerate a hostname mismatch.
    if ((process.env.PGSSL_MODE || 'verify-full') === 'verify-ca') opts.checkServerIdentity = () => undefined;
    return opts;
  }
  return { rejectUnauthorized: false };   // encrypt-only (unauthenticated) — unchanged default
}

const ssl = resolveSsl();
const max = +(process.env.PG_POOL_MAX || 20);
const idleTimeoutMillis = 30000;
const connectionTimeoutMillis = +(process.env.PG_CONNECT_TIMEOUT || 10000);

const config = hasUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl,
      max,
      idleTimeoutMillis,
      connectionTimeoutMillis,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: +(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'turnidsp',
      password: process.env.PGPASSWORD || 'turnidsp',
      database: process.env.PGDATABASE || 'turnidsp',
      ssl,
      max,
      idleTimeoutMillis,
      connectionTimeoutMillis,
    };

const pool = new Pool(config);

pool.on('error', (err) => console.error('PG pool error:', err.message));

// Log the effective mode once at startup (no secrets — the CA is never printed).
const sslLabel = !ssl ? 'off'
  : (ssl.rejectUnauthorized ? (ssl.checkServerIdentity ? 'verify-ca' : 'verify-full') : 'encrypt-only');
console.log(
  `[db] mode=${hasUrl ? 'DATABASE_URL' : 'PG* vars'} ssl=${sslLabel} poolMax=${max}`
);

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  // helper for a transaction
  withTx: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(client);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};
