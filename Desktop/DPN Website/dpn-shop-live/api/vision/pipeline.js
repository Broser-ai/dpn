function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function normalizeUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

async function callStage(baseUrl, stage, payload) {
  var response = await fetch(baseUrl + '/' + stage, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  var json = null;
  try {
    json = await response.json();
  } catch (err) {
    json = { error: 'Invalid JSON from stage ' + stage };
  }

  return {
    ok: response.ok,
    status: response.status,
    stage: stage,
    data: json
  };
}

module.exports = async function(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  var visionUrl = normalizeUrl(process.env.VISION_SERVICE_URL);
  var stages = ['detect', 'segment', 'measure', 'shape-classify', 'quality-gate'];

  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'vision-pipeline',
      status: visionUrl ? 'online' : 'degraded',
      base_url_configured: Boolean(visionUrl),
      stages: stages,
      version: '1.1.0'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST or GET only' });
  }

  var body = req.body || {};
  if (!body.image) {
    return res.status(400).json({ error: 'Missing image field' });
  }
  if (!visionUrl) {
    return res.status(503).json({ error: 'VISION_SERVICE_URL not configured' });
  }

  try {
    var reference = body.reference_mm || 27.0;
    var basePayload = {
      image: body.image,
      reference_mm: reference,
      meta: body.meta || {}
    };

    var stageResults = {};
    var warnings = [];

    // 1) detect
    stageResults.detect = await callStage(visionUrl, 'detect', basePayload);
    if (!stageResults.detect.ok) {
      return res.status(502).json({
        ok: false,
        error: 'Detect stage failed',
        stage: stageResults.detect
      });
    }

    // 2) segment (best effort)
    stageResults.segment = await callStage(visionUrl, 'segment', {
      image: body.image,
      detect: stageResults.detect.data
    });
    if (!stageResults.segment.ok) {
      warnings.push('segment_failed');
    }

    // 3) measure (required)
    stageResults.measure = await callStage(visionUrl, 'measure', {
      image: body.image,
      reference_mm: reference,
      detect: stageResults.detect.data,
      segment: stageResults.segment.ok ? stageResults.segment.data : null
    });
    if (!stageResults.measure.ok) {
      return res.status(502).json({
        ok: false,
        error: 'Measure stage failed',
        stage: stageResults.measure,
        warnings: warnings
      });
    }

    // 4) shape-classify
    stageResults['shape-classify'] = await callStage(visionUrl, 'shape-classify', {
      image: body.image,
      measure: stageResults.measure.data
    });
    if (!stageResults['shape-classify'].ok) {
      warnings.push('shape_classify_failed');
    }

    // 5) quality-gate
    stageResults['quality-gate'] = await callStage(visionUrl, 'quality-gate', {
      detect: stageResults.detect.data,
      segment: stageResults.segment.ok ? stageResults.segment.data : null,
      measure: stageResults.measure.data,
      shape: stageResults['shape-classify'].ok ? stageResults['shape-classify'].data : null
    });
    if (!stageResults['quality-gate'].ok) {
      warnings.push('quality_gate_failed');
    }

    return res.status(200).json({
      ok: true,
      pipeline: 'detect-segment-measure-shape-quality',
      measured_at: new Date().toISOString(),
      warnings: warnings,
      result: {
        detect: stageResults.detect.data,
        segment: stageResults.segment.ok ? stageResults.segment.data : null,
        measure: stageResults.measure.data,
        shape: stageResults['shape-classify'].ok ? stageResults['shape-classify'].data : null,
        quality: stageResults['quality-gate'].ok ? stageResults['quality-gate'].data : null
      },
      stages: stageResults
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Vision pipeline failed' });
  }
};
