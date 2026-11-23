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

  for (const probe of [mediaProbe, dmProbe]) {
    console.log(
      `  Bucket '${probe.bucketId}': ${probe.exists ? "PRESENT" : "MISSING"} (HTTP ${probe.status} — ${probe.detail})`,
    );
  }

  if (!mediaProbe.exists || !dmProbe.exists) {
    console.error(
      "\nACTION REQUIRED: One or more required Storage buckets are missing on Supabase project " +
        `'${EXPECTED_PROJECT_REF}'.\n` +
        "After owner approval, apply migrations via `npm run db:migrate` (recommended) or " +
        "`node scripts/provision-storage-buckets.mjs --apply` with LOVABLE_DB_MIGRATION_URL set.",
    );
    process.exit(1);
  }

  console.log("\nOK: Both 'media' and 'dm-attachments' buckets are provisioned.");
}

async function runApply(cfg) {
  const { port } = validateMigrationUrl(cfg.migrationUrl);
  const sqlFilePath = path.resolve(
    process.cwd(),
    "drizzle/migrations/0036_storage_buckets_dm_rls_and_voice_preview.sql",
  );
  if (!fs.existsSync(sqlFilePath)) {
    console.error(`Missing migration SQL file: ${sqlFilePath}`);
    process.exit(1);
  }
  const ddl = fs.readFileSync(sqlFilePath, "utf8");
  const sql0037Path = path.resolve(
    process.cwd(),
    "drizzle/migrations/0037_stage1_messaging_privacy_and_security_hardening.sql",
  );
  const ddl0037 = fs.existsSync(sql0037Path) ? fs.readFileSync(sql0037Path, "utf8") : null;

  console.log(
    `[APPLY] Connecting to PING Supabase PostgreSQL (port ${port}, project=${EXPECTED_PROJECT_REF})...`,
  );
  const sql = postgres(cfg.migrationUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      // Guard: if Stage 1 (0037) schema is already present, re-apply 0037 idempotently
      // so running standalone bucket provisioning never downgrades 0037 messaging/storage RLS.
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
    });
    const buckets = await sql`
      SELECT id, public, file_size_limit
      FROM storage.buckets
      WHERE id IN ('media', 'dm-attachments')
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
          'DM uploaders delete own files'
        )
      ORDER BY policyname ASC
    `;
    console.log("[APPLY] Verified buckets:", JSON.stringify(buckets));
    console.log("[APPLY] Verified DM storage policies:", JSON.stringify(policies));
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
