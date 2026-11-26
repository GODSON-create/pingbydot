#!/usr/bin/env node
/**
 * PING by DOT — Strictly Read-Only Pre-Deployment Live Storage & Schema Audit (C6 / M11)
 *
 * Executes ZERO writes, ZERO DDL, and ZERO mutations against PostgreSQL.
 * Runs inside a `BEGIN TRANSACTION READ ONLY` block to inspect:
 *   1. Exact Drizzle migration ledger state (`drizzle.__drizzle_migrations`).
 *   2. Presence of key schema milestones (`0021`..`0041`).
 *   3. Current `storage.buckets` configuration (`media`, `dm-attachments`,
 *      `hub-attachments`, `private-moments`).
 *   4. C6 Privacy Hazard Scan: inventories any historical private objects still
 *      sitting inside the `media` bucket (`*/dm/*`, `*/hubs/*`, `*/moments/*`)
 *      BEFORE migration `0038` flips `media.public = true`.
 *   5. Outputs a strict GO / NO-GO checklist for operators.
 *
 * Usage:
 *   node scripts/audit-live-storage-and-schema.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const EXPECTED_PROJECT_REF = "exlttyafomvqfwgzzjrm";

function loadDotEnvFallback() {
  const trackedEnvPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(trackedEnvPath)) {
    const trackedContent = fs.readFileSync(trackedEnvPath, "utf8");
    if (/^LOVABLE_DB_MIGRATION_URL\s*=/m.test(trackedContent)) {
      console.error("SECURITY BLOCK: Move LOVABLE_DB_MIGRATION_URL out of tracked '.env'.");
      process.exit(2);
    }
  }
  for (const envPath of [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(os.homedir(), ".env"),
  ]) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
  }
}

function validateUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) {
    console.error("BLOCKED: Set LOVABLE_DB_MIGRATION_URL before running the read-only live audit.");
    process.exit(2);
  }
  const parsed = new URL(rawUrl.trim());
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    console.error("BLOCKED: LOVABLE_DB_MIGRATION_URL must use postgres:// or postgresql://.");
    process.exit(2);
  }
  const hostAndUser = `${parsed.hostname} ${decodeURIComponent(parsed.username)}`.toLowerCase();
  const refMatch =
    parsed.hostname.match(/^db\.([a-z0-9]{15,25})\.supabase\.co$/i) ||
    decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]{15,25})$/i);
  if (refMatch && refMatch[1].toLowerCase() !== EXPECTED_PROJECT_REF) {
    console.error(`BLOCKED: Refusing to audit non-PING project '${refMatch[1]}'.`);
    process.exit(2);
  }
  if (hostAndUser.includes("avantage")) {
    console.error("BLOCKED: Refusing to connect to non-PING database.");
    process.exit(2);
  }
  return rawUrl.trim();
}

async function main() {
  loadDotEnvFallback();
  const url = validateUrl(process.env.LOVABLE_DB_MIGRATION_URL);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  let blockers = 0;
  try {
    await sql.begin("READ ONLY", async (tx) => {
      console.log("=== 1. DRIZZLE MIGRATION LEDGER (READ-ONLY) ===");
      const [{ ledger }] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`;
      if (ledger) {
        const rows = await tx`
          SELECT id, hash, created_at
          FROM drizzle.__drizzle_migrations
          ORDER BY id ASC
        `;
        console.log(`  Found ${rows.length} applied ledger entries.`);
        if (rows.length > 0) {
          console.log("  Latest ledger entry:", JSON.stringify(rows[rows.length - 1]));
        }
      } else {
        console.log("  No drizzle.__drizzle_migrations ledger table found (manual SQL apply history).");
      }

      console.log("\n=== 2. SCHEMA MILESTONES (0021..0041) ===");
      const [milestones] = await tx`
        SELECT
          to_regclass('public.saved_messages') IS NOT NULL AS has_0029_saved_messages,
          to_regclass('public.media_assets') IS NOT NULL AS has_0030_media_assets,
          to_regclass('public.membership_plans') IS NOT NULL AS has_0033_membership_plans,
          to_regclass('public.admin_appointments') IS NOT NULL AS has_0035_admin_centre,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'request_status'
          ) AS has_0037_stage1,
          to_regclass('public.media_deletion_queue') IS NOT NULL AS has_0038_stage2_storage,
          to_regclass('public.app_feature_flags') IS NOT NULL AS has_0039_stage2_retention,
          to_regprocedure('public.register_my_media_asset(text,text,text,text,text,uuid,uuid,uuid)') IS NOT NULL AS has_0040_phase1,
          to_regprocedure('public.can_read_dm_media_object(uuid,text)') IS NOT NULL AS has_0041_phase2
      `;
      console.log(" ", JSON.stringify(milestones, null, 2));

      console.log("\n=== 3. STORAGE BUCKETS ===");
      const buckets = await tx`
        SELECT id, public, file_size_limit, array_length(allowed_mime_types, 1) AS mime_count
        FROM storage.buckets
        ORDER BY id ASC
      `;
      for (const b of buckets) {
        console.log(`  - ${b.id}: public=${b.public}, file_size_limit=${b.file_size_limit}, mimes=${b.mime_count ?? "unlimited"}`);
      }

      console.log("\n=== 4. C6 PRIVACY HAZARD SCAN: LEGACY PRIVATE OBJECTS IN 'media' ===");
      const mediaPrefixes = await tx`
        SELECT
          split_part(name, '/', 2) AS folder_segment,
          count(*)::int AS object_count
        FROM storage.objects
        WHERE bucket_id = 'media'
        GROUP BY 1
        ORDER BY 2 DESC
      `;
      console.log("  Folder distribution inside 'media':", JSON.stringify(mediaPrefixes));

      const [legacyPrivate] = await tx`
        SELECT
          count(*) FILTER (WHERE name ~ '^[^/]+/dm/')::int AS legacy_dm_objects,
          count(*) FILTER (WHERE name ~ '^[^/]+/hubs?/')::int AS legacy_hub_objects,
          count(*) FILTER (WHERE name ~ '^[^/]+/moments/')::int AS legacy_moment_objects
        FROM storage.objects
        WHERE bucket_id = 'media'
      `;
      console.log("  Legacy private prefix counts in 'media':", JSON.stringify(legacyPrivate));

      const [restrictedMomentsInMedia] = await tx`
        SELECT count(*)::int AS cnt
        FROM public.moments m
        WHERE m.audience IN ('followers', 'close_circle', 'hub')
          AND m.deleted_at IS NULL
          AND m.media_url LIKE '%/storage/v1/object/public/media/%'
      `;
      console.log("  Active restricted Moments still pointing at 'media':", restrictedMomentsInMedia.cnt);

      const mediaBucket = buckets.find((b) => b.id === "media");
      const hasLegacyHazard =
        Number(legacyPrivate.legacy_dm_objects) > 0 ||
        Number(legacyPrivate.legacy_hub_objects) > 0 ||
        Number(restrictedMomentsInMedia.cnt) > 0;

      if (hasLegacyHazard && (!mediaBucket || !mediaBucket.public)) {
        blockers += 1;
        console.error(
          "\n[NO-GO BLOCKER — C6] Historical private DM/Hub/Moment objects exist inside 'media' while media.public=false.\n" +
            "Migrate or quarantine those objects into 'dm-attachments' / 'hub-attachments' / 'private-moments' BEFORE applying 0038!",
        );
      }

      console.log("\n=== 5. FEATURE FLAG SAFETY CHECK ===");
      if (milestones.has_0039_stage2_retention) {
        const flags = await tx`SELECT key, enabled FROM public.app_feature_flags ORDER BY key ASC`;
        console.log("  app_feature_flags:", JSON.stringify(flags));
      } else {
        console.log("  app_feature_flags not yet present (will be created disabled=false by 0039).");
      }
    });

    if (blockers > 0) {
      console.error(`\nAUDIT RESULT: NO-GO (${blockers} blocking C6 privacy hazard(s) detected).`);
      process.exit(1);
    }
    console.log("\nAUDIT RESULT: READY (0 C6 legacy-private blockers detected in 'media').");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("Read-only live audit failed:", err?.message || err);
  process.exit(1);
});
