# Moota Webhook Proxy Architecture (Cloudflare Worker -> Google Apps Script)

Dokumen ini menjelaskan arsitektur baru setelah pemisahan update konfigurasi di `admin-area` dan hardening webhook Moota melalui Cloudflare Worker.

## 1) Ringkasan Perubahan

### A. Pemisahan Tombol Update di Admin Area

Di form `API System`, update sekarang dipisah menjadi 3 aksi independen:

1. **Update API Sistem Umum**
   - Menyimpan: `contact_email`, `wa_admin`, `fonnte_token`
2. **Update Moota Payment Gateway**
   - Menyimpan hanya konfigurasi Moota (`moota_gas_url`, opsional `moota_token`)
3. **Update ImageKit Media Center**
   - Menyimpan hanya konfigurasi ImageKit (`ik_public_key`, `ik_endpoint`, opsional `ik_private_key`)

Dengan ini, kegagalan validasi satu integrasi tidak lagi memblokir update integrasi lain.

### B. Webhook Moota via Middleware Worker

Webhook Moota wajib diarahkan ke endpoint publik Worker:

`POST /webhook/moota`

Worker bertugas:
- menerima payload + header signature dari Moota,
- validasi signature di sisi edge (jika `MOOTA_TOKEN` tersedia),
- meneruskan request ke GAS (`MOOTA_GAS_URL`) sambil mempertahankan header penting,
- menambahkan metadata query untuk kompatibilitas Apps Script,
- menyediakan logging + request ID untuk debugging.

## 2) Data Flow Webhook

1. **Moota -> Worker**
   - Method: `POST`
   - Body: JSON payload
   - Header penting: `Signature` / `X-Signature` / `X-MOOTA-SIGNATURE`

2. **Worker Validation**
   - Worker membaca raw body (`request.text()`)
   - Worker memverifikasi HMAC SHA-256 terhadap `MOOTA_TOKEN` (jika configured)
   - Jika invalid -> return `401`
   - Jika header signature hilang -> return `400`

3. **Worker -> GAS Forwarding**
   - Body diteruskan **tanpa modifikasi**
   - Header penting ikut diteruskan, termasuk `Signature`
   - Metadata tambahan untuk GAS tetap dikirim via query params:
     - `moota_forwarded=1`
     - `moota_signature=<signature>`
     - `moota_sig_verified=1|0`
     - `moota_sig_verified_by=<worker|code>`
     - `moota_request_id=<request_id>`

4. **GAS Verification & Processing**
   - GAS memakai signature forwarded (`moota_signature`/`signature`) untuk validasi akhir
   - Jika valid, proses order/payment dilanjutkan
   - GAS response diteruskan kembali oleh Worker

5. **Response to Moota**
   - Worker mengembalikan response JSON
   - Jika upstream non-JSON, Worker wrap ke JSON fallback berisi `request_id` + status upstream

## 3) Header Forwarding Matrix

Header inbound dari Moota yang dipertahankan Worker saat forward:

- `Signature`
- `X-Signature`
- `X-MOOTA-SIGNATURE`
- `X-MOOTA-USER`
- `X-MOOTA-WEBHOOK`
- `User-Agent`
- `CF-Connecting-IP`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `CF-Ray`

Header tracing tambahan dari Worker:

- `X-Webhook-Request-ID`
- `X-Webhook-Source: moota`

## 4) Action Contract (Admin Settings)

Action baru untuk mencegah konflik update:

- `update_moota_gateway`
  - payload: `{ moota_gas_url, moota_token? }`
- `update_imagekit_media`
  - payload: `{ ik_public_key, ik_endpoint, ik_private_key? }`

Action existing tetap dipakai untuk general settings:

- `update_settings`
  - payload general: `{ contact_email, wa_admin, fonnte_token }`

## 5) Logging & Error Handling

Setiap webhook request sekarang memiliki `request_id`.

Response error utama:

- `400` -> signature header tidak ada
- `401` -> signature invalid di Worker
- `502` -> upstream GAS tidak bisa dijangkau setelah retry
- `500` -> unexpected Worker error

Semua error ini menyertakan `request_id` untuk korelasi log lintas sistem.

## 6) Testing Checklist

### A. Validasi repo

- `npm run validate`
- `npm run validate:seo`
- `npm run audit:worker -- --json`
- `node --check appscript.js`
- `node --check _worker.js`

### B. Validasi pemisahan tombol

1. Klik **Update Moota Payment Gateway**
   - hanya action Moota yang dipanggil
   - perubahan ImageKit tidak ikut tersimpan

2. Klik **Update ImageKit Media Center**
   - hanya action ImageKit yang dipanggil
   - perubahan Moota tidak ikut tersimpan

3. Klik **Update API Sistem Umum**
   - hanya field umum (`email/WA/fonnte`) yang diperbarui

### C. Validasi webhook

1. Kirim webhook tanpa signature -> expect `400`
2. Kirim webhook signature salah -> expect `401`
3. Kirim webhook valid -> expect `200` + payment diproses
4. Pastikan log mengandung `request_id` dan status forwarding

## 7) Troubleshooting

### Kasus: "Missing Signature header"
- Pastikan dashboard Moota mengirim ke endpoint Worker, bukan GAS langsung.
- Pastikan header signature aktif dari sisi Moota.

### Kasus: "Invalid Signature at Worker"
- `MOOTA_TOKEN` di Worker tidak sama dengan secret di Moota.

### Kasus: Worker valid, GAS invalid signature
- Cek `moota_token` di Script Properties GAS.
- Pastikan secret konsisten di 3 tempat: Moota, Worker, GAS.

### Kasus: `GAS unreachable after retries`
- Cek `MOOTA_GAS_URL` di Worker.
- Cek deployment GAS status (`Web App`) dan izin akses.

### Kasus: Update Moota/ImageKit saling mengganggu
- Pastikan klik tombol yang sesuai domain update.
- Cek action payload di network tab:
  - Moota -> `update_moota_gateway`
  - ImageKit -> `update_imagekit_media`

## 8) Catatan Operasional

- Jangan pernah arahkan webhook Moota langsung ke URL `script.google.com` / `script.googleusercontent.com`.
- Simpan secret hanya di Script Properties untuk mencegah kebocoran pada sheet.
- Gunakan request ID saat investigasi agar jejak Worker <-> GAS mudah ditelusuri.
