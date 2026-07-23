var cors = require('../_cors');

module.exports = async function(req, res) {
  if (cors.handlePreflight(req, res)) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var now = new Date().toISOString();
  var target = (req.body && req.body.target_segment) || 'salons-nordic';

  return res.status(200).json({
    agent: 'b2b-marketing-abm',
    verdict: 'campaign_brief_ready',
    generated_at: now,
    segment: target,
    playbook: {
      channels: ['linkedin', 'email', 'instagram'],
      sequence_days: [1, 3, 7, 14],
      hook: 'One-of-a-kind handpainted inventory with predictable wholesale margins'
    }
  });
};
