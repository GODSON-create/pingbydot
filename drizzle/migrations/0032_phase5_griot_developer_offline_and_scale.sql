-- 0032_phase5_griot_developer_offline_and_scale.sql
-- Phase 5: GRIOT AI Consent & Audit Layer, Developer Ecosystem (OAuth 2.0 PKCE,
-- Scoped API Keys, Signed Webhooks, Business Messaging API), Continental Localisation,
-- Server-Side Rate Limiting, and 1M+ Full-Text Search Scale Indexes.
-- Forward-only, idempotent, strict RLS (zero open USING (true) policies).

-- ============================================================================
-- 1. CONTINENTAL LOCALISATION & LOW-BANDWIDTH PREFERENCES (Phase 5.4)
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_locale text NOT NULL DEFAULT 'en'
    CHECK (preferred_locale IN ('en', 'fr', 'sw', 'ha', 'yo', 'ar')),
  ADD COLUMN IF NOT EXISTS low_bandwidth_mode boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 2. GRIOT AI — PERMISSION-BOUNDED CONSENT & AUDIT LOGS (Phase 5.1)
-- ============================================================================
-- Architectural invariant: GRIOT AI NEVER silently reads private direct messages.
-- Enforced both by schema CHECK constraint and RLS ownership boundaries.

CREATE TABLE IF NOT EXISTS public.griot_ai_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  allow_public_profile_context boolean NOT NULL DEFAULT false,
  allow_ping_composer_assist boolean NOT NULL DEFAULT false,
  allow_opportunity_matching boolean NOT NULL DEFAULT false,
  allow_business_reply_drafts boolean NOT NULL DEFAULT false,
  allow_private_messages_access boolean NOT NULL DEFAULT false
    CHECK (allow_private_messages_access = false),
  preferred_tone text NOT NULL DEFAULT 'concise'
    CHECK (preferred_tone IN ('concise', 'professional', 'warm', 'structured')),
  consent_updated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.griot_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (
    action_type IN (
      'draft_ping',
      'clarity_audit',
      'hashtag_suggest',
      'opportunity_pitch',
      'business_reply_draft',
      'thread_summary',
      'translation_prep'
    )
  ),
  provider_mode text NOT NULL DEFAULT 'deterministic_local'
    CHECK (provider_mode IN ('deterministic_local', 'live_provider')),
  source_surface text NOT NULL DEFAULT 'griot_workspace'
    CHECK (char_length(trim(source_surface)) BETWEEN 2 AND 60),
  input_char_count integer NOT NULL DEFAULT 0 CHECK (input_char_count >= 0 AND input_char_count <= 20000),
  private_messages_accessed boolean NOT NULL DEFAULT false
    CHECK (private_messages_accessed = false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS griot_audit_logs_user_created_idx
  ON public.griot_audit_logs (user_id, created_at DESC);

ALTER TABLE public.griot_ai_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.griot_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own GRIOT preferences" ON public.griot_ai_preferences;
CREATE POLICY "Users read own GRIOT preferences" ON public.griot_ai_preferences
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own GRIOT preferences" ON public.griot_ai_preferences;
CREATE POLICY "Users insert own GRIOT preferences" ON public.griot_ai_preferences
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND allow_private_messages_access = false);

DROP POLICY IF EXISTS "Users update own GRIOT preferences" ON public.griot_ai_preferences;
CREATE POLICY "Users update own GRIOT preferences" ON public.griot_ai_preferences
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND allow_private_messages_access = false);

DROP POLICY IF EXISTS "Users read own GRIOT audit logs" ON public.griot_audit_logs;
CREATE POLICY "Users read own GRIOT audit logs" ON public.griot_audit_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users record own GRIOT audit logs" ON public.griot_audit_logs;
CREATE POLICY "Users record own GRIOT audit logs" ON public.griot_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND private_messages_accessed = false);

-- ============================================================================
-- 3. DEVELOPER ECOSYSTEM: OAUTH 2.0 PKCE, API KEYS & WEBHOOKS (Phase 5.2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.developer_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  homepage_url text,
  client_id text NOT NULL UNIQUE CHECK (client_id ~ '^ping_app_[a-z0-9]{16,48}$'),
  client_secret_hash text NOT NULL CHECK (char_length(client_secret_hash) = 64),
  redirect_uris text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(redirect_uris) >= 1 AND cardinality(redirect_uris) <= 10),
  allowed_scopes text[] NOT NULL DEFAULT ARRAY['profile:read', 'pings:read']::text[],
  review_status text NOT NULL DEFAULT 'sandbox'
    CHECK (review_status IN ('sandbox', 'pending_security_review', 'approved', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS developer_apps_owner_idx ON public.developer_apps (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.oauth_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.developer_apps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE CHECK (char_length(code_hash) = 64),
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  code_challenge text NOT NULL CHECK (char_length(code_challenge) BETWEEN 43 AND 128),
  code_challenge_method text NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_codes_app_user_idx
  ON public.oauth_authorization_codes (app_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.oauth_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.developer_apps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  token_prefix text NOT NULL CHECK (char_length(token_prefix) BETWEEN 6 AND 20),
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx
  ON public.oauth_access_tokens (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.developer_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  key_prefix text NOT NULL CHECK (key_prefix ~ '^ping_(live|test)_[a-zA-Z0-9]{6,16}$'),
  key_hash text NOT NULL UNIQUE CHECK (char_length(key_hash) = 64),
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  scopes text[] NOT NULL DEFAULT ARRAY['pings:read', 'opportunities:read']::text[],
  rate_limit_per_min integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_min BETWEEN 10 AND 600),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS developer_api_keys_owner_idx
  ON public.developer_api_keys (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.developer_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL CHECK (endpoint_url ~ '^https://[^[:space:]]{4,500}$'),
  signing_secret_prefix text NOT NULL CHECK (char_length(signing_secret_prefix) BETWEEN 6 AND 20),
  signing_secret_hash text NOT NULL CHECK (char_length(signing_secret_hash) = 64),
  subscribed_events text[] NOT NULL DEFAULT ARRAY['business.enquiry.created']::text[]
    CHECK (cardinality(subscribed_events) >= 1 AND cardinality(subscribed_events) <= 20),
  active boolean NOT NULL DEFAULT true,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS developer_webhooks_owner_idx
  ON public.developer_webhooks (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.developer_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES public.developer_webhooks(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (char_length(trim(event_type)) BETWEEN 3 AND 80),
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'delivered', 'failed', 'retrying')),
  http_status integer,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 10),
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS developer_webhook_deliveries_wh_idx
  ON public.developer_webhook_deliveries (webhook_id, created_at DESC);

ALTER TABLE public.developer_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and admins read developer apps" ON public.developer_apps;
CREATE POLICY "Owners and admins read developer apps" ON public.developer_apps
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Developers create sandbox apps" ON public.developer_apps;
CREATE POLICY "Developers create sandbox apps" ON public.developer_apps
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND review_status = 'sandbox'
    AND NOT ('private_messages:read' = ANY(allowed_scopes))
  );

DROP POLICY IF EXISTS "Developers update own sandbox apps" ON public.developer_apps;
CREATE POLICY "Developers update own sandbox apps" ON public.developer_apps
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (
    auth.uid() = owner_id
    AND review_status IN ('sandbox', 'pending_security_review')
    AND NOT ('private_messages:read' = ANY(allowed_scopes))
  );

DROP POLICY IF EXISTS "Developers delete own apps" ON public.developer_apps;
CREATE POLICY "Developers delete own apps" ON public.developer_apps
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users read own OAuth auth codes" ON public.oauth_authorization_codes;
CREATE POLICY "Users read own OAuth auth codes" ON public.oauth_authorization_codes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own OAuth tokens" ON public.oauth_access_tokens;
CREATE POLICY "Users read own OAuth tokens" ON public.oauth_access_tokens
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users revoke own OAuth tokens" ON public.oauth_access_tokens;
CREATE POLICY "Users revoke own OAuth tokens" ON public.oauth_access_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND revoked_at IS NOT NULL);

-- Prevent direct client minting of OAuth access tokens
REVOKE INSERT, DELETE ON public.oauth_access_tokens FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Owners and business admins read API keys" ON public.developer_api_keys;
CREATE POLICY "Owners and business admins read API keys" ON public.developer_api_keys
  FOR SELECT TO authenticated
  USING (
    auth.uid() = owner_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  );

DROP POLICY IF EXISTS "Owners create scoped API keys" ON public.developer_api_keys;
CREATE POLICY "Owners create scoped API keys" ON public.developer_api_keys
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND NOT ('private_messages:read' = ANY(scopes))
    AND (
      business_id IS NULL
      OR public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[])
    )
  );

DROP POLICY IF EXISTS "Owners revoke API keys" ON public.developer_api_keys;
CREATE POLICY "Owners revoke API keys" ON public.developer_api_keys
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = owner_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  )
  WITH CHECK (
    auth.uid() = owner_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  );

DROP POLICY IF EXISTS "Owners and business admins manage webhooks" ON public.developer_webhooks;
CREATE POLICY "Owners and business admins manage webhooks" ON public.developer_webhooks
  FOR SELECT TO authenticated
  USING (
    auth.uid() = owner_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  );

DROP POLICY IF EXISTS "Owners insert webhooks" ON public.developer_webhooks;
CREATE POLICY "Owners insert webhooks" ON public.developer_webhooks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND (
      business_id IS NULL
      OR public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[])
    )
  );

DROP POLICY IF EXISTS "Owners update webhooks" ON public.developer_webhooks;
CREATE POLICY "Owners update webhooks" ON public.developer_webhooks
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = owner_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  )
  WITH CHECK (
    auth.uid() = owner_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  );

DROP POLICY IF EXISTS "Owners delete webhooks" ON public.developer_webhooks;
CREATE POLICY "Owners delete webhooks" ON public.developer_webhooks
  FOR DELETE TO authenticated
  USING (
    auth.uid() = owner_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  );

DROP POLICY IF EXISTS "Webhook owners read delivery logs" ON public.developer_webhook_deliveries;
CREATE POLICY "Webhook owners read delivery logs" ON public.developer_webhook_deliveries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.developer_webhooks dw
      WHERE dw.id = developer_webhook_deliveries.webhook_id
        AND (
          dw.owner_id = auth.uid()
          OR (dw.business_id IS NOT NULL AND public.is_business_member(dw.business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
        )
    )
  );

-- Safe OAuth app metadata lookup for consent screens (never returns client_secret_hash)
CREATE OR REPLACE FUNCTION public.get_oauth_app_public_info(p_client_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT id, name, description, homepage_url, client_id, redirect_uris, allowed_scopes, review_status
  INTO v_row
  FROM public.developer_apps
  WHERE client_id = p_client_id
    AND review_status <> 'suspended';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_oauth_app_public_info(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_oauth_app_public_info(text) TO authenticated;

-- Issue single-use PKCE authorization code after explicit user consent
CREATE OR REPLACE FUNCTION public.create_oauth_authorization_code(
  p_client_id text,
  p_redirect_uri text,
  p_scopes text[],
  p_code_challenge text,
  p_code_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app public.developer_apps%ROWTYPE;
  v_expires timestamptz := now() + interval '10 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_app
  FROM public.developer_apps
  WHERE client_id = p_client_id AND review_status <> 'suspended';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or suspended OAuth client';
  END IF;

  IF NOT (p_redirect_uri = ANY(v_app.redirect_uris)) THEN
    RAISE EXCEPTION 'Unregistered redirect_uri';
  END IF;

  IF 'private_messages:read' = ANY(p_scopes) THEN
    RAISE EXCEPTION 'Private direct messages are never accessible via third-party OAuth scopes';
  END IF;

  IF NOT (p_scopes <@ v_app.allowed_scopes) THEN
    RAISE EXCEPTION 'Requested scopes exceed client allowlist';
  END IF;

  IF char_length(p_code_challenge) < 43 OR char_length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid PKCE S256 challenge or code hash';
  END IF;

  INSERT INTO public.oauth_authorization_codes (
    app_id, user_id, code_hash, redirect_uri, scopes, code_challenge, code_challenge_method, expires_at
  )
  VALUES (
    v_app.id, v_uid, p_code_hash, p_redirect_uri, p_scopes, p_code_challenge, 'S256', v_expires
  );

  RETURN jsonb_build_object('ok', true, 'expires_at', v_expires);
END;
$$;

REVOKE ALL ON FUNCTION public.create_oauth_authorization_code(text, text, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_oauth_authorization_code(text, text, text[], text, text) TO authenticated;

-- Server-only API key verification RPC (NEVER callable by anon or authenticated clients!)
CREATE OR REPLACE FUNCTION public.verify_api_key_hash(p_key_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key public.developer_api_keys%ROWTYPE;
BEGIN
  SELECT * INTO v_key
  FROM public.developer_api_keys
  WHERE key_hash = p_key_hash
    AND revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.developer_api_keys
  SET last_used_at = now()
  WHERE id = v_key.id;

  RETURN jsonb_build_object(
    'id', v_key.id,
    'owner_id', v_key.owner_id,
    'business_id', v_key.business_id,
    'environment', v_key.environment,
    'scopes', v_key.scopes,
    'rate_limit_per_min', v_key.rate_limit_per_min
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_api_key_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_api_key_hash(text) TO service_role;

-- ============================================================================
-- 4. SERVER-SIDE RATE LIMITING RPC (Backlog #4 & Phase 5.5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_server_rate_limit(
  p_action text,
  p_limit integer DEFAULT 30,
  p_window_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(p_limit, 1000));
  v_window integer := greatest(10, least(p_window_seconds, 3600));
  v_key text;
  v_now timestamptz := now();
  v_row public.api_rate_limits%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_key := left(trim(p_action), 60) || ':' || v_uid::text;

  INSERT INTO public.api_rate_limits (bucket_key, window_started_at, request_count)
  VALUES (v_key, v_now, 1)
  ON CONFLICT (bucket_key) DO UPDATE
    SET
      window_started_at = CASE
        WHEN public.api_rate_limits.window_started_at + make_interval(secs => v_window) <= v_now
          THEN v_now
        ELSE public.api_rate_limits.window_started_at
      END,
      request_count = CASE
        WHEN public.api_rate_limits.window_started_at + make_interval(secs => v_window) <= v_now
          THEN 1
        ELSE public.api_rate_limits.request_count + 1
      END
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'allowed', v_row.request_count <= v_limit,
    'remaining', greatest(0, v_limit - v_row.request_count),
    'reset_at', v_row.window_started_at + make_interval(secs => v_window)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_server_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_server_rate_limit(text, integer, integer) TO authenticated;

-- ============================================================================
-- 5. 1M+ SCALE FULL-TEXT SEARCH & CURSOR PAGINATION INDEXES (Phase 5.5)
-- ============================================================================

CREATE INDEX IF NOT EXISTS pings_fts_gin_idx
  ON public.pings USING gin (
    to_tsvector('english', coalesce(headline, '') || ' ' || content)
  )
  WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS hubs_fts_gin_idx
  ON public.hubs USING gin (
    to_tsvector('english', name || ' ' || coalesce(tagline, '') || ' ' || coalesce(description, ''))
  )
  WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS business_profiles_fts_gin_idx
  ON public.business_profiles USING gin (
    to_tsvector('english', name || ' ' || coalesce(tagline, '') || ' ' || coalesce(description, ''))
  );

CREATE INDEX IF NOT EXISTS signal_opportunities_fts_gin_idx
  ON public.signal_opportunities USING gin (
    to_tsvector('english', title || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))
  )
  WHERE status = 'open';
