import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authDestination } from "@/lib/auth-return";
import { formatStorageUploadError, MEDIA_BUCKET } from "@/lib/storage";
import { hubError } from "@/lib/hub-queries";

describe("Media storage, auth redirect safety, hub error mapping, and Signal 1-on-1 chat wiring", () => {
  it("provisions the media bucket in migration 0021 and registers it in _journal.json", () => {
    const migrationsDir = path.resolve(process.cwd(), "drizzle/migrations");
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
    );
    const entry21 = journal.entries.find((e: { idx: number }) => e.idx === 21);

    expect(entry21).toBeDefined();
    expect(entry21.tag).toBe("0021_provision_media_storage_bucket");

    const sql = fs.readFileSync(
      path.join(migrationsDir, "0021_provision_media_storage_bucket.sql"),
      "utf8",
    );
    expect(sql).toContain("INSERT INTO storage.buckets");
    expect(sql).toContain(`'${MEDIA_BUCKET}'`);
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE");
  });

  it("formats Bucket not found and permission errors clearly", () => {
    const msg = formatStorageUploadError(new Error("Bucket not found"));
    expect(msg).toContain("'media'");
    expect(msg).toContain("0021");

    const rlsMsg = formatStorageUploadError(
      new Error("new row violates row-level security policy"),
    );
    expect(rlsMsg).toContain("storage permissions");
  });

  it("validates OAuth return destinations without blocking internal routes", () => {
    expect(authDestination("https://evil.example")).toBe("/explore");
    expect(authDestination("//evil.example/path")).toBe("/explore");
    expect(authDestination("/login?next=/signals")).toBe("/explore");
    expect(authDestination("/create")).toBe("/create");
    expect(authDestination("/signals")).toBe("/signals");
    expect(authDestination("/hubs/create")).toBe("/hubs/create");
    expect(authDestination("/messages")).toBe("/messages");
  });

  it("maps duplicate Hub slug errors to an explicit user-facing message", () => {
    expect(hubError({ code: "23505", message: "duplicate key value" }, "fallback")).toContain(
      "already taken",
    );
    expect(hubError({ code: "42501", message: "permission denied" }, "fallback")).toContain(
      "sign in",
    );
  });

  it("wires the Signal tab (/signals) to the shared 1-on-1 chats workspace", () => {
    const signalsSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/routes/signals.tsx"),
      "utf8",
    );
    const workspaceSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/messages/MessagesWorkspace.tsx"),
      "utf8",
    );

    expect(signalsSrc).toContain("MessagesWorkspace");
    expect(signalsSrc).toContain('basePath="/signals"');
    expect(signalsSrc).toContain("showCommunityHeader");
    expect(workspaceSrc).toContain("userConversationsQuery");
    expect(workspaceSrc).toContain("DirectMessageChat");
    expect(workspaceSrc).toContain("Community Destination · Signal");
    expect(workspaceSrc).toContain("1-on-1 Chats");
    expect(workspaceSrc).toContain("Institutional Channels");
  });

  it("preflights OAuth providers and preserves SSR hydration parity on root shell & home feed", () => {
    const authShellSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/AuthShell.tsx"),
      "utf8",
    );
    const rootSrc = fs.readFileSync(path.resolve(process.cwd(), "src/routes/__root.tsx"), "utf8");
    const themeSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/theme.tsx"), "utf8");
    const indexSrc = fs.readFileSync(path.resolve(process.cwd(), "src/routes/index.tsx"), "utf8");

    expect(authShellSrc).toContain("isLovableHost");
    expect(authShellSrc).toContain('redirect: "manual"');
    expect(authShellSrc).toContain("missing oauth secret|unsupported provider");

    expect(rootSrc).toContain('<html lang="en" suppressHydrationWarning>');
    expect(themeSrc).toContain("const [hydrated, setHydrated] = useState(false)");

    expect(indexSrc).toContain('tab: z.enum(["foryou", "following"]).optional()');
    expect(indexSrc).toContain(
      "context.queryClient.ensureQueryData(feedQuery(deps.cat, deps.page))",
    );
    expect(indexSrc).toContain("Route.useLoaderData()");
  });
});
