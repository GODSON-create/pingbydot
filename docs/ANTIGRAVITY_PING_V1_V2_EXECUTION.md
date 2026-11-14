# Ping by DOT — Antigravity V1 + V2 implementation and release brief

Repository: `GODSON-create/pingbydot`
Work branch: `release/ping-v1-stabilization`
Existing Lovable project: `Pingbydot` (do not rebuild)
Current published URL: `https://pingbydot.lovable.app`
Custom domain: owner will connect separately; use `VITE_SITE_ORIGIN` after DNS/domain verification.
PR #2 currently contains the new logo work. Do not merge or publish until build/visual checks pass.

## Critical verified state

A read-only live database inspection found only migrations 1–10 in `drizzle.__drizzle_migrations`. The public schema has these 16 tables:
`comment_likes, comment_reports, comments, follows, hub_invites, hub_members, hub_pings, hubs, likes, moderation_audit, notifications, pings, profile_connections, profiles, reports, user_roles`.

Migrations 0011 and 0012 are present in the repository but not recorded as applied. Their intended tables are absent:
- 0011: `user_privacy_preferences, hub_messages, ping_read_receipts, signals, signal_publishers, signal_followers, signal_posts, signal_reads`.
- 0012: `moments, moment_views, moment_likes, moment_replies, moment_repings, highlights, highlight_items, user_close_circle`.

Important correction: `0005_ping_conversations.sql` is misleadingly named. It creates comments, comment likes/reports, notifications and re-ping source columns. It does NOT create one-to-one conversations or messages. The current route tree has no direct-message/chat route. Do not mark 1:1 chat as working based on the migration filename.

The repo roadmap still lists incomplete work: Explore/Ping details/public share repair, signup/login QA, Data API permissions, admin dashboard and owner/admin/non-admin QA, V2 profile Connections, phone navigation/action sheets, plus tests/build/security review.

## Non-negotiable execution rules

1. Continue on `release/ping-v1-stabilization`; do not force-push, rebase or rewrite published history. Do not commit to main directly.
2. Preserve existing accounts, profiles, Pings, likes, comments, reports, roles and media. No DROP/TRUNCATE, destructive recreation, or fake seed data.
3. Before any DB write, inspect `drizzle.config.ts`, migration journal, actual live ledger, all dependencies in migrations 0000–0012, current policies/grants/functions, storage buckets/policies, and Realtime publication. Back up or confirm provider point-in-time backup first.
4. The SQL preflight file at `docs/sql/ping-v1-v2-preflight.sql` is read-only. Run it and save its output. Never paste secrets into chat or commit environment files.
5. Apply migrations through the project's migration runner (Drizzle) only after review and fixes. `drizzle.config.ts` expects `LOVABLE_DB_MIGRATION_URL`. Do not assume this variable exists or use the public anon key as a migration credential. Use a secure local/Antigravity environment secret. Do not manually insert rows into the Drizzle ledger to pretend migrations ran.
6. Migration 0011 currently has a critical privilege-escalation defect: the policy `Signal admins manage publishers` allows any authenticated user to insert their own `signal_publishers` row because of `OR user_id = auth.uid()`. That permits self-assignment of publisher/admin role. Fix before applying: ordinary users must not insert publisher roles; only a trusted SECURITY DEFINER RPC/admin operation may assign roles, with caller and target validation. Remove client INSERT grant or constrain it to safe publisher assignment that cannot self-assign admin. Confirm the `create_signal` RPC can still add creator admin without granting clients arbitrary role assignment.
7. Audit all migration 0011 functions for explicit `auth.uid()` checks, safe `search_path`, least privilege, correct counter concurrency, and ownership. Hub member role changes, invitations, message edits, and read receipts must enforce active membership and staff role.
8. Audit migration 0012 before applying. It grants broad `ALL` to authenticated on sensitive tables; reduce to operation-specific grants. Ensure every SECURITY DEFINER RPC enforces caller identity and audience visibility. Check moment reads/likes/replies/re-pings against public/follower/hub/close-circle privacy; a hidden or private moment must never become public through a re-ping, highlight, media URL, RPC or social preview. Make migrations re-runnable or explicitly fail safely if partially applied. Do not swallow all errors in Realtime setup; handle only duplicate publication membership and report missing publication/permission.
9. PostgreSQL RLS policies are permissive by default and OR together. Inspect ALL existing policies for each table; adding a restrictive-looking policy does not neutralize an older permissive policy. Confirm RLS enabled, grants and policies for anon/authenticated/service_role separately.
10. No production DB migration, merge, publish, DNS or custom-domain change without owner approval. The owner will connect the domain.
11. Do not claim a feature is done until you run the corresponding tests and real browser QA. Never use mock UI or fake backend data as completion.
12. Add no credentials, service-role keys, database URLs, access tokens or user PII to git.

## Required V1 scope — must work end to end

### A. Identity, signup and profiles
- Email signup/login, Google login if configured, OTP/reset if configured, session refresh, logout and protected routes.
- First-time profile creation is atomic/idempotent; no duplicate profile race, missing profile, or "Something went wrong saving your profile".
- Remove the access-code question entirely from UI, validation, state, backend gate and tests.
- Profile editing persists all supported fields; correct RLS and owner scoping.
- Test fresh account, returning account, duplicate username, missing profile recovery, two simultaneous signups, signed-out route access.

### B. Core Pings and Explore
- Create multiple Pings; edit/delete own Pings; unique stable public links; public share page works signed out.
- Explore loads, search/filter/pagination work, no empty feed caused by client auth assumptions; public SSR reads use only public fields.
- Likes are unique per user/Ping; comments/replies and re-pings preserve attribution; shares resolve to canonical URL.
- Hide/moderation/deleted content must disappear from public feed, profile, search, OG cards and share images.
- Validate upload MIME/size, storage policies and signed/public URL handling.

### C. Hubs
- Create/list/search/view public and private Hubs; join/leave/invite/revoke; membership roles; Hub Pings; pinned feed; resources; member directory.
- Hub messages: send/edit/delete only own message or staff; membership gating; replies; Realtime; read/delivery receipts; unread counts.
- Prevent non-members from reading private Hub messages or private member lists. Prevent member self-promotion to owner/admin/moderator.
- Verify counter consistency and concurrent join/leave.

### D. Moments and Highlights
- Upload/create image/video Moment, audience selection (public/followers/hub/close-circle), expiration/archive/delete, views, reactions, replies, share/re-ping rules.
- Highlights create/edit/reorder/delete and add/remove Moments; private Highlights and their media must remain private.
- Validate storage access, MIME/size, media URL authorization, Realtime and counter integrity.
- Close Circle membership is owner-managed and private.

### E. Signals
- Create Signal; owner/verified status; follower subscriptions; publishers; publish announcements/alerts/opportunities/events; mark read; analytics.
- Critical: no user can self-assign Signal admin/publisher role. Only creator bootstrap through trusted RPC and authorized admin operations.
- Analytics only visible to Signal admins/publishers. Counts use safe concurrency and accurate denominator.

### F. One-to-one chats (missing implementation)
- Implement actual direct conversations, not just Moment replies or Hub messages.
- Add normalized schema for conversations, conversation_members and conversation_messages (or justify simpler schema), unique pair/conversation semantics, participant-only RLS, message ownership, blocking/reporting controls, pagination, Realtime, delivery/read receipts, unread counts and safe notification fan-out.
- No public/anon access to direct-message rows. No user can add a third participant or read another pair's conversation.
- Add routes and UI for inbox, conversation list, thread, send, empty state, loading/error, responsive mobile back navigation. Test with two independent accounts.

### G. Shell, navigation, notifications and admin
- Audit desktop/mobile/iOS/Android web layouts separately. No clipped controls, dead navigation, inaccessible touch targets or overflow.
- Header, desktop sidebar/navigation and mobile bottom nav point to working destinations; all CTAs work.
- Notifications are scoped to recipient; mark read/unread; no duplicate fan-out.
- Admin dashboard: server-authorized admin-only access, accounts/active users/Pings/shares/referrals/Hub/Moment/Signal metrics, moderation queue and audit. Never trust client-side role state or allow self-promotion. Do not fabricate live user counts.
- Attribution/referral fields should be explicit, deduplicated, auditable and privacy-conscious. ARISE referrals tracked only where a verified source exists.

## Required V2 scope — implement only after V1 core is stable

1. Profile Connections editor and public links: independent platforms, one primary destination, validation, safe HTTPS destination previews, public/private visibility, private fields never exposed.
2. Mobile-first navigation/action sheets and gesture boundaries; distinct desktop/mobile experience without duplicating business logic.
3. Notifications preferences, device/session management, stronger account security and anti-abuse.
4. Search/discovery quality, feed ranking, saved/bookmarked content if already part of approved product design; do not invent social mechanics that conflict with Ping's "Pings" model.
5. PING SHIELD baseline: rate limits, abuse/bot controls, input validation, upload hardening, auth/session checks, least-privilege RPCs, RLS audit, secrets handling, security logging/alerts, backup/restore runbook, incident response and authorized load/security tests. Do not claim WAF/DDoS protection unless configured at hosting/CDN level.
6. Admin analytics, creator-level analytics, referral attribution, and moderation tooling.
7. Performance: indexes, query pagination, N+1 elimination, cache rules, Realtime subscription cleanup, image/media optimization, 1000 concurrent active users only after load testing.
8. Product polish per the DOT design standard: remove filler badges/labels, consistent casing/icons, actual functioning UI, clear hierarchy, accessible contrast, useful empty/loading/error states, no placeholder buttons.

## Execution order

Phase 0 — inventory and baseline:
- Run `bun install --frozen-lockfile` or the lockfile-appropriate install; inspect package manager/lockfile.
- Run `bun test`, `bun run lint`, `bun run build`; record failures before edits.
- Inspect current live DB with preflight SQL and compare every migration against actual state.
- Map routes, components, hooks, RPCs and table dependencies. Make a feature matrix with code present / DB present / permissions present / tests / browser QA.

Phase 1 — secure DB foundation:
- Correct and review migrations 0011 and 0012. Add a proper new migration for direct messages after schema design.
- Run migrations against a disposable/staging clone first; run schema and RLS tests. Back up production. Then apply pending migrations 0011 onward in order using Drizzle migration runner with secure migration credentials.
- Never manually apply 0012 before fixing its grants/RLS/RPC behavior. Update the Drizzle journal only through normal migration authoring.

Phase 2 — V1 implementation:
- Fix signup/profile, Explore, Ping details/share, Hubs/messages, Moments/Highlights, Signals and direct messages.
- Add unit/integration tests, role-based RLS tests and two-account browser E2E.
- Fix all critical/high issues before proceeding.

Phase 3 — V2:
- Complete Connections, mobile navigation, Shield controls, analytics, admin/referral and performance improvements.
- Run mobile/desktop visual and functional QA.

Phase 4 — release candidate:
- Production build passes; lint and tests pass; migrations verified; no unresolved critical/high security findings; every route checked; two-account privacy checks pass; backups/restore plan confirmed.
- Provide exact list of features verified, not just implemented; remaining medium/low issues; migration IDs and hashes; commit/PR; preview URL.
- Keep PR draft until owner reviews. Do not publish production; owner will click Publish and connect domain after acceptance.

## Required final report
Return:
- Feature matrix V1 and V2 with status (verified / implemented-not-verified / blocked / not started).
- Files changed and commits.
- DB migrations changed/applied and exact migration ledger result.
- Test commands and outcomes, including browser/device matrix.
- Security issues found and fixed, especially Signal publisher self-promotion and private Moments/Hub/DM isolation.
- Exact owner action needed, if any.
