# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

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
