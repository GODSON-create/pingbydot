#!/usr/bin/env node
/**
 * PING by DOT — Offline Migration Consistency & SQL Security Static Verifier
 *
 * Strictly read-only local verification (requires zero remote credentials and
 * makes zero network or database calls).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "drizzle", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

const errors = [];
const checks = [];

function fail(msg) {
  errors.push(msg);
}

function pass(msg) {
  checks.push(msg);
}

function stripLineComments(sql) {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

// 1. Journal sequential ordering & disk parity
const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
const entries = Array.isArray(journal.entries) ? journal.entries : [];
if (entries.length === 0) {
  fail("_journal.json contains no migration entries");
}

const journalFiles = new Set();
let prevWhen = -1;
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  if (e.idx !== i) {
    fail(`_journal.json entry ${i} has non-sequential idx=${e.idx}`);
  }
  const expectedPrefix = String(i).padStart(4, "0") + "_";
  if (!String(e.tag || "").startsWith(expectedPrefix)) {
    fail(`_journal.json entry idx=${i} tag '${e.tag}' does not start with '${expectedPrefix}'`);
  }
  if (typeof e.when !== "number" || e.when <= prevWhen) {
    fail(`_journal.json entry idx=${i} (${e.tag}) has non-monotonic timestamp when=${e.when}`);
  }
  prevWhen = e.when;

  const fileName = `${e.tag}.sql`;
  if (journalFiles.has(fileName)) {
    fail(`Duplicate migration tag in _journal.json: ${e.tag}`);
  }
  journalFiles.add(fileName);

  const fullPath = path.join(MIGRATIONS_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    fail(`Missing SQL file referenced by _journal.json: ${fileName}`);
  }
}

const diskSqlFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const f of diskSqlFiles) {
  if (!journalFiles.has(f)) {
    fail(`Unjournaled SQL migration file on disk: ${f}`);
  }
}

if (errors.length === 0) {
  pass(
    `Journal & disk parity verified: ${entries.length} sequential migrations (0000..${String(entries.length - 1).padStart(4, "0")})`,
  );
}

// 2. Global SQL hygiene & defect regression checks across all migrations
for (const file of diskSqlFiles) {
  const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  const uncommented = stripLineComments(raw);

  if (/\bUSING\s*\(\s*true\s*\)/i.test(uncommented)) {
    fail(`${file}: contains forbidden USING (true) RLS policy`);
  }
  if (/\bWITH\s+CHECK\s*\(\s*true\s*\)/i.test(uncommented)) {
    fail(`${file}: contains forbidden WITH CHECK (true) RLS policy`);
  }
  if (/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i.test(uncommented)) {
    fail(`${file}: contains invalid PostgreSQL DROP POLICY ... FOR ... syntax`);
  }
  if (/INSERT\s+INTO\s+public\.dot_transactions\s*\([^)]*\bsource_ref\b/i.test(uncommented)) {
    fail(`${file}: inserts into non-existent dot_transactions.source_ref (must be reference_id)`);
  }
  if (/INSERT\s+INTO\s+public\.notifications\s*\([^)]*\bcategory\b/i.test(uncommented)) {
    fail(`${file}: inserts into non-existent notifications.category (must be kind)`);
  }

  // Verify balanced $$ dollar-quote delimiters
  const dollarQuotes = (uncommented.match(/\$\$/g) || []).length;
  if (dollarQuotes % 2 !== 0) {
    fail(`${file}: unbalanced $$ dollar-quote count (${dollarQuotes})`);
  }
}
pass("Global SQL security & regression scan: 0 USING(true), 0 source_ref/category bugs, balanced $$");

// 3. Stage 1 specific migration repair & hardening checks
const readMig = (name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");

const sql0029 = readMig("0029_phase2_social_messaging_hubs_signals_notifications.sql");
const sql0031 = readMig("0031_phase4_business_commerce_ads_and_wallet.sql");
const sql0032 = readMig("0032_phase5_griot_developer_offline_and_scale.sql");
const sql0033 = readMig("0033_premium_ux_dot_economy_and_interactions.sql");
const sql0035 = readMig("0035_admin_control_centre_and_early_access.sql");
const sql0037 = readMig("0037_stage1_messaging_privacy_and_security_hardening.sql");

if (!sql0029.includes("conversation_members_role_check") || !sql0029.includes("'owner', 'admin', 'member'")) {
  fail("0029 missing conversation_members.role CHECK repair for 'owner'");
}
if (!sql0029.includes("ALTER COLUMN ping_id DROP NOT NULL") || !sql0029.includes("notifications_kind_check")) {
  fail("0029 missing public.notifications schema reconciliation with 0005");
}
if (!sql0031.includes("reference_id") || sql0031.includes("source_ref")) {
  fail("0031 still references source_ref instead of reference_id");
}
if (sql0032.includes("coalesce(summary, '')") || sql0032.includes("coalesce(organization_name, '')")) {
  fail("0032 signal_opportunities_fts_gin_idx still references non-existent summary/organization_name columns");
}
if (!sql0033.includes("reference_id") || sql0033.includes("source_ref")) {
  fail("0033 still references source_ref instead of reference_id");
}
for (const action of ["hide_comment", "restore_comment", "resolve_comment_report"]) {
  if (!sql0035.includes(`'${action}'`)) {
    fail(`0035 admin_moderate missing restored action '${action}'`);
  }
  if (!sql0037.includes(`'${action}'`)) {
    fail(`0037 admin_moderate safety net missing action '${action}'`);
  }
}
pass("All 5 pending migration repairs verified in 0029, 0031, 0032, 0033, 0035, and 0037");

const required0037Markers = [
  "REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM PUBLIC, anon, authenticated;",
  "REVOKE INSERT, UPDATE, DELETE ON public.conversation_members FROM PUBLIC, anon, authenticated;",
  "GRANT UPDATE (is_muted, is_archived, hidden_at, last_read_at) ON public.conversation_members TO authenticated;",
  "CREATE OR REPLACE FUNCTION public.guard_conversation_members()",
  "REVOKE INSERT, UPDATE, DELETE ON public.conversation_messages FROM PUBLIC, anon, authenticated;",
  "REVOKE INSERT, UPDATE, DELETE ON public.private_messages FROM PUBLIC, anon, authenticated;",
  "CREATE UNIQUE INDEX IF NOT EXISTS conversations_direct_pair_uidx",
  "CREATE UNIQUE INDEX IF NOT EXISTS private_messages_one_pending_request_uidx",
  "pg_advisory_xact_lock(hashtextextended('ping_direct_conv:' || v_pair_key, 0))",
  "pg_advisory_xact_lock(hashtextextended('ping_send_conv:' || p_conversation_id::text, 0))",
  "CREATE OR REPLACE FUNCTION public.is_blocked_with(",
  "CREATE OR REPLACE FUNCTION public.is_conversation_blocked_for_me(",
  "CREATE OR REPLACE FUNCTION public.assert_can_send_to_conversation(",
  "CREATE OR REPLACE FUNCTION public.guard_private_message_write()",
  "CREATE OR REPLACE FUNCTION public.accept_message_request(",
  "CREATE OR REPLACE FUNCTION public.decline_message_request(",
  "CREATE OR REPLACE FUNCTION public.update_group_member_role(",
  "CREATE OR REPLACE FUNCTION public.can_view_profile_content(",
  "SELECT coalesce(read_receipts_enabled, true)",
  "WHERE upp.user_id = pm.sender_id",
  "coalesce(c.request_status, 'accepted') = 'accepted'",
  "NOT public.is_conversation_blocked_for_me(c.id)",
];

for (const marker of required0037Markers) {
  if (!sql0037.includes(marker)) {
    fail(`0037 missing required security hardening marker: ${marker}`);
  }
}
pass(`Stage 1 (0037) security markers verified (${required0037Markers.length}/${required0037Markers.length})`);

// 4. Stage 2 storage hardening (0038) & scalable Chat Retention (0039) checks
const sql0038 = readMig("0038_stage2_storage_buckets_rls_and_media_assets.sql");
const sql0039 = readMig("0039_stage2_scalable_chat_retention_system.sql");

const required0038Markers = [
  "'hub-attachments'",
  "'private-moments'",
  'DROP POLICY IF EXISTS "Media is public" ON storage.objects;',
  'CREATE POLICY "Hub attachments readable by authorized viewers" ON storage.objects',
  'CREATE POLICY "Active hub members upload own hub attachments" ON storage.objects',
  'CREATE POLICY "Hub uploaders or staff delete hub attachments" ON storage.objects',
  "CREATE OR REPLACE FUNCTION public.can_access_private_moment_object(",
  'CREATE POLICY "Authorized audience reads private moments" ON storage.objects',
  "CREATE TABLE IF NOT EXISTS public.media_deletion_queue",
  "CREATE OR REPLACE FUNCTION public.enqueue_media_object_deletion(",
  "CREATE OR REPLACE FUNCTION public.enqueue_orphaned_staging_media(",
];

for (const marker of required0038Markers) {
  if (!sql0038.includes(marker)) {
    fail(`0038 missing required storage hardening marker: ${marker}`);
  }
}

const required0039Markers = [
  "CREATE TABLE IF NOT EXISTS public.app_feature_flags",
  "CREATE TABLE IF NOT EXISTS public.chat_retention_entitlement_rules",
  "CREATE OR REPLACE FUNCTION public.resolve_user_chat_retention_entitlement(",
  "CREATE OR REPLACE FUNCTION public.resolve_conversation_max_retention_policy(",
  "CREATE OR REPLACE FUNCTION public.guard_user_privacy_retention()",
  "CREATE INDEX IF NOT EXISTS private_messages_expiry_due_idx",
  "CREATE OR REPLACE FUNCTION public.set_conversation_retention_policy(",
  "CREATE OR REPLACE FUNCTION public.toggle_save_private_message(",
  "CREATE TABLE IF NOT EXISTS public.chat_retention_deletion_audit",
  "CREATE OR REPLACE FUNCTION public.process_expired_private_messages_batch(",
  "CREATE OR REPLACE FUNCTION public.claim_media_deletion_jobs(",
  "CREATE OR REPLACE FUNCTION public.complete_media_deletion_job(",
  "CREATE OR REPLACE FUNCTION public.get_chat_retention_metrics()",
];

for (const marker of required0039Markers) {
  if (!sql0039.includes(marker)) {
    fail(`0039 missing required chat retention marker: ${marker}`);
  }
}
pass(
  `Stage 2 (0038 & 0039) storage & chat retention markers verified (${required0038Markers.length + required0039Markers.length}/${required0038Markers.length + required0039Markers.length})`,
);

// 5. Stage 2 Phase 1 P0 Security Remediation (0040) checks
const sql0040 = readMig("0040_stage2_phase1_security_remediation.sql");
const required0040Markers = [
  "CREATE OR REPLACE FUNCTION public.is_allowed_storage_bucket(",
  "CREATE OR REPLACE FUNCTION public.validate_storage_object_scope(",
  "CREATE OR REPLACE FUNCTION public.lookup_authoritative_storage_object(",
  "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.media_assets FROM PUBLIC, anon, authenticated;",
  "CREATE OR REPLACE FUNCTION public.guard_media_assets_write()",
  "CREATE OR REPLACE FUNCTION public.is_storage_object_actively_referenced(",
  "CREATE OR REPLACE FUNCTION public.register_my_media_asset(",
  "CREATE OR REPLACE FUNCTION public.register_server_media_asset(",
  "CREATE OR REPLACE FUNCTION public.guard_hub_message_write()",
  "CREATE OR REPLACE FUNCTION public.mark_hub_message_media_ready()",
  "CREATE OR REPLACE FUNCTION public.mark_moment_media_ready()",
  "pg_advisory_xact_lock(hashtextextended('ping_save_quota:' || v_caller::text, 0))",
  "Aborted: storage object is actively referenced by live content",
  "storage.foldername(storage.objects.name)",
  "CREATE OR REPLACE FUNCTION public.is_storage_object_pending_deletion(",
];

for (const marker of required0040Markers) {
  if (!sql0040.includes(marker)) {
    fail(`0040 missing required Phase 1 security remediation marker: ${marker}`);
  }
}
pass(`Stage 2 Phase 1 (0040) P0 security remediation markers verified (${required0040Markers.length}/${required0040Markers.length})`);

// 6. Stage 2 Phase 2 Security, Reliability, R2 & Retention (0041) checks
const sql0041 = readMig("0041_stage2_phase2_security_reliability_and_retention.sql");
const required0041Markers = [
  "ADD COLUMN IF NOT EXISTS claimed_at timestamptz",
  "CREATE INDEX IF NOT EXISTS private_messages_conv_media_url_idx",
  "CREATE INDEX IF NOT EXISTS private_messages_24h_unviewed_idx",
  "CREATE OR REPLACE FUNCTION public.can_read_dm_media_object(",
  "CREATE OR REPLACE FUNCTION public.can_access_private_moment_object(",
  'CREATE POLICY "Public hub attachments readable by anon" ON storage.objects',
  "q.claimed_at < now() - interval '10 minutes'",
  "'permanently_failed_jobs', v_permanently_failed_count",
  "WHEN 'institution' THEN 'premium_eligible'",
  "CREATE OR REPLACE FUNCTION public.recalculate_private_message_save_state(",
  "CREATE TRIGGER sync_private_message_after_saved_delete",
  "CREATE TRIGGER purge_saved_messages_on_soft_delete",
  "CREATE OR REPLACE FUNCTION public.get_conversation_retention_info(",
  "CREATE TRIGGER guard_moment_audience_bucket_boundary",
  "CREATE OR REPLACE FUNCTION public.publish_moment_as_clip(",
];

for (const marker of required0041Markers) {
  if (!sql0041.includes(marker)) {
    fail(`0041 missing required Phase 2 remediation marker: ${marker}`);
  }
}
pass(
  `Stage 2 Phase 2 (0041) security & reliability markers verified (${required0041Markers.length}/${required0041Markers.length})`,
);

for (const line of checks) {
  console.log(`  PASS: ${line}`);
}

if (errors.length > 0) {
  console.error("\nMigration consistency check FAILED:");
  for (const err of errors) {
    console.error(`  FAIL: ${err}`);
  }
  process.exit(1);
}

console.log("\nALL OFFLINE MIGRATION CONSISTENCY & SQL SECURITY CHECKS PASSED.");
