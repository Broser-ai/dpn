// GET|POST /api/harness/autonomous/orchestrator — Master orchestration loop.
//
// Ties the autonomous harness together: polls S-agents, routes events through
// the Director, triggers auto-execute, runs self-heal, and periodically
// invokes AI reflection. GET for Vercel cron, POST for manual trigger.
//
// Auth: ADMIN_SECRET_KEY OR x-vercel-cron.

const { handlePreflight } = require('../../_cors');
const { supabaseFetch, isAuthorized, S_AGENTS } = require('../_shared');

const CYCLE_COUNTER_KEY = 'system.orchestrator_cycle';
const ORCHESTRATOR_CURSOR_KEY = 'system.orchestrator_event_cursor';
const REFLECTION_EVERY = 4; // trigger reflection every Nth cycle

async function readRuleInt(key, fallback) {
  const r = await supabaseFetch(
    '/harness_rules?key=eq.' + encodeURIComponent(key) + '&select=value',
    { method: 'GET' },
  );
  const rows = await r.json().catch(function() { return []; });
  return (rows.length && parseInt(rows[0].value, 10)) || fallback;
}

async function writeRuleInt(key, value) {
  const now = new Date().toISOString();
  const existing = await supabaseFetch(
    '/harness_rules?key=eq.' + encodeURIComponent(key) + '&select=value',
    { method: 'GET' },
  );
  const rows = await existing.json().catch(function() { return []; });
  if (rows.length) {
    await supabaseFetch('/harness_rules?key=eq.' + encodeURIComponent(key), {
      method: 'PATCH',
      body: JSON.stringify({ value: String(value), updated_at: now }),
    });
    return;
  }
  await supabaseFetch('/harness_rules', {
    method: 'POST',
    body: JSON.stringify({
      key: key,
      category: 'system',
      value: String(value),
      rationale: 'Auto-managed orchestrator cursor',
      tier: 'green',
    }),
  });
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res, { methods: 'GET, POST, OPTIONS' })) return;
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'GET or POST only' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const started = Date.now();
  const host = req.headers.host || 'dpn-shop-live.vercel.app';
  const base = 'https://' + host;
  const admin = process.env.ADMIN_SECRET_KEY;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (admin || '') };
  const summary = { polls: {}, events: 0, routed: 0, executed: 0, healed: false, reflected: false, errors: [] };

  // 1. Poll ALL S-agents in parallel
  const pollResults = await Promise.allSettled(
    S_AGENTS.map(async (agent) => {
      const name = agent.replace('s-', '');
      const r = await fetch(base + '/api/harness/s-agents/' + name, { method: 'GET', headers });
      return { agent, status: r.status, ok: r.ok };
    }),
  );
  for (const r of pollResults) {
    if (r.status === 'fulfilled') {
      summary.polls[r.value.agent] = r.value.ok ? 'ok' : r.value.status;
    } else {
      summary.errors.push('poll: ' + String(r.reason).slice(0, 100));
    }
  }

  // 2. Check for new events via /poll
  var events = [];
  var eventCursor = 0;
  var maxEventId = 0;
  try {
    eventCursor = await readRuleInt(ORCHESTRATOR_CURSOR_KEY, 0);
    const r = await fetch(base + '/api/harness/poll?since=' + eventCursor + '&limit=50', { method: 'GET', headers });
    if (r.ok) {
      const data = await r.json();
      events = Array.isArray(data.events) ? data.events : (Array.isArray(data) ? data : []);
      maxEventId = data.max_id || eventCursor;
      summary.events = events.length;
    }
  } catch (e) {
    summary.errors.push('poll-events: ' + String(e).slice(0, 100));
  }

  // 3. Route events through the Director
  for (const evt of events.slice(0, 20)) {
    try {
      const r = await fetch(base + '/api/harness/core/director', {
        method: 'POST', headers,
        body: JSON.stringify({ event: evt }),
      });
      if (r.ok) summary.routed++;
    } catch (e) {
      summary.errors.push('director: ' + String(e).slice(0, 80));
    }
  }

  // Persist cursor after routing to avoid replay on next cycle
  if (maxEventId > eventCursor) {
    try {
      await writeRuleInt(ORCHESTRATOR_CURSOR_KEY, maxEventId);
    } catch (e) {
      summary.errors.push('cursor-write: ' + String(e).slice(0, 100));
    }
  }

  // 4. Trigger auto-execute for approved proposals
  try {
    const r = await fetch(base + '/api/harness/autonomous/auto-execute', { method: 'GET', headers });
    if (r.ok) {
      const data = await r.json().catch(function() { return {}; });
      summary.executed = data.executed || 0;
    }
  } catch (e) {
    summary.errors.push('auto-execute: ' + String(e).slice(0, 100));
  }

  // 5. Run self-heal check
  try {
    const r = await fetch(base + '/api/harness/autonomous/self-heal', { method: 'GET', headers });
    summary.healed = r.ok;
  } catch (e) {
    summary.errors.push('self-heal: ' + String(e).slice(0, 100));
  }

  // 6. Cycle counter + periodic reflection
  var cycle = 0;
  try {
    const r = await supabaseFetch(
      '/harness_rules?key=eq.' + encodeURIComponent(CYCLE_COUNTER_KEY) + '&select=value',
      { method: 'GET' },
    );
    const rows = await r.json().catch(function() { return []; });
    cycle = (rows.length && parseInt(rows[0].value, 10)) || 0;
    cycle++;

    if (rows.length) {
      await supabaseFetch('/harness_rules?key=eq.' + encodeURIComponent(CYCLE_COUNTER_KEY), {
        method: 'PATCH',
        body: JSON.stringify({ value: String(cycle), updated_at: new Date().toISOString() }),
      });
    } else {
      await supabaseFetch('/harness_rules', {
        method: 'POST',
        body: JSON.stringify({
          key: CYCLE_COUNTER_KEY, category: 'system',
          value: String(cycle), rationale: 'Orchestrator cycle counter', tier: 'green',
        }),
      });
    }

    if (cycle % REFLECTION_EVERY === 0) {
      const r2 = await fetch(base + '/api/harness/autonomous/reflection', { method: 'GET', headers });
      summary.reflected = r2.ok;
    }
  } catch (e) {
    summary.errors.push('cycle/reflection: ' + String(e).slice(0, 100));
  }

  // 7. Log cycle to execution_log
  try {
    await supabaseFetch('/execution_log', {
      method: 'POST',
      body: JSON.stringify({
        proposal_id: null,
        action_type: 'orchestrator_cycle',
        endpoint_called: '/api/harness/autonomous/orchestrator',
        response_status: 200,
        response_body: JSON.stringify(summary).slice(0, 2000),
        executed_at: new Date().toISOString(),
      }),
    });
  } catch (_) { /* best-effort */ }

  var elapsed = Date.now() - started;
  return res.status(200).json({ ok: true, cycle: cycle, elapsed_ms: elapsed, summary: summary });
};