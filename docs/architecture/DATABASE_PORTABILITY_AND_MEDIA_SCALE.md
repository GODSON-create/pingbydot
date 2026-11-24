# Ping by DOT — Database Portability, Storage Architecture & Media Scale Strategy (Stage 2)

**Repository:** `GODSON-create/pingbydot`  
**Current Branch Baseline:** `stage2/storage-media-architecture-chat-retention`  
**Migration Ledger:** `0000`–`0039` (`40` sequential forward-only migrations in `drizzle/migrations/meta/_journal.json`)  
**Current Production Backend:** Lovable Cloud (`exlttyafomvqfwgzzjrm`, `PostgreSQL 17.11.0.003`, `Europe (Paris) / eu-west-3`)

---

## 1. Verified Lovable Cloud Baseline & Constraints

Measured directly from the live Lovable Cloud dashboard and database:

| Resource                | Verified Live State                                                                         | Hard Operational Constraint                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database Compute**    | `Tiny` · Shared CPU · `Up to 0.5 GB RAM` (64% RAM used idle)                                | Vertical upgrade path: `Tiny → Mini → Small → Medium → Large → X-Large`                                                                                                                                                                       |
| **Database Disk**       | `0.30 GB` of `2 GB` used (15.1 MB DB + 112 MB WAL)                                          | **Does not auto-expand.** Reaching 100% triggers read-only mode (`SQLSTATE 25006`) and crash loops (`SQLSTATE 53100`). Manual expand up to 5× per step (cannot downsize).                                                                     |
| **Connections**         | `60` direct (`:5432`) / `200` Supavisor transaction pool (`:6543`)                          | Scales with compute tier                                                                                                                                                                                                                      |
| **Backups & DR**        | 1 daily automated snapshot (~14-day retention)                                              | **No PITR (up to 24 h RPO).** Storage objects are **excluded** from database snapshots and exports.                                                                                                                                           |
| **Self-Service Export** | Full PostgreSQL `.backup` (custom format) once per 24 h                                     | **Hard cap: DB ≤ 15 GB** (export file ≤ 5 GB). No external superuser TCP (`pg_dump`) URL exposed.                                                                                                                                             |
| **Storage Gateway**     | Single-POST up to 2 GB (configurable to 5 GB); TUS `/storage/v1/upload/resumable` supported | Live `media`, `dm-attachments`, and `hub-attachments` currently all have `public = false`, `file_size_limit = NULL`, `allowed_mime_types = NULL`; `dm-attachments` and `hub-attachments` have 0 RLS policies until `0036`–`0039` are applied. |
| **Edge Runtime**        | TanStack Start on Cloudflare Workers (`workerd`)                                            | `50 ms` CPU time (`300 ms` Unbound), `128 MB` RAM per isolate — **never proxy binary uploads through server functions**.                                                                                                                      |

---

## 2. Database Migration & Reconciliation Playbook

Because Lovable Cloud does not expose an external superuser TCP URL (`LOVABLE_DB_MIGRATION_URL`), migrations cannot be pushed directly from a developer laptop to `exlttyafomvqfwgzzjrm`.

### Step 1: Inspect Live Migration State in Lovable Cloud SQL Editor

Run this read-only inspection query before applying any migration:

```sql
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC;
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;
SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY policyname;
```

### Step 2: Apply Forward-Only Migrations Strictly in Order

- All migrations `0000`–`0039` are forward-only and idempotent (verified offline by `node scripts/verify-migrations-offline.mjs`).
- **Critical repair dependencies:**
  - `0036`–`0037`: Stage 1 database repairs (`0029`/`0031`/`0032`/`0033`/`0035`), messaging & privacy hardening, message requests, `dm-attachments` RLS.
  - `0038`: Corrects `media` (`public = true`), `dm-attachments`, `hub-attachments`, and `private-moments` bucket limits/MIME allowlists, removes legacy `"Media is public"`, adds Hub membership/role RLS, restricted Moment audience RLS, `media_assets` extensions, and `media_deletion_queue`.
  - `0039`: Installs the **feature-flagged** (`app_feature_flags.key = 'chat_retention'`, `enabled = false` by default) scalable Chat Retention system (`chat_retention_entitlement_rules`, `set_conversation_retention_policy`, `toggle_save_private_message`, `process_expired_private_messages_batch`, `claim_media_deletion_jobs`, `complete_media_deletion_job`, `get_chat_retention_metrics`).
- Never skip migrations or edit already-applied migration files. After applying, execute `NOTIFY pgrst, 'reload schema';`.

---

## 3. Zero-Lock-In PostgreSQL Portability Strategy (Exit Before 10–12 GB)

### Why the Exit Trigger Is `8–10 GB` (Not `15 GB`)

Lovable Cloud caps self-service `.backup` exports at **15 GB** DB size and provides **no PITR**. To avoid losing self-service export portability or exposing paid DOT wallets / private chats to a 24-hour RPO window:

1. **Trigger thresholds to begin Postgres migration off Lovable Cloud:**
   - Database size reaches **8–10 GB** (before the 15 GB export ceiling), **OR**
   - Sustained RAM > 75% / CPU > 65% on `Medium`/`Large`, **OR**
   - Concurrent WebSockets exceed **1,500–2,000**, **OR**
   - Production revenue / compliance requires **Point-in-Time Recovery (PITR)**.

2. **Target PostgreSQL Platforms (100% Standard PG 17 Compatible):**
   - Dedicated Supabase Pro/Enterprise (with PITR + Read Replicas + direct TCP), **OR**
   - AWS RDS / Aurora PostgreSQL 17 + PgBouncer, **OR**
   - Neon Scale / Dedicated Cloud Postgres.
   - Ping's schema uses standard PostgreSQL 17 features, RLS, PL/pgSQL RPCs, and `pg_trgm`/GIN FTS indexes; the only Supabase-specific assumptions are `auth.users`, `auth.uid()`, and `storage.*` (all isolated behind helpers and `MediaStorageProvider`).

3. **Zero-Data-Loss Cutover Procedure:**
   1. Provision target PostgreSQL 17+ with PITR, automated encrypted backups, and connection pooling.
   2. Enter brief read-only maintenance window (5–15 min) or pause writes.
   3. Export custom-format `.backup` from Lovable Cloud → `More → Database → Manage → Export project data`.
   4. Restore via `pg_restore --no-owner --clean --if-exists --dbname="$TARGET_DB_URL" ping.backup`.
   5. Run `node scripts/migrate-remote.mjs --verify-only` against the restored database to verify schema parity + transactional multi-account RLS authorization tests (all rolled back cleanly).
   6. Point `SUPABASE_URL` / `VITE_SUPABASE_URL` (or custom API domain) and `R2_*` secrets to the new cluster and lift maintenance mode.

---

## 4. Provider-Independent Media Plane & Cloudflare R2 Cutover

Ping's client and server media layer ([media-provider.ts](file:///c:/Users/HP/Downloads/ping%201/pingbydot-git/src/lib/media-provider.ts), [storage.ts](file:///c:/Users/HP/Downloads/ping%201/pingbydot-git/src/lib/storage.ts), [media-server.ts](file:///c:/Users/HP/Downloads/ping%201/pingbydot-git/src/lib/media-server.ts)) decouples all product features from any single storage provider:

1. **Today (Default — `LovableCloudMediaProvider`):**
   - Requires **zero** Cloudflare R2 credentials.
   - Uses Lovable Cloud Storage (`media`, `dm-attachments`, `hub-attachments`, `private-moments`), client-side image optimization & EXIF removal, 32 kbps Opus voice notes, and native TUS 1.0.0 resumable uploads for files `> 6 MB`.
2. **Feature-Flagged Cutover (`CloudflareR2MediaProvider`):**
   - Controlled by `PING_MEDIA_PROVIDER=cloudflare_r2` / `VITE_MEDIA_PROVIDER=cloudflare_r2` + server secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_CDN_URL`).
   - Uses lightweight Web Crypto AWS SigV4 presigning ([r2-sigv4.ts](file:///c:/Users/HP/Downloads/ping%201/pingbydot-git/src/lib/r2-sigv4.ts), `< 1 ms` CPU) inside `/api/media/presign-upload` and `/api/media/sign-read` — **zero binary bytes ever pass through Cloudflare Worker RAM**.
   - Files `> 6 MB` automatically use direct-to-R2 S3 Multipart uploads (`uploadPartsDirectly`).
   - **Zero-downtime dual-read:** Existing `https://...`, `storage://...`, and canonical bare DM paths continue resolving from Lovable Cloud Storage while new uploads land in `r2://...` (`\$0` egress). Background backfill can copy historical objects without interrupting users.

---

## 5. Honest Retention, Deletion & Backup Semantics

- **Active primary deletion:** Expired private messages are scrubbed in indexed batches (`process_expired_private_messages_batch`) and their storage objects + derivatives are deleted asynchronously via `media_deletion_queue` with exponential backoff retries (`POST /api/cron/chat-retention`).
- **Signed URL non-renewal:** `dm-attachments` `SELECT` RLS (`0039`) and `/api/media/sign-read` deny signing any expired or deleted object immediately upon expiry, even before the async storage deletion job completes.
- **Backup & lifecycle caveat (honest disclosure):**
  - Daily Lovable Cloud database snapshots (~14-day retention) cannot be selectively mutated after creation; deleted metadata persists inside historical DB snapshots until those snapshots age out.
  - Lovable Cloud does not back up Storage objects. On future Cloudflare R2, if object versioning (e.g., 30-day noncurrent version retention) is enabled for disaster recovery, physically deleted objects remain recoverable in noncurrent versions until the R2 lifecycle rule permanently purges them.
- **Strict scope boundary:** Chat Retention applies **only** to `public.private_messages` and private DM attachments. It **never** expires public Pings, profiles, published Moments, Venture/Business listings, Clips, or Hub content.
