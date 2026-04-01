# Installer Build Pipeline (Developer Reference)

Dokumen ini menjelaskan pipeline build untuk menghasilkan folder `installer/` yang siap distribusi user.

## Tujuan

- Memisahkan artifact distribusi dari source repo utama.
- Menyalin **hanya** komponen runtime penting.
- Mencegah file development ikut ter-copy.
- Menambahkan validasi post-build agar package siap pakai.

## Struktur Folder Output

Output build berada di:

```text
installer/
  .sync-meta/
    state.json
    sync.log
    watcher.pid
    watcher-output.log
  (runtime files sesuai manifest.json)
```

`installer/.sync-meta/` hanya metadata sinkronisasi dan tidak dipakai sebagai runtime aplikasi.

## Konfigurasi Manifest

Semua aturan package diatur dari `manifest.json`:

- `outputDir`: lokasi output installer (default: `installer`)
- `includedFiles`: file runtime individual yang wajib disalin
- `includeDirectories`: direktori runtime yang disalin rekursif (contoh: `assets`)
- `runtimeDependencies`: dependency runtime lokal jika suatu saat diperlukan
- `requiredRuntimeFiles`: daftar file yang wajib ada saat validasi
- `postBuildValidation.requiredNodeScripts`: smoke check script Node yang dijalankan dari dalam `installer/`

## Perintah Build

```bash
npm run build:installer
```

Alias yang setara:

- `npm run sync:installer`
- `npm run prepare:installer`

Validasi saja (tanpa copy ulang):

```bash
npm run validate:installer
```

## Auto-Update Mekanisme

### Mode Watcher Background

Jalankan daemon watcher:

```bash
npm run sync:installer:start
```

Cek status:

```bash
npm run sync:installer:status
```

Stop watcher:

```bash
npm run sync:installer:stop
```

Watcher memonitor perubahan source/dependency penting (berdasarkan manifest + file kontrol) lalu auto-regenerate isi `installer/`.

### Saat Dependency Berubah

Script `postinstall` pada `package.json` menjalankan sinkronisasi installer setelah install dependency, sehingga output installer tetap up-to-date.

## Aturan Exclude (Hard Guardrail)

File berikut diblokir dari installer walaupun tercantum tidak sengaja:

- `tests/`, `test/`, `spec/`, `e2e/`, `__tests__/`
- `scripts/`, `.github/`, `.vscode/`, `.wrangler/`
- `.env` / `.env.*`
- `*.test.*`, `*.spec.*`
- file markdown selain `README.md`

## Post-Build Validation

Setiap sinkronisasi menjalankan validasi:

1. Semua `requiredRuntimeFiles` ada di output.
2. Semua file snapshot sumber tercopy ke installer.
3. Tidak ada file forbidden/dev yang bocor ke installer.
4. Script smoke check (default: `validate-config.js`) sukses dijalankan dari dalam `installer/`.

Jika salah satu check gagal, proses keluar dengan status error (non-zero).

## Troubleshooting Cepat

- **Validation fail: missing required file**
  - Cek `manifest.json` dan pastikan file runtime benar-benar ada di repo.
- **Validation fail: forbidden file leaked**
  - Bersihkan entry manifest agar tidak mengarah ke file dev/internal.
- **Watcher tidak aktif**
  - Jalankan `npm run sync:installer:status`, lalu start ulang daemon.
