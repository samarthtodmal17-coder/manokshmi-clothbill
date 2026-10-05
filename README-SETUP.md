# Manokshmi ClothBill (Tauri desktop, SQLite)

Same architecture as RestroBill. Version 0.1.0.

## What is here
- `www/index.html` - the cloth shop app (original UI/features unchanged).
- `www/sqlite-adapter.js` - SQLite storage (one table per former IndexedDB store; record kept as JSON + indexed columns).
- `www/tauri-integration.js` - licence gate, printing, WhatsApp/mailto links, daily + on-close backups, safe close, auto-update.
- `src-tauri/` - Rust shell (`get_device_fingerprint`, `open_external`), migration `0001_init.sql` (generated from the schema).
- `tools/test-adapter.mjs` - `node tools/test-adapter.mjs` (Node 22+) tests the SQL layer against real SQLite.

## One-time setup
1. Create a new GitHub repo `manokshmi-clothbill`. If you pick a different name/owner, change the updater endpoint in `src-tauri/tauri.conf.json`.
2. Repo > Settings > Secrets > Actions: add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (same values as RestroBill - the public key in tauri.conf.json is the same).
3. Licensing admin: add a product with id `cloth-pos` (name "Manokshmi ClothBill"), then issue keys for it.
4. Push: `git init`, `git add .`, `git commit -m "ClothBill 0.1.0"`, `git branch -M main`, `git remote add origin <repo-url>`, `git push -u origin main`, then `git tag v0.1.0` and `git push origin v0.1.0`. GitHub Actions builds a draft release - publish it.
5. Icons are currently the RestroBill icons - replace `src-tauri/icons/*` with a ClothBill logo later.

## Moving a shop's existing browser data in
Old browser data cannot be read by the desktop app. In the old HTML app: Settings > Backup > Export. In ClothBill: same screen > Restore, pick that file.

## Where things live
- Database: `%APPDATA%\in.manokshmitechnologies.clothbill\clothbill.db` (survives reinstall).
- Backups + debug.log: `Documents\Manokshmi ClothBill Backups\` (daily, last 14 kept; refreshed on close).

## Releasing updates
Bump version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `APP_VERSION` in `www/tauri-integration.js`, commit, tag `vX.Y.Z`, push the tag.
Never edit `0001_init.sql` after release; add `0002_*.sql` and register it in `main.rs`.

## Not verified here
Rust could not be compiled in the build sandbox; the first GitHub Actions run is the real compile check. Test on Windows: printing (bill, barcode labels), WhatsApp link, CSV downloads, licence activation, close + reopen keeps data.
