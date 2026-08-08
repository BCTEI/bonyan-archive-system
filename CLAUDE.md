# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

<<<<<<< HEAD
نظام الأرشيف الإلكتروني (Bonyan Archive System) — an offline-first Electron + Angular desktop app for مركز البنيان (Misrata, Libya) managing a document archive: 177 seeded classification folders, dynamic document types, three-tier confidentiality (عادي/سري/سري للغاية), role-based users (admin/editor/viewer), audit trail, and annual closing. Single-tenant, no network dependency, no backend server — SQLite is the only datastore.

## Commands

Package manager is **Bun**, not npm — always use `bun run <script>`.

```bash
bun install                # installs deps; postinstall runs electron-rebuild (rebuilds better-sqlite3's native binding for Electron's Node ABI)
bun run start               # full production build (Angular + Electron TS) then launches Electron — NO hot reload; every change requires a rebuild
bun run build:electron       # ng build --configuration production --base-href app://-/  &&  tsc -p electron/tsconfig.json
bun run dist:win             # production build + electron-builder (NSIS + portable .exe)
bun run dist:linux-deb       # production build + electron-builder (.deb)
bun run build:linux          # production build + electron-builder (AppImage)
bun run test:login           # production build, then runs scripts/test-login.js as a smoke test against the packaged main process
ng test                      # Karma/Jasmine — configured but not meaningfully used; the only spec file (app.component.spec.ts) is the unedited CLI default and currently fails against the real AppComponent
```

There is no `ng serve` dev loop — the app depends on Electron's IPC/DB layer, so `bun run start` (full rebuild + relaunch) is the actual iteration cycle.

Default login: `admin` / `admin123` (auto-seeded on first `initDb()` if the `users` table is empty; see `DEBUG.md` for login troubleshooting).

## Architecture

Three layers, split across two separate TypeScript compilations (`tsconfig.app.json` for Angular, `electron/tsconfig.json` for Electron — **not one project**, so types/constants are not shared between them):

- **`electron/main.ts`** — Electron main process. Registers a privileged `app://` protocol that serves the built Angular bundle directly (avoids `file://` relative-path breakage in packaged builds; paired with `withHashLocation()` in `app.config.ts`). Owns ~90 `ipcMain.handle()` channels, almost all following the same shape: `activeUser()` → `hasPermission(user, [minRole])` → do the work → `addAudit(...)`. Document channels additionally check `canAccessConfidentiality(role, doc.confidentiality)` per row. The logged-in user lives in a **module-level variable in the main process**, not in renderer state — the renderer's `AuthService.currentUser` signal is only ever a mirror of what `auth:getCurrentUser` returns.
- **`electron/preload.ts`** — `contextBridge.exposeInMainWorld('electronAPI', …)`. Pure passthrough (`ipcRenderer.invoke`), no logic. The full shape is typed in `src/types/electron.d.ts` — treat that file as the authoritative IPC contract when adding a channel; update both ends together.
- **`electron/database.ts`** — single ~2,100-line module: schema DDL, ~15 idempotent migration functions (re-run on every `initDb()`, guarded by `PRAGMA table_info` checks / try-catch on `ALTER TABLE`), seed data, and ~45 exported CRUD functions. `better-sqlite3` is synchronous. **A parallel in-memory fallback store** (`memoryStore`, plain TS interfaces) activates if the native module fails to load — every exported function branches on `useMemoryFallback`; coverage is incomplete (annual closing, import, and raw `query()`/`run()` all explicitly error out in fallback mode). Foreign keys are declared in the schema but `PRAGMA foreign_keys` is never enabled, so `ON DELETE CASCADE` is not actually enforced.
- **`src/app/`** — Angular 17, standalone components only (no NgModules), functional route guards, `HashLocationStrategy`. No store library — state is Angular **signals** on `providedIn: 'root'` services (`AuthService.currentUser` is the load-bearing one). Authorization is checked in three independent places that all read the same `RolePermissions` map derived from that signal: `permissionGuard`/`adminGuard` (routes), `HasPermissionDirective`/`*appHasPermission` (templates), and ad hoc `auth.isAdmin()`/`auth.can()` calls. **None of these are a real security boundary** — the actual enforcement is the per-channel checks in `main.ts`. Two IPC channels, `db:query` and `db:run`, are generic raw-SQL passthroughs; `db:query` has no permission check at all, so prefer adding a dedicated typed channel over reaching for it when building new features that read data.

The admin(3) > editor(2) > viewer(1) role hierarchy is implemented twice with no shared source — `ROLE_HIERARCHY`/`hasRole()` in `src/app/models/user.model.ts` and `ROLE_LEVEL`/`hasPermission()` in `electron/main.ts`. Keep both in sync by hand if the hierarchy ever changes.

Reference number format: `م.ب/{sequenceNumber}/{classificationNumber}`, e.g. `م.ب/1/105`, `م.ب/2/105`, `م.ب/3/150`. `classificationNumber` is the folder/classification id (`documents.folder_id`). `sequenceNumber` comes from the `archive_sequences` table (one row per calendar year, `last_number` only ever increments — never derived from `COUNT(*)`, so a deleted document's number is never reused). Allocation (`getNextArchiveSequenceNumber` in `database.ts`) runs inside a `better-sqlite3` transaction with a `UNIQUE(year)` upsert, so it can't hand out the same number twice. The ref number is generated **server-side, at the moment `document:create` runs** (`generateArchiveRefNumber`) — the client never pre-fetches or supplies one; `DocumentFormComponent` shows a `م.ب/؟/{folder_id}` placeholder until save. The legacy `counters` table (old `{PREFIX}-{FOLDER_ID:3}-{YEAR}-{COUNTER:4}` scheme, still readable on documents created before this system) is no longer written to.

Annual closing (`closeYear()`) copies the whole SQLite file to a timestamped backup, then moves that year's rows into a dynamically created `archived_documents_<year>` table and deletes them from `documents` — irreversible from within the app.

App is fully Arabic/RTL; UI strings, error messages, and audit log actions are Arabic throughout — match that when adding new user-facing text or IPC error messages.
=======
Arabic-language (RTL) offline document archive desktop app for مركز البنيان (Bonyan Center), Misrata, Libya. Electron 30 + Angular 17 (standalone components, Signals) + SQLite via better-sqlite3. Proprietary license. All UI text, error messages, and commit-facing docs are Arabic; code identifiers and comments are English.

## Commands

Package manager is **Bun** (`bun.lock`), not npm.

```bash
bun install               # install deps
bun run postinstall       # electron-rebuild (fix better-sqlite3 native module)
bun run start             # build production + launch Electron (the dev loop — there is no watch mode)
bun run build:prod        # ng build (production, --base-href app://-/) + tsc -p electron/tsconfig.json
bun run dist:win          # Windows NSIS installer (needs Wine on Linux)
bun run build:win         # Windows portable .exe
bun run build:linux       # Linux AppImage
bun run build:linux-deb   # Linux .deb
bun run test:login        # scripted Electron login smoke test (scripts/test-login.js)
bunx ng test              # Karma/Jasmine unit tests (no package.json script; specs are sparse)
```

There is no lint configuration. Default login: `admin` / `admin123`. Debugging login/IPC issues: see `DEBUG.md`. CI (`.github/workflows/ci.yml`) builds Windows/Linux artifacts on every push.

## Architecture

Two compiled worlds, one contract:

1. **Electron main process** (`electron/`, compiled by its own `electron/tsconfig.json` to `dist/electron/`):
   - `database.ts` (~2100 lines) — ALL SQLite logic: schema creation, additive column migrations (`migrate*()` functions run at init), bcrypt auth, sessions, folder permissions, security codes, annual closing/backups. Also contains an in-memory fallback store used if better-sqlite3 fails to load. DB lives at `%APPDATA%/bonyan-archive-system/archive.db` (Windows) or `~/.config/bonyan-archive-system/archive.db` (Linux).
   - `main.ts` — registers the custom `app://` protocol (serves the built Angular bundle; required because `file://` breaks packaged builds — production is built with `--base-href app://-/`), creates windows, and defines every `ipcMain.handle` channel.
   - `preload.ts` — the single security boundary. Exposes `window.electronAPI` via contextBridge, grouped into namespaced sub-APIs (`userAPI`, `documentAPI`, `documentTypeAPI`, `folderCategoryAPI`, `securityAPI`, `passwordResetAPI`, `annualClosingAPI`, `masterListAPI`, `auditAPI`). Never expose raw ipcRenderer.

2. **Angular renderer** (`src/app/`): standalone components, Angular Material + Tailwind, hash routing (`withHashLocation()` — required for the `app://` protocol). Services in `src/app/services/` wrap `window.electronAPI` calls and unwrap `{ success, error }` result objects into thrown Errors; components never touch `electronAPI` directly.

**Adding a new IPC feature touches four places**: handler in `electron/main.ts` (logic usually in `electron/database.ts`) → exposure in `electron/preload.ts` → type declaration in `src/types/electron.d.ts` → wrapper in an Angular service.

### Routing and access control

`src/app/app.routes.ts`: `/login` → `/main` (AppShellComponent with child routes). Guards in `src/app/guards/`: `authGuard` (session), `adminGuard` (admin-only screens: users, document types, folder categories, security center, master lists, annual closing), `permissionGuard` (fine-grained, via `data: { permission: '...' }`). `hasPermission` directive handles in-template permission checks.

### Domain concepts

- **Roles**: admin (مدير) / editor (محرر) / viewer (مشاهد), plus per-user per-folder permissions (view/create/edit/delete).
- **Confidentiality levels** on documents: normal (عادي) / secret (سري, requires password re-entry) / top-secret (سري للغاية, requires password + 6-digit code generated in the Security Center, stored hashed). Access attempts are audit-logged.
- **Document types** are dynamic DB rows (system types: صادر/وارد/مراسلات are protected), each with a reference-number prefix; `getNextRef` generates sequential refs per type+folder.
- **Annual closing**: closes a year, archives its documents separately, and writes a full DB backup to `backups/`.
- **Audit log**: most mutations write audit entries via `addAudit`/`auditAPI`.

### Conventions

- DB schema changes must be additive migrations in `electron/database.ts` (new `migrate*()` function called from init) — existing installs upgrade in place; never assume a fresh DB.
- UI is RTL (`<html dir="rtl" lang="ar">`), Tajawal font. Keep new UI RTL-correct and Arabic-labeled.
- Commits follow conventional-commit style with scope, e.g. `fix(footer): ...`, `feat(security): ...`; release bumps update `package.json` version.
>>>>>>> 3b3136ae18bc5ea33852723c975be1b023f7b2f0
