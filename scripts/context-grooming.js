#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ORCHESTRATOR_DIR = path.join(ROOT, '.orchestrator');
const METADATA_PATH = path.join(ORCHESTRATOR_DIR, 'context-grooming-metadata.json');
const CONTROL_PATH = path.join(ORCHESTRATOR_DIR, 'control-plane.yaml');
const ARCHIVE_DIR = path.join(ORCHESTRATOR_DIR, 'archive');
const INDEX_PATH = path.join(ARCHIVE_DIR, 'recovery-index.json');

const TOKEN_REPORT_PATH = path.join(ROOT, 'token-usage-output.txt');
const STATUS_PATH = path.join(ORCHESTRATOR_DIR, 'runtime', 'status.json');
const CHECKPOINT_STATUS_MODE = process.argv.includes('--checkpoint-status');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function readText(filePath, fallback = '') {
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, 'utf8');
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
    } else {
      parent[key] = rawValue;
    }
  }

  return result;
}

function parseTokenReport(text) {
  const local = Number((text.match(/Local Total:\s*([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0);
  const main = Number((text.match(/Main session:\s+\$\s*[\d.]+\s+([\d,]+)/) || [])[1]?.replace(/,/g, '') || 0);
  const grand = Number((text.match(/Grand total:\s*([\d,]+)/i) || [])[1]?.replace(/,/g, '') || 0);
  const cache = Number((text.match(/Cache Hit Rate:\s*([\d.]+)/) || [])[1] || 0);
  const lastContext = Number((text.match(/Total:\s*([\d,]+) tokens\s*$/m) || [])[1]?.replace(/,/g, '') || 0);
  return { local, main, grand, cache, lastContext };
}

function getRiskBand(pct, bands) {
  const emergency = Number(bands.emergency_stop_pct || 70);
  const red = Number(bands.red_gt_pct || 60);
  const yellow = Number(bands.yellow_gte_pct || 50);
  if (pct >= emergency) return 'emergency';
  if (pct > red) return 'red';
  if (pct >= yellow) return 'yellow';
  return 'green';
}

function gzipFile(sourcePath, destPath) {
  const data = fs.readFileSync(sourcePath);
  const compressed = zlib.gzipSync(data, { level: zlib.constants.Z_BEST_SPEED });
  fs.writeFileSync(destPath, compressed);
  const sourceHash = crypto.createHash('sha256').update(data).digest('hex');
  return { before: data.length, after: compressed.length, sourceHash };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function nowStamp() {
  return new Date().toISOString().replace(/[.:]/g, '-');
}

function run() {
  const metadata = readJson(METADATA_PATH, null);
  if (!metadata) {
    throw new Error('Missing .orchestrator/context-grooming-metadata.json');
  }

  const control = parseSimpleYaml(readText(CONTROL_PATH, ''));
  const bands = (((control.context_budget || {}).bands) || {});
  const status = readJson(STATUS_PATH, {});
  const statusBudget = Number((((status || {}).metrics || {}).context_budget_pct) || 0);

  const tokenText = readText(TOKEN_REPORT_PATH, '');
  const parsed = parseTokenReport(tokenText);

  const contextBudgetPct = statusBudget > 0 ? statusBudget : Number(metadata.latest_measurement.context_budget_pct || 0);
  const riskBand = getRiskBand(contextBudgetPct, bands);

  metadata.updated_at = new Date().toISOString();
  metadata.latest_measurement = {
    ...metadata.latest_measurement,
    local_total_tokens: parsed.local || metadata.latest_measurement.local_total_tokens || 0,
    main_session_total_tokens: parsed.main || metadata.latest_measurement.main_session_total_tokens || 0,
    grand_total_tokens: parsed.grand || metadata.latest_measurement.grand_total_tokens || 0,
    cache_hit_rate_pct: parsed.cache || metadata.latest_measurement.cache_hit_rate_pct || 0,
    context_budget_pct: contextBudgetPct,
    risk_band: riskBand,
    note: 'runtime groom cycle completed with archive checkpoint',
    policy_source: '.orchestrator/openai-request-policy.json'
  };

  ensureDir(ARCHIVE_DIR);
  const index = readJson(INDEX_PATH, { version: 1, updated_at: null, artifacts: [] });

  const offloaded = [];
  const candidates = [
    {
      filePath: TOKEN_REPORT_PATH,
      removeSource: true,
      reason: 'token report archived after measurement ingest'
    }
  ];

  if (CHECKPOINT_STATUS_MODE || riskBand !== 'green') {
    candidates.push({
      filePath: STATUS_PATH,
      removeSource: false,
      reason: 'runtime status checkpoint compressed for recovery'
    });
  }

  for (const item of candidates) {
    if (!fs.existsSync(item.filePath)) continue;

    const base = path.basename(item.filePath);
    const archiveName = `${base}.${nowStamp()}.gz`;
    const archivePath = path.join(ARCHIVE_DIR, archiveName);
    const compression = gzipFile(item.filePath, archivePath);

    const sourcePath = path.relative(ROOT, item.filePath).replace(/\\/g, '/');
    const hasDuplicate = index.artifacts.some(
      (artifact) => artifact.source_path === sourcePath && artifact.source_sha256 === compression.sourceHash
    );
    if (hasDuplicate) {
      fs.unlinkSync(archivePath);
      continue;
    }

    const hash = sha256File(archivePath);
    const artifact = {
      artifact_id: `ctx-${nowStamp()}-${offloaded.length + 1}`,
      created_at: new Date().toISOString(),
      source_path: sourcePath,
      archive_path: path.relative(ROOT, archivePath).replace(/\\/g, '/'),
      reason: item.reason,
      compression: 'gzip',
      size_before_bytes: compression.before,
      size_after_bytes: compression.after,
      source_sha256: compression.sourceHash,
      sha256: hash,
      restore_steps: [
        'verify sha256 checksum',
        'gunzip archive into original path',
        're-run runtime monitoring if status source is restored'
      ]
    };

    index.artifacts.push(artifact);
    offloaded.push(artifact);

    if (item.removeSource) {
      fs.unlinkSync(item.filePath);
    }
  }

  const totalBefore = offloaded.reduce((acc, item) => acc + item.size_before_bytes, 0);
  const totalAfter = offloaded.reduce((acc, item) => acc + item.size_after_bytes, 0);
  const ratio = totalBefore > 0 ? Number((totalAfter / totalBefore).toFixed(3)) : 0;

  metadata.latest_measurement.grooming_compression_ratio = ratio;
  metadata.workspace_cleanup = metadata.workspace_cleanup || {};
  metadata.workspace_cleanup.offloaded_with_recovery = [
    ...(metadata.workspace_cleanup.offloaded_with_recovery || []),
    ...offloaded.map((item) => ({
      path: item.source_path,
      archive: item.archive_path,
      reason: item.reason,
      sha256: item.sha256
    }))
  ];

  index.updated_at = new Date().toISOString();
  writeJson(INDEX_PATH, index);
  writeJson(METADATA_PATH, metadata);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        risk_band: metadata.latest_measurement.risk_band,
        context_budget_pct: metadata.latest_measurement.context_budget_pct,
        checkpoint_status_enabled: CHECKPOINT_STATUS_MODE || riskBand !== 'green',
        offloaded_count: offloaded.length,
        compression_ratio: ratio
      },
      null,
      2
    ) + '\n'
  );
}

run();
