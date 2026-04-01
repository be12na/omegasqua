# Audit Cloudflare Workers Request Budget

## Ringkasan

Target audit ini adalah menjaga konsumsi Cloudflare Workers tetap aman di bawah batas **100.000 requests/day** pada plan free, sambil menurunkan request unik per user journey minimal **40%** pada jalur traffic utama. Optimasi yang sudah diterapkan difokuskan ke tiga area:

1. Mengurangi panggilan Worker yang redundan di halaman publik, login, dashboard, dan akses member.
2. Menambah observability agar tim bisa melihat pemakaian per jam/per hari, cache hit ratio, dan alert 80%-90%.
3. Menambahkan guardrail operasional berupa cache, dedupe, circuit breaker, dan rate limiting ringan.

## Cakupan Endpoint Prioritas

| Prioritas | Endpoint / Flow | Sebelum | Sesudah | Status |
| --- | --- | --- | --- | --- |
| P1 | `index.html` -> `get_global_settings` + `get_products` | 2 request | 1 request batch | Selesai |
| P1 | `p.html` -> `get_global_settings` + `get_page_content` | 2 request | 1 request batch | Selesai |
| P1 | `checkout.html` -> `get_global_settings` + `get_product` | 2 request | 1 request batch | Selesai |
| P1 | `login.html` -> `login` + prefetch `get_dashboard_data` | 2 request | 1 request `login_and_dashboard` | Selesai |
| P1 | `dashboard.html` reload setelah login | 1 request | 0 request bila bootstrap cache masih fresh | Selesai |
| P1 | `akses.html` verifikasi akses | 1 request setiap buka | 0 request bila dashboard cache masih fresh | Selesai |
| P2 | `admin-area.html` -> branding + admin data | 2 request | 1 request | Selesai |
| P2 | `/api` cacheable POST action | cache dasar | stale fallback + in-flight dedupe + batch sub-cache | Selesai |
| P3 | Static HTML / `site.config.js` | revalidate agresif | short browser+edge cache | Selesai |

## Perubahan yang Diimplementasikan

### 1. Optimasi client-side request

- `config.js`
  - Persistent cache untuk action cacheable via memory + `localStorage`/`sessionStorage`.
  - Dedupe request in-flight agar klik ganda / render ganda tidak memicu panggilan Worker tambahan.
  - Statistik browser-side savings melalui `window.__CEPAT_GET_FETCH_STATS__()`.
  - API batching `window.CEPAT_API.batch(...)`.
  - Hasil batch sekarang ikut memanaskan cache per-action sehingga halaman berikutnya bisa memanfaatkan cache yang sama.

### 2. Optimasi halaman prioritas

- `index.html`, `p.html`, `checkout.html`
  - Global settings dipakai dari cache lokal saat bootstrap.
  - Refresh data dipindah ke batch request tunggal.
- `login.html`
  - Login memakai `login_and_dashboard` agar bootstrap dashboard datang dalam satu request.
- `dashboard.html`
  - Dashboard tidak refetch bila bootstrap cache masih fresh.
- `akses.html`
  - Verifikasi akses berhenti refetch bila cache dashboard masih segar.
- `admin-area.html`
  - Branding tidak lagi memicu request terpisah pada load awal.

### 3. Optimasi Worker edge

- `_worker.js`
  - Counter request per jam/per hari.
  - Alert threshold 80% dan 90% via `WORKER_ALERT_WEBHOOK_URL`.
  - Circuit breaker untuk upstream API.
  - Stale cache fallback untuk cacheable API action.
  - Dedupe in-flight request dengan key cacheable yang sama.
  - Endpoint `/__worker_metrics` untuk dashboard operasional.
  - Batch API sekarang juga membaca cache subrequest sebelum meneruskan ke upstream.
- `_headers`
  - HTML diberi short cache + `stale-while-revalidate`.
  - `site.config.js` diberi short cache agar tidak selalu menjadi request cold.

## Dashboard Monitoring

Monitoring operasional tersedia di tab **Settings** pada `admin-area.html`, meliputi:

- Daily requests dan persentase terhadap limit.
- Hourly requests UTC.
- Cache hit ratio dan estimasi request yang berhasil dihemat.
- Status circuit breaker.
- Top paths dan top API actions.
- Browser request savings dari client cache/dedupe.

Endpoint sumber data: `GET /__worker_metrics`

Catatan: counter ini bersifat **operational early warning**, bukan angka billing final Cloudflare, karena saat ini masih memakai state in-memory pada Worker isolate.

## Simulasi Beban 3 Hari

Skrip simulasi lokal:

```bash
npm run audit:worker
```

Atau JSON:

```bash
node worker-budget-audit.js --json
```

Model simulasi menguji trafik setara **80.000 requests/day** setelah optimasi selama **3 hari berturut-turut**. Profil journey yang dipakai:

- Public funnel: `index -> p -> checkout -> create_order`
- Partner checkout funnel: `dashboard -> checkout -> create_order`
- Member auth funnel: `login -> dashboard -> akses`
- Admin observability: `admin-area -> metrics dashboard`

### Hasil utama

- Weighted average request/journey:
  - Sebelum: **5.25**
  - Sesudah: **3.10**
  - Penurunan: **40.95%**
- Pada target 80.000 requests/day:
  - Desain lama diproyeksikan mencapai sekitar **135.484 requests/day**
  - Desain baru tetap di **80.000 requests/day**

Ini berarti jalur traffic utama sekarang lolos target pengurangan request unik per journey minimal 40%.

## Catatan CPU Time

Target CPU time <= **10 ms per invocation** diarahkan lewat pengurangan branching berat, edge cache, stale fallback, dan batch request agar jalur yang paling sering dipakai tidak memproses beberapa invocation terpisah.

Namun, audit ini **belum bisa mengklaim billed CPU Cloudflare secara final** karena verifikasi CPU yang akurat perlu dilakukan dari:

- Cloudflare Workers Analytics
- Request logs/trace setelah deploy produksi
- Uji beban live pada Worker yang sudah terpasang

Jadi status CPU saat ini adalah:

- **Code path optimized:** ya
- **Live Cloudflare CPU verification:** masih perlu diverifikasi setelah deploy

## Error Handling dan Guardrails

- Soft rate limit per-IP di Worker untuk mengurangi burst yang tidak sehat.
- Circuit breaker untuk menahan upstream Apps Script saat error berturut-turut.
- Stale cache fallback untuk action yang aman dicache.
- Threshold alert 80% dan 90% agar tim tahu kapan harus intervensi sebelum limit harian habis.

## SOP Scaling

### Jika daily usage menyentuh 80%

- Tinjau `top_paths` dan `top_api_actions` di dashboard metrics.
- Naikkan TTL untuk action cacheable yang aman (`get_global_settings`, `get_pages`, `get_products`).
- Pastikan halaman baru memakai batch dan tidak melakukan double fetch.

### Jika daily usage menyentuh 90%

- Aktifkan mode proteksi:
  - tambah strict rate limit untuk path non-kritis
  - matikan polling non-esensial
  - prioritaskan stale response untuk endpoint read-only
- Audit release terbaru untuk request baru yang belum dibatch.

### Jika traffic terus naik

- Tambahkan persistence global untuk metrics/budget counter bila butuh akurasi lintas isolate.
- Gunakan queue/background processing untuk tugas non-blocking.
- Tambahkan circuit breaker upstream yang lebih agresif untuk Apps Script.
- Pertimbangkan KV/D1/R2/Redis hanya untuk metadata yang benar-benar membutuhkan shared state.

## Checklist untuk Fitur Baru

- Apakah halaman baru memanggil lebih dari satu action read-only saat bootstrap?
- Jika ya, apakah sudah dibatch?
- Apakah hasilnya cacheable di browser dan edge?
- Apakah revisits dalam 1-5 menit masih memanggil Worker lagi tanpa alasan?
- Apakah action mutating membersihkan cache yang relevan?
- Apakah flow baru muncul di dashboard metrics?

## Artefak Audit

- `_worker.js`
- `config.js`
- `_headers`
- `index.html`
- `p.html`
- `checkout.html`
- `404.html`
- `login.html`
- `dashboard.html`
- `akses.html`
- `admin-area.html`
- `appscript.js`
- `worker-budget-audit.js`
