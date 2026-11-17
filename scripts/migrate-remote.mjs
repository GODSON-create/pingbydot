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
  "hub_broadcasts",
  "hub_broadcast_reads",
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

  console.log(
    `[SCHEMA VERIFIED] Ledger ${minTag}–${maxTag}: ${releaseEntries.length}/${releaseEntries.length} recorded (total rows=${ledgerRows.length}); ${REQUIRED_TABLES_0011_0020.length}/${REQUIRED_TABLES_0011_0020.length} tables with RLS; hardened indexes & privileges intact.`,
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

      // 2. TWO-ACCOUNT DIRECT MESSAGE ISOLATION TEST
      await actAs(userA);
      const [{ conv_id: convId }] = await tx`SELECT public.get_or_create_direct_conversation(${userB}::uuid) AS conv_id`;
      const [{ msg }] = await tx`SELECT public.send_private_message(${convId}::uuid, 'Two-account DM test') AS msg`;
      const [{ cnt: aMsgs }] = await tx`SELECT count(*)::int AS cnt FROM public.private_messages WHERE conversation_id = ${convId}::uuid AND id = ${msg.id}::uuid`;
      const [{ cnt: aMems }] = await tx`SELECT count(*)::int AS cnt FROM public.conversation_members WHERE conversation_id = ${convId}::uuid`;

      await actAs(userB);
      const [{ cnt: bMsgs }] = await tx`SELECT count(*)::int AS cnt FROM public.private_messages WHERE conversation_id = ${convId}::uuid`;
      const [{ cnt: bMems }] = await tx`SELECT count(*)::int AS cnt FROM public.conversation_members WHERE conversation_id = ${convId}::uuid`;

      await actAs(userC);
      const [{ cnt: cMsgs }] = await tx`SELECT count(*)::int AS cnt FROM public.private_messages WHERE conversation_id = ${convId}::uuid`;
      const [{ cnt: cMems }] = await tx`SELECT count(*)::int AS cnt FROM public.conversation_members WHERE conversation_id = ${convId}::uuid`;
      await assertExpectThrow(tx, "outsider sending to private DM", async () => {
        await tx`SELECT public.send_private_message(${convId}::uuid, 'Blocked')`;
      });
      await assertExpectThrow(tx, "authenticated spoofing _user_id in is_conversation_member", async () => {
        await tx`SELECT public.is_conversation_member(${convId}::uuid, ${userB}::uuid)`;
      });

      if (aMsgs !== 1 || aMems !== 2 || bMsgs !== 1 || bMems !== 2 || cMsgs !== 0 || cMems !== 0) {
        throw new Error(`DM isolation mismatch: A=${aMsgs}/${aMems}, B=${bMsgs}/${bMems}, C=${cMsgs}/${cMems}`);
      }
      results.push("Direct Messages two-account isolation: PASS (A=1/2, B=1/2, outsider C=0/0, spoofed member probe blocked)");

      // 3 & 4. HUB FORUMS & INSTITUTIONAL BROADCAST PERMISSIONS TEST
      await actAs(userA);
      const [{ hub_json: hubJson }] = await tx`
        SELECT public.create_hub('Verify Coord Hub', 'verify-coord-hub-0020', 'Tag', 'Desc', '', 'community', 'public', '[]'::jsonb) AS hub_json
      `;
      const hubId = hubJson.id;
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

      // Non-member User C cannot view member/staff broadcasts or join staff_only forum
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

      // Active regular member User B joins Hub: sees all_members broadcast, NOT staff broadcast
      await actAs(userB);
      await tx`SELECT public.join_hub(${hubId}::uuid, NULL)`;
      const [{ cnt: bMemBcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.hub_broadcasts WHERE id = ${bcMembers.id}::uuid`;
      const [{ cnt: bStaffBcCnt }] = await tx`SELECT count(*)::int AS cnt FROM public.hub_broadcasts WHERE id = ${bcStaff.id}::uuid`;
      await tx`SELECT public.mark_hub_broadcast_read(${bcMembers.id}::uuid)`;
      await assertExpectThrow(tx, "regular member marking staff-only broadcast read", async () => {
        await tx`SELECT public.mark_hub_broadcast_read(${bcStaff.id}::uuid)`;
      });

      if (cBcCnt !== 0 || bMemBcCnt !== 1 || bStaffBcCnt !== 0) {
        throw new Error(`Hub broadcast permissions mismatch: cBc=${cBcCnt}, bMemBc=${bMemBcCnt}, bStaffBc=${bStaffBcCnt}`);
      }
      results.push("Hub Forums & Institutional Broadcast permissions: PASS (outsider=0, member sees all_members=1 & staff=0, staff escalation blocked)");

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
