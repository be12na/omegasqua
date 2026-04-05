#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, '.orchestrator', 'runtime');
const PID_FILE = path.join(RUNTIME_DIR, 'controller.pid');
const LOG_FILE = path.join(RUNTIME_DIR, 'controller.log');
const HEARTBEAT_FILE = path.join(RUNTIME_DIR, 'controller-heartbeat.ndjson');
const STATUS_FILE = path.join(RUNTIME_DIR, 'status.json');

const START_MODE = process.argv.includes('--start');
const STOP_MODE = process.argv.includes('--stop');
const STATUS_MODE = process.argv.includes('--status');
const FOREGROUND_MODE = process.argv.includes('--foreground');

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = String(fs.readFileSync(PID_FILE, 'utf8') || '').trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isPidRunning(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

function clearPidFile() {
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
}

function appendLog(message) {
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function appendHeartbeat(payload) {
  fs.appendFileSync(HEARTBEAT_FILE, JSON.stringify(payload) + '\n', 'utf8');
}

function getArg(name, fallbackValue) {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!direct) return fallbackValue;
  const value = Number(direct.slice(name.length + 1));
  if (!Number.isFinite(value) || value <= 0) return fallbackValue;
  return value;
}

function runCycle() {
  const monitor = spawnSync(process.execPath, [path.join(__dirname, 'orchestrator-runtime.js')], {
    cwd: ROOT,
    encoding: 'utf8'
  });

  const groom = spawnSync(process.execPath, [path.join(__dirname, 'context-grooming.js')], {
    cwd: ROOT,
    encoding: 'utf8'
  });

  const status = fs.existsSync(STATUS_FILE)
    ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
    : null;

  const payload = {
    ts_utc: new Date().toISOString(),
    monitor_exit_code: monitor.status,
    grooming_exit_code: groom.status,
    monitor_ok: monitor.status === 0,
    grooming_ok: groom.status === 0,
    risk_band: status ? status.risk_band : 'unknown',
    context_budget_pct: status && status.metrics ? status.metrics.context_budget_pct : null,
    max_active_subagents: status && status.slots ? status.slots.max_active_subagents : null,
    dispatch_slots_available: status && status.slots ? status.slots.dispatch_slots_available : null
  };

  appendHeartbeat(payload);

  if (monitor.status !== 0) {
    appendLog(`[cycle] monitor failed: ${String(monitor.stderr || monitor.stdout || '').trim()}`);
  }
  if (groom.status !== 0) {
    appendLog(`[cycle] grooming failed: ${String(groom.stderr || groom.stdout || '').trim()}`);
  }

  const ok = monitor.status === 0 && groom.status === 0;
  appendLog(`[cycle] completed ok=${ok} risk=${payload.risk_band} budget=${payload.context_budget_pct}`);
}

function startDaemon() {
  ensureRuntimeDir();
  const existing = readPid();
  if (existing && isPidRunning(existing)) {
    process.stdout.write(JSON.stringify({ ok: true, already_running: true, pid: existing }, null, 2) + '\n');
    return;
  }

  clearPidFile();
  const intervalSec = getArg('--interval-sec', 30);
  const child = spawn(process.execPath, [__filename, '--foreground', `--interval-sec=${intervalSec}`], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore'
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
  process.stdout.write(JSON.stringify({ ok: true, started: true, pid: child.pid, interval_sec: intervalSec }, null, 2) + '\n');
}

function stopDaemon() {
  const pid = readPid();
  if (!pid || !isPidRunning(pid)) {
    clearPidFile();
    process.stdout.write(JSON.stringify({ ok: true, stopped: false, reason: 'not-running' }, null, 2) + '\n');
    return;
  }

  process.kill(pid);
  clearPidFile();
  process.stdout.write(JSON.stringify({ ok: true, stopped: true, pid }, null, 2) + '\n');
}

function statusDaemon() {
  const pid = readPid();
  const running = pid ? isPidRunning(pid) : false;
  if (!running) clearPidFile();

  const status = fs.existsSync(STATUS_FILE)
    ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
    : null;

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        running,
        pid: running ? pid : null,
        risk_band: status ? status.risk_band : null,
        context_budget_pct: status && status.metrics ? status.metrics.context_budget_pct : null,
        dispatch_slots_available: status && status.slots ? status.slots.dispatch_slots_available : null
      },
      null,
      2
    ) + '\n'
  );
}

function runForeground() {
  ensureRuntimeDir();
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');

  const intervalSec = getArg('--interval-sec', 30);
  appendLog(`[daemon] started interval=${intervalSec}s pid=${process.pid}`);

  const onExit = () => {
    appendLog('[daemon] stopping');
    clearPidFile();
    process.exit(0);
  };

  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);

  runCycle();
  setInterval(runCycle, intervalSec * 1000);
}

if (STOP_MODE) {
  stopDaemon();
} else if (STATUS_MODE) {
  statusDaemon();
} else if (FOREGROUND_MODE) {
  runForeground();
} else if (START_MODE) {
  startDaemon();
} else {
  startDaemon();
}
