# Omegasqua Cloudflare Workers Deployment Runbook

Dokumen ini untuk memastikan deploy Cloudflare Workers rapi, stabil, dan siap production.

## 1) Prasyarat

- Node.js 18+
- Akses Cloudflare account + zone
- Wrangler login (`npx wrangler login`)
- URL Google Apps Script aktif untuk API publik dan webhook Moota

## 2) Konfigurasi wajib

### `wrangler.jsonc`

Pastikan variabel ini valid:

- `ALLOWED_ORIGINS` (daftar domain frontend dipisah koma)
- `APP_GAS_URL`
- `MOOTA_GAS_URL`

> **Penting:** `MOOTA_TOKEN` tidak disimpan di `wrangler.jsonc`.

Set sebagai secret:

```bash
npx wrangler secret put MOOTA_TOKEN
npx wrangler secret put METRICS_TOKEN
```

Untuk staging:

```bash
npx wrangler secret put MOOTA_TOKEN --env staging
npx wrangler secret put METRICS_TOKEN --env staging
```

## 3) Validasi sebelum deploy

Jalankan:

```bash
npm run validate:deploy
```

Validasi ini memeriksa:

- domain config (`site.config.js`)
- `wrangler.jsonc` critical vars
- tidak ada plaintext `MOOTA_TOKEN` di config
- urutan script pada HTML (`site.config.js` sebelum `config.js`)
- audit worker budget + SEO validator

## 4) Deploy

### Staging

```bash
npm run deploy:staging
```

### Production

```bash
npm run deploy:production
```

## 5) Post-deploy checklist (go-live)

1. **Health check**: `GET /health` harus `status=ok`/`degraded` (bukan error fatal).
2. **Public API smoke test**: endpoint `/api` untuk action read-only (`get_global_settings`, `get_products`) berhasil.
3. **Webhook test**: Moota webhook test mencapai `/webhook/moota` dan lolos signature.
4. **CORS check**: origin domain utama lolos preflight.
5. **Static assets**: CSS/JS termuat normal, tidak ada MIME mismatch.
6. **Metrics endpoint** (`/__worker_metrics`) hanya diakses dengan token jika `METRICS_TOKEN` diset.

## 6) Stabilitas & rollback

- Simpan deployment URL/versi setiap release.
- Jika anomali setelah deploy, rollback cepat dengan deploy commit stabil sebelumnya.
- Pertahankan konfigurasi token/secret antar env agar webhook verification konsisten.

## 7) Catatan keamanan

- Jangan commit token atau secret ke repository.
- Pertahankan `ALLOWED_ORIGINS` seminimal mungkin (hanya domain yang valid).
- Review `_headers` secara berkala untuk hardening policy.
