var cors = require('../_cors');
var auth = require('./_auth');

var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function supaFetch(path, opts) {
  var headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  };
  if (opts && opts.headers) {
    Object.keys(opts.headers).forEach(function(k) { headers[k] = opts.headers[k]; });
  }
  return fetch(SUPABASE_URL + '/rest/v1' + path, Object.assign({}, opts, { headers: headers }));
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

module.exports = async function(req, res) {
  if (cors.handlePreflight(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    var session = await auth.requireB2B(req, res);
    if (!session) return;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    var company = session.company;
    var days = Math.max(7, Math.min(365, parseInt((req.query && req.query.window_days) || 30, 10) || 30));
    var sinceISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    var qQuotes = '/b2b_quotes?company_id=eq.' + company.id + '&created_at=gte.' + encodeURIComponent(sinceISO) + '&select=id,total,status,created_at';
    var qOrders = '/b2b_orders?company_id=eq.' + company.id + '&created_at=gte.' + encodeURIComponent(sinceISO) + '&select=id,total,status,created_at';
    var qInvoices = '/b2b_invoices?company_id=eq.' + company.id + '&created_at=gte.' + encodeURIComponent(sinceISO) + '&select=id,total,status,due_date,created_at';
    var qCompany = '/b2b_companies?id=eq.' + company.id + '&select=id,name,tier,status,credit_limit';

    var responses = await Promise.all([
      supaFetch(qQuotes),
      supaFetch(qOrders),
      supaFetch(qInvoices),
      supaFetch(qCompany)
    ]);

    if (!responses[0].ok || !responses[1].ok || !responses[2].ok || !responses[3].ok) {
      return res.status(500).json({ error: 'Failed to load portal summary' });
    }

    var quotes = safeArray(await responses[0].json());
    var orders = safeArray(await responses[1].json());
    var invoices = safeArray(await responses[2].json());
    var companies = safeArray(await responses[3].json());

    var now = Date.now();
    var totals = {
      quote_count: quotes.length,
      order_count: orders.length,
      invoice_count: invoices.length,
      quote_value: quotes.reduce(function(sum, q) { return sum + (parseFloat(q.total || 0) || 0); }, 0),
      order_value: orders.reduce(function(sum, o) { return sum + (parseFloat(o.total || 0) || 0); }, 0),
      unpaid_count: invoices.filter(function(i) { return i.status === 'unpaid'; }).length,
      overdue_count: invoices.filter(function(i) {
        if (!i.due_date || i.status === 'paid') return false;
        var due = Date.parse(i.due_date);
        return !Number.isNaN(due) && due < now;
      }).length
    };

    return res.status(200).json({
      name: 'DPN B2B Portal',
      status: 'online',
      company: companies[0] || company,
      window_days: days,
      summary: totals,
      routes: {
        login: '/api/b2b/login',
        register: '/api/b2b/register',
        catalog: '/api/b2b/catalog',
        pricing: '/api/b2b/pricing',
        quotes: '/api/b2b/quotes',
        orders: '/api/b2b/orders',
        invoices: '/api/b2b/invoices',
        procurement: '/api/b2b/procurement'
      },
      ui: '/b2b-portal.html'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
