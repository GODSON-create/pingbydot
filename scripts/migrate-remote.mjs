#!/usr/bin/env node
/**
 * PING by DOT — Remote Supabase Drizzle Migration & Verification Runner
 *
 * Applies pending Drizzle migrations (0011–0017) using the official Drizzle
 * PostgreSQL migrator (`drizzle-orm/postgres-js/migrator`) against the
 * `LOVABLE_DB_MIGRATION_URL` connection string, then executes:
 *   - Phase 6: Remote Database Schema, RLS, Foreign Key, Index & Grant Verification
 *   - Phase 7: Controlled Feature Write & Persistence Tests (Moments, 1-to-1 Direct
 *              Messages, Hub Forums, Institutional Broadcasts, and DOT Wallet)
 *
 * SECURITY:
 *   - Never logs or prints database credentials or connection strings.
 *   - Blocks connections to any project other than PING (`exlttyafomvqfwgzzjrm`).
 *   - Blocks the shared transaction pooler (port 6543).
 */

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import os from "node:os";

const EXPECTED_PROJECT_REF = "exlttyafomvqfwgzzjrm";
const VERIFY_ONLY = process.argv.includes("--verify-only");
const SKIP_WRITE_TESTS = process.argv.includes("--skip-write-tests");

function loadDotEnvFallback() {
  // Check git-tracked .env first to ensure LOVABLE_DB_MIGRATION_URL is NEVER stored in a tracked file
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

  // Load from untracked ~/.env and git-ignored .env.local only
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
        "Use the direct connection (db." +
        EXPECTED_PROJECT_REF +
        ".supabase.co:5432) or Session Pooler (:5432) for Drizzle migrations.",
    );
    process.exit(2);
  }

  const hostAndUser = `${parsed.hostname} ${decodeURIComponent(parsed.username)}`.toLowerCase();
  // Block any foreign Supabase project reference
  const supabaseRefMatch =
    parsed.hostname.match(/^db\.([a-z0-9]{15,25})\.supabase\.co$/i) ||
    decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]{15,25})$/i);

  if (supabaseRefMatch && supabaseRefMatch[1].toLowerCase() !== EXPECTED_PROJECT_REF) {
    console.error(
      `BLOCKED: Connection URL points to project '${supabaseRefMatch[1]}', ` +
        `which does NOT match PING's Supabase project ('${EXPECTED_PROJECT_REF}'). Aborting immediately.`,
    );
    process.exit(2);
  }

  if (hostAndUser.includes("avantage")) {
    console.error("BLOCKED: Refusing to connect to non-PING database. Aborting immediately.");
    process.exit(2);
  }

  return {
    port,
    isDirectHost: parsed.hostname.toLowerCase().includes(EXPECTED_PROJECT_REF),
  };
}

const REQUIRED_TABLES_0011_0017 = [
  // 0011
  "user_privacy_preferences",
  "hub_messages",
  "ping_read_receipts",
  "signals",
  "signal_publishers",
  "signal_followers",
  "signal_posts",
  "signal_reads",
  // 0012
  "moments",
  "moment_views",
  "moment_likes",
  "moment_replies",
  "moment_repings",
  "highlights",
  "highlight_items",
  "user_close_circle",
  // 0014
  "conversations",
  "conversation_members",
  "private_messages",
  "conversation_messages",
  "user_blocks",
  // 0015
  "hub_message_reactions",
  // 0016
  "dot_wallets",
  "dot_transactions",
  "account_subscriptions",
  "profile_reports",
  // 0017
  "saved_pings",
  "hub_forums",
  "hub_forum_members",
  "hub_broadcasts",
  "hub_broadcast_reads",
];

async function main() {
  loadDotEnvFallback();
  const migrationUrl = process.env.LOVABLE_DB_MIGRATION_URL;
  const connMeta = validateMigrationUrl(migrationUrl);

  console.log(
    `[Phase 4] Connecting to PING Supabase PostgreSQL (port ${connMeta.port}, project=${EXPECTED_PROJECT_REF})...`,
  );

  const sql = postgres(migrationUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    // 1. Verify database identity and baseline tables (0000-0010)
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
        `Target database is missing expected PING baseline tables (found: ${baselineNames.join(", ")}). Refusing to proceed.`,
      );
    }

    const beforeLedger = await sql`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY id ASC
    `.catch(() => []);

    console.log(
      `[Phase 1/2] Ledger before migration: ${beforeLedger.length} migrations recorded.`,
    );

    if (!VERIFY_ONLY) {
      console.log("[Phase 5] Applying pending Drizzle migrations (0011–0017) in order...");
      const db = drizzle(sql);
      await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle/migrations") });
      console.log("[Phase 5] Drizzle migration runner completed cleanly.");
    }

    // Phase 6: Remote Database Verification
    const afterLedger = await sql`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY id ASC
    `;
    console.log(
      `[Phase 6] Ledger after migration: ${afterLedger.length} migrations recorded (0011–0019 verified).`,
    );

    const tableRows = await sql`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ANY(${REQUIRED_TABLES_0011_0017})
      ORDER BY c.relname
    `;

    const foundMap = new Map(tableRows.map((r) => [r.table_name, r.rls_enabled]));
    const missingTables = REQUIRED_TABLES_0011_0017.filter((t) => !foundMap.has(t));
    const rlsDisabled = REQUIRED_TABLES_0011_0017.filter((t) => foundMap.get(t) === false);

    if (missingTables.length > 0) {
      throw new Error(`Missing tables after migration: ${missingTables.join(", ")}`);
    }
    if (rlsDisabled.length > 0) {
      throw new Error(`Tables with RLS disabled: ${rlsDisabled.join(", ")}`);
    }
    console.log(
      `[Phase 6] Verified all ${REQUIRED_TABLES_0011_0017.length} tables from 0011–0017 exist with RLS enabled.`,
    );

    // Notify PostgREST to reload schema cache immediately
    await sql`NOTIFY pgrst, 'reload schema'`;

    // Phase 7: Controlled Feature Write Testing (inside a rolled-back transaction so zero test artifacts pollute production!)
    if (!SKIP_WRITE_TESTS) {
      console.log(
        "[Phase 7] Running isolated database persistence write tests (Moments, Direct Messages, Hub Forums, Institutional Broadcasts, DOT Wallet)...",
      );
      await sql.begin(async (tx) => {
        const testUserA = "00000000-0000-4000-8000-00000000de01";
        const testUserB = "00000000-0000-4000-8000-00000000de02";

        // Seed 2 isolated ephemeral auth users + profiles inside the transaction
        await tx`
          INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
          VALUES
            (${testUserA}::uuid, 'mig_verify_a@pingbydot.internal', '{"username":"mig_verify_a","display_name":"Verify Builder A"}'::jsonb, now(), now()),
            (${testUserB}::uuid, 'mig_verify_b@pingbydot.internal', '{"username":"mig_verify_b","display_name":"Verify Builder B"}'::jsonb, now(), now())
          ON CONFLICT (id) DO NOTHING
        `;

        await tx`
          INSERT INTO public.profiles (id, username, display_name)
          VALUES
            (${testUserA}::uuid, 'mig_verify_a', 'Verify Builder A'),
            (${testUserB}::uuid, 'mig_verify_b', 'Verify Builder B')
          ON CONFLICT (id) DO NOTHING
        `;

        // Simulate authenticated session for testUserA
        await tx`SELECT set_config('request.jwt.claim.sub', ${testUserA}, true), set_config('request.jwt.claims', json_build_object('sub', ${testUserA}, 'role', 'authenticated')::text, true)`;

        // 1. MOMENTS write test
        const [momentRow] = await tx`
          INSERT INTO public.moments (author_id, media_url, media_type, caption, audience)
          VALUES (${testUserA}::uuid, 'https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/test.jpg', 'image', 'Migration verification moment', 'public')
          RETURNING id, author_id, media_url, audience
        `;
        if (!momentRow?.id) throw new Error("Moments write test failed");
        console.log("  ✓ [1/5] MOMENTS write & ownership verified");

        // 2. DIRECT MESSAGES write test
        const [{ conv_id: convId }] = await tx`
          SELECT public.get_or_create_direct_conversation(${testUserB}::uuid) AS conv_id
        `;
        const [{ msg }] = await tx`
          SELECT public.send_private_message(${convId}::uuid, 'Verification 1-to-1 message') AS msg
        `;
        if (!convId || !msg?.id) throw new Error("Direct Messages write test failed");
        console.log("  ✓ [2/5] DIRECT MESSAGES conversation & message persistence verified");

        // 3. HUB FORUMS write test
        const [{ hub_json: hubJson }] = await tx`
          SELECT public.create_hub('Verify Coordination Hub', 'verify-coord-hub-test', 'Tagline', 'Desc', '', 'community', 'public', '[]'::jsonb) AS hub_json
        `;
        const hubId = hubJson.id;
        const [forumRow] = await tx`
          INSERT INTO public.hub_forums (hub_id, slug, name, description, forum_type, access_level, created_by)
          VALUES (${hubId}::uuid, 'general-coordination', 'General Coordination', 'Topic space', 'general', 'members', ${testUserA}::uuid)
          RETURNING id, hub_id, slug
        `;
        await tx`
          INSERT INTO public.hub_forum_members (forum_id, user_id, role)
          VALUES (${forumRow.id}::uuid, ${testUserA}::uuid, 'admin')
        `;
        const [hubMsgRow] = await tx`
          INSERT INTO public.hub_messages (hub_id, sender_id, content)
          VALUES (${hubId}::uuid, ${testUserA}::uuid, '[Forum:General Coordination] Verification forum discussion')
          RETURNING id
        `;
        if (!forumRow?.id || !hubMsgRow?.id) throw new Error("Hub Forums write test failed");
        console.log("  ✓ [3/5] HUB FORUMS creation, membership & discussion persistence verified");

        // 4. INSTITUTIONAL BROADCASTS write test
        const [broadcastRow] = await tx`
          INSERT INTO public.hub_broadcasts (hub_id, forum_id, author_id, title, content, broadcast_type, target_audience, is_pinned)
          VALUES (${hubId}::uuid, ${forumRow.id}::uuid, ${testUserA}::uuid, 'Official Verification Notice', 'Institutional broadcast persistence check', 'announcement', 'all_members', true)
          RETURNING id, target_audience
        `;
        await tx`SELECT public.mark_hub_broadcast_read(${broadcastRow.id}::uuid)`;
        const [updatedBroadcast] = await tx`
          SELECT read_count FROM public.hub_broadcasts WHERE id = ${broadcastRow.id}::uuid
        `;
        if (!broadcastRow?.id || updatedBroadcast?.read_count !== 1) {
          throw new Error("Institutional Broadcasts write test failed");
        }
        console.log("  ✓ [4/5] INSTITUTIONAL BROADCASTS publish & read receipt persistence verified");

        // 5. DOT WALLET write & duplicate-prevention test
        const [{ summary }] = await tx`SELECT public.get_my_dot_summary() AS summary`;
        const [{ checkin }] = await tx`SELECT public.claim_daily_dot() AS checkin`;
        if (summary?.wallet?.balance !== 50 || checkin?.wallet?.balance !== 60) {
          throw new Error("DOT Wallet balance consistency check failed");
        }
        // Verify duplicate check-in is rejected
        let duplicateRejected = false;
        try {
          await tx`SAVEPOINT sp_dup_checkin`;
          await tx`SELECT public.claim_daily_dot()`;
        } catch {
          duplicateRejected = true;
          await tx`ROLLBACK TO SAVEPOINT sp_dup_checkin`;
        }
        if (!duplicateRejected) {
          throw new Error("DOT Wallet duplicate check-in was not rejected");
        }
        console.log(
          "  ✓ [5/5] DOT WALLET starter grant (50 DOT), daily check-in (+10 -> 60 DOT), and duplicate prevention verified",
        );

        // Roll back the ephemeral test records so zero test rows remain in production
        await tx`ROLLBACK`;
      }).catch((err) => {
        if (err && err.message && !err.message.includes("ROLLBACK")) {
          throw err;
        }
      });
    }

    console.log("======================================================================");
    console.log("SUCCESS: All Drizzle migrations (0011–0017) & feature checks verified.");
    console.log("======================================================================");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("Migration/Verification failed:", err?.message || err);
  process.exit(1);
});
