# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

نظام الأرشيف الإلكتروني (Bonyan Archive System) — an offline-first Electron + Angular desktop app for مركز البنيان (Misrata, Libya) managing a document archive: seeded classification folders, dynamic document types, three-tier confidentiality (عادي/سري/سري للغاية), an org-unit-scoped role hierarchy, audit trail, and annual closing. Single-tenant, no network dependency, no backend server — SQLite is the only datastore. Proprietary license; all UI text, error messages, and audit log actions are Arabic throughout, RTL layout (`<html dir="rtl" lang="ar">`, Tajawal font) — code identifiers and comments are English.

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

There is no `ng serve` dev loop — the app depends on Electron's IPC/DB layer, so `bun run start` (full rebuild + relaunch) is the actual iteration cycle. There is no lint configuration. CI (`.github/workflows/ci.yml`) builds Windows/Linux artifacts on every push.

Default login: `admin` / `admin123` — seeded **once** on first `initDb()` when the `users` table is empty, and never reset afterwards: once the GM changes the password, `admin123` stops working (see `DEBUG.md` for login troubleshooting). DB lives at `%APPDATA%/bonyan-archive-system/archive.db` (Windows) or `~/.config/bonyan-archive-system/archive.db` (Linux).

## Architecture

Three layers, split across two separate TypeScript compilations (`tsconfig.app.json` for Angular, `electron/tsconfig.json` for Electron — **not one project**, so types/constants are not shared between them):

- **`electron/main.ts`** — Electron main process. Registers a privileged `app://` protocol that serves the built Angular bundle directly (avoids `file://` relative-path breakage in packaged builds; paired with `withHashLocation()` in `app.config.ts`). Owns ~90 `ipcMain.handle()` channels, almost all following the same shape: `activeUser()` → `hasMinRole(user, [minRole])` → do the work → `addAudit(...)`. Document channels additionally check `canAccessConfidentiality(...)` and `canTouchDocument(...)` (org-unit scoping) per row. The logged-in user lives in a **module-level variable in the main process**, not in renderer state — the renderer's `AuthService.currentUser` signal is only ever a mirror of what `auth:getCurrentUser` returns.
- **`electron/preload.ts`** — `contextBridge.exposeInMainWorld('electronAPI', …)`. Pure passthrough (`ipcRenderer.invoke`), no logic — the single security boundary between renderer and main. The full shape is typed in `src/types/electron.d.ts` — treat that file as the authoritative IPC contract when adding a channel; update both ends together. Never expose raw `ipcRenderer`.
- **`electron/database.ts`** — single ~2,100-line module: schema DDL, idempotent migration functions (re-run on every `initDb()`, guarded by `PRAGMA table_info` checks / try-catch on `ALTER TABLE` — schema changes must be additive; never assume a fresh DB), seed data, and exported CRUD functions. `better-sqlite3` is synchronous. **A parallel in-memory fallback store** (`memoryStore`, plain TS interfaces) activates if the native module fails to load — every exported function branches on `useMemoryFallback`; coverage is incomplete (annual closing, import, and raw `query()`/`run()` all explicitly error out in fallback mode). Foreign keys are declared in the schema but `PRAGMA foreign_keys` is never enabled, so `ON DELETE CASCADE` is not actually enforced.
- **`src/app/`** — Angular 17, standalone components only (no NgModules), functional route guards, `HashLocationStrategy`, Angular Material + Tailwind. No store library — state is Angular **signals** on `providedIn: 'root'` services (`AuthService.currentUser` is the load-bearing one). Services wrap `window.electronAPI` calls and unwrap `{ success, error }` result objects into thrown Errors; components never touch `electronAPI` directly. Authorization is checked in three independent places that all read the same permissions derived from that signal: `permissionGuard`/`adminGuard` (routes, via `src/app/app.routes.ts` `data: { permission: '...' }`), `HasPermissionDirective`/`*appHasPermission` (templates), and ad hoc `auth.isAdmin()`/`auth.can()` calls. **None of these are a real security boundary** — the actual enforcement is the per-channel checks in `main.ts`. Two IPC channels, `db:query` and `db:run`, are generic raw-SQL passthroughs; `db:query` has no permission check at all, so prefer adding a dedicated typed channel over reaching for it when building new features that read data.

**Adding a new IPC feature touches four places**: handler in `electron/main.ts` (logic usually in `electron/database.ts`) → exposure in `electron/preload.ts` → type declaration in `src/types/electron.d.ts` → wrapper in an Angular service.

### Domain concepts

- **Roles** (`UserRole` in `src/app/models/user.model.ts`): `general_manager` > `deputy_manager` > `dept_head`/`section_head` (same level) > `employee`, hierarchical via `ROLE_HIERARCHY`/`hasRole()`. Implemented a second time with no shared source in `electron/main.ts` (`ROLE_LEVEL`/`hasMinRole()`) — keep both in sync by hand if the hierarchy ever changes. Users additionally belong to an **org unit** (`org_units` table: `administration`/`section`, tree via `parent_id`); `dept_head`/`section_head` are scoped to their own org-unit subtree (`isUserInSubtree`) for document create/edit/delete, `employee` to their own org unit only, `deputy_manager`+ see everything.
- **Confidentiality levels** on documents: normal (عادي) / secret (سري, requires password re-entry) / top-secret (سري للغاية, requires password + 6-digit code generated in the Security Center, stored hashed). Access attempts are audit-logged.
- **Document types** are dynamic DB rows (system types: صادر/وارد/مراسلات are protected) with a `prefix` column that is now legacy/unused for numbering — see reference numbers below.
- **Reference number format**: `م.ب/{sequenceNumber}/{classificationNumber}`, e.g. `م.ب/1/105`, `م.ب/2/105`, `م.ب/3/150`. `classificationNumber` is the folder/classification id (`documents.folder_id`). `sequenceNumber` comes from the `archive_sequences` table (one row per calendar year, `last_number` only ever increments — never derived from `COUNT(*)`, so a deleted document's number is never reused). Allocation (`getNextArchiveSequenceNumber` in `database.ts`) runs inside a `better-sqlite3` transaction with a `UNIQUE(year)` upsert, so it can't hand out the same number twice. The ref number is generated **server-side, at the moment `document:create` runs** (`generateArchiveRefNumber`) — the client never pre-fetches or supplies one; `DocumentFormComponent` shows a `م.ب/؟/{folder_id}` placeholder until save. The legacy `counters` table (old `{PREFIX}-{FOLDER_ID:3}-{YEAR}-{COUNTER:4}` scheme, still readable on documents created before this system) is no longer written to.
- **Annual closing** (`closeYear()`): copies the whole SQLite file to a timestamped backup in `backups/`, then moves that year's rows into a dynamically created `archived_documents_<year>` table and deletes them from `documents` — irreversible from within the app.
- **Audit log**: most mutations write audit entries via `addAudit`/`auditAPI`.

### Conventions

- UI is RTL and Arabic-labeled — match that when adding new user-facing text or IPC error messages.
- Commits follow conventional-commit style with scope, e.g. `fix(footer): ...`, `feat(security): ...`; release bumps update `package.json` version.
