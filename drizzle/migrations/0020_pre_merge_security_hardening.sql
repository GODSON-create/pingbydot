-- ==============================================================================
-- Migration 0020: PR #2 Pre-Merge Security Hardening
--   1. Enforce caller identity in is_close_circle_member & revoke anon execute
--   2. Split moments SELECT RLS by role so public reads stay intact without anon RPC
--   3. Enforce caller identity in is_conversation_member (block user_id spoofing)
--   4. Harden upgrade_account_with_dots, make dot_transactions append-only, restrict
--      service_role / PUBLIC grants, and revoke PUBLIC/anon execute on auth RPCs
--   5. Enforce target_audience authorization in hub_broadcasts & hub_forum_members
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Close Circle Membership Security & Role-Scoped Moments Visibility
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_close_circle_member(
  _owner_id uuid,
  _member_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') AND v_caller IS NULL THEN
    v_target := _member_id;
  ELSE
    IF v_caller IS NULL THEN
      RETURN false;
    END IF;
    -- Prevent authenticated callers from enumerating third-party close circles
    IF _member_id IS NOT NULL AND _member_id <> v_caller THEN
      RAISE EXCEPTION 'Forbidden: cannot inspect another user''s Close Circle membership'
        USING ERRCODE = '42501';
    END IF;
    v_target := v_caller;
  END IF;

  IF _owner_id IS NULL OR v_target IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_close_circle
    WHERE user_id = _owner_id
      AND member_id = v_target
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_close_circle_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_close_circle_member(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Moments viewable by authorized audience" ON public.moments;
DROP POLICY IF EXISTS "Public moments viewable by anyone" ON public.moments;
CREATE POLICY "Public moments viewable by anyone" ON public.moments
  FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL AND audience = 'public');

DROP POLICY IF EXISTS "Restricted moments viewable by authorized users" ON public.moments;
CREATE POLICY "Restricted moments viewable by authorized users" ON public.moments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      author_id = (select auth.uid())
      OR (
        audience = 'followers' AND EXISTS (
          SELECT 1 FROM public.follows
          WHERE follower_id = (select auth.uid()) AND following_id = moments.author_id
        )
      )
      OR (
        audience = 'hub' AND hub_id IS NOT NULL AND public.hub_role(moments.hub_id, (select auth.uid())) IS NOT NULL
      )
      OR (
        audience = 'close_circle' AND public.is_close_circle_member(moments.author_id, (select auth.uid()))
      )
    )
  );

-- ------------------------------------------------------------------------------
-- 2. Direct Message Membership Security (Enforce Caller Identity)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_conversation_member(
  _conversation_id uuid,
  _user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') AND v_caller IS NULL THEN
    v_target := _user_id;
  ELSE
    IF v_caller IS NULL THEN
      RETURN false;
    END IF;
    -- Prevent authenticated callers from probing arbitrary user conversation memberships
    IF _user_id IS NOT NULL AND _user_id <> v_caller THEN
      RAISE EXCEPTION 'Forbidden: cannot inspect another user''s conversation membership'
        USING ERRCODE = '42501';
    END IF;
    v_target := v_caller;
  END IF;

  IF _conversation_id IS NULL OR v_target IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = v_target
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. DOT Wallet Security, Immutable Ledger & Duplicate Upgrade Guard
-- ------------------------------------------------------------------------------
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
  v_target_rank integer;
  v_current_rank integer;
  v_new_expires timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
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

  v_target_rank := CASE _tier
    WHEN 'plus' THEN 1
    WHEN 'pro' THEN 2
    WHEN 'institution' THEN 3
  END;

  PERFORM public.get_my_dot_summary();

  SELECT * INTO v_wallet FROM public.dot_wallets WHERE user_id = v_caller FOR UPDATE;
  SELECT * INTO v_sub FROM public.account_subscriptions WHERE user_id = v_caller FOR UPDATE;

  IF v_sub.user_id IS NOT NULL
     AND v_sub.status = 'active'
     AND (v_sub.expires_at IS NULL OR v_sub.expires_at > now()) THEN
    v_current_rank := CASE v_sub.tier
      WHEN 'plus' THEN 1
      WHEN 'pro' THEN 2
      WHEN 'institution' THEN 3
      ELSE 0
    END;
    IF v_current_rank >= v_target_rank THEN
      RAISE EXCEPTION 'Account already has an active % tier subscription', v_sub.tier;
    END IF;
  END IF;

  IF v_wallet.balance < v_cost THEN
    RAISE EXCEPTION 'Insufficient DOT balance (% DOT required)', v_cost;
  END IF;

  v_new_expires := now() + interval '30 days';

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
    format('%s:%s', _tier, to_char(v_new_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
    format('Upgraded account to %s tier (30 days)', upper(_tier))
  );

  INSERT INTO public.account_subscriptions (user_id, tier, status, billing_cycle, started_at, expires_at, updated_at)
  VALUES (v_caller, _tier, 'active', _billing_cycle, now(), v_new_expires, now())
  ON CONFLICT (user_id) DO UPDATE SET
    tier = EXCLUDED.tier,
    status = 'active',
    billing_cycle = EXCLUDED.billing_cycle,
    started_at = now(),
    expires_at = EXCLUDED.expires_at,
    updated_at = now()
  RETURNING * INTO v_sub;

  RETURN jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'subscription', to_jsonb(v_sub)
  );
END;
$$;

-- Restrict financial tables and mutator functions even against service_role/PUBLIC misuse
REVOKE ALL ON FUNCTION public.get_my_dot_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_dot_summary() TO authenticated;

REVOKE ALL ON FUNCTION public.claim_daily_dot() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_daily_dot() TO authenticated;

REVOKE ALL ON FUNCTION public.upgrade_account_with_dots(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.upgrade_account_with_dots(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_public_account_tier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_account_tier(uuid) TO anon, authenticated, service_role;

REVOKE UPDATE, TRUNCATE ON public.dot_transactions FROM service_role;
REVOKE TRUNCATE ON public.dot_wallets, public.account_subscriptions FROM service_role;

-- Clean up implicit PUBLIC/anon execute grants left on authenticated-only RPCs in 0011, 0012, 0014
REVOKE ALL ON FUNCTION
  public.create_hub(text, text, text, text, text, text, text, jsonb),
  public.mark_hub_messages_read(uuid, uuid[]),
  public.get_message_read_summary(uuid),
  public.create_signal(text, text, text, text, text, text),
  public.toggle_follow_signal(uuid),
  public.mark_signal_read(uuid),
  public.get_signal_post_analytics(uuid),
  public.view_moment(uuid),
  public.toggle_like_moment(uuid, text),
  public.delete_reping(uuid),
  public.get_or_create_direct_conversation(uuid),
  public.send_private_message(uuid, text, text, text),
  public.mark_conversation_read(uuid),
  public.hide_or_delete_conversation(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.delete_user_account(),
  public.get_or_create_conversation(uuid),
  public.create_conversation(uuid),
  public.send_message(uuid, text, text, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.create_hub(text, text, text, text, text, text, text, jsonb),
  public.mark_hub_messages_read(uuid, uuid[]),
  public.get_message_read_summary(uuid),
  public.create_signal(text, text, text, text, text, text),
  public.toggle_follow_signal(uuid),
  public.mark_signal_read(uuid),
  public.get_signal_post_analytics(uuid),
  public.view_moment(uuid),
  public.toggle_like_moment(uuid, text),
  public.delete_reping(uuid),
  public.get_or_create_direct_conversation(uuid),
  public.send_private_message(uuid, text, text, text),
  public.mark_conversation_read(uuid),
  public.hide_or_delete_conversation(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.get_or_create_conversation(uuid),
  public.create_conversation(uuid),
  public.send_message(uuid, text, text, text)
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. Hub Broadcast Audience Authorization & Hub Forum Membership Hardening
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage own forum membership" ON public.hub_forum_members;
CREATE POLICY "Users manage own forum membership" ON public.hub_forum_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.hub_forums f
      WHERE f.id = hub_forum_members.forum_id
        AND public.hub_role(f.hub_id, (select auth.uid())) IS NOT NULL
        AND (
          public.hub_role(f.hub_id, (select auth.uid())) IN ('owner', 'admin', 'moderator')
          OR (
            f.access_level IN ('public', 'members')
            AND role = 'member'
            AND can_publish = f.allow_member_posts
          )
        )
    )
  );

DROP POLICY IF EXISTS "Readable hub broadcasts" ON public.hub_broadcasts;
DROP POLICY IF EXISTS "Public hub broadcasts viewable" ON public.hub_broadcasts;
CREATE POLICY "Public hub broadcasts viewable" ON public.hub_broadcasts
  FOR SELECT TO anon, authenticated
  USING (
    public.can_view_hub_content(hub_id)
    AND target_audience = 'public'
    AND (scheduled_for IS NULL OR scheduled_for <= now())
  );

DROP POLICY IF EXISTS "Authenticated hub broadcasts viewable" ON public.hub_broadcasts;
CREATE POLICY "Authenticated hub broadcasts viewable" ON public.hub_broadcasts
  FOR SELECT TO authenticated
  USING (
    public.can_view_hub_content(hub_id)
    AND (
      author_id = (select auth.uid())
      OR public.hub_role(hub_id, (select auth.uid())) IN ('owner', 'admin', 'moderator')
      OR (
        (scheduled_for IS NULL OR scheduled_for <= now())
        AND (
          target_audience = 'public'
          OR (
            target_audience = 'all_members'
            AND public.hub_role(hub_id, (select auth.uid())) IS NOT NULL
          )
          OR (
            target_audience = 'forum_members'
            AND forum_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.hub_forum_members hfm
              WHERE hfm.forum_id = hub_broadcasts.forum_id
                AND hfm.user_id = (select auth.uid())
            )
          )
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.mark_hub_broadcast_read(_broadcast_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_bc public.hub_broadcasts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bc FROM public.hub_broadcasts WHERE id = _broadcast_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Broadcast not found';
  END IF;

  IF NOT public.can_view_hub_content(v_bc.hub_id) THEN
    RAISE EXCEPTION 'Forbidden: broadcast is in a private Hub' USING ERRCODE = '42501';
  END IF;

  IF (v_bc.scheduled_for IS NOT NULL AND v_bc.scheduled_for > now())
     AND v_bc.author_id <> v_uid
     AND public.hub_role(v_bc.hub_id, v_uid) NOT IN ('owner', 'admin', 'moderator') THEN
    RAISE EXCEPTION 'Broadcast is not yet published' USING ERRCODE = '42501';
  END IF;

  IF v_bc.target_audience = 'staff'
     AND public.hub_role(v_bc.hub_id, v_uid) NOT IN ('owner', 'admin', 'moderator')
     AND v_bc.author_id <> v_uid THEN
    RAISE EXCEPTION 'Forbidden: staff-only broadcast' USING ERRCODE = '42501';
  ELSIF v_bc.target_audience = 'all_members'
     AND public.hub_role(v_bc.hub_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'Forbidden: Hub membership required to read this broadcast' USING ERRCODE = '42501';
  ELSIF v_bc.target_audience = 'forum_members'
     AND public.hub_role(v_bc.hub_id, v_uid) NOT IN ('owner', 'admin', 'moderator')
     AND v_bc.author_id <> v_uid
     AND NOT EXISTS (
       SELECT 1 FROM public.hub_forum_members hfm
       WHERE hfm.forum_id = v_bc.forum_id AND hfm.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'Forbidden: forum membership required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.hub_broadcast_reads (broadcast_id, user_id)
  VALUES (_broadcast_id, v_uid)
  ON CONFLICT (broadcast_id, user_id) DO NOTHING;

  IF FOUND THEN
    UPDATE public.hub_broadcasts
    SET read_count = read_count + 1
    WHERE id = _broadcast_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_hub_broadcast_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_hub_broadcast_read(uuid) TO authenticated, service_role;
