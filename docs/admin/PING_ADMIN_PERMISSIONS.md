# PING Administrator Roles & Granular Permissions Matrix

**Source of Truth:**  
- TypeScript Policy: `src/lib/admin-rbac.ts` & `src/lib/admin-policy.ts`  
- Server Enforcement: `src/lib/admin.functions.ts`  
- Database Enforcement: `drizzle/migrations/0035_admin_control_centre_and_early_access.sql`

---

## 1. Governance Principles

1. **Appointment-Only Access:** Administrative access is never granted automatically by spending DOT, subscribing to Builder Pro, or holding a verification badge.
2. **Server-Side Enforcement Everywhere:** Every TanStack Start server function verifies the caller's JWT and effective permission via `get_my_admin_profile()` before querying or mutating data. Sensitive RPCs (`owner_appoint_admin`, `owner_revoke_admin`, `owner_set_user_permission`, `review_verification_request`) execute under the caller's authenticated JWT so PostgreSQL independently verifies `auth.uid()`.
3. **Zero Self-Escalation:** Ordinary users cannot insert/update `public.user_roles`, `public.admin_appointments`, or `public.admin_user_permissions` (all client write privileges revoked). Even privileged callers cannot appoint, escalate, or self-approve their own account.
4. **No Accidental Admin-to-Admin Delegation:** Ordinary `Administrator` accounts do **not** have `admin.appoint_admins` by default. Only the **Platform Owner** can appoint/revoke admins or explicitly grant `admin.appoint_admins` to a trusted Administrator.
5. **Owner-Exclusive Boundaries:** `admin.revoke_admins` and `admin.manage_permissions` are strictly reserved for `platform_owner` and are blocked from override delegation in both TypeScript and PostgreSQL.

---

## 2. Canonical Role Permission Matrix

| Permission Key | Platform Owner | Administrator | Moderator | Support | Analyst | Finance Admin | Community Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `overview.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `people.view` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| `people.verify` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `content.view` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `content.moderate` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `communities.view` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `communities.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `communications.view_metrics` *(aggregates only)* | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `economy.view` | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `economy.manage_plans` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `economy.moderate_boosts` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `business.view` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| `business.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| `growth.view` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| `learn.manage_schedule` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `system.view_health` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `admin.view_staff` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `admin.view_audit` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `admin.appoint_admins` | ✅ | 🔒 *(Owner override only)* | ❌ | ❌ | ❌ | ❌ | ❌ |
| `admin.revoke_admins` | ✅ | ❌ *(Owner only)* | ❌ | ❌ | ❌ | ❌ | ❌ |
| `admin.manage_permissions` | ✅ | ❌ *(Owner only)* | ❌ | ❌ | ❌ | ❌ | ❌ |

### Legacy Specialist Roles (Migration `0034` Compatibility)
- `spotlight_editor`: Scoped strictly to `/spotlight/editorial` via `is_spotlight_editor()`; receives zero `/admin` financial or user-management permissions.
- `financial_admin`: Maps cleanly to `finance_admin` economy permissions.
- `learn_admin`: Maps cleanly to `overview.view`, `growth.view`, and `learn.manage_schedule`.

---

## 3. Resolution Order for Effective Permissions

When evaluating `has_admin_permission_for_user(user_id, permission)` (and TypeScript `resolveEffectiveAdminPermissions`):

1. If the user holds `platform_owner` → **ALLOW** all permissions.
2. If the user holds **no recognized staff role** in `public.user_roles` → **DENY** unconditionally (even if stray rows exist in `admin_user_permissions`).
3. If `permission` is `admin.revoke_admins` or `admin.manage_permissions` → **DENY** for all non-owners.
4. Check `public.admin_user_permissions` for `(user_id, permission)`:
   - `effect = 'revoke'` → **DENY** (explicit override revokes a role default).
   - `effect = 'grant'` → **ALLOW** (explicit override adds an individual permission).
5. Otherwise check `public.admin_role_permissions` across all active roles held by the user in `public.user_roles`.
6. Default → **DENY**.
