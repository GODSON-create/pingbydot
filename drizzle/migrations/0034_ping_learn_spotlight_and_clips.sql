-- 0034_ping_learn_spotlight_and_clips.sql
-- PING ADDENDUM: Ping Learn Entitlements (Builder Plus ₦3,000 Leapfrog Entry &
-- Builder Pro ₦30,000 Complete 10-Course Library), Ping Spotlight (Editorial Merit
-- Discovery, Evaluation, Official Distribution & Separated Editorial Permissions),
-- and Ping Clips (Persistent Short-Form Vertical Video + Moments-to-Clips Workflow).
-- Forward-only, idempotent, strict RLS (zero open USING (true) policies).

-- ============================================================================
-- 1. SEPARATED ADMINISTRATIVE & EDITORIAL ROLE PERMISSIONS (Sections 13 & 20)
-- ============================================================================

DO $$
DECLARE
  v_con text;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'public.user_roles'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%'
  LIMIT 1;
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'spotlight_editor', 'financial_admin', 'learn_admin'));

CREATE OR REPLACE FUNCTION public.is_spotlight_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('spotlight_editor', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_financial_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('financial_admin', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_learn_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('learn_admin', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_spotlight_editor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_financial_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_learn_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_spotlight_editor() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_financial_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_learn_admin() TO authenticated, service_role;

-- Helper: checks whether a user currently holds an active qualifying Pro subscription
CREATE OR REPLACE FUNCTION public.has_active_pro_membership(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.subscription_entitlements se
      WHERE se.user_id = _user_id
        AND se.plan_slug = 'pro'
        AND se.status IN ('active', 'cancelled')
        AND (se.expires_at IS NULL OR se.expires_at > now())
    )
    OR EXISTS (
      SELECT 1 FROM public.account_subscriptions sub
      WHERE sub.user_id = _user_id
        AND sub.tier = 'pro'
        AND sub.status IN ('active', 'cancelled')
        AND (sub.expires_at IS NULL OR sub.expires_at > now())
    )
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_pro_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_pro_membership(uuid) TO authenticated, service_role;

-- Update configurable membership plan metadata for Builder Plus (₦3,000) & Builder Pro (₦30,000)
UPDATE public.membership_plans
SET
  name = 'Builder Plus',
  badge = 'Builder Plus',
  tagline = '₦3,000/mo reference plan · Includes LEAPFROG (90-Day AI Business Course, $2,000 reference value) + periodic course unlocks after completion.',
  benefits = jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(benefits, '{}'::jsonb), '{ngn_reference_price}', '3000'::jsonb),
      '{learn_access_policy}',
      '"leapfrog_entry_then_monthly"'::jsonb
    ),
    '{spotlight_eligible}',
    'false'::jsonb
  ),
  perks = ARRAY[
    'LEAPFROG — Build a Successful Business in 90 Days Using AI ($2,000 reference value)',
    '7 strategic plays, exercises, assessment & permanent certificate',
    'Unlocks 1 additional Ping Learn course per monthly cycle after Leapfrog completion',
    'Distinct Builder Plus badge (strictly separate from Identity Verification)'
  ],
  updated_at = now()
WHERE slug = 'plus';

UPDATE public.membership_plans
SET
  name = 'Builder Pro',
  badge = 'Builder Pro',
  tagline = '₦30,000/mo reference plan · Complete 10-Course Ping Learn Library ($10,000 aggregate reference value) + Ping Spotlight consideration eligibility.',
  benefits = jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(benefits, '{}'::jsonb), '{ngn_reference_price}', '30000'::jsonb),
      '{learn_access_policy}',
      '"full_ten_course_library"'::jsonb
    ),
    '{spotlight_eligible}',
    'true'::jsonb
  ),
  perks = ARRAY[
    'Complete 10-Course Ping Learn library ($10,000 reference value; not a cash/DOT award)',
    'Preserves existing Leapfrog progress & certificates on upgrade with zero duplicate enrolment',
    'Eligibility for merit-based Ping Spotlight editorial consideration (selection not guaranteed)',
    'Distinct Builder Pro badge (never automatically grants Identity Verification)'
  ],
  updated_at = now()
WHERE slug = 'pro';

-- ============================================================================
-- 2. PART A — PING LEARN CATALOGUE, ENTITLEMENTS, PROGRESSION & GRANTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.learn_courses (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,48}$'),
  sort_order integer NOT NULL UNIQUE CHECK (sort_order BETWEEN 1 AND 100),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 140),
  subtitle text NOT NULL DEFAULT '' CHECK (char_length(subtitle) <= 260),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  is_entry_course boolean NOT NULL DEFAULT false,
  -- Explicit financial separation (Section 6)
  reference_value_usd integer NOT NULL DEFAULT 0 CHECK (reference_value_usd >= 0),
  approved_grant_allocation_dot integer NOT NULL DEFAULT 0 CHECK (approved_grant_allocation_dot >= 0),
  delivery_cost_estimate_usd integer NOT NULL DEFAULT 0 CHECK (delivery_cost_estimate_usd >= 0),
  min_assessment_score integer NOT NULL DEFAULT 70 CHECK (min_assessment_score BETWEEN 50 AND 100),
  total_lessons integer NOT NULL DEFAULT 7 CHECK (total_lessons >= 1),
  total_exercises integer NOT NULL DEFAULT 3 CHECK (total_exercises >= 1),
  curriculum jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.learn_courses (
  slug, sort_order, title, subtitle, description, is_entry_course,
  reference_value_usd, approved_grant_allocation_dot, delivery_cost_estimate_usd,
  min_assessment_score, total_lessons, total_exercises, is_published
)
VALUES
  ('leapfrog', 1, 'LEAPFROG — Build a Successful Business in 90 Days Using AI',
   'Seven strategic plays to validate, launch, and generate traction using AI workflows in 90 days.',
   'The flagship Ping Learn entry curriculum. Complete all 7 strategic plays, practical exercises, milestones, and final assessment to earn your permanent Leapfrog certificate and unlock periodic Builder Plus course releases.',
   true, 2000, 100, 45, 70, 7, 3, true),
  ('brand-builder', 2, 'Brand Builder',
   'Positioning, visual identity, storytelling, and trust architecture for category-defining brands.',
   'Turn an early venture into a recognizable, credible brand across digital, community, and institutional channels.',
   false, 1000, 60, 25, 70, 6, 3, true),
  ('be-fundable', 3, 'Be Fundable',
   'Investment readiness, financial storytelling, data rooms, governance, and capital strategy.',
   'Build institutional readiness for angels, grants, accelerators, venture funds, and strategic partners.',
   false, 1000, 60, 25, 70, 6, 3, true),
  ('content-engine', 4, 'Content Engine',
   'Repeatable creator and founder distribution systems across Pings, Clips, and long-form channels.',
   'Design an authentic content engine that converts attention into community trust and qualified leads.',
   false, 900, 50, 20, 70, 6, 3, true),
  ('growth-engine', 5, 'Growth Engine',
   'Acquisition loops, retention instrumentation, referral mechanics, and unit-economics discipline.',
   'Build compounding customer acquisition and retention systems grounded in real observed metrics.',
   false, 900, 50, 20, 70, 6, 3, true),
  ('ai-operator', 6, 'AI Operator',
   'Practical operational automation across research, support, operations, and internal workflows.',
   'Deploy reliable, human-supervised AI operations that save founder hours without compromising quality.',
   false, 900, 50, 20, 70, 6, 3, true),
  ('sales-playbook', 7, 'The Sales Playbook',
   'Discovery calls, consultative B2B/B2C closing, pipeline hygiene, and repeatable revenue systems.',
   'Master ethical outbound, inbound conversion, proposals, pricing defence, and customer expansion.',
   false, 900, 50, 20, 70, 6, 3, true),
  ('money-matters', 8, 'Money Matters',
   'Cash-flow forecasting, unit margins, pricing discipline, compliance, and financial resilience.',
   'Protect business longevity with clean books, runway visibility, tax readiness, and working capital controls.',
   false, 800, 40, 18, 70, 5, 2, true),
  ('build-your-team', 9, 'Build Your Team',
   'Hiring scorecards, onboarding, culture, delegation, accountability, and team performance.',
   'Transition from solo builder to cohesive execution team without burning cash or losing focus.',
   false, 800, 40, 18, 70, 5, 2, true),
  ('scale-without-borders', 10, 'Scale Without Borders',
   'Cross-border payments, continental expansion, distribution partnerships, and multi-market localisation.',
   'Expand sustainably across African and global markets with compliant local partnerships and playbooks.',
   false, 800, 40, 18, 70, 5, 2, true)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.course_release_schedules (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  require_leapfrog_completion boolean NOT NULL DEFAULT true,
  release_interval_days integer NOT NULL DEFAULT 30 CHECK (release_interval_days BETWEEN 7 AND 180),
  courses_per_cycle integer NOT NULL DEFAULT 1 CHECK (courses_per_cycle BETWEEN 1 AND 5),
  min_assessment_score integer NOT NULL DEFAULT 70 CHECK (min_assessment_score BETWEEN 50 AND 100),
  release_order text[] NOT NULL DEFAULT ARRAY[
    'brand-builder',
    'be-fundable',
    'content-engine',
    'growth-engine',
    'ai-operator',
    'sales-playbook',
    'money-matters',
    'build-your-team',
    'scale-without-borders'
  ]::text[],
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.course_release_schedules (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.course_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_slug text NOT NULL REFERENCES public.learn_courses(slug) ON DELETE CASCADE,
  access_status text NOT NULL DEFAULT 'active' CHECK (
    access_status IN ('active', 'paused_expired', 'completed_retained')
  ),
  grant_source text NOT NULL CHECK (
    grant_source IN (
      'builder_plus_entry',
      'builder_plus_monthly_release',
      'builder_pro_full_library',
      'admin_grant'
    )
  ),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  -- Distinct financial & grant control columns (Section 6)
  approved_grant_dot integer NOT NULL DEFAULT 0 CHECK (approved_grant_dot >= 0),
  released_grant_dot integer NOT NULL DEFAULT 0 CHECK (released_grant_dot >= 0),
  redeemed_grant_dot integer NOT NULL DEFAULT 0 CHECK (redeemed_grant_dot >= 0),
  actual_delivery_cost_usd numeric(10,2) NOT NULL DEFAULT 0 CHECK (actual_delivery_cost_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_slug)
);

CREATE INDEX IF NOT EXISTS course_entitlements_user_idx
  ON public.course_entitlements (user_id, access_status);

CREATE TABLE IF NOT EXISTS public.learn_course_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_slug text NOT NULL REFERENCES public.learn_courses(slug) ON DELETE CASCADE,
  completed_lesson_ids text[] NOT NULL DEFAULT '{}'::text[],
  submitted_exercises jsonb NOT NULL DEFAULT '{}'::jsonb,
  milestones_completed integer NOT NULL DEFAULT 0 CHECK (milestones_completed >= 0),
  assessment_attempts integer NOT NULL DEFAULT 0 CHECK (assessment_attempts >= 0),
  assessment_score integer CHECK (assessment_score IS NULL OR (assessment_score BETWEEN 0 AND 100)),
  assessment_passed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  certificate_code text UNIQUE,
  certificate_issued_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_slug)
);

CREATE TABLE IF NOT EXISTS public.learn_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(trim(action)) BETWEEN 2 AND 80),
  course_slug text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.learn_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_release_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_course_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.learn_courses, public.course_release_schedules, public.course_entitlements, public.learn_course_progress, public.learn_audit_logs
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.learn_courses, public.course_release_schedules TO anon, authenticated;
GRANT SELECT ON public.course_entitlements, public.learn_course_progress, public.learn_audit_logs TO authenticated;

DROP POLICY IF EXISTS "Published learn courses readable" ON public.learn_courses;
CREATE POLICY "Published learn courses readable" ON public.learn_courses
  FOR SELECT TO anon, authenticated
  USING (is_published = true OR (auth.uid() IS NOT NULL AND public.is_learn_admin()));

DROP POLICY IF EXISTS "Course release schedule readable" ON public.course_release_schedules;
CREATE POLICY "Course release schedule readable" ON public.course_release_schedules
  FOR SELECT TO anon, authenticated
  USING (id = 'default');

DROP POLICY IF EXISTS "Users read own course entitlements" ON public.course_entitlements;
CREATE POLICY "Users read own course entitlements" ON public.course_entitlements
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_learn_admin());

DROP POLICY IF EXISTS "Users read own learn progress" ON public.learn_course_progress;
CREATE POLICY "Users read own learn progress" ON public.learn_course_progress
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_learn_admin());

DROP POLICY IF EXISTS "Learn admins and owners read learn audit" ON public.learn_audit_logs;
CREATE POLICY "Learn admins and owners read learn audit" ON public.learn_audit_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = target_user_id OR public.is_learn_admin());

-- Server-verified Ping Learn Entitlement Synchronisation RPC
-- Enforces: Builder Plus -> Leapfrog only (plus periodic monthly releases AFTER assessment-verified Leapfrog completion);
-- Builder Pro -> all 10 courses immediately without duplicating Leapfrog enrolment;
-- Expiry/Downgrade -> recalculates active access while preserving completed progress & certificates permanently.
CREATE OR REPLACE FUNCTION public.sync_my_learn_entitlements()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan text := 'free';
  v_expires timestamptz := NULL;
  v_sched public.course_release_schedules%ROWTYPE;
  v_leapfrog public.learn_course_progress%ROWTYPE;
  v_cycles integer := 0;
  v_unlock_count integer := 0;
  v_slug text;
  v_course public.learn_courses%ROWTYPE;
  v_ent_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sched FROM public.course_release_schedules WHERE id = 'default';

  -- Resolve authoritative active membership (subscription_entitlements takes precedence over legacy account_subscriptions)
  SELECT se.plan_slug, se.expires_at
  INTO v_plan, v_expires
  FROM public.subscription_entitlements se
  WHERE se.user_id = v_uid
    AND se.status IN ('active', 'cancelled')
    AND (se.expires_at IS NULL OR se.expires_at > now())
  LIMIT 1;

  IF v_plan IS NULL OR v_plan = 'free' THEN
    SELECT CASE WHEN sub.tier = 'institution' THEN 'business' ELSE sub.tier END, sub.expires_at
    INTO v_plan, v_expires
    FROM public.account_subscriptions sub
    WHERE sub.user_id = v_uid
      AND sub.status IN ('active', 'cancelled')
      AND (sub.expires_at IS NULL OR sub.expires_at > now())
    LIMIT 1;
  END IF;
  v_plan := coalesce(v_plan, 'free');

  -- Fetch Leapfrog completion record (must have passed real assessment!)
  SELECT * INTO v_leapfrog
  FROM public.learn_course_progress
  WHERE user_id = v_uid AND course_slug = 'leapfrog';

  IF v_plan = 'pro' THEN
    -- Builder Pro unlocks all 10 published courses immediately; ON CONFLICT preserves Leapfrog & never duplicates
    FOR v_course IN SELECT * FROM public.learn_courses WHERE is_published = true ORDER BY sort_order ASC LOOP
      INSERT INTO public.course_entitlements (
        user_id, course_slug, access_status, grant_source, expires_at, approved_grant_dot
      )
      VALUES (
        v_uid, v_course.slug, 'active', 'builder_pro_full_library', v_expires, v_course.approved_grant_allocation_dot
      )
      ON CONFLICT (user_id, course_slug) DO UPDATE
      SET access_status = CASE
            WHEN EXISTS (
              SELECT 1 FROM public.learn_course_progress p
              WHERE p.user_id = v_uid AND p.course_slug = EXCLUDED.course_slug AND p.assessment_passed = true
            ) THEN 'completed_retained'
            ELSE 'active'
          END,
          expires_at = EXCLUDED.expires_at,
          updated_at = now();
    END LOOP;

  ELSIF v_plan = 'plus' THEN
    -- Builder Plus receives LEAPFROG ONLY by default
    SELECT * INTO v_course FROM public.learn_courses WHERE slug = 'leapfrog';
    IF FOUND THEN
      INSERT INTO public.course_entitlements (
        user_id, course_slug, access_status, grant_source, expires_at, approved_grant_dot
      )
      VALUES (
        v_uid, 'leapfrog', 'active', 'builder_plus_entry', v_expires, v_course.approved_grant_allocation_dot
      )
      ON CONFLICT (user_id, course_slug) DO UPDATE
      SET access_status = CASE
            WHEN coalesce(v_leapfrog.assessment_passed, false) THEN 'completed_retained'
            ELSE 'active'
          END,
          expires_at = EXCLUDED.expires_at,
          updated_at = now();
    END IF;

    -- Periodic monthly unlocks ONLY after real assessment-verified Leapfrog completion
    IF coalesce(v_leapfrog.assessment_passed, false) AND v_leapfrog.completed_at IS NOT NULL THEN
      v_cycles := floor(
        extract(epoch FROM (now() - v_leapfrog.completed_at))
        / (greatest(7, v_sched.release_interval_days) * 86400.0)
      )::integer;
      -- Eligible for 1st additional release once Leapfrog is completed + 1 per interval cycle
      v_unlock_count := greatest(1, 1 + greatest(0, v_cycles)) * greatest(1, v_sched.courses_per_cycle);

      FOR v_slug IN
        SELECT slug_item
        FROM unnest(v_sched.release_order) WITH ORDINALITY AS t(slug_item, ord)
        WHERE ord <= v_unlock_count
        ORDER BY ord ASC
      LOOP
        SELECT * INTO v_course FROM public.learn_courses WHERE slug = v_slug AND is_published = true;
        IF FOUND THEN
          INSERT INTO public.course_entitlements (
            user_id, course_slug, access_status, grant_source, expires_at, approved_grant_dot
          )
          VALUES (
            v_uid, v_course.slug, 'active', 'builder_plus_monthly_release', v_expires, v_course.approved_grant_allocation_dot
          )
          ON CONFLICT (user_id, course_slug) DO UPDATE
          SET access_status = CASE
                WHEN EXISTS (
                  SELECT 1 FROM public.learn_course_progress p
                  WHERE p.user_id = v_uid AND p.course_slug = EXCLUDED.course_slug AND p.assessment_passed = true
                ) THEN 'completed_retained'
                ELSE 'active'
              END,
              expires_at = EXCLUDED.expires_at,
              updated_at = now();
        END IF;
      END LOOP;
    END IF;

    -- On downgrade from Pro -> Plus: retain completed courses permanently, pause unqualified non-Leapfrog courses
    UPDATE public.course_entitlements ce
    SET access_status = CASE
          WHEN EXISTS (
            SELECT 1 FROM public.learn_course_progress p
            WHERE p.user_id = v_uid AND p.course_slug = ce.course_slug AND p.assessment_passed = true
          ) THEN 'completed_retained'
          ELSE 'paused_expired'
        END,
        updated_at = now()
    WHERE ce.user_id = v_uid
      AND ce.course_slug <> 'leapfrog'
      AND ce.grant_source = 'builder_pro_full_library'
      AND NOT (
        coalesce(v_leapfrog.assessment_passed, false)
        AND ce.course_slug = ANY(v_sched.release_order[1:greatest(1, v_unlock_count)])
      );

  ELSE
    -- Free / Expired membership: NEVER erase progress/certificates; mark completed as retained and active incomplete as paused_expired
    UPDATE public.course_entitlements ce
    SET access_status = CASE
          WHEN EXISTS (
            SELECT 1 FROM public.learn_course_progress p
            WHERE p.user_id = v_uid AND p.course_slug = ce.course_slug AND p.assessment_passed = true
          ) THEN 'completed_retained'
          ELSE 'paused_expired'
        END,
        updated_at = now()
    WHERE ce.user_id = v_uid;
  END IF;

  INSERT INTO public.learn_audit_logs (actor_id, target_user_id, action, details)
  VALUES (v_uid, v_uid, 'entitlements_synced', jsonb_build_object('plan', v_plan, 'unlocked_cycles', v_unlock_count));

  SELECT coalesce(jsonb_agg(to_jsonb(ce) ORDER BY ce.unlocked_at ASC), '[]'::jsonb)
  INTO v_ent_rows
  FROM public.course_entitlements ce
  WHERE ce.user_id = v_uid;

  RETURN jsonb_build_object('plan', v_plan, 'entitlements', v_ent_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_learn_lesson_progress(
  p_course_slug text,
  p_lesson_id text,
  p_exercise_submission text DEFAULT NULL
)
RETURNS public.learn_course_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ent public.course_entitlements%ROWTYPE;
  v_prog public.learn_course_progress%ROWTYPE;
  v_next_lessons text[];
  v_next_exercises jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ent
  FROM public.course_entitlements
  WHERE user_id = v_uid AND course_slug = p_course_slug AND access_status IN ('active', 'completed_retained');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active course entitlement required for %', p_course_slug USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.learn_course_progress (user_id, course_slug)
  VALUES (v_uid, p_course_slug)
  ON CONFLICT (user_id, course_slug) DO NOTHING;

  SELECT * INTO v_prog
  FROM public.learn_course_progress
  WHERE user_id = v_uid AND course_slug = p_course_slug
  FOR UPDATE;

  v_next_lessons := CASE
    WHEN p_lesson_id IS NOT NULL AND char_length(trim(p_lesson_id)) > 0 AND NOT (p_lesson_id = ANY(v_prog.completed_lesson_ids))
    THEN array_append(v_prog.completed_lesson_ids, left(trim(p_lesson_id), 64))
    ELSE v_prog.completed_lesson_ids
  END;

  v_next_exercises := CASE
    WHEN p_exercise_submission IS NOT NULL AND char_length(trim(p_exercise_submission)) >= 15
    THEN jsonb_set(
      coalesce(v_prog.submitted_exercises, '{}'::jsonb),
      ARRAY[left(trim(p_lesson_id), 64)],
      to_jsonb(left(trim(p_exercise_submission), 2000))
    )
    ELSE coalesce(v_prog.submitted_exercises, '{}'::jsonb)
  END;

  UPDATE public.learn_course_progress
  SET completed_lesson_ids = v_next_lessons,
      submitted_exercises = v_next_exercises,
      milestones_completed = coalesce(array_length(v_next_lessons, 1), 0),
      updated_at = now()
  WHERE id = v_prog.id
  RETURNING * INTO v_prog;

  RETURN v_prog;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_learn_assessment(
  p_course_slug text,
  p_score integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_course public.learn_courses%ROWTYPE;
  v_ent public.course_entitlements%ROWTYPE;
  v_prog public.learn_course_progress%ROWTYPE;
  v_passed boolean := false;
  v_cert_code text;
  v_grant_dot integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_course FROM public.learn_courses WHERE slug = p_course_slug AND is_published = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course not found: %', p_course_slug;
  END IF;

  SELECT * INTO v_ent
  FROM public.course_entitlements
  WHERE user_id = v_uid AND course_slug = p_course_slug AND access_status IN ('active', 'completed_retained')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active course entitlement required before assessment' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prog
  FROM public.learn_course_progress
  WHERE user_id = v_uid AND course_slug = p_course_slug
  FOR UPDATE;

  IF NOT FOUND
     OR coalesce(array_length(v_prog.completed_lesson_ids, 1), 0) < v_course.total_lessons
     OR (SELECT count(*) FROM jsonb_object_keys(coalesce(v_prog.submitted_exercises, '{}'::jsonb))) < v_course.total_exercises
  THEN
    RAISE EXCEPTION 'Complete all required lessons (%) and practical exercises (%) before submitting the assessment',
      v_course.total_lessons, v_course.total_exercises;
  END IF;

  v_passed := greatest(0, least(100, p_score)) >= v_course.min_assessment_score;
  v_cert_code := coalesce(
    v_prog.certificate_code,
    'PING-CERT-' || upper(left(replace(p_course_slug, '-', ''), 6)) || '-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8))
  );

  UPDATE public.learn_course_progress
  SET assessment_attempts = assessment_attempts + 1,
      assessment_score = greatest(coalesce(assessment_score, 0), greatest(0, least(100, p_score))),
      assessment_passed = assessment_passed OR v_passed,
      completed_at = CASE WHEN v_passed AND completed_at IS NULL THEN now() ELSE completed_at END,
      certificate_code = CASE WHEN v_passed THEN v_cert_code ELSE certificate_code END,
      certificate_issued_at = CASE WHEN v_passed AND certificate_issued_at IS NULL THEN now() ELSE certificate_issued_at END,
      updated_at = now()
  WHERE id = v_prog.id
  RETURNING * INTO v_prog;

  IF v_passed THEN
    -- Milestone-based educational grant release via authoritative DOT ledger (NEVER $10,000 lump sum!)
    v_grant_dot := greatest(0, v_ent.approved_grant_dot - v_ent.released_grant_dot);
    IF v_grant_dot > 0 THEN
      INSERT INTO public.dot_wallets (user_id, balance, lifetime_earned)
      VALUES (v_uid, v_grant_dot, v_grant_dot)
      ON CONFLICT (user_id) DO UPDATE
      SET balance = dot_wallets.balance + v_grant_dot,
          lifetime_earned = dot_wallets.lifetime_earned + v_grant_dot,
          updated_at = now();

      INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)
      VALUES (
        v_uid,
        v_grant_dot,
        'bonus',
        'learn_milestone_grant',
        'learn_cert:' || p_course_slug,
        'Ping Learn milestone educational credit for completing ' || v_course.title
      )
      ON CONFLICT DO NOTHING;

      UPDATE public.course_entitlements
      SET access_status = 'completed_retained',
          released_grant_dot = approved_grant_dot,
          updated_at = now()
      WHERE id = v_ent.id;
    ELSE
      UPDATE public.course_entitlements
      SET access_status = 'completed_retained', updated_at = now()
      WHERE id = v_ent.id;
    END IF;

    INSERT INTO public.learn_audit_logs (actor_id, target_user_id, action, course_slug, details)
    VALUES (
      v_uid, v_uid, 'course_completed_certified', p_course_slug,
      jsonb_build_object('score', v_prog.assessment_score, 'certificate_code', v_prog.certificate_code, 'grant_dot_released', v_grant_dot)
    );

    -- Recalculate Builder Plus periodic unlock eligibility immediately upon Leapfrog completion
    PERFORM public.sync_my_learn_entitlements();
  END IF;

  RETURN jsonb_build_object(
    'passed', v_passed,
    'progress', to_jsonb(v_prog),
    'grant_dot_released', v_grant_dot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_course_release_schedule(
  p_require_leapfrog boolean,
  p_interval_days integer,
  p_courses_per_cycle integer,
  p_min_score integer,
  p_release_order text[]
)
RETURNS public.course_release_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.course_release_schedules%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_learn_admin() THEN
    RAISE EXCEPTION 'Ping Learn administrator role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.course_release_schedules
  SET require_leapfrog_completion = coalesce(p_require_leapfrog, true),
      release_interval_days = greatest(7, least(coalesce(p_interval_days, 30), 180)),
      courses_per_cycle = greatest(1, least(coalesce(p_courses_per_cycle, 1), 5)),
      min_assessment_score = greatest(50, least(coalesce(p_min_score, 70), 100)),
      release_order = CASE WHEN coalesce(array_length(p_release_order, 1), 0) > 0 THEN p_release_order ELSE release_order END,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = 'default'
  RETURNING * INTO v_row;

  INSERT INTO public.learn_audit_logs (actor_id, action, details)
  VALUES (auth.uid(), 'release_schedule_updated', to_jsonb(v_row));

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_my_learn_entitlements() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_learn_lesson_progress(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_learn_assessment(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_course_release_schedule(boolean, integer, integer, integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_learn_entitlements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_learn_lesson_progress(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_learn_assessment(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_course_release_schedule(boolean, integer, integer, integer, text[]) TO authenticated;

-- ============================================================================
-- 3. PART B — PING SPOTLIGHT (MERIT EDITORIAL DISCOVERY & DISTRIBUTION)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.spotlight_rubric_config (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  dimensions jsonb NOT NULL DEFAULT '[
    {"key":"story_authenticity","label":"Story Quality & Authenticity","weight":15},
    {"key":"execution_evidence","label":"Evidence of Actual Execution","weight":20},
    {"key":"innovation_originality","label":"Innovation & Originality","weight":12},
    {"key":"business_traction","label":"Business Progress & Traction","weight":15},
    {"key":"problem_relevance","label":"Relevance of Problem Addressed","weight":12},
    {"key":"economic_social_impact","label":"Economic or Social Impact","weight":10},
    {"key":"growth_potential","label":"Potential for Future Growth","weight":8},
    {"key":"documentation_quality","label":"Communication & Documentation","weight":8}
  ]'::jsonb,
  monthly_selection_capacity integer CHECK (monthly_selection_capacity IS NULL OR monthly_selection_capacity >= 0),
  notification_frequency_cap_days integer NOT NULL DEFAULT 7 CHECK (notification_frequency_cap_days BETWEEN 1 AND 30),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.spotlight_rubric_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.spotlight_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('ping', 'moment', 'clip', 'profile', 'business', 'hub', 'community_nomination', 'founder_submission', 'editorial_discovery')
  ),
  source_ref_id text,
  headline text NOT NULL CHECK (char_length(trim(headline)) BETWEEN 3 AND 160),
  story_pitch text NOT NULL CHECK (char_length(trim(story_pitch)) BETWEEN 10 AND 4000),
  problem_statement text NOT NULL DEFAULT '' CHECK (char_length(problem_statement) <= 1500),
  traction_evidence text NOT NULL DEFAULT '' CHECK (char_length(traction_evidence) <= 1500),
  evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  is_private_submission boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('discovered', 'submitted', 'under_review', 'shortlisted', 'selected', 'published', 'declined', 'retracted')
  ),
  pro_verified_at timestamptz,
  ai_advisory_summary text,
  human_approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  human_approved_at timestamptz,
  selection_reason text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spotlight_candidates_status_idx
  ON public.spotlight_candidates (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.spotlight_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.spotlight_candidates(id) ON DELETE CASCADE,
  nominator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nomination_reason text NOT NULL CHECK (char_length(trim(nomination_reason)) BETWEEN 10 AND 1200),
  supporting_links text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, nominator_id)
);

CREATE TABLE IF NOT EXISTS public.spotlight_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.spotlight_candidates(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  weighted_total numeric(5,2) NOT NULL DEFAULT 0 CHECK (weighted_total BETWEEN 0 AND 100),
  internal_notes text NOT NULL DEFAULT '' CHECK (char_length(internal_notes) <= 2500),
  recommendation text NOT NULL DEFAULT 'review' CHECK (recommendation IN ('strong_select', 'shortlist', 'review', 'decline')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, evaluator_id)
);

CREATE TABLE IF NOT EXISTS public.spotlight_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  candidate_id uuid UNIQUE REFERENCES public.spotlight_candidates(id) ON DELETE SET NULL,
  founder_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 160),
  editorial_intro text NOT NULL DEFAULT '' CHECK (char_length(editorial_intro) <= 1000),
  founder_portrait_url text,
  founder_story text NOT NULL CHECK (char_length(trim(founder_story)) >= 20),
  business_description text NOT NULL DEFAULT '',
  problem_solved text NOT NULL DEFAULT '',
  product_solution text NOT NULL DEFAULT '',
  evidence_achievements text[] NOT NULL DEFAULT '{}'::text[],
  media_urls text[] NOT NULL DEFAULT '{}'::text[],
  video_interview_url text,
  featured_ping_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  featured_clip_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  featured_moment_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  dot_tags text[] NOT NULL DEFAULT '{}'::text[],
  template_layout text NOT NULL DEFAULT 'editorial_feature' CHECK (
    template_layout IN ('editorial_feature', 'video_interview', 'builder_case_study')
  ),
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'scheduled', 'published', 'corrected', 'retracted')
  ),
  published_by_official_account boolean NOT NULL DEFAULT true,
  distribution_config jsonb NOT NULL DEFAULT '{"home_feed":true,"explore":true,"official_account":true,"notify_eligible":false,"frequency_cap_days":7}'::jsonb,
  scheduled_for timestamptz,
  published_at timestamptz,
  retracted_at timestamptz,
  correction_note text NOT NULL DEFAULT '',
  editor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spotlight_publications_status_idx
  ON public.spotlight_publications (status, published_at DESC);

CREATE TABLE IF NOT EXISTS public.spotlight_distribution_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.spotlight_publications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (
    channel IN ('official_account', 'home_feed', 'explore', 'topic_feed', 'clip_promo', 'notification')
  ),
  impressions_count integer NOT NULL DEFAULT 0 CHECK (impressions_count >= 0),
  views_count integer NOT NULL DEFAULT 0 CHECK (views_count >= 0),
  clicks_count integer NOT NULL DEFAULT 0 CHECK (clicks_count >= 0),
  shares_count integer NOT NULL DEFAULT 0 CHECK (shares_count >= 0),
  notifications_sent integer NOT NULL DEFAULT 0 CHECK (notifications_sent >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, channel)
);

CREATE TABLE IF NOT EXISTS public.spotlight_editorial_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (char_length(trim(action)) BETWEEN 3 AND 80),
  target_type text NOT NULL CHECK (target_type IN ('candidate', 'evaluation', 'publication', 'rubric', 'distribution')),
  target_id uuid,
  reason text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spotlight_rubric_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_distribution_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_editorial_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.spotlight_rubric_config, public.spotlight_candidates, public.spotlight_nominations,
  public.spotlight_evaluations, public.spotlight_publications, public.spotlight_distribution_records,
  public.spotlight_editorial_audit_logs
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.spotlight_rubric_config, public.spotlight_publications, public.spotlight_distribution_records TO anon, authenticated;
GRANT SELECT, UPDATE ON public.spotlight_candidates TO authenticated;
GRANT SELECT ON public.spotlight_nominations, public.spotlight_evaluations, public.spotlight_editorial_audit_logs TO authenticated;

DROP POLICY IF EXISTS "Spotlight rubric readable" ON public.spotlight_rubric_config;
CREATE POLICY "Spotlight rubric readable" ON public.spotlight_rubric_config
  FOR SELECT TO anon, authenticated
  USING (id = 'default');

DROP POLICY IF EXISTS "Founders and editors read spotlight candidates" ON public.spotlight_candidates;
CREATE POLICY "Founders and editors read spotlight candidates" ON public.spotlight_candidates
  FOR SELECT TO authenticated
  USING (auth.uid() = founder_id OR auth.uid() = created_by OR public.is_spotlight_editor());

DROP POLICY IF EXISTS "Founders edit own draft submissions" ON public.spotlight_candidates;
CREATE POLICY "Founders edit own draft submissions" ON public.spotlight_candidates
  FOR UPDATE TO authenticated
  USING (auth.uid() = founder_id AND status IN ('submitted', 'under_review'))
  WITH CHECK (auth.uid() = founder_id AND status IN ('submitted', 'under_review'));

DROP POLICY IF EXISTS "Nominators and editors read nominations" ON public.spotlight_nominations;
CREATE POLICY "Nominators and editors read nominations" ON public.spotlight_nominations
  FOR SELECT TO authenticated
  USING (auth.uid() = nominator_id OR public.is_spotlight_editor());

DROP POLICY IF EXISTS "Editors read spotlight evaluations" ON public.spotlight_evaluations;
CREATE POLICY "Editors read spotlight evaluations" ON public.spotlight_evaluations
  FOR SELECT TO authenticated
  USING (public.is_spotlight_editor());

DROP POLICY IF EXISTS "Published spotlight stories publicly readable" ON public.spotlight_publications;
CREATE POLICY "Published spotlight stories publicly readable" ON public.spotlight_publications
  FOR SELECT TO anon, authenticated
  USING (status IN ('published', 'corrected') OR (auth.uid() IS NOT NULL AND (public.is_spotlight_editor() OR auth.uid() = founder_id)));

DROP POLICY IF EXISTS "Published spotlight distribution stats readable" ON public.spotlight_distribution_records;
CREATE POLICY "Published spotlight distribution stats readable" ON public.spotlight_distribution_records
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.spotlight_publications sp
      WHERE sp.id = spotlight_distribution_records.publication_id
        AND (sp.status IN ('published', 'corrected') OR (auth.uid() IS NOT NULL AND public.is_spotlight_editor()))
    )
  );

DROP POLICY IF EXISTS "Editors read spotlight audit trail" ON public.spotlight_editorial_audit_logs;
CREATE POLICY "Editors read spotlight audit trail" ON public.spotlight_editorial_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_spotlight_editor());

-- Pro-gated Spotlight founder submission RPC
CREATE OR REPLACE FUNCTION public.submit_spotlight_story(
  p_headline text,
  p_story_pitch text,
  p_problem_statement text DEFAULT '',
  p_traction_evidence text DEFAULT '',
  p_business_id uuid DEFAULT NULL,
  p_evidence_urls text[] DEFAULT '{}'::text[]
)
RETURNS public.spotlight_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.spotlight_candidates%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_active_pro_membership(v_uid) THEN
    RAISE EXCEPTION 'An active Builder Pro membership is required to enter Ping Spotlight consideration (eligibility does not guarantee selection)' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.spotlight_candidates (
    founder_id, business_id, source_type, headline, story_pitch,
    problem_statement, traction_evidence, evidence_urls,
    is_private_submission, status, pro_verified_at, created_by
  )
  VALUES (
    v_uid, p_business_id, 'founder_submission',
    left(trim(p_headline), 160),
    left(trim(p_story_pitch), 4000),
    left(coalesce(trim(p_problem_statement), ''), 1500),
    left(coalesce(trim(p_traction_evidence), ''), 1500),
    coalesce(p_evidence_urls[1:6], '{}'::text[]),
    true, 'submitted', now(), v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Community / editorial nomination RPC (verifies nominee holds active Pro membership!)
CREATE OR REPLACE FUNCTION public.nominate_for_spotlight(
  p_founder_id uuid,
  p_reason text,
  p_source_type text DEFAULT 'community_nomination',
  p_source_ref_id text DEFAULT NULL,
  p_business_id uuid DEFAULT NULL,
  p_supporting_links text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cand public.spotlight_candidates%ROWTYPE;
  v_nom public.spotlight_nominations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_active_pro_membership(p_founder_id) THEN
    RAISE EXCEPTION 'Only members with an active Builder Pro membership are eligible for Ping Spotlight consideration' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cand
  FROM public.spotlight_candidates
  WHERE founder_id = p_founder_id
    AND status IN ('discovered', 'submitted', 'under_review', 'shortlisted')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.spotlight_candidates (
      founder_id, business_id, source_type, source_ref_id,
      headline, story_pitch, is_private_submission, status, pro_verified_at, created_by
    )
    VALUES (
      p_founder_id, p_business_id,
      CASE WHEN p_source_type IN ('ping','moment','clip','profile','business','hub','community_nomination','editorial_discovery')
           THEN p_source_type ELSE 'community_nomination' END,
      p_source_ref_id,
      'Community Nominated Founder',
      left(trim(p_reason), 4000),
      true,
      CASE WHEN public.is_spotlight_editor() THEN 'discovered' ELSE 'submitted' END,
      now(), v_uid
    )
    RETURNING * INTO v_cand;
  END IF;

  INSERT INTO public.spotlight_nominations (candidate_id, nominator_id, nomination_reason, supporting_links)
  VALUES (v_cand.id, v_uid, left(trim(p_reason), 1200), coalesce(p_supporting_links[1:5], '{}'::text[]))
  ON CONFLICT (candidate_id, nominator_id) DO UPDATE
  SET nomination_reason = EXCLUDED.nomination_reason,
      supporting_links = EXCLUDED.supporting_links
  RETURNING * INTO v_nom;

  RETURN jsonb_build_object('candidate', to_jsonb(v_cand), 'nomination', to_jsonb(v_nom));
END;
$$;

-- Human Editorial Scoring & Selection Decision RPC (Gated strictly by is_spotlight_editor())
CREATE OR REPLACE FUNCTION public.editor_decide_spotlight_candidate(
  p_candidate_id uuid,
  p_status text,
  p_selection_reason text,
  p_scores jsonb DEFAULT NULL,
  p_weighted_total numeric DEFAULT NULL,
  p_internal_notes text DEFAULT ''
)
RETURNS public.spotlight_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_editor uuid := auth.uid();
  v_cand public.spotlight_candidates%ROWTYPE;
BEGIN
  IF v_editor IS NULL OR NOT public.is_spotlight_editor() THEN
    RAISE EXCEPTION 'Spotlight editorial role required (separated from financial administration)' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('under_review', 'shortlisted', 'selected', 'declined', 'retracted') THEN
    RAISE EXCEPTION 'Invalid Spotlight decision status';
  END IF;

  IF char_length(trim(coalesce(p_selection_reason, ''))) < 8 THEN
    RAISE EXCEPTION 'Human editorial decision requires a documented reason (minimum 8 characters)';
  END IF;

  SELECT * INTO v_cand FROM public.spotlight_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spotlight candidate not found';
  END IF;

  IF p_status = 'selected' AND NOT public.has_active_pro_membership(v_cand.founder_id) THEN
    RAISE EXCEPTION 'Candidate does not hold an active qualifying Builder Pro membership';
  END IF;

  IF p_scores IS NOT NULL THEN
    INSERT INTO public.spotlight_evaluations (
      candidate_id, evaluator_id, scores, weighted_total, internal_notes, recommendation
    )
    VALUES (
      p_candidate_id, v_editor, p_scores,
      greatest(0, least(100, coalesce(p_weighted_total, 0))),
      left(coalesce(p_internal_notes, ''), 2500),
      CASE WHEN p_status = 'selected' THEN 'strong_select' WHEN p_status = 'shortlisted' THEN 'shortlist' WHEN p_status = 'declined' THEN 'decline' ELSE 'review' END
    )
    ON CONFLICT (candidate_id, evaluator_id) DO UPDATE
    SET scores = EXCLUDED.scores,
        weighted_total = EXCLUDED.weighted_total,
        internal_notes = EXCLUDED.internal_notes,
        recommendation = EXCLUDED.recommendation,
        updated_at = now();
  END IF;

  UPDATE public.spotlight_candidates
  SET status = p_status,
      human_approved_by = CASE WHEN p_status = 'selected' THEN v_editor ELSE human_approved_by END,
      human_approved_at = CASE WHEN p_status = 'selected' THEN now() ELSE human_approved_at END,
      selection_reason = left(trim(p_selection_reason), 1000),
      updated_at = now()
  WHERE id = p_candidate_id
  RETURNING * INTO v_cand;

  INSERT INTO public.spotlight_editorial_audit_logs (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (
    v_editor, 'candidate_' || p_status, 'candidate', p_candidate_id,
    left(trim(p_selection_reason), 500),
    jsonb_build_object('weighted_total', p_weighted_total)
  );

  RETURN v_cand;
END;
$$;

-- Official Spotlight Publication, Correction & Retraction RPC
CREATE OR REPLACE FUNCTION public.editor_publish_spotlight(
  p_slug text,
  p_candidate_id uuid,
  p_founder_id uuid,
  p_business_id uuid,
  p_title text,
  p_editorial_intro text,
  p_founder_story text,
  p_business_description text,
  p_problem_solved text,
  p_product_solution text,
  p_evidence_achievements text[],
  p_featured_ping_ids uuid[],
  p_featured_clip_ids uuid[],
  p_dot_tags text[],
  p_video_interview_url text DEFAULT NULL,
  p_founder_portrait_url text DEFAULT NULL,
  p_status text DEFAULT 'published',
  p_correction_note text DEFAULT ''
)
RETURNS public.spotlight_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_editor uuid := auth.uid();
  v_pub public.spotlight_publications%ROWTYPE;
BEGIN
  IF v_editor IS NULL OR NOT public.is_spotlight_editor() THEN
    RAISE EXCEPTION 'Spotlight editorial role required to publish official features' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('draft', 'scheduled', 'published', 'corrected', 'retracted') THEN
    RAISE EXCEPTION 'Invalid publication status';
  END IF;

  INSERT INTO public.spotlight_publications (
    slug, candidate_id, founder_id, business_id, title, editorial_intro,
    founder_portrait_url, founder_story, business_description, problem_solved, product_solution,
    evidence_achievements, featured_ping_ids, featured_clip_ids, dot_tags, video_interview_url,
    status, published_by_official_account, published_at, retracted_at, correction_note, editor_id
  )
  VALUES (
    lower(trim(p_slug)), p_candidate_id, p_founder_id, p_business_id,
    left(trim(p_title), 160), left(coalesce(trim(p_editorial_intro), ''), 1000),
    p_founder_portrait_url, trim(p_founder_story),
    coalesce(trim(p_business_description), ''), coalesce(trim(p_problem_solved), ''), coalesce(trim(p_product_solution), ''),
    coalesce(p_evidence_achievements, '{}'::text[]), coalesce(p_featured_ping_ids, '{}'::uuid[]),
    coalesce(p_featured_clip_ids, '{}'::uuid[]), coalesce(p_dot_tags, '{}'::text[]),
    p_video_interview_url, p_status, true,
    CASE WHEN p_status IN ('published', 'corrected') THEN now() ELSE NULL END,
    CASE WHEN p_status = 'retracted' THEN now() ELSE NULL END,
    left(coalesce(trim(p_correction_note), ''), 800),
    v_editor
  )
  ON CONFLICT (slug) DO UPDATE
  SET title = EXCLUDED.title,
      editorial_intro = EXCLUDED.editorial_intro,
      founder_portrait_url = coalesce(EXCLUDED.founder_portrait_url, spotlight_publications.founder_portrait_url),
      founder_story = EXCLUDED.founder_story,
      business_description = EXCLUDED.business_description,
      problem_solved = EXCLUDED.problem_solved,
      product_solution = EXCLUDED.product_solution,
      evidence_achievements = EXCLUDED.evidence_achievements,
      featured_ping_ids = EXCLUDED.featured_ping_ids,
      featured_clip_ids = EXCLUDED.featured_clip_ids,
      dot_tags = EXCLUDED.dot_tags,
      video_interview_url = EXCLUDED.video_interview_url,
      status = EXCLUDED.status,
      published_at = coalesce(spotlight_publications.published_at, EXCLUDED.published_at),
      retracted_at = CASE WHEN EXCLUDED.status = 'retracted' THEN now() ELSE NULL END,
      correction_note = EXCLUDED.correction_note,
      editor_id = v_editor,
      updated_at = now()
  RETURNING * INTO v_pub;

  IF p_candidate_id IS NOT NULL AND p_status IN ('published', 'corrected') THEN
    UPDATE public.spotlight_candidates
    SET status = 'published', updated_at = now()
    WHERE id = p_candidate_id;
  END IF;

  -- Seed zeroed real distribution channels (never fabricate metrics!)
  INSERT INTO public.spotlight_distribution_records (publication_id, channel)
  VALUES (v_pub.id, 'official_account'), (v_pub.id, 'home_feed'), (v_pub.id, 'explore')
  ON CONFLICT (publication_id, channel) DO NOTHING;

  INSERT INTO public.spotlight_editorial_audit_logs (actor_id, action, target_type, target_id, reason)
  VALUES (v_editor, 'publication_' || p_status, 'publication', v_pub.id, coalesce(NULLIF(trim(p_correction_note), ''), v_pub.title));

  RETURN v_pub;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_spotlight_event(
  p_publication_id uuid,
  p_channel text,
  p_event_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_channel NOT IN ('official_account', 'home_feed', 'explore', 'topic_feed', 'clip_promo', 'notification') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.spotlight_publications WHERE id = p_publication_id AND status IN ('published', 'corrected')) THEN
    RETURN;
  END IF;

  INSERT INTO public.spotlight_distribution_records (publication_id, channel)
  VALUES (p_publication_id, p_channel)
  ON CONFLICT (publication_id, channel) DO NOTHING;

  UPDATE public.spotlight_distribution_records
  SET impressions_count = impressions_count + CASE WHEN p_event_type = 'impression' THEN 1 ELSE 0 END,
      views_count = views_count + CASE WHEN p_event_type = 'view' THEN 1 ELSE 0 END,
      clicks_count = clicks_count + CASE WHEN p_event_type = 'click' THEN 1 ELSE 0 END,
      shares_count = shares_count + CASE WHEN p_event_type = 'share' THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE publication_id = p_publication_id AND channel = p_channel;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_spotlight_story(text, text, text, text, uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nominate_for_spotlight(uuid, text, text, text, uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editor_decide_spotlight_candidate(uuid, text, text, jsonb, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editor_publish_spotlight(text, uuid, uuid, uuid, text, text, text, text, text, text, text[], uuid[], uuid[], text[], text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_spotlight_event(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_spotlight_story(text, text, text, text, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nominate_for_spotlight(uuid, text, text, text, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editor_decide_spotlight_candidate(uuid, text, text, jsonb, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editor_publish_spotlight(text, uuid, uuid, uuid, text, text, text, text, text, text, text[], uuid[], uuid[], text[], text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_spotlight_event(uuid, text, text) TO anon, authenticated;

-- ============================================================================
-- 4. PART C — PING CLIPS & MOMENTS-TO-CLIPS WORKFLOW
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ping_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_url text NOT NULL CHECK (char_length(trim(video_url)) >= 8),
  poster_url text,
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 1000),
  captions_text text,
  duration_sec integer CHECK (duration_sec IS NULL OR (duration_sec BETWEEN 1 AND 180)),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'hub')),
  dot_tags text[] NOT NULL DEFAULT '{}'::text[],
  source_moment_id uuid REFERENCES public.moments(id) ON DELETE SET NULL,
  linked_ping_id uuid REFERENCES public.pings(id) ON DELETE SET NULL,
  processing_status text NOT NULL DEFAULT 'ready' CHECK (processing_status IN ('uploading', 'processing', 'ready', 'failed')),
  views_count integer NOT NULL DEFAULT 0 CHECK (views_count >= 0),
  likes_count integer NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  replies_count integer NOT NULL DEFAULT 0 CHECK (replies_count >= 0),
  shares_count integer NOT NULL DEFAULT 0 CHECK (shares_count >= 0),
  saves_count integer NOT NULL DEFAULT 0 CHECK (saves_count >= 0),
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ping_clips_feed_idx ON public.ping_clips (created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS ping_clips_dot_tags_gin_idx ON public.ping_clips USING GIN (dot_tags);

CREATE TABLE IF NOT EXISTS public.clip_media_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.ping_clips(id) ON DELETE CASCADE,
  related_type text NOT NULL CHECK (related_type IN ('moment', 'ping', 'spotlight', 'hub', 'business')),
  related_id uuid NOT NULL,
  original_creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship_kind text NOT NULL DEFAULT 'republished_from' CHECK (
    relationship_kind IN ('republished_from', 'featured_in_spotlight', 'linked_ping', 'hub_feature', 'business_showcase')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clip_id, related_type, related_id)
);

CREATE TABLE IF NOT EXISTS public.clip_likes (
  clip_id uuid NOT NULL REFERENCES public.ping_clips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clip_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.clip_saves (
  clip_id uuid NOT NULL REFERENCES public.ping_clips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clip_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.clip_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.ping_clips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clip_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.ping_clips(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 200),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ping_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_media_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ping_clips, public.clip_media_relationships, public.clip_likes, public.clip_saves, public.clip_replies, public.clip_reports
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.ping_clips, public.clip_media_relationships, public.clip_replies TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ping_clips TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.clip_likes, public.clip_saves TO authenticated;
GRANT INSERT, DELETE ON public.clip_replies TO authenticated;
GRANT SELECT, INSERT ON public.clip_reports TO authenticated;

DROP POLICY IF EXISTS "Public and authorized clips readable" ON public.ping_clips;
CREATE POLICY "Public and authorized clips readable" ON public.ping_clips
  FOR SELECT TO anon, authenticated
  USING (
    (hidden_at IS NULL AND visibility = 'public')
    OR (auth.uid() IS NOT NULL AND (auth.uid() = creator_id OR public.is_ping_admin() OR public.is_spotlight_editor()))
    OR (
      auth.uid() IS NOT NULL
      AND hidden_at IS NULL
      AND visibility = 'followers'
      AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.following_id = ping_clips.creator_id)
    )
  );

DROP POLICY IF EXISTS "Creators publish own clips" ON public.ping_clips;
CREATE POLICY "Creators publish own clips" ON public.ping_clips
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id AND hidden_at IS NULL);

DROP POLICY IF EXISTS "Creators update own clips" ON public.ping_clips;
CREATE POLICY "Creators update own clips" ON public.ping_clips
  FOR UPDATE TO authenticated
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators delete own clips" ON public.ping_clips;
CREATE POLICY "Creators delete own clips" ON public.ping_clips
  FOR DELETE TO authenticated
  USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Clip media relationships readable for visible clips" ON public.clip_media_relationships;
CREATE POLICY "Clip media relationships readable for visible clips" ON public.clip_media_relationships
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ping_clips c
      WHERE c.id = clip_media_relationships.clip_id
        AND ((c.hidden_at IS NULL AND c.visibility = 'public') OR (auth.uid() IS NOT NULL AND (c.creator_id = auth.uid() OR public.is_spotlight_editor())))
    )
  );

DROP POLICY IF EXISTS "Users manage own clip likes" ON public.clip_likes;
CREATE POLICY "Users manage own clip likes" ON public.clip_likes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own clip saves" ON public.clip_saves;
CREATE POLICY "Users manage own clip saves" ON public.clip_saves
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Visible clip replies readable" ON public.clip_replies;
CREATE POLICY "Visible clip replies readable" ON public.clip_replies
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.ping_clips c WHERE c.id = clip_replies.clip_id AND c.hidden_at IS NULL)
  );

DROP POLICY IF EXISTS "Authenticated users reply to visible clips" ON public.clip_replies;
CREATE POLICY "Authenticated users reply to visible clips" ON public.clip_replies
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own clip replies" ON public.clip_replies;
CREATE POLICY "Users delete own clip replies" ON public.clip_replies
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Reporters and admins read clip reports" ON public.clip_reports;
CREATE POLICY "Reporters and admins read clip reports" ON public.clip_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.is_ping_admin());

DROP POLICY IF EXISTS "Users submit clip reports" ON public.clip_reports;
CREATE POLICY "Users submit clip reports" ON public.clip_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- Explicit Moments-to-Clips Conversion RPC (Never automatic; preserves creator attribution & media permissions)
CREATE OR REPLACE FUNCTION public.publish_moment_as_clip(
  p_moment_id uuid,
  p_caption text DEFAULT NULL,
  p_visibility text DEFAULT 'public',
  p_dot_tags text[] DEFAULT '{}'::text[]
)
RETURNS public.ping_clips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_moment public.moments%ROWTYPE;
  v_clip public.ping_clips%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_visibility NOT IN ('public', 'followers', 'hub') THEN
    RAISE EXCEPTION 'Invalid Clip visibility';
  END IF;

  SELECT * INTO v_moment
  FROM public.moments
  WHERE id = p_moment_id AND author_id = v_uid AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moment not found or you are not the original creator' USING ERRCODE = '42501';
  END IF;

  IF v_moment.media_type <> 'video' THEN
    RAISE EXCEPTION 'Only video Moments can be republished as Ping Clips';
  END IF;

  IF v_moment.audience = 'close_circle' AND p_visibility = 'public' THEN
    RAISE EXCEPTION 'Close Circle Moments cannot be republished publicly without changing Moment privacy first';
  END IF;

  INSERT INTO public.ping_clips (
    creator_id, video_url, caption, duration_sec, visibility, dot_tags, source_moment_id, processing_status
  )
  VALUES (
    v_moment.author_id,
    v_moment.media_url,
    left(coalesce(NULLIF(trim(p_caption), ''), v_moment.caption, ''), 1000),
    greatest(1, least(180, coalesce(v_moment.duration, 15))),
    p_visibility,
    coalesce(p_dot_tags[1:8], '{}'::text[]),
    v_moment.id,
    'ready'
  )
  RETURNING * INTO v_clip;

  INSERT INTO public.clip_media_relationships (
    clip_id, related_type, related_id, original_creator_id, relationship_kind
  )
  VALUES (v_clip.id, 'moment', v_moment.id, v_moment.author_id, 'republished_from')
  ON CONFLICT (clip_id, related_type, related_id) DO NOTHING;

  RETURN v_clip;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_clip_view(p_clip_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_views integer;
BEGIN
  UPDATE public.ping_clips
  SET views_count = views_count + 1, updated_at = now()
  WHERE id = p_clip_id AND hidden_at IS NULL
  RETURNING views_count INTO v_views;
  RETURN coalesce(v_views, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_moment_as_clip(uuid, text, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_clip_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_moment_as_clip(uuid, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_clip_view(uuid) TO anon, authenticated;
