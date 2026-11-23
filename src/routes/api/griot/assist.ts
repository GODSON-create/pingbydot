import { createFileRoute } from "@tanstack/react-router";
import { handleGriotAssistRequest } from "@/lib/griot-server";

/**
 * GRIOT AI Server Assist Endpoint (Stage 1 Hardened).
 *
 * Security & Honesty Invariants:
 * - Requires a verified Supabase Bearer JWT (`Authorization: Bearer <token>`).
 * - Enforces per-user rate limiting (DB `check_server_rate_limit` with in-memory fallback).
 * - Validates input strictly (size limit, JSON content type, Zod strict schema, control-char stripping).
 * - Never accesses `private_messages`, Close Circle tables, or exposes server credentials.
 */
export const Route = createFileRoute("/api/griot/assist")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => handleGriotAssistRequest(request),
    },
  },
});
