# validate

Validator tanda tangan digital dokumen menggunakan public key **PASETO `v4.public`** (Ed25519) yang berjalan sepenuhnya di sisi klien (browser) dengan [CrootJS](https://croot.js.org/).

## Fitur Utama

- **Verifikasi Kriptografis `v4.public` di Browser**: Memverifikasi tanda tangan Ed25519 dan PAE (Pre-Authentication Encoding) sesuai spesifikasi PASETO v4 menggunakan public key PASERK (`k4.public.*`), Base64URL, atau Hex 32-byte.
- **Pemindaian QR Code Fleksibel**: Mendukung tempel token/URL langsung, unggah gambar QR (SVG/PNG/JPG hasil `d4if/sign`), serta pemindaian kamera langsung.
- **Verifikasi Integritas Berkas Dokumen**: Menghitung hash SHA-256 berkas dokumen secara lokal (`Web Crypto API`) dan mencocokkannya dengan klaim `doc_hash`.
- **Manajemen Kunci Publik Bawaan**: Menyimpan daftar kunci publik terpercaya langsung di aplikasi (`keys.js`) dan dapat ditambah melalui `localStorage` browser (`storage.min.js`).
- **Auto-validasi lewat URL**: Mendukung parameter `#token=...` atau `?token=...` (`url.min.js`) untuk verifikasi otomatis saat QR code dipindai ke GitHub Pages.

## Struktur Berkas

- `index.html` - antarmuka validator.
- `404.html` - halaman fallback 404 sesuai konvensi CrootJS.
- `style.css` - styling di atas `croot.css`, `ui.css`, `themes.css` (`kampus`), dan `icons.css`.
- `keys.js` - daftar public key PASETO `v4.public` bawaan Prodi D4TI ULBI.
- `paseto.js` - implementasi verifikasi PASETO `v4.public`, PAE, PASERK `k4.public`, dan SHA-256.
- `app.js` - pengendali antarmuka, kamera/gambar QR (`jsQR`), dan integrasi CrootJS.
- `integrity.js` - import map SRI (`sha384`) untuk modul CrootJS `0.0.42`.
