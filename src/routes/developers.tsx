import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Check,
  Code2,
  Copy,
  Database,
  ExternalLink,
  KeyRound,
  Lock,
  Plus,
  Server,
  ShieldCheck,
  Terminal,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { myBusinessesQuery } from "@/lib/business";
import {
  buildWebsiteEnquiryEmbedSnippet,
  DEVELOPER_SCOPES,
  myDeveloperApiKeysQuery,
  myDeveloperAppsQuery,
  myDeveloperWebhooksQuery,
  signPingWebhookPayload,
  useCreateDeveloperApiKey,
  useCreateDeveloperApp,
  useCreateDeveloperWebhook,
  useRevokeDeveloperApiKey,
  verifyPingWebhookSignature,
  WEBHOOK_EVENTS,
  type DeveloperScope,
  type WebhookEventType,
} from "@/lib/developer";
import { getSearchEngineStatus } from "@/lib/scale";
import { pageHead, SITE_ORIGIN } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/developers")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Ping Developer Platform — OAuth 2.0, Business Messaging API, Webhooks & SDKs",
      description:
        "Build on Ping by DOT with OAuth 2.0 PKCE, scoped API keys, HMAC-SHA256 webhooks, Business Messaging API, OpenAPI 3.1, and TypeScript SDKs.",
      path: "/developers",
    }),
  component: DeveloperPortalPage,
});

type PortalTab = "overview" | "oauth" | "keys" | "webhooks" | "business-api" | "scale";

function DeveloperPortalPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<PortalTab>("overview");

  const { data: apps = [] } = useQuery(myDeveloperAppsQuery(user?.id));
  const { data: apiKeys = [] } = useQuery(myDeveloperApiKeysQuery(user?.id));
  const { data: webhooks = [] } = useQuery(myDeveloperWebhooksQuery(user?.id));
  const { data: businesses = [] } = useQuery(myBusinessesQuery(user?.id));

  const createApp = useCreateDeveloperApp(user?.id);
  const createKey = useCreateDeveloperApiKey(user?.id);
  const revokeKey = useRevokeDeveloperApiKey(user?.id);
  const createWebhook = useCreateDeveloperWebhook(user?.id);

  // OAuth App form
  const [appName, setAppName] = useState("");
  const [appDesc, setAppDesc] = useState("");
  const [appRedirect, setAppRedirect] = useState("https://example.com/oauth/callback");
  const [appScopes, setAppScopes] = useState<DeveloperScope[]>(["profile:read", "pings:read"]);
  const [revealedAppSecret, setRevealedAppSecret] = useState<{
    clientId: string;
    secret: string;
  } | null>(null);

  // API Key form
  const [keyName, setKeyName] = useState("");
  const [keyBusinessId, setKeyBusinessId] = useState<string>("");
  const [keyScopes, setKeyScopes] = useState<DeveloperScope[]>([
    "pings:read",
    "opportunities:read",
  ]);
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);

  // Webhook form + HMAC Verifier playground
  const [whUrl, setWhUrl] = useState("");
  const [whEvents, setWhEvents] = useState<WebhookEventType[]>(["business.enquiry.created"]);
  const [revealedWhSecret, setRevealedWhSecret] = useState<string | null>(null);
  const [simSecret, setSimSecret] = useState("whsec_demo_ping_signing_secret");
  const [simPayload, setSimPayload] = useState(
    JSON.stringify(
      { event: "business.enquiry.created", businessId: "demo-biz", enquiryId: "demo-enq" },
      null,
      2,
    ),
  );
  const [simSignature, setSimSignature] = useState<string>("");
  const [simVerified, setSimVerified] = useState<boolean | null>(null);

  // Business embed snippet
  const [embedSlug, setEmbedSlug] = useState(businesses[0]?.slug ?? "my-business");
  const [embedName, setEmbedName] = useState(businesses[0]?.name ?? "My Business");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const searchStatus = getSearchEngineStatus();

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast.error("Copy failed");
    }
  };

  const toggleScope = (
    list: DeveloperScope[],
    setter: (next: DeveloperScope[]) => void,
    scope: DeveloperScope,
  ) => {
    setter(list.includes(scope) ? list.filter((s) => s !== scope) : [...list, scope]);
  };

  const sdkExample = `import { PingClient } from "@pingbydot/sdk";

const ping = new PingClient({
  baseUrl: "${SITE_ORIGIN}",
  apiKey: process.env.PING_API_KEY,
});

// 1. Keyset cursor-paginated public feed
const feed = await ping.pings.list({ category: "opportunity", limit: 20 });

// 2. Scoped Business Messaging API reply
await ping.business.replyEnquiry({
  businessId: "YOUR_BUSINESS_UUID",
  enquiryId: "YOUR_ENQUIRY_UUID",
  replyMessage: "Thanks! Your booking slot is confirmed for Thursday 10:00 AM.",
  leadStatus: "qualified",
});

// 3. Verify incoming X-Ping-Signature-256 webhook header
const valid = await ping.webhooks.verifySignature(rawBody, signatureHeader, webhookSecret);`;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      {/* Hero */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <Code2 className="size-3.5" /> Ping Developer Ecosystem · API v1
            </span>
            <h1 className="mt-2 font-display text-2xl sm:text-3xl font-extrabold">
              Ping Developer Platform
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-2xl">
              OAuth 2.0 (PKCE S256), scoped API keys, HMAC-SHA256 signed webhooks, Business
              Messaging API, Website Enquiry Embeds, and zero-dependency TypeScript SDKs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full text-xs gap-1.5">
              <a href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">
                OpenAPI 3.1 JSON <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full text-xs gap-1.5">
              <a href="/api/v1/health" target="_blank" rel="noopener noreferrer">
                <Activity className="size-3.5 text-primary" /> API Health
              </a>
            </Button>
          </div>
        </div>

        <nav className="flex items-center gap-2 overflow-x-auto scrollbar-none pt-3 border-t border-border/60">
          {(
            [
              { id: "overview", label: "Overview & SDK", icon: Terminal },
              { id: "oauth", label: `OAuth 2.0 Apps (${apps.length})`, icon: Lock },
              { id: "keys", label: `API Keys (${apiKeys.length})`, icon: KeyRound },
              { id: "webhooks", label: `Webhooks (${webhooks.length})`, icon: Webhook },
              { id: "business-api", label: "Business Messaging & Embeds", icon: Server },
              { id: "scale", label: "Scale & Search Architecture", icon: Database },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  tab === item.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" /> {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* 1. OVERVIEW & SDK */}
      {tab === "overview" && (
        <section className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="surface-card rounded-2xl p-5 border border-border/70 space-y-1.5">
              <p className="text-xs font-bold text-primary">GET /api/v1/pings</p>
              <p className="font-display text-sm font-bold">Public Keyset Discovery</p>
              <p className="text-xs text-muted-foreground">
                Edge-cached public Pings with opaque `(created_at, id)` cursors built for 1M+ rows.
              </p>
            </div>
            <div className="surface-card rounded-2xl p-5 border border-border/70 space-y-1.5">
              <p className="text-xs font-bold text-primary">POST /api/v1/business/messages</p>
              <p className="font-display text-sm font-bold">Business Messaging API</p>
              <p className="text-xs text-muted-foreground">
                Connect CRMs, helpdesks, and booking systems to your Ping Business Inbox securely.
              </p>
            </div>
            <div className="surface-card rounded-2xl p-5 border border-border/70 space-y-1.5">
              <p className="text-xs font-bold text-primary">GET /oauth/authorize</p>
              <p className="font-display text-sm font-bold">OAuth 2.0 + PKCE S256</p>
              <p className="text-xs text-muted-foreground">
                Mandatory PKCE challenge &amp; explicit scope consent. Private DMs permanently
                excluded.
              </p>
            </div>
          </div>

          <div className="surface-card rounded-3xl p-6 border border-border/70 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold">
                  Official TypeScript SDK Starter (`src/lib/sdk/ping-sdk.ts`)
                </h2>
                <p className="text-xs text-muted-foreground">
                  Zero-dependency Web Standards client for Node 22+, Cloudflare Workers, Deno &amp;
                  Bun.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copyText("sdk", sdkExample)}
                className="rounded-full text-xs gap-1.5"
              >
                {copiedId === "sdk" ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                Copy SDK Snippet
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-border/70 bg-secondary/40 p-4 text-[11px] font-mono text-foreground leading-relaxed">
              {sdkExample}
            </pre>
          </div>
        </section>
      )}

      {/* 2. OAUTH 2.0 APPS */}
      {tab === "oauth" && (
        <section className="space-y-5">
          {!user ? (
            <div className="surface-card rounded-3xl p-8 text-center space-y-3">
              <p className="font-display text-lg font-bold">Sign in to register OAuth 2.0 Apps</p>
              <Button asChild variant="hero" className="rounded-full">
                <Link to="/login" search={{ next: "/developers" }}>
                  Sign in
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {revealedAppSecret && (
                <div className="rounded-3xl border border-primary/40 bg-primary/10 p-5 space-y-2 text-xs">
                  <p className="font-bold text-primary">
                    Save your OAuth credentials now — client secret will never be shown again!
                  </p>
                  <p className="font-mono break-all">client_id: {revealedAppSecret.clientId}</p>
                  <p className="font-mono break-all">client_secret: {revealedAppSecret.secret}</p>
                </div>
              )}

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (appName.trim().length < 2) return;
                  try {
                    const created = await createApp.mutateAsync({
                      name: appName,
                      description: appDesc,
                      redirectUri: appRedirect,
                      scopes: appScopes,
                    });
                    setRevealedAppSecret({
                      clientId: created.app.client_id,
                      secret: created.oneTimeClientSecret,
                    });
                    setAppName("");
                    setAppDesc("");
                    toast.success("Sandbox OAuth 2.0 app registered");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not register app");
                  }
                }}
                className="surface-card rounded-3xl p-6 border border-border/70 space-y-4"
              >
                <h2 className="font-display text-lg font-bold">Register OAuth 2.0 PKCE App</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Application Name</Label>
                    <Input
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      placeholder="e.g. Kora CRM Connector"
                      required
                      className="mt-1 rounded-xl text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Redirect URI (HTTPS or http://localhost)</Label>
                    <Input
                      value={appRedirect}
                      onChange={(e) => setAppRedirect(e.target.value)}
                      required
                      className="mt-1 rounded-xl text-xs"
                    />
                  </div>
                </div>
                <Input
                  value={appDesc}
                  onChange={(e) => setAppDesc(e.target.value)}
                  placeholder="Brief description shown on the user consent screen…"
                  className="rounded-xl text-xs"
                />
                <div className="flex flex-wrap gap-2">
                  {DEVELOPER_SCOPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleScope(appScopes, setAppScopes, s.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold",
                        appScopes.includes(s.id)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-secondary/40 text-muted-foreground",
                      )}
                    >
                      {s.id}
                    </button>
                  ))}
                </div>
                <Button
                  type="submit"
                  variant="hero"
                  size="sm"
                  disabled={createApp.isPending}
                  className="rounded-full text-xs gap-1.5"
                >
                  <Plus className="size-3.5" /> Create Sandbox App
                </Button>
              </form>

              <div className="space-y-2.5">
                {apps.map((app) => (
                  <article
                    key={app.id}
                    className="surface-card rounded-2xl p-4 border border-border/70 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-bold text-foreground">{app.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{app.client_id}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Scopes: {app.allowed_scopes.join(", ")}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 px-2.5 py-0.5 text-[10px] font-bold uppercase">
                      {app.review_status.replace(/_/g, " ")}
                    </span>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* 3. SCOPED API KEYS */}
      {tab === "keys" && (
        <section className="space-y-5">
          {!user ? (
            <div className="surface-card rounded-3xl p-8 text-center space-y-3">
              <p className="font-display text-lg font-bold">Sign in to manage Scoped API Keys</p>
              <Button asChild variant="hero" className="rounded-full">
                <Link to="/login" search={{ next: "/developers" }}>
                  Sign in
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {revealedApiKey && (
                <div className="rounded-3xl border border-primary/40 bg-primary/10 p-5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-primary">
                      One-Time API Key (hashed in storage — copy now):
                    </p>
                    <p className="font-mono break-all mt-1">{revealedApiKey}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyText("apikey", revealedApiKey)}
                    className="rounded-full text-xs"
                  >
                    Copy Key
                  </Button>
                </div>
              )}

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (keyName.trim().length < 2) return;
                  try {
                    const created = await createKey.mutateAsync({
                      name: keyName,
                      scopes: keyScopes,
                      businessId: keyBusinessId || null,
                    });
                    setRevealedApiKey(created.oneTimeApiKey);
                    setKeyName("");
                    toast.success("Scoped sandbox API key generated");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not create API key");
                  }
                }}
                className="surface-card rounded-3xl p-6 border border-border/70 space-y-4"
              >
                <h2 className="font-display text-lg font-bold">Generate Scoped API Key</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Key label (e.g. HubSpot Lead Sync)"
                    required
                    className="rounded-xl text-xs"
                  />
                  <select
                    value={keyBusinessId}
                    onChange={(e) => setKeyBusinessId(e.target.value)}
                    className="rounded-xl border border-input bg-background px-3 py-2 text-xs"
                  >
                    <option value="">Personal Developer Scope</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        Business: {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DEVELOPER_SCOPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleScope(keyScopes, setKeyScopes, s.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold",
                        keyScopes.includes(s.id)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-secondary/40 text-muted-foreground",
                      )}
                    >
                      {s.id}
                    </button>
                  ))}
                </div>
                <Button
                  type="submit"
                  variant="hero"
                  size="sm"
                  disabled={createKey.isPending}
                  className="rounded-full text-xs gap-1.5"
                >
                  <KeyRound className="size-3.5" /> Generate Key
                </Button>
              </form>

              <div className="space-y-2.5">
                {apiKeys.map((k) => (
                  <article
                    key={k.id}
                    className="surface-card rounded-2xl p-4 border border-border/70 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-bold text-foreground">{k.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {k.key_prefix}•••••••• · {k.rate_limit_per_min} req/min ·{" "}
                        {k.scopes.join(", ")}
                      </p>
                    </div>
                    {k.revoked_at ? (
                      <span className="rounded-full bg-destructive/15 text-destructive px-2.5 py-0.5 text-[10px] font-bold uppercase">
                        Revoked
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          revokeKey.mutate(k.id, {
                            onSuccess: () => toast.success("API key revoked"),
                          })
                        }
                        className="rounded-full text-xs text-destructive"
                      >
                        Revoke
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* 4. WEBHOOKS & HMAC-SHA256 VERIFIER */}
      {tab === "webhooks" && (
        <section className="space-y-5">
          {user && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const created = await createWebhook.mutateAsync({
                    endpointUrl: whUrl,
                    events: whEvents,
                  });
                  setRevealedWhSecret(created.oneTimeSigningSecret);
                  setWhUrl("");
                  toast.success("Signed webhook registered");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Invalid webhook configuration");
                }
              }}
              className="surface-card rounded-3xl p-6 border border-border/70 space-y-4"
            >
              <h2 className="font-display text-lg font-bold">Register Signed HTTPS Webhook</h2>
              {revealedWhSecret && (
                <div className="rounded-2xl border border-primary/40 bg-primary/10 p-3 text-xs font-mono break-all">
                  Signing secret (save once): {revealedWhSecret}
                </div>
              )}
              <Input
                value={whUrl}
                onChange={(e) => setWhUrl(e.target.value)}
                placeholder="https://api.yourdomain.com/webhooks/ping"
                required
                className="rounded-xl text-xs"
              />
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <button
                    key={ev}
                    type="button"
                    onClick={() =>
                      setWhEvents((prev) =>
                        prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev],
                      )
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-semibold",
                      whEvents.includes(ev)
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-secondary/40 text-muted-foreground",
                    )}
                  >
                    {ev}
                  </button>
                ))}
              </div>
              <Button type="submit" variant="hero" size="sm" className="rounded-full text-xs">
                Save Webhook
              </Button>
            </form>
          )}

          {/* Live HMAC-SHA256 Signature Verifier */}
          <div className="surface-card rounded-3xl p-6 border border-border/70 space-y-3">
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" /> HMAC-SHA256 Webhook Signature
              Simulator
            </h2>
            <p className="text-xs text-muted-foreground">
              Test `X-Ping-Signature-256` signing and constant-time replay-window verification
              before going live.
            </p>
            <Input
              value={simSecret}
              onChange={(e) => setSimSecret(e.target.value)}
              placeholder="Signing secret"
              className="rounded-xl text-xs font-mono"
            />
            <Textarea
              rows={4}
              value={simPayload}
              onChange={(e) => setSimPayload(e.target.value)}
              className="rounded-xl text-xs font-mono"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="hero"
                onClick={async () => {
                  const sig = await signPingWebhookPayload(simPayload, simSecret);
                  setSimSignature(sig);
                  const ok = await verifyPingWebhookSignature(simPayload, sig, simSecret);
                  setSimVerified(ok);
                }}
                className="rounded-full text-xs"
              >
                Sign &amp; Verify Payload
              </Button>
              {simVerified !== null && (
                <span
                  data-testid="webhook-sim-status"
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-bold",
                    simVerified
                      ? "bg-primary/15 text-primary"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {simVerified ? "Signature Verified ✓" : "Invalid Signature"}
                </span>
              )}
            </div>
            {simSignature && (
              <p className="rounded-xl bg-secondary/50 p-3 font-mono text-[11px] break-all">
                X-Ping-Signature-256: {simSignature}
              </p>
            )}
          </div>
        </section>
      )}

      {/* 5. BUSINESS MESSAGING & WEBSITE EMBEDS */}
      {tab === "business-api" && (
        <section className="space-y-5">
          <div className="surface-card rounded-3xl p-6 border border-border/70 space-y-4">
            <h2 className="font-display text-lg font-bold">Website Enquiry Embed Generator</h2>
            <p className="text-xs text-muted-foreground">
              Drop a lightweight button on any website to route customer enquiries straight into
              your Ping Business Storefront &amp; multi-agent Business Inbox.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={embedSlug}
                onChange={(e) => setEmbedSlug(e.target.value)}
                placeholder="business-slug"
                className="rounded-xl text-xs"
              />
              <Input
                value={embedName}
                onChange={(e) => setEmbedName(e.target.value)}
                placeholder="Business display name"
                className="rounded-xl text-xs"
              />
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-border/70 bg-secondary/40 p-4 text-[11px] font-mono">
              {buildWebsiteEnquiryEmbedSnippet(embedSlug, embedName)}
            </pre>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void copyText("embed", buildWebsiteEnquiryEmbedSnippet(embedSlug, embedName))
              }
              className="rounded-full text-xs gap-1.5"
            >
              <Copy className="size-3.5" /> Copy HTML Embed
            </Button>
          </div>
        </section>
      )}

      {/* 6. SCALE & SEARCH ARCHITECTURE */}
      {tab === "scale" && (
        <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-4">
          <h2 className="font-display text-lg font-bold">
            1M+ User Scale, Search &amp; Rate-Limit Architecture
          </h2>
          <p className="text-xs text-muted-foreground">
            Keyset cursor pagination (`/api/v1/pings`), edge micro-caching (`s-maxage=15`), server
            rate limiting (`check_server_rate_limit` in `0032`), and swappable full-text search
            adapters.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {searchStatus.providers.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "rounded-2xl border p-4 text-xs space-y-1",
                  searchStatus.activeProvider === p.id
                    ? "border-primary/40 bg-primary/8"
                    : "border-border/70 bg-secondary/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-foreground">{p.label}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase">
                    {searchStatus.activeProvider === p.id
                      ? "Active"
                      : p.configured
                        ? "Ready"
                        : "Optional"}
                  </span>
                </div>
                <p className="text-muted-foreground">{p.notes}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
