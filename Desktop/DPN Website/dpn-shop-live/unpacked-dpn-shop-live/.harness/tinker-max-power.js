// ============================================================
// .harness/tinker-max-power.js
// DEL PILAR NAILS — AUTONOM MAX-POWER TINKER-CYKLUS
// Kører: node .harness/tinker-max-power.js
// Cron: vercel.json → "0 2 * * *" (natligt 02:00)
// Mandat: GRØN (kun additive adapter-deploy, aldrig rød uden gate)
// ============================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var CONFIG = {
  tinkerEndpoint: process.env.TINKER_API_URL || 'https://tinker-api.thinkingmachines.ai/v1/fine-tune',
  tinkerApiKey: process.env.TINKER_API_KEY,
  baseModel: 'thinkingmachines/inkling-41b-active',

  adapterName: function() {
    return 'dpn_max_' + new Date().toISOString().split('T')[0] + '_' + Date.now();
  },
  loraRank: 64,
  loraAlpha: 128,
  targetModules: ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj'],
  epochs: 5,
  learningRate: 3e-5,
  batchSize: 4,
  warmupRatio: 0.1,

  minSamples: 500,
  replayRatio: 0.30,

  deployThreshold: 0.93,
  evaluationSplit: 0.15,
  adapterDir: process.env.ADAPTER_DIR || '/adapters/',
  vllmHost: process.env.VLLM_HOST || 'http://inkling:8000',

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY
};

function log(level, msg, meta) {
  var line = '[' + new Date().toISOString() + '] [TINKER-MAX] [' + level + '] ' + msg + ' ' + JSON.stringify(meta || {});
  console.log(line);
  try { fs.appendFileSync('/tmp/dpn-tinker-max.log', line + '\n'); } catch (e) {}
}

async function sb(table, queryString) {
  var url = CONFIG.supabaseUrl + '/rest/v1/' + table + '?' + queryString;
  var r = await fetch(url, {
    headers: {
      'apikey': CONFIG.supabaseKey,
      'Authorization': 'Bearer ' + CONFIG.supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  });
  if (!r.ok) {
    var txt = await r.text();
    throw new Error('Supabase error [' + r.status + ']: ' + txt);
  }
  return r.json();
}

async function sbInsert(table, row) {
  var url = CONFIG.supabaseUrl + '/rest/v1/' + table;
  var r = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': CONFIG.supabaseKey,
      'Authorization': 'Bearer ' + CONFIG.supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!r.ok) {
    var txt = await r.text();
    throw new Error('Supabase insert error [' + r.status + ']: ' + txt);
  }
  return r.json();
}

async function buildDataset() {
  log('INFO', 'Bygger dataset fra dpn_interactions + replay');

  var weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var corrections = await sb('dpn_interactions',
    'select=id,prompt,correct_response,agent_key,created_at&status=eq.corrected&created_at=gte.' + weekAgo + '&order=created_at.desc'
  );

  var replayRaw = await sb('dpn_interactions',
    'select=prompt,correct_response,agent_key&status=eq.approved&limit=200'
  );

  var replayCount = Math.floor(replayRaw.length * CONFIG.replayRatio);
  var replaySample = replayRaw.slice(0, replayCount);

  var dataset = corrections.concat(replaySample).map(function(item) {
    return {
      prompt: item.prompt || ('Agent: ' + item.agent_key),
      response: item.correct_response || '',
      agent_key: item.agent_key,
      source: item.id ? 'live_correction' : 'replay'
    };
  });

  if (dataset.length < CONFIG.minSamples) {
    throw new Error('For faa samples: ' + dataset.length + '. Minimum: ' + CONFIG.minSamples);
  }

  var datasetPath = '/tmp/dpn_dataset_' + Date.now() + '.jsonl';
  fs.writeFileSync(datasetPath, dataset.map(function(d) { return JSON.stringify(d); }).join('\n'));

  log('INFO', 'Dataset bygget: ' + dataset.length + ' records', {
    corrections: corrections.length,
    replay: replaySample.length,
    path: datasetPath
  });

  return { path: datasetPath, count: dataset.length };
}

async function callTinker(datasetPath) {
  log('INFO', 'Starter Tinker max-power traening');

  var adapterName = CONFIG.adapterName();
  var payload = {
    base_model: CONFIG.baseModel,
    adapter_name: adapterName,
    dataset_path: datasetPath,
    hyperparams: {
      epochs: CONFIG.epochs,
      learning_rate: CONFIG.learningRate,
      lora_rank: CONFIG.loraRank,
      lora_alpha: CONFIG.loraAlpha,
      target_modules: CONFIG.targetModules,
      batch_size: CONFIG.batchSize,
      warmup_ratio: CONFIG.warmupRatio,
      evaluation_split: CONFIG.evaluationSplit
    },
    evaluation_config: {
      metric: 'factual_accuracy',
      holdout_path: '/data/holdout/beauty_holdout.jsonl'
    }
  };

  var res = await fetch(CONFIG.tinkerEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.tinkerApiKey
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    var err = await res.text();
    throw new Error('Tinker API fejl [' + res.status + ']: ' + err);
  }

  var job = await res.json();
  log('INFO', 'Tinker job startet', {
    job_id: job.id, adapter: adapterName,
    epochs: CONFIG.epochs, rank: CONFIG.loraRank
  });

  return { job: job, adapterName: adapterName };
}

async function pollAndDownload(jobId, adapterName) {
  log('INFO', 'Venter paa Tinker job fuldførelse', { job_id: jobId });

  var maxWaitMs = 30 * 60 * 1000;
  var start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    var statusRes = await fetch(CONFIG.tinkerEndpoint + '/' + jobId + '/status', {
      headers: { 'Authorization': 'Bearer ' + CONFIG.tinkerApiKey }
    });
    var status = await statusRes.json();

    if (status.state === 'completed') {
      log('INFO', 'Tinker job fuldført', { job_id: jobId, eval_score: status.evaluation && status.evaluation.score });
      return {
        weightsUrl: status.weights_url,
        evalScore: (status.evaluation && status.evaluation.score) || 0,
        adapterName: adapterName
      };
    }

    if (status.state === 'failed') {
      throw new Error('Tinker job fejlede: ' + status.error);
    }

    await new Promise(function(r) { setTimeout(r, 30000); });
  }

  throw new Error('Timeout paa Tinker job');
}

async function deployAdapter(adapterName, weightsUrl, evalScore) {
  log('INFO', 'Evaluerer adapter til deploy', { adapterName: adapterName, score: evalScore });

  if (evalScore < CONFIG.deployThreshold) {
    log('WARN', 'Adapter afvist — score under taerskel', {
      score: evalScore, threshold: CONFIG.deployThreshold
    });
    await sbInsert('dpn_optimization_log', {
      adapter_name: adapterName,
      eval_score: evalScore,
      deployed: false,
      reason: 'threshold',
      created_at: new Date().toISOString()
    });
    return false;
  }

  var adapterPath = path.join(CONFIG.adapterDir, adapterName);
  if (!fs.existsSync(CONFIG.adapterDir)) {
    fs.mkdirSync(CONFIG.adapterDir, { recursive: true });
  }

  var weightsRes = await fetch(weightsUrl, {
    headers: { 'Authorization': 'Bearer ' + CONFIG.tinkerApiKey }
  });
  var weightsBuffer = await weightsRes.arrayBuffer();
  fs.mkdirSync(adapterPath, { recursive: true });
  fs.writeFileSync(path.join(adapterPath, 'adapter_model.safetensors'), Buffer.from(weightsBuffer));

  fs.writeFileSync(path.join(adapterPath, 'adapter_config.json'), JSON.stringify({
    adapter_name: adapterName,
    eval_score: evalScore,
    base_model: CONFIG.baseModel,
    deployed_at: new Date().toISOString(),
    green_mandate: true,
    human_gate: false,
    rank: CONFIG.loraRank,
    epochs: CONFIG.epochs
  }, null, 2));

  log('INFO', 'Adapter gemt paa disk', { path: adapterPath });

  try {
    var swapRes = await fetch(CONFIG.vllmHost + '/v1/load_adapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter_path: adapterPath, adapter_name: adapterName })
    });
    if (swapRes.ok) {
      log('INFO', 'vLLM adapter hot-loaded', { adapterName: adapterName });
    } else {
      log('WARN', 'vLLM hot-swap fejlede — adapter klar til naeste genstart', { status: swapRes.status });
    }
  } catch (e) {
    log('WARN', 'vLLM ikke tilgaengelig for hot-swap', { error: e.message });
  }

  await sbInsert('dpn_optimization_log', {
    adapter_name: adapterName,
    eval_score: evalScore,
    deployed: true,
    human_gate: false,
    lora_rank: CONFIG.loraRank,
    epochs: CONFIG.epochs,
    created_at: new Date().toISOString()
  });

  return true;
}

async function main() {
  log('INFO', '=== DPN MAX-POWER TINKER CYKLUS STARTET ===');

  try {
    var ds = await buildDataset();
    log('INFO', 'Dataset klar', { count: ds.count });

    var tinkerResult = await callTinker(ds.path);
    var downloaded = await pollAndDownload(tinkerResult.job.id, tinkerResult.adapterName);
    var deployed = await deployAdapter(downloaded.adapterName, downloaded.weightsUrl, downloaded.evalScore);

    log('INFO', '=== CYKLUS FULDFØRT ===', {
      adapterName: downloaded.adapterName,
      deployed: deployed,
      evalScore: downloaded.evalScore
    });

    try { fs.unlinkSync(ds.path); } catch (e) {}

  } catch (err) {
    log('ERROR', 'Cyklus fejlede', { error: err.message });
    process.exit(1);
  }
}

module.exports = main;

if (require.main === module) {
  main();
}
