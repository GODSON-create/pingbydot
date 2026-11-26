// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { citext } from "@electric-sql/pglite/contrib/citext";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

const ALICE_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const BOB_ID = "22222222-bbbb-4bbb-8bbb-222222222222";
const CAROL_ID = "33333333-cccc-4ccc-8ccc-333333333333";
const DAVE_ID = "44444444-dddd-4ddd-8ddd-444444444444";

/**
 * Real PostgreSQL 17 multi-account integration & security test suite covering
 * Migration 0042 + full Moments, Hubs, and Signals lifecycles.
 * Executes all 43 migrations (0000..0042) verbatim + verifies 0042 double-run idempotency.
 */
describe("Ping Feature Restoration — Moments, Hubs & Signals (Real PostgreSQL 17)", () => {
  let db: PGlite;

  async function asUser<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
    await db.exec("BEGIN;");
    try {
      if (userId === "service_role") {
        await db.exec(`SET LOCAL ROLE service_role;`);
      } else if (userId === null) {
        await db.exec(`
          SET LOCAL ROLE anon;
          SELECT set_config('request.jwt.claim.sub', '', true);
          SELECT set_config('request.jwt.claim.role', 'anon', true);
        `);
      } else {
        await db.exec(`SET LOCAL ROLE authenticated;`);
        await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
      }
      const res = await fn();
      await db.exec("COMMIT;");
      return res;
    } catch (err) {
      await db.exec("ROLLBACK;").catch(() => {});
      throw err;
    }
  }

  async function expectPgReject(
    userId: string | null,
    sqlText: string,
    params: unknown[] = [],
  ): Promise<Error> {
    let caught: unknown = null;
    try {
      await asUser(userId, async () => {
        await db.query(sqlText, params);
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    return caught as Error;
  }

  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { pgcrypto, pg_trgm, citext },
    });

    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE supabase_admin NOLOGIN SUPERUSER;

      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE EXTENSION IF NOT EXISTS citext;

      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text UNIQUE,
        raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text)
      $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT SELECT ON auth.users TO service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[],
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text NOT NULL REFERENCES storage.buckets(id),
        name text NOT NULL,
        owner uuid,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT storage_objects_bucket_name_unique UNIQUE (bucket_id, name)
      );
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION storage.foldername(p_name text) RETURNS text[]
      LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE
          WHEN array_length(string_to_array(p_name, '/'), 1) > 1
            THEN (string_to_array(p_name, '/'))[1:array_length(string_to_array(p_name, '/'), 1) - 1]
          ELSE ARRAY[]::text[]
        END
      $$;
      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
      GRANT SELECT ON storage.buckets TO anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
      GRANT SELECT ON storage.objects TO anon;
      GRANT ALL ON storage.buckets, storage.objects TO service_role;
      GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;

      CREATE PUBLICATION supabase_realtime;
    `);

    const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.length).toBe(43);
    expect(journal.entries[42]?.tag).toBe("0042_stage2_moments_hubs_signals_restoration");

    for (const entry of journal.entries) {
      const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
      await db.exec(sqlText);
    }

    // Prove Migration 0042 double-run idempotency verbatim
    const sql0042 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "0042_stage2_moments_hubs_signals_restoration.sql"),
      "utf8",
    );
    await db.exec(sql0042);

    // Seed 4 test accounts (note: Dave starts without profile row to verify ensure_my_profile in join_hub/toggle_follow_signal)
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES
        ('${ALICE_ID}', 'alice@ping.test', '{"username":"alice","display_name":"Alice"}'::jsonb),
        ('${BOB_ID}', 'bob@ping.test', '{"username":"bob","display_name":"Bob"}'::jsonb),
        ('${CAROL_ID}', 'carol@ping.test', '{"username":"carol","display_name":"Carol"}'::jsonb),
        ('${DAVE_ID}', 'dave@ping.test', '{"username":"dave","display_name":"Dave"}'::jsonb);

      INSERT INTO public.profiles (id, username, display_name)
      VALUES
        ('${ALICE_ID}', 'alice', 'Alice'),
        ('${BOB_ID}', 'bob', 'Bob'),
        ('${CAROL_ID}', 'carol', 'Carol')
      ON CONFLICT (id) DO NOTHING;
    `);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("publishes Hubs, Signals, and Notifications tables in supabase_realtime", async () => {
    const res = await db.query<{ tablename: string }>(`
      SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      ORDER BY tablename
    `);
    const tables = new Set(res.rows.map((r) => r.tablename));
    for (const expected of [
      "hub_messages",
      "hub_members",
      "hub_pings",
      "hub_forum_posts",
      "ping_read_receipts",
      "signal_posts",
      "signal_messages",
      "signal_followers",
      "notifications",
      "moments",
    ]) {
      expect(tables.has(expected)).toBe(true);
    }
  });

  it("Objective B — Hubs: full multi-account lifecycle, private access, RBAC, counters, invites, feed & chat", async () => {
    // 1. Create public Hub + verify unique slug enforcement
    const pubHubRes = await asUser(ALICE_ID, () =>
      db.query<{ hub: { id: string; slug: string; member_count: number } }>(
        `SELECT public.create_hub('Builders Collective', 'builders-collective', 'Build together', 'Desc', 'Be kind', 'university', 'public', '[]'::jsonb) AS hub`,
      ),
    );
    const pubHubId = pubHubRes.rows[0]!.hub.id;
    expect(pubHubRes.rows[0]!.hub.member_count).toBe(1);

    await expectPgReject(
      BOB_ID,
      `SELECT public.create_hub('Duplicate Hub', 'builders-collective', '', '', '', 'community', 'public', '[]'::jsonb)`,
    );

    // 2. Persist avatar_url + verify guard_hub blocks direct client tampering of member_count/verified
    await asUser(ALICE_ID, () =>
      db.query(
        `UPDATE public.hubs
         SET avatar_url = 'https://cdn.ping.test/hub-logo.png',
             verified = true,
             member_count = 99999,
             ping_count = 99999
         WHERE id = $1`,
        [pubHubId],
      ),
    );
    const afterTamper = await db.query<{
      avatar_url: string | null;
      verified: boolean;
      member_count: number;
      ping_count: number;
    }>(`SELECT avatar_url, verified, member_count, ping_count FROM public.hubs WHERE id = $1`, [
      pubHubId,
    ]);
    expect(afterTamper.rows[0]!.avatar_url).toBe("https://cdn.ping.test/hub-logo.png");
    expect(afterTamper.rows[0]!.verified).toBe(false);
    expect(afterTamper.rows[0]!.member_count).toBe(1);
    expect(afterTamper.rows[0]!.ping_count).toBe(0);

    // 3. Dave (no profile row yet!) joins public Hub -> ensure_my_profile auto-recovers + member_count = 2
    const daveJoin = await asUser(DAVE_ID, () =>
      db.query<{ status: string }>(`SELECT public.join_hub($1, NULL) AS status`, [pubHubId]),
    );
    expect(daveJoin.rows[0]!.status).toBe("active");

    // 4. Create private Hub
    const privHubRes = await asUser(ALICE_ID, () =>
      db.query<{ hub: { id: string; member_count: number } }>(
        `SELECT public.create_hub('Stealth Founders', 'stealth-founders', 'Private room', '', '', 'incubator', 'private', '[]'::jsonb) AS hub`,
      ),
    );
    const privHubId = privHubRes.rows[0]!.hub.id;
    expect(privHubRes.rows[0]!.hub.member_count).toBe(1);

    // Bob requests access -> pending, member_count stays 1
    const bobReq = await asUser(BOB_ID, () =>
      db.query<{ status: string }>(`SELECT public.join_hub($1, NULL) AS status`, [privHubId]),
    );
    expect(bobReq.rows[0]!.status).toBe("pending");
    let countRes = await db.query<{ member_count: number }>(
      `SELECT member_count FROM public.hubs WHERE id = $1`,
      [privHubId],
    );
    expect(countRes.rows[0]!.member_count).toBe(1);

    // Carol requests access -> pending, Alice declines -> removed, count stays 1
    const carolReq = await asUser(CAROL_ID, () =>
      db.query<{ status: string }>(`SELECT public.join_hub($1, NULL) AS status`, [privHubId]),
    );
    expect(carolReq.rows[0]!.status).toBe("pending");
    await asUser(ALICE_ID, () =>
      db.query(`SELECT public.manage_hub_member($1, $2, 'decline', NULL)`, [privHubId, CAROL_ID]),
    );
    countRes = await db.query<{ member_count: number }>(
      `SELECT member_count FROM public.hubs WHERE id = $1`,
      [privHubId],
    );
    expect(countRes.rows[0]!.member_count).toBe(1);

    // Alice approves Bob -> active, member_count becomes 2
    await asUser(ALICE_ID, () =>
      db.query(`SELECT public.manage_hub_member($1, $2, 'approve', NULL)`, [privHubId, BOB_ID]),
    );
    countRes = await db.query<{ member_count: number }>(
      `SELECT member_count FROM public.hubs WHERE id = $1`,
      [privHubId],
    );
    expect(countRes.rows[0]!.member_count).toBe(2);

    // 5. Security: direct client INSERT/UPDATE/DELETE on hub_members is strictly denied
    await expectPgReject(
      BOB_ID,
      `UPDATE public.hub_members SET role = 'owner' WHERE hub_id = $1 AND user_id = $2`,
      [privHubId, BOB_ID],
    );
    await expectPgReject(
      CAROL_ID,
      `INSERT INTO public.hub_members (hub_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
      [privHubId, CAROL_ID],
    );

    // Non-staff regular member Bob cannot invite into private Hub
    await expectPgReject(BOB_ID, `SELECT public.invite_to_hub($1, 'carol')`, [privHubId]);

    // 6. Invite token flow + revocation
    const inviteRes = await asUser(ALICE_ID, () =>
      db.query<{ token: string }>(`SELECT public.create_hub_invite($1, 5, 14) AS token`, [
        privHubId,
      ]),
    );
    const token = inviteRes.rows[0]!.token;

    // Dave joins private Hub via valid invite token -> immediately active, member_count = 3
    const davePrivJoin = await asUser(DAVE_ID, () =>
      db.query<{ status: string }>(`SELECT public.join_hub($1, $2) AS status`, [privHubId, token]),
    );
    expect(davePrivJoin.rows[0]!.status).toBe("active");
    countRes = await db.query<{ member_count: number }>(
      `SELECT member_count FROM public.hubs WHERE id = $1`,
      [privHubId],
    );
    expect(countRes.rows[0]!.member_count).toBe(3);

    // Revoke token -> Carol using revoked token lands in pending (NOT active)
    const invRow = await db.query<{ id: string; uses: number }>(
      `SELECT id, uses FROM public.hub_invites WHERE token = $1`,
      [token],
    );
    expect(invRow.rows[0]!.uses).toBe(1);
    await asUser(ALICE_ID, () =>
      db.query(`SELECT public.revoke_hub_invite($1)`, [invRow.rows[0]!.id]),
    );
    const carolRevokedJoin = await asUser(CAROL_ID, () =>
      db.query<{ status: string }>(`SELECT public.join_hub($1, $2) AS status`, [privHubId, token]),
    );
    expect(carolRevokedJoin.rows[0]!.status).toBe("pending");

    // 7. Role hierarchy: Owner promotes Bob to admin; admin promotes Dave to moderator;
    //    moderator CANNOT promote/demote roles or remove admin/owner
    await asUser(ALICE_ID, () =>
      db.query(`SELECT public.manage_hub_member($1, $2, 'role', 'admin')`, [privHubId, BOB_ID]),
    );
    await asUser(BOB_ID, () =>
      db.query(`SELECT public.manage_hub_member($1, $2, 'role', 'moderator')`, [
        privHubId,
        DAVE_ID,
      ]),
    );
    await expectPgReject(DAVE_ID, `SELECT public.manage_hub_member($1, $2, 'role', 'member')`, [
      privHubId,
      BOB_ID,
    ]);
    await expectPgReject(DAVE_ID, `SELECT public.manage_hub_member($1, $2, 'remove', NULL)`, [
      privHubId,
      BOB_ID,
    ]);

    // 8. Hub Feed Pings & moderation
    const pingRes = await asUser(BOB_ID, () =>
      db.query<{ id: string }>(
        `INSERT INTO public.pings (user_id, category, content) VALUES ($1, 'update', 'Shipping private Hub milestone') RETURNING id`,
        [BOB_ID],
      ),
    );
    const pingId = pingRes.rows[0]!.id;
    await asUser(BOB_ID, () =>
      db.query(`SELECT public.share_ping_to_hub($1, $2, 'launch')`, [privHubId, pingId]),
    );
    let hubPingCount = await db.query<{ ping_count: number }>(
      `SELECT ping_count FROM public.hubs WHERE id = $1`,
      [privHubId],
    );
    expect(hubPingCount.rows[0]!.ping_count).toBe(1);

    await asUser(DAVE_ID, () =>
      db.query(`SELECT public.moderate_hub_ping($1, $2, 'pin')`, [privHubId, pingId]),
    );
    await asUser(DAVE_ID, () =>
      db.query(`SELECT public.moderate_hub_ping($1, $2, 'remove')`, [privHubId, pingId]),
    );
    hubPingCount = await db.query<{ ping_count: number }>(
      `SELECT ping_count FROM public.hubs WHERE id = $1`,
      [privHubId],
    );
    expect(hubPingCount.rows[0]!.ping_count).toBe(0);

    // 9. Hub Chat messages + Read Receipts + Reactions (blocked for pending Carol)
    await expectPgReject(
      CAROL_ID,
      `INSERT INTO public.hub_messages (hub_id, sender_id, content) VALUES ($1, $2, 'Sneak in')`,
      [privHubId, CAROL_ID],
    );
    const msgRes = await asUser(ALICE_ID, () =>
      db.query<{ id: string }>(
        `INSERT INTO public.hub_messages (hub_id, sender_id, content) VALUES ($1, $2, 'Welcome founders') RETURNING id`,
        [privHubId, ALICE_ID],
      ),
    );
    const msgId = msgRes.rows[0]!.id;

    await asUser(BOB_ID, () =>
      db.query(`SELECT public.mark_hub_messages_read($1, ARRAY[$2::uuid])`, [privHubId, msgId]),
    );
    const readSummary = await asUser(ALICE_ID, () =>
      db.query<{ summary: { total_recipients: number; read_count: number } }>(
        `SELECT public.get_message_read_summary($1) AS summary`,
        [msgId],
      ),
    );
    expect(readSummary.rows[0]!.summary.total_recipients).toBe(2); // Bob + Dave
    expect(readSummary.rows[0]!.summary.read_count).toBe(1); // Bob

    const reactRes = await asUser(BOB_ID, () =>
      db.query<{ res: { reactions: Record<string, number>; toggled: boolean } }>(
        `SELECT public.toggle_hub_message_reaction($1, '🔥') AS res`,
        [msgId],
      ),
    );
    expect(reactRes.rows[0]!.res.toggled).toBe(true);
    expect(reactRes.rows[0]!.res.reactions["🔥"]).toBe(1);
  });

  it("Objective A — Moments: audience RLS (public, followers, close_circle, active-only hub) & storage auth", async () => {
    // Reuse stealth-founders private Hub where Alice & Bob are active, Carol is pending, Dave is active
    const privHubRow = await db.query<{ id: string }>(
      `SELECT id FROM public.hubs WHERE slug = 'stealth-founders'`,
    );
    const privHubId = privHubRow.rows[0]!.id;

    // Bob follows Alice & is in Alice's Close Circle; Carol follows Alice only
    await asUser(BOB_ID, () =>
      db.query(`INSERT INTO public.follows (follower_id, following_id) VALUES ($1, $2)`, [
        BOB_ID,
        ALICE_ID,
      ]),
    );
    await asUser(CAROL_ID, () =>
      db.query(`INSERT INTO public.follows (follower_id, following_id) VALUES ($1, $2)`, [
        CAROL_ID,
        ALICE_ID,
      ]),
    );
    await asUser(ALICE_ID, () =>
      db.query(`INSERT INTO public.user_close_circle (user_id, member_id) VALUES ($1, $2)`, [
        ALICE_ID,
        BOB_ID,
      ]),
    );

    const followersPath = `${ALICE_ID}/followers/self/1700000001-f.jpg`;
    const ccPath = `${ALICE_ID}/close_circle/self/1700000002-cc.jpg`;
    const hubPath = `${ALICE_ID}/hub/${privHubId}/1700000003-hub.mp4`;

    // Insert 4 Moments across all 4 audience types (including r2:// for Close Circle)
    const inserted = await asUser(ALICE_ID, () =>
      db.query<{ id: string; audience: string }>(
        `INSERT INTO public.moments (author_id, media_url, media_type, caption, audience, hub_id)
         VALUES
           ($1, 'https://cdn.ping.test/storage/v1/object/public/media/alice/pub.jpg', 'image', 'Public Moment', 'public', NULL),
           ($1, $2, 'image', 'Followers Moment', 'followers', NULL),
           ($1, $3, 'image', 'Close Circle Moment', 'close_circle', NULL),
           ($1, $4, 'video', 'Private Hub Moment', 'hub', $5)
         RETURNING id, audience`,
        [
          ALICE_ID,
          `storage://private-moments/${followersPath}`,
          `r2://private-moments/${ccPath}`,
          `storage://private-moments/${hubPath}`,
          privHubId,
        ],
      ),
    );
    expect(inserted.rows.length).toBe(4);

    // Anon sees ONLY public
    const anonMoments = await asUser(null, () =>
      db.query<{ audience: string }>(`SELECT audience FROM public.moments ORDER BY audience`),
    );
    expect(anonMoments.rows.map((r) => r.audience)).toEqual(["public"]);

    // Bob (follower + close_circle + active hub member) sees ALL 4
    const bobMoments = await asUser(BOB_ID, () =>
      db.query<{ audience: string }>(`SELECT audience FROM public.moments ORDER BY audience`),
    );
    expect(bobMoments.rows.map((r) => r.audience)).toEqual([
      "close_circle",
      "followers",
      "hub",
      "public",
    ]);

    // Carol (follower, NOT close_circle, PENDING hub member!) MUST ONLY see public + followers (NOT hub, NOT close_circle!)
    const carolMoments = await asUser(CAROL_ID, () =>
      db.query<{ audience: string }>(`SELECT audience FROM public.moments ORDER BY audience`),
    );
    expect(carolMoments.rows.map((r) => r.audience)).toEqual(["followers", "public"]);

    // Verify can_access_private_moment_object() matches audience & R2/storage dual-protocol rules
    const bobCanHub = await asUser(BOB_ID, () =>
      db.query<{ ok: boolean }>(`SELECT public.can_access_private_moment_object($1) AS ok`, [
        hubPath,
      ]),
    );
    expect(bobCanHub.rows[0]!.ok).toBe(true);

    const bobCanCcR2 = await asUser(BOB_ID, () =>
      db.query<{ ok: boolean }>(`SELECT public.can_access_private_moment_object($1) AS ok`, [
        ccPath,
      ]),
    );
    expect(bobCanCcR2.rows[0]!.ok).toBe(true);

    const carolCanHub = await asUser(CAROL_ID, () =>
      db.query<{ ok: boolean }>(`SELECT public.can_access_private_moment_object($1) AS ok`, [
        hubPath,
      ]),
    );
    expect(carolCanHub.rows[0]!.ok).toBe(false);

    const carolCanCc = await asUser(CAROL_ID, () =>
      db.query<{ ok: boolean }>(`SELECT public.can_access_private_moment_object($1) AS ok`, [
        ccPath,
      ]),
    );
    expect(carolCanCc.rows[0]!.ok).toBe(false);

    // Block enforcement: Alice blocks Carol -> Carol can no longer see even Alice's followers/public Moments
    await asUser(ALICE_ID, () =>
      db.query(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [
        ALICE_ID,
        CAROL_ID,
      ]),
    );
    const carolBlockedMoments = await asUser(CAROL_ID, () =>
      db.query<{ id: string }>(`SELECT id FROM public.moments WHERE author_id = $1`, [ALICE_ID]),
    );
    expect(carolBlockedMoments.rows.length).toBe(0);
    const carolBlockedStorage = await asUser(CAROL_ID, () =>
      db.query<{ ok: boolean }>(`SELECT public.can_access_private_moment_object($1) AS ok`, [
        followersPath,
      ]),
    );
    expect(carolBlockedStorage.rows[0]!.ok).toBe(false);
    // Clean up block for Signals tests below
    await asUser(ALICE_ID, () =>
      db.query(`DELETE FROM public.user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [
        ALICE_ID,
        CAROL_ID,
      ]),
    );

    // Private Highlight isolation
    await asUser(ALICE_ID, () =>
      db.query(
        `INSERT INTO public.highlights (user_id, title, is_private) VALUES ($1, 'Secret Archive', true)`,
        [ALICE_ID],
      ),
    );
    const bobHighlights = await asUser(BOB_ID, () =>
      db.query<{ title: string }>(`SELECT title FROM public.highlights WHERE user_id = $1`, [
        ALICE_ID,
      ]),
    );
    expect(bobHighlights.rows.length).toBe(0);
  });

  it("Objective C — Signals: institutional security, zero self-verification, strict publisher RBAC, accurate counters, notifications & analytics", async () => {
    // 1. Create Signal + unique slug check
    const sigRes = await asUser(ALICE_ID, () =>
      db.query<{
        sig: {
          id: string;
          slug: string;
          verified: boolean;
          follower_count: number;
          post_count: number;
        };
      }>(
        `SELECT public.create_signal('DOT University Press', 'dot-university', 'Official bulletins', 'Campus notices', 'university', 'https://dot.edu') AS sig`,
      ),
    );
    const sigId = sigRes.rows[0]!.sig.id;
    expect(sigRes.rows[0]!.sig.verified).toBe(false);
    expect(sigRes.rows[0]!.sig.follower_count).toBe(1);
    expect(sigRes.rows[0]!.sig.post_count).toBe(0);

    await expectPgReject(
      BOB_ID,
      `SELECT public.create_signal('Fake DOT', 'dot-university', '', '', 'university', NULL)`,
    );

    // 2. CRITICAL SECURITY: Creator cannot self-verify or forge follower_count/post_count via direct UPDATE
    await asUser(ALICE_ID, () =>
      db.query(
        `UPDATE public.signals
         SET verified = true,
             verification_status = 'verified',
             follower_count = 50000,
             post_count = 9999
         WHERE id = $1`,
        [sigId],
      ),
    );
    const sigAfterTamper = await db.query<{
      verified: boolean;
      verification_status: string;
      follower_count: number;
      post_count: number;
    }>(
      `SELECT verified, verification_status, follower_count, post_count FROM public.signals WHERE id = $1`,
      [sigId],
    );
    expect(sigAfterTamper.rows[0]!.verified).toBe(false);
    expect(sigAfterTamper.rows[0]!.verification_status).toBe("unverified");
    expect(sigAfterTamper.rows[0]!.follower_count).toBe(1);
    expect(sigAfterTamper.rows[0]!.post_count).toBe(0);

    // 3. CRITICAL SECURITY: Normal user Bob is NEVER auto-publisher and cannot directly write signal_publishers or signal_posts
    const bobPubCheck = await db.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM public.signal_publishers WHERE signal_id = $1 AND user_id = $2`,
      [sigId, BOB_ID],
    );
    expect(Number(bobPubCheck.rows[0]!.cnt)).toBe(0);

    await expectPgReject(
      BOB_ID,
      `INSERT INTO public.signal_publishers (signal_id, user_id, role, assigned_by) VALUES ($1, $2, 'admin', $2)`,
      [sigId, BOB_ID],
    );
    await expectPgReject(
      BOB_ID,
      `INSERT INTO public.signal_posts (signal_id, author_id, title, content, category) VALUES ($1, $2, 'Spoof', 'Fake broadcast', 'alert')`,
      [sigId, BOB_ID],
    );

    // 4. Verification request & channel edit workflow: non-admin Bob rejected (closing NULL <> 'admin' bypass!), admin Alice succeeds -> pending (NOT verified!)
    await expectPgReject(
      BOB_ID,
      `SELECT public.request_signal_verification($1, '{"official_email":"spoof@dot.edu"}'::jsonb)`,
      [sigId],
    );
    await expectPgReject(
      BOB_ID,
      `SELECT public.update_signal($1, 'Hijacked Name', '', '', NULL, NULL, 'university')`,
      [sigId],
    );
    await asUser(ALICE_ID, () =>
      db.query(
        `SELECT public.request_signal_verification($1, '{"official_email":"press@dot.edu"}'::jsonb)`,
        [sigId],
      ),
    );
    const sigPending = await db.query<{ verified: boolean; verification_status: string }>(
      `SELECT verified, verification_status FROM public.signals WHERE id = $1`,
      [sigId],
    );
    expect(sigPending.rows[0]!.verified).toBe(false);
    expect(sigPending.rows[0]!.verification_status).toBe("pending");

    // 5. Subscribe / Unsubscribe keeps follower_count 100% synced with actual rows
    await asUser(BOB_ID, () => db.query(`SELECT public.toggle_follow_signal($1)`, [sigId]));
    await asUser(CAROL_ID, () => db.query(`SELECT public.toggle_follow_signal($1)`, [sigId]));
    let sigCounts = await db.query<{ follower_count: number; actual: string }>(
      `SELECT s.follower_count, (SELECT count(*)::text FROM public.signal_followers sf WHERE sf.signal_id = s.id) AS actual
       FROM public.signals s WHERE s.id = $1`,
      [sigId],
    );
    expect(sigCounts.rows[0]!.follower_count).toBe(3);
    expect(Number(sigCounts.rows[0]!.actual)).toBe(3);

    // Carol unsubscribes -> follower_count drops to 2 (Alice + Bob)
    await asUser(CAROL_ID, () => db.query(`SELECT public.toggle_follow_signal($1)`, [sigId]));
    sigCounts = await db.query<{ follower_count: number; actual: string }>(
      `SELECT s.follower_count, (SELECT count(*)::text FROM public.signal_followers sf WHERE sf.signal_id = s.id) AS actual
       FROM public.signals s WHERE s.id = $1`,
      [sigId],
    );
    expect(sigCounts.rows[0]!.follower_count).toBe(2);
    expect(Number(sigCounts.rows[0]!.actual)).toBe(2);

    // 6. Publisher delegation RBAC: Alice adds Bob as publisher; Bob cannot add Carol or remove Alice
    await asUser(ALICE_ID, () =>
      db.query(`SELECT public.manage_signal_publisher($1, 'bob', 'add', 'publisher')`, [sigId]),
    );
    await expectPgReject(
      BOB_ID,
      `SELECT public.manage_signal_publisher($1, 'carol', 'add', 'publisher')`,
      [sigId],
    );
    await expectPgReject(
      BOB_ID,
      `SELECT public.manage_signal_publisher($1, 'alice', 'remove', 'publisher')`,
      [sigId],
    );

    // Promote Bob to admin briefly and verify even another admin CANNOT remove or demote creator Alice
    await asUser(ALICE_ID, () =>
      db.query(`SELECT public.manage_signal_publisher($1, 'bob', 'role', 'admin')`, [sigId]),
    );
    await expectPgReject(
      BOB_ID,
      `SELECT public.manage_signal_publisher($1, 'alice', 'remove', 'publisher')`,
      [sigId],
    );
    await expectPgReject(
      BOB_ID,
      `SELECT public.manage_signal_publisher($1, 'alice', 'role', 'publisher')`,
      [sigId],
    );
    // Demote Bob back to regular publisher
    await asUser(ALICE_ID, () =>
      db.query(`SELECT public.manage_signal_publisher($1, 'bob', 'role', 'publisher')`, [sigId]),
    );

    // 7. Official broadcast publishing by authorized publisher Bob -> increments post_count + delivers notification to subscriber Alice
    const postRes = await asUser(BOB_ID, () =>
      db.query<{ id: string }>(
        `INSERT INTO public.signal_posts (signal_id, author_id, title, content, category, is_urgent, media_urls)
         VALUES ($1, $2, 'Spring Admissions Open', 'Apply before March 30.', 'announcement', true, '["https://cdn.ping.test/media/bob/signals/poster.jpg"]'::jsonb)
         RETURNING id`,
        [sigId, BOB_ID],
      ),
    );
    const postId = postRes.rows[0]!.id;

    const postCountRow = await db.query<{ post_count: number }>(
      `SELECT post_count FROM public.signals WHERE id = $1`,
      [sigId],
    );
    expect(postCountRow.rows[0]!.post_count).toBe(1);

    // Subscriber Alice received real notification; unsubscribed Carol & author Bob did NOT
    const notifRows = await db.query<{ user_id: string; title: string; href: string }>(
      `SELECT user_id, title, href FROM public.notifications WHERE group_key = $1`,
      [`signal_broadcast:${postId}`],
    );
    expect(notifRows.rows.length).toBe(1);
    expect(notifRows.rows[0]!.user_id).toBe(ALICE_ID);
    expect(notifRows.rows[0]!.title).toContain(
      "[URGENT] DOT University Press: Spring Admissions Open",
    );
    expect(notifRows.rows[0]!.href).toBe("/signals/dot-university");

    // 8. Read receipts & analytics accuracy + authorization
    await expectPgReject(CAROL_ID, `SELECT public.get_signal_post_analytics($1)`, [postId]);

    // Subscriber Alice reads + non-subscriber Dave reads
    await asUser(ALICE_ID, () => db.query(`SELECT public.mark_signal_read($1)`, [postId]));
    await asUser(DAVE_ID, () => db.query(`SELECT public.mark_signal_read($1)`, [postId]));

    const analyticsRes = await asUser(BOB_ID, () =>
      db.query<{
        stats: {
          total_recipients: number;
          read_count: number;
          subscriber_read_count: number;
          read_percentage: number;
        };
      }>(`SELECT public.get_signal_post_analytics($1) AS stats`, [postId]),
    );
    expect(analyticsRes.rows[0]!.stats.total_recipients).toBe(2); // Alice + Bob
    expect(analyticsRes.rows[0]!.stats.read_count).toBe(2); // Alice + Dave
    expect(analyticsRes.rows[0]!.stats.subscriber_read_count).toBe(1); // Alice only
    expect(analyticsRes.rows[0]!.stats.read_percentage).toBe(50); // 1/2 = 50% (never >100%)

    // 9. Broadcast deletion accurately decrements post_count back to 0
    await asUser(BOB_ID, () => db.query(`DELETE FROM public.signal_posts WHERE id = $1`, [postId]));
    const postCountAfterDelete = await db.query<{ post_count: number }>(
      `SELECT post_count FROM public.signals WHERE id = $1`,
      [sigId],
    );
    expect(postCountAfterDelete.rows[0]!.post_count).toBe(0);
  });
});
