-- ==============================================================================
-- Migration 0026: Phase 1 Workstream 5 — Optional Verification & Monetization
-- Foundations
-- ==============================================================================
-- Preserves all existing profiles, DOT balances, dot_transactions,
-- account_subscriptions, user_roles, signals, and hubs.
--
-- Design & Security Guarantees:
--   1. Ordinary Ping accounts remain free with no mandatory verification.
--   2. Identity verification, Professional / Account-Type verification, and
--      Platform Role authorization (`public.user_roles`) are strictly separate.
--   3. Users can NEVER approve their own verification request, even if admin.
--   4. Selecting a participation pathway (e.g., 'investor' or 'business') grants
--      zero verification status and zero administrative/investor permissions.
--   5. DOT credits remain non-cash loyalty credits; no live real-money payment
--      processing or compulsory fees are activated here.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Account Verifications (Identity & Professional Pathways)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  verification_domain text NOT NULL CHECK (verification_domain IN ('identity', 'professional')),
  pathway_type text NOT NULL CHECK (
    pathway_type IN ('identity_standard', 'creator', 'business', 'community_org', 'builder', 'investor')
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('unverified', 'pending', 'verified', 'rejected', 'revoked')
  ),
  organization_name text NOT NULL DEFAULT '' CHECK (char_length(organization_name) <= 120),
  evidence_url text CHECK (
    evidence_url IS NULL
    OR (evidence_url ~* '^https://' AND char_length(evidence_url) <= 400)
  ),
  submission_note text NOT NULL DEFAULT '' CHECK (char_length(submission_note) <= 500),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_note text NOT NULL DEFAULT '' CHECK (char_length(reviewer_note) <= 500),
  verified_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, verification_domain),

  CONSTRAINT account_verifications_domain_pathway_check CHECK (
    (verification_domain = 'identity' AND pathway_type = 'identity_standard')
    OR (
      verification_domain = 'professional'
      AND pathway_type IN ('creator', 'business', 'community_org', 'builder', 'investor')
    )
  )
);

CREATE INDEX IF NOT EXISTS account_verifications_status_created_idx
  ON public.account_verifications (status, created_at DESC);

CREATE INDEX IF NOT EXISTS account_verifications_user_status_idx
  ON public.account_verifications (user_id, verification_domain, status);

ALTER TABLE public.account_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_verifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.account_verifications TO service_role;

DROP POLICY IF EXISTS "Users read own verifications or admin" ON public.account_verifications;
CREATE POLICY "Users read own verifications or admin" ON public.account_verifications
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_ping_admin());

-- Verification audit trail (admins only)
CREATE TABLE IF NOT EXISTS public.verification_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid REFERENCES public.account_verifications(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verification_domain text NOT NULL,
  pathway_type text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_audit_user_created_idx
  ON public.verification_audit (user_id, created_at DESC);

ALTER TABLE public.verification_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.verification_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.verification_audit TO authenticated;
GRANT SELECT, INSERT ON public.verification_audit TO service_role;

DROP POLICY IF EXISTS "Admins read verification audit" ON public.verification_audit;
CREATE POLICY "Admins read verification audit" ON public.verification_audit
  FOR SELECT TO authenticated
  USING (public.is_ping_admin());

-- Strict anti-tampering & anti-self-approval trigger on account_verifications
CREATE OR REPLACE FUNCTION public.guard_account_verification_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'account_verifications rows cannot be deleted directly' USING ERRCODE = '42501';
  END IF;

  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Direct writes to account_verifications are forbidden; use verification RPCs'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'verified' AND v_caller IS NOT NULL AND NEW.user_id = v_caller THEN
    RAISE EXCEPTION 'Users cannot approve their own verification' USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_verifications_guard ON public.account_verifications;
CREATE TRIGGER account_verifications_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.account_verifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_verification_write();

-- ------------------------------------------------------------------------------
-- 2. Verification Request, Admin Review, and Public Badge RPCs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_verification_request(
  _verification_domain text,
  _pathway_type text,
  _organization_name text DEFAULT '',
  _evidence_url text DEFAULT NULL,
  _submission_note text DEFAULT ''
) RETURNS public.account_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org text := left(btrim(coalesce(_organization_name, '')), 120);
  v_url text := nullif(btrim(coalesce(_evidence_url, '')), '');
  v_note text := left(btrim(coalesce(_submission_note, '')), 500);
  v_prev_status text;
  v_row public.account_verifications;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit a verification request'
      USING ERRCODE = '42501';
  END IF;

  IF _verification_domain NOT IN ('identity', 'professional') THEN
    RAISE EXCEPTION 'Invalid verification domain';
  END IF;

  IF _verification_domain = 'identity' AND _pathway_type <> 'identity_standard' THEN
    RAISE EXCEPTION 'Identity verification requires pathway_type = identity_standard';
  END IF;

  IF _verification_domain = 'professional'
     AND _pathway_type NOT IN ('creator', 'business', 'community_org', 'builder', 'investor') THEN
    RAISE EXCEPTION 'Invalid professional verification pathway';
  END IF;

  IF v_url IS NOT NULL AND (v_url !~* '^https://' OR char_length(v_url) > 400) THEN
    RAISE EXCEPTION 'Evidence URL must use https:// and be 400 characters or fewer';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller) THEN
    PERFORM public.ensure_my_profile();
  END IF;

  SELECT status INTO v_prev_status
  FROM public.account_verifications
  WHERE user_id = v_caller AND verification_domain = _verification_domain;

  -- Submissions always reset status to 'pending' and clear prior approvals/reviewer stamps
  INSERT INTO public.account_verifications (
    user_id,
    verification_domain,
    pathway_type,
    status,
    organization_name,
    evidence_url,
    submission_note,
    reviewer_id,
    reviewer_note,
    verified_at,
    reviewed_at
  )
  VALUES (
    v_caller,
    _verification_domain,
    _pathway_type,
    'pending',
    v_org,
    v_url,
    v_note,
    NULL,
    '',
    NULL,
    NULL
  )
  ON CONFLICT (user_id, verification_domain) DO UPDATE SET
    pathway_type = EXCLUDED.pathway_type,
    status = 'pending',
    organization_name = EXCLUDED.organization_name,
    evidence_url = EXCLUDED.evidence_url,
    submission_note = EXCLUDED.submission_note,
    reviewer_id = NULL,
    reviewer_note = '',
    verified_at = NULL,
    reviewed_at = NULL,
    updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.verification_audit (
    verification_id,
    user_id,
    actor_id,
    verification_domain,
    pathway_type,
    previous_status,
    new_status,
    reason
  )
  VALUES (
    v_row.id,
    v_caller,
    v_caller,
    v_row.verification_domain,
    v_row.pathway_type,
    v_prev_status,
    'pending',
    'User submitted optional verification request'
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_verification_request(text, text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_verification_request(text, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.review_verification_request(
  _verification_id uuid,
  _status text,
  _reviewer_note text DEFAULT ''
) RETURNS public.account_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_note text := left(btrim(coalesce(_reviewer_note, '')), 500);
  v_req public.account_verifications;
  v_updated public.account_verifications;
BEGIN
  IF v_caller IS NULL THEN
    IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT public.is_ping_admin() THEN
      RAISE EXCEPTION 'Only platform administrators can review verification requests'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF _status NOT IN ('verified', 'rejected', 'revoked', 'pending') THEN
    RAISE EXCEPTION 'Invalid verification decision status';
  END IF;

  SELECT * INTO v_req
  FROM public.account_verifications
  WHERE id = _verification_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found';
  END IF;

  IF v_caller IS NOT NULL AND v_req.user_id = v_caller THEN
    RAISE EXCEPTION 'Administrators cannot approve or review their own verification request'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.account_verifications
  SET
    status = _status,
    reviewer_id = v_caller,
    reviewer_note = v_note,
    reviewed_at = now(),
    verified_at = CASE WHEN _status = 'verified' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = _verification_id
  RETURNING * INTO v_updated;

  INSERT INTO public.verification_audit (
    verification_id,
    user_id,
    actor_id,
    verification_domain,
    pathway_type,
    previous_status,
    new_status,
    reason
  )
  VALUES (
    v_updated.id,
    v_updated.user_id,
    v_caller,
    v_updated.verification_domain,
    v_updated.pathway_type,
    v_req.status,
    v_updated.status,
    coalesce(nullif(v_note, ''), format('Admin review set status to %s', _status))
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.review_verification_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_verification_request(uuid, text, text)
  TO authenticated, service_role;

-- Public non-sensitive verification badge summary (never leaks pending/rejected/notes)
CREATE OR REPLACE FUNCTION public.get_public_verification_badges(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'identity_verified', EXISTS (
      SELECT 1 FROM public.account_verifications av
      WHERE av.user_id = _user_id
        AND av.verification_domain = 'identity'
        AND av.status = 'verified'
    ),
    'professional_verified', EXISTS (
      SELECT 1 FROM public.account_verifications av
      WHERE av.user_id = _user_id
        AND av.verification_domain = 'professional'
        AND av.status = 'verified'
    ),
    'professional_pathway', (
      SELECT av.pathway_type
      FROM public.account_verifications av
      WHERE av.user_id = _user_id
        AND av.verification_domain = 'professional'
        AND av.status = 'verified'
      LIMIT 1
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_verification_badges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_verification_badges(uuid)
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. Monetization Catalog Foundations (Strict DOT-vs-Cash Separation)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monetization_offerings (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9_]{3,60}$'),
  category text NOT NULL CHECK (
    category IN (
      'core_free',
      'premium_user',
      'creator_service',
      'business_subscription',
      'verification_service'
    )
  ),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 4 AND 300),
  billing_mode text NOT NULL CHECK (billing_mode IN ('free', 'dot_credits', 'planned_fiat')),
  dot_credit_cost integer CHECK (dot_credit_cost IS NULL OR dot_credit_cost >= 0),
  is_compulsory boolean NOT NULL DEFAULT false CHECK (NOT is_compulsory),
  live_payment_enabled boolean NOT NULL DEFAULT false CHECK (NOT live_payment_enabled),
  linked_tier text CHECK (linked_tier IS NULL OR linked_tier IN ('free', 'plus', 'pro', 'institution')),
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monetization_offerings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.monetization_offerings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.monetization_offerings TO anon, authenticated;
GRANT ALL ON public.monetization_offerings TO service_role;

DROP POLICY IF EXISTS "Read non-compulsory offerings catalog" ON public.monetization_offerings;
CREATE POLICY "Read non-compulsory offerings catalog" ON public.monetization_offerings
  FOR SELECT TO anon, authenticated
  USING (NOT is_compulsory);

INSERT INTO public.monetization_offerings (
  slug,
  category,
  title,
  summary,
  billing_mode,
  dot_credit_cost,
  is_compulsory,
  live_payment_enabled,
  linked_tier,
  features,
  display_order
)
VALUES
  (
    'core_ping_access',
    'core_free',
    'Core Ping Network Access',
    'Free everyday access to publishing Pings, Explore discovery, Communities, DMs, and Moments.',
    'free',
    0,
    false,
    false,
    'free',
    '["Unlimited public Pings", "Moments & Close Circle", "Community Hubs & DMs", "No mandatory verification or fees"]'::jsonb,
    1
  ),
  (
    'member_plus_credits',
    'premium_user',
    'Member Plus (DOT Credits)',
    'Optional enhanced profile tools redeemable with earned non-cash DOT builder credits.',
    'dot_credits',
    150,
    false,
    false,
    'plus',
    '["90-day analytics window", "Extended highlight collections", "Plan badge separate from verification"]'::jsonb,
    2
  ),
  (
    'creator_services_foundation',
    'creator_service',
    'Creator Services & Audience Tools',
    'Foundation for creator analytics, highlights, and future verified creator monetization.',
    'planned_fiat',
    NULL,
    false,
    false,
    'pro',
    '["Expanded creator insights", "Future paid memberships pending payment security audit"]'::jsonb,
    3
  ),
  (
    'business_organization_suite',
    'business_subscription',
    'Business & Organization Suite',
    'Multi-publisher Signal governance and organization coordination preview; commercial billing planned.',
    'dot_credits',
    600,
    false,
    false,
    'institution',
    '["Multi-publisher Signal workflows", "Institutional broadcast telemetry", "Distinct from admin verification"]'::jsonb,
    4
  ),
  (
    'optional_verification_review',
    'verification_service',
    'Optional Trust & Credential Verification',
    'Voluntary identity and professional account verification reviewed by administrators at no required charge.',
    'free',
    0,
    false,
    false,
    NULL,
    '["Identity verification pathway", "Creator, Business, Org, Builder, Investor pathways", "Priority enterprise KYB planned for future commercial release"]'::jsonb,
    5
  )
ON CONFLICT (slug) DO UPDATE SET
  category = EXCLUDED.category,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  billing_mode = EXCLUDED.billing_mode,
  dot_credit_cost = EXCLUDED.dot_credit_cost,
  is_compulsory = EXCLUDED.is_compulsory,
  live_payment_enabled = EXCLUDED.live_payment_enabled,
  linked_tier = EXCLUDED.linked_tier,
  features = EXCLUDED.features,
  display_order = EXCLUDED.display_order,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.get_monetization_foundation()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'verification_optional', true,
    'dot_credits_are_cash', false,
    'live_fiat_payments_enabled', false,
    'offerings', coalesce(
      (
        SELECT jsonb_agg(to_jsonb(o) ORDER BY o.display_order ASC)
        FROM public.monetization_offerings o
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_monetization_foundation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monetization_foundation() TO anon, authenticated, service_role;
