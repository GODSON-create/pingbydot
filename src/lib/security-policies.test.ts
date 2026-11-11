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
      const lines = content.split("\n");
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
      const lines = content.split("\n");
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
      "utf8"
    );
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Media is public" ON storage.objects;');
    expect(m10Sql).toContain('CREATE POLICY "Users read own media" ON storage.objects');
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Profiles are public" ON public.profiles;');
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Likes are public" ON public.likes;');
    expect(m10Sql).toContain('DROP POLICY IF EXISTS "Comment likes are public" ON public.comment_likes;');
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
      "utf8"
    );
    expect(m11Sql).toContain("public.hub_messages");
    expect(m11Sql).toContain("public.ping_read_receipts");
    expect(m11Sql).toContain("public.user_privacy_preferences");
    expect(m11Sql).toContain("public.signals");
    expect(m11Sql).toContain("public.signal_posts");
    expect(m11Sql).toContain("public.create_hub");
  });
});
