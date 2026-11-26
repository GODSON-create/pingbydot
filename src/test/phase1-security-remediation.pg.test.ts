// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { citext } from "@electric-sql/pglite/contrib/citext";
import {
  isSafeDeletionTarget,
  runChatRetentionSweep,
  type MediaDeletionJobRow,
} from "@/lib/chat-retention-worker";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

const VICTIM_ID = "11111111-1111-4111-8111-111111111111";
const ATTACKER_ID = "22222222-2222-4222-8222-222222222222";
const PEER_ID = "33333333-3333-4333-8333-333333333333";

/**
 * Real PostgreSQL 17 integration test harness (via PGlite WASM) executing the
 * actual Ping migration ledger (0000..0040), real RLS policies, real triggers,
 * real column/table privileges, and real role switching (`SET LOCAL ROLE authenticated`)
 * across separate user accounts. Zero database mocks.
 */
describe("Ping Stage 2 — Phase 1 P0 Security Remediation (Real PostgreSQL 17 Integration)", () => {
  let db: PGlite;

  /**
   * Executes a callback inside a PostgreSQL transaction impersonating a real
   * Supabase authenticated user (or anon/service_role), rolling back only if
   * the statement fails (when called via `expectPgReject`).
   */
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

    // Bootstrap Supabase-equivalent roles, auth schema, storage schema, and realtime publication
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

    // Apply ALL 41 real Ping migrations strictly in _journal.json order (0000..0040)
    const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.length).toBe(41);
    expect(journal.entries[40]?.tag).toBe("0040_stage2_phase1_security_remediation");

    for (const entry of journal.entries) {
      const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
      const sqlText = fs.readFileSync(sqlPath, "utf8");
      try {
        await db.exec(sqlText);
      } catch (err) {
        throw new Error(
          `Migration ${entry.tag}.sql failed in real PostgreSQL 17: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Prove Migration 0040 idempotency by applying it a SECOND time verbatim
    const sql0040 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "0040_stage2_phase1_security_remediation.sql"),
      "utf8",
    );
    await db.exec(sql0040);

    // Seed three separate real user accounts (Victim, Attacker, Peer)
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES
        ('${VICTIM_ID}', 'victim@ping.test', '{"username":"victim_user","display_name":"Victim User"}'::jsonb),
        ('${ATTACKER_ID}', 'attacker@ping.test', '{"username":"attacker_user","display_name":"Attacker User"}'::jsonb),
        ('${PEER_ID}', 'peer@ping.test', '{"username":"peer_user","display_name":"Peer User"}'::jsonb);

      INSERT INTO public.profiles (id, username, display_name)
      VALUES
        ('${VICTIM_ID}', 'victim_user', 'Victim User'),
        ('${ATTACKER_ID}', 'attacker_user', 'Attacker User'),
        ('${PEER_ID}', 'peer_user', 'Peer User')
      ON CONFLICT (id) DO NOTHING;

      -- Mutual follows between Victim & Attacker so they share an accepted DM conversation
      INSERT INTO public.follows (follower_id, following_id)
      VALUES
        ('${VICTIM_ID}', '${ATTACKER_ID}'),
        ('${ATTACKER_ID}', '${VICTIM_ID}'),
        ('${VICTIM_ID}', '${PEER_ID}'),
        ('${PEER_ID}', '${VICTIM_ID}')
      ON CONFLICT DO NOTHING;
    `);
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it("1. blocks direct client manipulation of public.media_assets and cross-user registration", async () => {
    // Seed Victim's public avatar in storage.objects
    const victimAvatarKey = `${VICTIM_ID}/avatars/victim-avatar.webp`;
    await asUser(VICTIM_ID, async () => {
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('media', $1, $2::uuid, '{"mimetype":"image/webp","size":42000}'::jsonb)`,
        [victimAvatarKey, VICTIM_ID],
      );
      await db.query(`UPDATE public.profiles SET avatar_url = $1 WHERE id = $2::uuid`, [
        `https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/${victimAvatarKey}`,
        VICTIM_ID,
      ]);
      // Victim cleanly registers own public media via server-authorized RPC
      const reg = await db.query<{ res: { size_bytes: number; status: string } }>(
        `SELECT public.register_my_media_asset('media', $1, 'image', 'image/webp') AS res`,
        [victimAvatarKey],
      );
      expect(reg.rows[0]?.res.size_bytes).toBe(42000);
      expect(reg.rows[0]?.res.status).toBe("ready");
    });

    // Attacker attempts direct INSERT into public.media_assets targeting Victim's avatar with backdated staging status
    await expectPgReject(
      ATTACKER_ID,
      `INSERT INTO public.media_assets (owner_id, media_kind, provider, bucket, object_key, source_url, status, size_bytes, created_at)
       VALUES ($1::uuid, 'image', 'supabase_storage', 'media', $2, $3, 'staging', 0, '2020-01-01T00:00:00Z')`,
      [ATTACKER_ID, victimAvatarKey, `storage://media/${victimAvatarKey}`],
    );

    // Attacker attempts direct UPDATE / DELETE on public.media_assets
    await expectPgReject(
      ATTACKER_ID,
      `UPDATE public.media_assets SET status = 'staging', created_at = '2020-01-01T00:00:00Z' WHERE object_key = $1`,
      [victimAvatarKey],
    );
    await expectPgReject(ATTACKER_ID, `DELETE FROM public.media_assets WHERE object_key = $1`, [
      victimAvatarKey,
    ]);

    // Attacker attempts calling register_my_media_asset pointing to Victim's object
    await expectPgReject(
      ATTACKER_ID,
      `SELECT public.register_my_media_asset('media', $1, 'image', 'image/webp')`,
      [victimAvatarKey],
    );

    // Attacker attempts registering a non-existent (unuploaded) object in Attacker's own folder
    await expectPgReject(
      ATTACKER_ID,
      `SELECT public.register_my_media_asset('media', $1, 'image', 'image/webp')`,
      [`${ATTACKER_ID}/avatars/does-not-exist.webp`],
    );

    // Verify zero deletion jobs were created for Victim's avatar
    const queued = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.media_deletion_queue WHERE object_key = $1`,
      [victimAvatarKey],
    );
    expect(queued.rows[0]?.cnt).toBe(0);
  });

  it("2. blocks attacker submitting Victim's media URLs in Hub messages & prevents cross-user Hub deletion", async () => {
    // Victim creates Victim's Hub & uploads a private Hub document
    let victimHubId = "";
    const victimHubDocKey = (hubId: string) => `${hubId}/${VICTIM_ID}/confidential-plan.pdf`;
    await asUser(VICTIM_ID, async () => {
      const h = await db.query<{ hub: { id: string } }>(
        `SELECT public.create_hub('Victim Private Hub', 'victim-priv-hub-p1', 'Tag', 'Desc', '', 'community', 'private', '[]'::jsonb) AS hub`,
      );
      victimHubId = h.rows[0]!.hub.id;
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('hub-attachments', $1, $2::uuid, '{"mimetype":"application/pdf","size":150000}'::jsonb)`,
        [victimHubDocKey(victimHubId), VICTIM_ID],
      );
      // Verify Victim can read own private Hub attachment and upload Hub-audience restricted Moment
      const visibleToVictim = await db.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM storage.objects WHERE bucket_id = 'hub-attachments' AND name = $1`,
        [victimHubDocKey(victimHubId)],
      );
      expect(visibleToVictim.rows[0]?.cnt).toBe(1);

      const hubMomentKey = `${VICTIM_ID}/hub/${victimHubId}/moment-clip.webp`;
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('private-moments', $1, $2::uuid, '{"mimetype":"image/webp","size":52000}'::jsonb)`,
        [hubMomentKey, VICTIM_ID],
      );

      await db.query(
        `INSERT INTO public.hub_messages (hub_id, sender_id, content, media_url)
         VALUES ($1::uuid, $2::uuid, 'Confidential PDF', $3)`,
        [victimHubId, VICTIM_ID, `storage://hub-attachments/${victimHubDocKey(victimHubId)}`],
      );
    });

    // Verify Hub message AFTER INSERT trigger automatically created a 'ready' media_assets record with authoritative size
    const hubAsset = await db.query<{ status: string; size_bytes: number }>(
      `SELECT status, size_bytes::int AS size_bytes
       FROM public.media_assets
       WHERE bucket = 'hub-attachments' AND object_key = $1`,
      [victimHubDocKey(victimHubId)],
    );
    expect(hubAsset.rows[0]).toEqual({ status: "ready", size_bytes: 150000 });

    // Verify Attacker cannot read Victim's private Hub attachment via storage RLS
    await asUser(ATTACKER_ID, async () => {
      const visibleToAttacker = await db.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM storage.objects WHERE bucket_id = 'hub-attachments' AND name = $1`,
        [victimHubDocKey(victimHubId)],
      );
      expect(visibleToAttacker.rows[0]?.cnt).toBe(0);
    });

    // Attacker creates Attacker's own Hub and tries every cross-user media_url hijack
    let attackerHubId = "";
    await asUser(ATTACKER_ID, async () => {
      const h = await db.query<{ hub: { id: string } }>(
        `SELECT public.create_hub('Attacker Hub', 'attacker-hub-p1', 'Tag', 'Desc', '', 'community', 'private', '[]'::jsonb) AS hub`,
      );
      attackerHubId = h.rows[0]!.hub.id;
    });

    // Exploit attempt 2a: Victim's Hub attachment from another Hub
    await expectPgReject(
      ATTACKER_ID,
      `INSERT INTO public.hub_messages (hub_id, sender_id, content, media_url)
       VALUES ($1::uuid, $2::uuid, 'Steal hub file', $3)`,
      [attackerHubId, ATTACKER_ID, `storage://hub-attachments/${victimHubDocKey(victimHubId)}`],
    );

    // Exploit attempt 2b: Victim's public media URL
    await expectPgReject(
      ATTACKER_ID,
      `INSERT INTO public.hub_messages (hub_id, sender_id, content, media_url)
       VALUES ($1::uuid, $2::uuid, 'Delete avatar', $3)`,
      [
        attackerHubId,
        ATTACKER_ID,
        `https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/${VICTIM_ID}/avatars/victim-avatar.webp`,
      ],
    );

    // Exploit attempt 2c: Victim's DM bucket ref
    await expectPgReject(
      ATTACKER_ID,
      `INSERT INTO public.hub_messages (hub_id, sender_id, content, media_url)
       VALUES ($1::uuid, $2::uuid, 'Delete DM', $3)`,
      [
        attackerHubId,
        ATTACKER_ID,
        `storage://dm-attachments/${victimHubId}/${VICTIM_ID}/secret.webp`,
      ],
    );

    // Exploit attempt 2d: Unverified spoofed r2:// Hub attachment
    await expectPgReject(
      ATTACKER_ID,
      `INSERT INTO public.hub_messages (hub_id, sender_id, content, media_url)
       VALUES ($1::uuid, $2::uuid, 'Fake R2 file', $3)`,
      [attackerHubId, ATTACKER_ID, `r2://hub-attachments/${attackerHubId}/${ATTACKER_ID}/fake.pdf`],
    );

    // Exploit attempt 2e: Insert clean text-only message, then UPDATE media_url + deleted_at
    let attackerMsgId = "";
    await asUser(ATTACKER_ID, async () => {
      const ins = await db.query<{ id: string }>(
        `INSERT INTO public.hub_messages (hub_id, sender_id, content)
         VALUES ($1::uuid, $2::uuid, 'Innocent text') RETURNING id`,
        [attackerHubId, ATTACKER_ID],
      );
      attackerMsgId = ins.rows[0]!.id;
    });

    await expectPgReject(
      ATTACKER_ID,
      `UPDATE public.hub_messages SET media_url = $1, deleted_at = now() WHERE id = $2::uuid`,
      [`storage://hub-attachments/${victimHubDocKey(victimHubId)}`, attackerMsgId],
    );

    // Verify Victim's Hub attachment & public avatar have ZERO queued deletion jobs
    const queued = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.media_deletion_queue`,
    );
    expect(queued.rows[0]?.cnt).toBe(0);
  });

  it("3. blocks attacker submitting Victim's public media URL or cross-scope paths in DMs", async () => {
    let convId = "";
    await asUser(ATTACKER_ID, async () => {
      const c = await db.query<{ id: string }>(
        `SELECT public.get_or_create_direct_conversation($1::uuid) AS id`,
        [VICTIM_ID],
      );
      convId = c.rows[0]!.id;
    });

    // Exploit 3a: Attacker submits Victim's public media URL in DM
    await expectPgReject(
      ATTACKER_ID,
      `SELECT public.send_private_message($1::uuid, 'Look', $2, 'image')`,
      [
        convId,
        `https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/${VICTIM_ID}/avatars/victim-avatar.webp`,
      ],
    );

    // Exploit 3b: Attacker submits storage://media/... cross-bucket ref in DM
    await expectPgReject(
      ATTACKER_ID,
      `SELECT public.send_private_message($1::uuid, 'Look', $2, 'image')`,
      [convId, `storage://media/${VICTIM_ID}/avatars/victim-avatar.webp`],
    );

    // Exploit 3c: Attacker submits Victim's sender folder inside shared conversation
    await expectPgReject(
      ATTACKER_ID,
      `SELECT public.send_private_message($1::uuid, 'Look', $2, 'image')`,
      [convId, `${convId}/${VICTIM_ID}/victim-photo.webp`],
    );

    // Exploit 3d: Even if a legacy pre-0040 DM row holds a public https:// URL and is soft-deleted,
    // enqueue_deleted_private_message_media MUST NOT enqueue the public URL for deletion!
    const legacyMsg = await db.query<{ id: string }>(
      `INSERT INTO public.private_messages (conversation_id, sender_id, content, media_url, media_type)
       VALUES ($1::uuid, $2::uuid, 'Legacy public photo', $3, 'image')
       RETURNING id`,
      [
        convId,
        ATTACKER_ID,
        `https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/${VICTIM_ID}/avatars/victim-avatar.webp`,
      ],
    );
    await asUser(ATTACKER_ID, async () => {
      await db.query(`UPDATE public.private_messages SET deleted_at = now() WHERE id = $1::uuid`, [
        legacyMsg.rows[0]!.id,
      ]);
    });

    const queued = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.media_deletion_queue`,
    );
    expect(queued.rows[0]?.cnt).toBe(0);
  });

  it("4. prevents 0-byte size spoofing and enforces saved-message storage quotas authoritatively", async () => {
    let convId = "";
    await asUser(ATTACKER_ID, async () => {
      const c = await db.query<{ id: string }>(
        `SELECT public.get_or_create_direct_conversation($1::uuid) AS id`,
        [VICTIM_ID],
      );
      convId = c.rows[0]!.id;
    });

    // Zero-byte spoofed storage object is rejected by BOTH register_my_media_asset AND send_private_message
    const zeroKey = `${convId}/${ATTACKER_ID}/zero-spoof.mp4`;
    await asUser(ATTACKER_ID, async () => {
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('dm-attachments', $1, $2::uuid, '{"mimetype":"video/mp4","size":0}'::jsonb)`,
        [zeroKey, ATTACKER_ID],
      );
    });

    await expectPgReject(
      ATTACKER_ID,
      `SELECT public.register_my_media_asset('dm-attachments', $1, 'video', 'video/mp4', NULL, $2::uuid)`,
      [zeroKey, convId],
    );
    await expectPgReject(
      ATTACKER_ID,
      `SELECT public.send_private_message($1::uuid, '', $2, 'video')`,
      [convId, zeroKey],
    );

    // Real 60 MB files uploaded WITHOUT calling register_my_media_asset:
    // send_private_message MUST derive 60,000,000 bytes authoritatively from storage.objects!
    const bigKey1 = `${convId}/${ATTACKER_ID}/clip-1.mp4`;
    const bigKey2 = `${convId}/${ATTACKER_ID}/clip-2.mp4`;
    let msg1Id = "";
    let msg2Id = "";

    await asUser(ATTACKER_ID, async () => {
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES
           ('dm-attachments', $1, $3::uuid, '{"mimetype":"video/mp4","size":60000000}'::jsonb),
           ('dm-attachments', $2, $3::uuid, '{"mimetype":"video/mp4","size":60000000}'::jsonb)`,
        [bigKey1, bigKey2, ATTACKER_ID],
      );

      const m1 = await db.query<{ msg: { id: string; media_size_bytes: number } }>(
        `SELECT public.send_private_message($1::uuid, '', $2, 'video') AS msg`,
        [convId, bigKey1],
      );
      const m2 = await db.query<{ msg: { id: string; media_size_bytes: number } }>(
        `SELECT public.send_private_message($1::uuid, '', $2, 'video') AS msg`,
        [convId, bigKey2],
      );

      expect(Number(m1.rows[0]!.msg.media_size_bytes)).toBe(60_000_000);
      expect(Number(m2.rows[0]!.msg.media_size_bytes)).toBe(60_000_000);
      msg1Id = m1.rows[0]!.msg.id;
      msg2Id = m2.rows[0]!.msg.id;

      // Save 1st 60 MB message -> succeeds under 100 MB (104,857,600 B) unverified quota
      const save1 = await db.query<{ res: { saved: boolean; saved_bytes: number } }>(
        `SELECT public.toggle_save_private_message($1::uuid, true) AS res`,
        [msg1Id],
      );
      expect(save1.rows[0]!.res.saved).toBe(true);
      expect(Number(save1.rows[0]!.res.saved_bytes)).toBe(60_000_000);
    });

    // Save 2nd 60 MB message (total 120 MB > 100 MB quota) -> MUST FAIL with quota exceeded!
    const quotaErr = await expectPgReject(
      ATTACKER_ID,
      `SELECT public.toggle_save_private_message($1::uuid, true)`,
      [msg2Id],
    );
    expect(quotaErr.message).toMatch(/quota exceeded/i);
  });

  it("5. protects live DM attachments from orphan cleanup and prevents workers from claiming live objects", async () => {
    let victimPeerConvId = "";
    const liveVoiceKey = (cid: string) => `${cid}/${VICTIM_ID}/live-voice-note.webm`;
    const abandonedKey = (cid: string) => `${cid}/${VICTIM_ID}/abandoned-draft.webm`;

    await asUser(VICTIM_ID, async () => {
      const c = await db.query<{ id: string }>(
        `SELECT public.get_or_create_direct_conversation($1::uuid) AS id`,
        [PEER_ID],
      );
      victimPeerConvId = c.rows[0]!.id;

      // Upload BOTH a live voice note (will be sent) and an abandoned draft (never sent)
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES
           ('dm-attachments', $1, $3::uuid, '{"mimetype":"audio/webm","size":180000}'::jsonb),
           ('dm-attachments', $2, $3::uuid, '{"mimetype":"audio/webm","size":95000}'::jsonb)`,
        [liveVoiceKey(victimPeerConvId), abandonedKey(victimPeerConvId), VICTIM_ID],
      );

      // Register abandoned draft as staging (user closed tab before sending)
      await db.query(
        `SELECT public.register_my_media_asset('dm-attachments', $1, 'audio', 'audio/webm', NULL, $2::uuid)`,
        [abandonedKey(victimPeerConvId), victimPeerConvId],
      );

      // Send live voice note -> atomically creates/updates media_assets as 'ready'
      await db.query(`SELECT public.send_private_message($1::uuid, '', $2, 'audio')`, [
        victimPeerConvId,
        liveVoiceKey(victimPeerConvId),
      ]);
    });

    // Confirm live voice note is already 'ready' immediately after send
    const liveAssetBefore = await db.query<{ status: string }>(
      `SELECT status FROM public.media_assets WHERE bucket = 'dm-attachments' AND object_key = $1`,
      [liveVoiceKey(victimPeerConvId)],
    );
    expect(liveAssetBefore.rows[0]?.status).toBe("ready");

    // Verify DM storage SELECT RLS works cleanly for participants (without permission denied on media_deletion_queue)
    // and blocks non-participants
    await asUser(PEER_ID, async () => {
      const peerCanRead = await db.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM storage.objects WHERE bucket_id = 'dm-attachments' AND name = $1`,
        [liveVoiceKey(victimPeerConvId)],
      );
      expect(peerCanRead.rows[0]?.cnt).toBe(1);
    });
    await asUser(ATTACKER_ID, async () => {
      const attackerCanRead = await db.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM storage.objects WHERE bucket_id = 'dm-attachments' AND name = $1`,
        [liveVoiceKey(victimPeerConvId)],
      );
      expect(attackerCanRead.rows[0]?.cnt).toBe(0);
    });

    // Simulate worst-case race: force live voice note back to 'staging' & backdate BOTH rows > 48h
    await db.query(
      `UPDATE public.media_assets
       SET status = 'staging', created_at = now() - interval '48 hours'
       WHERE bucket = 'dm-attachments' AND object_key IN ($1, $2)`,
      [liveVoiceKey(victimPeerConvId), abandonedKey(victimPeerConvId)],
    );

    // Run orphan sweep as service_role -> MUST skip & heal live voice note, enqueue ONLY abandoned draft!
    const sweepRes = await asUser("service_role", async () =>
      db.query<{ cnt: number }>(`SELECT public.enqueue_orphaned_staging_media(24, 500) AS cnt`),
    );
    expect(sweepRes.rows[0]?.cnt).toBe(1);

    // Queued abandoned draft is immediately unreadable via DM storage RLS
    await asUser(VICTIM_ID, async () => {
      const queuedReadable = await db.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM storage.objects WHERE bucket_id = 'dm-attachments' AND name = $1`,
        [abandonedKey(victimPeerConvId)],
      );
      expect(queuedReadable.rows[0]?.cnt).toBe(0);
    });

    // Live voice note was healed back to 'ready' and NOT enqueued
    const liveAssetHealed = await db.query<{ status: string }>(
      `SELECT status FROM public.media_assets WHERE bucket = 'dm-attachments' AND object_key = $1`,
      [liveVoiceKey(victimPeerConvId)],
    );
    expect(liveAssetHealed.rows[0]?.status).toBe("ready");

    const liveQueued = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.media_deletion_queue WHERE object_key = $1`,
      [liveVoiceKey(victimPeerConvId)],
    );
    expect(liveQueued.rows[0]?.cnt).toBe(0);

    // Defense-in-depth: even if a rogue queue row targeting Victim's live voice note is forced into
    // media_deletion_queue directly by service_role, claim_media_deletion_jobs() MUST refuse to claim it!
    await db.query(
      `INSERT INTO public.media_deletion_queue (provider, bucket, object_key, source_type, owner_id, size_bytes, status)
       VALUES ('supabase_storage', 'dm-attachments', $1, 'staging_orphan', $2::uuid, 180000, 'pending')`,
      [liveVoiceKey(victimPeerConvId), VICTIM_ID],
    );

    const claimed = await asUser("service_role", async () =>
      db.query<{ object_key: string }>(
        `SELECT object_key FROM public.claim_media_deletion_jobs(100)`,
      ),
    );
    expect(claimed.rows.map((r) => r.object_key)).toEqual([abandonedKey(victimPeerConvId)]);

    const abortedRogue = await db.query<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM public.media_deletion_queue WHERE object_key = $1`,
      [liveVoiceKey(victimPeerConvId)],
    );
    expect(abortedRogue.rows[0]?.status).toBe("failed");
    expect(abortedRogue.rows[0]?.last_error).toMatch(/actively referenced by live content/i);
  });

  it("6. rejects invalid bucket names, traversal paths, encoded traversal, cross-bucket & victim derivatives", async () => {
    // SQL validate_storage_object_scope rejections
    const badCases: Array<[string, string]> = [
      ["evil-bucket", `${ATTACKER_ID}/file.jpg`],
      ["../etc", `${ATTACKER_ID}/passwd`],
      ["media", `../${VICTIM_ID}/avatar.jpg`],
      ["media", `${ATTACKER_ID}/../${VICTIM_ID}/avatar.jpg`],
      ["media", `${ATTACKER_ID}/%2e%2e/${VICTIM_ID}/avatar.jpg`],
      ["media", `${ATTACKER_ID}/%2F..%2F${VICTIM_ID}/avatar.jpg`],
      ["media", `${ATTACKER_ID}\\..\\${VICTIM_ID}\\avatar.jpg`],
      ["media", `/${ATTACKER_ID}/avatar.jpg`],
      ["media", `https://evil.example/storage/v1/object/public/media/${VICTIM_ID}/a.jpg`],
      ["dm-attachments", `${ATTACKER_ID}/missing-third-segment.jpg`],
      ["private-moments", `${ATTACKER_ID}/close_circle/missing-fourth-segment.jpg`],
    ];

    for (const [bucket, key] of badCases) {
      const r = await db.query<{ ok: boolean }>(
        `SELECT public.validate_storage_object_scope($1, $2) AS ok`,
        [bucket, key],
      );
      expect(r.rows[0]?.ok, `SQL must reject (${bucket}, ${key})`).toBe(false);
      expect(isSafeDeletionTarget(bucket, key), `Worker must reject (${bucket}, ${key})`).toBe(
        false,
      );
    }

    // enqueue_media_object_deletion rejects cross-bucket refs, https:// URLs, and owner mismatch,
    // and strips spoofed victim derivative keys while keeping only valid owner-scoped derivatives!
    const crossBucket = await asUser("service_role", async () =>
      db.query<{ ok: boolean }>(
        `SELECT public.enqueue_media_object_deletion(
           'storage://media/${VICTIM_ID}/avatars/victim-avatar.webp',
           'dm-attachments',
           'private_message_deleted',
           NULL,
           '${ATTACKER_ID}'::uuid,
           0,
           '{}'::text[]
         ) AS ok`,
      ),
    );
    expect(crossBucket.rows[0]?.ok).toBe(false);

    const httpsRef = await asUser("service_role", async () =>
      db.query<{ ok: boolean }>(
        `SELECT public.enqueue_media_object_deletion(
           'https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/${VICTIM_ID}/avatars/victim-avatar.webp',
           'media',
           'staging_orphan',
           NULL,
           '${VICTIM_ID}'::uuid,
           0,
           '{}'::text[]
         ) AS ok`,
      ),
    );
    expect(httpsRef.rows[0]?.ok).toBe(false);

    const spoofedDerivConv = "44444444-4444-4444-8444-444444444444";
    const ownKey = `${spoofedDerivConv}/${ATTACKER_ID}/own-file.webp`;
    const ownDeriv = `${spoofedDerivConv}/${ATTACKER_ID}/own-file_thumb.webp`;
    const victimDeriv = `${spoofedDerivConv}/${VICTIM_ID}/victim-file.webp`;

    const enqDeriv = await asUser("service_role", async () =>
      db.query<{ ok: boolean }>(
        `SELECT public.enqueue_media_object_deletion(
           $1, 'dm-attachments', 'private_message_deleted', NULL, $2::uuid, 1024, ARRAY[$3, $4, '../escape.webp']::text[]
         ) AS ok`,
        [ownKey, ATTACKER_ID, ownDeriv, victimDeriv],
      ),
    );
    expect(enqDeriv.rows[0]?.ok).toBe(true);

    const savedRow = await db.query<{ derivative_keys: string[] }>(
      `SELECT derivative_keys FROM public.media_deletion_queue WHERE object_key = $1`,
      [ownKey],
    );
    expect(savedRow.rows[0]?.derivative_keys).toEqual([ownDeriv]);

    // Worker defense-in-depth refuses to call deleteStorageKeys for any unsafe bucket/key
    const deleteSpy = vi.fn(async () => ({ ok: true }));
    const completeSpy = vi.fn(async () => {});
    const badJobs: MediaDeletionJobRow[] = [
      {
        id: "bad-job-1",
        provider: "supabase_storage",
        bucket: "evil-bucket",
        object_key: `${VICTIM_ID}/avatars/victim.webp`,
        derivative_keys: [],
        source_type: "staging_orphan",
        source_id: null,
        size_bytes: 100,
        status: "processing",
        attempt_count: 1,
        max_attempts: 5,
      },
      {
        id: "bad-job-2",
        provider: "supabase_storage",
        bucket: "dm-attachments",
        object_key: `${spoofedDerivConv}/${ATTACKER_ID}/%2e%2e/${VICTIM_ID}/secret.webp`,
        derivative_keys: [],
        source_type: "staging_orphan",
        source_id: null,
        size_bytes: 100,
        status: "processing",
        attempt_count: 1,
        max_attempts: 5,
      },
    ];

    const summary = await runChatRetentionSweep({
      processExpiredBatch: async () => ({ expired_messages: 0, enqueued_media_deletions: 0 }),
      enqueueOrphanedStaging: async () => 0,
      claimDeletionJobs: async () => badJobs,
      completeDeletionJob: completeSpy,
      deleteStorageKeys: deleteSpy,
    });

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(summary.failedObjects).toBe(2);
    expect(summary.deletedObjects).toBe(0);
    expect(completeSpy).toHaveBeenCalledWith(
      "bad-job-1",
      false,
      expect.stringMatching(/unsafe deletion target/i),
    );
    expect(completeSpy).toHaveBeenCalledWith(
      "bad-job-2",
      false,
      expect.stringMatching(/unsafe deletion target/i),
    );
  });
});
