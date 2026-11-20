-- 0033_premium_ux_dot_economy_and_interactions.sql
-- Premium UI/UX Refinement, Verification Expiry & Anti-Impersonation,
-- Configurable DOT Memberships & Subscriptions, Ping/Moment Boosting,
-- DOT Tag System (.tag), and Appearance Preferences Persistence.
-- Forward-only, idempotent, strict RLS (zero open USING (true) policies).

-- ============================================================================
-- 1. APPEARANCE PREFERENCES PERSISTENCE (Section 8)
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS appearance_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================================
-- 2. VERIFICATION EXPIRY, BUSINESS LINKAGE & ANTI-IMPERSONATION (Section 2)
-- ============================================================================

ALTER TABLE public.account_verifications
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_display_name text;

CREATE INDEX IF NOT EXISTS account_verifications_expires_idx
  ON public.account_verifications (expires_at)
  WHERE status = 'verified' AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_public_verification_badges(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity record;
  v_prof record;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object(
      'identity_verified', false,
      'professional_verified', false,
      'professional_pathway', NULL,
      'identity_verified_at', NULL,
      'identity_expires_at', NULL,
      'professional_verified_at', NULL,
      'professional_expires_at', NULL,
      'organization_name', NULL
    );
  END IF;

  SELECT verified_at, expires_at, organization_name
  INTO v_identity
  FROM public.account_verifications
  WHERE user_id = _user_id
    AND verification_domain = 'identity'
    AND status = 'verified'
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  SELECT pathway_type, verified_at, expires_at, organization_name
  INTO v_prof
  FROM public.account_verifications
  WHERE user_id = _user_id
    AND verification_domain = 'professional'
    AND status = 'verified'
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  RETURN jsonb_build_object(
    'identity_verified', v_identity.verified_at IS NOT NULL,
    'professional_verified', v_prof.pathway_type IS NOT NULL,
    'professional_pathway', v_prof.pathway_type,
    'identity_verified_at', v_identity.verified_at,
    'identity_expires_at', v_identity.expires_at,
    'professional_verified_at', v_prof.verified_at,
    'professional_expires_at', v_prof.expires_at,
    'organization_name', coalesce(NULLIF(v_prof.organization_name, ''), NULLIF(v_identity.organization_name, ''))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_verification_badges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_verification_badges(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_verification_request_v2(
  _verification_id uuid,
  _status text,
  _reviewer_note text DEFAULT '',
  _expires_at timestamptz DEFAULT NULL
)
RETURNS public.account_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_existing public.account_verifications;
  v_updated public.account_verifications;
  v_display text;
BEGIN
  IF v_caller IS NULL OR NOT public.is_ping_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;

  IF _status NOT IN ('verified', 'rejected', 'revoked', 'pending') THEN
    RAISE EXCEPTION 'Invalid verification status';
  END IF;

  SELECT * INTO v_existing
  FROM public.account_verifications
  WHERE id = _verification_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found';
  END IF;

  IF _status = 'verified' AND v_existing.user_id = v_caller THEN
    RAISE EXCEPTION 'Administrators cannot approve their own verification request' USING ERRCODE = '42501';
  END IF;

  SELECT display_name INTO v_display FROM public.profiles WHERE id = v_existing.user_id;

  UPDATE public.account_verifications
  SET status = _status,
      reviewer_id = v_caller,
      reviewer_note = left(btrim(coalesce(_reviewer_note, '')), 500),
      reviewed_at = now(),
      verified_at = CASE WHEN _status = 'verified' THEN now() ELSE NULL END,
      expires_at = CASE WHEN _status = 'verified' THEN _expires_at ELSE NULL END,
      verified_display_name = CASE WHEN _status = 'verified' THEN v_display ELSE verified_display_name END,
      updated_at = now()
  WHERE id = _verification_id
  RETURNING * INTO v_updated;

  INSERT INTO public.verification_audit (
    verification_id, user_id, actor_id, verification_domain, pathway_type, previous_status, new_status, reason
  )
  VALUES (
    v_updated.id,
    v_updated.user_id,
    v_caller,
    v_updated.verification_domain,
    v_updated.pathway_type,
    v_existing.status,
    v_updated.status,
    left(btrim(coalesce(_reviewer_note, 'Reviewed by administrator')), 500)
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.review_verification_request_v2(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_verification_request_v2(uuid, text, text, timestamptz) TO authenticated;

-- ============================================================================
-- 3. CONFIGURABLE DOT MEMBERSHIP PLANS, ENTITLEMENTS & RECEIPTS (Section 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.membership_plans (
  slug text PRIMARY KEY CHECK (slug IN ('free', 'plus', 'pro', 'business')),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  badge text NOT NULL CHECK (char_length(trim(badge)) BETWEEN 2 AND 32),
  tagline text NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 240),
  dot_price integer NOT NULL DEFAULT 0 CHECK (dot_price >= 0 AND dot_price <= 100000),
  duration_days integer NOT NULL DEFAULT 30 CHECK (duration_days BETWEEN 0 AND 365),
  benefits jsonb NOT NULL DEFAULT '{}'::jsonb,
  perks text[] NOT NULL DEFAULT '{}'::text[],
  highlighted boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.membership_plans (
  slug, name, badge, tagline, dot_price, duration_days, benefits, perks, highlighted, is_active, sort_order
)
VALUES
  (
    'free',
    'Free',
    'Free',
    'Open access to Pings, Moments, Community Hubs, Signals, and private Direct Messaging.',
    0,
    0,
    '{"max_profile_links":3,"analytics_days":7,"scheduling":false,"premium_stickers":false,"profile_customisation":false,"community_tools":false,"enhanced_business":false}'::jsonb,
    ARRAY[
      'Unlimited public Pings, DOT Tags & branded share cards',
      '24-hour Moments & Profile Highlights',
      'Join public & private Community Hubs',
      '1-to-1 Direct Messaging & Group Conversations'
    ],
    false,
    true,
    0
  ),
  (
    'plus',
    'Plus',
    'Plus',
    'Profile customisation, additional links, scheduled publishing, and extended creator analytics.',
    150,
    30,
    '{"max_profile_links":8,"analytics_days":30,"scheduling":true,"premium_stickers":true,"profile_customisation":true,"community_tools":false,"enhanced_business":false}'::jsonb,
    ARRAY[
      'Custom accent themes & enhanced profile customisation',
      'Up to 8 external profile connections & links',
      'Ping scheduling & 30-day creator analytics history',
      'Premium sticker packs & extended Highlight covers'
    ],
    false,
    true,
    1
  ),
  (
    'pro',
    'Pro',
    'Pro',
    'Complete creator & community toolkit with 90-day insights, priority workflows, and advanced tools.',
    350,
    30,
    '{"max_profile_links":15,"analytics_days":90,"scheduling":true,"premium_stickers":true,"profile_customisation":true,"community_tools":true,"enhanced_business":false}'::jsonb,
    ARRAY[
      'Everything in Plus (strictly separate from identity verification)',
      'Up to 15 profile links & 90-day economic + engagement analytics',
      'Advanced creator tools, scheduling & campaign tracking',
      'Expanded Community Hub governance & event management tools'
    ],
    true,
    true,
    2
  ),
  (
    'business',
    'Business',
    'Business',
    'Enhanced multi-agent Business Inbox tools, team workflows, storefronts, and institutional scale.',
    600,
    30,
    '{"max_profile_links":25,"analytics_days":90,"scheduling":true,"premium_stickers":true,"profile_customisation":true,"community_tools":true,"enhanced_business":true}'::jsonb,
    ARRAY[
      'Everything in Pro plus enhanced multi-agent Business Inbox tools',
      'Expanded storefront catalogue, CRM saved replies & lead exports',
      'Multi-publisher Signal channels & institutional Hub governance',
      'Organizational plan badge (never auto-grants identity verification)'
    ],
    false,
    true,
    3
  )
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.subscription_entitlements (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_slug text NOT NULL REFERENCES public.membership_plans(slug),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  auto_renew boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_slug text NOT NULL REFERENCES public.membership_plans(slug),
  action text NOT NULL CHECK (action IN ('activate', 'renew', 'cancel', 'expire')),
  dot_charged integer NOT NULL DEFAULT 0 CHECK (dot_charged >= 0),
  idempotency_key text UNIQUE,
  receipt_number text NOT NULL,
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end timestamptz,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_receipts_user_idx
  ON public.subscription_receipts (user_id, created_at DESC);

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.membership_plans, public.subscription_entitlements, public.subscription_receipts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.membership_plans TO anon, authenticated;
GRANT SELECT ON public.subscription_entitlements, public.subscription_receipts TO authenticated;

DROP POLICY IF EXISTS "Active membership plans publicly readable" ON public.membership_plans;
CREATE POLICY "Active membership plans publicly readable" ON public.membership_plans
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR (auth.uid() IS NOT NULL AND public.is_ping_admin()));

DROP POLICY IF EXISTS "Users read own subscription entitlements" ON public.subscription_entitlements;
CREATE POLICY "Users read own subscription entitlements" ON public.subscription_entitlements
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_ping_admin());

DROP POLICY IF EXISTS "Users read own subscription receipts" ON public.subscription_receipts;
CREATE POLICY "Users read own subscription receipts" ON public.subscription_receipts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_ping_admin());

-- Authoritative idempotent DOT subscription RPC (reads configurable membership_plans!)
CREATE OR REPLACE FUNCTION public.subscribe_with_dots(
  p_plan_slug text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.membership_plans%ROWTYPE;
  v_wallet public.dot_wallets%ROWTYPE;
  v_existing_receipt public.subscription_receipts%ROWTYPE;
  v_ent public.subscription_entitlements%ROWTYPE;
  v_receipt public.subscription_receipts%ROWTYPE;
  v_now timestamptz := now();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_action text := 'activate';
  v_legacy_tier text;
  v_rcpt_no text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL OR char_length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'Valid idempotency key is required';
  END IF;

  -- Idempotency check BEFORE any balance mutation: never deduct DOT twice
  SELECT * INTO v_existing_receipt
  FROM public.subscription_receipts
  WHERE idempotency_key = p_idempotency_key
    AND user_id = v_uid;

  IF FOUND THEN
    SELECT * INTO v_wallet FROM public.dot_wallets WHERE user_id = v_uid;
    SELECT * INTO v_ent FROM public.subscription_entitlements WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'idempotent_replay', true,
      'wallet', to_jsonb(v_wallet),
      'entitlement', to_jsonb(v_ent),
      'receipt', to_jsonb(v_existing_receipt)
    );
  END IF;

  SELECT * INTO v_plan
  FROM public.membership_plans
  WHERE slug = p_plan_slug AND is_active = true;

  IF NOT FOUND OR v_plan.slug = 'free' THEN
    RAISE EXCEPTION 'Selected membership plan is unavailable';
  END IF;

  -- Ensure wallet row exists and lock FOR UPDATE
  INSERT INTO public.dot_wallets (user_id, balance, lifetime_earned, lifetime_spent)
  VALUES (v_uid, 50, 50, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.dot_wallets
  WHERE user_id = v_uid
  FOR UPDATE;

  IF v_wallet.balance < v_plan.dot_price THEN
    RAISE EXCEPTION 'Insufficient DOT balance: need % DOT, available % DOT', v_plan.dot_price, v_wallet.balance;
  END IF;

  -- Determine whether activating fresh or renewing/extending active period
  SELECT * INTO v_ent FROM public.subscription_entitlements WHERE user_id = v_uid FOR UPDATE;
  IF FOUND AND v_ent.plan_slug = v_plan.slug AND v_ent.status = 'active' AND v_ent.expires_at IS NOT NULL AND v_ent.expires_at > v_now THEN
    v_action := 'renew';
    v_period_start := v_ent.expires_at;
    v_period_end := v_ent.expires_at + make_interval(days => greatest(1, v_plan.duration_days));
  ELSE
    v_action := 'activate';
    v_period_start := v_now;
    v_period_end := v_now + make_interval(days => greatest(1, v_plan.duration_days));
  END IF;

  v_rcpt_no := 'RCPT-SUB-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10));

  -- 1. Debit authoritative DOT wallet ledger
  UPDATE public.dot_wallets
  SET balance = balance - v_plan.dot_price,
      lifetime_spent = lifetime_spent + v_plan.dot_price,
      updated_at = v_now
  WHERE user_id = v_uid
  RETURNING * INTO v_wallet;

  INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, source_ref, description)
  VALUES (
    v_uid,
    -v_plan.dot_price,
    'upgrade',
    'dot_subscription_' || v_plan.slug,
    p_idempotency_key,
    'DOT Membership (' || v_plan.name || ' · ' || v_plan.duration_days || 'd · ' || v_rcpt_no || ')'
  );

  -- 2. Activate separated entitlement record (never touches account_verifications)
  INSERT INTO public.subscription_entitlements (
    user_id, plan_slug, status, auto_renew, started_at, expires_at, cancelled_at, entitlements, updated_at
  )
  VALUES (
    v_uid, v_plan.slug, 'active', false, v_now, v_period_end, NULL, v_plan.benefits, v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan_slug = EXCLUDED.plan_slug,
    status = 'active',
    started_at = CASE WHEN public.subscription_entitlements.plan_slug = EXCLUDED.plan_slug THEN public.subscription_entitlements.started_at ELSE v_now END,
    expires_at = EXCLUDED.expires_at,
    cancelled_at = NULL,
    entitlements = EXCLUDED.entitlements,
    updated_at = v_now
  RETURNING * INTO v_ent;

  -- Mirror to legacy account_subscriptions for seamless compatibility
  v_legacy_tier := CASE WHEN v_plan.slug = 'business' THEN 'institution' ELSE v_plan.slug END;
  INSERT INTO public.account_subscriptions (user_id, tier, status, billing_cycle, started_at, expires_at, updated_at)
  VALUES (v_uid, v_legacy_tier, 'active', 'dot_credits', v_now, v_period_end, v_now)
  ON CONFLICT (user_id) DO UPDATE SET
    tier = EXCLUDED.tier,
    status = 'active',
    billing_cycle = 'dot_credits',
    expires_at = EXCLUDED.expires_at,
    updated_at = v_now;

  -- 3. Immutable transaction receipt
  INSERT INTO public.subscription_receipts (
    user_id, plan_slug, action, dot_charged, idempotency_key, receipt_number, period_start, period_end, note
  )
  VALUES (
    v_uid, v_plan.slug, v_action, v_plan.dot_price, p_idempotency_key, v_rcpt_no, v_period_start, v_period_end,
    v_plan.name || ' membership ' || v_action || 'd with DOT credits'
  )
  RETURNING * INTO v_receipt;

  -- 4. Notify user cleanly
  INSERT INTO public.notifications (user_id, category, title, body, href)
  VALUES (
    v_uid,
    'system',
    v_plan.name || ' Membership Active',
    'Receipt ' || v_rcpt_no || ': ' || v_plan.dot_price || ' DOT redeemed for ' || v_plan.duration_days || ' days.',
    '/upgrades'
  );

  RETURN jsonb_build_object(
    'idempotent_replay', false,
    'wallet', to_jsonb(v_wallet),
    'entitlement', to_jsonb(v_ent),
    'receipt', to_jsonb(v_receipt)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_with_dots(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscribe_with_dots(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_dot_subscription(p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ent public.subscription_entitlements%ROWTYPE;
  v_receipt public.subscription_receipts%ROWTYPE;
  v_rcpt_no text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ent
  FROM public.subscription_entitlements
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR v_ent.plan_slug = 'free' OR v_ent.status = 'cancelled' THEN
    RAISE EXCEPTION 'No active DOT subscription to cancel';
  END IF;

  UPDATE public.subscription_entitlements
  SET status = 'cancelled',
      auto_renew = false,
      cancelled_at = now(),
      updated_at = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_ent;

  UPDATE public.account_subscriptions
  SET status = 'cancelled', updated_at = now()
  WHERE user_id = v_uid;

  v_rcpt_no := 'RCPT-CAN-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10));

  INSERT INTO public.subscription_receipts (
    user_id, plan_slug, action, dot_charged, receipt_number, period_start, period_end, note
  )
  VALUES (
    v_uid, v_ent.plan_slug, 'cancel', 0, v_rcpt_no, v_ent.started_at, v_ent.expires_at,
    coalesce(NULLIF(trim(p_reason), ''), 'Cancelled by subscriber — benefits remain available until expiry')
  )
  RETURNING * INTO v_receipt;

  INSERT INTO public.notifications (user_id, category, title, body, href)
  VALUES (
    v_uid,
    'system',
    'Subscription Cancelled',
    'Your ' || v_ent.plan_slug || ' plan will not renew. Entitlements remain active until period end.',
    '/upgrades'
  );

  RETURN jsonb_build_object('entitlement', to_jsonb(v_ent), 'receipt', to_jsonb(v_receipt));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_my_dot_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_dot_subscription(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_membership_plan(
  p_slug text,
  p_name text,
  p_badge text,
  p_tagline text,
  p_dot_price integer,
  p_duration_days integer,
  p_benefits jsonb,
  p_perks text[],
  p_is_active boolean DEFAULT true
)
RETURNS public.membership_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.membership_plans%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_ping_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.membership_plans
  SET name = left(trim(p_name), 80),
      badge = left(trim(p_badge), 32),
      tagline = left(trim(p_tagline), 240),
      dot_price = greatest(0, least(p_dot_price, 100000)),
      duration_days = greatest(0, least(p_duration_days, 365)),
      benefits = coalesce(p_benefits, benefits),
      perks = coalesce(p_perks, perks),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
  WHERE slug = p_slug
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown membership plan slug: %', p_slug;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_membership_plan(text, text, text, text, integer, integer, jsonb, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_membership_plan(text, text, text, text, integer, integer, jsonb, text[], boolean) TO authenticated;

-- ============================================================================
-- 4. DOT-POWERED PING & MOMENT BOOSTING (Section 4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.boost_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('ping', 'moment')),
  content_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('pending_review', 'active', 'paused', 'completed', 'rejected', 'refunded', 'cancelled')
  ),
  duration_hours integer NOT NULL CHECK (duration_hours BETWEEN 6 AND 168),
  audience text NOT NULL DEFAULT 'everyone' CHECK (
    audience IN ('everyone', 'followers_and_similar', 'interest_matched', 'regional')
  ),
  target_interests text[] NOT NULL DEFAULT '{}'::text[],
  target_regions text[] NOT NULL DEFAULT ARRAY['GLOBAL']::text[],
  dot_cost integer NOT NULL CHECK (dot_cost >= 10 AND dot_cost <= 50000),
  idempotency_key text UNIQUE,
  receipt_number text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  impressions_count integer NOT NULL DEFAULT 0 CHECK (impressions_count >= 0),
  reach_count integer NOT NULL DEFAULT 0 CHECK (reach_count >= 0),
  clicks_count integer NOT NULL DEFAULT 0 CHECK (clicks_count >= 0),
  engagement_count integer NOT NULL DEFAULT 0 CHECK (engagement_count >= 0),
  moderation_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boost_campaigns_user_idx ON public.boost_campaigns (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS boost_campaigns_active_idx ON public.boost_campaigns (content_type, content_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.boost_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.boost_campaigns(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression', 'click', 'engagement')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boost_campaign_events_camp_idx
  ON public.boost_campaign_events (campaign_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.boost_campaign_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.boost_campaigns(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 160),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 500),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.boost_refund_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.boost_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dot_refunded integer NOT NULL CHECK (dot_refunded > 0),
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.boost_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_campaign_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_campaign_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boost_refund_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.boost_campaigns, public.boost_campaign_events, public.boost_refund_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.boost_campaigns TO anon, authenticated;
GRANT SELECT ON public.boost_campaign_events TO authenticated;
GRANT SELECT ON public.boost_refund_audit TO authenticated;

DROP POLICY IF EXISTS "Active boosts publicly readable and owners read all" ON public.boost_campaigns;
CREATE POLICY "Active boosts publicly readable and owners read all" ON public.boost_campaigns
  FOR SELECT TO anon, authenticated
  USING (
    (status = 'active' AND ends_at > now())
    OR (auth.uid() IS NOT NULL AND (auth.uid() = user_id OR public.is_ping_admin()))
  );

DROP POLICY IF EXISTS "Campaign owners and admins read boost events" ON public.boost_campaign_events;
CREATE POLICY "Campaign owners and admins read boost events" ON public.boost_campaign_events
  FOR SELECT TO authenticated
  USING (
    public.is_ping_admin()
    OR EXISTS (SELECT 1 FROM public.boost_campaigns bc WHERE bc.id = boost_campaign_events.campaign_id AND bc.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Reporters and admins read boost reports" ON public.boost_campaign_reports;
CREATE POLICY "Reporters and admins read boost reports" ON public.boost_campaign_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.is_ping_admin());

DROP POLICY IF EXISTS "Authenticated users report boosted campaigns" ON public.boost_campaign_reports;
CREATE POLICY "Authenticated users report boosted campaigns" ON public.boost_campaign_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Owners and admins read boost refund audit" ON public.boost_refund_audit;
CREATE POLICY "Owners and admins read boost refund audit" ON public.boost_refund_audit
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_ping_admin());

-- Authoritative server-side idempotent Boost creation with Moment lifetime validation
CREATE OR REPLACE FUNCTION public.create_boost_campaign(
  p_content_type text,
  p_content_id uuid,
  p_duration_hours integer,
  p_audience text DEFAULT 'everyone',
  p_target_interests text[] DEFAULT '{}'::text[],
  p_target_regions text[] DEFAULT ARRAY['GLOBAL']::text[],
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_ends timestamptz;
  v_existing public.boost_campaigns%ROWTYPE;
  v_wallet public.dot_wallets%ROWTYPE;
  v_moment_exp timestamptz;
  v_moment_aud text;
  v_dot_cost integer;
  v_rcpt text;
  v_campaign public.boost_campaigns%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL OR char_length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'Valid idempotency key is required';
  END IF;

  -- Idempotency check BEFORE debiting DOT
  SELECT * INTO v_existing
  FROM public.boost_campaigns
  WHERE idempotency_key = p_idempotency_key AND user_id = v_uid;

  IF FOUND THEN
    SELECT * INTO v_wallet FROM public.dot_wallets WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'idempotent_replay', true,
      'campaign', to_jsonb(v_existing),
      'wallet', to_jsonb(v_wallet)
    );
  END IF;

  IF p_content_type NOT IN ('ping', 'moment') THEN
    RAISE EXCEPTION 'Unsupported boost content type';
  END IF;

  IF p_duration_hours NOT IN (6, 12, 24, 48, 72, 168) THEN
    RAISE EXCEPTION 'Campaign duration must be 6, 12, 24, 48, 72, or 168 hours';
  END IF;

  IF p_audience NOT IN ('everyone', 'followers_and_similar', 'interest_matched', 'regional') THEN
    RAISE EXCEPTION 'Invalid target audience';
  END IF;

  v_ends := v_now + make_interval(hours => p_duration_hours);

  -- Eligibility & ownership checks
  IF p_content_type = 'ping' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pings
      WHERE id = p_content_id AND user_id = v_uid AND hidden_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Ping is not eligible for boosting (must be owned by you and publicly visible)';
    END IF;
  ELSE
    SELECT expires_at, audience INTO v_moment_exp, v_moment_aud
    FROM public.moments
    WHERE id = p_content_id AND author_id = v_uid AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Moment not found or not owned by you';
    END IF;

    IF v_moment_aud <> 'public' THEN
      RAISE EXCEPTION 'Only public Moments are eligible for boosting (Close Circle Moments cannot be promoted)';
    END IF;

    IF v_moment_exp IS NULL OR v_moment_exp <= v_ends THEN
      RAISE EXCEPTION 'Selected campaign duration (%h) exceeds this Moment''s remaining lifetime', p_duration_hours;
    END IF;
  END IF;

  -- Server-computed deterministic DOT pricing (never trusts client price)
  v_dot_cost := CASE p_duration_hours
    WHEN 6 THEN 20
    WHEN 12 THEN 35
    WHEN 24 THEN 60
    WHEN 48 THEN 110
    WHEN 72 THEN 155
    ELSE 300
  END;
  IF p_audience IN ('interest_matched', 'regional') THEN
    v_dot_cost := v_dot_cost + 15;
  END IF;

  INSERT INTO public.dot_wallets (user_id, balance, lifetime_earned, lifetime_spent)
  VALUES (v_uid, 50, 50, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.dot_wallets WHERE user_id = v_uid FOR UPDATE;
  IF v_wallet.balance < v_dot_cost THEN
    RAISE EXCEPTION 'Insufficient DOT balance: need % DOT, available % DOT', v_dot_cost, v_wallet.balance;
  END IF;

  v_rcpt := 'RCPT-BST-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10));

  UPDATE public.dot_wallets
  SET balance = balance - v_dot_cost,
      lifetime_spent = lifetime_spent + v_dot_cost,
      updated_at = v_now
  WHERE user_id = v_uid
  RETURNING * INTO v_wallet;

  INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, source_ref, description)
  VALUES (
    v_uid,
    -v_dot_cost,
    'spend',
    'boost_' || p_content_type,
    p_idempotency_key,
    'Promoted ' || p_content_type || ' (' || p_duration_hours || 'h · ' || v_rcpt || ')'
  );

  INSERT INTO public.boost_campaigns (
    user_id, content_type, content_id, status, duration_hours, audience,
    target_interests, target_regions, dot_cost, idempotency_key, receipt_number,
    starts_at, ends_at
  )
  VALUES (
    v_uid,
    p_content_type,
    p_content_id,
    'active',
    p_duration_hours,
    p_audience,
    coalesce(p_target_interests, '{}'::text[]),
    coalesce(p_target_regions, ARRAY['GLOBAL']::text[]),
    v_dot_cost,
    p_idempotency_key,
    v_rcpt,
    v_now,
    v_ends
  )
  RETURNING * INTO v_campaign;

  RETURN jsonb_build_object(
    'idempotent_replay', false,
    'campaign', to_jsonb(v_campaign),
    'wallet', to_jsonb(v_wallet)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_boost_campaign(text, uuid, integer, text, text[], text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_boost_campaign(text, uuid, integer, text, text[], text[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_my_boost_status(p_campaign_id uuid, p_status text)
RETURNS public.boost_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.boost_campaigns%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'paused', 'cancelled') THEN
    RAISE EXCEPTION 'Owners may only pause, resume, or cancel a boost campaign';
  END IF;

  UPDATE public.boost_campaigns
  SET status = p_status, updated_at = now()
  WHERE id = p_campaign_id
    AND user_id = v_uid
    AND status IN ('active', 'paused')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found or cannot change status';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_boost_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_boost_status(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_boost_event(
  p_campaign_id uuid,
  p_event_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_is_new_viewer boolean := false;
BEGIN
  IF p_event_type NOT IN ('impression', 'click', 'engagement') THEN
    RETURN;
  END IF;

  SELECT user_id INTO v_owner
  FROM public.boost_campaigns
  WHERE id = p_campaign_id AND status = 'active' AND ends_at > now();

  IF NOT FOUND OR (v_uid IS NOT NULL AND v_uid = v_owner) THEN
    RETURN;
  END IF;

  IF p_event_type = 'impression' AND v_uid IS NOT NULL THEN
    v_is_new_viewer := NOT EXISTS (
      SELECT 1 FROM public.boost_campaign_events
      WHERE campaign_id = p_campaign_id AND viewer_id = v_uid AND event_type = 'impression'
    );
  END IF;

  INSERT INTO public.boost_campaign_events (campaign_id, viewer_id, event_type)
  VALUES (p_campaign_id, v_uid, p_event_type);

  UPDATE public.boost_campaigns
  SET impressions_count = impressions_count + CASE WHEN p_event_type = 'impression' THEN 1 ELSE 0 END,
      reach_count = reach_count + CASE WHEN v_is_new_viewer THEN 1 ELSE 0 END,
      clicks_count = clicks_count + CASE WHEN p_event_type = 'click' THEN 1 ELSE 0 END,
      engagement_count = engagement_count + CASE WHEN p_event_type = 'engagement' THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE id = p_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_boost_event(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_boost_event(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_moderate_boost_campaign(
  p_campaign_id uuid,
  p_action text,
  p_reason text,
  p_refund_dots integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin uuid := auth.uid();
  v_camp public.boost_campaigns%ROWTYPE;
  v_refund integer := greatest(0, coalesce(p_refund_dots, 0));
BEGIN
  IF v_admin IS NULL OR NOT public.is_ping_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('reject', 'pause', 'restore', 'refund') THEN
    RAISE EXCEPTION 'Invalid boost moderation action';
  END IF;
  IF char_length(trim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Moderation reason is required';
  END IF;

  SELECT * INTO v_camp FROM public.boost_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Boost campaign not found';
  END IF;

  IF p_action = 'refund' THEN
    IF v_camp.status = 'refunded' THEN
      RETURN jsonb_build_object('status', 'already_refunded', 'campaign', to_jsonb(v_camp));
    END IF;
    v_refund := least(v_camp.dot_cost, CASE WHEN v_refund > 0 THEN v_refund ELSE v_camp.dot_cost END);

    UPDATE public.dot_wallets
    SET balance = balance + v_refund,
        updated_at = now()
    WHERE user_id = v_camp.user_id;

    INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, source_ref, description)
    VALUES (
      v_camp.user_id, v_refund, 'bonus', 'boost_refund', v_camp.id::text || ':refund',
      'Authorized boost refund (' || v_camp.receipt_number || '): ' || left(trim(p_reason), 120)
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.boost_refund_audit (campaign_id, user_id, admin_id, dot_refunded, reason)
    VALUES (v_camp.id, v_camp.user_id, v_admin, v_refund, left(trim(p_reason), 500));

    UPDATE public.boost_campaigns
    SET status = 'refunded', moderation_note = left(trim(p_reason), 500), updated_at = now()
    WHERE id = v_camp.id
    RETURNING * INTO v_camp;
  ELSE
    UPDATE public.boost_campaigns
    SET status = CASE p_action WHEN 'reject' THEN 'rejected' WHEN 'pause' THEN 'paused' ELSE 'active' END,
        moderation_note = left(trim(p_reason), 500),
        updated_at = now()
    WHERE id = v_camp.id
    RETURNING * INTO v_camp;
  END IF;

  RETURN jsonb_build_object('status', v_camp.status, 'campaign', to_jsonb(v_camp));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_moderate_boost_campaign(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_moderate_boost_campaign(uuid, text, text, integer) TO authenticated;

-- ============================================================================
-- 5. DOT TAG SYSTEM (.trending, .fyp, .africa, etc.) (Section 7)
-- ============================================================================

ALTER TABLE public.pings
  ADD COLUMN IF NOT EXISTS dot_tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS pings_dot_tags_gin_idx
  ON public.pings USING gin (dot_tags)
  WHERE hidden_at IS NULL;

CREATE TABLE IF NOT EXISTS public.dot_tags (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9_]{1,31}$'),
  display_tag text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (char_length(trim(category)) BETWEEN 2 AND 40),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'blocked')),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  follower_count integer NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  featured boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dot_tags (slug, display_tag, category, featured)
VALUES
  ('trending', '.trending', 'discovery', true),
  ('fyp', '.fyp', 'discovery', true),
  ('technology', '.technology', 'tech', true),
  ('business', '.business', 'commerce', true),
  ('education', '.education', 'learning', true),
  ('entertainment', '.entertainment', 'culture', true),
  ('africa', '.africa', 'regional', true),
  ('startups', '.startups', 'builders', true),
  ('opportunities', '.opportunities', 'careers', true),
  ('music', '.music', 'culture', true),
  ('design', '.design', 'creative', true),
  ('builders', '.builders', 'builders', true),
  ('climate', '.climate', 'impact', false),
  ('ai', '.ai', 'tech', true)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ping_dot_tags (
  ping_id uuid NOT NULL REFERENCES public.pings(id) ON DELETE CASCADE,
  tag_slug text NOT NULL REFERENCES public.dot_tags(slug) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ping_id, tag_slug)
);

CREATE INDEX IF NOT EXISTS ping_dot_tags_slug_idx
  ON public.ping_dot_tags (tag_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_dot_tag_follows (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tag_slug text NOT NULL REFERENCES public.dot_tags(slug) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag_slug)
);

ALTER TABLE public.dot_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ping_dot_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_dot_tag_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active DOT tags publicly readable" ON public.dot_tags;
CREATE POLICY "Active DOT tags publicly readable" ON public.dot_tags
  FOR SELECT TO anon, authenticated
  USING (status = 'active' OR (auth.uid() IS NOT NULL AND public.is_ping_admin()));

DROP POLICY IF EXISTS "Authenticated users register new DOT tags" ON public.dot_tags;
CREATE POLICY "Authenticated users register new DOT tags" ON public.dot_tags
  FOR INSERT TO authenticated
  WITH CHECK (status = 'active' AND (created_by IS NULL OR created_by = auth.uid()));

DROP POLICY IF EXISTS "Ping DOT tag links publicly readable" ON public.ping_dot_tags;
CREATE POLICY "Ping DOT tag links publicly readable" ON public.ping_dot_tags
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.pings p WHERE p.id = ping_dot_tags.ping_id AND p.hidden_at IS NULL)
  );

DROP POLICY IF EXISTS "Ping authors attach DOT tags" ON public.ping_dot_tags;
CREATE POLICY "Ping authors attach DOT tags" ON public.ping_dot_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.pings p WHERE p.id = ping_dot_tags.ping_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users read own followed DOT tags" ON public.user_dot_tag_follows;
CREATE POLICY "Users read own followed DOT tags" ON public.user_dot_tag_follows
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users follow DOT tags" ON public.user_dot_tag_follows;
CREATE POLICY "Users follow DOT tags" ON public.user_dot_tag_follows
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users unfollow DOT tags" ON public.user_dot_tag_follows;
CREATE POLICY "Users unfollow DOT tags" ON public.user_dot_tag_follows
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.admin_moderate_dot_tag(p_slug text, p_status text)
RETURNS public.dot_tags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.dot_tags%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_ping_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'restricted', 'blocked') THEN
    RAISE EXCEPTION 'Invalid DOT tag moderation status';
  END IF;

  UPDATE public.dot_tags
  SET status = p_status, updated_at = now()
  WHERE slug = lower(trim(p_slug))
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOT tag not found';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_moderate_dot_tag(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_moderate_dot_tag(text, text) TO authenticated;
