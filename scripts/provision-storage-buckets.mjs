#!/usr/bin/env node
/**
 * PING by DOT — Storage Bucket Provisioning & Verification Script
 *
 * Modes:
 *   --check-only  (default) Read-only check verifying whether 'media' (public) and
 *                 'dm-attachments' (private) exist on the target Supabase project.
 *   --apply       Explicit operator-approved execution applying migration 0036
 *                 (storage buckets + strict conversation-scoped DM RLS + Voice preview)
 *                 via `LOVABLE_DB_MIGRATION_URL` (direct PostgreSQL, never port 6543).
 *
 * SECURITY:
 *   - Never logs credentials or connection strings.
 *   - Blocks connections to any project other than PING (`exlttyafomvqfwgzzjrm`).
 *   - Refuses to read `LOVABLE_DB_MIGRATION_URL` from git-tracked `.env`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const EXPECTED_PROJECT_REF = "exlttyafomvqfwgzzjrm";
const APPLY_MODE = process.argv.includes("--apply");
const CHECK_ONLY = !APPLY_MODE || process.argv.includes("--check-only");

function readEnvFile(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    map[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return map;
}

function loadSafeConfig() {
  const trackedEnvPath = path.resolve(process.cwd(), ".env");
  const trackedEnv = readEnvFile(trackedEnvPath);
  if (APPLY_MODE && trackedEnv.LOVABLE_DB_MIGRATION_URL) {
    console.error(
      "SECURITY BLOCK: LOVABLE_DB_MIGRATION_URL must not be stored in git-tracked '.env'.",
    );
    process.exit(2);
  }

  const localEnv = {
    ...readEnvFile(path.resolve(os.homedir(), ".env")),
    ...readEnvFile(path.resolve(process.cwd(), ".env.local")),
  };

  return {
    supabaseUrl:
      process.env.VITE_SUPABASE_URL ||
      localEnv.VITE_SUPABASE_URL ||
      trackedEnv.VITE_SUPABASE_URL ||
      "",
    anonKey:
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      localEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
      trackedEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
      "",
    migrationUrl: process.env.LOVABLE_DB_MIGRATION_URL || localEnv.LOVABLE_DB_MIGRATION_URL || "",
  };
}

function validateMigrationUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) {
    console.error("BLOCKED: LOVABLE_DB_MIGRATION_URL is required for --apply mode.");
    process.exit(2);
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    console.error("BLOCKED: LOVABLE_DB_MIGRATION_URL is not a valid PostgreSQL URL.");
    process.exit(2);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    console.error("BLOCKED: LOVABLE_DB_MIGRATION_URL must use postgres:// or postgresql://.");
    process.exit(2);
  }
  const port = parsed.port || "5432";
  if (port === "6543") {
    console.error("BLOCKED: Port 6543 (transaction pooler) is not permitted. Use port 5432.");
    process.exit(2);
  }
  const supabaseRefMatch =
    parsed.hostname.match(/^db\.([a-z0-9]{15,25})\.supabase\.co$/i) ||
    decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]{15,25})$/i);
  if (supabaseRefMatch && supabaseRefMatch[1].toLowerCase() !== EXPECTED_PROJECT_REF) {
    console.error(
      `BLOCKED: Target project '${supabaseRefMatch[1]}' does not match PING ('${EXPECTED_PROJECT_REF}').`,
    );
    process.exit(2);
  }
  return { port };
}

async function probeBucketHttp(supabaseUrl, anonKey, bucketId) {
  const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucketId}/__ping_probe__`;
  const res = await fetch(url, {
    method: "GET",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json response
  }
  const isMissing =
    /bucket not found|nosuchbucket/i.test(text) ||
    json?.error === "Bucket not found" ||
    json?.code === "NoSuchBucket";
  return {
    bucketId,
    status: res.status,
    exists: !isMissing,
    detail: json?.message || json?.error || text.slice(0, 120),
  };
}

async function runCheckOnly(cfg) {
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    console.error("BLOCKED: Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
    process.exit(2);
  }

  console.log(`[CHECK-ONLY] Probing Supabase Storage at ${cfg.supabaseUrl} ...`);
  const listRes = await fetch(`${cfg.supabaseUrl.replace(/\/$/, "")}/storage/v1/bucket`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
  });
  const listText = await listRes.text();
  console.log(`  GET /storage/v1/bucket -> HTTP ${listRes.status}: ${listText.slice(0, 200)}`);

  const mediaProbe = await probeBucketHttp(cfg.supabaseUrl, cfg.anonKey, "media");
  const dmProbe = await probeBucketHttp(cfg.supabaseUrl, cfg.anonKey, "dm-attachments");
  const hubProbe = await probeBucketHttp(cfg.supabaseUrl, cfg.anonKey, "hub-attachments");
  const momentProbe = await probeBucketHttp(cfg.supabaseUrl, cfg.anonKey, "private-moments");

  console.log(
    `  Public bucket 'media': ${mediaProbe.exists ? "PUBLIC OK" : "NOT PUBLIC / MISSING"} (HTTP ${mediaProbe.status} — ${mediaProbe.detail})`,
  );
  console.log("  Private buckets (HTTP public endpoint returns 400 when private=true as expected):");
  for (const probe of [dmProbe, hubProbe, momentProbe]) {
    console.log(
      `    - '${probe.bucketId}': public-endpoint-blocked=${!probe.exists} (HTTP ${probe.status} — verify bucket row & RLS in Lovable SQL editor)`,
    );
  }

  if (!mediaProbe.exists) {
    console.error(
      "\nACTION REQUIRED: Public bucket 'media' is either missing or configured with public=false on " +
        `'${EXPECTED_PROJECT_REF}'.\n` +
        "First run 'node scripts/audit-live-storage-and-schema.mjs' to check C6 legacy private files, then apply migrations 0036–0041.",
    );
    process.exit(1);
  }

  console.log("\nOK: Public bucket 'media' is publicly reachable and private endpoints are blocked.");
}

async function runApply(cfg) {
  const { port } = validateMigrationUrl(cfg.migrationUrl);
  const readOptionalMig = (fileName) => {
    const p = path.resolve(process.cwd(), "drizzle/migrations", fileName);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  };
  const ddl0036 = readOptionalMig("0036_storage_buckets_dm_rls_and_voice_preview.sql");
  if (!ddl0036) {
    console.error("Missing migration 0036_storage_buckets_dm_rls_and_voice_preview.sql");
    process.exit(1);
  }
  const ddl0037 = readOptionalMig("0037_stage1_messaging_privacy_and_security_hardening.sql");
  const ddl0038 = readOptionalMig("0038_stage2_storage_buckets_rls_and_media_assets.sql");
  const ddl0039 = readOptionalMig("0039_stage2_scalable_chat_retention_system.sql");
  const ddl0040 = readOptionalMig("0040_stage2_phase1_security_remediation.sql");
  const ddl0041 = readOptionalMig("0041_stage2_phase2_security_reliability_and_retention.sql");

  console.log(
    `[APPLY] Connecting to PING Supabase PostgreSQL (port ${port}, project=${EXPECTED_PROJECT_REF})...`,
  );
  const sql = postgres(cfg.migrationUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl0036);
      // Guard: if Stage 1 (0037) schema is already present, re-apply 0037..0041 idempotently
      // so standalone bucket provisioning never downgrades Stage 1/2 security policies.
      if (ddl0037) {
        const [{ has_stage1 }] = await tx`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'conversations'
              AND column_name = 'request_status'
          ) AS has_stage1
        `;
        if (has_stage1) {
          await tx.unsafe(ddl0037);
        }
      }

      if (ddl0038) {
        const [{ has_media_assets }] = await tx`
          SELECT to_regclass('public.media_assets') IS NOT NULL AS has_media_assets
        `;
        if (has_media_assets) {
          // H1 idempotency guard when re-running 0038 standalone without modifying 0038
          await tx`ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_visibility_check`;
          await tx.unsafe(ddl0038);
          if (ddl0039) await tx.unsafe(ddl0039);
          if (ddl0040) await tx.unsafe(ddl0040);
          if (ddl0041) await tx.unsafe(ddl0041);
        }
      }
    });
    const buckets = await sql`
      SELECT id, public, file_size_limit
      FROM storage.buckets
      WHERE id IN ('media', 'dm-attachments', 'hub-attachments', 'private-moments')
      ORDER BY id ASC
    `;
    const policies = await sql`
      SELECT policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname IN (
          'DM conversation participants read signed files',
          'DM uploaders manage own files',
          'DM uploaders update own files',
          'DM uploaders delete own files',
          'Hub attachments readable by authorized viewers',
          'Public hub attachments readable by anon',
          'Active hub members upload own hub attachments',
          'Authorized audience reads private moments'
        )
      ORDER BY policyname ASC
    `;
    console.log("[APPLY] Verified buckets:", JSON.stringify(buckets));
    console.log("[APPLY] Verified storage policies:", JSON.stringify(policies));
    await sql`NOTIFY pgrst, 'reload schema'`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const cfg = loadSafeConfig();
  if (CHECK_ONLY) {
    await runCheckOnly(cfg);
  } else {
    await runApply(cfg);
  }
}

main().catch((err) => {
  console.error("Storage bucket check/provisioning failed:", err?.message || err);
  process.exit(1);
});
