var cors = require('../_cors');
var auth = require('./_auth');

module.exports = async function(req, res) {
  if (cors.handlePreflight(req, res)) return;

  try {
    var session = await auth.requireB2B(req, res);
    if (!session) return;

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    var company = session.company;
    var tier = company.tier || 'C';

    var recommendations = [
      {
        sku: 'BULK-ALMOND-MINT-24',
        title: 'Almond Mint Bulk Set',
        rationale: 'Hoj eftersporgsel i de seneste 30 dage',
        suggested_qty: tier === 'A' ? 120 : tier === 'B' ? 80 : 40,
        confidence: 0.86
      },
      {
        sku: 'BULK-CHROME-BRIDAL-16',
        title: 'Bridal Chrome Signature',
        rationale: 'Hoj margin og lav retur-rate',
        suggested_qty: tier === 'A' ? 90 : tier === 'B' ? 60 : 30,
        confidence: 0.79
      },
      {
        sku: 'BULK-CHARM-ADDON-48',
        title: 'Charm Add-on Pack',
        rationale: 'Stigende attach-rate i checkout',
        suggested_qty: tier === 'A' ? 180 : tier === 'B' ? 120 : 60,
        confidence: 0.74
      }
    ];

    return res.status(200).json({
      company_id: company.id,
      tier: tier,
      currency: 'DKK',
      generated_at: new Date().toISOString(),
      recommendations: recommendations
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
