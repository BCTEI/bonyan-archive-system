# External Encrypted Backup & Restore — Design Spec

Date: 2026-08-22 · Target release: v1.4.0 · Status: approved design, pre-implementation

## 1. Goal

Give مركز البنيان a way to **export the entire archive to an external hard drive as a single encrypted file**, and to **restore it back** (same machine after a failure, or a new machine), with security as the primary requirement:

- Confidentiality: the backup is useless without the passphrase (AES-256-GCM, scrypt-derived key).
- Integrity: any tampering or truncation makes decryption fail loudly — never a partial/corrupt restore.
- Completeness: one backup captures **everything** — live documents, attachments (base64 inline in the DB), folders, document types, users, org units, master lists, audit/access logs, archive sequences, **and all closed-year `archived_documents_<year>` tables** (which the legacy JSON export silently loses).
- Safety: a failed export or restore never damages the live database; every restore first takes a local safety copy.

## 2. Non-goals (explicitly out of scope)

- Selective export (per folder / per year / per document) — possible phase 2.
- Scheduled/automatic backups, cloud destinations, multi-file media spanning.
- Changing or removing the legacy dashboard JSON `db:export`/`db:import` (left untouched).
- Merging a backup into existing data — restore is always full replace.

## 3. Threat model

| Threat | Mitigation |
|---|---|
| External drive lost/stolen | AES-256-GCM; key derived from a user-chosen passphrase via scrypt — no key material on disk |
| Backup file modified/corrupted | GCM auth tag + embedded SHA-256 of the plaintext DB + `PRAGMA quick_check` after decrypt |
| Offline brute-force of passphrase | scrypt(N=2^14, r=8, p=1) + minimum-length rule (10+) enforced on export |
| Online guessing at restore time | Wrong passphrases hit the existing in-memory rate limiter (5 failures → 15-min lock), per user |
| Privilege abuse (non-GM exporting users/hashes) | `general_manager` role enforced **in the main process** on every channel + GM account-password re-entry before export and before restore; renderer guard is convenience only |
| Partial write (drive pulled mid-export) | Streaming write to destination; partial file deleted on failure; live DB never touched by export |
| Failed restore bricking the install | Decrypt + full validation happens **before** the live DB is closed; current DB copied to `backups/pre_restore_<ts>.db` before the swap; automatic rollback on swap failure |
| Downgrade/format confusion | Format-version byte and app version in the header; newer-format or newer-app backups are refused with a clear message |
| Shoulder-surfing of passphrase | Masked fields; passphrase never logged, never stored, never sent anywhere except the single IPC call |

## 4. Backup file format (`.bonyan-backup`)

Single binary file, little-endian:

```
offset  field
0       magic            8 bytes ASCII "BONYANBK"
8       formatVersion    1 byte  (= 1)
9       manifestLen      uint32 LE
13      manifest         UTF-8 JSON (plaintext — this is what the restore preview shows)
…       kdfN             uint32 LE (= 16384)
…       kdfR             uint32 LE (= 8)
…       kdfP             uint32 LE (= 1)
…       saltLen          1 byte (= 32), then salt
…       nonceLen         1 byte (= 12), then nonce
…       ciphertext       gzip(sqlite snapshot) encrypted with AES-256-GCM
EOF-16  gcmTag           16 bytes (appended by cipher.final())
```

`manifest` JSON:

```json
{
  "app": "bonyan-archive-system",
  "appVersion": "1.4.0",
  "createdAt": "2026-08-22T14:03:11.000Z",
  "createdBy": "admin",
  "dbSizeBytes": 73400320,
  "sha256": "<hex of the plaintext snapshot>",
  "counts": { "documents": 412, "archivedYears": 2, "folders": 177, "users": 9 }
}
```

The header is intentionally plaintext so the restore UI can preview a backup **before** asking for the passphrase. It leaks only counts/dates — acceptable on a user-managed drive.

## 5. Crypto design

- **KDF:** `crypto.scrypt(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })` (async form; ≈16 MB memory — within Node's default scrypt limit). Salt: 32 random bytes per export. KDF params are stored in the header so they can be raised in future format versions.
- **Cipher:** AES-256-GCM, 12-byte random nonce per export, 16-byte tag.
- **Pipeline (export):** the manifest sits **before** the ciphertext but must contain the plaintext SHA-256, so the export makes two sequential read passes over the local temp snapshot: (1) `createDbSnapshot(tmp)` (a new `database.ts` export wrapping better-sqlite3's online `db.backup()` — consistent while the app is running) and SHA-256 the snapshot; (2) write the header, then stream `fs.createReadStream(tmp)` → `zlib.createGzip()` → `crypto.createCipheriv('aes-256-gcm')` → `fs.createWriteStream(destination + '.part')`. On success `fs.rename('.part' → final)` so a partially-written file never carries the final name; on any failure the `.part` file and temp snapshot are deleted. Progress events report plaintext bytes read vs. snapshot size (gzip output is smaller, so treat it as an approximation, capped at 99% until the rename lands).
- **Pipeline (restore):** parse header (bounded reads — never load a multi-GB file into memory) → scrypt → `createDecipheriv` → gunzip → write temp `.db` → GCM tag check fires at stream end (`auth tag mismatch` = wrong passphrase **or** tampered — same message) → open temp with better-sqlite3 readonly → `PRAGMA quick_check` + sanity queries (`users` non-empty, `documents` table present, `sqlite_sequence` present) + verify `sha256(temp) == manifest.sha256` → close temp handle → proceed to swap.
- **Passphrase hygiene:** never written to logs or disk; held only as a function-scope string for the duration of the call (JS strings are immutable — true erasure is not possible; documented as best-effort). Renderer clears the fields immediately after the IPC call.

## 6. Export flow (user-facing)

Route: `/main/external-backup` — new GM-only page «النسخ الاحتياطي الخارجي» (route guarded by existing `adminGuard`; nav item visible to GM only, same pattern as «مركز الأمان»).

Export card steps:

1. **GM re-authentication** — account password field (reuses `security:verifyPassword` IPC). Unlocks the rest of the card for this page visit.
2. **Destination** — «اختيار مكان الحفظ» → `backup:chooseDestination` → Electron `dialog.showSaveDialog` (default `bonyan-backup-YYYYMMDD-HHmm.bonyan-backup`). Chosen path displayed.
3. **Backup passphrase** — two masked fields; client + server validation: min 10 chars, both match. Helper text: «احتفظ بكلمة المرور هذه في مكان آمن — لا يمكن استعادة النسخة بدونها».
4. «بدء التصدير» → determinate progress bar (bytes written vs. DB size, via `backup:progress` events) → success panel: full path, file size, SHA-256 fingerprint, and a reminder to verify the drive on another machine.
5. Audit entry: `تصدير نسخة احتياطية خارجية` with destination path + file hash in details.

## 7. Restore flow (user-facing)

Restore card steps:

1. **GM re-authentication** (same as export).
2. **Choose file** → `backup:chooseBackupFile` → `dialog.showOpenDialog` (filter `.bonyan-backup`) → main parses + validates the header (magic, formatVersion ≤ supported, manifest `appVersion` ≤ the running `app.getVersion()` using a numeric major.minor.patch comparison) and returns the manifest → preview panel: creation date, created-by, app version, document/folder/user counts, DB size.
3. **Passphrase** field + **red warning block**: «سيتم استبدال جميع البيانات الحالية بمحتوى النسخة — سيتم أولاً حفظ نسخة أمان من البيانات الحالية تلقائياً» + a note that after relaunch the login credentials are those **stored in the backup** + explicit checkbox «أفهم أن البيانات الحالية ستُستبدل».
4. «بدء الاستعادة» → `backup:restore(filePath, passphrase)`:
   - rate-limit key `backup-restore:<username>` via the existing limiter (`checkRateLimit`/`recordFailedCodeAttempt` — the latter already returns `{ locked, remaining }`); wrong-passphrase message includes remaining attempts, mirroring the security modal.
   - decrypt/validate as in §5 (live DB untouched so far).
   - `closeDatabase()` (new export in `database.ts` — `db.close()`, null the handle; Windows holds a file lock on open DBs, so the swap is impossible without this).
   - copy live `archive.db` → `userData/backups/pre_restore_<timestamp>.db` (reuses the existing backups dir convention).
   - `fs.rename` temp snapshot → `archive.db` (same volume — temp lives in `userData`); on failure, copy the safety file back, reopen via `initDb()`, and return an error.
   - audit `استعادة نسخة احتياطية خارجية` (source path, manifest date).
   - return `{ success: true }` → renderer shows «اكتملت الاستعادة بنجاح» with a **«إعادة تشغيل التطبيق الآن»** button (auto-fires after 10 s with a visible countdown) → the button calls `backup:relaunchNow` → main performs `app.relaunch(); app.exit(0)` (clean reopen of the new DB, fresh login). Keeping the relaunch on an explicit follow-up call — instead of relaunching inside `backup:restore` — guarantees the user actually sees the completion state instead of the app vanishing mid-toast.

## 8. IPC contract (5 channels + 1 event)

Per AGENTS.md, all four touch points are updated together: handler (`electron/main.ts`), `electron/preload.ts`, `src/types/electron.d.ts`, and a new `src/app/services/backup.service.ts`. Every handler: `activeUser()` → `hasMinRole(user, 'general_manager')` → work → `addAudit(...)`. Errors return `{ success: false, error: '<Arabic>' }` and flow through `toUserErrorMessage`.

| Channel | Args | Returns | Notes |
|---|---|---|---|
| `backup:chooseDestination` | — | `{ success, filePath? , canceled? }` | save dialog, appends `.bonyan-backup` if missing; rejects the live DB path |
| `backup:export` | `filePath, passphrase` | `{ success, filePath, sizeBytes, sha256 }` | full §5 pipeline; validates passphrase (≥10) and destination writability; deletes `.part` on failure |
| `backup:chooseBackupFile` | — | `{ success, filePath?, manifest?, canceled?, error? }` | open dialog + header parse/validation (magic, format, app-version) |
| `backup:restore` | `filePath, passphrase` | `{ success }` | rate-limited; renderer triggers the relaunch afterwards via `backup:relaunchNow` |
| `backup:relaunchNow` | — | `{ success: true }` (never returns — app exits) | GM-gated like the rest; only intended post-restore, but harmless on its own |
| `backup:progress` (event) | `{ phase: 'export' \| 'restore', percent }` | — | `webContents.send`; preload exposes `onBackupProgress(cb)` returning an unsubscribe function |

## 9. Files touched

**New:**
- `electron/backup.ts` — format constants, header read/write, scrypt/AES helpers, export/restore orchestration, manifest types. Kept out of `database.ts` (already ~3,100 lines): it consumes three small `database.ts` exports (below) and never touches the `db` handle directly.
- `src/app/services/backup.service.ts` — typed wrappers with `unwrap`, progress subscription.
- `src/app/components/external-backup/external-backup.component.{ts,html,scss}` — the page (two cards, progress bar via `MatProgressBarModule`, reuse the existing `PasswordConfirmDialogComponent` pattern for GM re-auth).
- `scripts/test-backup-roundtrip.js` — headless verification (§11).

**Modified:**
- `electron/database.ts` — add three small exports: `getDbPath()`, `closeDatabase()` (close + null the handle, for the Windows-safe swap), and `createDbSnapshot(destPath)` (thin wrapper over better-sqlite3's online `db.backup()`). Nothing else in the file changes.
- `electron/main.ts` — register the 5 channels; `backup:relaunchNow` performs `app.relaunch(); app.exit(0)`.
- `electron/preload.ts` — expose `backupAPI` (incl. `relaunchNow`) + `onBackupProgress`.
- `src/types/electron.d.ts` — `backupAPI` types (the authoritative contract).
- `src/app/app.routes.ts` — `/main/external-backup` route with `adminGuard`.
- `src/app/components/app-shell/app-shell.component.html` — nav item (GM-only), icon `usb`/`save_alt`.

## 10. Error handling matrix (all Arabic, professional)

| Case | Message |
|---|---|
| Dialog canceled | silent (no toast) |
| Destination not writable / drive removed mid-export | `تعذر الكتابة إلى الوجهة المحددة — تحقق من توصيل القرص والصلاحيات` |
| Not enough space (ENOSPC) | `مساحة غير كافية على القرص المحدد` |
| Wrong passphrase / tampered file (GCM) | `تعذر فك التشفير — كلمة المرور غير صحيحة أو الملف معدّل` (+ remaining attempts) |
| Rate-limited | existing lockout text pattern (`تم تأمين التحقق مؤقتاً…`) |
| Bad magic / not a backup | `الملف المحدد ليس نسخة احتياطية صالحة من هذا النظام` |
| Newer format version | `إصدار النسخة أحدث مما يدعمه التطبيق — حدّث التطبيق أولاً` |
| Newer app version in manifest | `تم إنشاء هذه النسخة بإصدار أحدث من التطبيق — حدّث التطبيق قبل الاستعادة` |
| Corrupt SQLite after decrypt | `النسخة تالفة — فشل فحص سلامة قاعدة البيانات` |
| Swap failure | rollback happens; `فشلت الاستعادة — تمت إعادة البيانات السابقة دون تغيير` |

## 11. Testing & verification

1. `bun run build:prod` — both TS projects compile.
2. `bun run test:login` — stays green (database.ts gained two exports).
3. `scripts/test-backup-roundtrip.js` (new, run like `test-login.js` against a temp `userData`):
   - init temp DB → create sample documents → export with passphrase → file exists, header parses, magic/version correct;
   - wrong-passphrase restore → fails with GCM error;
   - byte-flip in ciphertext → fails with GCM error;
   - correct restore → counts match, a known document round-trips, a closed-year table survives the round-trip (this is the regression the legacy JSON path gets wrong);
   - rollback path: forced swap failure → original DB intact.
4. Manual: export to a real USB drive → restore on a fresh Windows profile → login with a user from the backup → open a document + attachment → print report.

## 12. Compatibility & rollout notes

- No schema migration — feature is additive; existing DBs work unchanged.
- `formatVersion = 1`. Future changes (KDF params, compression, selective restore) bump it; readers always reject `> supported`.
- The legacy JSON `db:export` remains for deputy+ (unchanged). A future hardening note (not this spec): it includes `password_hash` values unencrypted.
- Restore relaunch means the GM re-logs-in using the credentials **from the restored backup** — the UI states this in the warning block.
