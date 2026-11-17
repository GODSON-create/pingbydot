# PING BY DOT — One-Million-User Readiness Assessment & Staging Load-Test Plan

**Repository:** `GODSON-create/pingbydot`  
**Target Scale Milestone:** 1,000,000 Registered User Accounts  
**Assessment Date:** 2026-11-17  
**Remote Supabase Reference:** `exlttyafomvqfwgzzjrm`

---

## 1. Executive Summary & Honest Capacity Boundaries

Preparing **PING BY DOT** for 1,000,000 registered user accounts requires separating three distinct scaling dimensions that behave very differently in production:

1. **1,000,000 Registered Accounts (Data Volume & Storage Size)**
   - Driven by database table sizes, index selectivity, partial indexes (`WHERE hidden_at IS NULL`, `WHERE deleted_at IS NULL`, `WHERE status = 'active'`), and Storage bucket key partitioning.
   - Addressed at the schema and query layer in migration `0022_stabilization_forums_signals_scale.sql` and our query client refactors (`get_my_conversations_summary`, bounded `conversationMessagesQuery`).
2. **Concurrent Active Users / Request Rate (DAU / Peak RPS)**
   - At 1,000,000 registered users with a 5–10% DAU ratio (50,000–100,000 DAU), typical average read+write traffic spans **150–400 RPS** with launch/notification spikes reaching **1,000–2,500 RPS**.
   - Client/application N+1 waterfalls (like the prior per-conversation `Promise.all` unread-count loop in `userConversationsQuery`) have been removed.
3. **Concurrent WebSocket / Realtime Connections**
   - Even if 1,000,000 users exist in `auth.users`, simultaneous WebSocket connections to Supabase Realtime (`hub-messages-live:*`, `hub-forum-posts:*`, `signal-live:*`, `dm-presence:*`, `private_messages`) scale linearly with simultaneous open sessions.

> **Honest Current Verification Status:**
> - **Not yet live-load-tested to 1M users:** No synthetic load test has been executed against remote production (`exlttyafomvqfwgzzjrm`), and provider plan upgrades have **not** been modified.
> - **Pending Remote Migrations:** Migrations `0021_provision_media_storage_bucket.sql` and `0022_stabilization_forums_signals_scale.sql` are committed in source control and verified in static/unit checks, and await operator execution against the remote database via `npm run db:migrate`.
> - **Provider Tier Dependency:** Reaching 1M registered users / >500 concurrent WebSockets / high Auth RPS requires upgrading Supabase (Pro/Team + Compute Add-on or Enterprise) and enabling PITR, connection pooling headroom, and Smart CDN caching; Free/baseline tiers cap Auth throughput, Realtime connections, and storage egress well below 1M-user traffic.

---

## 2. Ten-Domain Scalability & Readiness Audit

### 2.1 Authentication Capacity
- **Current Implementation:**
  - Browser clients use Supabase Auth PKCE/OAuth + local storage adapter (`previewAuthStorage.ts`) and non-blocking `useAuth()` session hydration.
  - Database `RLS` policies across `0011`–`0022` use `(select auth.uid())` (`initplan` caching) so PostgreSQL evaluates caller UID once per statement rather than once per scanned row at 1M rows.
  - Added idempotent `public.ensure_my_profile()` RPC (`0022`) to prevent `23503` FK failures when OAuth signups publish before client profile sync completes.
- **Bottlenecks & Requirements for 1M Users:**
  - GoTrue token issuance (`/auth/v1/token`, `/auth/v1/authorize`) and SMTP magic-link/signup emails are rate-limited on standard tiers.
  - **Action Required Before 1M:** Configure custom high-volume transactional SMTP (Resend/Postmark/SES) + configure custom Supabase Auth rate limits & Captcha/Turnstile on `/signup` if viral onboarding spikes occur.

### 2.2 PostgreSQL Connection Pooling
- **Current Implementation:**
  - Application traffic goes through Supabase PostgREST (`REST` + `RPC`) backed by **Supavisor** transaction pooling (`port 6543`), avoiding raw TCP connection exhaustion from Cloudflare Worker isolates.
  - Direct DDL migrations (`scripts/migrate-remote.mjs`) use `LOVABLE_DB_MIGRATION_URL` (session/direct connection) and execute safely outside runtime SSR request paths.
  - Eliminated the N+1 unread-count fan-out in `src/lib/messages.ts` via single-query `public.get_my_conversations_summary(_limit, _offset)` (`0022`), cutting inbox load from `1 + 2 + N` PostgREST calls down to `1` RPC call.
- **Action Required Before 1M:**
  - Size Supabase Compute (`2XL`+ or read replicas) and verify Supavisor `max_client_conn` & pool size align with peak SSR + REST concurrency.

### 2.3 Query Performance & Indexing
- **Indexes Added in Migration `0022`:**
  - `pings_public_feed_idx`: `(created_at DESC, id DESC) WHERE hidden_at IS NULL` — accelerates `/` and `/explore` main feed scans across 1M+ rows.
  - `pings_public_cat_idx`: `(category, created_at DESC, id DESC) WHERE hidden_at IS NULL` — accelerates category tab filtering.
  - `pings_user_visible_idx`: `(user_id, created_at DESC, id DESC) WHERE hidden_at IS NULL` — accelerates `/@username` profile timelines.
  - `profiles_created_desc_idx`: `(created_at DESC)` — accelerates Explore "People you should know" directory ordering.
  - `moments_active_exp_idx`: `(expires_at DESC, created_at DESC) WHERE deleted_at IS NULL` — accelerates active 24h Moments rail queries.
  - `private_messages_unread_idx`: `(conversation_id, created_at DESC) WHERE deleted_at IS NULL` — accelerates paginated `conversationMessagesQuery` (bounded `.limit(80)`) and unread counts inside `get_my_conversations_summary`.
  - `hub_members_active_hub_user_idx`: `(hub_id, user_id) WHERE status = 'active'` — accelerates `hub_role()` and `is_hub_member()` RLS checks inside every Hub read/write.
  - `hub_forum_posts_forum_idx`, `hub_forum_posts_parent_idx`, `hub_forum_posts_hub_idx` — accelerates Hub Forums + threaded replies.
  - `signal_messages_channel_idx` — accelerates Institutional Signal subscriber chat pagination.
- **Known Residual Limitation at Deep Pagination:**
  - `feedQuery` in `src/lib/pings.ts` currently supports page offsets (`.range(page * 30, page * 30 + 29)`). Deep page numbers (`page > 200`) degrade linearly with offset; switching deep feed infinite-scroll to **keyset cursor pagination** `(created_at, id) < ($1, $2)` is straightforward using `pings_public_feed_idx`.

### 2.4 Realtime Subscriptions
- **Current Implementation & Fixes Applied:**
  - Fixed WebSocket channel leaks in `src/components/hubs/HubChat.tsx` and `src/lib/presence.ts` by replacing `channel.unsubscribe()` with `supabase.removeChannel(channel)` on unmount.
  - Added cleaned-up realtime subscriptions (`supabase.removeChannel`) for `hub_forum_posts` and `signal_messages`.
  - Scoped all subscriptions with row filters (`hub_id=eq.${id}`, `conversation_id=eq.${id}`, `signal_id=eq.${id}`).
- **Capacity Constraint:**
  - Supabase Realtime enforces per-tier simultaneous connection and message/sec quotas (Free: 200 concurrent, Pro: 500 baseline expandable up to Enterprise 10k–100k+). Broadcast-heavy hubs/signals with >10k live viewers require Supabase Pro/Enterprise Realtime quota increases or read-through polling fallback for passive viewers.

### 2.5 Storage & Media Delivery
- **Current Implementation:**
  - `0021_provision_media_storage_bucket.sql` provisions public read `'media'` bucket with authenticated per-UID prefix policies (`${user.id}/pings/...`, `${user.id}/moments/...`, `${user.id}/hubs/...`, `${user.id}/messages/...`) and 50 MB size limits (`validateMediaUpload` caps client uploads at 10–15 MB before upload).
  - Immutable Vite client assets under `/assets/*` emit `cache-control: public, max-age=31536000, immutable` in `.output/public/_headers`.
- **Action Required Before 1M:**
  - Enable Supabase Storage **Smart CDN** caching and image transformations (`width`, `quality=auto`) on `'media'` URLs, plus lifecycle retention cleanup for expired ephemeral 24h Moments (`expires_at < now()`).

### 2.6 Edge / Serverless Routing & SSR Caching
- **Current Implementation:**
  - TanStack Start SSR (`src/server.ts`) resolves public Supabase configuration deterministically via `src/lib/supabase-public-config.ts` and hydrates `/` and `/explore` via `ensureQueryData` + `Route.useLoaderData()` (`initialData`) with zero hydration flicker.
- **Bottleneck & Optimization:**
  - `/` (`index.tsx`) and `/explore` run live Supabase SSR queries on every anonymous document request. Placing a short **Edge micro-cache (`s-maxage=15, stale-while-revalidate=60`)** strictly on anonymous unauthenticated public GET responses (`Cookie` absent) cuts SSR -> Postgres origin load by >90% during traffic surges.

### 2.7 Client Caching & Invalidation Hygiene
- **Current Implementation:**
  - Fixed `explore.tsx` loader/query hydration parity (`initialData`) and removed forced `?page=0` redirects.
  - `DirectMessageChat`, `HubChat`, `HubForumsAndBroadcasts`, and `signals.$slug` invalidate narrowly scoped query keys (`["hub-forum-posts", hub.id]`, `["signal-messages", signal.id]`, `["conversation-messages", id]`).
  - Recommendation: replace broad `qc.invalidateQueries()` in `_authenticated/create.tsx` and `_authenticated/edit.$id.tsx` with targeted invalidation (`["feed"]`, `["following-feed"]`, `["explore-people"]`, `["ping", id]`) when optimizing for high write volume.

### 2.8 Rate Limiting, Abuse Protection & Moderation
- **Current Implementation:**
  - Client shield (`src/lib/shield.ts`) limits rapid Ping, Moment, Hub, and Message bursts and sanitizes text/URLs.
  - Server-side database enforcement (`0018`, `0019`, `0020`, `0022`): `SECURITY DEFINER` RPCs bind `auth.uid()`, reject caller-spoofed membership probes (`is_close_circle_member`, `is_conversation_member`), prevent non-staff pin/announcement elevation (`guard_hub_forum_post`), lock down DM/wallet tables from `anon`, and wire `profile_reports` moderation reporting (removing the prior fake success catch in `DirectMessageChat.tsx`).
- **Action Required Before 1M:**
  - Enable Cloudflare WAF rate-limiting rules at the edge (`POST /auth/v1/*`, `/rest/v1/rpc/*`) so distributed credential-stuffing or scraper bursts never reach GoTrue or Postgres.

### 2.9 Observability, Logging & Disaster Recovery
- **Current Implementation:**
  - Removed silent error swallowing (`DEFAULT_FORUMS`, `DirectMessageChat` report `toast.success` catch, `HubChat`/`followingFeedQuery`/`blockedUsersQuery`/`economy.ts` masked failures). Users and telemetry see explicit failure states via `QueryErrorCard` and `formatMutationError`.
- **Action Required Before 1M:**
  - Enable **Supabase Point-in-Time Recovery (PITR)** daily/continuous backups, configure PgBouncer/Postgres slow-query (`pg_stat_statements`) alerts (`p95 > 100ms`), and attach structured error reporting (e.g., Sentry) on SSR worker exceptions.

### 2.10 Database Migrations & CI/CD Safety
- **Current Implementation:**
  - Strict forward-only numbered SQL migrations (`0000`–`0022`) registered in `drizzle/migrations/meta/_journal.json`.
  - `scripts/migrate-remote.mjs` checks schema ledger parity (`0011`–`0022`) and executes **transactionally rolled-back** RLS/RPC authorization verification (`ROLLBACK` at exit so zero test pollution touches production tables).

---

## 3. Staging Load-Test Plan & Pass/Fail Budgets

Execute the reproducible harness at `scripts/staging-load-test.mjs` against an isolated staging environment provisioned on the target Supabase tier **before** production cutover:

| Wave | Scenario | Target Concurrency | Duration | Max Error Rate | p95 Latency Budget | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **W1 — Baseline** | Public SSR (`/`, `/explore`, `/hubs`, `/signals/channels`) + PostgREST `pings`/`hubs`/`signals` | 25 VUs | 60 s | `< 0.5%` | `SSR <= 350 ms`, `REST <= 120 ms` | Verifies cold-to-warm Supavisor pool and partial indexes |
| **W2 — Sustained DAU Simulation** | Mixed feed reads + filtered category queries + profile lookups | 100 VUs | 300 s | `< 0.5%` | `SSR <= 500 ms`, `REST <= 200 ms` | Simulates ~50k–100k DAU sustained load (~250–400 RPS) |
| **W3 — Spike Burst** | Rapid concurrent public + authenticated inbox RPC (`get_my_conversations_summary`) & feed reads | 250 VUs | 120 s | `< 1.0%` | `REST/RPC <= 350 ms`, no HTTP 5xx | Stress-tests Supavisor queuing & Worker CPU time |
| **W4 — Realtime Fanout (Manual Staging)** | Concurrent WebSocket subscribers joining active Hub/Signal channels | 500+ sockets (per tier cap) | 180 s | `< 0.5%` drops | Broadcast delivery `p95 <= 500 ms` | Validates Supabase Realtime tier headroom & `removeChannel` cleanup |

### Running the Staging Harness
```bash
# Public read-only staging load test (Wave 1 baseline)
node scripts/staging-load-test.mjs \
  --app-url http://127.0.0.1:4173 \
  --supabase-url https://YOUR-STAGING-PROJECT.supabase.co \
  --anon-key YOUR_STAGING_ANON_KEY \
  --wave baseline \
  --concurrency 25 \
  --duration 30

# Sustained read wave against staging
node scripts/staging-load-test.mjs \
  --app-url https://staging.pingbydot.example \
  --supabase-url https://YOUR-STAGING-PROJECT.supabase.co \
  --anon-key YOUR_STAGING_ANON_KEY \
  --wave sustained \
  --concurrency 100 \
  --duration 120
```
*Safety Control:* `scripts/staging-load-test.mjs` refuses to execute burst traffic (`> 10` VUs) against production hostnames (`pingbydot.lovable.app` or `exlttyafomvqfwgzzjrm.supabase.co`) without `--i-understand-read-only-smoke`, and never performs unauthenticated or destructive writes.
