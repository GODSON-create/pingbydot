/**
 * Official Ping by DOT TypeScript SDK Starter (`PingClient` — Phase 5.2).
 *
 * Zero-dependency Web Standards (`fetch`, `crypto.subtle`) client usable in
 * Node 22+, Cloudflare Workers, Deno, Bun, and modern browsers.
 */

import {
  computePkceChallenge,
  verifyPingWebhookSignature,
  type DeveloperScope,
} from "@/lib/developer";
import { SITE_ORIGIN } from "@/lib/site";

export interface PingClientConfig {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface PingListResponse {
  items: Array<{
    id: string;
    category: string;
    content: string;
    created_at: string;
    author?: { username: string; display_name: string } | null;
  }>;
  nextCursor: string | null;
}

export class PingClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PingClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? SITE_ORIGIN).replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  readonly health = {
    check: async () => {
      const resp = await this.fetchImpl(`${this.baseUrl}/api/v1/health`, {
        headers: this.headers(),
      });
      if (!resp.ok) throw new Error(`Ping health check failed (${resp.status})`);
      return resp.json() as Promise<{ ok: boolean; version: string; timestamp: string }>;
    },
  };

  readonly pings = {
    list: async (params?: { category?: string; limit?: number; cursor?: string }) => {
      const qs = new URLSearchParams();
      if (params?.category) qs.set("category", params.category);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.cursor) qs.set("cursor", params.cursor);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const resp = await this.fetchImpl(`${this.baseUrl}/api/v1/pings${suffix}`, {
        headers: this.headers(),
      });
      if (!resp.ok) throw new Error(`Ping list failed (${resp.status})`);
      return resp.json() as Promise<PingListResponse>;
    },
  };

  readonly business = {
    replyEnquiry: async (input: {
      businessId: string;
      enquiryId: string;
      replyMessage: string;
      leadStatus?: "new" | "qualified" | "in_progress" | "won" | "lost" | "closed";
    }) => {
      const resp = await this.fetchImpl(`${this.baseUrl}/api/v1/business/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(input),
      });
      const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!resp.ok) {
        throw new Error(String(payload["error"] ?? `Business API failed (${resp.status})`));
      }
      return payload;
    },
  };

  readonly oauth = {
    buildAuthorizeUrl: async (input: {
      clientId: string;
      redirectUri: string;
      scopes: DeveloperScope[];
      codeVerifier: string;
      state: string;
    }) => {
      const challenge = await computePkceChallenge(input.codeVerifier);
      const url = new URL("/oauth/authorize", this.baseUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", input.clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("scope", input.scopes.join(" "));
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", input.state);
      return url.toString();
    },
  };

  readonly webhooks = {
    verifySignature: verifyPingWebhookSignature,
  };
}
