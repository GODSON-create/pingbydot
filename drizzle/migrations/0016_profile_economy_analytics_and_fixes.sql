-- ==============================================================================
-- Migration 0016: Profile Economy (DOT Balance & Account Upgrades), Creator
-- Analytics, Profile/Moment Reporting, and Schema Consistency Repairs
-- ==============================================================================

-- 1. Signals schema & RPC consistency (include incubator and other)
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'signals'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%institution_type%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.signals DROP CONSTRAINT %I', v_conname);
  END IF;

  ALTER TABLE public.signals
    ADD CONSTRAINT signals_institution_type_check
    CHECK (institution_type IN (
      'university', 'company', 'incubator', 'government',
      'association', 'organization', 'community', 'public_institution', 'other'
    ));
END $$;

-- Allow Signal authors or Signal admins to delete broadcasts
DROP POLICY IF EXISTS "Publishers delete own or admin deletes posts" ON public.signal_posts;
CREATE POLICY "Publishers delete own or admin deletes posts" ON public.signal_posts
  FOR DELETE TO authenticated
  USING (
    author_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) = 'admin'
  );

-- Re-assert hardened reping_moment using author_id
CREATE OR REPLACE FUNCTION public.reping_moment(
  _moment_id uuid,
  _caption text DEFAULT NULL,
  _audience text DEFAULT 'public'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_moment record;
  v_reping_id uuid;
  v_target_audience text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _moment_id IS NULL THEN
    RAISE EXCEPTION 'Moment id required';
  END IF;

  IF _caption IS NOT NULL AND char_length(_caption) > 500 THEN
    RAISE EXCEPTION 'Caption cannot exceed 500 characters';
  END IF;

  SELECT * INTO v_moment FROM public.moments WHERE id = _moment_id AND deleted_at IS NULL;
  IF v_moment.id IS NULL THEN
    RAISE EXCEPTION 'Moment not found';
  END IF;

  IF v_moment.audience = 'followers' AND v_moment.author_id <> v_user THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.follows
      WHERE follower_id = v_user AND following_id = v_moment.author_id
    ) THEN
      RAISE EXCEPTION 'You must follow the creator to re-ping this moment';
    END IF;
  END IF;

  IF v_moment.audience IN ('hub', 'close_circle') THEN
    RAISE EXCEPTION 'Private Hub and Close Circle moments cannot be re-pinged.';
  END IF;

  IF NOT v_moment.allow_repings THEN
    RAISE EXCEPTION 'The creator has disabled re-pings for this moment.';
  END IF;

  IF v_moment.audience = 'followers' AND _audience = 'public' THEN
    RAISE EXCEPTION 'Re-Ping cannot expand a followers-only moment to public audience.';
  END IF;

  IF v_moment.audience = 'followers' THEN
    v_target_audience := 'followers';
  ELSE
    v_target_audience := COALESCE(NULLIF(btrim(_audience), ''), 'public');
    IF v_target_audience NOT IN ('public', 'followers') THEN
      RAISE EXCEPTION 'Invalid target audience: must be public or followers';
    END IF;
  END IF;

  INSERT INTO public.moment_repings (moment_id, user_id, caption, audience)
  VALUES (_moment_id, v_user, nullif(btrim(_caption), ''), v_target_audience)
  ON CONFLICT (moment_id, user_id) DO UPDATE
    SET caption = EXCLUDED.caption, audience = EXCLUDED.audience, created_at = now()
  RETURNING id INTO v_reping_id;

  UPDATE public.moments
  SET reping_count = (SELECT count(*) FROM public.moment_repings WHERE moment_id = _moment_id)
  WHERE id = _moment_id;

  RETURN v_reping_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reping_moment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reping_moment(uuid, text, text) TO authenticated, service_role;

-- 2. DOT Wallets & Ledger
CREATE TABLE IF NOT EXISTS public.dot_wallets (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 50 CHECK (balance >= 0),
  lifetime_earned integer NOT NULL DEFAULT 50 CHECK (lifetime_earned >= 0),
  lifetime_spent integer NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  streak_days integer NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  last_checkin_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dot_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  tx_type text NOT NULL CHECK (tx_type IN ('earn', 'spend', 'bonus', 'upgrade')),
  source text NOT NULL,
  reference_id text,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dot_transactions_user_created_idx
  ON public.dot_transactions (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS dot_transactions_user_source_ref_uidx
  ON public.dot_transactions (user_id, source, reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE public.dot_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dot_transactions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.dot_wallets, public.dot_transactions TO authenticated;
GRANT ALL ON public.dot_wallets, public.dot_transactions TO service_role;

DROP POLICY IF EXISTS "Users read own dot wallet" ON public.dot_wallets;
CREATE POLICY "Users read own dot wallet" ON public.dot_wallets
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users read own dot transactions" ON public.dot_transactions;
CREATE POLICY "Users read own dot transactions" ON public.dot_transactions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- 3. Account Upgrades / Subscriptions
CREATE TABLE IF NOT EXISTS public.account_subscriptions (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'plus', 'pro', 'institution')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'cancelled', 'expired')),
  billing_cycle text NOT NULL DEFAULT 'dot_credits' CHECK (billing_cycle IN ('monthly', 'annual', 'dot_credits')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.account_subscriptions TO authenticated;
GRANT ALL ON public.account_subscriptions TO service_role;

DROP POLICY IF EXISTS "Users read own subscription" ON public.account_subscriptions;
CREATE POLICY "Users read own subscription" ON public.account_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- 4. Profile & Moment Safety Reporting (App Store UGC Compliance)
CREATE TABLE IF NOT EXISTS public.profile_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 80),
  details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT profile_reports_not_self CHECK (reported_user_id <> reporter_id)
);

CREATE INDEX IF NOT EXISTS profile_reports_target_idx ON public.profile_reports (reported_user_id, created_at DESC);

ALTER TABLE public.profile_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.profile_reports TO authenticated;
GRANT ALL ON public.profile_reports TO service_role;

DROP POLICY IF EXISTS "Reporters read own profile reports" ON public.profile_reports;
CREATE POLICY "Reporters read own profile reports" ON public.profile_reports
  FOR SELECT TO authenticated
  USING (reporter_id = (select auth.uid()) OR public.is_ping_admin());

DROP POLICY IF EXISTS "Authenticated users submit profile reports" ON public.profile_reports;
CREATE POLICY "Authenticated users submit profile reports" ON public.profile_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (select auth.uid()) AND reported_user_id <> (select auth.uid()));

-- 5. Secure RPCs for DOT Economy, Upgrades, and Creator Analytics

CREATE OR REPLACE FUNCTION public.get_my_dot_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_wallet public.dot_wallets;
  v_sub public.account_subscriptions;
  v_txs jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Idempotent wallet initialization with 50 welcome DOTs
  INSERT INTO public.dot_wallets (user_id, balance, lifetime_earned, lifetime_spent, streak_days)
  VALUES (v_caller, 50, 50, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)
    VALUES (v_caller, 50, 'bonus', 'welcome_grant', 'welcome_grant_v1', 'Welcome DOT starter grant')
    ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;
  END IF;

  INSERT INTO public.account_subscriptions (user_id, tier, status, billing_cycle)
  VALUES (v_caller, 'free', 'active', 'dot_credits')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.dot_wallets WHERE user_id = v_caller;
  SELECT * INTO v_sub FROM public.account_subscriptions WHERE user_id = v_caller;

  -- Auto-downgrade expired timed upgrade
  IF v_sub.tier <> 'free' AND v_sub.expires_at IS NOT NULL AND v_sub.expires_at < now() THEN
    UPDATE public.account_subscriptions
    SET tier = 'free', status = 'expired', updated_at = now()
    WHERE user_id = v_caller
    RETURNING * INTO v_sub;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'amount', t.amount,
        'tx_type', t.tx_type,
        'source', t.source,
        'description', t.description,
        'created_at', t.created_at
      )
      ORDER BY t.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_txs
  FROM (
    SELECT * FROM public.dot_transactions
    WHERE user_id = v_caller
    ORDER BY created_at DESC
    LIMIT 30
  ) t;

  RETURN jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'subscription', to_jsonb(v_sub),
    'transactions', v_txs
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_dot_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_dot_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_daily_dot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_wallet public.dot_wallets;
  v_next_streak integer;
  v_reward integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Ensure wallet exists
  PERFORM public.get_my_dot_summary();

  SELECT * INTO v_wallet FROM public.dot_wallets WHERE user_id = v_caller FOR UPDATE;

  IF v_wallet.last_checkin_at IS NOT NULL
     AND (v_wallet.last_checkin_at AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Daily DOT check-in already claimed today';
  END IF;

  IF v_wallet.last_checkin_at IS NOT NULL
     AND (v_wallet.last_checkin_at AT TIME ZONE 'UTC')::date = ((now() AT TIME ZONE 'UTC')::date - 1) THEN
    v_next_streak := v_wallet.streak_days + 1;
  ELSE
    v_next_streak := 1;
  END IF;

  -- Base 10 DOT + 2 DOT per streak day capped at +15 bonus (max 25 DOT/day)
  v_reward := 10 + least(greatest(v_next_streak - 1, 0) * 2, 15);

  UPDATE public.dot_wallets
  SET
    balance = balance + v_reward,
    lifetime_earned = lifetime_earned + v_reward,
    streak_days = v_next_streak,
    last_checkin_at = now(),
    updated_at = now()
  WHERE user_id = v_caller
  RETURNING * INTO v_wallet;

  INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)
  VALUES (
    v_caller,
    v_reward,
    'earn',
    'daily_checkin',
    ((now() AT TIME ZONE 'UTC')::date)::text,
    format('Daily check-in reward (Day %s streak)', v_next_streak)
  )
  ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object(
    'reward', v_reward,
    'streak_days', v_next_streak,
    'wallet', to_jsonb(v_wallet)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_daily_dot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_dot() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upgrade_account_with_dots(
  _tier text,
  _billing_cycle text DEFAULT 'dot_credits'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_cost integer;
  v_wallet public.dot_wallets;
  v_sub public.account_subscriptions;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _tier NOT IN ('plus', 'pro', 'institution') THEN
    RAISE EXCEPTION 'Invalid upgrade tier';
  END IF;

  IF _billing_cycle NOT IN ('monthly', 'annual', 'dot_credits') THEN
    RAISE EXCEPTION 'Invalid billing cycle';
  END IF;

  v_cost := CASE _tier
    WHEN 'plus' THEN 150
    WHEN 'pro' THEN 350
    WHEN 'institution' THEN 600
  END;

  PERFORM public.get_my_dot_summary();

  SELECT * INTO v_wallet FROM public.dot_wallets WHERE user_id = v_caller FOR UPDATE;
  IF v_wallet.balance < v_cost THEN
    RAISE EXCEPTION 'Insufficient DOT balance (% DOT required)', v_cost;
  END IF;

  UPDATE public.dot_wallets
  SET
    balance = balance - v_cost,
    lifetime_spent = lifetime_spent + v_cost,
    updated_at = now()
  WHERE user_id = v_caller
  RETURNING * INTO v_wallet;

  INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)
  VALUES (
    v_caller,
    -v_cost,
    'upgrade',
    'tier_upgrade',
    _tier,
    format('Upgraded account to %s tier (30 days)', upper(_tier))
  );

  INSERT INTO public.account_subscriptions (user_id, tier, status, billing_cycle, started_at, expires_at, updated_at)
  VALUES (v_caller, _tier, 'active', _billing_cycle, now(), now() + interval '30 days', now())
  ON CONFLICT (user_id) DO UPDATE SET
    tier = EXCLUDED.tier,
    status = 'active',
    billing_cycle = EXCLUDED.billing_cycle,
    started_at = now(),
    expires_at = greatest(coalesce(account_subscriptions.expires_at, now()), now()) + interval '30 days',
    updated_at = now()
  RETURNING * INTO v_sub;

  RETURN jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'subscription', to_jsonb(v_sub)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.upgrade_account_with_dots(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upgrade_account_with_dots(text, text) TO authenticated, service_role;

-- Public non-financial tier lookup for profile badges (never exposes balances/transactions)
CREATE OR REPLACE FUNCTION public.get_public_account_tier(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > now()) THEN s.tier
    ELSE 'free'
  END
  FROM (SELECT 1) _
  LEFT JOIN public.account_subscriptions s ON s.user_id = _user_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_account_tier(uuid) TO anon, authenticated, service_role;

-- Creator Analytics RPC (strictly owner-scoped via auth.uid())
CREATE OR REPLACE FUNCTION public.get_creator_analytics(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_days integer := least(greatest(coalesce(_days, 30), 7), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_pings_count integer := 0;
  v_likes_received integer := 0;
  v_comments_received integer := 0;
  v_followers_count integer := 0;
  v_following_count integer := 0;
  v_moments_count integer := 0;
  v_moment_views integer := 0;
  v_moment_likes integer := 0;
  v_hubs_joined integer := 0;
  v_signals_subscribed integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT count(*) INTO v_pings_count
  FROM public.pings
  WHERE user_id = v_caller AND hidden_at IS NULL AND created_at >= v_since;

  SELECT count(*) INTO v_likes_received
  FROM public.likes l
  JOIN public.pings p ON p.id = l.ping_id
  WHERE p.user_id = v_caller AND p.hidden_at IS NULL AND l.created_at >= v_since;

  SELECT count(*) INTO v_comments_received
  FROM public.comments c
  JOIN public.pings p ON p.id = c.ping_id
  WHERE p.user_id = v_caller AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND c.created_at >= v_since;

  SELECT count(*) INTO v_followers_count FROM public.follows WHERE following_id = v_caller;
  SELECT count(*) INTO v_following_count FROM public.follows WHERE follower_id = v_caller;

  SELECT count(*), coalesce(sum(view_count), 0), coalesce(sum(like_count), 0)
  INTO v_moments_count, v_moment_views, v_moment_likes
  FROM public.moments
  WHERE author_id = v_caller AND deleted_at IS NULL AND created_at >= v_since;

  SELECT count(*) INTO v_hubs_joined
  FROM public.hub_members
  WHERE user_id = v_caller AND status = 'active';

  SELECT count(*) INTO v_signals_subscribed
  FROM public.signal_followers
  WHERE user_id = v_caller;

  RETURN jsonb_build_object(
    'days', v_days,
    'pings_count', v_pings_count,
    'likes_received', v_likes_received,
    'comments_received', v_comments_received,
    'followers_count', v_followers_count,
    'following_count', v_following_count,
    'moments_count', v_moments_count,
    'moment_views', v_moment_views,
    'moment_likes', v_moment_likes,
    'hubs_joined', v_hubs_joined,
    'signals_subscribed', v_signals_subscribed
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_creator_analytics(integer) TO authenticated, service_role;
