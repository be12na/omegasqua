#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');

const WATCH_MODE = process.argv.includes('--watch');
const DAEMON_MODE = process.argv.includes('--daemon');
const STOP_MODE = process.argv.includes('--stop');
const STATUS_MODE = process.argv.includes('--status');
const FOREGROUND_WATCH_MODE = process.argv.includes('--foreground-watch');
const VALIDATE_ONLY_MODE = process.argv.includes('--validate-only');

const BASE_SOURCE_EXCLUDES = ['.git', '.wrangler'];
const ALWAYS_WATCH = ['manifest.json', 'package.json', 'package-lock.json'];

function normalizeRel(relPath) {
  return String(relPath || '').split(path.sep).join('/');
}

function sanitizeRelativePath(relPath, fieldName) {
  const rel = normalizeRel(relPath).trim();
  if (!rel) {
    throw new Error(`[sync-installer] ${fieldName} tidak boleh kosong.`);
  }
  if (path.isAbsolute(rel) || rel.startsWith('../') || rel.includes('/../') || rel === '..') {
    throw new Error(`[sync-installer] ${fieldName} harus berupa path relatif aman: ${relPath}`);
  }
  return rel;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function uniqueNormalized(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item) continue;
    const rel = sanitizeRelativePath(item, 'entry');
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`[sync-installer] manifest.json tidak ditemukan: ${MANIFEST_PATH}`);
  }

  const raw = readJson(MANIFEST_PATH);
  const outputDir = sanitizeRelativePath(raw.outputDir || 'installer', 'outputDir');

  if (outputDir === '.' || outputDir === './') {
    throw new Error('[sync-installer] outputDir tidak boleh root project.');
  }

  return {
    outputDir,
    includedFiles: uniqueNormalized(raw.includedFiles),
    includeDirectories: uniqueNormalized(raw.includeDirectories),
    runtimeDependencies: uniqueNormalized(raw.runtimeDependencies),
    requiredRuntimeFiles: uniqueNormalized(raw.requiredRuntimeFiles),
    optionalEntries: uniqueNormalized(raw.optionalEntries),
    postBuildValidation: {
      requiredNodeScripts: uniqueNormalized(
        raw.postBuildValidation && raw.postBuildValidation.requiredNodeScripts
      )
    }
  };
}

const manifest = loadManifest();
const INSTALLER_DIR = path.join(ROOT_DIR, manifest.outputDir);
const META_DIR = path.join(INSTALLER_DIR, '.sync-meta');
const STATE_FILE = path.join(META_DIR, 'state.json');
const LOG_FILE = path.join(META_DIR, 'sync.log');
const PID_FILE = path.join(META_DIR, 'watcher.pid');
const WATCHER_OUTPUT_FILE = path.join(META_DIR, 'watcher-output.log');

function isInternalInstallerPath(relPath) {
  const rel = normalizeRel(relPath);
  return rel === '.sync-meta' || rel.startsWith('.sync-meta/');
}

function isOutputPath(relPath) {
  const rel = normalizeRel(relPath);
  return rel === manifest.outputDir || rel.startsWith(manifest.outputDir + '/');
}

function isSourceExcluded(relPath) {
  const rel = normalizeRel(relPath);
  if (!rel) return true;
  if (isOutputPath(rel)) return true;

  return BASE_SOURCE_EXCLUDES.some((item) => rel === item || rel.startsWith(item + '/'));
}

function readWatcherPid() {
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
  } catch (_error) {
    return false;
  }
}

function cleanupWatcherPidFile() {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function writeWatcherPid() {
  ensureDir(META_DIR);
  fs.writeFileSync(PID_FILE, `${process.pid}\n`, 'utf8');
}

function walkFiles(baseDir, excludeFn) {
  const files = [];

  function visit(currentDir, currentRel) {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = normalizeRel(path.join(currentRel, entry.name));
      if (excludeFn(rel, entry)) continue;

      const abs = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(abs, rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  visit(baseDir, '');
  return files.sort();
}

function hashFile(absPath) {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

function getManifestEntries() {
  return {
    files: manifest.includedFiles,
    directories: manifest.includeDirectories,
    dependencies: manifest.runtimeDependencies,
    optional: manifest.optionalEntries
  };
}

function isForbiddenByPolicy(relPath) {
  const rel = normalizeRel(relPath);
  const base = path.posix.basename(rel).toLowerCase();
  const lower = rel.toLowerCase();

  if (/^tests?(\/|$)/i.test(rel)) return true;
  if (/(^|\/)(__tests__|test|tests|spec|e2e)(\/|$)/i.test(rel)) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(base)) return true;
  if (/^scripts(\/|$)/i.test(rel)) return true;
  if (/^\.github(\/|$)/i.test(rel)) return true;
  if (/^\.vscode(\/|$)/i.test(rel)) return true;
  if (/^\.wrangler(\/|$)/i.test(rel)) return true;
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (lower.endsWith('.md') && base !== 'readme.md') return true;
  return false;
}

function ensureAllowedManifestPath(relPath, sourceKind) {
  if (isForbiddenByPolicy(relPath) && normalizeRel(relPath).toLowerCase() !== 'readme.md') {
    throw new Error(
      `[sync-installer] Path tidak boleh masuk installer (${sourceKind}): ${relPath}. ` +
      'Periksa manifest.json agar hanya berisi runtime essentials.'
    );
  }
}

function addEntryFiles(relEntry, sourceKind, options) {
  const rel = sanitizeRelativePath(relEntry, sourceKind);
  if (isOutputPath(rel)) {
    throw new Error(`[sync-installer] ${sourceKind} tidak boleh menunjuk outputDir: ${rel}`);
  }

  const sourceAbs = path.join(ROOT_DIR, rel);
  const isOptional = options && options.optional;
  if (!fs.existsSync(sourceAbs)) {
    if (isOptional) return [];
    throw new Error(`[sync-installer] Entry wajib tidak ditemukan (${sourceKind}): ${rel}`);
  }

  const stat = fs.statSync(sourceAbs);
  if (stat.isFile()) {
    ensureAllowedManifestPath(rel, sourceKind);
    return [rel];
  }

  if (!stat.isDirectory()) {
    throw new Error(`[sync-installer] Entry bukan file/folder valid (${sourceKind}): ${rel}`);
  }

  const files = walkFiles(sourceAbs, (childRel) => {
    const relFromRoot = normalizeRel(path.join(rel, childRel));
    return isSourceExcluded(relFromRoot);
  }).map((childRel) => normalizeRel(path.join(rel, childRel)));

  for (const fileRel of files) {
    ensureAllowedManifestPath(fileRel, sourceKind);
  }

  return files;
}

function buildSourceSnapshot() {
  const entryMap = getManifestEntries();
  const allFiles = new Set();

  for (const rel of entryMap.files) {
    for (const item of addEntryFiles(rel, 'includedFiles')) allFiles.add(item);
  }

  for (const rel of entryMap.directories) {
    for (const item of addEntryFiles(rel, 'includeDirectories')) allFiles.add(item);
  }

  for (const rel of entryMap.dependencies) {
    for (const item of addEntryFiles(rel, 'runtimeDependencies')) allFiles.add(item);
  }

  for (const rel of entryMap.optional) {
    for (const item of addEntryFiles(rel, 'optionalEntries', { optional: true })) allFiles.add(item);
  }

  const snapshot = {};
  for (const rel of Array.from(allFiles).sort()) {
    const abs = path.join(ROOT_DIR, rel);
    const stat = fs.statSync(abs);
    snapshot[rel] = {
      hash: hashFile(abs),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  }

  return snapshot;
}

function listInstallerFiles() {
  if (!fs.existsSync(INSTALLER_DIR)) return [];
  return walkFiles(INSTALLER_DIR, (rel) => isInternalInstallerPath(rel));
}

function readPreviousState() {
  if (!fs.existsSync(STATE_FILE)) return {};

  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return raw && raw.files ? raw.files : {};
  } catch (_error) {
    return {};
  }
}

function writeState(snapshot) {
  ensureDir(META_DIR);
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        mode: 'manifest-driven',
        output_dir: manifest.outputDir,
        files: snapshot
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
}

function appendLog(entries) {
  if (!entries.length) return;
  ensureDir(META_DIR);
  const lines = entries.map((entry) => `${entry.timestamp} | ${entry.type} | ${entry.file}`).join('\n') + '\n';
  fs.appendFileSync(LOG_FILE, lines, 'utf8');
}

function removeEmptyInstallerDirs(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const abs = path.join(dirPath, entry.name);
    const rel = normalizeRel(path.relative(INSTALLER_DIR, abs));
    if (isInternalInstallerPath(rel)) continue;

    removeEmptyInstallerDirs(abs);

    if (fs.existsSync(abs) && fs.readdirSync(abs).length === 0) {
      fs.rmdirSync(abs);
    }
  }
}

function runNodeScriptCheck(scriptRel) {
  const scriptAbs = path.join(INSTALLER_DIR, scriptRel);
  if (!fs.existsSync(scriptAbs)) {
    return {
      ok: false,
      script: scriptRel,
      message: 'script tidak ditemukan di installer output'
    };
  }

  const result = spawnSync(process.execPath, [scriptRel], {
    cwd: INSTALLER_DIR,
    encoding: 'utf8'
  });

  if (result.status === 0) {
    return {
      ok: true,
      script: scriptRel,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim()
    };
  }

  return {
    ok: false,
    script: scriptRel,
    message: `${result.stdout || ''}${result.stderr || ''}`.trim() || `exit code ${result.status}`
  };
}

function validateInstaller(sourceSnapshot) {
  const errors = [];
  const warnings = [];

  const installerFiles = listInstallerFiles();
  const installerSet = new Set(installerFiles);
  const requiredFiles = manifest.requiredRuntimeFiles.length
    ? manifest.requiredRuntimeFiles
    : Object.keys(sourceSnapshot);

  for (const rel of requiredFiles) {
    const requiredRel = sanitizeRelativePath(rel, 'requiredRuntimeFiles');
    const abs = path.join(INSTALLER_DIR, requiredRel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      errors.push(`missing required file: ${requiredRel}`);
    }
  }

  for (const rel of Object.keys(sourceSnapshot)) {
    if (!installerSet.has(rel)) {
      errors.push(`source snapshot file missing in installer: ${rel}`);
    }
  }

  for (const rel of installerFiles) {
    if (isForbiddenByPolicy(rel) && normalizeRel(rel).toLowerCase() !== 'readme.md') {
      errors.push(`forbidden file leaked into installer: ${rel}`);
    }
  }

  for (const scriptRel of manifest.postBuildValidation.requiredNodeScripts) {
    const check = runNodeScriptCheck(scriptRel);
    if (!check.ok) {
      errors.push(`post-build script failed (${scriptRel}): ${check.message}`);
    }
  }

  const hasReadme = installerSet.has('README.md');
  if (!hasReadme) {
    errors.push('README.md wajib ada untuk dokumentasi user');
  }

  const hasLicense = installerSet.has('LICENSE.txt');
  if (!hasLicense) {
    warnings.push('LICENSE.txt tidak ditemukan. Pastikan lisensi distribusi sudah diputuskan.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function syncInstaller() {
  ensureDir(INSTALLER_DIR);

  const sourceSnapshot = buildSourceSnapshot();
  const previousSnapshot = readPreviousState();
  const installerFiles = new Set(listInstallerFiles());
  const entries = [];
  const timestamp = new Date().toISOString();

  for (const [rel, meta] of Object.entries(sourceSnapshot)) {
    const prev = previousSnapshot[rel];
    const sourceAbs = path.join(ROOT_DIR, rel);
    const installerAbs = path.join(INSTALLER_DIR, rel);
    const existsInInstaller = fs.existsSync(installerAbs);
    const changed = !prev || prev.hash !== meta.hash || !existsInInstaller;

    if (changed) {
      ensureDir(path.dirname(installerAbs));
      fs.copyFileSync(sourceAbs, installerAbs);
      entries.push({
        timestamp,
        type: prev ? 'modify' : 'add',
        file: rel
      });
    }

    installerFiles.delete(rel);
  }

  const filesToDelete = new Set();

  for (const rel of Object.keys(previousSnapshot)) {
    if (!sourceSnapshot[rel]) filesToDelete.add(rel);
  }

  for (const rel of installerFiles) {
    if (!isInternalInstallerPath(rel)) filesToDelete.add(rel);
  }

  for (const rel of Array.from(filesToDelete).sort()) {
    const installerAbs = path.join(INSTALLER_DIR, rel);
    if (!fs.existsSync(installerAbs)) continue;
    if (!fs.statSync(installerAbs).isFile()) continue;

    fs.unlinkSync(installerAbs);
    entries.push({
      timestamp,
      type: 'delete',
      file: rel
    });
  }

  removeEmptyInstallerDirs(INSTALLER_DIR);
  writeState(sourceSnapshot);
  appendLog(entries);

  const validation = validateInstaller(sourceSnapshot);

  return {
    added: entries.filter((entry) => entry.type === 'add').length,
    modified: entries.filter((entry) => entry.type === 'modify').length,
    deleted: entries.filter((entry) => entry.type === 'delete').length,
    entries,
    validation
  };
}

function printSummary(result) {
  const total = result.entries.length;
  if (!total) {
    console.log('[sync-installer] No changes detected.');
  } else {
    console.log(
      `[sync-installer] Completed. add=${result.added} modify=${result.modified} delete=${result.deleted}`
    );

    for (const entry of result.entries) {
      console.log(`[sync-installer] ${entry.timestamp} | ${entry.type} | ${entry.file}`);
    }
  }

  if (result.validation.ok) {
    console.log('[sync-installer] Post-build validation: PASSED.');
  } else {
    console.error('[sync-installer] Post-build validation: FAILED.');
    for (const message of result.validation.errors) {
      console.error(`[sync-installer]   - ${message}`);
    }
  }

  for (const warning of result.validation.warnings) {
    console.warn(`[sync-installer] Warning: ${warning}`);
  }
}

function runSync() {
  try {
    const result = syncInstaller();
    printSummary(result);
    if (!result.validation.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('[sync-installer] Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

function runValidateOnly() {
  try {
    const sourceSnapshot = buildSourceSnapshot();
    const validation = validateInstaller(sourceSnapshot);
    if (validation.ok) {
      console.log('[sync-installer] Validation-only mode: PASSED.');
    } else {
      console.error('[sync-installer] Validation-only mode: FAILED.');
      for (const message of validation.errors) {
        console.error(`[sync-installer]   - ${message}`);
      }
      process.exitCode = 1;
    }

    for (const warning of validation.warnings) {
      console.warn(`[sync-installer] Warning: ${warning}`);
    }
  } catch (error) {
    console.error('[sync-installer] Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

function stopWatcher() {
  const pid = readWatcherPid();
  if (!pid) {
    console.log('[sync-installer] Watcher is not running.');
    return;
  }

  if (!isPidRunning(pid)) {
    cleanupWatcherPidFile();
    console.log('[sync-installer] Removed stale watcher PID file.');
    return;
  }

  try {
    process.kill(pid);
    console.log(`[sync-installer] Stopped watcher PID ${pid}.`);
  } catch (error) {
    console.error('[sync-installer] Failed to stop watcher:', error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

function printWatcherStatus() {
  const pid = readWatcherPid();
  if (!pid) {
    console.log('[sync-installer] Watcher status: stopped');
    return;
  }

  if (!isPidRunning(pid)) {
    cleanupWatcherPidFile();
    console.log('[sync-installer] Watcher status: stopped (stale PID removed)');
    return;
  }

  console.log(`[sync-installer] Watcher status: running (PID ${pid})`);
}

function startWatcherDaemon() {
  const existingPid = readWatcherPid();
  if (existingPid && isPidRunning(existingPid)) {
    console.log(`[sync-installer] Watcher already running (PID ${existingPid}).`);
    return;
  }

  cleanupWatcherPidFile();
  ensureDir(META_DIR);
  const out = fs.openSync(WATCHER_OUTPUT_FILE, 'a');
  const err = fs.openSync(WATCHER_OUTPUT_FILE, 'a');
  const child = spawn(process.execPath, [__filename, '--watch', '--foreground-watch'], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ['ignore', out, err]
  });
  child.unref();
  console.log(`[sync-installer] Watcher daemon started (PID ${child.pid}).`);
}

function shouldTriggerSync(relPath) {
  const rel = normalizeRel(relPath);
  if (!rel) return false;
  if (isSourceExcluded(rel)) return false;

  for (const item of ALWAYS_WATCH) {
    if (rel === item) return true;
  }

  const watchRoots = [
    ...manifest.includedFiles,
    ...manifest.includeDirectories,
    ...manifest.runtimeDependencies,
    ...manifest.requiredRuntimeFiles,
    ...manifest.postBuildValidation.requiredNodeScripts
  ];

  return watchRoots.some((root) => rel === root || rel.startsWith(root + '/'));
}

function startWatchMode() {
  let timer = null;
  let isRunning = false;
  let pending = false;

  const scheduleSync = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (isRunning) {
        pending = true;
        return;
      }

      isRunning = true;
      try {
        const result = syncInstaller();
        printSummary(result);
      } catch (error) {
        console.error('[sync-installer] Failed:', error && error.message ? error.message : error);
      } finally {
        isRunning = false;
        if (pending) {
          pending = false;
          scheduleSync();
        }
      }
    }, 250);
  };

  writeWatcherPid();
  const cleanup = () => {
    const pid = readWatcherPid();
    if (pid === process.pid) {
      cleanupWatcherPidFile();
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGHUP', () => {
    cleanup();
    process.exit(0);
  });

  console.log('[sync-installer] Watch mode enabled.');
  runSync();

  fs.watch(ROOT_DIR, { recursive: true }, (eventType, filename) => {
    const rel = normalizeRel(filename || '');
    if (!shouldTriggerSync(rel)) return;
    console.log(`[sync-installer] Detected ${eventType}: ${rel}`);
    scheduleSync();
  });
}

if (STOP_MODE) {
  stopWatcher();
} else if (STATUS_MODE) {
  printWatcherStatus();
} else if (DAEMON_MODE) {
  startWatcherDaemon();
} else if (VALIDATE_ONLY_MODE) {
  runValidateOnly();
} else if (WATCH_MODE || FOREGROUND_WATCH_MODE) {
  startWatchMode();
} else {
  runSync();
}
