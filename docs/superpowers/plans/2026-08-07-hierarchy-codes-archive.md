# Bonyan Archive — Per-User Security Codes, Closed-Year Access, Administrative Hierarchy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three features: (1) security codes bound to individual users, single-use; (2) read-only browser for closed-year archived documents; (3) 5-role administrative hierarchy with org-unit tree (إدارات/أقسام) and subtree-scoped visibility + password authority.

**Architecture:** All enforcement moves to the Electron main process (current confidentiality gate is renderer-only — a real vulnerability). Every feature follows the repo's 4-place IPC pattern: `electron/main.ts` handler → logic in `electron/database.ts` → `electron/preload.ts` exposure → `src/types/electron.d.ts` → Angular service wrapper. DB changes are idempotent migrations run at init; users table requires a rebuild (CHECK constraint on `role` cannot be altered in SQLite).

**Tech Stack:** Electron 30, Angular 17 standalone + Signals, better-sqlite3, bcryptjs, Angular Material + Tailwind, Arabic RTL UI.

**Build order:** Phase 0 (bug fixes) → Feature 3 (hierarchy — rewrites every permission gate) → Feature 1 (codes) → Feature 2 (archive browser). Features 1/2 depend on F3's new role gates; F2 depends on F1's scope-keyed verification.

## Context

- **Feature 1 problem:** `system_verification_codes` holds ONE global code, stored in PLAINTEXT beside an unsalted sha256, generated with `Math.random()`, reusable unlimited times for 24h. `security:verifyCode` IPC has NO auth check, no rate limit, no audit (database.ts:1501-1554, main.ts:963-969). Any user knowing the code opens any top-secret document. Also: `security:verifyPassword` (main.ts:971) is an unauthenticated password oracle accepting arbitrary usernames; expiry renders as 1970 (seconds treated as ms); JSON export round-trips plaintext codes.
- **Feature 2 problem:** `closeYear` MOVES rows into per-year tables `archived_documents_<year>` (attachments/signatures preserved byte-for-byte), deletes them from live `documents`. But zero read path exists — "view" is a `window.alert` with count + 5 ref numbers (annual-closing.component.ts:91-96). Data intact, inaccessible.
- **Feature 3 problem:** flat 3-role model (`admin`/`editor`/`viewer`), no org structure, no scoping. `folders.group_name` is flat grouping, not hierarchy. `documents.created_by` is TEXT username.
- **Also fixing en route:** `db:query` is an unauthenticated raw-SQL SELECT channel (main.ts:237); `audit:clearAll` gate; renderer-only confidentiality gate (main serves top-secret bodies unchecked).

## User-confirmed decisions

1. Old roles REPLACED: first admin → `general_manager`, extra admins → `deputy_manager`, editor/viewer → `employee`.
2. Documents tagged `org_unit_id` at creation (default = creator's unit); visibility = document's unit within viewer's subtree; employee additionally restricted to own-created docs.
3. Codes: per-user, single-use, issued by GM/deputy in Security Center, 24h expiry, revocable.
4. Archive access: read-only browser for GM/deputy; confidentiality gates still apply; no restore-to-live.
5. Deputy: all GM powers EXCEPT touching GM account (edit/delete/reset). Deputy changes own password normally.
6. Password-reset authority subtree-scoped: section_head → employees in section+children; dept_head → his administration; deputy/GM → anyone (deputy excluded from GM).
7. Write rights: everyone creates (employee in own unit, edits own docs); heads create+edit within subtree; GM/deputy full.
8. Employee KEEPS self password change (current-password required); superiors additionally reset subtree-scoped.

## Flagged assumptions (approved via plan review)

- **Confidentiality ladder:** عادي = everyone (within visibility scope); سري = section_head+; سري للغاية = dept_head+; a document's CREATOR always passes its confidentiality check (else employee creating a سري doc instantly loses access). Security modal (password / password+code) still fires on top.
- **GM uniqueness:** enforced — exactly one active `general_manager`.
- **Legacy docs (`org_unit_id NULL`):** visible to GM/deputy and creator only, until units assigned.
- **`user_folder_permissions`:** kept as-is (dormant secondary layer, working UI, near-zero enforcement today). Org-unit scoping is the authoritative gate. Note added to folder-permissions screen copy.

## Global Constraints

- Package manager: **Bun**. Dev loop: `bun run start` (full prod build + Electron; no watch mode).
- All migrations idempotent + additive; existing installs upgrade in place. Users-table rebuild guarded by `sqlite_master.sql` check + pre-migration file backup.
- Memory-fallback store branches in database.ts must be updated in lockstep for every touched function.
- All UI text Arabic, RTL. Code identifiers/comments English.
- Conventional commits with scope (`feat(security): ...`).
- No plaintext secrets at rest: codes bcrypt-hashed, shown exactly once at generation.
- `PRAGMA foreign_keys` is OFF in this app — table-rename rebuild is safe for FK references.

---

## Phase 0 — Standalone security/bug fixes (no schema changes)

**Files:** Modify `electron/main.ts`, `electron/database.ts`, `src/app/components/security-center/security-center.component.ts`, `src/app/services/security.service.ts`

- [ ] **0.1** Fix 1970 expiry: `formatExpiry` in security-center.component.ts:103-112 → `new Date(timestamp * 1000)`.
- [ ] **0.2** Strip `system_verification_codes` from `exportData()` (database.ts:1914-1946, both SQLite + memory paths); `importData` ignores the key in old backups.
- [ ] **0.3** Gate `db:query` (main.ts:237): require `activeUser()`. First grep renderer callers of `dbQuery` (database.service.ts wraps it — dashboard stats, audit list use it); anything a non-admin screen needs stays allowed for logged-in users at this phase, tightened per-query later in F3 (documentScope). Minimum now: reject unauthenticated.
- [ ] **0.4** Kill password oracle: `security:verifyPassword` requires `activeUser()`, verifies ONLY session user's password (validate `username === user.username` or ignore param). Renderer `SecurityService.verifyPassword` passes current user.
- [ ] **0.5** Gate `audit:clearAll` (currently ungated) → admin.
- [ ] **0.6** Verify: `bun run build:prod` compiles; `bun run start`, login, dashboard stats load, security-center expiry shows real date. Commit `fix(security): gate raw SQL/audit channels, session-bind password verify, fix expiry render`.

---

## Feature 3 — Administrative hierarchy (build FIRST)

### Task 3.1: DB — org_units table, role migration, subtree helpers

**Files:** Modify `electron/database.ts`

**Produces (later tasks rely on):** `OrgUnit`, `OrgUnitInput` interfaces; `getOrgUnits(activeOnly?)`, `createOrgUnit(input, createdBy?)`, `updateOrgUnit(id, input)`, `deleteOrgUnit(id)`, `getOrgUnitSubtreeIds(rootId): number[]`, `isUserInSubtree(actorUnitId, targetUnitId)`; users table with 5-role CHECK + `org_unit_id`; `documents.org_unit_id` column; `AuthUser.org_unit_id`.

- [ ] **Step 1:** Add to initDb DDL block:
```sql
CREATE TABLE IF NOT EXISTS org_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK(unit_type IN ('administration','section')),
  parent_id INTEGER REFERENCES org_units(id),
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);
```
Invariants in code (not SQL): administration ⇒ parent NULL; section ⇒ parent NOT NULL + parent active; cycle check on update (walk ancestors); unique `(parent_id, name)` checked in create/update (NULL parents distinct in SQLite UNIQUE).

- [ ] **Step 2:** `migrateRolesV2()` — idempotent users-table rebuild. Guard: skip if `sqlite_master.sql` for users already contains `general_manager`. Before rebuild: `fs.copyFileSync(dbPath, userData/archive_pre_roles_v2_<ts>.db)`. Then:
```sql
CREATE TABLE users_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'employee'
    CHECK(role IN ('general_manager','deputy_manager','dept_head','section_head','employee')),
  org_unit_id INTEGER REFERENCES org_units(id),
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);
INSERT INTO users_v2 (id, username, password_hash, full_name, role, org_unit_id, is_active, created_at, updated_at)
SELECT id, username, password_hash, full_name,
  CASE
    WHEN role = 'admin' AND id = (SELECT MIN(id) FROM users WHERE role = 'admin') THEN 'general_manager'
    WHEN role = 'admin' THEN 'deputy_manager'
    ELSE 'employee'
  END,
  NULL, is_active, created_at, updated_at
FROM users;
DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;
```
Call order in initDb: `migrateUsersTable(); migrateRoles(); migrateRolesV2(); seedAdmin(); ... migrateDocumentsOrgUnit();`

- [ ] **Step 3:** `migrateDocumentsOrgUnit()` — PRAGMA-guarded `ALTER TABLE documents ADD COLUMN org_unit_id INTEGER` + index `idx_documents_org_unit`. NULL = legacy.

- [ ] **Step 4:** Update `seedAdmin()` (database.ts:670-720): seed/repair role `'general_manager'`, full_name `'المدير العام'`. (Leave existing password-reset-every-boot behavior as-is — pre-existing, out of scope.)

- [ ] **Step 5:** CRUD + subtree helpers:
```ts
export function getOrgUnitSubtreeIds(rootId: number): number[] {
  // WITH RECURSIVE subtree(id) AS (
  //   SELECT id FROM org_units WHERE id = ?
  //   UNION ALL SELECT o.id FROM org_units o JOIN subtree s ON o.parent_id = s.id
  // ) SELECT id FROM subtree
  // deliberately includes inactive units (docs in deactivated section must not vanish)
}
export function isUserInSubtree(actorUnitId: number, targetUnitId: number | null): boolean;
```
`deleteOrgUnit` refuses when subtree has child units / assigned users / documents — errors: `'لا يمكن حذف الوحدة لوجود وحدات فرعية تابعة لها'` / `'...مستخدمين مرتبطين بها'` / `'...وثائق مرتبطة بها'`. Deactivate is the alternative.

- [ ] **Step 6:** Widen `UserInput.role` union; add `org_unit_id` to `createUser`/`updateUser` and every user SELECT (`authenticateUser`, `getUsers`, `getUserById`, `getUserByUsername` → `AuthUser.org_unit_id: number | null`). GM uniqueness in create/update: if role `general_manager` and another exists → `'يوجد مدير عام واحد فقط في النظام'`. `deleteUser` last-admin check becomes GM guard: `'لا يمكن حذف حساب المدير العام'`. **Username rename in `updateUser`: propagate `UPDATE documents SET created_by = ? WHERE created_by = ?` in same transaction** (visibility depends on created_by).

- [ ] **Step 7:** Update memory-fallback store: role values, `org_unit_id` field, org_units array + CRUD mirrors.

- [ ] **Step 8:** Verify: `bun run start` against a COPY of an existing archive.db — migration runs once, second boot skips (idempotency), admin logs in as GM. Commit `feat(hierarchy): org_units table, 5-role migration, subtree helpers`.

### Task 3.2: main.ts — gate remap, documentScope, org-unit IPC

**Files:** Modify `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`

**Consumes:** Task 3.1 helpers. **Produces:** `hasMinRole(user, min)`, `documentScope(user)`, `canAccessConfidentiality(user, conf, docCreatedBy?)`, `canAdministerUser(actor, target)`, `canResetPasswordOf(actor, target)`, `orgUnit:*` channels, `orgUnitAPI` in preload/d.ts.

- [ ] **Step 1:** Replace ROLE_LEVEL/hasPermission (main.ts:143-153):
```ts
const ROLE_LEVEL: Record<string, number> = {
  employee: 1, section_head: 2, dept_head: 3, deputy_manager: 4, general_manager: 5
};
function hasMinRole(user: AuthUser | null, min: Role): boolean {
  return !!user && (ROLE_LEVEL[user.role] ?? 0) >= ROLE_LEVEL[min];
}
```

- [ ] **Step 2:** Grep-driven remap of EVERY `hasPermission(` call site (~35):

| Handlers | New gate |
|---|---|
| user:* CRUD, folder-permissions, documentType:*/folderCategory:*/masterList:* mutations, security-center channels, db:import/export, annualClosing:* | `deputy_manager` |
| audit:clearAll | `general_manager` |
| db:run | `deputy_manager` (raw SQL) |
| db:query | logged-in (Phase 0) — leave |
| document:create, db:getNextRef | any logged-in (`employee`+) |
| document:update/delete | logged-in + `canTouchDocument` (Step 4) |
| annualClosing:closeYear | `general_manager` |

- [ ] **Step 3:** GM protection + password authority:
```ts
function canAdministerUser(actor: AuthUser, target: AuthUser): boolean {
  if (actor.role === 'general_manager') return true;
  if (actor.role === 'deputy_manager') return target.role !== 'general_manager';
  return false;
}
function canResetPasswordOf(actor: AuthUser, target: AuthUser): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'general_manager') return true;
  if (actor.role === 'deputy_manager') return target.role !== 'general_manager';
  if (actor.role === 'dept_head' || actor.role === 'section_head') {
    if ((ROLE_LEVEL[target.role] ?? 0) >= ROLE_LEVEL[actor.role]) return false;
    return actor.org_unit_id != null && isUserInSubtree(actor.org_unit_id, target.org_unit_id);
  }
  return false;
}
```
Apply `canAdministerUser` to user:update/delete/toggleStatus (denial `'لا يمكن تعديل حساب المدير العام'`). `passwordReset:adminReset`/`approve`: gate drops to `section_head`+ then `canResetPasswordOf`. `passwordReset:getPending`: heads see only requests passing `canResetPasswordOf`; deputy list excludes GM. `changeOwnPassword` unchanged (all roles).

- [ ] **Step 4:** Visibility:
```ts
function documentScope(user: AuthUser): { where: string; params: unknown[] } {
  if (ROLE_LEVEL[user.role] >= ROLE_LEVEL['deputy_manager']) return { where: '', params: [] };
  if (user.role === 'dept_head' || user.role === 'section_head') {
    const ids = user.org_unit_id != null ? getOrgUnitSubtreeIds(user.org_unit_id) : [];
    const inClause = ids.length ? `d.org_unit_id IN (${ids.map(() => '?').join(',')}) OR ` : '';
    return { where: `(${inClause}d.created_by = ?)`, params: [...ids, user.username] };
  }
  return { where: 'd.created_by = ?', params: [user.username] };
}
```
Apply to `document:getAll` (drop old viewer filter at main.ts:781-783). `document:getById/update/delete`: fetch row then `canTouchDocument` (GM/deputy always; head ⇒ unit in subtree OR own created_by; employee ⇒ created_by match) — denial `'ليس لديك صلاحية الوصول لهذه الوثيقة'`. `document:create`: `org_unit_id = doc.org_unit_id ?? user.org_unit_id ?? null`; heads may target only subtree units, employees own unit, GM/deputy anywhere; add column to INSERT (+ update SET for head+).

- [ ] **Step 5:** Confidentiality matrix (replace main.ts:169-174):
```ts
function canAccessConfidentiality(user: AuthUser, conf: string, docCreatedBy?: string): boolean {
  if (conf === 'عادي') return true;
  if (docCreatedBy && docCreatedBy === user.username) return true;
  if (conf === 'سري') return ROLE_LEVEL[user.role] >= ROLE_LEVEL['section_head'];
  if (conf === 'سري للغاية') return ROLE_LEVEL[user.role] >= ROLE_LEVEL['dept_head'];
  return false;
}
```
Filter rows failing this out of `document:getAll` results.

- [ ] **Step 6:** New IPC + preload + d.ts (mirror folderCategoryAPI shape):
```
orgUnit:getAll(activeOnly?) → { success, units?: OrgUnit[] }   [logged-in]
orgUnit:create(data)        → { success, id? }   [deputy+, audit 'إنشاء وحدة تنظيمية']
orgUnit:update(id, data)    → { success }        [deputy+, audit 'تعديل وحدة تنظيمية']
orgUnit:delete(id)          → { success }        [deputy+, audit 'حذف وحدة تنظيمية']
```
d.ts: `orgUnitAPI` block; `User.org_unit_id?: number | null`.

- [ ] **Step 7:** Verify: build; login as GM; create units; create employee assigned to unit; employee login sees only own docs; head sees subtree. Commit `feat(hierarchy): role gates, document scoping, org-unit IPC`.

### Task 3.3: Renderer — models, org-unit management UI, role matrix

**Files:** Modify `src/app/models/user.model.ts`, `src/app/services/auth.service.ts`, user-management, document-form, app-shell, header, `src/app/app.routes.ts`. Create `src/app/models/org-unit.model.ts`, `src/app/services/org-unit.service.ts`, `src/app/components/org-unit-management/`.

**Consumes:** `orgUnitAPI`. **Produces:** `UserRole` 5-union, `getRolePermissions` matrix incl. `canManageOrgUnits`/`canBrowseArchive`, `OrgUnitService.getAll/getTree/create/update/delete`, `buildOrgTree(units): OrgUnitNode[]`.

- [ ] **Step 1:** user.model.ts:
```ts
export type UserRole = 'general_manager' | 'deputy_manager' | 'dept_head' | 'section_head' | 'employee';
export const ROLE_LABELS: Record<UserRole, string> = {
  general_manager: 'المدير العام', deputy_manager: 'نائب المدير العام',
  dept_head: 'رئيس إدارة', section_head: 'رئيس قسم', employee: 'موظف'
};
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  employee: 1, section_head: 2, dept_head: 3, deputy_manager: 4, general_manager: 5
};
```
`RolePermissions` += `canManageOrgUnits: boolean; canBrowseArchive: boolean;`. Matrix: GM/deputy all true; dept_head/section_head → canCreate/Edit/DeleteDocument + canViewAudit true, management flags false; employee → canCreateDocument only. `User.org_unit_id?: number | null`.

- [ ] **Step 2:** auth.service.ts: `isAdmin()` → `role === 'general_manager' || role === 'deputy_manager'` (keeps adminGuard + all `auth.isAdmin()` call sites meaning "admin tier" — zero rename churn).

- [ ] **Step 3:** org-unit.model.ts: `OrgUnit`, `OrgUnitInput`, `OrgUnitNode { children: OrgUnitNode[] }`, `UNIT_TYPE_LABELS = { administration: 'إدارة', section: 'قسم' }`, `buildOrgTree(units: OrgUnit[]): OrgUnitNode[]` (map by id, attach children, roots = parent NULL). org-unit.service.ts: thin wrapper like folder-category.service.ts + `getTree()`.

- [ ] **Step 4:** org-unit-management component (route `/main/org-units`, `adminGuard`; title `'الهيكل التنظيمي'`): recursive tree (nested `@for` template or small recursive child component); top button `'إضافة إدارة'`; per-node actions `'إضافة قسم فرعي'` / `'تعديل'` / `'تعطيل'`/`'تفعيل'` / `'حذف'`; dialog fields `'الاسم'`, `'النوع'`, `'الوحدة الأم'`. Surface server errors (toast).

- [ ] **Step 5:** user-management: role dropdown from new ROLE_LABELS; org-unit select `'الوحدة التنظيمية'` (depth-indented options + `'بدون وحدة'`); 5-role count chips; hide destructive actions on GM row for deputy (server enforces anyway).

- [ ] **Step 6:** document-form: org-unit select for section_head+ defaulting to own unit; employees no control (server stamps). Warn heads on empty: `'لم يتم تحديد وحدة — ستظهر الوثيقة للمدير العام ونائبه فقط'`.

- [ ] **Step 7:** Nav + routes: app-shell item `'الهيكل التنظيمي'` (icon `account_tree`) under `*appHasPermission="'canManageOrgUnits'"`; breadcrumb for `/org-units`; route entry with adminGuard.

- [ ] **Step 8:** Verify full role matrix manually: 5 users across 2-level tree; per-role check grid contents, nav items, user-management access, password reset scoping, deputy-vs-GM denials. Commit `feat(hierarchy): org-unit management UI, 5-role permission matrix`.

---

## Feature 1 — Per-user single-use security codes (build SECOND)

### Task 1.1: DB + main.ts — code lifecycle, rate limit, main-enforced gate

**Files:** Modify `electron/database.ts`, `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`

**Produces:** `user_verification_codes` table; `generateUserCode`, `listUserCodes`, `revokeUserCode`, `verifyAndConsumeUserCode`; channels `security:listCodes/generateCode(targetUserId)/revokeCode(codeId)/verifyCode(code, documentId?, scope?)`; `verifiedTopSecret: Set<string>` main-process gate; `UserCodeEntry` shape.

- [ ] **Step 1:** Schema (new migration or DDL block):
```sql
CREATE TABLE IF NOT EXISTS user_verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','used','revoked')),
  generated_by INTEGER,
  generated_at INTEGER DEFAULT (strftime('%s','now')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_document_id INTEGER,
  revoked_by INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_uvc_user_status ON user_verification_codes(user_id, status);
```
`expired` = computed (`status='active' AND expires_at <= now`), never stored. Old `system_verification_codes` table left as dead data; DELETE functions `getCurrentVerificationCode`/`generateVerificationCode`/`verifySystemCode` + their imports (main.ts:115-117).

- [ ] **Step 2:** database.ts functions — `generateUserCode(targetUserId, issuedBy)`: `crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')`, `bcrypt.hashSync(code, 10)`; tx revokes prior active code for that user (one active per user), inserts new, `expires_at = now + 86400`; returns plaintext ONCE. `listUserCodes()`: join users for username/full_name/generated_by_name, computed status, ORDER BY generated_at DESC LIMIT 200. `revokeUserCode(codeId, revokedBy)`. `verifyAndConsumeUserCode(userId, code, documentId?)`: select single active unexpired row for user, `bcrypt.compareSync`, on match tx-update to `used` (guard `AND status='active'`); error `'الرمز غير صحيح أو منتهي الصلاحية'`. Memory-fallback mirrors.

- [ ] **Step 3:** main.ts handlers: `security:listCodes`/`generateCode(targetUserId)`/`revokeCode(codeId)` gated `deputy_manager`, audited (`'توليد رمز تحقق'` + `للمستخدم: <username>`, `'إلغاء رمز تحقق'`). `security:verifyCode(code, documentId?, scope?='live')`: requires session user; per-user in-memory rate limiter (5 failures/15 min → 15-min lock, message `'تم تأمين التحقق مؤقتاً، حاول بعد ... دقائق'`); audits success `'تحقق رمز سري ناجح'` / failure `'محاولة تحقق رمز فاشلة'`; on success adds `\`${scope}:${documentId}\`` to `verifiedTopSecret`.

- [ ] **Step 4:** Main-enforced confidentiality strip:
```ts
const verifiedTopSecret = new Set<string>();  // 'live:<id>' | 'archive:<year>:<id>'; cleared on auth:logout
```
`document:getById`: سري للغاية + not verified → strip `body`, `attachments_json` (→`'[]'`), `signature_base64`, add `locked: true`. `document:getAll`: strip heavy fields for all سري للغاية rows; add `json_array_length(COALESCE(attachments_json,'[]')) AS attachments_count` to SELECT so document-card keeps showing counts. `security:verifyPassword(password, documentId?, scope?)`: session-bound (Phase 0), successful verify with documentId also inserts scope key (makes سري main-enforced too). Renderer re-fetches via getById after modal success.

- [ ] **Step 5:** preload + d.ts: new securityAPI surface `{ listCodes, generateCode(targetUserId), revokeCode(codeId), verifyCode(code, documentId?, scope?), verifyPassword(password, documentId?, scope?), logAccess }`.

- [ ] **Step 6:** Verify: issue code for user B as GM; B unlocks top-secret doc once; second use fails; expiry/revoke fail; rate limit locks after 5 bad tries; DevTools `document:getById` on locked doc returns stripped row. Commit `feat(security): per-user single-use verification codes, main-process confidentiality gate`.

### Task 1.2: Renderer — Security Center rework, session-bound modal

**Files:** Modify `src/app/models/security.model.ts`, `src/app/services/security.service.ts`, `src/app/services/document-access.service.ts`, security-center component, security-modal component.

**Consumes:** Task 1.1 API. **Produces:** `DocumentAccessService.verifyAccess(doc, action, scope?)` with `Set<string>` cache keyed `` `${scope}:${doc.id}` `` (scope `'live'` default) — Feature 2 relies on this.

- [ ] **Step 1:** security.model.ts: `UserCodeEntry` + `CODE_STATUS_LABELS = { active: 'فعال', used: 'مستخدم', revoked: 'ملغي', expired: 'منتهي' }`. security.service.ts: `listCodes()`, `generateCode(userId)`, `revokeCode(id)`, `verifyCode(code, documentId?, scope?)`, `verifyPassword(password, documentId?, scope?)`.

- [ ] **Step 2:** security-center rework: section `'إصدار رمز تحقق'` — user mat-select + `'توليد رمز'` button; success → one-time dialog (big code, copy button, `'احفظ هذا الرمز الآن — لن يتم عرضه مرة أخرى'`, expiry with `* 1000`); DELETE persistent code display + `getCurrentCode`/`copyCurrentCode`. Section `'الرموز الصادرة'`: table `'المستخدم' | 'الحالة' | 'تاريخ الإصدار' | 'تاريخ الانتهاء' | 'أصدره' | 'إجراءات'`; `'إلغاء'` on active rows only; status chips (فعال green / مستخدم gray / ملغي red / منتهي amber). Update instruction copy (per-user, single-use).

- [ ] **Step 3:** security-modal: password step calls `verifyPassword(pwd, this.doc.id, this.data.scope ?? 'live')` (no username); code step hint `'أدخل رمز التحقق الخاص بك (يُستخدم مرة واحدة)'`, calls `verifyCode(code, this.doc.id, scope)`; surface server lockout message verbatim.

- [ ] **Step 4:** document-access.service.ts: `verifiedDocs: Set<string>`; `verifyAccess(doc, accessType, scope: string = 'live')` key `` `${scope}:${doc.id}` ``; pass scope into modal `data`. Call sites (document-grid.component.ts:227/:237, document-view.component.ts:55) default scope — no change needed beyond signature.

- [ ] **Step 5:** Verify full flow in app: normal→no modal; سري→password; سري للغاية→password+personal code, consumed; re-open same doc same session→cached; logout→cache cleared. Commit `feat(security): security-center per-user code UI, scoped access cache`.

---

## Feature 2 — Closed-year read-only archive browser (build THIRD)

### Task 2.1: DB + main.ts — safe archive read path

**Files:** Modify `electron/database.ts`, `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`

**Produces:** `getArchivedDocuments(year)` (list, heavy fields excluded), `getArchivedDocumentById(year, id)` (full row), channel `annualClosing:getArchivedDocumentById(year, id)`.

- [ ] **Step 1:** `assertArchivedYear(year)`: integer check + row must exist in `archived_years` — closes the `${year}` string-interpolation hole (table name only ever built from validated registered integer).

- [ ] **Step 2:** Rewrite `getArchivedDocuments(year)`: explicit column list (NO body/attachments/signature), `json_array_length(COALESCE(d.attachments_json,'[]')) AS attachments_count`, LEFT JOIN document_types for type/label/color/icon, PRAGMA-guard `org_unit_id` (`NULL AS org_unit_id` for pre-hierarchy year tables — they're frozen column snapshots). New `getArchivedDocumentById(year, id)`: full row, same guards.

- [ ] **Step 3:** main.ts: `annualClosing:*` gates → `deputy_manager` (closeYear → `general_manager`, done in 3.2). New `annualClosing:getArchivedDocumentById(year, id)` gated `deputy_manager`: apply same top-secret strip using key `` `archive:${year}:${id}` `` in `verifiedTopSecret`. preload/d.ts: add to annualClosingAPI.

- [ ] **Step 4:** Verify: close a test year (copy DB), fetch list via DevTools, confirm no body/attachments in list payload, getById returns full unless top-secret+unverified. Commit `feat(archive): validated read path for closed-year documents`.

### Task 2.2: Renderer — archive browser

**Files:** Modify `src/app/services/annual-closing.service.ts`, annual-closing component, app-shell (breadcrumb), `src/app/app.routes.ts`, document-view component (scope pass-through). Create `src/app/components/archive-browser/`.

**Consumes:** Task 2.1 API + Task 1.2 scoped `verifyAccess`.

- [ ] **Step 1:** annual-closing.service.ts: type `getArchivedDocuments(year): Promise<ArchiveDocument[]>`; add `getArchivedDocumentById(year, id)`.

- [ ] **Step 2:** ArchiveBrowserComponent, route `{ path: 'annual-closing/:year', component: ArchiveBrowserComponent, canActivate: [adminGuard] }`:
  - Header `'أرشيف سنة {{year}}'`; persistent banner icon `lock`: `'وضع القراءة فقط — لا يمكن تعديل وثائق السنوات المغلقة'`; back button `'العودة إلى الجرد السنوي'`.
  - Search `'بحث بالرقم المرجعي أو الموضوع أو المرسل أو المستلم'` + type/confidentiality filters — copy signal-based client-side filter pattern from document-grid.component.ts.
  - Cards reuse `DocumentCardComponent` with edit/delete outputs unbound (verify its @Output surface at implementation; fallback MatTable).
  - View flow: `documentAccess.verifyAccess(doc, 'view', \`archive:${year}\`)` → `getArchivedDocumentById` → open `DocumentViewComponent` (already read-only: view/print/attachments only) with `data: { doc, folder, scope }`.

- [ ] **Step 3:** document-view: `handlePrint` forwards `this.data.scope ?? 'live'` to `verifyAccess`. Print via existing PrintService unchanged.

- [ ] **Step 4:** annual-closing component: `viewYear(year)` → `router.navigate(['/main/annual-closing', year])` (delete `window.alert`); action label `'تصفح'`. Keep CSV export. Breadcrumb: append `'تصفح الأرشيف'` when URL has year segment.

- [ ] **Step 5:** End-to-end verify: close year → browse → search/filter → open normal + top-secret (code flow fires, archive-scoped key) → print → confirm no edit affordances anywhere. Commit `feat(archive): read-only browser for closed years`.

---

## Verification (full system)

On a COPY of a real `archive.db`:
1. Boot twice — migration idempotent; pre-migration backup file created once.
2. Login matrix: GM, deputy, dept_head, section_head (2-level tree), employee — per role check: document grid contents, nav visibility, user-management/security/org-units access, denials.
3. Deputy: cannot edit/delete/reset GM; can everything else.
4. Password reset: section_head resets own-section employee ✓, other-section employee ✗, own boss ✗.
5. Codes: issue→use once→reuse fails→revoke→expire(manually UPDATE expires_at)→rate-limit lock; audit rows written.
6. Confidentiality: employee creates سري doc — still sees it (creator rule); other employee doesn't; DevTools raw `document:getById` on unverified top-secret returns stripped payload.
7. Archive: close year, browse, open top-secret archived doc (archive-scoped code), print.
8. Legacy DB: pre-hierarchy archived year table opens (PRAGMA guard).
9. `bun run build:prod` clean; JSON export contains no code material.

## Risk notes

- **Highest risk:** users-table rebuild (Task 3.1) on live installs — mitigated by `sqlite_master` idempotency guard + automatic file backup + testing on copied production DB.
- **Wide blast radius:** gate remap (Task 3.2) touches ~35 handler call sites — grep checklist of every `hasPermission(` occurrence before commit.
- **document:getAll strip** changes payload shape for top-secret rows — `attachments_count` shim keeps document-card working; sweep renderer for direct `attachments_json` reads on grid rows.
- JSON export still excludes `archived_documents_*` tables (pre-existing) — noted as future work, out of scope.
