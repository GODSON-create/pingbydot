# Ping Stage 2 — Pre-Deployment Audit, Legacy Media Quarantine & Rollout Runbook

> **Status:** Local remediation complete on `security/ping-stage2-remediation` (Migrations `0038`–`0041`). Do **not** apply to production until Steps 1–3 below report `READY`.

---

## 1. Read-Only Live Schema & C6 Privacy Hazard Audit (Zero Writes)

Before applying migrations `0038`–`0041` (which set `media.public = true` for public CDN delivery of avatars, Pings, Clips, Signals, and public Moments), verify that **zero historical private files** remain inside `storage.buckets(id='media')`.

Run the strictly read-only audit script (executes inside `BEGIN TRANSACTION READ ONLY`):

```bash
node scripts/audit-live-storage-and-schema.mjs
```

Or execute the equivalent read-only queries manually in **Lovable Cloud → More → Database → SQL Editor**:

```sql
-- 1. Check Drizzle ledger & schema milestones
SELECT to_regclass('drizzle.__drizzle_migrations') AS drizzle_ledger;
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC;

-- 2. Inspect storage buckets
SELECT id, public, file_size_limit FROM storage.buckets ORDER BY id;

-- 3. C6 Privacy Hazard Check: detect any pre-Stage-2 private files inside 'media'
SELECT
  count(*) FILTER (WHERE name ~ '^[^/]+/dm/')      AS legacy_dm_objects,
  count(*) FILTER (WHERE name ~ '^[^/]+/hubs?/')  AS legacy_hub_objects,
  count(*) FILTER (WHERE name ~ '^[^/]+/moments/') AS legacy_moment_objects
FROM storage.objects
WHERE bucket_id = 'media';

-- 4. Detect active restricted Moments still pointing at public 'media'
SELECT id, author_id, audience, media_url
FROM public.moments
WHERE audience IN ('followers', 'close_circle', 'hub')
  AND deleted_at IS NULL
  AND media_url LIKE '%/storage/v1/object/public/media/%';
```

### If C6 Detects Legacy Private Objects in `media`
1. **Do NOT flip `media.public = true` yet.**
2. Copy each legacy `*/dm/*` object into `dm-attachments` under `{conversation_id}/{sender_id}/{filename}`, update the matching `private_messages.media_url`, then delete the old `media` copy.
3. Copy each legacy `*/hubs/*` object into `hub-attachments` under `{hub_id}/{sender_id}/{filename}`, update `hub_messages.media_url`, then delete the old `media` copy.
4. Copy each restricted Moment (`followers`, `close_circle`, `hub`) into `private-moments` under `{author_id}/{audience}/{hub_id|self}/{filename}`, update `moments.media_url` to `storage://private-moments/...`, then delete the old `media` copy.
5. Re-run `node scripts/audit-live-storage-and-schema.mjs` until it prints `AUDIT RESULT: READY`.

---

## 2. Migration Apply Order & Idempotency Rules (H1 / M11)

- Apply migrations strictly in `_journal.json` sequential order (`0000` → `0041`) via `npm run db:migrate` (Drizzle tracks applied hashes so `0038` is never run twice).
- **Standalone Bucket Provisioning (`scripts/provision-storage-buckets.mjs --apply`):** Automatically drops `media_assets_visibility_check` before re-applying `0038` (mitigating H1 without rewriting historical migration `0038`) and applies `0036` → `0041` atomically in one transaction.
- **Post-apply verification:** Run `npm run db:verify` (`scripts/migrate-remote.mjs --verify-only`) to verify all tables, RLS policies, functions, and rollback-isolated multi-account security probes.

---

## 3. Feature Flags & Staged Activation (Keep OFF Until Verified)

1. **`app_feature_flags.chat_retention`** defaults to `false`. Keep `false` on initial deploy until:
   - `npm run db:verify` passes 100%,
   - Scheduled cron worker (`POST /api/cron/chat-retention` with `CRON_SECRET`) is tested in staging against synthetic expired messages.
2. **Cloudflare R2 (`PING_MEDIA_PROVIDER` / `VITE_MEDIA_PROVIDER`)** defaults to Lovable Cloud Storage. Before enabling R2 in staging:
   - Configure **all** required secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, **and** `R2_PUBLIC_CDN_URL` (required by M6).
   - Configure R2 bucket CORS to include `ExposeHeaders: ["ETag"]` (required by M5 strict ETag validation).
   - Configure an R2 Lifecycle Rule on both buckets to abort incomplete multipart uploads after `1 day` (defense-in-depth alongside client `AbortMultipartUpload`).
   - Verify Cloudflare Workers runtime exposes `process.env` (`nodejs_compat` + `nodejs_compat_populate_process_env` in `wrangler.jsonc`) so `resolveRuntimeEnv()` reads R2 and `CRON_SECRET` bindings cleanly (L1).
   - Rollback note: Disabling `VITE_MEDIA_PROVIDER` safely rolls new uploads back to Lovable Cloud while existing `r2://` refs continue resolving via `/api/media/sign-read` (H2).
