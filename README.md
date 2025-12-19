# Event Guard

Ekstensi Chrome yang menyuntik patch di `document_start` untuk menjaga tab tetap aktif dan menahan telemetri keluar. Event Guard memaksa halaman selalu terlihat/fokus, memblokir listener yang mencoba mendeteksi blur/visibility, dan memutus berbagai jalur outbound (sendBeacon/fetch/XHR/WebSocket/Workers) serta pola URL analitik umum.

## Fitur utama
- **Stealth shield**: memblokir event visibility/focus/blur dan men-null-kan handler bawaan agar halaman mengira tab selalu aktif.
- **Outbound guard**: blokir `sendBeacon`, `fetch`, XHR, WebSocket, Worker, SharedWorker, BroadcastChannel, serta pola URL telemetry/analytics yang umum.
- **Listener registry**: override `addEventListener`/`removeEventListener` sehingga listener yang diblokir tidak pernah terpasang dan dapat di-drop kemudian.
- **Force visible**: mengunci `document.hidden`, `visibilityState`, `hasFocus`, dan berbagai `on*` handler agar selalu netral.
- **Fullscreen stripper**: memotong snippet JS/HTML yang memaksa fullscreen (via fetch/XHR) sebelum dijalankan sehingga pemeriksaan wajib layar penuh ikut dinolkan.
- **DevTools panel**: kontrol cepat di tab DevTools (Event Guard) untuk apply/drop dan melihat ukuran registry.

## Cara pakai cepat
1) **Pasang secara lokal**
   - Clone repo ini.
   - Buka `chrome://extensions`.
   - Aktifkan **Developer mode** → **Load unpacked** → pilih folder repo.
2) **Gunakan popup**
   - Klik ikon Event Guard.
   - Pilih *Stealth shield* (default aktif) dan *Log intercepted adds* jika perlu logging.
   - `Apply` untuk terapkan, `Drop listeners` untuk melepas yang tercatat, `Stop shield` untuk menonaktifkan semua proteksi.
3) **Gunakan DevTools**
   - Buka DevTools → tab **Event Guard**.
   - Toggle opsi, `Apply`/`Drop tracked listeners`, atau `Show registry size` untuk melihat jumlah listener aktif yang terdaftar.

## Catatan konfigurasi
- Default config tersimpan di `chrome.storage.local` (lihat `background.js` dan `guard.js`).
- Saat mode stealth aktif, daftar event yang diblokir memakai set **hard-block** (focus/blur/visibility/pointer/out/fullscreen/etc).
- Stripper fullscreen default aktif (`stripFullscreenCode: true`) dan ikut dimatikan saat menekan tombol **Stop shield** di popup.
- Filter jaringan juga memakai `declarativeNetRequest` dengan pola seperti `*analytics*`, `*sentry*`, `*collect*`, `*segment*`, dll.

## Jalur file penting
- `manifest.json` – setup MV3, izin `scripting/storage/tabs/dNR`.
- `guard.js` – patch injeksi halaman, blok event/outbound, force visibility.
- `background.js` – simpan/push config, atur aturan dNR, relay pesan.
- `popup.html` / `popup.js` – UI kontrol cepat.
- `devtools.html` / `devtools-panel.js` – panel DevTools.
- `icons/` – aset ikon.

## Troubleshooting
- Jika halaman masih memicu blur/visibility, coba `Drop listeners` setelah memuat ulang halaman.
- Jika telemetri masih muncul, nyalakan *Log intercepted adds* untuk melihat intercept, lalu cek pola URL target (bisa ditambah di kode jika perlu).
