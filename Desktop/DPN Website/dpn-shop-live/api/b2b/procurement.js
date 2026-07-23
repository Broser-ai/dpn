var cors = require('../_cors');
var auth = require('./_auth');

var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

var TIER_MULTIPLIER = { A: 1.4, B: 1.2, C: 1.0, WHOLESALE: 1.6 };

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

  try {
    var session = await auth.requireB2B(req, res);
    if (!session) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    var company = session.company;
    var tier = company.tier || 'C';
    var lookbackDays = Math.max(7, Math.min(365, parseInt((req.query && req.query.lookback_days) || 90, 10) || 90));
    var sinceISO = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    var ordersPath = '/b2b_orders?company_id=eq.' + company.id +
      '&created_at=gte.' + encodeURIComponent(sinceISO) +
      '&select=id,items,total,status,created_at&order=created_at.desc&limit=200';

    var quotesPath = '/b2b_quotes?company_id=eq.' + company.id +
      '&created_at=gte.' + encodeURIComponent(sinceISO) +
      '&select=id,items,total,status,created_at&order=created_at.desc&limit=200';

    var companyPath = '/b2b_companies?id=eq.' + company.id + '&select=id,name,tier,status,credit_limit';

    var responses = await Promise.all([
      supaFetch(ordersPath),
      supaFetch(quotesPath),
      supaFetch(companyPath)
    ]);

    if (!responses[0].ok || !responses[1].ok || !responses[2].ok) {
      return res.status(500).json({ error: 'Failed to read procurement data' });
    }

    var orders = safeArray(await responses[0].json());
    var quotes = safeArray(await responses[1].json());
    var companyRows = safeArray(await responses[2].json());
    var companyRow = companyRows[0] || null;

    var aggregate = {};

    orders.forEach(function(order) {
      var items = safeArray(order.items);
      items.forEach(function(item) {
        var key = String(item.product_id || item.sku || item.product_name || '').trim();
        if (!key) return;
        if (!aggregate[key]) {
          aggregate[key] = {
            key: key,
            title: item.product_name || key,
            qty: 0,
            revenue: 0,
            orders: 0,
            source: 'orders'
          };
        }
        var qty = parseFloat(item.quantity || 0) || 0;
        var lineTotal = parseFloat(item.line_total || item.total || 0) || 0;
        aggregate[key].qty += qty;
        aggregate[key].revenue += lineTotal;
        aggregate[key].orders += 1;
      });
    });

    // Use quote intent as signal booster when order history is sparse.
    quotes.forEach(function(quote) {
      var items = safeArray(quote.items);
      items.forEach(function(item) {
        var key = String(item.product_id || item.sku || item.product_name || '').trim();
        if (!key) return;
        if (!aggregate[key]) {
          aggregate[key] = {
            key: key,
            title: item.product_name || key,
            qty: 0,
            revenue: 0,
            orders: 0,
            quote_intent: 0,
            source: 'quotes'
          };
        }
        aggregate[key].quote_intent = (aggregate[key].quote_intent || 0) + (parseFloat(item.quantity || 0) || 0);
      });
    });

    var multiplier = TIER_MULTIPLIER[tier] || 1.0;
    var records = Object.keys(aggregate).map(function(k) { return aggregate[k]; });
    records.sort(function(a, b) {
      var aScore = (a.qty * 1.2) + (a.revenue / 100) + ((a.quote_intent || 0) * 0.6);
      var bScore = (b.qty * 1.2) + (b.revenue / 100) + ((b.quote_intent || 0) * 0.6);
      return bScore - aScore;
    });

    var recommendations = records.slice(0, 8).map(function(r, idx) {
      var baseQty = Math.max(10, Math.round((r.qty / Math.max(1, lookbackDays / 30)) * multiplier));
      var confidence = Math.min(0.97, 0.45 + Math.min(0.45, (r.orders / 20)) + Math.min(0.12, ((r.quote_intent || 0) / 100)));
      return {
        sku: r.key,
        title: r.title,
        rationale: 'Baseret pa ordrevolumen, omsaetning og quote-intent i ' + lookbackDays + ' dage',
        suggested_qty: baseQty,
        confidence: Math.round(confidence * 100) / 100,
        rank: idx + 1,
        observed_qty: Math.round(r.qty),
        observed_revenue: Math.round(r.revenue * 100) / 100,
        quote_intent_qty: Math.round((r.quote_intent || 0) * 100) / 100
      };
    });

    return res.status(200).json({
      company_id: company.id,
      company: companyRow,
      tier: tier,
      currency: 'DKK',
      lookback_days: lookbackDays,
      generated_at: new Date().toISOString(),
      recommendations: recommendations
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
