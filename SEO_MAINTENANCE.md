# SEO Maintenance

Dokumen ini menjelaskan konfigurasi SEO pada [index.html](index.html) agar mudah dirawat setelah branding, copy, atau katalog produk berubah.

## Ringkasan

- `index.html` sekarang memiliki fallback meta tag statis untuk crawler yang tidak menunggu JavaScript.
- Generator dinamis `window.CEPAT_SEO` membaca konten hero, tagline, dan katalog produk untuk memperbarui `title`, `description`, Open Graph, Twitter Card, dan canonical URL.
- Helper debug `window.__SEO_DEBUG__` tersedia di browser console untuk audit cepat setelah halaman dirender.
- Fallback meta image memakai [assets/seo/og-default.png](assets/seo/og-default.png) dengan ukuran `1200x630` dan file di bawah `1MB`.

## Prioritas Sumber Data

Title:
`[data-seo-title]` -> `h1` -> `site_name` -> `defaultSiteName`

Description:
`[data-seo-description]` -> `site_tagline` -> intro katalog -> ringkasan produk -> `defaultDescription`

Image:
gambar produk yang lolos validasi OG -> `site_logo` jika memadai -> fallback [assets/seo/og-default.png](assets/seo/og-default.png)

## Parameter Konfigurasi

Konfigurasi utama ada di objek `SEO_CONFIG` dalam [index.html](index.html).

- `defaultSiteName`: fallback nama brand jika data global belum tersedia.
- `defaultDescription`: deskripsi aman untuk crawler sebelum data dinamis masuk.
- `maxDescriptionLength`: batas maksimal meta description. Saat ini `160`.
- `titleSeparator`: pemisah antara headline halaman dan nama brand.
- `robots`: directive indexing untuk search engine crawler.
- `defaultOgImagePath`: path fallback meta image.
- `defaultOgImageType`: MIME type fallback image. Saat ini `image/png`.
- `defaultOgImageWidth`: lebar fallback image. Saat ini `1200`.
- `defaultOgImageHeight`: tinggi fallback image. Saat ini `630`.
- `defaultOgImageBytes`: ukuran file fallback image untuk audit lokal.
- `titleSelectors`: selector sumber judul halaman.
- `descriptionSelectors`: selector sumber deskripsi tambahan.
- `productTitleSelector`: selector judul produk pada katalog.
- `productDescriptionSelector`: selector deskripsi produk pada katalog.
- `productImageSelector`: selector kandidat gambar produk.

## Cara Pakai Saat Maintenance

1. Jika headline utama berubah, pastikan elemen tetap memakai `data-seo-title`.
2. Jika paragraf hero berubah, pastikan elemen tetap memakai `data-seo-description`.
3. Jika ingin mengganti fallback image, pastikan file baru tetap `1200x630` dan ukuran maksimal `1MB`, lalu update `defaultOgImagePath`, `defaultOgImageType`, `defaultOgImageWidth`, `defaultOgImageHeight`, dan `defaultOgImageBytes`.
4. Jika struktur katalog berubah, sesuaikan selector produk di `SEO_CONFIG`.
5. Jalankan validator lokal setelah perubahan.

## Validasi Lokal

Jalankan:

```bash
node validate-seo.js
```

Atau lewat script npm:

```bash
npm run validate:seo
```

Validator lokal memeriksa:

- keberadaan meta tag inti
- panjang meta description
- sinkronisasi `og:image` dan `twitter:image`
- ukuran dan dimensi fallback image
- keberadaan generator dinamis dan marker sumber konten

## Audit di Browser

Di console browser:

```js
window.__SEO_DEBUG__.getMeta()
window.__SEO_DEBUG__.getAudit()
window.__SEO_DEBUG__.printReport()
window.__SEO_DEBUG__.revalidate()
```

Gunakan audit ini untuk memastikan description tetap relevan dan generator tidak turun ke fallback tanpa alasan.

## Validasi Setelah Deploy

Facebook Sharing Debugger:

1. Deploy perubahan ke domain final.
2. Buka `https://developers.facebook.com/tools/debug/`.
3. Masukkan URL homepage final, lalu klik `Debug`.
4. Klik `Scrape Again` setelah perubahan baru dirilis.
5. Pastikan `og:title`, `og:description`, dan `og:image` sesuai hasil yang diharapkan.

Google Search Console:

1. Buka properti domain final di Google Search Console.
2. Gunakan `URL Inspection` untuk homepage final.
3. Periksa `View Crawled Page` atau rendered HTML untuk memastikan meta tag fallback sudah muncul sejak response awal.
4. Klik `Request Indexing` setelah update penting.
5. Monitor apakah title dan description yang diindeks sesuai dengan intent halaman.

## Catatan Penting

- Meta tag dinamis membantu menyesuaikan isi halaman secara otomatis, tetapi fallback statis tetap dipertahankan agar crawler sosial dan search engine menerima metadata minimum sejak awal.
- Jika Anda melihat peringatan bahwa meta image masih memakai fallback bawaan, cek kembali gambar produk atau branding karena generator belum menemukan kandidat yang lebih optimal.
