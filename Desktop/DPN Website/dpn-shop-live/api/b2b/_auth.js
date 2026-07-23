// api/b2b/_auth.js
// ---------------------------------------------------------------------------
// B2B authentication helpers. NOT a route handler — just exports functions.
// ---------------------------------------------------------------------------

var crypto = require('crypto');

var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * requireB2B(req, res)
 * Validates Bearer token against b2b_users, returns { user, company } or null.
 * When null is returned the response has already been sent (401).
 */
async function requireB2B(req, res) {
  try {
    var authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
    if (!authHeader || authHeader.indexOf('Bearer ') !== 0) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    var token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    var url = SUPABASE_URL + '/rest/v1/b2b_users?auth_token=eq.' + token + '&select=*,b2b_companies(*)';
    var resp = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!resp.ok) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    var rows = await resp.json();
    if (!rows || rows.length === 0) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    var user = rows[0];
    var company = user.b2b_companies;

    if (!company || (company.status !== 'active' && company.status !== 'pending_verification')) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    return { user: user, company: company };
  } catch (err) {
    console.error('[b2b/_auth] requireB2B error:', err.message);
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

module.exports = { hashPassword: hashPassword, generateToken: generateToken, requireB2B: requireB2B };
