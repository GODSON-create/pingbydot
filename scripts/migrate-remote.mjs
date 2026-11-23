#!/usr/bin/env node
/**
 * PING by DOT — Remote Supabase Drizzle Migration & Verification Runner
 *
 * Applies pending Drizzle migrations tracked in `drizzle/migrations/meta/_journal.json`
 * (covering 0011–0020 and any subsequent entries) using the official Drizzle PostgreSQL
 * migrator (`drizzle-orm/postgres-js/migrator`) against `LOVABLE_DB_MIGRATION_URL`.
 *
 * Explicitly separates:
 *   1. SCHEMA VERIFICATION (Phase 6): ledger entries, 31 tables + RLS, indexes, functions.
 *   2. PERSISTENCE & AUTHORIZATION TESTING (Phase 7): isolated multi-account transactional
 *      tests with `SET LOCAL ROLE authenticated` covering:
 *        - Moments & Close Circle privacy (anti-enumeration + public Moment preservation)
 *        - Direct Messages two-account isolation & membership RPC spoof protection
 *        - Hub Forums & Institutional Broadcast audience/permission enforcement
 *        - DOT Wallet ownership, duplicate prevention, and ledger immutability
 *
 * SECURITY:
 *   - Never logs or prints database credentials or connection strings.
 *   - Blocks connections to any project other than PING (`exlttyafomvqfwgzzjrm`).
 *   - Blocks the shared transaction pooler (port 6543).
 *   - Never swallows SQL errors or reports skipped tests as passed.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const EXPECTED_PROJECT_REF = "exlttyafomvqfwgzzjrm";
const VERIFY_ONLY = process.argv.includes("--verify-only");
const SKIP_WRITE_TESTS = process.argv.includes("--skip-write-tests");

class VerificationRollbackSignal extends Error {
  constructor(results) {
    super("Intentional post-test rollback to preserve clean database state");
    this.name = "VerificationRollbackSignal";
    this.results = results;
  }
}

function loadDotEnvFallback() {
  const trackedEnvPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(trackedEnvPath)) {
    const trackedContent = fs.readFileSync(trackedEnvPath, "utf8");
    if (/^LOVABLE_DB_MIGRATION_URL\s*=/m.test(trackedContent)) {
      console.error(
        "SECURITY BLOCK: LOVABLE_DB_MIGRATION_URL was found in the git-tracked '.env' file.\n" +
          "Move it to '.env.local' (git-ignored) or '~/.env', or pass it via process environment.",
      );
      process.exit(2);
    }
  }

  const candidateFiles = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(os.homedir(), ".env"),
  ];
  for (const envPath of candidateFiles) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      const val = match[2].replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

function validateMigrationUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) {
    console.error("======================================================================");
    console.error("BLOCKED: Missing required environment secret LOVABLE_DB_MIGRATION_URL");
    console.error("======================================================================");
    console.error("Target Supabase Project: " + EXPECTED_PROJECT_REF);
    console.error(
      "Configure LOVABLE_DB_MIGRATION_URL with the direct PostgreSQL connection string\n" +
        "(port 5432) or Session Pooler connection string (port 5432) for Supabase project\n" +
        `'${EXPECTED_PROJECT_REF}' before running 'npm run db:migrate'.`,
    );
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
    console.error(
      "BLOCKED: Port 6543 is the Supabase shared transaction pooler.\n" +
        `Use the direct connection (db.${EXPECTED_PROJECT_REF}.supabase.co:5432) or Session Pooler (:5432) for Drizzle migrations.`,
    );
    process.exit(2);
  }

  const hostAndUser = `${parsed.hostname} ${decodeURIComponent(parsed.username)}`.toLowerCase();
  const supabaseRefMatch =
    parsed.hostname.match(/^db\.([a-z0-9]{15,25})\.supabase\.co$/i) ||
    decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]{15,25})$/i);

  if (supabaseRefMatch && supabaseRefMatch[1].toLowerCase() !== EXPECTED_PROJECT_REF) {
    console.error(
      `BLOCKED: Connection URL points to project '${supabaseRefMatch[1]}', ` +
        `which does NOT match PING's Supabase project ('${EXPECTED_PROJECT_REF}'). Aborting.`,
    );
    process.exit(2);
  }

  if (hostAndUser.includes("avantage")) {
    console.error("BLOCKED: Refusing to connect to non-PING database. Aborting.");
    process.exit(2);
  }

  return {
    port,
    isDirectHost: parsed.hostname.toLowerCase().includes(EXPECTED_PROJECT_REF),
  };
}

function readReleaseMigrations() {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle/migrations");
  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = journal.entries.filter((e) => e.idx >= 11).map((e) => {
    const raw = fs.readFileSync(path.join(migrationsFolder, `${e.tag}.sql`), "utf8");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    return { idx: e.idx, tag: e.tag, when: String(e.when), hash };
  });
  return { migrationsFolder, allEntriesCount: journal.entries.length, releaseEntries: entries };
}

const REQUIRED_TABLES_0011_0020 = [
  "user_privacy_preferences",
  "hub_messages",
  "ping_read_receipts",
  "signals",
  "signal_publishers",
  "signal_followers",
  "signal_posts",
  "signal_reads",
  "moments",
  "moment_views",
  "moment_likes",
  "moment_replies",
  "moment_repings",
  "highlights",
  "highlight_items",
  "user_close_circle",
  "conversations",
  "conversation_members",
  "private_messages",
  "conversation_messages",
  "user_blocks",
  "hub_message_reactions",
  "dot_wallets",
  "dot_transactions",
  "account_subscriptions",
  "profile_reports",
  "saved_pings",
  "hub_forums",
  "hub_forum_members",
  "hub_forum_posts",
  "hub_broadcasts",
  "hub_broadcast_reads",
  "signal_messages",
];

async function runSchemaVerification(sql, releaseEntries) {
  const minTag = releaseEntries[0]?.tag.slice(0, 4) ?? "0011";
  const maxTag = releaseEntries[releaseEntries.length - 1]?.tag.slice(0, 4) ?? "0020";

  const ledgerRows = await sql`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id ASC
  `;

  const recordedWhen = new Set(ledgerRows.map((r) => String(r.created_at)));
  const recordedHash = new Set(ledgerRows.map((r) => String(r.hash)));
  const missingMigrations = releaseEntries.filter(
    (e) => !recordedWhen.has(e.when) && !recordedHash.has(e.hash),
  );

  if (missingMigrations.length > 0) {
    throw new Error(
      `Schema Verification FAILED — unrecorded migrations (${minTag}–${maxTag}): ${missingMigrations.map((m) => m.tag).join(", ")}`,
    );
  }

  const tableRows = await sql`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY(${REQUIRED_TABLES_0011_0020})
    ORDER BY c.relname
  `;
  const foundMap = new Map(tableRows.map((r) => [r.table_name, r.rls_enabled]));
  const missingTables = REQUIRED_TABLES_0011_0020.filter((t) => !foundMap.has(t));
  const rlsDisabled = REQUIRED_TABLES_0011_0020.filter((t) => foundMap.get(t) === false);

  if (missingTables.length > 0) {
    throw new Error(`Schema Verification FAILED — missing tables: ${missingTables.join(", ")}`);
  }
  if (rlsDisabled.length > 0) {
    throw new Error(`Schema Verification FAILED — RLS disabled on: ${rlsDisabled.join(", ")}`);
  }

  const [{ dot_idx_present: dotIdxPresent }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'dot_transactions'
        AND indexname = 'dot_transactions_user_source_ref_uidx'
    ) AS dot_idx_present
  `;
  if (!dotIdxPresent) {
    throw new Error("Schema Verification FAILED — missing unique index dot_transactions_user_source_ref_uidx");
  }

  const [{ svc_tx_truncate, svc_tx_update, anon_cc_exec }] = await sql`
    SELECT
      has_table_privilege('service_role', 'public.dot_transactions', 'TRUNCATE') AS svc_tx_truncate,
      has_table_privilege('service_role', 'public.dot_transactions', 'UPDATE') AS svc_tx_update,
      has_function_privilege('anon', 'public.is_close_circle_member(uuid, uuid)', 'EXECUTE') AS anon_cc_exec
  `;
  if (svc_tx_truncate || svc_tx_update || anon_cc_exec) {
    throw new Error(
      `Schema Verification FAILED — excessive privileges detected (svc_tx_truncate=${svc_tx_truncate}, svc_tx_update=${svc_tx_update}, anon_cc_exec=${anon_cc_exec})`,
    );
  }

  const [{ media_bucket_present: mediaBucketPresent, dm_bucket_private: dmBucketPrivate, dm_policy_count: dmPolicyCount }] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'media' AND public = true
      ) AS media_bucket_present,
      EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'dm-attachments' AND public = false
      ) AS dm_bucket_private,
      (
        SELECT count(*)::int FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname IN (
            'DM conversation participants read signed files',
            'DM uploaders manage own files',
            'DM uploaders update own files',
            'DM uploaders delete own files'
          )
      ) AS dm_policy_count
  `;
  if (!mediaBucketPresent || !dmBucketPrivate || dmPolicyCount < 4) {
    throw new Error(
      `Schema Verification FAILED — storage bucket/policy mismatch (media=${mediaBucketPresent}, dm_private=${dmBucketPrivate}, dm_policies=${dmPolicyCount}/4; apply migrations 0021/0027/0036)`,
    );
  }

  const [{ pathways_col_present: pathwaysColPresent, onboarding_col_present: onboardingColPresent, country_col_present: countryColPresent, interests_col_present: interestsColPresent, anon_onb_exec: anonOnbExec }] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'participation_pathways'
      ) AS pathways_col_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'onboarding_completed_at'
      ) AS onboarding_col_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'country'
      ) AS country_col_present,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'interests'
      ) AS interests_col_present,
      has_function_privilege('anon', 'public.complete_my_onboarding(text, text, text, text, text[], boolean, text, text[], boolean)', 'EXECUTE') AS anon_onb_exec
  `;
  if (!pathwaysColPresent || !onboardingColPresent || !countryColPresent || !interestsColPresent || anonOnbExec) {
    throw new Error(
      `Schema Verification FAILED — onboarding schema/privilege mismatch (pathways=${pathwaysColPresent}, onboarding=${onboardingColPresent}, country=${countryColPresent}, interests=${interestsColPresent}, anon_onb_exec=${anonOnbExec})`,
    );
  }

  const [{ ev_rls, out_rls, anon_ev_ins, auth_ev_ins, auth_ver_exec }] = await sql`
    SELECT
      coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.economic_events'::regclass), false) AS ev_rls,
      coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.verified_economic_outcomes'::regclass), false) AS out_rls,
      has_table_privilege('anon', 'public.economic_events', 'INSERT') AS anon_ev_ins,
      has_table_privilege('authenticated', 'public.economic_events', 'INSERT') AS auth_ev_ins,
      has_function_privilege(
        'authenticated',
        'public.record_verified_economic_outcome(text, uuid, uuid, char, bigint, bigint, text, text, text, uuid, text, text, text, jsonb)',
        'EXECUTE'
      ) AS auth_ver_exec
  `;
  if (!ev_rls || !out_rls || anon_ev_ins || auth_ev_ins || auth_ver_exec) {
    throw new Error(
      `Schema Verification FAILED — economic measurement security mismatch (ev_rls=${ev_rls}, out_rls=${out_rls}, anon_ev_ins=${anon_ev_ins}, auth_ev_ins=${auth_ev_ins}, auth_ver_exec=${auth_ver_exec})`,
    );
  }

  const [{ av_rls, va_rls, mo_rls, anon_av_ins, auth_av_ins }] = await sql`
    SELECT
      coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.account_verifications'::regclass), false) AS av_rls,
      coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.verification_audit'::regclass), false) AS va_rls,
      coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.monetization_offerings'::regclass), false) AS mo_rls,
      has_table_privilege('anon', 'public.account_verifications', 'INSERT') AS anon_av_ins,
      has_table_privilege('authenticated', 'public.account_verifications', 'INSERT') AS auth_av_ins
  `;
  if (!av_rls || !va_rls || !mo_rls || anon_av_ins || auth_av_ins) {
    throw new Error(
      `Schema Verification FAILED — verification foundation security mismatch (av_rls=${av_rls}, va_rls=${va_rls}, mo_rls=${mo_rls}, anon_av_ins=${anon_av_ins}, auth_av_ins=${auth_av_ins})`,
    );
  }

  const [{ mutes_rls, anon_export_exec, location_col, website_col, vis_col }] = await sql`
    SELECT
      coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_mutes'::regclass), false) AS mutes_rls,
      has_function_privilege('anon', 'public.export_my_account_data()', 'EXECUTE') AS anon_export_exec,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'location'
      ) AS location_col,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'website_url'
      ) AS website_col,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'profile_visibility'
      ) AS vis_col
  `;
  if (!mutes_rls || anon_export_exec || !location_col || !website_col || !vis_col) {
    throw new Error(
      `Schema Verification FAILED — Phase 1 profile/mute/export schema mismatch (mutes_rls=${mutes_rls}, anon_export_exec=${anon_export_exec}, location=${location_col}, website=${website_col}, visibility=${vis_col})`,
    );
  }

  const [{ p2_rls_count, anon_group_exec, anon_opp_exec }] = await sql`
    SELECT
      (
        SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
          AND c.relname = ANY(ARRAY[
            'user_saved_accounts', 'user_topic_follows', 'ping_reactions',
            'ping_polls', 'ping_poll_options', 'ping_poll_votes',
            'private_message_reactions', 'saved_messages',
            'hub_events', 'hub_event_rsvps',
            'signal_opportunities', 'signal_applications', 'notifications'
          ])
      ) AS p2_rls_count,
      has_function_privilege('anon', 'public.create_group_conversation(text, text, uuid[], boolean)', 'EXECUTE') AS anon_group_exec,
      has_function_privilege('anon', 'public.submit_signal_application(uuid, text, text)', 'EXECUTE') AS anon_opp_exec
  `;
  if (p2_rls_count < 13 || anon_group_exec || anon_opp_exec) {
    throw new Error(
      `Schema Verification FAILED — Phase 2 schema/privilege mismatch (rls_count=${p2_rls_count}/13, anon_group=${anon_group_exec}, anon_opp=${anon_opp_exec})`,
    );
  }

  const [{ p3_rls_count, fmt_col_present }] = await sql`
    SELECT
      (
        SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
          AND c.relname = ANY(ARRAY[
            'media_assets', 'ping_video_views', 'copyright_reports',
            'music_tracks', 'content_music_attachments', 'share_events'
          ])
      ) AS p3_rls_count,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pings' AND column_name = 'content_format'
      ) AS fmt_col_present
  `;
  if (p3_rls_count < 6 || !fmt_col_present) {
    throw new Error(
      `Schema Verification FAILED — Phase 3 multimedia/music/share schema mismatch (rls_count=${p3_rls_count}/6, content_format=${fmt_col_present})`,
    );
  }

  const [{ p4_rls_count, auth_settle_exec, anon_biz_exec }] = await sql`
    SELECT
      (
        SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
          AND c.relname = ANY(ARRAY[
            'business_profiles', 'business_team_members', 'business_offerings',
            'business_reviews', 'business_enquiries', 'business_saved_replies',
            'creator_commercial_profiles', 'ad_campaigns', 'ad_reports',
            'hub_membership_plans'
          ])
      ) AS p4_rls_count,
      has_function_privilege('authenticated', 'public.settle_dot_topup_intent(text, text, integer, text)', 'EXECUTE') AS auth_settle_exec,
      has_function_privilege('anon', 'public.is_business_member(uuid, uuid, text[])', 'EXECUTE') AS anon_biz_exec
  `;
  if (p4_rls_count < 10 || auth_settle_exec || anon_biz_exec) {
    throw new Error(
      `Schema Verification FAILED — Phase 4 business/wallet security mismatch (rls_count=${p4_rls_count}/10, auth_settle=${auth_settle_exec}, anon_biz=${anon_biz_exec})`,
    );
  }

  const [{ p5_rls_count, auth_verify_key_exec, anon_rl_exec, locale_col_present }] = await sql`
    SELECT
      (
        SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
          AND c.relname = ANY(ARRAY[
            'griot_ai_preferences', 'griot_audit_logs', 'developer_apps',
            'oauth_authorization_codes', 'oauth_access_tokens', 'developer_api_keys',
            'developer_webhooks', 'developer_webhook_deliveries', 'api_rate_limits'
          ])
      ) AS p5_rls_count,
      has_function_privilege('authenticated', 'public.verify_api_key_hash(text)', 'EXECUTE') AS auth_verify_key_exec,
      has_function_privilege('anon', 'public.check_server_rate_limit(text, integer, integer)', 'EXECUTE') AS anon_rl_exec,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'preferred_locale'
      ) AS locale_col_present
  `;
  if (p5_rls_count < 9 || auth_verify_key_exec || anon_rl_exec || !locale_col_present) {
    throw new Error(
      `Schema Verification FAILED — Phase 5 GRIOT/developer/scale security mismatch (rls_count=${p5_rls_count}/9, auth_verify_key=${auth_verify_key_exec}, anon_rl=${anon_rl_exec}, preferred_locale=${locale_col_present})`,
    );
  }

  const [{ p6_rls_count, auth_ent_ins, anon_sub_exec, anon_boost_exec }] = await sql`
    SELECT
      (
        SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
          AND c.relname = ANY(ARRAY[
            'membership_plans', 'subscription_entitlements', 'subscription_receipts',
            'boost_campaigns', 'boost_campaign_events', 'boost_campaign_reports',
            'boost_refund_audit', 'dot_tags', 'ping_dot_tags', 'user_dot_tag_follows'
          ])
      ) AS p6_rls_count,
      has_table_privilege('authenticated', 'public.subscription_entitlements', 'INSERT') AS auth_ent_ins,
      has_function_privilege('anon', 'public.subscribe_with_dots(text, text)', 'EXECUTE') AS anon_sub_exec,
      has_function_privilege('anon', 'public.create_boost_campaign(text, uuid, integer, text, text[], text[], text)', 'EXECUTE') AS anon_boost_exec
  `;
  if (p6_rls_count < 10 || auth_ent_ins || anon_sub_exec || anon_boost_exec) {
    throw new Error(
      `Schema Verification FAILED — Premium UX/DOT economy security mismatch (rls_count=${p6_rls_count}/10, auth_ent_ins=${auth_ent_ins}, anon_sub=${anon_sub_exec}, anon_boost=${anon_boost_exec})`,
    );
  }

  const [{ p7_rls_count, auth_learn_ent_ins, auth_spot_pub_ins, anon_spot_exec, anon_clip_conv }] =
    await sql`
      SELECT
        (
          SELECT count(*)::int FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
            AND c.relname = ANY(ARRAY[
              'learn_courses', 'course_release_schedules', 'course_entitlements',
              'learn_course_progress', 'learn_audit_logs',
              'spotlight_rubric_config', 'spotlight_candidates', 'spotlight_nominations',
              'spotlight_evaluations', 'spotlight_publications',
              'spotlight_distribution_records', 'spotlight_editorial_audit_logs',
              'ping_clips', 'clip_media_relationships', 'clip_likes',
              'clip_saves', 'clip_replies', 'clip_reports'
            ])
        ) AS p7_rls_count,
        has_table_privilege('authenticated', 'public.course_entitlements', 'INSERT') AS auth_learn_ent_ins,
        has_table_privilege('authenticated', 'public.spotlight_publications', 'INSERT') AS auth_spot_pub_ins,
        has_function_privilege('anon', 'public.submit_spotlight_story(text, text, text, text, uuid, text[])', 'EXECUTE') AS anon_spot_exec,
        has_function_privilege('anon', 'public.publish_moment_as_clip(uuid, text, text, text[])', 'EXECUTE') AS anon_clip_conv
    `;
  if (
    p7_rls_count < 18 ||
    auth_learn_ent_ins ||
    auth_spot_pub_ins ||
    anon_spot_exec ||
    anon_clip_conv
  ) {
    throw new Error(
      `Schema Verification FAILED — Ping Learn/Spotlight/Clips security mismatch (rls_count=${p7_rls_count}/18, auth_learn_ent_ins=${auth_learn_ent_ins}, auth_spot_pub_ins=${auth_spot_pub_ins}, anon_spot=${anon_spot_exec}, anon_clip=${anon_clip_conv})`,
    );
  }

  const [
    { p8_rls_count, auth_role_ins, auth_appt_ins, auth_metrics_exec, anon_appoint_exec },
  ] = await sql`
    SELECT
      (
        SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
          AND c.relname = ANY(ARRAY[
            'admin_role_permissions', 'admin_user_permissions', 'admin_appointments',
            'user_presence_heartbeats', 'system_error_logs',
            'early_access_registrations', 'download_attribution_events'
          ])
      ) AS p8_rls_count,
      has_table_privilege('authenticated', 'public.user_roles', 'INSERT') AS auth_role_ins,
      has_table_privilege('authenticated', 'public.admin_appointments', 'INSERT') AS auth_appt_ins,
      has_function_privilege('authenticated', 'public.admin_control_centre_metrics()', 'EXECUTE') AS auth_metrics_exec,
      has_function_privilege('anon', 'public.owner_appoint_admin(uuid, text, text)', 'EXECUTE') AS anon_appoint_exec
  `;
  if (
    p8_rls_count < 7 ||
    auth_role_ins ||
    auth_appt_ins ||
    auth_metrics_exec ||
    anon_appoint_exec
  ) {
    throw new Error(
      `Schema Verification FAILED — Admin Control Centre & Early Access security mismatch (rls_count=${p8_rls_count}/7, auth_role_ins=${auth_role_ins}, auth_appt_ins=${auth_appt_ins}, auth_metrics_exec=${auth_metrics_exec}, anon_appoint_exec=${anon_appoint_exec})`,
    );
  }

  // Stage 1 (0037) schema repair & messaging/privacy security checks
  const [
    {
      auth_conv_ins,
      auth_cm_ins,
      auth_cm_del,
      auth_cm_role_upd,
      auth_pm_ins,
      auth_pm_del,
      auth_pm_status_upd,
      auth_legacy_cm_ins,
      direct_pair_uidx,
      pending_msg_uidx,
      req_status_col,
      dm_perm_col,
      notif_title_col,
      notif_ping_nullable,
      cm_owner_role_allowed,
      anon_accept_req_exec,
    },
  ] = await sql`
    SELECT
      has_table_privilege('authenticated', 'public.conversations', 'INSERT') AS auth_conv_ins,
      has_table_privilege('authenticated', 'public.conversation_members', 'INSERT') AS auth_cm_ins,
      has_table_privilege('authenticated', 'public.conversation_members', 'DELETE') AS auth_cm_del,
      has_column_privilege('authenticated', 'public.conversation_members', 'role', 'UPDATE') AS auth_cm_role_upd,
      has_table_privilege('authenticated', 'public.private_messages', 'INSERT') AS auth_pm_ins,
      has_table_privilege('authenticated', 'public.private_messages', 'DELETE') AS auth_pm_del,
      has_column_privilege('authenticated', 'public.private_messages', 'status', 'UPDATE') AS auth_pm_status_upd,
      has_table_privilege('authenticated', 'public.conversation_messages', 'INSERT') AS auth_legacy_cm_ins,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'conversations' AND indexname = 'conversations_direct_pair_uidx'
      ) AS direct_pair_uidx,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'private_messages' AND indexname = 'private_messages_one_pending_request_uidx'
      ) AS pending_msg_uidx,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'request_status'
      ) AS req_status_col,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_privacy_preferences' AND column_name = 'dm_permission'
      ) AS dm_perm_col,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'title'
      ) AS notif_title_col,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'ping_id' AND is_nullable = 'YES'
      ) AS notif_ping_nullable,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.conversation_members'::regclass
          AND conname = 'conversation_members_role_check'
          AND pg_get_constraintdef(oid) ILIKE '%owner%'
      ) AS cm_owner_role_allowed,
      has_function_privilege('anon', 'public.accept_message_request(uuid)', 'EXECUTE') AS anon_accept_req_exec
  `;
  if (
    auth_conv_ins ||
    auth_cm_ins ||
    auth_cm_del ||
    auth_cm_role_upd ||
    auth_pm_ins ||
    auth_pm_del ||
    auth_pm_status_upd ||
    auth_legacy_cm_ins ||
    !direct_pair_uidx ||
    !pending_msg_uidx ||
    !req_status_col ||
    !dm_perm_col ||
    !notif_title_col ||
    !notif_ping_nullable ||
    !cm_owner_role_allowed ||
    anon_accept_req_exec
  ) {
    throw new Error(
      `Schema Verification FAILED — Stage 1 (0037) messaging/privacy hardening mismatch (conv_ins=${auth_conv_ins}, cm_role_upd=${auth_cm_role_upd}, pm_status_upd=${auth_pm_status_upd}, req_status=${req_status_col}, dm_perm=${dm_perm_col}, owner_role=${cm_owner_role_allowed})`,
    );
  }

  console.log(
    `[SCHEMA VERIFIED] Ledger ${minTag}–${maxTag}: ${releaseEntries.length}/${releaseEntries.length} recorded (total rows=${ledgerRows.length}); ${REQUIRED_TABLES_0011_0020.length}/${REQUIRED_TABLES_0011_0020.length} tables with RLS; storage 'media' bucket, hardened indexes & privileges intact.`,
  );
}

async function runFeatureAuthTests(sql) {
  const results = [];
  const assertExpectThrow = async (tx, label, fn) => {
    const sp = `sp_${crypto.randomBytes(6).toString("hex")}`;
    await tx.unsafe(`SAVEPOINT ${sp}`);
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
      await tx.unsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
    } finally {
      await tx.unsafe(`RELEASE SAVEPOINT ${sp}`).catch(() => {});
    }
    if (!threw) {
      throw new Error(`Authorization assertion FAILED (expected rejection): ${label}`);
    }
  };

  try {
    await sql.begin(async (tx) => {
      const userA = "00000000-0000-4000-8000-00000000de01";
      const userB = "00000000-0000-4000-8000-00000000de02";
      const userC = "00000000-0000-4000-8000-00000000de03";

      await tx`
        INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
        VALUES
          (${userA}::uuid, 'mig_verify_a@pingbydot.internal', '{"username":"mig_verify_a","display_name":"Verify Builder A"}'::jsonb, now(), now()),
          (${userB}::uuid, 'mig_verify_b@pingbydot.internal', '{"username":"mig_verify_b","display_name":"Verify Builder B"}'::jsonb, now(), now()),
          (${userC}::uuid, 'mig_verify_c@pingbydot.internal', '{"username":"mig_verify_c","display_name":"Verify Builder C"}'::jsonb, now(), now())
      `;
      await tx`
        INSERT INTO public.profiles (id, username, display_name)
        VALUES
          (${userA}::uuid, 'mig_verify_a', 'Verify Builder A'),
          (${userB}::uuid, 'mig_verify_b', 'Verify Builder B'),
          (${userC}::uuid, 'mig_verify_c', 'Verify Builder C')
        ON CONFLICT (id) DO NOTHING
      `;

      const actAs = async (uid) => {
        if (!uid) {
          await tx`SET LOCAL ROLE anon`;
          await tx`SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)`;
        } else {
          await tx`SET LOCAL ROLE authenticated`;
          await tx`SELECT set_config('request.jwt.claim.sub', ${uid}, true), set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
        }
      };

      // 1. MOMENTS & CLOSE CIRCLE PRIVACY TEST
      await actAs(userA);
      await tx`INSERT INTO public.user_close_circle (user_id, member_id) VALUES (${userA}::uuid, ${userB}::uuid)`;
      const [pubMoment] = await tx`
        INSERT INTO public.moments (author_id, media_url, media_type, caption, audience)
        VALUES (${userA}::uuid, 'https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/pub.jpg', 'image', 'Public test moment', 'public')
        RETURNING id
      `;
      const [ccMoment] = await tx`
        INSERT INTO public.moments (author_id, media_url, media_type, caption, audience)
        VALUES (${userA}::uuid, 'https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/cc.jpg', 'image', 'Close Circle test moment', 'close_circle')
        RETURNING id
      `;

      // Public moment still readable anonymously without error even though close_circle rows exist
      await actAs(null);
      const [{ cnt: anonPubCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.moments WHERE id = ${pubMoment.id}::uuid`;
      const [{ cnt: anonCcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.moments WHERE id = ${ccMoment.id}::uuid`;
      await assertExpectThrow(tx, "anon calling is_close_circle_member", async () => {
        await tx`SELECT public.is_close_circle_member(${userA}::uuid, ${userB}::uuid)`;
      });

      await actAs(userB);
      const [{ cnt: bCcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.moments WHERE id = ${ccMoment.id}::uuid`;
      await assertExpectThrow(tx, "authenticated spoofing _member_id in is_close_circle_member", async () => {
        await tx`SELECT public.is_close_circle_member(${userA}::uuid, ${userC}::uuid)`;
      });

      await actAs(userC);
      const [{ cnt: cCcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.moments WHERE id = ${ccMoment.id}::uuid`;

      if (anonPubCnt !== 1 || anonCcCnt !== 0 || bCcCnt !== 1 || cCcCnt !== 0) {
        throw new Error(`Close Circle privacy mismatch: anonPub=${anonPubCnt}, anonCc=${anonCcCnt}, bCc=${bCcCnt}, cCc=${cCcCnt}`);
      }
      results.push("Moments & Close Circle privacy: PASS (public anon read preserved, Close Circle member B=1, outsider C=0, enumeration blocked)");

      // 2. TWO-ACCOUNT DIRECT MESSAGE ISOLATION & STAGE 1 MESSAGE-REQUEST SECURITY TEST (0037)
      await actAs(userA);
      const [{ conv_id: convId }] = await tx`SELECT public.get_or_create_direct_conversation(${userB}::uuid) AS conv_id`;
      // Non-mutual starts as pending message request: 1 text-only message allowed, 2nd or media blocked until accepted
      const [{ msg }] = await tx`SELECT public.send_private_message(${convId}::uuid, 'Two-account DM test') AS msg`;
      await assertExpectThrow(tx, "pending requester sending 2nd message before acceptance", async () => {
        await tx`SELECT public.send_private_message(${convId}::uuid, 'Second unaccepted message')`;
      });
      await assertExpectThrow(tx, "pending requester uploading DM attachment before acceptance", async () => {
        await tx`
          INSERT INTO storage.objects (bucket_id, name, owner, metadata)
          VALUES ('dm-attachments', ${`${convId}/${userA}/pre-accept.webm`}, ${userA}::uuid, '{"mimetype":"audio/webm"}'::jsonb)
        `;
      });
      await assertExpectThrow(tx, "pending requester self-accepting own message request", async () => {
        await tx`SELECT public.accept_message_request(${convId}::uuid)`;
      });
      await assertExpectThrow(tx, "client tampering with private_messages.status directly", async () => {
        await tx`UPDATE public.private_messages SET status = 'read' WHERE id = ${msg.id}::uuid`;
      });
      const [{ cnt: aMsgs }] = await tx`SELECT count(*)::int AS cnt FROM public.private_messages WHERE conversation_id = ${convId}::uuid AND id = ${msg.id}::uuid`;
      const [{ cnt: aMems }] = await tx`SELECT count(*)::int AS cnt FROM public.conversation_members WHERE conversation_id = ${convId}::uuid`;

      await actAs(userB);
      const [{ cnt: bMsgs }] = await tx`SELECT count(*)::int AS cnt FROM public.private_messages WHERE conversation_id = ${convId}::uuid`;
      const [{ cnt: bMems }] = await tx`SELECT count(*)::int AS cnt FROM public.conversation_members WHERE conversation_id = ${convId}::uuid`;
      const [{ summary: bInbox }] = await tx`SELECT public.get_my_conversations_summary(20, 0) AS summary`;
      const bConvUnread = Array.isArray(bInbox)
        ? (bInbox.find((c) => c.id === convId)?.unread_count ?? -1)
        : -1;
      // Reading a pending request before acceptance must NOT emit read receipts
      await tx`SELECT public.mark_conversation_read(${convId}::uuid)`;
      const [msgAfterPendingRead] = await tx`SELECT status FROM public.private_messages WHERE id = ${msg.id}::uuid`;
      if (msgAfterPendingRead?.status === "read") {
        throw new Error("Privacy violation: read receipt emitted on unaccepted message request");
      }
      // Recipient accepts request -> unlocks bidirectional chat & media/voice notes
      await tx`SELECT public.accept_message_request(${convId}::uuid)`;
      // Verify read_receipts_enabled=false suppresses read receipt while still updating last_read_at
      await tx`
        INSERT INTO public.user_privacy_preferences (user_id, read_receipts_enabled)
        VALUES (${userB}::uuid, false)
        ON CONFLICT (user_id) DO UPDATE SET read_receipts_enabled = false
      `;
      await tx`SELECT public.mark_conversation_read(${convId}::uuid)`;
      const [msgAfterDisabledReceipts] = await tx`SELECT status FROM public.private_messages WHERE id = ${msg.id}::uuid`;
      if (msgAfterDisabledReceipts?.status === "read") {
        throw new Error("Privacy violation: read receipt emitted while read_receipts_enabled=false");
      }

      await actAs(userC);
      const [{ cnt: cMsgs }] = await tx`SELECT count(*)::int AS cnt FROM public.private_messages WHERE conversation_id = ${convId}::uuid`;
      const [{ cnt: cMems }] = await tx`SELECT count(*)::int AS cnt FROM public.conversation_members WHERE conversation_id = ${convId}::uuid`;
      const [{ summary: cInbox }] = await tx`SELECT public.get_my_conversations_summary(20, 0) AS summary`;
      const cConvCount = Array.isArray(cInbox)
        ? cInbox.filter((c) => c.id === convId).length
        : -1;
      await assertExpectThrow(tx, "outsider sending to private DM", async () => {
        await tx`SELECT public.send_private_message(${convId}::uuid, 'Blocked')`;
      });
      await assertExpectThrow(tx, "authenticated spoofing _user_id in is_conversation_member", async () => {
        await tx`SELECT public.is_conversation_member(${convId}::uuid, ${userB}::uuid)`;
      });

      if (aMsgs !== 1 || aMems !== 2 || bMsgs !== 1 || bMems !== 2 || bConvUnread !== 1 || cMsgs !== 0 || cMems !== 0 || cConvCount !== 0) {
        throw new Error(`DM isolation mismatch: A=${aMsgs}/${aMems}, B=${bMsgs}/${bMems} unread=${bConvUnread}, C=${cMsgs}/${cMems} inbox=${cConvCount}`);
      }
      results.push("Direct Messages two-account isolation, message-request lifecycle & read-receipt privacy (0037): PASS (A=1/2, B=1/2 unread=1, outsider C=0/0, 2nd pending msg/upload blocked, read_receipts_enabled enforced)");

      // 2c. STAGE 1 GROUP ADMIN SELF-PROMOTION, ONLY_ADMINS_CAN_POST & PROFILE_VISIBILITY TEST (0037)
      await actAs(userA);
      const [{ grp_id: grpId }] = await tx`
        SELECT public.create_group_conversation('Stage 1 Security Group', 'Admin-only test', ARRAY[${userB}::uuid], true) AS grp_id
      `;
      await actAs(userB);
      await assertExpectThrow(tx, "regular group member self-promoting to admin", async () => {
        await tx`UPDATE public.conversation_members SET role = 'admin' WHERE conversation_id = ${grpId}::uuid AND user_id = ${userB}::uuid`;
      });
      await assertExpectThrow(tx, "regular group member bypassing only_admins_can_post via RPC", async () => {
        await tx`SELECT public.send_private_message(${grpId}::uuid, 'Unauthorized member message')`;
      });
      await assertExpectThrow(tx, "regular group member bypassing only_admins_can_post via direct INSERT", async () => {
        await tx`INSERT INTO public.private_messages (conversation_id, sender_id, content) VALUES (${grpId}::uuid, ${userB}::uuid, 'Direct insert bypass')`;
      });
      // Private profile unsolicited DM & Ping visibility check
      await tx`UPDATE public.profiles SET profile_visibility = 'private' WHERE id = ${userB}::uuid`;
      const [privPing] = await tx`
        INSERT INTO public.pings (user_id, category, content)
        VALUES (${userB}::uuid, 'progress', 'Private profile Ping')
        RETURNING id
      `;
      await actAs(userC);
      const [{ cnt: cSeesPrivPing }] = await tx`SELECT count(*)::int AS cnt FROM public.pings WHERE id = ${privPing.id}::uuid`;
      await assertExpectThrow(tx, "non-mutual starting unsolicited DM to private profile", async () => {
        await tx`SELECT public.get_or_create_direct_conversation(${userB}::uuid)`;
      });
      if (cSeesPrivPing !== 0) {
        throw new Error(`profile_visibility RLS leak: non-mutual C saw ${cSeesPrivPing} private Pings`);
      }
      await actAs(userB);
      await tx`UPDATE public.profiles SET profile_visibility = 'public' WHERE id = ${userB}::uuid`;
      results.push("Stage 1 Group & Profile Visibility hardening (0037): PASS (self-promotion blocked, only_admins_can_post enforced on RPC+INSERT, private profile Pings & unsolicited DMs blocked)");

      // 2b. PRIVATE DM STORAGE BUCKET RLS & VOICE MESSAGE PREVIEW TEST (0036)
      const voiceObjName = `${convId}/${userA}/voice-note-rls-verify.webm`;
      await actAs(userA);
      await tx`
        INSERT INTO storage.objects (bucket_id, name, owner, metadata)
        VALUES ('dm-attachments', ${voiceObjName}, ${userA}::uuid, '{"mimetype":"audio/webm"}'::jsonb)
      `;
      await assertExpectThrow(tx, "member uploading into another member's sender folder", async () => {
        await tx`
          INSERT INTO storage.objects (bucket_id, name, owner, metadata)
          VALUES ('dm-attachments', ${`${convId}/${userB}/spoof.webm`}, ${userA}::uuid, '{"mimetype":"audio/webm"}'::jsonb)
        `;
      });
      await tx`SELECT public.send_private_message(${convId}::uuid, '', ${voiceObjName}, 'audio')`;
      const [convAfterVoice] = await tx`SELECT last_message_preview FROM public.conversations WHERE id = ${convId}::uuid`;

      await actAs(userB);
      const [{ cnt: bReadVoice }] = await tx`
        SELECT count(*)::int AS cnt FROM storage.objects
        WHERE bucket_id = 'dm-attachments' AND name = ${voiceObjName}
      `;
      const bDeletedOther = await tx`
        DELETE FROM storage.objects
        WHERE bucket_id = 'dm-attachments' AND name = ${voiceObjName}
        RETURNING id
      `;

      await actAs(userC);
      const [{ cnt: cReadVoice }] = await tx`
        SELECT count(*)::int AS cnt FROM storage.objects
        WHERE bucket_id = 'dm-attachments' AND name = ${voiceObjName}
      `;
      await assertExpectThrow(tx, "non-member uploading into private DM conversation bucket path", async () => {
        await tx`
          INSERT INTO storage.objects (bucket_id, name, owner, metadata)
          VALUES ('dm-attachments', ${`${convId}/${userC}/intrusion.webm`}, ${userC}::uuid, '{"mimetype":"audio/webm"}'::jsonb)
        `;
      });

      await actAs(null);
      const [{ cnt: anonReadVoice }] = await tx`
        SELECT count(*)::int AS cnt FROM storage.objects
        WHERE bucket_id = 'dm-attachments' AND name = ${voiceObjName}
      `;

      await actAs(userA);
      const aDeletedOwn = await tx`
        DELETE FROM storage.objects
        WHERE bucket_id = 'dm-attachments' AND name = ${voiceObjName}
        RETURNING id
      `;

      if (
        convAfterVoice?.last_message_preview !== "Voice message" ||
        bReadVoice !== 1 ||
        bDeletedOther.length !== 0 ||
        cReadVoice !== 0 ||
        anonReadVoice !== 0 ||
        aDeletedOwn.length !== 1
      ) {
        throw new Error(
          `Private DM Storage RLS mismatch: preview=${convAfterVoice?.last_message_preview}, bRead=${bReadVoice}, bDelOther=${bDeletedOther.length}, cRead=${cReadVoice}, anonRead=${anonReadVoice}, aDelOwn=${aDeletedOwn.length}`,
        );
      }
      results.push("Private DM Storage RLS & Voice preview (0036): PASS (member read=1, outsider/anon=0, folder spoof/non-member upload blocked, uploader-only delete enforced, preview='Voice message')");

      // 3 & 4. HUB FORUMS, THREADS/REPLIES, INSTITUTIONAL BROADCASTS & SIGNALS TEST
      await actAs(userA);
      const [{ hub_json: hubJson }] = await tx`
        SELECT public.create_hub('Verify Coord Hub', 'verify-coord-hub-0020', 'Tag', 'Desc', '', 'university', 'public', '[]'::jsonb) AS hub_json
      `;
      const hubId = hubJson.id;
      await tx`SELECT public.update_hub(${hubId}::uuid, 'Verify Coord Hub', 'Updated tag', 'Desc', '', 'company', 'public', '[]'::jsonb)`;
      const [{ cnt: seededForumCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.hub_forums WHERE hub_id = ${hubId}::uuid`;
      const [generalForum] = await tx`
        SELECT id FROM public.hub_forums WHERE hub_id = ${hubId}::uuid AND slug = 'general' LIMIT 1
      `;
      const [annForum] = await tx`
        SELECT id FROM public.hub_forums WHERE hub_id = ${hubId}::uuid AND slug = 'announcements' LIMIT 1
      `;
      if (seededForumCnt < 3 || !generalForum || !annForum) {
        throw new Error(`Hub default forums missing: count=${seededForumCnt}`);
      }

      const [memberForum] = await tx`
        INSERT INTO public.hub_forums (hub_id, slug, name, description, forum_type, access_level, created_by)
        VALUES (${hubId}::uuid, 'members-room', 'Members Room', 'Desc', 'general', 'members', ${userA}::uuid)
        RETURNING id
      `;
      const [staffForum] = await tx`
        INSERT INTO public.hub_forums (hub_id, slug, name, description, forum_type, access_level, created_by)
        VALUES (${hubId}::uuid, 'staff-room', 'Staff Room', 'Desc', 'restricted', 'staff_only', ${userA}::uuid)
        RETURNING id
      `;
      const [bcMembers] = await tx`
        INSERT INTO public.hub_broadcasts (hub_id, forum_id, author_id, title, content, broadcast_type, target_audience)
        VALUES (${hubId}::uuid, ${memberForum.id}::uuid, ${userA}::uuid, 'Members Notice', 'Members body', 'notice', 'all_members')
        RETURNING id
      `;
      const [bcStaff] = await tx`
        INSERT INTO public.hub_broadcasts (hub_id, forum_id, author_id, title, content, broadcast_type, target_audience)
        VALUES (${hubId}::uuid, ${staffForum.id}::uuid, ${userA}::uuid, 'Staff Notice', 'Staff body', 'alert', 'staff')
        RETURNING id
      `;

      // Create Signal & post official broadcast
      const [{ sig_json: sigJson }] = await tx`
        SELECT public.create_signal('Verify Signal', 'verify-signal-0022', 'Tag', 'Desc', 'university', 'https://pingbydot.example') AS sig_json
      `;
      const sigId = sigJson.id;

      // Non-member User C cannot view member/staff broadcasts, join staff_only forum, or post in Signal chat before following
      await actAs(userC);
      const [{ cnt: cBcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.hub_broadcasts WHERE hub_id = ${hubId}::uuid`;
      await assertExpectThrow(tx, "non-member joining staff_only forum", async () => {
        await tx`INSERT INTO public.hub_forum_members (forum_id, user_id, role) VALUES (${staffForum.id}::uuid, ${userC}::uuid, 'admin')`;
      });
      await assertExpectThrow(tx, "non-member marking member broadcast read", async () => {
        await tx`SELECT public.mark_hub_broadcast_read(${bcMembers.id}::uuid)`;
      });
      await assertExpectThrow(tx, "non-staff publishing hub broadcast", async () => {
        await tx`INSERT INTO public.hub_broadcasts (hub_id, author_id, title, content, broadcast_type, target_audience) VALUES (${hubId}::uuid, ${userC}::uuid, 'Rogue', 'Body', 'alert', 'public')`;
      });
      await assertExpectThrow(tx, "non-follower posting in signal chat", async () => {
        await tx`INSERT INTO public.signal_messages (signal_id, sender_id, content) VALUES (${sigId}::uuid, ${userC}::uuid, 'Unfollowed spam')`;
      });

      // Active regular member User B joins Hub & follows Signal: can post/reply in General Forum & Signal chat, NOT announcement forum or staff broadcast
      await actAs(userB);
      await tx`SELECT public.join_hub(${hubId}::uuid, NULL)`;
      const [forumThread] = await tx`
        INSERT INTO public.hub_forum_posts (hub_id, forum_id, author_id, title, content)
        VALUES (${hubId}::uuid, ${generalForum.id}::uuid, ${userB}::uuid, 'Hello Forum', 'First real thread')
        RETURNING id
      `;
      await tx`
        INSERT INTO public.hub_forum_posts (hub_id, forum_id, author_id, parent_id, content)
        VALUES (${hubId}::uuid, ${generalForum.id}::uuid, ${userB}::uuid, ${forumThread.id}::uuid, 'Thread reply')
      `;
      await assertExpectThrow(tx, "regular member posting to announcement-only forum", async () => {
        await tx`INSERT INTO public.hub_forum_posts (hub_id, forum_id, author_id, content) VALUES (${hubId}::uuid, ${annForum.id}::uuid, ${userB}::uuid, 'Unauthorized post')`;
      });
      await tx`SELECT public.toggle_follow_signal(${sigId}::uuid)`;
      await tx`INSERT INTO public.signal_messages (signal_id, sender_id, content) VALUES (${sigId}::uuid, ${userB}::uuid, 'Follower question in Signal chat')`;

      const [{ cnt: bMemBcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.hub_broadcasts WHERE id = ${bcMembers.id}::uuid`;
      const [{ cnt: bStaffBcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.hub_broadcasts WHERE id = ${bcStaff.id}::uuid`;
      await tx`SELECT public.mark_hub_broadcast_read(${bcMembers.id}::uuid)`;
      await assertExpectThrow(tx, "regular member marking staff-only broadcast read", async () => {
        await tx`SELECT public.mark_hub_broadcast_read(${bcStaff.id}::uuid)`;
      });

      if (cBcCnt !== 0 || bMemBcCnt !== 1 || bStaffBcCnt !== 0) {
        throw new Error(`Hub broadcast permissions mismatch: cBc=${cBcCnt}, bMemBc=${bMemBcCnt}, bStaffBc=${bStaffBcCnt}`);
      }
      results.push("Hub Forums, Thread Replies, Institutional Broadcasts & Signal Chat permissions: PASS (real seeded forums=3+, thread+reply ok, announcement post blocked, signal follower chat ok)");

      // 5. DOT WALLET AUTHORIZATION TEST
      await actAs(userA);
      const [{ summary }] = await tx`SELECT public.get_my_dot_summary() AS summary`;
      const [{ checkin }] = await tx`SELECT public.claim_daily_dot() AS checkin`;
      await assertExpectThrow(tx, "duplicate daily check-in", async () => {
        await tx`SELECT public.claim_daily_dot()`;
      });
      await assertExpectThrow(tx, "direct wallet balance update", async () => {
        await tx`UPDATE public.dot_wallets SET balance = 999999 WHERE user_id = ${userA}::uuid`;
      });
      await assertExpectThrow(tx, "direct forged transaction insert", async () => {
        await tx`INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, description) VALUES (${userA}::uuid, 1000, 'bonus', 'forged', 'x')`;
      });

      await actAs(userB);
      const [{ cnt: bReadsAWallet }] = await tx`SELECT count(*)::int AS cnt FROM public.dot_wallets WHERE user_id = ${userA}::uuid`;
      const [{ cnt: bReadsATx }] = await tx`SELECT count(*)::int AS cnt FROM public.dot_transactions WHERE user_id = ${userA}::uuid`;

      if (summary?.wallet?.balance !== 50 || checkin?.wallet?.balance !== 60 || bReadsAWallet !== 0 || bReadsATx !== 0) {
        throw new Error(`DOT Wallet check failed: start=${summary?.wallet?.balance}, end=${checkin?.wallet?.balance}, crossRead=${bReadsAWallet}/${bReadsATx}`);
      }
      results.push("DOT Wallet authorization & ledger integrity: PASS (50->60, direct writes blocked, cross-user reads=0/0, duplicate checkin rejected)");

      // 6. PHASE 1 ONBOARDING & OPTIONAL PATHWAYS CHECK
      await actAs(null);
      await assertExpectThrow(tx, "anon calling complete_my_onboarding", async () => {
        await tx`SELECT public.complete_my_onboarding(_skip := true)`;
      });
      await actAs(userC);
      const [onboardedC] = await tx`
        SELECT onboarding_completed_at, participation_pathways, country, interests
        FROM public.complete_my_onboarding(
          _display_name := 'Verify Member C',
          _participation_pathways := ARRAY['general', 'creator']::text[],
          _skip := false,
          _country := 'Canada',
          _interests := ARRAY['technology', 'creativity']::text[],
          _mark_complete := true
        )
      `;
      await actAs(userA);
      const [skippedA] = await tx`
        SELECT onboarding_completed_at, participation_pathways
        FROM public.complete_my_onboarding(_skip := true)
      `;
      if (
        !onboardedC?.onboarding_completed_at ||
        (onboardedC?.participation_pathways ?? []).length !== 2 ||
        onboardedC?.country !== "Canada" ||
        (onboardedC?.interests ?? []).length !== 2 ||
        !skippedA?.onboarding_completed_at ||
        (skippedA?.participation_pathways ?? []).length !== 0
      ) {
        throw new Error("Onboarding RPC check failed for pathway/interest selection or skip flow");
      }
      results.push("Onboarding & Optional Pathways: PASS (anon blocked, pathways optional, skip supported)");

      // 5. Economic Activity Measurement Integrity & Authorization (0025)
      await actAs(userA);
      await assertExpectThrow(tx, "client cannot fabricate transaction_completed via record_network_event", () =>
        tx`SELECT public.record_network_event('transaction_completed', 'settlement', 'fake', 'web_app', '{}'::jsonb, '{"amount":999}'::jsonb)`,
      );
      await assertExpectThrow(tx, "client cannot call server-only record_verified_economic_outcome", () =>
        tx`SELECT public.record_verified_economic_outcome('cash_subscription', ${userA}::uuid, ${userB}::uuid, 'USD', 5000, 500, 'stripe', 'pi_forged_client')`,
      );
      const [evId] = await tx`
        SELECT public.record_network_event(
          'business_lead_generated',
          'profile',
          ${userB}::text,
          'ping_cta',
          '{"utm_source":"explore"}'::jsonb,
          '{"amount":10000,"revenue":999,"ping_category":"offer"}'::jsonb,
          'lead_probe_0025'
        ) AS id
      `;
      const [storedEv] = await tx`
        SELECT event_category, verification_tier, metadata
        FROM public.economic_events
        WHERE id = ${evId.id}::uuid
      `;
      if (
        storedEv?.event_category !== "lead" ||
        storedEv?.verification_tier !== "system_observed" ||
        "amount" in (storedEv?.metadata ?? {}) ||
        "revenue" in (storedEv?.metadata ?? {})
      ) {
        throw new Error("Economic event scrubbing/classification check failed");
      }
      results.push("Economic Measurement Integrity: PASS (revenue fabrication blocked, sensitive metadata scrubbed)");

      // 6. Optional Verification Authorization & Non-Self-Approval (0026)
      await actAs(userA);
      await assertExpectThrow(tx, "client cannot directly insert into account_verifications", () =>
        tx`INSERT INTO public.account_verifications (user_id, verification_domain, pathway_type, status) VALUES (${userA}::uuid, 'identity', 'identity_standard', 'verified')`,
      );
      const [submittedReq] = await tx`
        SELECT id, status FROM public.submit_verification_request('professional', 'investor', 'Test Fund', 'https://example.com', 'Optional check')
      `;
      if (submittedReq?.status !== "pending") {
        throw new Error("Verification submission must always force pending status");
      }
      await assertExpectThrow(tx, "non-admin cannot approve own verification", () =>
        tx`SELECT public.review_verification_request(${submittedReq.id}::uuid, 'verified', 'self-approve attempt')`,
      );
      results.push("Verification Authorization: PASS (optional flow pending by default, self-approval and role escalation blocked)");

      throw new VerificationRollbackSignal(results);
    });
  } catch (err) {
    if (err instanceof VerificationRollbackSignal) {
      return err.results;
    }
    throw err;
  }
}

async function main() {
  loadDotEnvFallback();
  const migrationUrl = process.env.LOVABLE_DB_MIGRATION_URL;
  const connMeta = validateMigrationUrl(migrationUrl);
  const { migrationsFolder, releaseEntries } = readReleaseMigrations();
  const minTag = releaseEntries[0]?.tag.slice(0, 4) ?? "0011";
  const maxTag = releaseEntries[releaseEntries.length - 1]?.tag.slice(0, 4) ?? "0020";

  console.log(
    `[Phase 4] Connecting to PING Supabase PostgreSQL (port ${connMeta.port}, project=${EXPECTED_PROJECT_REF})...`,
  );

  const sql = postgres(migrationUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    const baselineCheck = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('profiles', 'pings', 'hubs', 'hub_members')
      ORDER BY table_name
    `;
    const baselineNames = baselineCheck.map((r) => r.table_name);
    if (baselineNames.length < 4) {
      throw new Error(
        `Target database missing expected PING baseline tables (found: ${baselineNames.join(", ")}). Aborting.`,
      );
    }

    if (!VERIFY_ONLY) {
      console.log(`[Phase 5] Applying pending Drizzle migrations (${minTag}–${maxTag}) in order...`);
      const db = drizzle(sql);
      await migrate(db, { migrationsFolder });
      console.log(`[Phase 5] Official Drizzle migrator finished (${minTag}–${maxTag}).`);
    } else {
      console.log("[Phase 5] --verify-only active; skipping DDL apply step.");
    }

    await runSchemaVerification(sql, releaseEntries);
    await sql`NOTIFY pgrst, 'reload schema'`;

    if (SKIP_WRITE_TESTS) {
      console.log("[PERSISTENCE & AUTHORIZATION TESTS] SKIPPED (--skip-write-tests flag set).");
      console.log("======================================================================");
      console.log(`SCHEMA VERIFIED ONLY (${minTag}–${maxTag}); feature write tests were NOT run.`);
      console.log("======================================================================");
      return;
    }

    const testResults = await runFeatureAuthTests(sql);
    for (const line of testResults) {
      console.log(`  ✓ ${line}`);
    }

    console.log("======================================================================");
    console.log(`SUCCESS: Schema verified (${minTag}–${maxTag}) AND all feature write/auth tests passed.`);
    console.log("======================================================================");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("Migration/Verification FAILED:", err?.message || err);
  process.exit(1);
});
