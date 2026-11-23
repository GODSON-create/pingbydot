-- 0031_phase4_business_commerce_ads_and_wallet.sql
-- Phase 4: Business Profiles & Storefronts, Multi-Agent Business Inbox & CRM,
-- Creator Commercial Profiles, Controlled Advertising Foundation, Paid Hub Plans,
-- and Server-Verified Idempotent DOT Wallet Settlement.
-- Forward-only, idempotent, strict RLS (zero open USING (true) policies).

-- ============================================================================
-- 1. BUSINESS & ORGANISATION PROFILES + TEAM ROLES (Phase 4.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.business_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  category text NOT NULL DEFAULT 'services' CHECK (char_length(trim(category)) BETWEEN 2 AND 60),
  tagline text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  logo_url text,
  cover_url text,
  location text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  website_url text,
  contact_email text,
  contact_phone text,
  business_hours text NOT NULL DEFAULT 'Mon–Fri 9:00 AM – 5:00 PM',
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  auto_reply_message text NOT NULL DEFAULT 'Thanks for reaching out! A team member will respond shortly.',
  merchant_disclosure text NOT NULL DEFAULT 'Products and services listed here are fulfilled directly by this business. Ping is not the merchant of record.',
  verified_status text NOT NULL DEFAULT 'unverified' CHECK (verified_status IN ('unverified', 'pending', 'verified')),
  whatsapp_business_connected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_profiles_owner_idx ON public.business_profiles (owner_id);
CREATE INDEX IF NOT EXISTS business_profiles_category_idx ON public.business_profiles (category, created_at DESC);

CREATE TABLE IF NOT EXISTS public.business_team_members (
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent', 'analyst')),
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS business_team_user_idx ON public.business_team_members (user_id);

CREATE OR REPLACE FUNCTION public.is_business_member(
  _business_id uuid,
  _user_id uuid DEFAULT auth.uid(),
  _roles text[] DEFAULT ARRAY['owner', 'admin', 'agent', 'analyst']::text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF _user_id IS NULL OR _user_id <> auth.uid() THEN
    RAISE EXCEPTION 'cannot inspect another user''s business membership';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.business_profiles bp
    WHERE bp.id = _business_id AND bp.owner_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.business_team_members btm
    WHERE btm.business_id = _business_id
      AND btm.user_id = _user_id
      AND btm.role = ANY(_roles)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_business_member(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid, uuid, text[]) TO authenticated;

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business profiles publicly readable" ON public.business_profiles;
CREATE POLICY "Business profiles publicly readable" ON public.business_profiles
  FOR SELECT TO anon, authenticated
  USING (char_length(slug) >= 3);

DROP POLICY IF EXISTS "Authenticated users create own business profile" ON public.business_profiles;
CREATE POLICY "Authenticated users create own business profile" ON public.business_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id AND verified_status = 'unverified');

DROP POLICY IF EXISTS "Business owners and admins update business profile" ON public.business_profiles;
CREATE POLICY "Business owners and admins update business profile" ON public.business_profiles
  FOR UPDATE TO authenticated
  USING (public.is_business_member(id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  WITH CHECK (public.is_business_member(id, auth.uid(), ARRAY['owner', 'admin']::text[]));

DROP POLICY IF EXISTS "Business team members read roster" ON public.business_team_members;
CREATE POLICY "Business team members read roster" ON public.business_team_members
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id, auth.uid()));

DROP POLICY IF EXISTS "Business owners and admins manage roster" ON public.business_team_members;
CREATE POLICY "Business owners and admins manage roster" ON public.business_team_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]));

DROP POLICY IF EXISTS "Business owners and admins remove roster members" ON public.business_team_members;
CREATE POLICY "Business owners and admins remove roster members" ON public.business_team_members
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[])
  );

-- ============================================================================
-- 2. BUSINESS STOREFRONTS: CATALOGUE & CUSTOMER REVIEWS (Phase 4.2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.business_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'service' CHECK (kind IN ('product', 'service')),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 140),
  description text NOT NULL DEFAULT '',
  price_display text NOT NULL DEFAULT 'Contact for pricing',
  currency text NOT NULL DEFAULT 'USD',
  media_urls text[] NOT NULL DEFAULT '{}'::text[],
  booking_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_offerings_business_idx ON public.business_offerings (business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.business_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS business_reviews_business_idx ON public.business_reviews (business_id, created_at DESC);

ALTER TABLE public.business_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active business offerings readable" ON public.business_offerings;
CREATE POLICY "Active business offerings readable" ON public.business_offerings
  FOR SELECT TO anon, authenticated
  USING (
    status = 'active'
    OR (auth.uid() IS NOT NULL AND public.is_business_member(business_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Business staff insert offerings" ON public.business_offerings;
CREATE POLICY "Business staff insert offerings" ON public.business_offerings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]));

DROP POLICY IF EXISTS "Business staff update offerings" ON public.business_offerings;
CREATE POLICY "Business staff update offerings" ON public.business_offerings
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  WITH CHECK (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]));

DROP POLICY IF EXISTS "Business reviews publicly readable" ON public.business_reviews;
CREATE POLICY "Business reviews publicly readable" ON public.business_reviews
  FOR SELECT TO anon, authenticated
  USING (rating BETWEEN 1 AND 5);

DROP POLICY IF EXISTS "Authenticated users write non-self business reviews" ON public.business_reviews;
CREATE POLICY "Authenticated users write non-self business reviews" ON public.business_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = reviewer_id
    AND NOT public.is_business_member(business_id, auth.uid())
  );

DROP POLICY IF EXISTS "Reviewers delete own business reviews" ON public.business_reviews;
CREATE POLICY "Reviewers delete own business reviews" ON public.business_reviews
  FOR DELETE TO authenticated
  USING (auth.uid() = reviewer_id);

-- ============================================================================
-- 3. BUSINESS MULTI-AGENT INBOX, SAVED REPLIES & LEAD CRM (Phase 4.3 & 4.6)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.business_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  offering_id uuid REFERENCES public.business_offerings(id) ON DELETE SET NULL,
  enquiry_type text NOT NULL DEFAULT 'general'
    CHECK (enquiry_type IN ('general', 'product_enquiry', 'appointment_booking', 'partnership', 'support')),
  subject text NOT NULL CHECK (char_length(trim(subject)) BETWEEN 2 AND 160),
  message text NOT NULL CHECK (char_length(trim(message)) BETWEEN 5 AND 3000),
  preferred_date text,
  lead_status text NOT NULL DEFAULT 'new'
    CHECK (lead_status IN ('new', 'qualified', 'in_progress', 'won', 'lost', 'closed')),
  assigned_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  labels text[] NOT NULL DEFAULT '{}'::text[],
  internal_notes text NOT NULL DEFAULT '',
  reply_message text,
  first_response_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_enquiries_business_status_idx
  ON public.business_enquiries (business_id, lead_status, created_at DESC);
CREATE INDEX IF NOT EXISTS business_enquiries_customer_idx
  ON public.business_enquiries (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.business_saved_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  shortcut text NOT NULL CHECK (char_length(trim(shortcut)) BETWEEN 2 AND 32),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 80),
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 2 AND 2000),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_saved_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers and business team read enquiries" ON public.business_enquiries;
CREATE POLICY "Customers and business team read enquiries" ON public.business_enquiries
  FOR SELECT TO authenticated
  USING (
    auth.uid() = customer_id
    OR public.is_business_member(business_id, auth.uid())
  );

DROP POLICY IF EXISTS "Customers create business enquiries" ON public.business_enquiries;
CREATE POLICY "Customers create business enquiries" ON public.business_enquiries
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_id AND lead_status = 'new');

DROP POLICY IF EXISTS "Business agents update enquiries" ON public.business_enquiries;
CREATE POLICY "Business agents update enquiries" ON public.business_enquiries
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin', 'agent']::text[]))
  WITH CHECK (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin', 'agent']::text[]));

DROP POLICY IF EXISTS "Business team read saved replies" ON public.business_saved_replies;
CREATE POLICY "Business team read saved replies" ON public.business_saved_replies
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id, auth.uid()));

DROP POLICY IF EXISTS "Business agents manage saved replies" ON public.business_saved_replies;
CREATE POLICY "Business agents manage saved replies" ON public.business_saved_replies
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin', 'agent']::text[])
  );

DROP POLICY IF EXISTS "Business agents delete saved replies" ON public.business_saved_replies;
CREATE POLICY "Business agents delete saved replies" ON public.business_saved_replies
  FOR DELETE TO authenticated
  USING (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin', 'agent']::text[]));

-- ============================================================================
-- 4. CREATOR COMMERCIAL PROFILES & CONTROLLED ADVERTISING (Phase 4.7 & 4.8)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.creator_commercial_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  open_for_sponsorships boolean NOT NULL DEFAULT false,
  open_for_brand_deals boolean NOT NULL DEFAULT false,
  portfolio_summary text NOT NULL DEFAULT '',
  rate_card_notes text NOT NULL DEFAULT '',
  enquiry_email text,
  media_kit_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creator_commercial_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Creator commercial profiles readable" ON public.creator_commercial_profiles;
CREATE POLICY "Creator commercial profiles readable" ON public.creator_commercial_profiles
  FOR SELECT TO anon, authenticated
  USING (open_for_sponsorships = true OR open_for_brand_deals = true OR (auth.uid() IS NOT NULL AND auth.uid() = user_id));

DROP POLICY IF EXISTS "Creators manage own commercial profile" ON public.creator_commercial_profiles;
CREATE POLICY "Creators manage own commercial profile" ON public.creator_commercial_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Creators update own commercial profile" ON public.creator_commercial_profiles;
CREATE POLICY "Creators update own commercial profile" ON public.creator_commercial_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placement text NOT NULL CHECK (placement IN ('sponsored_ping', 'sponsored_signal', 'sponsored_hub')),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 4 AND 140),
  target_url text,
  target_regions text[] NOT NULL DEFAULT ARRAY['GLOBAL']::text[],
  target_interests text[] NOT NULL DEFAULT '{}'::text[],
  budget_currency text NOT NULL DEFAULT 'USD',
  budget_minor integer NOT NULL CHECK (budget_minor >= 100),
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_policy_review', 'paused', 'rejected', 'completed')),
  billing_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 160),
  details text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business team and admins view ad campaigns" ON public.ad_campaigns;
CREATE POLICY "Business team and admins view ad campaigns" ON public.ad_campaigns
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id, auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Business admins draft unapproved ad campaigns" ON public.ad_campaigns;
CREATE POLICY "Business admins draft unapproved ad campaigns" ON public.ad_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND billing_approved = false
    AND status IN ('draft', 'pending_policy_review')
    AND public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[])
  );

DROP POLICY IF EXISTS "Business admins update draft ad campaigns" ON public.ad_campaigns;
CREATE POLICY "Business admins update draft ad campaigns" ON public.ad_campaigns
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id, auth.uid(), ARRAY['owner', 'admin']::text[]))
  WITH CHECK (
    billing_approved = false
    AND status IN ('draft', 'pending_policy_review', 'paused')
  );

DROP POLICY IF EXISTS "Reporters and admins read ad reports" ON public.ad_reports;
CREATE POLICY "Reporters and admins read ad reports" ON public.ad_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users file ad reports" ON public.ad_reports;
CREATE POLICY "Authenticated users file ad reports" ON public.ad_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- ============================================================================
-- 5. PAID COMMUNITY PLANS FOUNDATION (Phase 4.10)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '',
  plan_type text NOT NULL DEFAULT 'free'
    CHECK (plan_type IN ('free', 'paid_planned', 'institutional', 'sponsorship')),
  price_display text NOT NULL DEFAULT 'Free',
  billing_interval text NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly', 'annual', 'one_time', 'free')),
  live_checkout_enabled boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hub_membership_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hub membership plans readable" ON public.hub_membership_plans;
CREATE POLICY "Hub membership plans readable" ON public.hub_membership_plans
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hubs h WHERE h.id = hub_membership_plans.hub_id AND h.access = 'public')
    OR (auth.uid() IS NOT NULL AND created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Hub owners create planned membership tiers" ON public.hub_membership_plans;
CREATE POLICY "Hub owners create planned membership tiers" ON public.hub_membership_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND live_checkout_enabled = false
    AND EXISTS (SELECT 1 FROM public.hubs h WHERE h.id = hub_membership_plans.hub_id AND h.owner_id = auth.uid())
  );

-- ============================================================================
-- 6. DOT WALLET TOP-UP LIMITS, SERVER-ONLY SETTLEMENT & REVERSALS (Phase 4.9)
-- ============================================================================

ALTER TABLE public.dot_topup_intents
  ADD COLUMN IF NOT EXISTS receipt_number text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS verified_by_webhook boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.create_dot_topup_intent(
  p_dot_amount integer,
  p_rail text DEFAULT 'paystack',
  p_currency text DEFAULT 'NGN',
  p_fiat_amount_minor integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pending_count integer;
  v_ref text;
  v_row public.dot_topup_intents%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_dot_amount < 10 OR p_dot_amount > 100000 THEN
    RAISE EXCEPTION 'Top-up amount must be between 10 and 100,000 DOT per transaction';
  END IF;
  IF p_rail NOT IN ('paystack', 'crypto_pending') THEN
    RAISE EXCEPTION 'Unsupported payment rail';
  END IF;

  -- Fraud & velocity protection: max 5 pending intents per 24 hours
  SELECT count(*)::int INTO v_pending_count
  FROM public.dot_topup_intents
  WHERE user_id = v_uid
    AND status IN ('pending', 'awaiting_verification')
    AND created_at > now() - interval '24 hours';

  IF v_pending_count >= 5 THEN
    RAISE EXCEPTION 'Too many pending top-up requests in the last 24 hours. Please wait or complete an existing checkout.';
  END IF;

  v_ref := 'PINGDOT_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.dot_topup_intents (
    user_id, rail, dot_amount, fiat_currency, fiat_amount_minor, provider_reference, status, receipt_number
  )
  VALUES (
    v_uid,
    p_rail,
    p_dot_amount,
    upper(coalesce(NULLIF(trim(p_currency), ''), 'NGN')),
    p_fiat_amount_minor,
    v_ref,
    'pending',
    'RCPT-' || upper(left(v_ref, 14))
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_dot_topup_intent(integer, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_dot_topup_intent(integer, text, text, integer) TO authenticated;

-- Server-only idempotent settlement RPC (NEVER executable by authenticated/anon clients!)
CREATE OR REPLACE FUNCTION public.settle_dot_topup_intent(
  p_provider_reference text,
  p_provider_event_id text,
  p_verified_amount_minor integer,
  p_currency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent public.dot_topup_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.dot_topup_intents
  WHERE provider_reference = p_provider_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOT top-up intent not found for reference %', p_provider_reference;
  END IF;

  -- Idempotency: if already settled, return safely without double-crediting
  IF v_intent.status = 'settled' THEN
    RETURN jsonb_build_object('status', 'already_settled', 'intent_id', v_intent.id, 'dot_amount', v_intent.dot_amount);
  END IF;

  IF v_intent.fiat_amount_minor IS NOT NULL AND p_verified_amount_minor < v_intent.fiat_amount_minor THEN
    UPDATE public.dot_topup_intents
    SET status = 'failed', updated_at = now(), metadata = metadata || jsonb_build_object('mismatch_minor', p_verified_amount_minor)
    WHERE id = v_intent.id;
    RAISE EXCEPTION 'Verified payment amount is lower than intent amount';
  END IF;

  INSERT INTO public.dot_wallets (user_id, balance, lifetime_earned)
  VALUES (v_intent.user_id, v_intent.dot_amount, v_intent.dot_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = public.dot_wallets.balance + v_intent.dot_amount,
        lifetime_earned = public.dot_wallets.lifetime_earned + v_intent.dot_amount,
        updated_at = now();

  INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)
  VALUES (
    v_intent.user_id,
    v_intent.dot_amount,
    'bonus',
    'paystack_topup',
    p_provider_reference,
    'Verified DOT credit top-up (' || coalesce(v_intent.receipt_number, p_provider_reference) || ')'
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.dot_topup_intents
  SET status = 'settled',
      verified_by_webhook = true,
      fiat_currency = upper(coalesce(p_currency, fiat_currency)),
      updated_at = now(),
      metadata = metadata || jsonb_build_object('provider_event_id', p_provider_event_id)
  WHERE id = v_intent.id;

  RETURN jsonb_build_object('status', 'settled', 'intent_id', v_intent.id, 'dot_amount', v_intent.dot_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_dot_topup_intent(text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_dot_topup_intent(text, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_dot_topup_intent(
  p_provider_reference text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent public.dot_topup_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.dot_topup_intents
  WHERE provider_reference = p_provider_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intent not found';
  END IF;
  IF v_intent.refunded_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_reversed', 'intent_id', v_intent.id);
  END IF;

  IF v_intent.status = 'settled' THEN
    UPDATE public.dot_wallets
    SET balance = greatest(0, balance - v_intent.dot_amount),
        updated_at = now()
    WHERE user_id = v_intent.user_id;

    INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)
    VALUES (
      v_intent.user_id,
      -v_intent.dot_amount,
      'spend',
      'paystack_reversal',
      p_provider_reference || ':rev',
      'DOT top-up reversal: ' || left(coalesce(p_reason, 'refund'), 120)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.dot_topup_intents
  SET status = 'cancelled',
      refunded_at = now(),
      reversal_reason = left(coalesce(p_reason, 'refund'), 200),
      updated_at = now()
  WHERE id = v_intent.id;

  RETURN jsonb_build_object('status', 'reversed', 'intent_id', v_intent.id);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_dot_topup_intent(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_dot_topup_intent(text, text) TO service_role;
