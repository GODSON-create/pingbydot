# PING Admin Control Centre — Operations Runbook

**Project:** Ping by DOT (`GODSON-create/pingbydot`)  
**Route:** `/admin` (excluded from public sitemap & search indexing via `noindex, nofollow`)  
**Database Migration:** `drizzle/migrations/0035_admin_control_centre_and_early_access.sql`  
**Last Updated:** 2026-11-20

---

## 1. Bootstrapping the First Platform Owner (One-Time Privileged SQL)

For security, **no client UI or public API endpoint can grant the `platform_owner` role**. The Platform Owner account must be assigned once by the database owner inside the Supabase SQL Editor (or privileged `psql` session) after applying migrations `0022`–`0035`:

```sql
-- Replace with the verified auth.users.id UUID of the Ping Platform Owner
INSERT INTO public.user_roles (user_id, role)
VALUES ('<PLATFORM_OWNER_AUTH_USER_UUID>'::uuid, 'platform_owner')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.admin_appointments (
  user_id, role, status, appointed_by, appointment_reason
)
VALUES (
  '<PLATFORM_OWNER_AUTH_USER_UUID>'::uuid,
  'platform_owner',
  'active',
  '<PLATFORM_OWNER_AUTH_USER_UUID>'::uuid,
  'Initial Platform Owner governance bootstrap'
);
```

Verify the appointment:

```sql
SELECT ur.user_id, p.username, ur.role, ur.created_at
FROM public.user_roles ur
LEFT JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role = 'platform_owner';
```

---

## 2. The 10 Admin Control Centre Modules

Every module is backed by live PostgreSQL queries through server-verified TanStack Start server functions (`src/lib/admin.functions.ts`). Metrics that depend on unapplied migrations display **`Unavailable`** or **`Pending 0035`** honestly — Ping never invents or estimates numbers.

| # | Module | Primary Data Sources | Key Operational Workflows |
| --- | --- | --- | --- |
| **1** | **Overview** | `admin_control_centre_metrics()` (`profiles`, `user_presence_heartbeats`, `pings`, `moments`, `ping_clips`, `moment_repings`, `share_events`, `hubs`, `signals`, `private_messages` count only, `reports`, `dot_transactions`, `subscription_entitlements`, `boost_campaigns`, `system_error_logs`) | Monitor live account totals, reliable 5-minute online presence, DAU/WAU/MAU, new registrations (24h/7d/30d), content creation volume, and open errors. |
| **2** | **People** | `profiles`, `account_verifications` | Search accounts by handle/display name; inspect new registration velocity; review, approve, reject, or revoke optional Identity and Business verification applications (with optional expiry). |
| **3** | **Content** | `pings`, `reports`, `moments`, `ping_clips`, `moment_repings` | Search published/hidden Pings; hide violating Pings from public discovery (preserving data for audit/appeal) or restore them; resolve open user reports with mandatory reason capture (3–500 chars). |
| **4** | **Communities** | `hubs`, `hub_members`, `signals`, `signal_followers` | Inspect public/private Hubs and membership counts; review and verify or reject institutional Signals. |
| **5** | **Communications** | Aggregate counts from `private_messages` & `system_error_logs` (`category = 'delivery_failure'`) | Monitor total & 24h message delivery throughput and open delivery failures. **Privacy guarantee:** Private message bodies, attachments, and voice notes are NEVER queried or exposed. |
| **6** | **Economy** | `dot_transactions`, `subscription_entitlements`, `membership_plans`, `boost_campaigns` | Configure DOT membership plan prices, durations, and availability (`free`, `plus`, `pro`, `business`); inspect active Boost campaigns; pause or issue audited DOT refunds with mandatory justification. |
| **7** | **Business** | `business_profiles`, `business_enquiries` | Inspect registered business profiles, verification states, storefront links, and total customer enquiries. |
| **8** | **Growth** | `share_events`, `download_attribution_events`, `early_access_registrations`, `course_release_schedules` | Track inbound referral clicks, multi-website `/download` attribution across external sites, privacy-masked early-access tester signups, and configure the Builder Plus Ping Learn periodic course release schedule. |
| **9** | **System Health** | `system_error_logs`, `admin_control_centre_metrics()` | Inspect live database connectivity, open application/API errors, failed background jobs, delivery failures, and remote migration status (`0022`–`0035`). |
| **10** | **Administration** | `user_roles`, `admin_appointments`, `admin_user_permissions`, `moderation_audit` | Appoint administrators (Platform Owner or explicitly delegated `admin.appoint_admins`), revoke access (Platform Owner only), assign/revoke individual permission overrides (Platform Owner only), and review the immutable administrative audit trail. |

---

## 3. Standard Operating Procedures

### Appointing an Administrator
1. Sign in as **Platform Owner** and open `/admin` → **10. Administration** (or find the target user in **2. People** and click **Appoint Role**).
2. Confirm the target account's exact `user_id` UUID (cannot be your own UUID — self-escalation is blocked).
3. Select the minimum necessary role (`Moderator`, `Support`, `Analyst`, `Finance Administrator`, `Community Administrator`, `Administrator`, or `Spotlight Editor`).
4. Enter a clear **Appointment Reason** (5–500 characters) and click **Confirm Appointment**.
5. Confirm the appointment appears in **Appointed Staff & Permissions** and **Audit Trail**.

### Modifying Individual Permissions (Platform Owner Only)
1. Open **10. Administration** → **Appointed Staff & Permissions**.
2. Click **Edit Permission** on the target staff member.
3. Choose the specific permission key and effect (`Grant`, `Revoke`, or `Reset to role default`), provide a mandatory reason, and save.
4. Note: `admin.revoke_admins` and `admin.manage_permissions` are Platform-Owner-exclusive and can never be delegated via overrides.

### Revoking Administrator Access (Platform Owner Only)
1. Open **10. Administration** → **Appointed Staff & Permissions**.
2. Click **Revoke Access** on the staff member, enter the mandatory revocation reason, and confirm.
3. PostgreSQL `owner_revoke_admin(...)` immediately deletes the user's rows from `public.user_roles`, clears `public.admin_user_permissions`, marks `public.admin_appointments.status = 'revoked'`, and logs an immutable `moderation_audit` entry.

### Content Moderation & Appeals
- **Hide Ping** sets `pings.hidden_at = now()`, removing the Ping from public feeds and share cards without destructive deletion.
- **Restore Ping** clears `pings.hidden_at = NULL` after a successful appeal.
- Every hide, restore, report resolution, boost refund, appointment, revocation, and permission override requires a non-empty reason stored permanently in `public.moderation_audit`.

---

## 4. Incident & Privacy Escalation Rules

- **Never query private messages manually** except under documented legal process with Platform Owner sign-off.
- **Never distribute service-role keys** (`SUPABASE_SERVICE_ROLE_KEY`) to browser code or client builds.
- **Spotlight Editorial separation:** Spotlight review and publication run on `/spotlight/editorial` using `is_spotlight_editor()`, ensuring editorial staff do not receive financial administration powers.
