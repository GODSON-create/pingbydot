-- 0035_admin_control_centre_and_early_access.sql
-- PING WORKSTREAM 1 & 2:
--   1. Appointment-Based Administrator Access & Platform Owner Governance
--      (7 configurable roles, per-user permission overrides, immutable appointment ledger,
--      anti-self-escalation, least-privilege server enforcement).
--   2. Real Presence Heartbeats (reliable online-now / DAU / WAU / MAU telemetry).
--   3. System Health & Error/Background Job Telemetry (`system_error_logs`).
--   4. Early-Access Registration & Multi-Website Download Attribution (`early_access_registrations`,
--      `download_attribution_events`).
--   5. Aggregate Admin Control Centre Metrics RPC (`admin_control_centre_metrics`) — strictly
--      service_role-only, zero private message content exposure.
--
-- Forward-only, idempotent, strict RLS (zero open USING (true) policies).

-- ============================================================================
-- 1. EXTEND `public.user_roles` FOR 7 CONFIGURABLE ROLES + PLATFORM OWNER
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
  CHECK (
    role IN (
      'platform_owner',
      'admin',
      'moderator',
      'support',
      'analyst',
      'finance_admin',
      'community_admin',
      'spotlight_editor',
      'financial_admin',
      'learn_admin'
    )
  );

-- Reinforce zero direct client writes on public.user_roles
REVOKE ALL ON public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- ============================================================================
-- 2. ROLE PERMISSIONS MATRIX, PER-USER OVERRIDES & APPOINTMENT LEDGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role text NOT NULL CHECK (
    role IN (
      'platform_owner',
      'admin',
      'moderator',
      'support',
      'analyst',
      'finance_admin',
      'community_admin',
      'spotlight_editor',
      'financial_admin',
      'learn_admin'
    )
  ),
  permission text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS public.admin_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('grant', 'revoke')),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission)
);

CREATE TABLE IF NOT EXISTS public.admin_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (
    role IN (
      'platform_owner',
      'admin',
      'moderator',
      'support',
      'analyst',
      'finance_admin',
      'community_admin',
      'spotlight_editor',
      'financial_admin',
      'learn_admin'
    )
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  appointed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  appointment_reason text NOT NULL DEFAULT '',
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revocation_reason text NOT NULL DEFAULT '',
  appointed_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS admin_appointments_user_status_idx
  ON public.admin_appointments (user_id, status, appointed_at DESC);
CREATE INDEX IF NOT EXISTS admin_user_permissions_user_idx
  ON public.admin_user_permissions (user_id);

-- Seed canonical least-privilege role permission matrix (idempotent)
INSERT INTO public.admin_role_permissions (role, permission, description)
VALUES
  -- Platform Owner: all permissions
  ('platform_owner', 'overview.view', 'View platform overview'),
  ('platform_owner', 'people.view', 'View people & accounts'),
  ('platform_owner', 'people.verify', 'Review identity & business verification'),
  ('platform_owner', 'content.view', 'View content & reports'),
  ('platform_owner', 'content.moderate', 'Moderate content & resolve reports'),
  ('platform_owner', 'communities.view', 'View Hubs & Signals'),
  ('platform_owner', 'communities.manage', 'Manage Signal verification & communities'),
  ('platform_owner', 'communications.view_metrics', 'View aggregate messaging delivery metrics'),
  ('platform_owner', 'economy.view', 'View DOT economy & subscriptions'),
  ('platform_owner', 'economy.manage_plans', 'Configure membership plans'),
  ('platform_owner', 'economy.moderate_boosts', 'Moderate & refund boost campaigns'),
  ('platform_owner', 'business.view', 'View business profiles & enquiries'),
  ('platform_owner', 'business.manage', 'Manage business verification & commercial tools'),
  ('platform_owner', 'growth.view', 'View referrals, downloads & early access'),
  ('platform_owner', 'learn.manage_schedule', 'Configure Ping Learn course schedule'),
  ('platform_owner', 'system.view_health', 'View system health & error logs'),
  ('platform_owner', 'admin.view_staff', 'View appointed administrators'),
  ('platform_owner', 'admin.view_audit', 'View full admin audit log'),
  ('platform_owner', 'admin.appoint_admins', 'Appoint administrators'),
  ('platform_owner', 'admin.revoke_admins', 'Revoke administrator access'),
  ('platform_owner', 'admin.manage_permissions', 'Manage individual per-user permissions'),

  -- Administrator: broad operational access, NO default admin appointment/revocation
  ('admin', 'overview.view', 'View platform overview'),
  ('admin', 'people.view', 'View people & accounts'),
  ('admin', 'people.verify', 'Review identity & business verification'),
  ('admin', 'content.view', 'View content & reports'),
  ('admin', 'content.moderate', 'Moderate content & resolve reports'),
  ('admin', 'communities.view', 'View Hubs & Signals'),
  ('admin', 'communities.manage', 'Manage Signal verification & communities'),
  ('admin', 'communications.view_metrics', 'View aggregate messaging delivery metrics'),
  ('admin', 'economy.view', 'View DOT economy & subscriptions'),
  ('admin', 'economy.manage_plans', 'Configure membership plans'),
  ('admin', 'economy.moderate_boosts', 'Moderate & refund boost campaigns'),
  ('admin', 'business.view', 'View business profiles & enquiries'),
  ('admin', 'business.manage', 'Manage business verification & commercial tools'),
  ('admin', 'growth.view', 'View referrals, downloads & early access'),
  ('admin', 'learn.manage_schedule', 'Configure Ping Learn course schedule'),
  ('admin', 'system.view_health', 'View system health & error logs'),
  ('admin', 'admin.view_staff', 'View appointed administrators'),
  ('admin', 'admin.view_audit', 'View admin audit log'),

  -- Moderator: trust & safety moderation only
  ('moderator', 'overview.view', 'View platform overview'),
  ('moderator', 'content.view', 'View content & reports'),
  ('moderator', 'content.moderate', 'Moderate content & resolve reports'),
  ('moderator', 'communities.view', 'View Hubs & Signals'),
  ('moderator', 'admin.view_audit', 'View moderation audit log'),

  -- Support: accounts, verification review, messaging delivery health, early access
  ('support', 'overview.view', 'View platform overview'),
  ('support', 'people.view', 'View people & accounts'),
  ('support', 'people.verify', 'Review identity & business verification'),
  ('support', 'communications.view_metrics', 'View aggregate messaging delivery metrics'),
  ('support', 'business.view', 'View business profiles & enquiries'),
  ('support', 'growth.view', 'View referrals, downloads & early access'),
  ('support', 'system.view_health', 'View system health & error logs'),

  -- Analyst: strictly read-only across analytics modules (zero mutation permissions)
  ('analyst', 'overview.view', 'View platform overview'),
  ('analyst', 'people.view', 'View people & accounts'),
  ('analyst', 'content.view', 'View content & reports'),
  ('analyst', 'communities.view', 'View Hubs & Signals'),
  ('analyst', 'communications.view_metrics', 'View aggregate messaging delivery metrics'),
  ('analyst', 'economy.view', 'View DOT economy & subscriptions'),
  ('analyst', 'business.view', 'View business profiles & enquiries'),
  ('analyst', 'growth.view', 'View referrals, downloads & early access'),
  ('analyst', 'system.view_health', 'View system health & error logs'),

  -- Finance Administrator: DOT economy, membership plans, boosts, business
  ('finance_admin', 'overview.view', 'View platform overview'),
  ('finance_admin', 'economy.view', 'View DOT economy & subscriptions'),
  ('finance_admin', 'economy.manage_plans', 'Configure membership plans'),
  ('finance_admin', 'economy.moderate_boosts', 'Moderate & refund boost campaigns'),
  ('finance_admin', 'business.view', 'View business profiles & enquiries'),
  ('finance_admin', 'business.manage', 'Manage business verification & commercial tools'),
  ('finance_admin', 'admin.view_audit', 'View audit log'),

  -- Community Administrator: Hubs, Signals, Ping Learn schedule, community moderation
  ('community_admin', 'overview.view', 'View platform overview'),
  ('community_admin', 'people.view', 'View people & accounts'),
  ('community_admin', 'content.view', 'View content & reports'),
  ('community_admin', 'content.moderate', 'Moderate content & resolve reports'),
  ('community_admin', 'communities.view', 'View Hubs & Signals'),
  ('community_admin', 'communities.manage', 'Manage Signal verification & communities'),
  ('community_admin', 'growth.view', 'View referrals, downloads & early access'),
  ('community_admin', 'learn.manage_schedule', 'Configure Ping Learn course schedule'),

  -- Legacy 0034 aliases mapped safely
  ('financial_admin', 'overview.view', 'View platform overview'),
  ('financial_admin', 'economy.view', 'View DOT economy & subscriptions'),
  ('financial_admin', 'economy.manage_plans', 'Configure membership plans'),
  ('financial_admin', 'economy.moderate_boosts', 'Moderate & refund boost campaigns'),
  ('learn_admin', 'overview.view', 'View platform overview'),
  ('learn_admin', 'growth.view', 'View growth & learning metrics'),
  ('learn_admin', 'learn.manage_schedule', 'Configure Ping Learn course schedule')
ON CONFLICT (role, permission) DO NOTHING;

-- ============================================================================
-- 3. AUTHORIZATION HELPER FUNCTIONS (SERVER-VERIFIED LEAST PRIVILEGE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'platform_owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ping_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('platform_owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_admin_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN (
        'platform_owner',
        'admin',
        'moderator',
        'support',
        'analyst',
        'finance_admin',
        'community_admin',
        'financial_admin',
        'learn_admin'
      )
  );
$$;

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
      AND role IN ('platform_owner', 'admin', 'spotlight_editor')
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
      AND role IN ('platform_owner', 'admin', 'finance_admin', 'financial_admin')
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
      AND role IN ('platform_owner', 'admin', 'community_admin', 'learn_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_admin_permission_for_user(
  p_user_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override text;
BEGIN
  IF p_user_id IS NULL OR p_permission IS NULL OR trim(p_permission) = '' THEN
    RETURN false;
  END IF;

  -- Platform Owner unconditionally holds every administrative permission
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = 'platform_owner'
  ) THEN
    RETURN true;
  END IF;

  -- Ordinary users with no staff role can NEVER gain permissions via stray overrides
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN (
        'admin',
        'moderator',
        'support',
        'analyst',
        'finance_admin',
        'community_admin',
        'financial_admin',
        'learn_admin'
      )
  ) THEN
    RETURN false;
  END IF;

  -- Owner-exclusive governance permissions can never be delegated via overrides
  IF p_permission IN ('admin.revoke_admins', 'admin.manage_permissions') THEN
    RETURN false;
  END IF;

  SELECT effect INTO v_override
  FROM public.admin_user_permissions
  WHERE user_id = p_user_id AND permission = p_permission
  LIMIT 1;

  IF v_override = 'revoke' THEN
    RETURN false;
  ELSIF v_override = 'grant' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.admin_role_permissions rp ON rp.role = ur.role
    WHERE ur.user_id = p_user_id
      AND rp.permission = p_permission
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_permission_for_user(auth.uid(), p_permission);
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_roles text[];
  v_is_owner boolean := false;
  v_perms text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'isAdmin', false,
      'isPlatformOwner', false,
      'roles', '[]'::jsonb,
      'permissions', '[]'::jsonb
    );
  END IF;

  SELECT coalesce(array_agg(DISTINCT role ORDER BY role), ARRAY[]::text[])
  INTO v_roles
  FROM public.user_roles
  WHERE user_id = v_uid;

  v_is_owner := 'platform_owner' = ANY(v_roles);

  IF v_is_owner THEN
    SELECT coalesce(array_agg(DISTINCT permission ORDER BY permission), ARRAY[]::text[])
    INTO v_perms
    FROM public.admin_role_permissions
    WHERE role = 'platform_owner';
  ELSE
    SELECT coalesce(array_agg(DISTINCT p.permission ORDER BY p.permission), ARRAY[]::text[])
    INTO v_perms
    FROM (
      SELECT DISTINCT rp.permission
      FROM public.user_roles ur
      JOIN public.admin_role_permissions rp ON rp.role = ur.role
      WHERE ur.user_id = v_uid
      UNION
      SELECT up.permission
      FROM public.admin_user_permissions up
      WHERE up.user_id = v_uid
        AND up.effect = 'grant'
        AND up.permission NOT IN ('admin.revoke_admins', 'admin.manage_permissions')
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur2
          WHERE ur2.user_id = v_uid
            AND ur2.role IN (
              'admin', 'moderator', 'support', 'analyst',
              'finance_admin', 'community_admin', 'financial_admin', 'learn_admin'
            )
        )
    ) p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_user_permissions rev
      WHERE rev.user_id = v_uid
        AND rev.permission = p.permission
        AND rev.effect = 'revoke'
    );
  END IF;

  RETURN jsonb_build_object(
    'isAdmin', coalesce(array_length(v_perms, 1), 0) > 0,
    'isPlatformOwner', v_is_owner,
    'roles', to_jsonb(coalesce(v_roles, ARRAY[]::text[])),
    'permissions', to_jsonb(coalesce(v_perms, ARRAY[]::text[]))
  );
END;
$$;

-- Update admin_moderate to verify granular content.moderate permission (allows Moderators, Admins, Platform Owner)
CREATE OR REPLACE FUNCTION public.admin_moderate(
  _actor uuid,
  _target uuid,
  _action text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_admin_permission_for_user(_actor, 'content.moderate') THEN
    RAISE EXCEPTION 'Forbidden: content.moderate permission required';
  END IF;
  IF length(trim(_reason)) < 3 OR length(_reason) > 500 THEN
    RAISE EXCEPTION 'Reason required (3-500 characters)';
  END IF;
  IF _action = 'hide' THEN
    UPDATE public.pings SET hidden_at = now() WHERE id = _target;
  ELSIF _action = 'restore' THEN
    UPDATE public.pings SET hidden_at = NULL WHERE id = _target;
  ELSIF _action = 'resolve_report' THEN
    UPDATE public.reports SET resolved_at = now() WHERE id = _target;
  ELSE
    RAISE EXCEPTION 'Invalid moderation action';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target record not found';
  END IF;
  INSERT INTO public.moderation_audit (actor_id, action, target_id, reason)
  VALUES (_actor, _action, _target, trim(_reason));
END;
$$;

-- ============================================================================
-- 4. PLATFORM OWNER APPOINTMENT, REVOCATION & PERMISSION OVERRIDE RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owner_appoint_admin(
  p_target_user_id uuid,
  p_role text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_appointment_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target account is required';
  END IF;

  IF p_target_user_id = v_actor THEN
    RAISE EXCEPTION 'Self-escalation is strictly forbidden';
  END IF;

  IF p_role = 'platform_owner' THEN
    RAISE EXCEPTION 'Platform Owner role can only be bootstrapped via privileged database administration';
  END IF;

  IF p_role NOT IN (
    'admin',
    'moderator',
    'support',
    'analyst',
    'finance_admin',
    'community_admin',
    'spotlight_editor'
  ) THEN
    RAISE EXCEPTION 'Unsupported administrative role: %', p_role;
  END IF;

  IF NOT (
    public.is_platform_owner()
    OR public.has_admin_permission_for_user(v_actor, 'admin.appoint_admins')
  ) THEN
    RAISE EXCEPTION 'Forbidden: only the Platform Owner (or an explicitly delegated administrator) can appoint administrators';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Appointment reason is required (5-500 characters)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Target user account does not exist';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_target_user_id, p_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.admin_appointments (
    user_id,
    role,
    status,
    appointed_by,
    appointment_reason
  )
  VALUES (
    p_target_user_id,
    p_role,
    'active',
    v_actor,
    trim(p_reason)
  )
  RETURNING id INTO v_appointment_id;

  INSERT INTO public.moderation_audit (actor_id, action, target_id, reason)
  VALUES (v_actor, 'appoint_' || p_role, p_target_user_id, trim(p_reason));

  RETURN jsonb_build_object(
    'appointmentId', v_appointment_id,
    'targetUserId', p_target_user_id,
    'role', p_role,
    'status', 'active'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_revoke_admin(
  p_target_user_id uuid,
  p_role text DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_remaining_roles int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Forbidden: only the Platform Owner can revoke administrator access';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = v_actor THEN
    RAISE EXCEPTION 'Self-revocation of Platform Owner access is blocked to prevent governance lockout';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Revocation reason is required (5-500 characters)';
  END IF;

  IF p_role = 'platform_owner' THEN
    RAISE EXCEPTION 'Platform Owner revocation must be performed via break-glass database governance';
  END IF;

  IF p_role IS NULL OR trim(p_role) = '' THEN
    DELETE FROM public.user_roles
    WHERE user_id = p_target_user_id
      AND role <> 'platform_owner';

    UPDATE public.admin_appointments
    SET status = 'revoked',
        revoked_by = v_actor,
        revocation_reason = trim(p_reason),
        revoked_at = now()
    WHERE user_id = p_target_user_id
      AND role <> 'platform_owner'
      AND status = 'active';
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = p_target_user_id
      AND role = p_role;

    UPDATE public.admin_appointments
    SET status = 'revoked',
        revoked_by = v_actor,
        revocation_reason = trim(p_reason),
        revoked_at = now()
    WHERE user_id = p_target_user_id
      AND role = p_role
      AND status = 'active';
  END IF;

  SELECT count(*)::int INTO v_remaining_roles
  FROM public.user_roles
  WHERE user_id = p_target_user_id;

  IF v_remaining_roles = 0 THEN
    DELETE FROM public.admin_user_permissions WHERE user_id = p_target_user_id;
  END IF;

  INSERT INTO public.moderation_audit (actor_id, action, target_id, reason)
  VALUES (
    v_actor,
    CASE WHEN p_role IS NULL OR trim(p_role) = '' THEN 'revoke_all_admin_roles' ELSE 'revoke_' || p_role END,
    p_target_user_id,
    trim(p_reason)
  );

  RETURN jsonb_build_object(
    'targetUserId', p_target_user_id,
    'revokedRole', coalesce(nullif(trim(p_role), ''), 'all'),
    'remainingRoles', v_remaining_roles
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_user_permission(
  p_target_user_id uuid,
  p_permission text,
  p_effect text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Forbidden: only the Platform Owner can modify individual permissions';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = v_actor THEN
    RAISE EXCEPTION 'Self-modification of permissions is forbidden';
  END IF;

  IF p_effect NOT IN ('grant', 'revoke', 'clear') THEN
    RAISE EXCEPTION 'Invalid permission effect';
  END IF;

  IF p_permission IN ('admin.revoke_admins', 'admin.manage_permissions') AND p_effect = 'grant' THEN
    RAISE EXCEPTION 'Owner-exclusive governance permissions cannot be delegated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_role_permissions WHERE permission = p_permission
  ) THEN
    RAISE EXCEPTION 'Unknown permission key: %', p_permission;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target account must hold an appointed administrative role before assigning individual permissions';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Audit reason is required (5-500 characters)';
  END IF;

  IF p_effect = 'clear' THEN
    DELETE FROM public.admin_user_permissions
    WHERE user_id = p_target_user_id AND permission = p_permission;
  ELSE
    INSERT INTO public.admin_user_permissions (
      user_id, permission, effect, granted_by, reason, updated_at
    )
    VALUES (
      p_target_user_id, p_permission, p_effect, v_actor, trim(p_reason), now()
    )
    ON CONFLICT (user_id, permission) DO UPDATE
    SET effect = EXCLUDED.effect,
        granted_by = EXCLUDED.granted_by,
        reason = EXCLUDED.reason,
        updated_at = now();
  END IF;

  INSERT INTO public.moderation_audit (actor_id, action, target_id, reason)
  VALUES (
    v_actor,
    'perm_' || p_effect || ':' || p_permission,
    p_target_user_id,
    trim(p_reason)
  );

  RETURN jsonb_build_object(
    'targetUserId', p_target_user_id,
    'permission', p_permission,
    'effect', p_effect
  );
END;
$$;

-- ============================================================================
-- 5. PRESENCE HEARTBEATS, SYSTEM ERROR LOGS, EARLY ACCESS & DOWNLOAD ATTRIBUTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_presence_heartbeats (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  surface text NOT NULL DEFAULT 'web' CHECK (surface IN ('web', 'pwa', 'android', 'ios')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_presence_heartbeats_last_seen_idx
  ON public.user_presence_heartbeats (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.system_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'web',
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error', 'critical')),
  category text NOT NULL DEFAULT 'api_error' CHECK (
    category IN ('api_error', 'client_error', 'background_job', 'delivery_failure', 'security')
  ),
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_error_logs_created_idx
  ON public.system_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS system_error_logs_category_status_idx
  ON public.system_error_logs (category, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.early_access_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'pwa', 'desktop')),
  device_model text NOT NULL DEFAULT '',
  referral_source text NOT NULL DEFAULT 'direct',
  source_site text NOT NULL DEFAULT '',
  utm_source text NOT NULL DEFAULT '',
  utm_medium text NOT NULL DEFAULT '',
  utm_campaign text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'registered' CHECK (
    status IN ('registered', 'invited', 'installed', 'declined')
  ),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, platform)
);

CREATE INDEX IF NOT EXISTS early_access_registrations_created_idx
  ON public.early_access_registrations (created_at DESC);
CREATE INDEX IF NOT EXISTS early_access_registrations_ref_idx
  ON public.early_access_registrations (referral_source, platform);

CREATE TABLE IF NOT EXISTS public.download_attribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind text NOT NULL CHECK (
    event_kind IN (
      'page_view',
      'apk_download_click',
      'pwa_install_prompt',
      'pwa_installed',
      'ios_guide_open',
      'testflight_click',
      'early_access_submit'
    )
  ),
  platform text NOT NULL DEFAULT 'unknown' CHECK (
    platform IN ('android', 'ios', 'pwa', 'desktop', 'unknown')
  ),
  referral_source text NOT NULL DEFAULT 'direct',
  source_site text NOT NULL DEFAULT '',
  utm_source text NOT NULL DEFAULT '',
  utm_campaign text NOT NULL DEFAULT '',
  app_version text NOT NULL DEFAULT '',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS download_attribution_events_created_idx
  ON public.download_attribution_events (created_at DESC);
CREATE INDEX IF NOT EXISTS download_attribution_events_ref_idx
  ON public.download_attribution_events (referral_source, event_kind);

-- Presence heartbeat RPC (authenticated users only; writes strictly own user_id)
CREATE OR REPLACE FUNCTION public.record_presence_heartbeat(p_surface text DEFAULT 'web')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_surface text := CASE
    WHEN p_surface IN ('web', 'pwa', 'android', 'ios') THEN p_surface
    ELSE 'web'
  END;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_presence_heartbeats (user_id, last_seen_at, surface, updated_at)
  VALUES (v_uid, now(), v_surface, now())
  ON CONFLICT (user_id) DO UPDATE
  SET last_seen_at = now(),
      surface = EXCLUDED.surface,
      updated_at = now();
END;
$$;

-- Early-access registration RPC (public-safe validated insert; prevents enumeration)
CREATE OR REPLACE FUNCTION public.register_early_access(
  p_email text,
  p_platform text,
  p_device_model text DEFAULT '',
  p_referral_source text DEFAULT 'direct',
  p_source_site text DEFAULT '',
  p_utm_source text DEFAULT '',
  p_utm_medium text DEFAULT '',
  p_utm_campaign text DEFAULT '',
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_platform text := lower(trim(coalesce(p_platform, '')));
  v_id uuid;
  v_status text;
BEGIN
  IF v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'Please enter a valid email address';
  END IF;

  IF v_platform NOT IN ('android', 'ios', 'pwa', 'desktop') THEN
    RAISE EXCEPTION 'Unsupported platform selection';
  END IF;

  INSERT INTO public.early_access_registrations (
    email,
    platform,
    device_model,
    referral_source,
    source_site,
    utm_source,
    utm_medium,
    utm_campaign,
    notes,
    user_id
  )
  VALUES (
    v_email,
    v_platform,
    left(trim(coalesce(p_device_model, '')), 120),
    left(coalesce(nullif(trim(p_referral_source), ''), 'direct'), 80),
    left(trim(coalesce(p_source_site, '')), 120),
    left(trim(coalesce(p_utm_source, '')), 80),
    left(trim(coalesce(p_utm_medium, '')), 80),
    left(trim(coalesce(p_utm_campaign, '')), 80),
    left(trim(coalesce(p_notes, '')), 400),
    auth.uid()
  )
  ON CONFLICT (email, platform) DO UPDATE
  SET device_model = CASE
        WHEN EXCLUDED.device_model <> '' THEN EXCLUDED.device_model
        ELSE early_access_registrations.device_model
      END,
      notes = CASE
        WHEN EXCLUDED.notes <> '' THEN EXCLUDED.notes
        ELSE early_access_registrations.notes
      END,
      user_id = coalesce(early_access_registrations.user_id, EXCLUDED.user_id)
  RETURNING id, status INTO v_id, v_status;

  INSERT INTO public.download_attribution_events (
    event_kind,
    platform,
    referral_source,
    source_site,
    utm_source,
    utm_campaign,
    user_id
  )
  VALUES (
    'early_access_submit',
    v_platform,
    left(coalesce(nullif(trim(p_referral_source), ''), 'direct'), 80),
    left(trim(coalesce(p_source_site, '')), 120),
    left(trim(coalesce(p_utm_source, '')), 80),
    left(trim(coalesce(p_utm_campaign, '')), 80),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'platform', v_platform,
    'status', v_status
  );
END;
$$;

-- Download attribution RPC (records real visits & actions without fabricating metrics)
CREATE OR REPLACE FUNCTION public.record_download_attribution(
  p_event_kind text,
  p_platform text DEFAULT 'unknown',
  p_referral_source text DEFAULT 'direct',
  p_source_site text DEFAULT '',
  p_utm_source text DEFAULT '',
  p_utm_campaign text DEFAULT '',
  p_app_version text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_kind NOT IN (
    'page_view',
    'apk_download_click',
    'pwa_install_prompt',
    'pwa_installed',
    'ios_guide_open',
    'testflight_click',
    'early_access_submit'
  ) THEN
    RAISE EXCEPTION 'Invalid download attribution event';
  END IF;

  INSERT INTO public.download_attribution_events (
    event_kind,
    platform,
    referral_source,
    source_site,
    utm_source,
    utm_campaign,
    app_version,
    user_id
  )
  VALUES (
    p_event_kind,
    CASE
      WHEN p_platform IN ('android', 'ios', 'pwa', 'desktop', 'unknown') THEN p_platform
      ELSE 'unknown'
    END,
    left(coalesce(nullif(trim(p_referral_source), ''), 'direct'), 80),
    left(trim(coalesce(p_source_site, '')), 120),
    left(trim(coalesce(p_utm_source, '')), 80),
    left(trim(coalesce(p_utm_campaign, '')), 80),
    left(trim(coalesce(p_app_version, '')), 40),
    auth.uid()
  );
END;
$$;

-- ============================================================================
-- 6. REAL DATABASE-BACKED ADMIN CONTROL CENTRE METRICS RPC (SERVICE ROLE ONLY)
--    PRIVACY INVARIANT: NEVER reads private_messages body/content text.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_control_centre_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_accounts bigint := 0;
  v_new_reg_24h bigint := 0;
  v_new_reg_7d bigint := 0;
  v_new_reg_30d bigint := 0;
  v_online_now bigint := 0;
  v_dau bigint := 0;
  v_wau bigint := 0;
  v_mau bigint := 0;
  v_pings_total bigint := 0;
  v_pings_hidden bigint := 0;
  v_pings_24h bigint := 0;
  v_repings_total bigint := 0;
  v_moments_total bigint := 0;
  v_clips_total bigint := 0;
  v_shares_total bigint := 0;
  v_referral_clicks bigint := 0;
  v_hubs_total bigint := 0;
  v_hub_members_total bigint := 0;
  v_signals_total bigint := 0;
  v_signal_followers_total bigint := 0;
  v_messages_sent_total bigint := 0;
  v_messages_sent_24h bigint := 0;
  v_delivery_failures bigint := 0;
  v_open_reports bigint := 0;
  v_resolved_reports bigint := 0;
  v_dot_tx_total bigint := 0;
  v_active_subscriptions bigint := 0;
  v_boost_campaigns_total bigint := 0;
  v_boost_campaigns_active bigint := 0;
  v_boost_dot_volume bigint := 0;
  v_businesses_total bigint := 0;
  v_business_enquiries_total bigint := 0;
  v_early_access_total bigint := 0;
  v_download_events_total bigint := 0;
  v_errors_open bigint := 0;
  v_failed_jobs bigint := 0;
  v_staff_count bigint := 0;
  v_audit_events_30d bigint := 0;
BEGIN
  SELECT count(*) INTO v_total_accounts FROM public.profiles;
  SELECT count(*) INTO v_new_reg_24h FROM public.profiles WHERE created_at >= now() - interval '24 hours';
  SELECT count(*) INTO v_new_reg_7d FROM public.profiles WHERE created_at >= now() - interval '7 days';
  SELECT count(*) INTO v_new_reg_30d FROM public.profiles WHERE created_at >= now() - interval '30 days';

  -- Reliable online presence (active heartbeat in last 5 minutes)
  SELECT count(*) INTO v_online_now
  FROM public.user_presence_heartbeats
  WHERE last_seen_at >= now() - interval '5 minutes';

  -- DAU / WAU / MAU from real presence heartbeats + authored Pings + sent messages
  SELECT count(DISTINCT uid) INTO v_dau FROM (
    SELECT user_id AS uid FROM public.user_presence_heartbeats WHERE last_seen_at >= now() - interval '24 hours'
    UNION
    SELECT user_id AS uid FROM public.pings WHERE created_at >= now() - interval '24 hours'
    UNION
    SELECT sender_id AS uid FROM public.private_messages WHERE created_at >= now() - interval '24 hours'
  ) d;

  SELECT count(DISTINCT uid) INTO v_wau FROM (
    SELECT user_id AS uid FROM public.user_presence_heartbeats WHERE last_seen_at >= now() - interval '7 days'
    UNION
    SELECT user_id AS uid FROM public.pings WHERE created_at >= now() - interval '7 days'
    UNION
    SELECT sender_id AS uid FROM public.private_messages WHERE created_at >= now() - interval '7 days'
  ) w;

  SELECT count(DISTINCT uid) INTO v_mau FROM (
    SELECT user_id AS uid FROM public.user_presence_heartbeats WHERE last_seen_at >= now() - interval '30 days'
    UNION
    SELECT user_id AS uid FROM public.pings WHERE created_at >= now() - interval '30 days'
    UNION
    SELECT sender_id AS uid FROM public.private_messages WHERE created_at >= now() - interval '30 days'
  ) m;

  SELECT count(*) INTO v_pings_total FROM public.pings;
  SELECT count(*) INTO v_pings_hidden FROM public.pings WHERE hidden_at IS NOT NULL;
  SELECT count(*) INTO v_pings_24h FROM public.pings WHERE created_at >= now() - interval '24 hours';
  SELECT (
    (SELECT count(*) FROM public.pings WHERE source_ping_id IS NOT NULL)
    + (SELECT count(*) FROM public.moment_repings)
  ) INTO v_repings_total;

  SELECT count(*) INTO v_moments_total FROM public.moments;
  IF to_regclass('public.ping_clips') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.ping_clips' INTO v_clips_total;
  END IF;

  IF to_regclass('public.share_events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.share_events' INTO v_shares_total;
    EXECUTE $q$SELECT count(*) FROM public.share_events WHERE event_kind = 'link_clicked'$q$ INTO v_referral_clicks;
  END IF;

  SELECT count(*) INTO v_hubs_total FROM public.hubs;
  SELECT count(*) INTO v_hub_members_total FROM public.hub_members;
  SELECT count(*) INTO v_signals_total FROM public.signals;
  SELECT count(*) INTO v_signal_followers_total FROM public.signal_followers;

  -- Aggregate message counts ONLY — never reading message text or attachments
  SELECT count(*) INTO v_messages_sent_total FROM public.private_messages;
  SELECT count(*) INTO v_messages_sent_24h FROM public.private_messages WHERE created_at >= now() - interval '24 hours';
  SELECT count(*) INTO v_delivery_failures
  FROM public.system_error_logs
  WHERE category = 'delivery_failure' AND status = 'open';

  SELECT count(*) INTO v_open_reports FROM public.reports WHERE resolved_at IS NULL;
  SELECT count(*) INTO v_resolved_reports FROM public.reports WHERE resolved_at IS NOT NULL;

  IF to_regclass('public.dot_transactions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.dot_transactions' INTO v_dot_tx_total;
  END IF;
  IF to_regclass('public.subscription_entitlements') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM public.subscription_entitlements WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())$q$ INTO v_active_subscriptions;
  END IF;
  IF to_regclass('public.boost_campaigns') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.boost_campaigns' INTO v_boost_campaigns_total;
    EXECUTE $q$SELECT count(*) FROM public.boost_campaigns WHERE status = 'active' AND ends_at > now()$q$ INTO v_boost_campaigns_active;
    EXECUTE 'SELECT coalesce(sum(dot_cost), 0) FROM public.boost_campaigns' INTO v_boost_dot_volume;
  END IF;

  IF to_regclass('public.business_profiles') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.business_profiles' INTO v_businesses_total;
  END IF;
  IF to_regclass('public.business_enquiries') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.business_enquiries' INTO v_business_enquiries_total;
  END IF;

  SELECT count(*) INTO v_early_access_total FROM public.early_access_registrations;
  SELECT count(*) INTO v_download_events_total FROM public.download_attribution_events;
  SELECT count(*) INTO v_errors_open FROM public.system_error_logs WHERE status = 'open';
  SELECT count(*) INTO v_failed_jobs FROM public.system_error_logs WHERE category = 'background_job' AND status = 'open';
  SELECT count(DISTINCT user_id) INTO v_staff_count FROM public.user_roles;
  SELECT count(*) INTO v_audit_events_30d FROM public.moderation_audit WHERE created_at >= now() - interval '30 days';

  RETURN jsonb_build_object(
    'checkedAt', now(),
    'accounts', v_total_accounts,
    'newRegistrations24h', v_new_reg_24h,
    'newRegistrations7d', v_new_reg_7d,
    'newRegistrations30d', v_new_reg_30d,
    'onlineNow', v_online_now,
    'dau', v_dau,
    'wau', v_wau,
    'mau', v_mau,
    'pings', v_pings_total,
    'hiddenPings', v_pings_hidden,
    'pings24h', v_pings_24h,
    'repings', v_repings_total,
    'moments', v_moments_total,
    'clips', v_clips_total,
    'shares', v_shares_total,
    'referralClicks', v_referral_clicks,
    'hubs', v_hubs_total,
    'hubMemberships', v_hub_members_total,
    'signals', v_signals_total,
    'signalFollowers', v_signal_followers_total,
    'messagesSentTotal', v_messages_sent_total,
    'messagesSent24h', v_messages_sent_24h,
    'messageDeliveryFailures', v_delivery_failures,
    'openReports', v_open_reports,
    'resolvedReports', v_resolved_reports,
    'dotTransactions', v_dot_tx_total,
    'activeSubscriptions', v_active_subscriptions,
    'boostCampaignsTotal', v_boost_campaigns_total,
    'boostCampaignsActive', v_boost_campaigns_active,
    'boostDotVolume', v_boost_dot_volume,
    'businessesTotal', v_businesses_total,
    'businessEnquiriesTotal', v_business_enquiries_total,
    'earlyAccessRegistrations', v_early_access_total,
    'downloadAttributionEvents', v_download_events_total,
    'openErrors', v_errors_open,
    'failedBackgroundJobs', v_failed_jobs,
    'appointedStaffCount', v_staff_count,
    'auditEvents30d', v_audit_events_30d
  );
END;
$$;

-- ============================================================================
-- 7. STRICT ROW LEVEL SECURITY & LEAST-PRIVILEGE GRANTS (ZERO USING(true))
-- ============================================================================

ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.early_access_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_attribution_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_role_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_user_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_appointments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_presence_heartbeats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.system_error_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.early_access_registrations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.download_attribution_events FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.admin_role_permissions TO authenticated;
GRANT SELECT ON public.admin_user_permissions TO authenticated;
GRANT SELECT ON public.admin_appointments TO authenticated;
GRANT SELECT ON public.user_presence_heartbeats TO authenticated;
GRANT SELECT ON public.system_error_logs TO authenticated;
GRANT SELECT ON public.early_access_registrations TO authenticated;
GRANT SELECT ON public.download_attribution_events TO authenticated;

GRANT ALL ON public.admin_role_permissions TO service_role;
GRANT ALL ON public.admin_user_permissions TO service_role;
GRANT ALL ON public.admin_appointments TO service_role;
GRANT ALL ON public.user_presence_heartbeats TO service_role;
GRANT ALL ON public.system_error_logs TO service_role;
GRANT ALL ON public.early_access_registrations TO service_role;
GRANT ALL ON public.download_attribution_events TO service_role;

-- Policies (zero USING (true))
DROP POLICY IF EXISTS "Staff read role permission catalog" ON public.admin_role_permissions;
CREATE POLICY "Staff read role permission catalog"
  ON public.admin_role_permissions
  FOR SELECT TO authenticated
  USING (public.has_admin_access());

DROP POLICY IF EXISTS "Read own or owner-managed user permissions" ON public.admin_user_permissions;
CREATE POLICY "Read own or owner-managed user permissions"
  ON public.admin_user_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_owner());

DROP POLICY IF EXISTS "Read own or owner-managed appointments" ON public.admin_appointments;
CREATE POLICY "Read own or owner-managed appointments"
  ON public.admin_appointments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_platform_owner()
    OR public.has_admin_permission('admin.view_staff')
  );

DROP POLICY IF EXISTS "Read own presence heartbeat" ON public.user_presence_heartbeats;
CREATE POLICY "Read own presence heartbeat"
  ON public.user_presence_heartbeats
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Authorized staff read system errors" ON public.system_error_logs;
CREATE POLICY "Authorized staff read system errors"
  ON public.system_error_logs
  FOR SELECT TO authenticated
  USING (public.has_admin_permission('system.view_health'));

DROP POLICY IF EXISTS "Read own or growth-staff early access registrations" ON public.early_access_registrations;
CREATE POLICY "Read own or growth-staff early access registrations"
  ON public.early_access_registrations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_admin_permission('growth.view'));

DROP POLICY IF EXISTS "Growth staff read download attribution" ON public.download_attribution_events;
CREATE POLICY "Growth staff read download attribution"
  ON public.download_attribution_events
  FOR SELECT TO authenticated
  USING (public.has_admin_permission('growth.view'));

-- Function execution privileges
REVOKE ALL ON FUNCTION public.is_platform_owner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_ping_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_admin_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_spotlight_editor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_financial_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_learn_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_admin_permission_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_admin_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_admin_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_moderate(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_appoint_admin(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_revoke_admin(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_user_permission(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_presence_heartbeat(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_control_centre_metrics() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_early_access(text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_download_attribution(text, text, text, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_ping_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_admin_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_spotlight_editor() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_financial_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_learn_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_admin_permission_for_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_admin_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_moderate(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_appoint_admin(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_revoke_admin(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_set_user_permission(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_presence_heartbeat(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_control_centre_metrics() TO service_role;
GRANT EXECUTE ON FUNCTION public.register_early_access(text, text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_download_attribution(text, text, text, text, text, text, text) TO anon, authenticated, service_role;
