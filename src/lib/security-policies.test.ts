import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Database RLS and Storage Security Audit", () => {
  const migrationsDir = path.resolve(__dirname, "../../drizzle/migrations");
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.join(migrationsDir, f));

  it("ensures no migrations contain open USING (true) policies", () => {
    const offending: { file: string; line: number; text: string }[] = [];

    for (const file of sqlFiles) {
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        // Strip SQL comments
        const uncommented = line.replace(/--.*$/, "").trim();
        if (/\bUSING\s*\(\s*true\s*\)/i.test(uncommented)) {
          offending.push({ file: path.basename(file), line: idx + 1, text: line });
        }
      });
    }

    expect(offending).toEqual([]);
  }, 20000);

  it("ensures storage.objects has no unrestricted public download policy", () => {
    const offending: { file: string; line: number; text: string }[] = [];

    for (const file of sqlFiles) {
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        const uncommented = line.replace(/--.*$/, "").trim();
        // Check for policy on storage.objects with bucket_id = 'media' that doesn't check auth / folder
        if (
          uncommented.includes("storage.objects") &&
          uncommented.includes("FOR SELECT") &&
          uncommented.includes("bucket_id = 'media'") &&
          !uncommented.includes("storage.foldername")
        ) {
          offending.push({ file: path.basename(file), line: idx + 1, text: line });
        }
      });
    }

    expect(offending).toEqual([]);
  });

  it("verifies migration 0010 exists and is registered in _journal.json", () => {
    const journalPath = path.join(migrationsDir, "meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const entry10 = journal.entries.find((e: { idx: number }) => e.idx === 10);

    expect(entry10).toBeDefined();
    expect(entry10.tag).toBe("0010_secure_media_storage_and_access_rules");

    const m10Sql = fs.readFileSync(
      path.join(migrationsDir, "0010_secure_media_storage_and_access_rules.sql"),
      "utf8",
    );
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Media is public" ON storage.objects;');
    expect(m10Sql).toContain('CREATE POLICY "Users read own media" ON storage.objects');
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Profiles are public" ON public.profiles;');
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Likes are public" ON public.likes;');
    expect(m10Sql).toContain(
      'DROP POLICY IF EXISTS "Comment likes are public" ON public.comment_likes;',
    );
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Follows are public" ON public.follows;');
  });

  it("verifies migration 0011 exists and is registered in _journal.json", () => {
    const journalPath = path.join(migrationsDir, "meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const entry11 = journal.entries.find((e: { idx: number }) => e.idx === 11);

    expect(entry11).toBeDefined();
    expect(entry11.tag).toBe("0011_hubs_signals_read_receipts");

    const m11Sql = fs.readFileSync(
      path.join(migrationsDir, "0011_hubs_signals_read_receipts.sql"),
      "utf8",
    );
    expect(m11Sql).toContain("public.hub_messages");
    expect(m11Sql).toContain("public.ping_read_receipts");
    expect(m11Sql).toContain("public.user_privacy_preferences");
    expect(m11Sql).toContain("public.signals");
    expect(m11Sql).toContain("public.signal_posts");
    expect(m11Sql).toContain("public.create_hub");
  });

  it("verifies migration 0012 exists and is registered in _journal.json", () => {
    const journalPath = path.join(migrationsDir, "meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const entry12 = journal.entries.find((e: { idx: number }) => e.idx === 12);

    expect(entry12).toBeDefined();
    expect(entry12.tag).toBe("0012_moments_highlights_reping");

    const m12Sql = fs.readFileSync(
      path.join(migrationsDir, "0012_moments_highlights_reping.sql"),
      "utf8",
    );
    expect(m12Sql).toContain("public.moments");
    expect(m12Sql).toContain("public.moment_views");
    expect(m12Sql).toContain("public.moment_likes");
    expect(m12Sql).toContain("public.moment_replies");
    expect(m12Sql).toContain("public.moment_repings");
    expect(m12Sql).toContain("public.highlights");
    expect(m12Sql).toContain("public.highlight_items");
    expect(m12Sql).toContain("public.reping_moment");
  });

  it("verifies migrations 0011–0017 have valid DROP POLICY syntax, is_admin helper, DOT wallet idempotency, and safe migration runner", () => {
    const journalPath = path.join(migrationsDir, "meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const expectedTags = [
      [11, "0011_hubs_signals_read_receipts"],
      [12, "0012_moments_highlights_reping"],
      [13, "0013_critical_repairs_hubs_signals"],
      [14, "0014_private_direct_messaging"],
      [15, "0015_product_completion_sprint"],
      [16, "0016_profile_economy_analytics_and_fixes"],
      [17, "0017_human_coordination_forums_broadcasts"],
      [18, "0018_fix_conversation_rls_and_close_circle"],
      [19, "0019_lockdown_economy_and_private_grants"],
      [20, "0020_pre_merge_security_hardening"],
    ] as const;

    for (const [idx, tag] of expectedTags) {
      const entry = journal.entries.find((e: { idx: number }) => e.idx === idx);
      expect(entry?.tag).toBe(tag);
      const sql = fs.readFileSync(path.join(migrationsDir, `${tag}.sql`), "utf8");
      // Ensure no invalid DROP POLICY ... FOR INSERT/SELECT/UPDATE/DELETE syntax exists
      expect(sql).not.toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i);
    }

    const m11Sql = fs.readFileSync(
      path.join(migrationsDir, "0011_hubs_signals_read_receipts.sql"),
      "utf8",
    );
    expect(m11Sql).toContain(
      'DROP POLICY IF EXISTS "Users record signal reads" ON public.signal_reads;',
    );
    expect(m11Sql).toContain(
      'CREATE POLICY "Users record signal reads" ON public.signal_reads FOR INSERT TO authenticated',
    );

    const m15Sql = fs.readFileSync(
      path.join(migrationsDir, "0015_product_completion_sprint.sql"),
      "utf8",
    );
    expect(m15Sql).toContain(
      "CREATE OR REPLACE FUNCTION public.is_admin(_user uuid DEFAULT auth.uid())",
    );

    const m16Sql = fs.readFileSync(
      path.join(migrationsDir, "0016_profile_economy_analytics_and_fixes.sql"),
      "utf8",
    );
    expect(m16Sql).toContain("dot_transactions_user_source_ref_uidx");

    const m18Sql = fs.readFileSync(
      path.join(migrationsDir, "0018_fix_conversation_rls_and_close_circle.sql"),
      "utf8",
    );
    expect(m18Sql).toContain("public.is_conversation_member");
    expect(m18Sql).toContain("cm.conversation_id = private_messages.conversation_id");
    expect(m18Sql).toContain("public.is_close_circle_member");

    const m19Sql = fs.readFileSync(
      path.join(migrationsDir, "0019_lockdown_economy_and_private_grants.sql"),
      "utf8",
    );
    expect(m19Sql).toContain(
      "REVOKE ALL ON public.dot_wallets, public.dot_transactions, public.account_subscriptions",
    );

    const m20Sql = fs.readFileSync(
      path.join(migrationsDir, "0020_pre_merge_security_hardening.sql"),
      "utf8",
    );
    expect(m20Sql).toContain(
      "REVOKE ALL ON FUNCTION public.is_close_circle_member(uuid, uuid) FROM PUBLIC, anon",
    );
    expect(m20Sql).toContain("cannot inspect another user''s Close Circle membership");
    expect(m20Sql).toContain("cannot inspect another user''s conversation membership");
    expect(m20Sql).toContain('CREATE POLICY "Public moments viewable by anyone" ON public.moments');
    expect(m20Sql).toContain(
      "REVOKE UPDATE, TRUNCATE ON public.dot_transactions FROM service_role",
    );
    expect(m20Sql).toContain(
      'CREATE POLICY "Authenticated hub broadcasts viewable" ON public.hub_broadcasts',
    );

    const runnerSrc = fs.readFileSync(
      path.resolve(__dirname, "../../scripts/migrate-remote.mjs"),
      "utf8",
    );
    expect(runnerSrc).toContain('const EXPECTED_PROJECT_REF = "exlttyafomvqfwgzzjrm"');
    expect(runnerSrc).toContain("LOVABLE_DB_MIGRATION_URL");
    expect(runnerSrc).toContain('port === "6543"');
    expect(runnerSrc).toContain("VerificationRollbackSignal");
    expect(runnerSrc).not.toContain('err.message.includes("ROLLBACK")');
    expect(runnerSrc).toContain("SCHEMA VERIFIED ONLY");
  });
});
