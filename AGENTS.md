# AGENTS.md

Guidance for AI coding agents working in this repository. Assumes no prior knowledge of the project.

## Project overview

**نظام الأرشيف الإلكتروني (Bonyan Archive System)** — an offline-first Electron + Angular desktop app for مركز البنيان (Misrata, Libya) that manages a document archive: 177+ seeded classification folders, dynamic document types, three-tier confidentiality (عادي/سري/سري للغاية), an org-unit-scoped role hierarchy, audit trail, attachments, electronic signatures, and annual closing. Single-tenant, no network dependency, no backend server — SQLite is the only datastore. Proprietary license (see `PROPRIETARY-LICENSE.md` / `NOTICE.md`).

All UI text, error messages, and audit log actions are **Arabic**, with RTL layout (`<html dir="rtl" lang="ar">`, Tajawal font). Code identifiers and code comments are English.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Angular 17 (standalone components only, no NgModules), Angular Signals for state |
| Desktop shell | Electron 30 |
| Database | SQLite via `better-sqlite3` (synchronous, native module) |
| UI | Angular Material + Tailwind CSS, SCSS |
| Packaging | electron-builder (config: `electron-builder.json`) |
| Package manager | **Bun** (not npm — `bun.lock`, `cli.packageManager: "bun"` in `angular.json`) |
| Other libs | bcryptjs (password hashing), chart.js, jsbarcode, mammoth (docx), dompurify |

## Build and run commands

```bash
bun install                 # postinstall runs electron-rebuild — rebuilds better-sqlite3's native binding for Electron's Node ABI. Re-run `bun run postinstall` if the native module breaks.
bun run start               # full production build (Angular + Electron TS), then launches Electron
bun run build:electron      # ng build --configuration production --base-href app://-/  &&  tsc -p electron/tsconfig.json
bun run build:prod          # same as build:electron
bun run dist:win            # production build + electron-builder → NSIS installer + portable .exe
bun run build:win           # portable .exe only (works on Linux without Wine)
bun run build:linux         # AppImage
bun run build:linux-deb     # .deb package
bun run test:login          # production build, then runs scripts/test-login.js as a smoke test against the packaged main process
```

Key facts:

- **There is no `ng serve` dev loop and no hot reload.** The app depends on Electron's IPC/DB layer, so the real iteration cycle is: edit → `bun run start` (full rebuild + relaunch).
- Packaged artifacts land in `release/` (per `electron-builder.json`), not `dist/` — `dist/` holds the intermediate Angular bundle (`dist/bonyan-archive-system/`) and compiled Electron JS (`dist/electron/`).
- Angular entry point: `dist/electron/main.js` (see `package.json` `"main"`).
- Default login: `admin` / `admin123` — seeded **once** on first `initDb()` when the `users` table is empty, never reset afterwards. Once changed, `admin123` stops working. See `DEBUG.md` for login troubleshooting.

## Architecture

Three layers, split across **two separate TypeScript compilations** (`tsconfig.app.json` for Angular, `electron/tsconfig.json` for Electron — not one project, so types/constants are **not shared** between them):

- **`electron/main.ts`** (~1,800 lines) — Electron main process. Registers a privileged `app://` protocol that serves the built Angular bundle (avoids `file://` relative-path breakage in packaged builds; paired with `withHashLocation()` in `src/app/app.config.ts`). Owns ~90 `ipcMain.handle()` channels, almost all following the same shape: `activeUser()` → `hasMinRole(user, [minRole])` → do the work → `addAudit(...)`. Document channels additionally check `canAccessConfidentiality(...)` and `canTouchDocument(...)` (org-unit scoping) per row. **The logged-in user lives in a module-level variable in the main process** — the renderer's `AuthService.currentUser` signal is only a mirror of what `auth:getCurrentUser` returns.
- **`electron/preload.ts`** — `contextBridge.exposeInMainWorld('electronAPI', …)`. Pure passthrough (`ipcRenderer.invoke`), no logic — the single security boundary between renderer and main. The full shape is typed in `src/types/electron.d.ts`; treat that file as the authoritative IPC contract. Never expose raw `ipcRenderer`.
- **`electron/database.ts`** (~3,000 lines) — schema DDL, idempotent migration functions (re-run on every `initDb()`, guarded by `PRAGMA table_info` / try-catch on `ALTER TABLE`), seed data, and exported CRUD functions. Two important behaviors:
  - **Schema changes must be additive** — migrations assume existing DBs; never write migrations that only work on a fresh DB.
  - **In-memory fallback store** (`memoryStore`) activates if the native `better-sqlite3` module fails to load — every exported function branches on `useMemoryFallback`. Coverage is incomplete: annual closing, import, and raw `query()`/`run()` explicitly error out in fallback mode.
  - Foreign keys are declared in the schema but `PRAGMA foreign_keys` is never enabled, so `ON DELETE CASCADE` is not actually enforced.
- **`src/app/`** — Angular 17, standalone components, functional route guards, `HashLocationStrategy`. No store library — state is signals on `providedIn: 'root'` services (`src/app/services/`). Services wrap `window.electronAPI` calls and unwrap `{ success, error }` result objects into thrown Errors; **components never touch `electronAPI` directly**.

### Adding a new IPC feature touches four places

1. Handler in `electron/main.ts` (logic usually in `electron/database.ts`)
2. Exposure in `electron/preload.ts`
3. Type declaration in `src/types/electron.d.ts`
4. Wrapper in an Angular service (`src/app/services/`)

Update both ends together; `src/types/electron.d.ts` is the contract.

## Domain concepts

- **Roles** (`UserRole` in `src/app/models/user.model.ts`): `general_manager` > `deputy_manager` > `dept_head`/`section_head` (same level) > `employee`, via `ROLE_HIERARCHY`/`hasRole()`. Implemented a **second time with no shared source** in `electron/main.ts` (`ROLE_LEVEL`/`hasMinRole()`) — keep both in sync by hand if the hierarchy changes.
- **Org units**: users belong to an `org_units` tree (`administration`/`section`, via `parent_id`). `dept_head`/`section_head` are scoped to their own subtree (`isUserInSubtree`) for document create/edit/delete; `employee` to their own org unit only; `deputy_manager`+ see everything.
- **Confidentiality levels** on documents: عادي (normal) / سري (secret — requires password re-entry, max 3 attempts) / سري للغاية (top secret — password + 6-digit code generated in the Security Center, stored hashed, shown once). Access attempts are audit-logged.
- **Document types** are dynamic DB rows; system types صادر/وارد/مراسلات are protected from deletion.
- **Reference number format**: `م.ب/{sequenceNumber}/{classificationNumber}` (e.g. `م.ب/3/150`). The sequence comes from the `archive_sequences` table (one row per calendar year, `last_number` only increments — never derived from `COUNT(*)`, so deleted numbers are never reused). Allocation runs inside a transaction with a `UNIQUE(year)` upsert (`getNextArchiveSequenceNumber` in `database.ts`). The ref number is generated **server-side at the moment `document:create` runs** — the client never pre-fetches or supplies one. The legacy `counters` table (old `{PREFIX}-{FOLDER_ID}-{YEAR}-{COUNTER}` scheme) is no longer written to.
- **Annual closing** (`closeYear()`): copies the whole SQLite file to a timestamped backup in `backups/`, then moves that year's rows into a dynamically created `archived_documents_<year>` table and deletes them from `documents` — irreversible from within the app.
- **Audit log**: most mutations write entries via `addAudit`/`auditAPI`, with Arabic action strings.

## Code style guidelines

- Match the RTL, Arabic-labeled UI when adding user-facing text or IPC error messages; code identifiers and comments stay in English.
- Commits follow conventional-commit style with scope, e.g. `fix(footer): ...`, `feat(security): ...`. Release bumps update the `package.json` version.
- Authorization is checked in three renderer-side places that all read the same permissions: `permissionGuard`/`adminGuard`/`roleGuard` (routes, via `data: { permission: '...' }` in `src/app/app.routes.ts`), `*appHasPermission` (`src/app/directives/has-permission.directive.ts`), and ad hoc `auth.isAdmin()`/`auth.can()` calls. **None of these are a real security boundary** — actual enforcement is the per-channel checks in `main.ts`. Every new privileged channel must enforce role/confidentiality/org-unit checks itself.
- Two IPC channels, `db:query` and `db:run`, are generic raw-SQL passthroughs; `db:query` has no permission check at all. Prefer adding a dedicated typed channel over reaching for them.
- There is no lint configuration in the repo.

## Testing

- There is **no meaningful unit-test suite**. Karma/Jasmine are configured (`ng test`, `tsconfig.spec.json`) but the only spec file (`src/app/app.component.spec.ts`) is the unedited CLI default and currently fails against the real `AppComponent`.
- Practical verification is via scripts in `scripts/`:
  - `bun run test:login` → `scripts/test-login.js` — end-to-end smoke test of the packaged main process (login flow).
  - `scripts/test-archive-integrity.js` — archive data integrity checks.
  - `scripts/ui_verify_*.py`, `ui_debug.py`, `capture_layout.py` — Python UI verification/capture helpers (a `.venv-cdp/` venv exists for them).
- Otherwise, verification means: build (`bun run build:prod`) and run the app (`bun run start`), exercising the changed flow manually. Use DevTools (`Ctrl+Shift+I`) and the `[Preload]`/`[Main]`/`[Auth Service]` console log prefixes (see `DEBUG.md`).

## CI / deployment

- `.github/workflows/ci.yml` — on every push/PR: matrix build on `windows-latest` (portable .exe) and `ubuntu-latest` (AppImage + .deb), using Bun + Node 20, with `electron-rebuild` run explicitly. Artifacts uploaded for 14 days.
- `.github/workflows/release.yml` — on `v*` tags: builds the Windows portable exe and Linux .deb and publishes a GitHub release.
- Releases are versioned in `package.json` (currently 1.2.4); release notes convention lives in `README.md`.

## Data locations (runtime)

- **Windows:** `%APPDATA%\bonyan-archive-system\archive.db`
- **Linux:** `~/.config/bonyan-archive-system/archive.db`
- **Backups:** `backups/archive_YYYY_<timestamp>.db` (next to the DB)
- Full settings reference: `docs/PREFERENCES.md`.

## Security considerations

- Proprietary codebase — do not publish or redistribute.
- Passwords are hashed with bcryptjs; top-secret access codes are stored hashed only.
- The renderer is sandboxed behind `contextBridge`; keep `preload.ts` a pure passthrough and never expose `ipcRenderer` or Node APIs directly.
- Secrets/credentials in this project are limited to the seeded default admin login (documented above) — change it immediately on any real deployment.
- `db:query` is an unauthenticated raw-SQL read channel — treat it as technical debt, not a pattern to copy.
