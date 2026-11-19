-- ==============================================================================
-- Migration 0025: Phase 1 Workstream 4 — Ping Economic Activity Measurement
-- ==============================================================================
-- Establishes a privacy-safe, anti-spoofing canonical event and settlement
-- architecture distinguishing acquisition, activation, engagement, referrals,
-- leads, virtual DOT credits, and server-verified economic outcomes.
--
-- Integrity & Privacy guarantees:
--   1. Never stores private DM contents, auth tokens, passwords, or emails.
--   2. Prevents client-side fabrication of revenue, settlements, or verified txs.
--   3. Separates virtual DOT credits (credit_activity / DOT_CREDIT) from cash
--      revenue & payment settlement (verified_economic_outcomes, currency <> 'DOT').
--   4. Enables owner-scoped read access & admin aggregate readiness without any
--      open `USING (true)` policies.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Canonical Append-Only Economic & Activity Event Log
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.economic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (
    event_type IN (
      'account_created',
      'onboarding_completed',
      'profile_completed',
      'first_meaningful_session',
      'connection_created',
      'ping_published',
      'ping_shared',
      'meaningful_conversation_started',
      'community_joined',
      'business_lead_generated',
      'transaction_completed',
      'venture_submitted',
      'investor_introduction_completed',
      'dot_credit_earned',
      'dot_credit_redeemed'
    )
  ),
  event_category text NOT NULL CHECK (
    event_category IN (
      'acquisition',
      'activation',
      'engagement',
      'referral',
      'lead',
      'credit_activity',
      'verified_outcome'
    )
  ),
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type text CHECK (
    target_type IS NULL OR target_type IN (
      'profile',
      'ping',
      'conversation',
      'hub',
      'signal',
      'moment',
      'connection',
      'external_url',
      'dot_transaction',
      'settlement',
      'venture',
      'introduction'
    )
  ),
  target_id text CHECK (target_id IS NULL OR char_length(target_id) BETWEEN 1 AND 160),
  source text NOT NULL DEFAULT 'web_app' CHECK (char_length(btrim(source)) BETWEEN 1 AND 64),
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_segments text[] NOT NULL DEFAULT '{}'::text[] CHECK (
    actor_segments <@ ARRAY['general', 'creator', 'business', 'community', 'builder', 'investor']::text[]
  ),
  verification_tier text NOT NULL DEFAULT 'system_observed' CHECK (
    verification_tier IN ('client_observed', 'system_observed', 'server_verified')
  ),
  dedupe_key text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 3 AND 180),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Prevent transactions, settlements, or virtual DOT credits from being misclassified
  CONSTRAINT economic_events_verified_tx_guard CHECK (
    event_type <> 'transaction_completed'
    OR (event_category = 'verified_outcome' AND verification_tier = 'server_verified')
  ),
  CONSTRAINT economic_events_verified_domain_guard CHECK (
    event_type NOT IN ('venture_submitted', 'investor_introduction_completed')
    OR (event_category = 'verified_outcome' AND verification_tier IN ('system_observed', 'server_verified'))
  ),
  CONSTRAINT economic_events_credit_guard CHECK (
    (event_type IN ('dot_credit_earned', 'dot_credit_redeemed')) = (event_category = 'credit_activity')
  ),
  CONSTRAINT economic_events_non_revenue_guard CHECK (
    event_category NOT IN ('engagement', 'referral', 'lead', 'credit_activity')
    OR verification_tier <> 'server_verified'
  ),
  CONSTRAINT economic_events_payload_size CHECK (
    pg_column_size(attribution) <= 2048 AND pg_column_size(metadata) <= 4096
  )
);

CREATE INDEX IF NOT EXISTS economic_events_actor_created_idx
  ON public.economic_events (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS economic_events_type_created_idx
  ON public.economic_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS economic_events_category_created_idx
  ON public.economic_events (event_category, created_at DESC);

CREATE INDEX IF NOT EXISTS economic_events_subject_type_idx
  ON public.economic_events (subject_user_id, event_type, created_at DESC)
  WHERE subject_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS economic_events_target_idx
  ON public.economic_events (target_type, target_id, created_at DESC)
  WHERE target_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS economic_events_segments_gin_idx
  ON public.economic_events USING GIN (actor_segments);

CREATE UNIQUE INDEX IF NOT EXISTS economic_events_dedupe_uidx
  ON public.economic_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.economic_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.economic_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.economic_events TO authenticated;
GRANT SELECT, INSERT ON public.economic_events TO service_role;

DROP POLICY IF EXISTS "Actors read own economic events" ON public.economic_events;
CREATE POLICY "Actors read own economic events" ON public.economic_events
  FOR SELECT TO authenticated
  USING (actor_user_id = (select auth.uid()) OR public.is_ping_admin());

-- Immutability guard: economic_events is strictly append-only
CREATE OR REPLACE FUNCTION public.prevent_economic_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'economic_events is an append-only measurement log and cannot be modified or deleted'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS economic_events_immutable ON public.economic_events;
CREATE TRIGGER economic_events_immutable
  BEFORE UPDATE OR DELETE ON public.economic_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_economic_event_mutation();

-- ------------------------------------------------------------------------------
-- 2. Verified Economic Outcomes Ledger (Server-Only Cash & Settlement Store)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verified_economic_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_type text NOT NULL CHECK (
    outcome_type IN (
      'cash_subscription',
      'marketplace_transaction',
      'creator_payout',
      'b2b_deal_verified',
      'venture_funding_verified',
      'paid_intro_fee'
    )
  ),
  settlement_status text NOT NULL DEFAULT 'pending' CHECK (
    settlement_status IN ('pending', 'settled', 'refunded', 'disputed', 'void')
  ),
  payer_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  beneficiary_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$' AND upper(currency) <> 'DOT'),
  gross_amount_minor bigint NOT NULL CHECK (gross_amount_minor >= 0),
  platform_fee_minor bigint NOT NULL DEFAULT 0 CHECK (
    platform_fee_minor >= 0 AND platform_fee_minor <= gross_amount_minor
  ),
  net_amount_minor bigint GENERATED ALWAYS AS (gross_amount_minor - platform_fee_minor) STORED,
  provider text NOT NULL CHECK (
    provider IN ('stripe', 'paystack', 'flutterwave', 'bank_wire', 'escrow', 'admin_verified')
  ),
  external_reference text NOT NULL CHECK (char_length(btrim(external_reference)) BETWEEN 2 AND 160),
  lead_event_id uuid REFERENCES public.economic_events(id) ON DELETE SET NULL,
  target_type text,
  target_id text,
  verified_at timestamptz,
  verified_by text NOT NULL CHECK (char_length(btrim(verified_by)) BETWEEN 2 AND 80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(metadata) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_reference)
);

CREATE INDEX IF NOT EXISTS verified_outcomes_beneficiary_idx
  ON public.verified_economic_outcomes (beneficiary_user_id, settlement_status, created_at DESC);

CREATE INDEX IF NOT EXISTS verified_outcomes_payer_idx
  ON public.verified_economic_outcomes (payer_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS verified_outcomes_lead_idx
  ON public.verified_economic_outcomes (lead_event_id)
  WHERE lead_event_id IS NOT NULL;

ALTER TABLE public.verified_economic_outcomes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.verified_economic_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.verified_economic_outcomes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.verified_economic_outcomes TO service_role;

DROP POLICY IF EXISTS "Participants read own verified outcomes" ON public.verified_economic_outcomes;
CREATE POLICY "Participants read own verified outcomes" ON public.verified_economic_outcomes
  FOR SELECT TO authenticated
  USING (
    payer_user_id = (select auth.uid())
    OR beneficiary_user_id = (select auth.uid())
    OR public.is_ping_admin()
  );

CREATE OR REPLACE FUNCTION public.guard_verified_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'verified_economic_outcomes rows cannot be deleted' USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.outcome_type IS DISTINCT FROM OLD.outcome_type
     OR NEW.payer_user_id IS DISTINCT FROM OLD.payer_user_id
     OR NEW.beneficiary_user_id IS DISTINCT FROM OLD.beneficiary_user_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.gross_amount_minor IS DISTINCT FROM OLD.gross_amount_minor
     OR NEW.platform_fee_minor IS DISTINCT FROM OLD.platform_fee_minor
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Core verified settlement fields are immutable once created'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.settlement_status = 'settled' AND NEW.settlement_status = 'pending' THEN
    RAISE EXCEPTION 'Settled economic outcomes cannot revert to pending' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verified_outcomes_guard ON public.verified_economic_outcomes;
CREATE TRIGGER verified_outcomes_guard
  BEFORE UPDATE OR DELETE ON public.verified_economic_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_outcome_mutation();

-- ------------------------------------------------------------------------------
-- 3. Internal Emitter & Automated Server Triggers (Fail-Safe, Zero PII)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._emit_economic_event_internal(
  _event_type text,
  _event_category text,
  _actor_user_id uuid,
  _subject_user_id uuid DEFAULT NULL,
  _target_type text DEFAULT NULL,
  _target_id text DEFAULT NULL,
  _source text DEFAULT 'db_trigger',
  _attribution jsonb DEFAULT '{}'::jsonb,
  _verification_tier text DEFAULT 'system_observed',
  _dedupe_key text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_segments text[] := '{}'::text[];
  v_id uuid;
BEGIN
  IF _actor_user_id IS NOT NULL THEN
    SELECT coalesce(p.participation_pathways, '{}'::text[])
    INTO v_segments
    FROM public.profiles p
    WHERE p.id = _actor_user_id;
  END IF;

  INSERT INTO public.economic_events (
    event_type,
    event_category,
    actor_user_id,
    subject_user_id,
    target_type,
    target_id,
    source,
    attribution,
    actor_segments,
    verification_tier,
    dedupe_key,
    metadata
  )
  VALUES (
    _event_type,
    _event_category,
    _actor_user_id,
    _subject_user_id,
    _target_type,
    _target_id,
    coalesce(nullif(btrim(_source), ''), 'db_trigger'),
    coalesce(_attribution, '{}'::jsonb),
    coalesce(v_segments, '{}'::text[]),
    _verification_tier,
    _dedupe_key,
    coalesce(_metadata, '{}'::jsonb)
  )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL AND _dedupe_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.economic_events WHERE dedupe_key = _dedupe_key;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._emit_economic_event_internal(
  text, text, uuid, uuid, text, text, text, jsonb, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

-- 3a. Profiles trigger: account_created, onboarding_completed, profile_completed
CREATE OR REPLACE FUNCTION public.trg_profiles_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_complete boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._emit_economic_event_internal(
      'account_created',
      'acquisition',
      NEW.id,
      NULL,
      'profile',
      NEW.id::text,
      'auth_signup',
      '{}'::jsonb,
      'system_observed',
      'account_created:' || NEW.id::text,
      '{}'::jsonb
    );
  END IF;

  IF NEW.onboarding_completed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.onboarding_completed_at IS NULL) THEN
    PERFORM public._emit_economic_event_internal(
      'onboarding_completed',
      'activation',
      NEW.id,
      NULL,
      'profile',
      NEW.id::text,
      'onboarding',
      '{}'::jsonb,
      'system_observed',
      'onboarding_completed:' || NEW.id::text,
      jsonb_build_object(
        'has_country', char_length(btrim(coalesce(NEW.country, ''))) > 0,
        'interests_count', cardinality(coalesce(NEW.interests, '{}'::text[])),
        'segments_count', cardinality(coalesce(NEW.participation_pathways, '{}'::text[]))
      )
    );
  END IF;

  v_profile_complete :=
    char_length(btrim(coalesce(NEW.display_name, ''))) > 0
    AND NEW.username ~ '^[a-z0-9_]{3,24}$'
    AND (
      char_length(btrim(coalesce(NEW.bio, ''))) >= 10
      OR (
        char_length(btrim(coalesce(NEW.country, ''))) > 0
        AND cardinality(coalesce(NEW.interests, '{}'::text[])) > 0
      )
    );

  IF v_profile_complete THEN
    PERFORM public._emit_economic_event_internal(
      'profile_completed',
      'activation',
      NEW.id,
      NULL,
      'profile',
      NEW.id::text,
      CASE WHEN TG_OP = 'INSERT' THEN 'onboarding' ELSE 'profile_update' END,
      '{}'::jsonb,
      'system_observed',
      'profile_completed:' || NEW.id::text,
      jsonb_build_object(
        'has_avatar', NEW.avatar_url IS NOT NULL,
        'has_bio', char_length(btrim(coalesce(NEW.bio, ''))) >= 10,
        'has_country', char_length(btrim(coalesce(NEW.country, ''))) > 0
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_economic_events ON public.profiles;
CREATE TRIGGER profiles_economic_events
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_economic_events();

-- 3b. Follows trigger: connection_created
CREATE OR REPLACE FUNCTION public.trg_follows_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._emit_economic_event_internal(
    'connection_created',
    'engagement',
    NEW.follower_id,
    NEW.following_id,
    'profile',
    NEW.following_id::text,
    'follow',
    '{}'::jsonb,
    'system_observed',
    'connection_follow:' || NEW.follower_id::text || ':' || NEW.following_id::text,
    jsonb_build_object('connection_kind', 'follow')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follows_economic_events ON public.follows;
CREATE TRIGGER follows_economic_events
  AFTER INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.trg_follows_economic_events();

-- 3c. External profile connections trigger: connection_created (platform metadata only, no handles)
CREATE OR REPLACE FUNCTION public.trg_profile_connections_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._emit_economic_event_internal(
    'connection_created',
    'engagement',
    NEW.user_id,
    NULL,
    'connection',
    NEW.id::text,
    'external_connection',
    '{}'::jsonb,
    'system_observed',
    'connection_ext:' || NEW.user_id::text || ':' || NEW.platform,
    jsonb_build_object(
      'connection_kind', 'external_platform',
      'platform', NEW.platform,
      'is_public', NEW.is_public
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_connections_economic_events ON public.profile_connections;
CREATE TRIGGER profile_connections_economic_events
  AFTER INSERT ON public.profile_connections
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_connections_economic_events();

-- 3d. Pings trigger: ping_published (+ quote re-ping referral tracking)
CREATE OR REPLACE FUNCTION public.trg_pings_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_author uuid;
BEGIN
  PERFORM public._emit_economic_event_internal(
    'ping_published',
    'engagement',
    NEW.user_id,
    NULL,
    'ping',
    NEW.id::text,
    CASE WHEN NEW.visibility = 'hub' THEN 'hub_composer' ELSE 'ping_composer' END,
    '{}'::jsonb,
    'system_observed',
    'ping_published:' || NEW.id::text,
    jsonb_build_object(
      'category', NEW.category,
      'visibility', NEW.visibility,
      'has_cta', NEW.cta_url IS NOT NULL,
      'has_media', NEW.image_url IS NOT NULL OR coalesce(cardinality(NEW.media_urls), 0) > 0,
      'is_reping', NEW.source_ping_id IS NOT NULL
    )
  );

  IF NEW.source_ping_id IS NOT NULL THEN
    SELECT p.user_id INTO v_source_author
    FROM public.pings p
    WHERE p.id = NEW.source_ping_id AND p.hidden_at IS NULL;

    IF v_source_author IS NOT NULL THEN
      PERFORM public._emit_economic_event_internal(
        'ping_shared',
        'referral',
        NEW.user_id,
        v_source_author,
        'ping',
        NEW.source_ping_id::text,
        'quote_reping',
        '{}'::jsonb,
        'system_observed',
        'ping_reping:' || NEW.id::text,
        jsonb_build_object('channel', 'quote_reping')
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pings_economic_events ON public.pings;
CREATE TRIGGER pings_economic_events
  AFTER INSERT ON public.pings
  FOR EACH ROW EXECUTE FUNCTION public.trg_pings_economic_events();

-- 3e. Hub Pings repost trigger: ping_shared
CREATE OR REPLACE FUNCTION public.trg_hub_pings_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ping_author uuid;
BEGIN
  SELECT p.user_id INTO v_ping_author
  FROM public.pings p
  WHERE p.id = NEW.ping_id;

  PERFORM public._emit_economic_event_internal(
    'ping_shared',
    'referral',
    NEW.added_by,
    v_ping_author,
    'ping',
    NEW.ping_id::text,
    'hub_repost',
    '{}'::jsonb,
    'system_observed',
    'hub_share:' || NEW.hub_id::text || ':' || NEW.ping_id::text,
    jsonb_build_object('channel', 'hub_repost', 'hub_id', NEW.hub_id::text, 'intent', NEW.intent)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hub_pings_economic_events ON public.hub_pings;
CREATE TRIGGER hub_pings_economic_events
  AFTER INSERT ON public.hub_pings
  FOR EACH ROW EXECUTE FUNCTION public.trg_hub_pings_economic_events();

-- 3f. Moment repings trigger: ping_shared
CREATE OR REPLACE FUNCTION public.trg_moment_repings_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author uuid;
BEGIN
  SELECT m.author_id INTO v_author
  FROM public.moments m
  WHERE m.id = NEW.moment_id;

  PERFORM public._emit_economic_event_internal(
    'ping_shared',
    'referral',
    NEW.user_id,
    v_author,
    'moment',
    NEW.moment_id::text,
    'moment_reping',
    '{}'::jsonb,
    'system_observed',
    'moment_reping:' || NEW.moment_id::text || ':' || NEW.user_id::text,
    jsonb_build_object('channel', 'moment_reping', 'audience', NEW.audience)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moment_repings_economic_events ON public.moment_repings;
CREATE TRIGGER moment_repings_economic_events
  AFTER INSERT ON public.moment_repings
  FOR EACH ROW EXECUTE FUNCTION public.trg_moment_repings_economic_events();

-- 3g. Private messages trigger: meaningful_conversation_started (strictly ZERO message content!)
CREATE OR REPLACE FUNCTION public.trg_private_messages_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_type text := 'direct';
  v_other_sender uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Only emit when a second distinct participant replies in the conversation
  SELECT pm.sender_id INTO v_other_sender
  FROM public.private_messages pm
  WHERE pm.conversation_id = NEW.conversation_id
    AND pm.sender_id <> NEW.sender_id
    AND pm.deleted_at IS NULL
  ORDER BY pm.created_at ASC
  LIMIT 1;

  IF v_other_sender IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.type INTO v_conv_type FROM public.conversations c WHERE c.id = NEW.conversation_id;

  PERFORM public._emit_economic_event_internal(
    'meaningful_conversation_started',
    'engagement',
    NEW.sender_id,
    v_other_sender,
    'conversation',
    NEW.conversation_id::text,
    'direct_message',
    '{}'::jsonb,
    'system_observed',
    'conv_meaningful:' || NEW.conversation_id::text,
    jsonb_build_object('conversation_type', coalesce(v_conv_type, 'direct'), 'interaction', 'two_way_reply')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS private_messages_economic_events ON public.private_messages;
CREATE TRIGGER private_messages_economic_events
  AFTER INSERT ON public.private_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_private_messages_economic_events();

-- 3h. Community joined trigger: active hub memberships only (never pending requests)
CREATE OR REPLACE FUNCTION public.trg_hub_members_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_owner uuid;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    RETURN NEW;
  END IF;

  SELECT h.owner_id INTO v_hub_owner FROM public.hubs h WHERE h.id = NEW.hub_id;

  PERFORM public._emit_economic_event_internal(
    'community_joined',
    'engagement',
    NEW.user_id,
    CASE WHEN v_hub_owner <> NEW.user_id THEN v_hub_owner ELSE NULL END,
    'hub',
    NEW.hub_id::text,
    'hub_membership',
    '{}'::jsonb,
    'system_observed',
    'community_joined:' || NEW.hub_id::text || ':' || NEW.user_id::text,
    jsonb_build_object('role', NEW.role)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hub_members_economic_events ON public.hub_members;
CREATE TRIGGER hub_members_economic_events
  AFTER INSERT OR UPDATE ON public.hub_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_hub_members_economic_events();

-- 3i. DOT transactions trigger: log virtual credits cleanly as credit_activity (NOT cash revenue)
CREATE OR REPLACE FUNCTION public.trg_dot_transactions_economic_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._emit_economic_event_internal(
    CASE WHEN NEW.amount >= 0 THEN 'dot_credit_earned' ELSE 'dot_credit_redeemed' END,
    'credit_activity',
    NEW.user_id,
    NULL,
    'dot_transaction',
    NEW.id::text,
    NEW.source,
    '{}'::jsonb,
    'system_observed',
    'dot_tx:' || NEW.id::text,
    jsonb_build_object(
      'tx_type', NEW.tx_type,
      'source', NEW.source,
      'credits_delta', NEW.amount,
      'currency', 'DOT_CREDIT',
      'is_cash_revenue', false
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dot_transactions_economic_events ON public.dot_transactions;
CREATE TRIGGER dot_transactions_economic_events
  AFTER INSERT ON public.dot_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_dot_transactions_economic_events();

-- ------------------------------------------------------------------------------
-- 4. Hardened Client-Observable & Server Settlement RPCs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_network_event(
  _event_type text,
  _target_type text DEFAULT NULL,
  _target_id text DEFAULT NULL,
  _source text DEFAULT 'web_app',
  _attribution jsonb DEFAULT '{}'::jsonb,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _dedupe_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_category text;
  v_tier text := 'client_observed';
  v_subject uuid := NULL;
  v_ping_id uuid;
  v_ping record;
  v_target_uuid uuid;
  v_source text := left(coalesce(nullif(btrim(_source), ''), 'web_app'), 64);
  v_dedupe text := nullif(btrim(_dedupe_key), '');
  v_clean_attr jsonb;
  v_clean_meta jsonb;
  v_forbidden_keys constant text[] := ARRAY[
    'amount', 'amount_minor', 'gross_amount', 'gross_amount_minor',
    'platform_fee_minor', 'net_amount', 'net_amount_minor',
    'revenue', 'price', 'currency', 'verified', 'verification_tier',
    'settlement_status', 'settled', 'content', 'message', 'private_message',
    'email', 'password', 'passwd', 'token', 'access_token', 'refresh_token',
    'secret', 'api_key', 'apikey', 'handle'
  ];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to record network events'
      USING ERRCODE = '42501';
  END IF;

  -- Reject any attempt by clients to fabricate verified outcomes, revenue, credits, or trigger-only events
  IF _event_type NOT IN ('first_meaningful_session', 'ping_shared', 'business_lead_generated') THEN
    RAISE EXCEPTION 'Forbidden or server-only event type: %', coalesce(_event_type, 'null')
      USING ERRCODE = '42501';
  END IF;

  -- Ensure caller profile exists cleanly
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller) THEN
    PERFORM public.ensure_my_profile();
  END IF;

  v_category := CASE _event_type
    WHEN 'first_meaningful_session' THEN 'activation'
    WHEN 'ping_shared' THEN 'referral'
    WHEN 'business_lead_generated' THEN 'lead'
  END;

  IF _event_type = 'first_meaningful_session' THEN
    v_dedupe := 'first_meaningful_session:' || v_caller::text;
    v_tier := 'system_observed';
    _target_type := 'profile';
    _target_id := v_caller::text;
  ELSIF v_dedupe IS NOT NULL THEN
    -- Namespace caller-provided dedupe keys by caller ID so one user cannot collide with another
    v_dedupe := left(v_caller::text || ':' || v_dedupe, 180);
  END IF;

  -- Resolve & authorize target entity server-side
  IF _target_type = 'ping' AND nullif(btrim(_target_id), '') IS NOT NULL THEN
    BEGIN
      v_ping_id := _target_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid target ping identifier';
    END;

    SELECT p.id, p.user_id, p.hidden_at, p.visibility
    INTO v_ping
    FROM public.pings p
    WHERE p.id = v_ping_id;

    IF v_ping.id IS NULL OR v_ping.hidden_at IS NOT NULL THEN
      RAISE EXCEPTION 'Target ping is unavailable';
    END IF;

    IF v_ping.visibility = 'hub' AND NOT EXISTS (
      SELECT 1
      FROM public.hub_pings hp
      WHERE hp.ping_id = v_ping.id
        AND hp.removed_at IS NULL
        AND public.can_view_hub_content(hp.hub_id)
    ) THEN
      RAISE EXCEPTION 'Forbidden: cannot attribute private hub Ping'
        USING ERRCODE = '42501';
    END IF;

    v_subject := v_ping.user_id;
    v_tier := 'system_observed';

    IF _event_type = 'business_lead_generated' AND v_subject = v_caller THEN
      RAISE EXCEPTION 'Cannot record a business lead against your own Ping';
    END IF;
  ELSIF _target_type = 'profile' AND nullif(btrim(_target_id), '') IS NOT NULL THEN
    BEGIN
      v_target_uuid := _target_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid target profile identifier';
    END;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_target_uuid) THEN
      RAISE EXCEPTION 'Target profile does not exist';
    END IF;

    IF _event_type = 'business_lead_generated' THEN
      IF v_target_uuid = v_caller THEN
        RAISE EXCEPTION 'Cannot record a business lead against your own profile';
      END IF;
      v_subject := v_target_uuid;
      v_tier := 'system_observed';
    END IF;
  END IF;

  -- Scrub any disallowed monetary or PII keys
  v_clean_attr := coalesce(_attribution, '{}'::jsonb) - v_forbidden_keys;
  v_clean_meta := coalesce(_metadata, '{}'::jsonb) - v_forbidden_keys;

  IF pg_column_size(v_clean_attr) > 2048 OR pg_column_size(v_clean_meta) > 4096 THEN
    RAISE EXCEPTION 'Event metadata exceeds size limit';
  END IF;

  RETURN public._emit_economic_event_internal(
    _event_type,
    v_category,
    v_caller,
    v_subject,
    nullif(btrim(_target_type), ''),
    nullif(btrim(_target_id), ''),
    v_source,
    v_clean_attr,
    v_tier,
    v_dedupe,
    v_clean_meta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_network_event(text, text, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_network_event(text, text, text, text, jsonb, jsonb, text)
  TO authenticated;

-- Server-only settlement confirmation RPC (Stripe/Paystack webhooks, backend settlement workers)
CREATE OR REPLACE FUNCTION public.record_verified_economic_outcome(
  _outcome_type text,
  _payer_user_id uuid,
  _beneficiary_user_id uuid,
  _currency char(3),
  _gross_amount_minor bigint,
  _platform_fee_minor bigint DEFAULT 0,
  _provider text DEFAULT 'stripe',
  _external_reference text DEFAULT NULL,
  _settlement_status text DEFAULT 'settled',
  _lead_event_id uuid DEFAULT NULL,
  _target_type text DEFAULT NULL,
  _target_id text DEFAULT NULL,
  _verified_by text DEFAULT 'settlement_webhook',
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_currency char(3) := upper(btrim(_currency))::char(3);
  v_outcome_id uuid;
  v_actor uuid;
BEGIN
  IF auth.uid() IS NOT NULL OR current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Forbidden: verified economic outcomes may only be confirmed by authorized server processes'
      USING ERRCODE = '42501';
  END IF;

  IF v_currency = 'DOT' OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Invalid cash currency (DOT virtual credits cannot settle as cash revenue)';
  END IF;

  IF _external_reference IS NULL OR char_length(btrim(_external_reference)) < 2 THEN
    RAISE EXCEPTION 'External payment reference is required';
  END IF;

  INSERT INTO public.verified_economic_outcomes (
    outcome_type,
    settlement_status,
    payer_user_id,
    beneficiary_user_id,
    currency,
    gross_amount_minor,
    platform_fee_minor,
    provider,
    external_reference,
    lead_event_id,
    target_type,
    target_id,
    verified_at,
    verified_by,
    metadata
  )
  VALUES (
    _outcome_type,
    _settlement_status,
    _payer_user_id,
    _beneficiary_user_id,
    v_currency,
    _gross_amount_minor,
    coalesce(_platform_fee_minor, 0),
    _provider,
    btrim(_external_reference),
    _lead_event_id,
    nullif(btrim(_target_type), ''),
    nullif(btrim(_target_id), ''),
    CASE WHEN _settlement_status = 'settled' THEN now() ELSE NULL END,
    btrim(_verified_by),
    coalesce(_metadata, '{}'::jsonb)
  )
  ON CONFLICT (provider, external_reference) DO UPDATE
    SET
      settlement_status = EXCLUDED.settlement_status,
      verified_at = coalesce(verified_economic_outcomes.verified_at, EXCLUDED.verified_at),
      metadata = coalesce(verified_economic_outcomes.metadata, '{}'::jsonb) || EXCLUDED.metadata
  RETURNING id INTO v_outcome_id;

  IF _settlement_status = 'settled' THEN
    v_actor := coalesce(_payer_user_id, _beneficiary_user_id);
    PERFORM public._emit_economic_event_internal(
      'transaction_completed',
      'verified_outcome',
      v_actor,
      _beneficiary_user_id,
      'settlement',
      v_outcome_id::text,
      _provider,
      '{}'::jsonb,
      'server_verified',
      'verified_tx:' || v_outcome_id::text,
      jsonb_build_object(
        'outcome_type', _outcome_type,
        'currency', v_currency,
        'gross_amount_minor', _gross_amount_minor,
        'net_amount_minor', _gross_amount_minor - coalesce(_platform_fee_minor, 0),
        'is_cash_revenue', true
      )
    );
  END IF;

  RETURN v_outcome_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_verified_economic_outcome(
  text, uuid, uuid, char, bigint, bigint, text, text, text, uuid, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_economic_outcome(
  text, uuid, uuid, char, bigint, bigint, text, text, text, uuid, text, text, text, jsonb
) TO service_role;

-- Owner-scoped privacy-preserving economic & conversion summary
CREATE OR REPLACE FUNCTION public.get_creator_economic_summary(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_days integer := least(greatest(coalesce(_days, 30), 7), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_pings_published integer := 0;
  v_connections_created integer := 0;
  v_communities_joined integer := 0;
  v_meaningful_convs integer := 0;
  v_shares_received integer := 0;
  v_shares_initiated integer := 0;
  v_leads_received integer := 0;
  v_leads_initiated integer := 0;
  v_dot_earned integer := 0;
  v_dot_redeemed integer := 0;
  v_dot_upgrades integer := 0;
  v_verified_tx_count integer := 0;
  v_verified_net_minor bigint := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*) FILTER (WHERE actor_user_id = v_caller AND event_type = 'ping_published'),
    count(*) FILTER (WHERE actor_user_id = v_caller AND event_type = 'connection_created'),
    count(*) FILTER (WHERE actor_user_id = v_caller AND event_type = 'community_joined'),
    count(*) FILTER (WHERE subject_user_id = v_caller AND event_type = 'ping_shared'),
    count(*) FILTER (WHERE actor_user_id = v_caller AND event_type = 'ping_shared'),
    count(*) FILTER (WHERE subject_user_id = v_caller AND event_type = 'business_lead_generated'),
    count(*) FILTER (WHERE actor_user_id = v_caller AND event_type = 'business_lead_generated')
  INTO
    v_pings_published,
    v_connections_created,
    v_communities_joined,
    v_shares_received,
    v_shares_initiated,
    v_leads_received,
    v_leads_initiated
  FROM public.economic_events
  WHERE created_at >= v_since
    AND (actor_user_id = v_caller OR subject_user_id = v_caller);

  SELECT count(*) INTO v_meaningful_convs
  FROM public.economic_events e
  WHERE e.event_type = 'meaningful_conversation_started'
    AND e.created_at >= v_since
    AND e.target_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = e.target_id::uuid
        AND cm.user_id = v_caller
    );

  SELECT
    coalesce(sum(amount) FILTER (WHERE amount > 0), 0),
    coalesce(sum(-amount) FILTER (WHERE amount < 0), 0),
    count(*) FILTER (WHERE tx_type = 'upgrade')
  INTO v_dot_earned, v_dot_redeemed, v_dot_upgrades
  FROM public.dot_transactions
  WHERE user_id = v_caller
    AND created_at >= v_since;

  SELECT
    count(*),
    coalesce(sum(net_amount_minor), 0)
  INTO v_verified_tx_count, v_verified_net_minor
  FROM public.verified_economic_outcomes
  WHERE beneficiary_user_id = v_caller
    AND settlement_status = 'settled'
    AND created_at >= v_since;

  RETURN jsonb_build_object(
    'days', v_days,
    'engagement', jsonb_build_object(
      'pings_published', v_pings_published,
      'connections_created', v_connections_created,
      'meaningful_conversations', v_meaningful_convs,
      'communities_joined', v_communities_joined
    ),
    'referrals', jsonb_build_object(
      'shares_received', v_shares_received,
      'shares_initiated', v_shares_initiated
    ),
    'leads', jsonb_build_object(
      'leads_received', v_leads_received,
      'leads_initiated', v_leads_initiated
    ),
    'dot_credits', jsonb_build_object(
      'is_cash_revenue', false,
      'currency', 'DOT_CREDIT',
      'earned', v_dot_earned,
      'redeemed', v_dot_redeemed,
      'upgrades_count', v_dot_upgrades
    ),
    'verified_outcomes', jsonb_build_object(
      'is_cash_revenue', true,
      'settled_transactions_count', v_verified_tx_count,
      'verified_net_amount_minor', v_verified_net_minor
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_creator_economic_summary(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_economic_summary(integer) TO authenticated;

-- Admin / Platform 7-Pillar Dashboard Foundation Readiness Summary (service_role only)
CREATE OR REPLACE FUNCTION public.admin_economic_readiness(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := least(greatest(coalesce(_days, 30), 7), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_accounts_total bigint := 0;
  v_accounts_window bigint := 0;
  v_onboarding_completed bigint := 0;
  v_profile_completed bigint := 0;
  v_first_sessions bigint := 0;
  v_multi_day_retained_actors bigint := 0;
  v_pings_published bigint := 0;
  v_connections_created bigint := 0;
  v_meaningful_convs bigint := 0;
  v_communities_joined bigint := 0;
  v_shares_count bigint := 0;
  v_leads_count bigint := 0;
  v_dot_earned bigint := 0;
  v_dot_redeemed bigint := 0;
  v_dot_upgrades bigint := 0;
  v_verified_settled_count bigint := 0;
  v_verified_gross_minor bigint := 0;
  v_segments jsonb := '{}'::jsonb;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_accounts_total FROM public.profiles;

  SELECT
    count(*) FILTER (WHERE event_type = 'account_created'),
    count(*) FILTER (WHERE event_type = 'onboarding_completed'),
    count(*) FILTER (WHERE event_type = 'profile_completed'),
    count(*) FILTER (WHERE event_type = 'first_meaningful_session'),
    count(*) FILTER (WHERE event_type = 'ping_published'),
    count(*) FILTER (WHERE event_type = 'connection_created'),
    count(*) FILTER (WHERE event_type = 'meaningful_conversation_started'),
    count(*) FILTER (WHERE event_type = 'community_joined'),
    count(*) FILTER (WHERE event_type = 'ping_shared'),
    count(*) FILTER (WHERE event_type = 'business_lead_generated')
  INTO
    v_accounts_window,
    v_onboarding_completed,
    v_profile_completed,
    v_first_sessions,
    v_pings_published,
    v_connections_created,
    v_meaningful_convs,
    v_communities_joined,
    v_shares_count,
    v_leads_count
  FROM public.economic_events
  WHERE created_at >= v_since;

  SELECT count(*) INTO v_multi_day_retained_actors
  FROM (
    SELECT actor_user_id
    FROM public.economic_events
    WHERE actor_user_id IS NOT NULL
      AND created_at >= v_since
    GROUP BY actor_user_id
    HAVING count(DISTINCT date_trunc('day', created_at AT TIME ZONE 'UTC')) >= 2
  ) r;

  SELECT
    coalesce(sum(amount) FILTER (WHERE amount > 0), 0),
    coalesce(sum(-amount) FILTER (WHERE amount < 0), 0),
    count(*) FILTER (WHERE tx_type = 'upgrade')
  INTO v_dot_earned, v_dot_redeemed, v_dot_upgrades
  FROM public.dot_transactions
  WHERE created_at >= v_since;

  SELECT
    count(*),
    coalesce(sum(gross_amount_minor), 0)
  INTO v_verified_settled_count, v_verified_gross_minor
  FROM public.verified_economic_outcomes
  WHERE settlement_status = 'settled'
    AND created_at >= v_since;

  SELECT coalesce(
    jsonb_object_agg(seg, cnt),
    '{}'::jsonb
  ) INTO v_segments
  FROM (
    SELECT seg, count(DISTINCT actor_user_id) AS cnt
    FROM public.economic_events, unnest(actor_segments) AS seg
    WHERE created_at >= v_since
      AND actor_user_id IS NOT NULL
    GROUP BY seg
  ) s;

  RETURN jsonb_build_object(
    'days', v_days,
    'acquisition', jsonb_build_object(
      'accounts_total', v_accounts_total,
      'accounts_window', v_accounts_window
    ),
    'activation', jsonb_build_object(
      'onboarding_completed', v_onboarding_completed,
      'profile_completed', v_profile_completed,
      'first_meaningful_sessions', v_first_sessions
    ),
    'retention', jsonb_build_object(
      'multi_day_active_actors', v_multi_day_retained_actors
    ),
    'engagement', jsonb_build_object(
      'pings_published', v_pings_published,
      'connections_created', v_connections_created,
      'meaningful_conversations', v_meaningful_convs,
      'communities_joined', v_communities_joined
    ),
    'referrals', jsonb_build_object(
      'shares_recorded', v_shares_count
    ),
    'monetization', jsonb_build_object(
      'business_leads', v_leads_count,
      'dot_credits_earned', v_dot_earned,
      'dot_credits_redeemed', v_dot_redeemed,
      'dot_credit_upgrades', v_dot_upgrades
    ),
    'verified_outcomes', jsonb_build_object(
      'settled_transactions', v_verified_settled_count,
      'settled_gross_amount_minor', v_verified_gross_minor,
      'dot_excluded_from_cash', true
    ),
    'segments', v_segments,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_economic_readiness(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_economic_readiness(integer) TO service_role;

-- ------------------------------------------------------------------------------
-- 5. Safe Idempotent Backfill for Existing Profiles & Active Communities
-- ------------------------------------------------------------------------------
INSERT INTO public.economic_events (
  event_type,
  event_category,
  actor_user_id,
  target_type,
  target_id,
  source,
  actor_segments,
  verification_tier,
  dedupe_key,
  created_at
)
SELECT
  'account_created',
  'acquisition',
  p.id,
  'profile',
  p.id::text,
  'backfill_profiles',
  coalesce(p.participation_pathways, '{}'::text[]),
  'system_observed',
  'account_created:' || p.id::text,
  p.created_at
FROM public.profiles p
ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

INSERT INTO public.economic_events (
  event_type,
  event_category,
  actor_user_id,
  target_type,
  target_id,
  source,
  actor_segments,
  verification_tier,
  dedupe_key,
  created_at
)
SELECT
  'onboarding_completed',
  'activation',
  p.id,
  'profile',
  p.id::text,
  'backfill_profiles',
  coalesce(p.participation_pathways, '{}'::text[]),
  'system_observed',
  'onboarding_completed:' || p.id::text,
  p.onboarding_completed_at
FROM public.profiles p
WHERE p.onboarding_completed_at IS NOT NULL
ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
