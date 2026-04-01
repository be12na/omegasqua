# Admin Area – Forgot Password Button Fix

## Ringkasan Masalah

Di halaman `admin-area`, tombol **Lupa Password** terlihat ada tetapi pada kondisi tertentu tidak memicu alur reset password secara konsisten.

## Root Cause

1. Handler click sebelumnya mengandalkan inline `onclick` saja.
2. Modal reset password sempat kalah stacking order terhadap login overlay pada beberapa browser.
3. Tidak ada fallback binding terpisah untuk menjamin event click/keyboard selalu tertangkap.

## Perubahan yang Diterapkan

### 1) Event Binding Lebih Tahan Gangguan
- Trigger diberi id tetap: `#btn-forgot-open-admin`.
- Ditambahkan fallback `addEventListener` untuk:
  - `click`
  - `keydown` (`Enter` dan `Space`)
- Event memakai `preventDefault()` dan `stopPropagation()` agar tidak bentrok dengan event lain.

### 2) Perbaikan Layering Modal
- `#modal-forgot-admin` diberi z-index eksplisit (`style="z-index: 220;"`) agar selalu berada di atas `#login-overlay`.

### 3) Abstraksi Logic yang Bisa Di-test
- Ditambahkan helper baru: `scripts/admin-forgot-password.js`
  - `bindForgotPasswordTrigger(...)`
  - `createSubmitHandler(...)`
- `admin-area.html` menggunakan helper ini untuk binding trigger dan submit reset password.

### 4) Unit Test & Cross-Browser Smoke
- **Jest unit test**:
  - `tests/admin-forgot-password.test.js`
  - Memastikan click trigger tertangkap.
  - Memastikan payload API reset password mengirim `action: "forgot_password"`.
- **Cross-browser/mobile smoke test**:
  - `tests/cross-browser-forgot-password.js`
  - Chromium, Firefox, WebKit, Edge, Mobile Chrome.

## Hasil Verifikasi

Perintah yang dijalankan:

```bash
npm run test:forgot
npm run test:forgot:cross-browser
npm run validate
npm run validate:seo
npm run audit:worker -- --json
```

Semua lulus pada sesi perbaikan ini.

## Staging Deployment

Staging environment dikonfigurasi dan dideploy lewat Wrangler:

```bash
npx wrangler deploy --env staging
```

Endpoint staging:

- `https://zhostprodig-staging.adsnet-global.workers.dev`

## Troubleshooting Cepat

Jika tombol kembali tidak responsif:

1. Cek apakah element `#btn-forgot-open-admin` ada di DOM.
2. Cek class modal `#modal-forgot-admin` (harus kehilangan class `hidden` saat dibuka).
3. Cek layering dengan `elementFromPoint(...)` dan pastikan target bukan input `#adm-pass`.
4. Jalankan ulang:
   - `npm run test:forgot`
   - `npm run test:forgot:cross-browser`
