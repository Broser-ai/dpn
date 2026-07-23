module.exports = async function(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'vision-pipeline',
      status: 'online',
      stages: ['detect', 'segment', 'measure', 'shape-classify', 'quality-gate'],
      version: '1.0.0'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST or GET only' });
  }

  var VISION_URL = process.env.VISION_SERVICE_URL;
  var body = req.body || {};

  if (!body.image) {
    return res.status(400).json({ error: 'Missing image field' });
  }

  if (!VISION_URL) {
    return res.status(503).json({ error: 'VISION_SERVICE_URL not configured' });
  }

  try {
    var measureResp = await fetch(VISION_URL + '/measure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: body.image, reference_mm: body.reference_mm || 27.0 })
    });

    if (!measureResp.ok) {
      return res.status(502).json({ error: 'Vision measure failed', status: measureResp.status });
    }

    var measureData = await measureResp.json();

    return res.status(200).json({
      ok: true,
      pipeline: 'measure-first',
      measured_at: new Date().toISOString(),
      result: measureData
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Vision pipeline failed' });
  }
};
