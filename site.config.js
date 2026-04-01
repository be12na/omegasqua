/**
 * ============================================
 * SITE CONFIGURATION — Edit this file only!
 * ============================================
 *
 * Untuk deploy ke domain baru, ubah nilai di bawah ini.
 * Tidak perlu mengedit file lain.
 *
 * Format domain: tanpa protokol (https://), tanpa trailing slash (/)
 * Contoh: 'mydomain.com', bukan 'https://mydomain.com/'
 *
 * Jalankan "node setup.js" untuk generate file ini secara otomatis,
 * atau edit manual sesuai kebutuhan Anda.
 */
var SITE_CONFIG = {
    // ── Domain Utama (Production) ──────────────────────────
    PRIMARY_DOMAIN: 'omegasqua.my.id',

    // ── Daftar Domain yang Diizinkan ───────────────────────
    ALLOWED_DOMAINS: [
        'omegasqua.my.id',
        'www.omegasqua.my.id'
    ],

    // ── Pattern Subdomain yang Diizinkan ───────────────────
    ALLOWED_SUBDOMAIN_SUFFIXES: [
        '.omegasqua.my.id'
    ],

    // ── Cloudflare Pages Preview ───────────────────────────
    ALLOW_PAGES_DEV: true,

    // ── Local Development ──────────────────────────────────
    ALLOW_LOCALHOST: true
};
