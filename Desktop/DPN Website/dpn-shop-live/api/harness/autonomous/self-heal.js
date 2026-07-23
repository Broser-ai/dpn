// GET /api/harness/autonomous/self-heal — Self-Healing Monitor
//
// Vercel cron every 5 minutes. Detects stuck cursors, high failure rates,
// expired proposals, and agent health degradation. Takes corrective action
// automatically and emits self-heal events.
//
// Auth: ADMIN_SECRET_KEY OR x-vercel-cron.

const { handlePreflight } = require('../../_cors');
const { supabaseFetch, isAuthorized, H_AGENTS } = require('../_shared');

const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const STALE_EVENT_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_THRESHOLD = 0.5; // 50% failure rate = degraded

function windowISO(ms) {
  return new Date(Date.now() - (ms || WINDOW_MS)).toISOString();
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res, { methods: 'GET, OPTIONS' })) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const host = req.headers.host || 'dpn-shop-live.vercel.app';
  const admin = process.env.ADMIN_SECRET_KEY;
  const authHeader = { Authorization: `Bearer ${admin || ''}` };
  const report = { actions: [], checks: {}, ok: true };

  // ── 1. Check recent execution failures ────────────────────────────────
  try {
    const since = windowISO();
    const r = await supabaseFetch(
      `/execution_log?select=proposal_id,response_status,error,executed_by&executed_at=gte.${since}`,
      { method: 'GET' },
    );
    if (r.ok) {
      const logs = await r.json();
      const total = logs.length;
      const failures = logs.filter(l => l.response_status >= 400 || l.error).length;
      report.checks.executions = { total, failures };

      if (total > 0 && failures / total > FAILURE_THRESHOLD) {
        report.ok = false;
        report.actions.push('high_failure_rate');
        await emitEvent(host, authHeader, 'self_heal_high_failure_rate', 'warning', {
          total, failures, rate: (failures / total).toFixed(2),
        });
      }

      // Per-agent failure tracking
      const agentCounts = {};
      for (const l of logs) {
        const agent = l.executed_by || 'unknown';
        if (!agentCounts[agent]) agentCounts[agent] = { ok: 0, fail: 0 };
        if (l.response_status >= 400 || l.error) agentCounts[agent].fail++;
        else agentCounts[agent].ok++;
      }
      for (const [agent, counts] of Object.entries(agentCounts)) {
        const agentTotal = counts.ok + counts.fail;
        if (agentTotal >= 3 && counts.fail / agentTotal > FAILURE_THRESHOLD) {
          report.actions.push(`agent_degraded:${agent}`);
          await emitEvent(host, authHeader, 'self_heal_agent_degraded', 'warning', {
            agent, ok: counts.ok, fail: counts.fail,
          });
        }
      }
    }
  } catch (_) { report.checks.executions = { error: 'query_failed' }; }

  // ── 2. Check for stuck cursor (unprocessed events older than 5 min) ───
  try {
    const staleTime = windowISO(STALE_EVENT_MS);
    const r = await supabaseFetch(
      `/harness_events?select=id&created_at=lte.${staleTime}&processed=eq.false&order=id.desc&limit=1`,
      { method: 'GET' },
    );
    if (r.ok) {
      const rows = await r.json();
      if (rows.length > 0) {
        // Cursor might be stuck — reset it
        const maxR = await supabaseFetch(
          '/harness_events?select=id&order=id.desc&limit=1',
          { method: 'GET' },
        );
        if (maxR.ok) {
          const maxRows = await maxR.json();
          const maxId = maxRows.length ? maxRows[0].id : 0;
          const resetTo = Math.max(0, maxId - 100);
          await supabaseFetch(
            `/harness_rules?key=eq.${encodeURIComponent('system.event_cursor')}`,
            {
              method: 'PATCH',
              body: JSON.stringify({ value: String(resetTo), updated_at: new Date().toISOString() }),
            },
          );
          report.actions.push('cursor_reset');
          report.checks.cursor = { stuck: true, reset_to: resetTo, max_id: maxId };
          await emitEvent(host, authHeader, 'self_heal_cursor_reset', 'notice', {
            reset_to: resetTo, max_id: maxId, stale_event_id: rows[0].id,
          });
        }
      } else {
        report.checks.cursor = { stuck: false };
      }
    }
  } catch (_) { report.checks.cursor = { error: 'query_failed' }; }

  // ── 3. Check agent health (proposals in last hour) ────────────────────
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const r = await supabaseFetch(
      `/h_agent_proposals?select=agent&created_at=gte.${hourAgo}`,
      { method: 'GET' },
    );
    if (r.ok) {
      const proposals = await r.json();
      const counts = {};
      for (const p of proposals) { counts[p.agent] = (counts[p.agent] || 0) + 1; }
      report.checks.agent_proposals_1h = counts;
    }
  } catch (_) { report.checks.agent_proposals_1h = { error: 'query_failed' }; }

  // ── 4. Clean up expired proposals ─────────────────────────────────────
  try {
    const now = new Date().toISOString();
    const r = await supabaseFetch(
      `/h_agent_proposals?status=eq.pending&expires_at=lt.${now}&select=id`,
      { method: 'GET' },
    );
    if (r.ok) {
      const expired = await r.json();
      if (expired.length > 0) {
        await supabaseFetch(
          `/h_agent_proposals?status=eq.pending&expires_at=lt.${now}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'expired', updated_at: now }),
          },
        );
        report.actions.push('expired_cleanup');
        report.checks.expired_proposals = expired.length;
        await emitEvent(host, authHeader, 'self_heal_cleanup', 'info', {
          expired_count: expired.length,
        });
      } else {
        report.checks.expired_proposals = 0;
      }
    }
  } catch (_) { report.checks.expired_proposals = { error: 'query_failed' }; }

  return res.status(200).json({ ok: report.ok, report });
};

async function emitEvent(host, authHeader, kind, severity, payload) {
  try {
    await fetch(`https://${host}/api/harness/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ agent: 's-order', kind, severity, payload }),
    });
  } catch (_) { /* best-effort */ }
}
