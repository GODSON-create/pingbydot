import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck, Lock, CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  DEVELOPER_SCOPES,
  FORBIDDEN_DEVELOPER_SCOPES,
  sanitizeRequestedScopes,
  sha256Hex,
  validateOAuthRedirectUri,
} from "@/lib/developer";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/oauth/authorize")({
  staticData: { sitemap: false },
  validateSearch: z.object({
    response_type: z.string().optional(),
    client_id: z.string().optional(),
    redirect_uri: z.string().optional(),
    scope: z.string().optional(),
    state: z.string().optional(),
    code_challenge: z.string().optional(),
    code_challenge_method: z.string().optional(),
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Authorize Application — Ping OAuth 2.0" },
    ],
  }),
  component: OAuthAuthorizePage,
});

interface OAuthAppInfo {
  id: string;
  name: string;
  description: string;
  homepage_url: string | null;
  client_id: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  review_status: string;
}

function OAuthAuthorizePage() {
  const { user, ready } = useAuth();
  const params = Route.useSearch();
  const [appInfo, setAppInfo] = useState<OAuthAppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rawScopes = (params.scope ?? "").split(/\s+/).filter(Boolean);
  const forbiddenRequested = rawScopes.filter((s) =>
    (FORBIDDEN_DEVELOPER_SCOPES as readonly string[]).includes(s),
  );
  const validScopes = sanitizeRequestedScopes(rawScopes);
  const redirectCheck = validateOAuthRedirectUri(params.redirect_uri ?? "");

  const validationError =
    params.response_type !== "code"
      ? "OAuth 2.0 Authorization Code flow requires response_type=code."
      : !params.client_id
        ? "Missing required client_id parameter."
        : !redirectCheck.valid
          ? (redirectCheck.error ?? "Invalid redirect_uri.")
          : params.code_challenge_method !== "S256" || (params.code_challenge?.length ?? 0) < 43
            ? "PKCE S256 (code_challenge + code_challenge_method=S256) is mandatory for Ping OAuth 2.0."
            : forbiddenRequested.length > 0
              ? `Blocked forbidden scope(s): ${forbiddenRequested.join(", ")}. Private direct messages are never exposed via OAuth.`
              : validScopes.length === 0
                ? "At least one valid Ping scope must be requested."
                : null;

  useEffect(() => {
    if (!ready || !user || validationError || !params.client_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (supabase as any)
      .rpc("get_oauth_app_public_info", { p_client_id: params.client_id })
      .then(
        ({ data, error }: { data: OAuthAppInfo | null; error: { message?: string } | null }) => {
          if (cancelled) return;
          if (error) {
            setErrorMsg(
              "OAuth client registry unavailable (migration 0032 pending or client not registered).",
            );
          } else if (!data) {
            setErrorMsg("Unknown or suspended OAuth client_id.");
          } else if (!data.redirect_uris.includes(params.redirect_uri ?? "")) {
            setErrorMsg("The provided redirect_uri is not registered for this OAuth application.");
          } else {
            setAppInfo(data);
          }
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user, validationError, params.client_id, params.redirect_uri]);

  const handleApprove = async () => {
    if (!appInfo || !params.redirect_uri || !params.code_challenge) return;
    setApproving(true);
    try {
      const randomBytes = new Uint8Array(24);
      crypto.getRandomValues(randomBytes);
      const rawCode = `ping_code_${Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
      const codeHash = await sha256Hex(rawCode);

      const { error } = await (supabase as any).rpc("create_oauth_authorization_code", {
        p_client_id: appInfo.client_id,
        p_redirect_uri: params.redirect_uri,
        p_scopes: validScopes,
        p_code_challenge: params.code_challenge,
        p_code_hash: codeHash,
      });

      if (error) throw error;

      const target = new URL(params.redirect_uri);
      target.searchParams.set("code", rawCode);
      if (params.state) target.searchParams.set("state", params.state);
      window.location.assign(target.toString());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not issue authorization code.");
    } finally {
      setApproving(false);
    }
  };

  const handleDeny = () => {
    if (params.redirect_uri && redirectCheck.valid) {
      const target = new URL(params.redirect_uri);
      target.searchParams.set("error", "access_denied");
      if (params.state) target.searchParams.set("state", params.state);
      window.location.assign(target.toString());
    }
  };

  return (
    <div className="mx-auto max-w-lg px-5 py-12">
      <div className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
          <Lock className="size-4" /> Ping OAuth 2.0 (PKCE S256)
        </div>

        {validationError || errorMsg ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 space-y-2">
            <p className="text-sm font-bold text-destructive flex items-center gap-2">
              <ShieldAlert className="size-4" /> Authorization Request Blocked
            </p>
            <p className="text-xs text-foreground/90">{validationError ?? errorMsg}</p>
            <Button asChild variant="outline" size="sm" className="mt-2 rounded-full text-xs">
              <Link to="/developers">Open Developer Portal</Link>
            </Button>
          </div>
        ) : !ready || loading ? (
          <div className="h-32 animate-pulse rounded-2xl bg-secondary/50" />
        ) : !user ? (
          <div className="space-y-3">
            <h1 className="font-display text-xl font-bold">Sign in to review permissions</h1>
            <p className="text-xs text-muted-foreground">
              An application is requesting scoped access to your Ping account. Sign in first to
              inspect the exact permissions before approving or denying.
            </p>
            <Button asChild variant="hero" className="rounded-full">
              <Link
                to="/login"
                search={{
                  next: `/oauth/authorize${typeof window !== "undefined" ? window.location.search : ""}`,
                }}
              >
                Sign in to Continue
              </Link>
            </Button>
          </div>
        ) : appInfo ? (
          <>
            <div>
              <h1 className="font-display text-2xl font-extrabold">{appInfo.name}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {appInfo.description || "Third-party Ping integration"} · Status:{" "}
                <span className="font-semibold uppercase text-foreground">
                  {appInfo.review_status}
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Requested Permissions
              </p>
              {validScopes.map((scopeId) => {
                const meta = DEVELOPER_SCOPES.find((s) => s.id === scopeId);
                return (
                  <div
                    key={scopeId}
                    className="flex items-start gap-2.5 rounded-2xl border border-border/60 bg-secondary/35 p-3 text-xs"
                  >
                    <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-foreground">{meta?.label ?? scopeId}</p>
                      <p className="text-[11px] text-muted-foreground">{meta?.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-primary/25 bg-primary/8 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
              <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                Ping never grants third-party apps access to your private 1-on-1 messages, password,
                or DOT wallet balance mutations.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleDeny} className="rounded-full">
                Deny
              </Button>
              <Button
                type="button"
                variant="hero"
                disabled={approving}
                onClick={() => void handleApprove()}
                className="rounded-full"
              >
                {approving ? "Authorizing…" : "Approve Access"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
