#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ORCHESTRATOR_DIR = path.join(ROOT, '.orchestrator');
const RUNTIME_DIR = path.join(ORCHESTRATOR_DIR, 'runtime');

const CONTROL_PATH = path.join(ORCHESTRATOR_DIR, 'control-plane.yaml');
const POLICY_PATH = path.join(ORCHESTRATOR_DIR, 'openai-request-policy.json');
const GROOMING_PATH = path.join(ORCHESTRATOR_DIR, 'context-grooming-metadata.json');
const SHARD_MAP_PATH = path.join(ORCHESTRATOR_DIR, 'shard-map.json');

const HEARTBEAT_PATH = path.join(RUNTIME_DIR, 'heartbeat.ndjson');
const DISPATCH_PATH = path.join(RUNTIME_DIR, 'dispatch.ndjson');
const CONTROL_AUDIT_PATH = path.join(RUNTIME_DIR, 'control-audit.ndjson');
const CONTROL_REPORT_PATH = path.join(RUNTIME_DIR, 'control-report.ndjson');
const LOCK_REGISTRY_PATH = path.join(RUNTIME_DIR, 'locks.json');
const STATUS_PATH = path.join(RUNTIME_DIR, 'status.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath, fallback = '') {
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, 'utf8');
}

function appendNdjson(filePath, payload) {
  fs.appendFileSync(filePath, JSON.stringify(payload) + '\n', 'utf8');
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function parseSimpleYaml(content) {
  const result = {};
  const stack = [{ indent: -1, obj: result }];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) continue;

    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const rawValue = trimmed.slice(idx + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;
    if (!rawValue) {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] });
      continue;
    }

    if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      parent[key] = Number(rawValue);
    } else if (rawValue === 'true' || rawValue === 'false') {
      parent[key] = rawValue === 'true';
    } else {
      parent[key] = rawValue;
    }
  }

  return result;
}

function parseNdjson(filePath) {
  const text = readText(filePath, '');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean);
}

function getRiskBand(budgetPct, controlBands) {
  const pct = Number.isFinite(budgetPct) ? budgetPct : 0;
  const emergency = Number(controlBands.emergency_stop_pct || 70);
  const red = Number(controlBands.red_gt_pct || 60);
  const yellowStart = Number(controlBands.yellow_gte_pct || 50);

  if (pct >= emergency) return 'emergency';
  if (pct > red) return 'red';
  if (pct >= yellowStart) return 'yellow';
  return 'green';
}

function hashScope(scope) {
  return crypto.createHash('sha1').update(scope).digest('hex');
}

function latestByShard(heartbeats) {
  const map = new Map();
  for (const hb of heartbeats) {
    if (!hb || !hb.shard_id) continue;
    const seq = Number(hb.sequence_no || 0);
    const previous = map.get(hb.shard_id);
    if (!previous || seq >= Number(previous.sequence_no || 0)) {
      map.set(hb.shard_id, hb);
    }
  }
  return Array.from(map.values());
}

function toEpochId(nowIso) {
  return nowIso.slice(0, 16) + 'Z';
}

function run() {
  ensureDir(RUNTIME_DIR);

  const controlYaml = readText(CONTROL_PATH);
  if (!controlYaml) {
    throw new Error('Missing control plane file: .orchestrator/control-plane.yaml');
  }
  const control = parseSimpleYaml(controlYaml);
  const policy = readJson(POLICY_PATH, {});
  const shardMap = readJson(SHARD_MAP_PATH, { shards: [] });
  const grooming = readJson(GROOMING_PATH, {});
  const locks = readJson(LOCK_REGISTRY_PATH, {});

  const heartbeats = parseNdjson(HEARTBEAT_PATH);
  const dispatchEvents = parseNdjson(DISPATCH_PATH);
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const reporting = (control.reporting || {});
  const staleAfterSec = Number(reporting.stale_after_sec || 60);
  const criticalStaleAfterSec = Number(reporting.critical_stale_after_sec || 90);

  const latestHeartbeats = latestByShard(heartbeats);
  const stale = [];
  const critical = [];
  let totalQueueDepth = 0;
  let inFlight = 0;
  let avgError = 0;
  let tokenUsageMax = 0;

  for (const hb of latestHeartbeats) {
    const hbMs = Date.parse(hb.heartbeat_ts_utc || nowIso);
    const ageSec = Math.max(0, Math.floor((nowMs - hbMs) / 1000));
    const queueDepth = Number(hb.queue_depth || 0);
    const status = String(hb.status || 'idle');
    const errPct = Number(hb.error_rate_pct_5m || 0);
    const tokenPct = Number(hb.token_usage_pct || 0);

    totalQueueDepth += queueDepth;
    avgError += errPct;
    tokenUsageMax = Math.max(tokenUsageMax, tokenPct);

    if (status === 'running' || status === 'blocked' || status === 'handoff_wait') {
      inFlight += 1;
    }

    if (ageSec > staleAfterSec) stale.push({ shard_id: hb.shard_id, age_sec: ageSec });
    if (ageSec > criticalStaleAfterSec) {
      critical.push({ shard_id: hb.shard_id, age_sec: ageSec });
    }
  }

  if (latestHeartbeats.length > 0) {
    avgError = avgError / latestHeartbeats.length;
  }

  const fallbackBudgetPct = Number(
    (((grooming || {}).latest_measurement || {}).context_budget_pct) || 0
  );
  const contextBudgetPct = tokenUsageMax > 0 ? tokenUsageMax : fallbackBudgetPct;

  const controlBands = ((control.context_budget || {}).bands) || {};
  const riskBand = getRiskBand(contextBudgetPct, controlBands);

  const profile = (((control.runtime_profiles || {}).adaptive_parallelism_by_risk_band) || {});
  const bandCap = Number(profile[riskBand] || 1);
  const hardCap = Number((control.parallelism || {}).runtime_cap_hard || 1);

  const dynCfg = ((control.runtime_controller || {}).dynamic_cap_from_system) || {};
  const cpuRatio = Math.max(1, Number(dynCfg.cpu_to_agent_ratio || 2));
  const minSlots = Math.max(1, Number(dynCfg.min_slots || 1));
  const cpuSlots = Math.max(minSlots, Math.floor(os.cpus().length / cpuRatio));

  const previousStatus = readJson(STATUS_PATH, {});
  const prevMetrics = (previousStatus || {}).metrics || {};
  const windowTokens = Number(prevMetrics.context_window_tokens || 128000);
  const coordinatorCost = Number(prevMetrics.coordinator_cost_tokens || 12000);
  const avgAgentCost = Math.max(1000, Number(prevMetrics.avg_agent_cost_tokens || 6000));
  const safeCapBase = Math.max(0, Math.floor((0.5 * windowTokens - coordinatorCost) / avgAgentCost));

  const qualityPass = Number(prevMetrics.quality_pass_rate_pct || 95);
  const qualityCap = qualityPass < 90 ? 0 : hardCap;

  const maxActiveSubagents = Math.max(0, Math.min(hardCap, bandCap, cpuSlots, safeCapBase, qualityCap));
  const queueDepth = Math.max(0, dispatchEvents.length - inFlight);
  const queueToActiveRatio = inFlight > 0 ? queueDepth / inFlight : queueDepth;

  const isBackpressured = queueToActiveRatio > Number(((control.backpressure || {}).queue_to_active_ratio_max) || 2);
  const duplicateFingerprints = {};

  for (const event of dispatchEvents) {
    const fp = String(event.task_fingerprint || event.fingerprint || '');
    if (!fp) continue;
    duplicateFingerprints[fp] = (duplicateFingerprints[fp] || 0) + 1;
  }

  const duplicateQueueItems = Object.values(duplicateFingerprints)
    .filter((count) => count > 1)
    .reduce((acc, count) => acc + (count - 1), 0);

  const byAgent = {};
  const agentWeights = ((control.load_balancing || {}).agent_weights) || {};

  for (const hb of latestHeartbeats) {
    const shard = shardMap.shards.find((item) => item.id === hb.shard_id);
    const owner = shard ? shard.owner_agent : 'unassigned';
    if (!byAgent[owner]) {
      byAgent[owner] = { queue_depth: 0, in_flight: 0, error_rate_pct_5m: 0, samples: 0 };
    }
    byAgent[owner].queue_depth += Number(hb.queue_depth || 0);
    byAgent[owner].in_flight += hb.status === 'running' ? 1 : 0;
    byAgent[owner].error_rate_pct_5m += Number(hb.error_rate_pct_5m || 0);
    byAgent[owner].samples += 1;
  }

  const agentScores = Object.keys(byAgent).map((agent) => {
    const data = byAgent[agent];
    const weight = Number(agentWeights[agent] || 1);
    const err = data.samples > 0 ? data.error_rate_pct_5m / data.samples : 0;
    const score = (data.queue_depth + 1.2 * data.in_flight + 0.5 * err) / Math.max(0.1, weight);
    return {
      agent,
      weight,
      score: Number(score.toFixed(3)),
      queue_depth: data.queue_depth,
      in_flight: data.in_flight,
      error_rate_pct_5m: Number(err.toFixed(2))
    };
  }).sort((a, b) => a.score - b.score);

  const recommendedAgent = agentScores.length > 0 ? agentScores[0].agent : null;
  const planHash = hashScope(`${riskBand}:${maxActiveSubagents}:${queueDepth}:${contextBudgetPct}`);

  const status = {
    updated_at: nowIso,
    epoch_id: toEpochId(nowIso),
    risk_band: riskBand,
    slots: {
      hard_cap: hardCap,
      band_cap: bandCap,
      cpu_slots: cpuSlots,
      safe_cap_base: safeCapBase,
      quality_cap: qualityCap,
      max_active_subagents: maxActiveSubagents,
      dispatch_slots_available: Math.max(0, maxActiveSubagents - inFlight)
    },
    metrics: {
      context_budget_pct: Number(contextBudgetPct.toFixed(2)),
      coordinator_cost_tokens: coordinatorCost,
      avg_agent_cost_tokens: avgAgentCost,
      context_window_tokens: windowTokens,
      queue_depth: queueDepth,
      queue_to_active_ratio: Number(queueToActiveRatio.toFixed(2)),
      total_queue_depth_heartbeat: totalQueueDepth,
      in_flight: inFlight,
      error_rate_pct_5m: Number(avgError.toFixed(2)),
      stale_heartbeats: stale.length,
      critical_stale_heartbeats: critical.length,
      duplicate_queue_items: duplicateQueueItems,
      lock_count: Object.keys(locks).length,
      quality_pass_rate_pct: qualityPass
    },
    recommended_actions: {
      rebalance_to: recommendedAgent,
      apply_backpressure: isBackpressured,
      pause_new_dispatch: riskBand === 'emergency' || qualityCap === 0,
      correction_required: critical.length > 0 || avgError > 25
    },
    agents: agentScores,
    plan_hash: planHash
  };

  writeJson(STATUS_PATH, status);

  const auditEvent = {
    ts_utc: nowIso,
    type: 'runtime-cycle',
    epoch_id: status.epoch_id,
    risk_band: riskBand,
    max_active_subagents: maxActiveSubagents,
    queue_depth: queueDepth,
    dispatch_slots_available: status.slots.dispatch_slots_available,
    stale_heartbeats: stale,
    critical_stale_heartbeats: critical
  };

  appendNdjson(CONTROL_AUDIT_PATH, auditEvent);
  appendNdjson(CONTROL_REPORT_PATH, status);

  const output = {
    ok: true,
    risk_band: status.risk_band,
    max_active_subagents: status.slots.max_active_subagents,
    dispatch_slots_available: status.slots.dispatch_slots_available,
    context_budget_pct: status.metrics.context_budget_pct,
    queue_depth: status.metrics.queue_depth,
    rebalance_to: status.recommended_actions.rebalance_to
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

run();
