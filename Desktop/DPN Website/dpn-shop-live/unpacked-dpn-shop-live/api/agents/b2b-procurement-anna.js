var cors = require('../_cors');

module.exports = async function(req, res) {
  if (cors.handlePreflight(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var now = new Date().toISOString();
  var payload = req.body || {};

  return res.status(200).json({
    agent: 'b2b-procurement-anna',
    mode: req.method,
    verdict: 'draft_generated',
    generated_at: now,
    recommendation: {
      focus_skus: ['BULK-ALMOND-MINT-24', 'BULK-CHARM-ADDON-48'],
      reorder_window_days: 10,
      expected_margin_uplift_pct: 6.5
    },
    input: payload
  });
};
