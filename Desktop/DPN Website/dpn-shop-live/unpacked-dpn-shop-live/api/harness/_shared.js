// Shared helpers for /api/harness/* endpoints.
// - Supabase client (service role)
// - Auth: ADMIN_SECRET_KEY OR x-vercel-cron header (for internal jobs)
// - Common schemas: S-Agent list, H-Agent list, severity, verdict

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.method === 'POST' ? 'return=representation' : 'return=minimal',
      ...(opts.headers || {}),
    },
  });
}

function isAuthorized(req) {
  if (req.headers['x-vercel-cron']) return true;
  const admin = process.env.ADMIN_SECRET_KEY || process.env.DPN_ADMIN_KEY;
  if (!admin) return false;  // fail-closed for non-cron requests when no key is configured
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && bearer === admin) return true;
  return false;
}

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

const S_AGENTS = [
  's-web', 's-config', 's-order', 's-photo', 's-render',
  's-inventory', 's-feedback', 's-competitor', 's-balance', 's-vision',
];

const H_AGENTS = [
  'h-recovery', 'h-pricing', 'h-content', 'h-brand', 'h-compliance', 'h-escalation',
];

const SEVERITIES = ['info', 'notice', 'warning', 'critical'];
const VERDICTS = ['approve', 'reject', 'edit'];

module.exports = {
  supabaseFetch,
  isAuthorized,
  parseBody,
  S_AGENTS,
  H_AGENTS,
  SEVERITIES,
  VERDICTS,
};
