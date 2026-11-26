// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { deleteR2ObjectServer, presignS3Request, readR2ServerConfig } from "@/lib/r2-sigv4";
import {
  defaultAuthorizeAgainstSupabase,
  handleDeleteMediaRequest,
  handlePresignUploadRequest,
  handleSignReadRequest,
} from "@/lib/media-server";
import { CloudflareR2MediaProvider, type MediaStorageProvider } from "@/lib/media-provider";
import { uploadPartsDirectly } from "@/lib/resumable-upload";
import { buildUniqueMediaFilename } from "@/lib/media-optimizer";
import { handleChatRetentionCronRequest } from "@/lib/chat-retention-worker";
import {
  createAuthorizedMediaReadUrl,
  extractPrivateDmMediaPath,
  isPrivateDmMediaRef,
  setMediaStorageProviderForTesting,
} from "@/lib/storage";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

const ALICE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const BOB_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const CAROL_ID = "cccccccc-3333-4333-8333-333333333333";
const DAVE_ID = "dddddddd-4444-4444-8444-444444444444";

const R2_TEST_ENV: Record<string, string> = {
  PING_MEDIA_PROVIDER: "cloudflare_r2",
  R2_ACCOUNT_ID: "acct123456",
  R2_ACCESS_KEY_ID: "AKIA_TEST_KEY",
  R2_SECRET_ACCESS_KEY: "SECRET_TEST_KEY_987654321",
  R2_PUBLIC_BUCKET: "ping-media",
  R2_PRIVATE_BUCKET: "ping-private",
  R2_PUBLIC_CDN_URL: "https://media.pingbydot.example",
  R2_REGION: "auto",
};

/**
 * Real PostgreSQL 17 integration & adversarial security test suite covering ALL
 * Phase 2 remediations (C4, C5, H2, H3, H4, H5, H6, H7, H8, H9, M1, M3, M5, M6, M7, M8).
 * Executes all 42 migrations (0000..0041) verbatim + proves 0041 double-run idempotency.
 */
describe("Ping Stage 2 — Phase 2 Security, Reliability, R2 & Retention (Real PostgreSQL 17)", () => {
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
    expect(journal.entries.length).toBeGreaterThanOrEqual(42);
    expect(journal.entries[41]?.tag).toBe("0041_stage2_phase2_security_reliability_and_retention");

    for (const entry of journal.entries) {
      const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
      await db.exec(sqlText);
    }

    // Prove Migration 0041 idempotency by running it verbatim a SECOND time
    const sql0041 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "0041_stage2_phase2_security_reliability_and_retention.sql"),
      "utf8",
    );
    await db.exec(sql0041);

    // Enable chat_retention inside this local test DB ONLY to exercise retention timelines
    await db.exec(
      `UPDATE public.app_feature_flags SET enabled = true WHERE key = 'chat_retention';`,
    );

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
        ('${CAROL_ID}', 'carol', 'Carol'),
        ('${DAVE_ID}', 'dave', 'Dave')
      ON CONFLICT (id) DO NOTHING;

      -- Alice = verified (30d max), Bob = unverified (7d max), Carol = verified (30d), Dave = legacy 'institution' (until_deleted)
      INSERT INTO public.account_verifications (user_id, verification_domain, pathway_type, status, verified_at)
      VALUES
        ('${ALICE_ID}', 'identity', 'identity_standard', 'verified', now()),
        ('${CAROL_ID}', 'identity', 'identity_standard', 'verified', now());

      INSERT INTO public.account_subscriptions (user_id, tier, status)
      VALUES ('${DAVE_ID}', 'institution', 'active');

      -- Mutual follows among Alice, Bob, Carol, Dave (except pending-request test uses fresh account)
      INSERT INTO public.follows (follower_id, following_id)
      VALUES
        ('${ALICE_ID}', '${BOB_ID}'), ('${BOB_ID}', '${ALICE_ID}'),
        ('${ALICE_ID}', '${CAROL_ID}'), ('${CAROL_ID}', '${ALICE_ID}'),
        ('${BOB_ID}', '${CAROL_ID}'), ('${CAROL_ID}', '${BOB_ID}'),
        ('${ALICE_ID}', '${DAVE_ID}'), ('${DAVE_ID}', '${ALICE_ID}')
      ON CONFLICT DO NOTHING;
    `);
  }, 60_000);

  afterAll(async () => {
    setMediaStorageProviderForTesting(null);
    if (db) await db.close();
  });

  it("C4 + H2: can_read_dm_media_object & /api/media/sign-read fail closed on expired/deleted/unreferenced DMs and support R2 Moments + rollback dual-read", async () => {
    let convId = "";
    await asUser(ALICE_ID, async () => {
      const c = await db.query<{ id: string }>(
        `SELECT public.get_or_create_direct_conversation($1::uuid) AS id`,
        [BOB_ID],
      );
      convId = c.rows[0]!.id;
    });

    const liveR2Key = `${convId}/${ALICE_ID}/live-r2-photo.webp`;
    const expiredR2Key = `${convId}/${ALICE_ID}/expired-r2-photo.webp`;
    const ghostR2Key = `${convId}/${ALICE_ID}/never-sent-ghost.webp`;

    // Register verified server-side R2 objects
    await asUser("service_role", async () => {
      await db.query(
        `SELECT public.register_server_media_asset($1::uuid, 'cloudflare_r2', 'dm-attachments', $2, 'image', 55000, 'image/webp', $3::uuid)`,
        [ALICE_ID, liveR2Key, convId],
      );
      await db.query(
        `SELECT public.register_server_media_asset($1::uuid, 'cloudflare_r2', 'dm-attachments', $2, 'image', 65000, 'image/webp', $3::uuid)`,
        [ALICE_ID, expiredR2Key, convId],
      );
    });

    // H2: send_private_message accepts server-verified r2://dm-attachments/... cleanly
    let expiredMsgId = "";
    await asUser(ALICE_ID, async () => {
      await db.query(`SELECT public.send_private_message($1::uuid, '', $2, 'image')`, [
        convId,
        `r2://dm-attachments/${liveR2Key}`,
      ]);
      const m2 = await db.query<{ msg: { id: string } }>(
        `SELECT public.send_private_message($1::uuid, '', $2, 'image') AS msg`,
        [convId, `r2://dm-attachments/${expiredR2Key}`],
      );
      expiredMsgId = m2.rows[0]!.msg.id;
    });

    // Force second message past expiry (hidden by private_messages SELECT RLS!)
    await db.query(
      `UPDATE public.private_messages SET expires_at = now() - interval '2 hours' WHERE id = $1::uuid`,
      [expiredMsgId],
    );

    // Wire a live bridge from defaultAuthorizeAgainstSupabase -> real PostgreSQL 17 RPCs
    const livePgFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const authHeader =
        (init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? "";
      const callerUid = authHeader.replace(/^Bearer\s+uid:/i, "");

      if (urlStr.endsWith("/rpc/can_read_dm_media_object")) {
        const res = await asUser(callerUid, () =>
          db.query<{ ok: boolean }>(`SELECT public.can_read_dm_media_object($1::uuid, $2) AS ok`, [
            body["p_conversation_id"],
            body["p_object_key"],
          ]),
        );
        return new Response(JSON.stringify(Boolean(res.rows[0]?.ok)), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected endpoint" }), { status: 500 });
    }) as typeof fetch;

    // 1. Live R2 DM attachment -> Bob (participant) ALLOWED
    const okBob = await defaultAuthorizeAgainstSupabase({
      token: `uid:${BOB_ID}`,
      userId: BOB_ID,
      action: "read",
      bucket: "dm-attachments",
      objectKey: liveR2Key,
      fetchImpl: livePgFetch,
      supabaseUrlOverride: "https://test.supabase.local",
      supabaseAnonKeyOverride: "anon-key",
    });
    expect(okBob.allowed).toBe(true);

    // 2. Non-participant Carol -> DENIED
    const deniedCarol = await defaultAuthorizeAgainstSupabase({
      token: `uid:${CAROL_ID}`,
      userId: CAROL_ID,
      action: "read",
      bucket: "dm-attachments",
      objectKey: liveR2Key,
      fetchImpl: livePgFetch,
      supabaseUrlOverride: "https://test.supabase.local",
      supabaseAnonKeyOverride: "anon-key",
    });
    expect(deniedCarol.allowed).toBe(false);

    // 3. C4 CRITICAL: Expired R2 DM attachment -> Bob DENIED (fails closed, NOT bypassed by empty RLS!)
    const deniedExpired = await defaultAuthorizeAgainstSupabase({
      token: `uid:${BOB_ID}`,
      userId: BOB_ID,
      action: "read",
      bucket: "dm-attachments",
      objectKey: expiredR2Key,
      fetchImpl: livePgFetch,
      supabaseUrlOverride: "https://test.supabase.local",
      supabaseAnonKeyOverride: "anon-key",
    });
    expect(deniedExpired.allowed).toBe(false);

    // 4. C4 CRITICAL: Unreferenced / scrubbed object -> Bob DENIED
    const deniedGhost = await defaultAuthorizeAgainstSupabase({
      token: `uid:${BOB_ID}`,
      userId: BOB_ID,
      action: "read",
      bucket: "dm-attachments",
      objectKey: ghostR2Key,
      fetchImpl: livePgFetch,
      supabaseUrlOverride: "https://test.supabase.local",
      supabaseAnonKeyOverride: "anon-key",
    });
    expect(deniedGhost.allowed).toBe(false);

    // 5. C4 CRITICAL: PostgREST 500 error -> FAILS CLOSED (allowed: false)
    const failClosedOnErr = await defaultAuthorizeAgainstSupabase({
      token: `uid:${BOB_ID}`,
      userId: BOB_ID,
      action: "read",
      bucket: "dm-attachments",
      objectKey: liveR2Key,
      fetchImpl: (async () => new Response("db error", { status: 500 })) as typeof fetch,
      supabaseUrlOverride: "https://test.supabase.local",
      supabaseAnonKeyOverride: "anon-key",
    });
    expect(failClosedOnErr.allowed).toBe(false);

    // 6. H2: can_access_private_moment_object supports `r2://private-moments/...`
    const r2MomentKey = `${ALICE_ID}/followers/self/r2-story.webp`;
    await asUser(ALICE_ID, async () => {
      await db.query(
        `INSERT INTO public.moments (author_id, media_url, media_type, audience, expires_at)
         VALUES ($1::uuid, $2, 'image', 'followers', now() + interval '24 hours')`,
        [ALICE_ID, `r2://private-moments/${r2MomentKey}`],
      );
    });
    const bobReadsR2Moment = await asUser(BOB_ID, () =>
      db.query<{ ok: boolean }>(`SELECT public.can_access_private_moment_object($1) AS ok`, [
        r2MomentKey,
      ]),
    );
    expect(bobReadsR2Moment.rows[0]?.ok).toBe(true);

    // 7. H2: Rollback-safe dual-read — `/api/media/sign-read` STILL serves `r2://` when write flag is off!
    const rolledBackEnv = { ...R2_TEST_ENV, PING_MEDIA_PROVIDER: "lovable_cloud" };
    const signRes = await handleSignReadRequest(
      new Request("https://ping.test/api/media/sign-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-tok",
        },
        body: JSON.stringify({ ref: `r2://dm-attachments/${liveR2Key}` }),
      }),
      {
        env: rolledBackEnv,
        verifyAuthUser: async () => ({ id: BOB_ID }),
        authorizeAction: async () => ({ allowed: true }),
      },
    );
    expect(signRes.status).toBe(200);
    const signJson = (await signRes.json()) as { signedUrl?: string };
    expect(signJson.signedUrl).toContain("X-Amz-Signature=");

    // 8. H2: `isPrivateDmMediaRef` & `extractPrivateDmMediaPath` recognize `r2://dm-attachments/...`
    expect(isPrivateDmMediaRef(`r2://dm-attachments/${liveR2Key}`)).toBe(true);
    expect(extractPrivateDmMediaPath(`r2://dm-attachments/${liveR2Key}`)).toBe(liveR2Key);

    // 9. H2: `createAuthorizedMediaReadUrl` routes `r2://` to R2 provider even when active write provider is Lovable Cloud
    const stubR2: MediaStorageProvider = {
      id: "cloudflare_r2",
      supportsResumable: true,
      supportsMultipart: true,
      upload: vi.fn(),
      getReadUrl: vi.fn().mockResolvedValue("https://signed-r2.example/ok"),
      deleteObjects: vi.fn(),
    };
    setMediaStorageProviderForTesting(stubR2);
    const resolved = await createAuthorizedMediaReadUrl(`r2://dm-attachments/${liveR2Key}`);
    expect(resolved).toBe("https://signed-r2.example/ok");
    setMediaStorageProviderForTesting(null);
  });

  it("C5 + M5 + M6: signs Content-Type & Content-Length in R2 SigV4, requires R2_PUBLIC_CDN_URL, aborts failed multipart, rejects missing ETag & routes deleteObjects", async () => {
    // 1. C5: presignS3Request cryptographically binds content-type + content-length
    const now = new Date("2026-11-26T12:00:00Z");
    const signedJpg1KB = await presignS3Request({
      method: "PUT",
      endpointHost: "acct123456.r2.cloudflarestorage.com",
      bucket: "ping-media",
      objectKey: `${ALICE_ID}/pings/photo.jpg`,
      accessKeyId: R2_TEST_ENV["R2_ACCESS_KEY_ID"]!,
      secretAccessKey: R2_TEST_ENV["R2_SECRET_ACCESS_KEY"]!,
      signedHeaders: { "content-type": "image/jpeg", "content-length": "1024" },
      now,
    });
    const signedHtml1KB = await presignS3Request({
      method: "PUT",
      endpointHost: "acct123456.r2.cloudflarestorage.com",
      bucket: "ping-media",
      objectKey: `${ALICE_ID}/pings/photo.jpg`,
      accessKeyId: R2_TEST_ENV["R2_ACCESS_KEY_ID"]!,
      secretAccessKey: R2_TEST_ENV["R2_SECRET_ACCESS_KEY"]!,
      signedHeaders: { "content-type": "text/html", "content-length": "1024" },
      now,
    });
    expect(signedJpg1KB).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
    expect(signedJpg1KB).not.toBe(signedHtml1KB);

    // 2. C5: handlePresignUploadRequest returns signed Content-Type & Content-Length headers
    const presignRes = await handlePresignUploadRequest(
      new Request("https://ping.test/api/media/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
        body: JSON.stringify({
          bucket: "media",
          objectKey: `${ALICE_ID}/pings/photo.webp`,
          fileName: "photo.webp",
          contentType: "image/webp",
          sizeBytes: 24576,
          visibility: "public",
        }),
      }),
      {
        env: R2_TEST_ENV,
        verifyAuthUser: async () => ({ id: ALICE_ID }),
        authorizeAction: async () => ({ allowed: true }),
      },
    );
    expect(presignRes.status).toBe(200);
    const plan = (await presignRes.json()) as {
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
      storedRef: string;
    };
    expect(plan.uploadUrl).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
    expect(plan.requiredHeaders).toEqual({
      "Content-Type": "image/webp",
      "Content-Length": "24576",
    });
    expect(plan.storedRef).toBe(`https://media.pingbydot.example/${ALICE_ID}/pings/photo.webp`);

    // 3. M6: Missing R2_PUBLIC_CDN_URL blocks public R2 uploads with 503 (never emits broken r2://media/...)
    const envNoCdn = { ...R2_TEST_ENV, R2_PUBLIC_CDN_URL: "" };
    const noCdnRes = await handlePresignUploadRequest(
      new Request("https://ping.test/api/media/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
        body: JSON.stringify({
          bucket: "media",
          objectKey: `${ALICE_ID}/pings/photo.webp`,
          fileName: "photo.webp",
          contentType: "image/webp",
          sizeBytes: 24576,
          visibility: "public",
        }),
      }),
      {
        env: envNoCdn,
        verifyAuthUser: async () => ({ id: ALICE_ID }),
        authorizeAction: async () => ({ allowed: true }),
      },
    );
    expect(noCdnRes.status).toBe(503);

    // 4. M5: Missing ETag in multipart UploadPart throws instead of fabricating fake ETag
    await expect(
      uploadPartsDirectly({
        file: new Blob([new Uint8Array(64)]),
        partUrls: [{ partNumber: 1, url: "https://r2.example/part1" }],
        fetchImpl: (async () => new Response("", { status: 200 })) as typeof fetch,
      }),
    ).rejects.toThrow(/missing ETag header/i);

    // 5. M5: HTTP 200 XML <Error> on CompleteMultipartUpload triggers AbortMultipartUpload DELETE!
    let abortedCalled = false;
    const fallbackStub: MediaStorageProvider = {
      id: "lovable_cloud",
      supportsResumable: true,
      supportsMultipart: false,
      upload: vi.fn(),
      getReadUrl: vi.fn(),
      deleteObjects: vi.fn(),
    };
    const r2Client = new CloudflareR2MediaProvider({
      apiBaseUrl: "https://ping.test",
      getAccessToken: async () => "tok",
      fallbackProvider: fallbackStub,
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/api/media/presign-upload")) {
          return new Response(
            JSON.stringify({
              mode: "multipart",
              uploadId: "up-1",
              partUrls: [{ partNumber: 1, url: "https://r2.example/part1" }],
              completeUrl: "https://r2.example/complete?uploadId=up-1",
              abortUrl: "https://r2.example/abort?uploadId=up-1",
              chunkSizeBytes: 5 * 1024 * 1024,
              r2Bucket: "ping-private",
              objectKey: `${ALICE_ID}/vid.mp4`,
              storedRef: `r2://dm-attachments/${ALICE_ID}/vid.mp4`,
              readUrl: "https://r2.example/read",
            }),
            { status: 200 },
          );
        }
        if (u === "https://r2.example/part1") {
          return new Response("", { status: 200, headers: { ETag: '"abc123"' } });
        }
        if (u.includes("/complete")) {
          // HTTP 200 with XML <Error>!
          return new Response(
            `<Error><Code>InternalError</Code><Message>Assemble failed</Message></Error>`,
            { status: 200 },
          );
        }
        if (u.includes("/abort") && init?.method === "DELETE") {
          abortedCalled = true;
          return new Response(null, { status: 204 });
        }
        if (u.endsWith("/api/media/delete")) {
          return new Response(
            JSON.stringify({ deleted: [`${ALICE_ID}/pings/photo.webp`], failed: [] }),
            { status: 200 },
          );
        }
        return new Response("", { status: 404 });
      }) as typeof fetch,
    });

    await expect(
      r2Client.upload({
        bucket: "dm-attachments",
        objectKey: `${ALICE_ID}/vid.mp4`,
        file: new Blob([new Uint8Array(1024)]),
        fileName: "vid.mp4",
        contentType: "video/mp4",
        visibility: "private",
      }),
    ).rejects.toThrow(/InternalError/i);
    expect(abortedCalled).toBe(true);

    // 6. M6: CloudflareR2MediaProvider.deleteObjects routes through /api/media/delete (not fallback)
    const delOut = await r2Client.deleteObjects("media", [`${ALICE_ID}/pings/photo.webp`]);
    expect(delOut).toEqual({ deleted: [`${ALICE_ID}/pings/photo.webp`], failed: [] });
    expect(fallbackStub.deleteObjects).not.toHaveBeenCalled();

    // 7. M6: handleDeleteMediaRequest enforces per-key authz before calling R2 DELETE
    const delApiRes = await handleDeleteMediaRequest(
      new Request("https://ping.test/api/media/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
        body: JSON.stringify({
          bucket: "media",
          objectKeys: [`${ALICE_ID}/pings/photo.webp`, `${BOB_ID}/pings/victim.webp`],
        }),
      }),
      {
        env: R2_TEST_ENV,
        verifyAuthUser: async () => ({ id: ALICE_ID }),
        authorizeAction: async ({ userId, objectKey }) => ({
          allowed: objectKey.startsWith(`${userId}/`),
        }),
        fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch,
      },
    );
    expect(delApiRes.status).toBe(200);
    expect(await delApiRes.json()).toEqual({
      deleted: [`${ALICE_ID}/pings/photo.webp`],
      failed: [`${BOB_ID}/pings/victim.webp`],
    });
  });

  it("H3 + M1 + M3: reclaims stale processing deletion leases, distinguishes R2 NoSuchBucket vs NoSuchKey & Supabase skipped keys, and reports granular metrics", async () => {
    const staleKey = `99999999-9999-4999-8999-999999999999/${ALICE_ID}/stale-orphan.webp`;
    const deadKey = `99999999-9999-4999-8999-999999999999/${ALICE_ID}/dead-letter.webp`;
    const retryKey = `99999999-9999-4999-8999-999999999999/${ALICE_ID}/retryable.webp`;

    await db.exec(`
      INSERT INTO public.media_deletion_queue (provider, bucket, object_key, source_type, owner_id, size_bytes, status, attempt_count, max_attempts, claimed_at, next_retry_at)
      VALUES
        ('supabase_storage', 'dm-attachments', '${staleKey}', 'staging_orphan', '${ALICE_ID}', 1024, 'processing', 1, 5, now() - interval '15 minutes', now()),
        ('supabase_storage', 'dm-attachments', '${deadKey}', 'staging_orphan', '${ALICE_ID}', 2048, 'failed', 5, 5, NULL, now() + interval '1 hour'),
        ('supabase_storage', 'dm-attachments', '${retryKey}', 'staging_orphan', '${ALICE_ID}', 4096, 'failed', 2, 5, NULL, now() + interval '1 hour');
    `);

    // M3: Metrics separate retryable_failed_jobs, permanently_failed_jobs & stale_processing_jobs
    const metrics = await asUser("service_role", () =>
      db.query<{ m: Record<string, number> }>(`SELECT public.get_chat_retention_metrics() AS m`),
    );
    expect(metrics.rows[0]!.m["stale_processing_jobs"]).toBeGreaterThanOrEqual(1);
    expect(metrics.rows[0]!.m["permanently_failed_jobs"]).toBeGreaterThanOrEqual(1);
    expect(metrics.rows[0]!.m["retryable_failed_jobs"]).toBeGreaterThanOrEqual(1);

    // H3: claim_media_deletion_jobs reclaims stale 'processing' job (> 10 minutes) and updates claimed_at
    const claimed = await asUser("service_role", () =>
      db.query<{ object_key: string; attempt_count: number; claimed_at: string | null }>(
        `SELECT object_key, attempt_count, claimed_at FROM public.claim_media_deletion_jobs(50)`,
      ),
    );
    const staleClaimed = claimed.rows.find((r) => r.object_key === staleKey);
    expect(staleClaimed).toBeDefined();
    expect(staleClaimed?.attempt_count).toBe(2);
    expect(staleClaimed?.claimed_at).toBeTruthy();

    // M1: deleteR2ObjectServer treats NoSuchKey 404 as ok:true, but FAILS on NoSuchBucket 404!
    const cfg = readR2ServerConfig(R2_TEST_ENV);
    const noSuchBucketRes = await deleteR2ObjectServer(
      cfg,
      "wrong-bucket",
      "k.webp",
      (async () =>
        new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 })) as typeof fetch,
    );
    expect(noSuchBucketRes.ok).toBe(false);
    expect(noSuchBucketRes.error).toMatch(/NoSuchBucket/i);

    const noSuchKeyRes = await deleteR2ObjectServer(
      cfg,
      "ping-private",
      "k.webp",
      (async () =>
        new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })) as typeof fetch,
    );
    expect(noSuchKeyRes.ok).toBe(true);

    // M1: Supabase batch DELETE detects silently skipped existing object (empty [] + HEAD 200 -> retry!)
    const jobCompletedCalls: Array<{ success: boolean; error: string | null }> = [];
    const cronRes = await handleChatRetentionCronRequest(
      new Request("https://ping.test/api/cron/chat-retention", {
        method: "POST",
        headers: { Authorization: "Bearer cron-secret-1" },
      }),
      {
        env: {
          CRON_SECRET: "cron-secret-1",
          SUPABASE_URL: "https://supa.example",
          SUPABASE_SERVICE_ROLE_KEY: "svc-key",
        },
        fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
          const u = String(url);
          if (u.endsWith("/rpc/process_expired_private_messages_batch")) {
            return new Response(
              JSON.stringify({ expired_messages: 0, enqueued_media_deletions: 0 }),
              { status: 200 },
            );
          }
          if (u.endsWith("/rpc/enqueue_orphaned_staging_media")) {
            return new Response(JSON.stringify(0), { status: 200 });
          }
          if (u.endsWith("/rpc/claim_media_deletion_jobs")) {
            return new Response(
              JSON.stringify([
                {
                  id: "job-skip-1",
                  provider: "supabase_storage",
                  bucket: "dm-attachments",
                  object_key: staleKey,
                  derivative_keys: [],
                  source_type: "staging_orphan",
                  source_id: null,
                  size_bytes: 1024,
                  status: "processing",
                  attempt_count: 1,
                  max_attempts: 5,
                },
              ]),
              { status: 200 },
            );
          }
          if (u.includes("/storage/v1/object/dm-attachments") && init?.method === "DELETE") {
            // Silently skipped (returns empty array!)
            return new Response(JSON.stringify([]), { status: 200 });
          }
          if (u.includes("/storage/v1/object/dm-attachments/") && init?.method === "HEAD") {
            // Object still exists!
            return new Response("", { status: 200 });
          }
          if (u.endsWith("/rpc/complete_media_deletion_job")) {
            const b = JSON.parse(String(init?.body)) as {
              p_success: boolean;
              p_error: string | null;
            };
            jobCompletedCalls.push({ success: b.p_success, error: b.p_error });
            return new Response("null", { status: 200 });
          }
          return new Response("not found", { status: 404 });
        }) as typeof fetch,
      },
    );
    expect(cronRes.status).toBe(200);
    expect(jobCompletedCalls).toHaveLength(1);
    expect(jobCompletedCalls[0]?.success).toBe(false);
    expect(jobCompletedCalls[0]?.error).toMatch(/silently skipped existing object/i);
  });

  it("H4 + H5 + H8 + H9 + M7: fixes institution tier, default retention on new chats, group 24h_after_view, saved-message cleanup & conversation ceiling summary", async () => {
    // H9: Legacy 'institution' tier resolves to business / premium_eligible / until_deleted
    const daveEnt = await asUser(DAVE_ID, () =>
      db.query<{ ent: Record<string, unknown> }>(
        `SELECT public.get_my_chat_retention_entitlement() AS ent`,
      ),
    );
    expect(daveEnt.rows[0]!.ent["plan_slug"]).toBe("business");
    expect(daveEnt.rows[0]!.ent["tier_key"]).toBe("premium_eligible");
    expect(daveEnt.rows[0]!.ent["max_retention_policy"]).toBe("until_deleted");

    // H5: Alice (verified, 30d max) sets her default_chat_retention_policy = '30d'
    await asUser(ALICE_ID, async () => {
      await db.query(`SELECT public.set_my_default_chat_retention('30d')`);
    });

    // New direct chat Alice (verified, default=30d) + Carol (verified, max=30d) -> inherits '30d'!
    let aliceCarolConv = "";
    await asUser(ALICE_ID, async () => {
      const c = await db.query<{ id: string }>(
        `SELECT public.get_or_create_direct_conversation($1::uuid) AS id`,
        [CAROL_ID],
      );
      aliceCarolConv = c.rows[0]!.id;
    });
    const acRow = await db.query<{ retention_policy: string }>(
      `SELECT retention_policy FROM public.conversations WHERE id = $1::uuid`,
      [aliceCarolConv],
    );
    expect(acRow.rows[0]?.retention_policy).toBe("30d");

    // New group chat Alice (30d) + Bob (unverified, 7d max) + Carol (30d) -> clamped strictly to '7d'!
    let groupId = "";
    await asUser(ALICE_ID, async () => {
      const g = await db.query<{ id: string }>(
        `SELECT public.create_group_conversation('Launch Team', 'Group test', ARRAY[$1::uuid, $2::uuid], false) AS id`,
        [BOB_ID, CAROL_ID],
      );
      groupId = g.rows[0]!.id;
    });
    const grpRow = await db.query<{ retention_policy: string }>(
      `SELECT retention_policy FROM public.conversations WHERE id = $1::uuid`,
      [groupId],
    );
    expect(grpRow.rows[0]?.retention_policy).toBe("7d");

    // M7: get_my_conversations_summary returns effective_max_retention_policy
    const summary = await asUser(ALICE_ID, () =>
      db.query<{ rows: Array<{ id: string; effective_max_retention_policy: string }> }>(
        `SELECT public.get_my_conversations_summary(50, 0) AS rows`,
      ),
    );
    const acSummary = summary.rows[0]!.rows.find((r) => r.id === aliceCarolConv);
    const grpSummary = summary.rows[0]!.rows.find((r) => r.id === groupId);
    expect(acSummary?.effective_max_retention_policy).toBe("30d");
    expect(grpSummary?.effective_max_retention_policy).toBe("7d");

    // H8: Set group retention to 24h_after_view; Alice sends a message
    await asUser(ALICE_ID, async () => {
      await db.query(
        `SELECT public.set_conversation_retention_policy($1::uuid, '24h_after_view')`,
        [groupId],
      );
    });
    // Backdate Bob & Carol's last_read_at so neither has read Alice's new message yet
    await db.query(
      `UPDATE public.conversation_members SET last_read_at = now() - interval '1 hour' WHERE conversation_id = $1::uuid AND user_id <> $2::uuid`,
      [groupId, ALICE_ID],
    );
    let grpMsgId = "";
    await asUser(ALICE_ID, async () => {
      const m = await db.query<{ msg: { id: string } }>(
        `SELECT public.send_private_message($1::uuid, 'Group 24h msg', NULL, NULL) AS msg`,
        [groupId],
      );
      grpMsgId = m.rows[0]!.msg.id;
    });

    // Bob saves the message BEFORE viewing, then reads; Carol has NOT read yet -> first_viewed_at STILL NULL!
    await asUser(BOB_ID, async () => {
      await db.query(`SELECT public.toggle_save_private_message($1::uuid, true)`, [grpMsgId]);
      await db.query(`SELECT public.mark_conversation_read($1::uuid)`, [groupId]);
    });
    const afterBob = await db.query<{ first_viewed_at: string | null; is_saved_in_chat: boolean }>(
      `SELECT first_viewed_at, is_saved_in_chat FROM public.private_messages WHERE id = $1::uuid`,
      [grpMsgId],
    );
    expect(afterBob.rows[0]?.first_viewed_at).toBeNull();
    expect(afterBob.rows[0]?.is_saved_in_chat).toBe(true);

    // Now Carol reads -> ALL non-sender active members have read -> first_viewed_at IS recorded even though saved!
    await asUser(CAROL_ID, async () => {
      await db.query(`SELECT public.mark_conversation_read($1::uuid)`, [groupId]);
    });
    const afterCarol = await db.query<{
      first_viewed_at: string | null;
      is_saved_in_chat: boolean;
    }>(
      `SELECT first_viewed_at, is_saved_in_chat FROM public.private_messages WHERE id = $1::uuid`,
      [grpMsgId],
    );
    expect(afterCarol.rows[0]?.first_viewed_at).not.toBeNull();
    expect(afterCarol.rows[0]?.is_saved_in_chat).toBe(true);

    // H4: Bob leaves the group -> Bob's saved_messages row is purged, quota freed, is_saved_in_chat flips to false,
    // AND expires_at restores to first_viewed_at + 24h (NOT 7 days)!
    await asUser(BOB_ID, async () => {
      await db.query(`SELECT public.remove_group_member($1::uuid, $2::uuid)`, [groupId, BOB_ID]);
    });
    const afterBobLeaves = await db.query<{
      is_saved_in_chat: boolean;
      expires_at: string;
      first_viewed_at: string;
    }>(
      `SELECT is_saved_in_chat, expires_at, first_viewed_at FROM public.private_messages WHERE id = $1::uuid`,
      [grpMsgId],
    );
    expect(afterBobLeaves.rows[0]?.is_saved_in_chat).toBe(false);
    const diffHours =
      (new Date(afterBobLeaves.rows[0]!.expires_at).getTime() -
        new Date(afterBobLeaves.rows[0]!.first_viewed_at).getTime()) /
      3_600_000;
    expect(Math.round(diffHours)).toBe(24);

    // H4: Soft-deleting a saved message purges saved_messages and frees Carol's quota immediately
    let msgToUnsend = "";
    await asUser(ALICE_ID, async () => {
      const m = await db.query<{ msg: { id: string } }>(
        `SELECT public.send_private_message($1::uuid, 'Will unsend', NULL, NULL) AS msg`,
        [groupId],
      );
      msgToUnsend = m.rows[0]!.msg.id;
    });
    await asUser(CAROL_ID, async () => {
      await db.query(`SELECT public.toggle_save_private_message($1::uuid, true)`, [msgToUnsend]);
    });
    await asUser(ALICE_ID, async () => {
      await db.query(`UPDATE public.private_messages SET deleted_at = now() WHERE id = $1::uuid`, [
        msgToUnsend,
      ]);
    });
    const remainingSaves = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.saved_messages WHERE message_id = $1::uuid`,
      [msgToUnsend],
    );
    expect(remainingSaves.rows[0]?.cnt).toBe(0);

    // H4: Deleting a user's saved_messages via CASCADE (simulated account deletion) clears is_saved_in_chat
    let cascadeMsgId = "";
    await asUser(ALICE_ID, async () => {
      const m = await db.query<{ msg: { id: string } }>(
        `SELECT public.send_private_message($1::uuid, 'Cascade save test', NULL, NULL) AS msg`,
        [aliceCarolConv],
      );
      cascadeMsgId = m.rows[0]!.msg.id;
    });
    await asUser(CAROL_ID, async () => {
      await db.query(`SELECT public.toggle_save_private_message($1::uuid, true)`, [cascadeMsgId]);
    });
    await db.query(
      `DELETE FROM public.saved_messages WHERE user_id = $1::uuid AND message_id = $2::uuid`,
      [CAROL_ID, cascadeMsgId],
    );
    const afterCascade = await db.query<{ is_saved_in_chat: boolean }>(
      `SELECT is_saved_in_chat FROM public.private_messages WHERE id = $1::uuid`,
      [cascadeMsgId],
    );
    expect(afterCascade.rows[0]?.is_saved_in_chat).toBe(false);
  });

  it("H6 + H7 + M8: enables anon Public Hub reads (denies Private Hubs), preserves Hub voice-note prefix, and enforces Moment bucket/Clip boundaries", async () => {
    // Create one Public Hub and one Private Hub as Alice
    let pubHubId = "";
    let privHubId = "";
    await asUser(ALICE_ID, async () => {
      const pub = await db.query<{ h: { id: string } }>(
        `SELECT public.create_hub('Public Builders', 'public-builders-p2', 'Tag', 'Desc', '', 'community', 'public', '[]'::jsonb) AS h`,
      );
      pubHubId = pub.rows[0]!.h.id;

      const priv = await db.query<{ h: { id: string } }>(
        `SELECT public.create_hub('Secret Vault', 'secret-vault-p2', 'Tag', 'Desc', '', 'community', 'private', '[]'::jsonb) AS h`,
      );
      privHubId = priv.rows[0]!.h.id;

      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES
           ('hub-attachments', $1, $3::uuid, '{"mimetype":"image/webp","size":12000}'::jsonb),
           ('hub-attachments', $2, $3::uuid, '{"mimetype":"image/webp","size":14000}'::jsonb)`,
        [
          `${pubHubId}/${ALICE_ID}/public-diagram.webp`,
          `${privHubId}/${ALICE_ID}/secret-plan.webp`,
          ALICE_ID,
        ],
      );
    });

    // H6: Signed-out `anon` CAN read Public Hub attachment, CANNOT read Private Hub attachment
    await asUser(null, async () => {
      const pubVisible = await db.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM storage.objects WHERE bucket_id = 'hub-attachments' AND name = $1`,
        [`${pubHubId}/${ALICE_ID}/public-diagram.webp`],
      );
      const privVisible = await db.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt FROM storage.objects WHERE bucket_id = 'hub-attachments' AND name = $1`,
        [`${privHubId}/${ALICE_ID}/secret-plan.webp`],
      );
      expect(pubVisible.rows[0]?.cnt).toBe(1);
      expect(privVisible.rows[0]?.cnt).toBe(0);
    });

    // H7: buildUniqueMediaFilename preserves safe `voice-note-` prefix for WebM Hub voice notes
    const uniqueVoice = buildUniqueMediaFilename("voice-note-1700000.webm", "webm");
    expect(uniqueVoice).toMatch(/^voice-note-\d+-[a-z0-9]+\.webm$/i);
    const uniqueNormal = buildUniqueMediaFilename("meeting-recording.webm", "webm");
    expect(uniqueNormal).not.toMatch(/^voice-note-/i);

    // M8: Restricted private-bucket Moment cannot be flipped to `public` OR published as a Clip
    let restrictedMomentId = "";
    await asUser(ALICE_ID, async () => {
      const m = await db.query<{ id: string }>(
        `INSERT INTO public.moments (author_id, media_url, media_type, audience, expires_at)
         VALUES ($1::uuid, $2, 'video', 'followers', now() + interval '24 hours')
         RETURNING id`,
        [ALICE_ID, `storage://private-moments/${ALICE_ID}/followers/self/private-vid.mp4`],
      );
      restrictedMomentId = m.rows[0]!.id;
    });

    await expectPgReject(
      ALICE_ID,
      `UPDATE public.moments SET audience = 'public' WHERE id = $1::uuid`,
      [restrictedMomentId],
    );
    await expectPgReject(
      ALICE_ID,
      `SELECT public.publish_moment_as_clip($1::uuid, 'Leak', 'followers', '{}'::text[])`,
      [restrictedMomentId],
    );
  });
});
