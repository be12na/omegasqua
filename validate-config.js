#!/usr/bin/env node
/**
 * ============================================
 * validate-config.js — Configuration Validator
 * ============================================
 *
 * Jalankan: node validate-config.js
 *
 * Memvalidasi bahwa konfigurasi domain sudah benar di semua file.
 */

const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
let errors = 0;
let warnings = 0;
let passed = 0;
const strictDeploy = process.argv.includes('--strict-deploy');

function pass(msg) {
    console.log(`  ✅ ${msg}`);
    passed++;
}

function fail(msg) {
    console.log(`  ❌ ${msg}`);
    errors++;
}

function warn(msg) {
    console.log(`  ⚠️  ${msg}`);
    warnings++;
}

// ── Test 1: site.config.js exists and is valid ─────────────

console.log('\n  🔍 Test 1: site.config.js');
console.log('  ─────────────────────────');

const siteConfigPath = path.join(projectDir, 'site.config.js');
if (fs.existsSync(siteConfigPath)) {
    pass('site.config.js exists');

    const content = fs.readFileSync(siteConfigPath, 'utf-8');

    // Try to evaluate (safe — it only defines a var)
    try {
        // Create a minimal sandbox
        const vm = require('vm');
        const sandbox = {};
        vm.createContext(sandbox);
        vm.runInContext(content, sandbox);

        if (sandbox.SITE_CONFIG) {
            pass('SITE_CONFIG object defined');

            // Check required fields
            if (sandbox.SITE_CONFIG.PRIMARY_DOMAIN) {
                pass(`PRIMARY_DOMAIN = "${sandbox.SITE_CONFIG.PRIMARY_DOMAIN}"`);
            } else {
                fail('PRIMARY_DOMAIN is missing or empty');
            }

            if (Array.isArray(sandbox.SITE_CONFIG.ALLOWED_DOMAINS) && sandbox.SITE_CONFIG.ALLOWED_DOMAINS.length > 0) {
                pass(`ALLOWED_DOMAINS = [${sandbox.SITE_CONFIG.ALLOWED_DOMAINS.join(', ')}]`);

                // Validate domain formats
                const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
                for (const d of sandbox.SITE_CONFIG.ALLOWED_DOMAINS) {
                    if (!domainRegex.test(d)) {
                        fail(`Domain "${d}" format tidak valid`);
                    }
                    if (d.startsWith('http') || d.includes('://')) {
                        fail(`Domain "${d}" mengandung protokol — hapus http(s)://`);
                    }
                    if (d.endsWith('/')) {
                        fail(`Domain "${d}" mengandung trailing slash — hapus /`);
                    }
                }
            } else {
                fail('ALLOWED_DOMAINS is missing, not an array, or empty');
            }

            if (Array.isArray(sandbox.SITE_CONFIG.ALLOWED_SUBDOMAIN_SUFFIXES)) {
                pass(`ALLOWED_SUBDOMAIN_SUFFIXES = [${sandbox.SITE_CONFIG.ALLOWED_SUBDOMAIN_SUFFIXES.join(', ')}]`);
            } else {
                warn('ALLOWED_SUBDOMAIN_SUFFIXES is missing — subdomain matching disabled');
            }

            if (typeof sandbox.SITE_CONFIG.ALLOW_PAGES_DEV === 'boolean') {
                pass(`ALLOW_PAGES_DEV = ${sandbox.SITE_CONFIG.ALLOW_PAGES_DEV}`);
            } else {
                warn('ALLOW_PAGES_DEV not set — defaults to true');
            }

            if (typeof sandbox.SITE_CONFIG.ALLOW_LOCALHOST === 'boolean') {
                pass(`ALLOW_LOCALHOST = ${sandbox.SITE_CONFIG.ALLOW_LOCALHOST}`);
            } else {
                warn('ALLOW_LOCALHOST not set — defaults to true');
            }
        } else {
            fail('SITE_CONFIG object not found after evaluating site.config.js');
        }
    } catch (e) {
        fail(`Error evaluating site.config.js: ${e.message}`);
    }
} else {
    fail('site.config.js not found — Jalankan: node setup.js');
}

// ── Test 2: wrangler.jsonc has ALLOWED_ORIGINS ─────────────

console.log('\n  🔍 Test 2: wrangler.jsonc');
console.log('  ──────────────────────────');

const wranglerPath = path.join(projectDir, 'wrangler.jsonc');
if (fs.existsSync(wranglerPath)) {
    pass('wrangler.jsonc exists');
    const wContent = fs.readFileSync(wranglerPath, 'utf-8');

    const extractString = (key) => {
        const m = wContent.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
        return m ? m[1] : '';
    };

    const hasKey = (key) => new RegExp(`"${key}"\\s*:`).test(wContent);

    if (hasKey('ALLOWED_ORIGINS')) {
        const originsRaw = extractString('ALLOWED_ORIGINS');
        if (originsRaw) {
            const origins = originsRaw.split(',').map(s => s.trim()).filter(Boolean);
            pass(`ALLOWED_ORIGINS found with ${origins.length} origins`);
            for (const o of origins) {
                if (!o.startsWith('https://')) {
                    warn(`Origin "${o}" should start with https://`);
                }
            }
        } else {
            fail('ALLOWED_ORIGINS is empty');
        }
    } else {
        fail('ALLOWED_ORIGINS not found in wrangler.jsonc');
    }

    const appGasUrl = extractString('APP_GAS_URL');
    const mootaGasUrl = extractString('MOOTA_GAS_URL');
    if (appGasUrl) pass('APP_GAS_URL found');
    else fail('APP_GAS_URL is missing or empty');
    if (mootaGasUrl) pass('MOOTA_GAS_URL found');
    else fail('MOOTA_GAS_URL is missing or empty');

    if (hasKey('MOOTA_TOKEN')) {
        fail('MOOTA_TOKEN must not be stored in wrangler.jsonc. Use `wrangler secret put MOOTA_TOKEN` instead.');
    } else {
        pass('No plaintext MOOTA_TOKEN in wrangler.jsonc');
    }

    const assetsDir = extractString('directory');
    if (assetsDir === '.') {
        warn('assets.directory is set to ".". Ensure .assetsignore excludes non-public files to avoid oversized uploads.');
    } else if (assetsDir) {
        pass(`assets.directory = "${assetsDir}"`);
    } else {
        warn('assets.directory not found in wrangler.jsonc');
    }

    const hasAccountId = hasKey('account_id');
    const hasRoutes = hasKey('route') || hasKey('routes');
    if (hasAccountId) pass('account_id found');
    else warn('account_id missing (ok if provided via local/user wrangler profile)');

    if (hasRoutes) pass('route/routes found');
    else warn('route/routes missing (ok if route managed outside this file)');
} else {
    warn('wrangler.jsonc not found (might be using .env instead)');
}

// ── Test 2b: .assetsignore hygiene for root assets mode ─────

console.log('\n  🔍 Test 2b: .assetsignore');
console.log('  ─────────────────────────');

const assetsIgnorePath = path.join(projectDir, '.assetsignore');
if (fs.existsSync(assetsIgnorePath)) {
    pass('.assetsignore exists');
    const ai = fs.readFileSync(assetsIgnorePath, 'utf-8');
    const requiredExcludes = ['node_modules/', 'tests/', '.git/'];
    for (const entry of requiredExcludes) {
        if (ai.includes(entry)) pass(`.assetsignore includes ${entry}`);
        else warn(`.assetsignore missing ${entry}`);
    }
} else {
    warn('.assetsignore not found (recommended when assets.directory uses project root)');
}

// ── Test 3: HTML files include site.config.js ──────────────

console.log('\n  🔍 Test 3: HTML files');
console.log('  ──────────────────────');

const htmlFiles = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.html'));

for (const file of htmlFiles) {
    const filePath = path.join(projectDir, file);
    const html = fs.readFileSync(filePath, 'utf-8');

    if (html.includes('config.js')) {
        if (html.includes('site.config.js')) {
            // Check order: site.config.js should appear before config.js
            const siteIdx = html.indexOf('site.config.js');
            const configIdx = html.indexOf('config.js?');
            if (configIdx === -1 || siteIdx < configIdx) {
                pass(`${file} → site.config.js loaded before config.js`);
            } else {
                fail(`${file} → site.config.js must be loaded BEFORE config.js`);
            }
        } else {
            fail(`${file} → uses config.js but missing site.config.js`);
        }
    }
}

// ── Summary ────────────────────────────────────────────────

console.log('\n  ══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${errors} errors, ${warnings} warnings`);

if (errors > 0) {
    console.log('  ❌ Validation FAILED — fix errors above');
    console.log('  💡 Jalankan: node setup.js (untuk auto-fix)');
    process.exit(1);
} else if (warnings > 0) {
    console.log('  ⚠️  Validation passed with WARNINGS');
    process.exit(0);
} else {
    console.log('  ✅ All checks PASSED!');
    process.exit(0);
}
console.log('');
