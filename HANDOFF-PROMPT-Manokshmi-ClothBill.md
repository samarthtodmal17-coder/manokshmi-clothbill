# HANDOFF PROMPT — Manokshmi ClothBill (paste this into a new chat)

You are continuing work on **Manokshmi ClothBill**, a Windows desktop billing and management app for cloth shops. Read everything below before doing anything. Do not ask me to repeat context that is written here.

## 1. Who I am and how to work with me
- I am Samarth, owner of **Manokshmi Technologies** (Maharashtra, India). I am **not a coder**; I direct builds and you do the engineering.
- Keep answers short and direct. Give exact click-by-click or copy-paste steps for anything I must do (GitHub, Cloudflare, PowerShell).
- Use the multiple-choice question tool when a real decision is mine; otherwise pick sensible defaults and tell me.
- Never ask me to paste secrets (signing key, admin secret, passwords) into chat. Tell me where to put them instead. If I upload a private key by mistake, do not open it.
- Be honest about what is verified and what is not. Say clearly when something could not be tested in your sandbox.
- My other product, **Manokshmi RestroBill** (restaurant POS), is handled in a different chat. Do not change RestroBill from this chat.

## 2. What ClothBill is
- My new product for cloth shops. It started as a single ~14.4k-line HTML app I uploaded (`cloth-shop-billing-and-management_3.html`) that stored data in browser IndexedDB (`BoutiqueManagerDB` v10, 22 stores), with English/Marathi UI, own owner/staff PIN login + recovery code, multi-firm support, quotations, alterations, bookings, purchases, GST/Tally exports, barcode labels, etc.
- I decided to build it **like RestroBill**: a **Tauri v2 Windows desktop app with real SQLite**, licence activation, signed auto-updates, GitHub Actions builds. This is **phase 1 (offline desktop)**.
- A current customer wants it **cloud-based, joined with a website and an app**. That is phases 2 and 3 (see section 9). I plan to sell in phases with milestone payments.

## 3. Where things are
- Project folder: `C:\Desktop\BILLING SOFTWARE\Latest Version\Restaurant\manokshmi-clothbill` (sibling of the RestroBill folder `...\Restaurant\tauri-app-phase2-v2`).
- GitHub repo (public): https://github.com/samarthtodmal17-coder/manokshmi-clothbill (branch `main`, tag `v0.1.0` pushed, first commit `326b0c8`).
- Licensing platform (shared with RestroBill): https://licensing-platform.pages.dev — admin page https://licensing-platform.pages.dev/admin.html (uses an `ADMIN_SECRET` set in Cloudflare; never ask me for it). Source in `...\Restaurant\tauri-app-phase2-v2\licensing-platform`.
- Windows PowerShell is my shell. Git is installed and working.

## 4. Project files (all inside `manokshmi-clothbill`)
- `www/index.html` — the cloth app (original UI/features unchanged) with these edits: original IndexedDB code kept but renamed `idb*` as a browser-only fallback; new `openDB`/`dbGetAll/dbGet/dbPut/dbAdd/dbDelete/dbClear/dbReplaceAll/dbIdle/dbShutdown` dispatch to SQLite when `window.__TAURI__.sql` exists; `performRestore` uses `dbReplaceAll`; all 8 `window.open('', '_blank', …)` print popups became `openPrintWindow(...)`; all WhatsApp/mailto `window.open` became `openExternal(...)`; `initApp` awaits `ensureLicensed()` (desktop only) after migrations and skips `initPWA` in desktop; `onAuthResolved` calls `clothStartDesktopServices()`.
- `www/sqlite-adapter.js` — storage adapter. `SCHEMA` object is the single source of truth for the 22 stores (key column, text-key flag, indexed columns). One SQLite table per store: key + `ix_<col>` index columns + `data` (full record as JSON) + `updated_at`. Reads merge the key back into the object. All operations go through a single FIFO queue with busy/locked retry (avoids RestroBill's "database is locked" problem). `put` = `INSERT … ON CONFLICT DO UPDATE` (never `INSERT OR REPLACE`). `add` = plain INSERT (conflict rejects, like IndexedDB). `replaceAll` for restore. `flushAndClose()` for safe shutdown. Driver is injected (Tauri SQL plugin in app, `node:sqlite` in tests).
- `www/tauri-integration.js` — desktop layer: `APP_VERSION='0.1.0'`, `PRODUCT_ID='cloth-pos'`, `LICENSE_API_BASE='https://licensing-platform.pages.dev'`; hidden-iframe print shim (Tauri blocks `window.open`); `openExternal` → Rust `open_external`; licence gate overlay (key entry → `/api/activate`, cached in localStorage `clothBillLicense_v1`, quiet re-check every 14 days, revoked key relocks access only); daily backup + on-close backup to `Documents\Manokshmi ClothBill Backups\backup-YYYY-MM-DD.json` (keeps 14) plus `debug.log`; safe close (wait for saves → backup → `db.close()` → `process.exit(0)`, fallback `destroy()`, re-entrancy guard, only after app started); signed auto-update check 5 s after start (confirm dialog).
- `src-tauri/src/main.rs` — registers SQL plugin (`sqlite:clothbill.db`, migration 1), fs, updater, process; commands `get_device_fingerprint` (machine-uid) and `open_external` (Windows `rundll32 url.dll,FileProtocolHandler`, only http/https/mailto, length/newline checks).
- `src-tauri/migrations/0001_init.sql` — **generated** from SCHEMA by `tools/gen-migration.mjs`. Never edit it after release; add `0002_*.sql` and register it in `main.rs`.
- `src-tauri/tauri.conf.json` — productName "Manokshmi ClothBill", version 0.1.0, identifier `in.manokshmitechnologies.clothbill`, NSIS (currentUser) + MSI, `createUpdaterArtifacts`, updater endpoint `https://github.com/samarthtodmal17-coder/manokshmi-clothbill/releases/latest/download/latest.json`, **same public key as RestroBill** (verified it matches my `restaurant-billing.key.pub`).
- `src-tauri/Cargo.toml`, `capabilities/default.json` (copied from RestroBill: sql, fs, updater, process), `build.rs`, icons (**still RestroBill's placeholder icons**).
- `.github/workflows/build-windows.yml` — builds on tags `v*` with `tauri-apps/tauri-action@v1`, creates a **draft** release, uses secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- `tools/test-adapter.mjs` (run `node tools/test-adapter.mjs`, Node 22+) — SQL layer tests on real SQLite; `README-SETUP.md`.

## 5. What was verified, and what was not
Verified in the sandbox: adapter tests pass for all 22 stores (add/put/get/delete/clear/replaceAll, autoincrement, text keys, retry on locked DB, 200 concurrent writes, failed op does not block queue); all 19 inline scripts pass `node --check`; a jsdom simulation with a fake Tauri + real SQLite got through licence gate → owner PIN setup → app visible, wrote settings/attendance/products, restored a backup, created the print iframe, and called `open_external`.

**Not verified:** real Windows behaviour. Rust could not be compiled in the sandbox, but the GitHub build has now compiled the Rust and produced both installers (NSIS 4.21 MiB, MSI 5.92 MiB). Still untested on a real PC: printing (bills, barcode label sheets, quotations, ledgers) through the hidden iframe in WebView2, WhatsApp/mailto opening, blob CSV/JSON downloads via `a[download]`, licence activation end-to-end, close-and-reopen data persistence, auto-update.

## 6. Current status (where we stopped)
- First GitHub Actions run (#1, tag v0.1.0) built both installers successfully but **failed at the signing step** with: `failed to decode secret key: incorrect updater private key password`. No code problem.
- I located my private key `restaurant-billing.key` (the public half matches the config) and updated both repo secrets, then was about to click **Re-run all jobs** on run #1 (Actions → run "ClothBill 0.1.0" → Re-run all jobs). **Result of the re-run is not yet known.**
- If it fails again with the same password error: the password is wrong or lost → generate a **new key pair for ClothBill only** (one command for me to run, then update the `pubkey` in `tauri.conf.json`, update both secrets, commit, and re-tag; RestroBill's key must not change). If it fails with a different error, I will paste the last ~40 lines of the failing step.
- I may have uploaded my private key file into the earlier chat by mistake; it was not opened. Treat it as unshared; do not request it again.

## 7. Immediate to-do list (in order)
1. Get a green build → in GitHub **Releases**, open the draft `Manokshmi ClothBill v0.1.0`, confirm it contains the `.exe`, `.msi` and `latest.json`, **Publish release**.
2. In the licensing admin → **Products**, register product id `cloth-pos` (exact), name "Manokshmi ClothBill", version 0.1.0 (if not done yet); issue a test licence key for it. (A `restaurant-pos` key will not work in ClothBill.)
3. Install the `.exe` on a Windows PC and run the test checklist: licence screen appears → activate → owner PIN + recovery code → add product/customer/bill → print a bill, barcode labels and a quotation → WhatsApp reminder → CSV export → close and reopen (data still there) → check `Documents\Manokshmi ClothBill Backups` has a backup and `debug.log` → restore an export from the old HTML app.
4. Fix whatever the Windows test finds (printing is the most likely issue).
5. Replace the placeholder icons and lock-screen branding with a ClothBill logo.

## 8. How to release updates
Bump the version in four places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `APP_VERSION` in `www/tauri-integration.js`. Then `git add .`, `git commit -m "…"`, `git tag vX.Y.Z`, `git push origin main`, `git push origin vX.Y.Z`; publish the draft release when the build is green. Schema changes: new `src-tauri/migrations/000N_*.sql` + register in `main.rs`; never edit `0001_init.sql`. Existing customers' DB lives at `%APPDATA%\in.manokshmitechnologies.clothbill\clothbill.db` and survives reinstall.

## 9. Known limitations and the roadmap
- Records are **document-style** (JSON + a few indexed columns), not fully normalised; fine for single-shop desktop, not ideal as-is for cloud.
- Old browser data cannot be read by the desktop app (fresh WebView profile). Migration path: old HTML app → export backup JSON → ClothBill Restore (accepts both the current `{backupVersion,data}` and the older flat format).
- No sync between computers in phase 1.
- Roadmap for the cloud customer: **Phase 2 cloud** (Cloudflare: Workers Paid $5/mo, one **D1 database per shop** — 10 GB cap per DB, 50,000 DBs/account; R2 for photos at ~$0.015/GB, no egress fees; a sync layer + login), **Phase 3 website + owner mobile app**. Sell in milestones, monthly cloud fee, written scope, check DPDP/legal. Facts were fetched from Cloudflare docs in Oct 2026; re-check pricing before quoting. Decide hosting: the same Cloudflare account as my licensing platform is possible, but consider a separate account/project for the more advanced customer.

## 10. Technical lessons carried over from RestroBill (follow these)
- Never use `INSERT OR REPLACE` (cascade delete danger); use `ON CONFLICT DO UPDATE`.
- Serialize writes; retry on "locked/busy"; don't switch to WAL mode (it broke RestroBill).
- Safe close order: preventDefault → wait pending saves → backup → close DB → `process.exit(0)`, fallback `destroy()`.
- Persist a debug log to disk for field-only bugs; keep backups outside AppData (Documents).
- Reinstalling does not delete the DB (it lives in AppData).
- `window.__TAURI__.sql` is the Database class itself (use `.load()` directly).
- Never commit private keys (`*.key` is in `.gitignore`).

## 11. First message to send me
Start by asking (with the choice tool, one short question) what the re-run build result was: green tick, red cross with the same password error, or red cross with a different error — then continue from section 6/7.
