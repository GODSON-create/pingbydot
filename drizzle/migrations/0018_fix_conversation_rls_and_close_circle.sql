-- ==============================================================================
-- Migration 0018: Fix conversation_members RLS Infinite Recursion (42P17),
--                 Qualify private_messages Policy Columns, and Fix Close Circle
--                 / Active Hub Membership Visibility for Moments
-- ==============================================================================

-- 1. SECURITY DEFINER helper for conversation membership (prevents 42P17 recursion)
CREATE OR REPLACE FUNCTION public.is_conversation_member(
  _conversation_id uuid,
  _user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = coalesce(_user_id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated, service_role;

-- 2. Replace recursive/unqualified policies on Direct Messaging tables (0014)
DROP POLICY IF EXISTS "Members read own conversations" ON public.conversations;
CREATE POLICY "Members read own conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversations.id, (select auth.uid())));

DROP POLICY IF EXISTS "Members read conversation members" ON public.conversation_members;
CREATE POLICY "Members read conversation members" ON public.conversation_members
  FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR public.is_conversation_member(conversation_members.conversation_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS "Members read conversation messages" ON public.private_messages;
CREATE POLICY "Members read conversation messages" ON public.private_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      WHERE cm.conversation_id = private_messages.conversation_id
        AND cm.user_id = (select auth.uid())
        AND (cm.hidden_at IS NULL OR private_messages.created_at > cm.hidden_at)
    )
  );

DROP POLICY IF EXISTS "Members insert conversation messages" ON public.private_messages;
CREATE POLICY "Members insert conversation messages" ON public.private_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      WHERE cm.conversation_id = private_messages.conversation_id
        AND cm.user_id = (select auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_members other_member
      JOIN public.user_blocks b ON (
        (b.blocker_id = other_member.user_id AND b.blocked_id = (select auth.uid()))
        OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = other_member.user_id)
      )
      WHERE other_member.conversation_id = private_messages.conversation_id
        AND other_member.user_id <> (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Conversation messages visible to participants" ON public.conversation_messages;
CREATE POLICY "Conversation messages visible to participants" ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_messages.conversation_id, (select auth.uid())));

DROP POLICY IF EXISTS "Participants insert conversation messages" ON public.conversation_messages;
CREATE POLICY "Participants insert conversation messages" ON public.conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND public.is_conversation_member(conversation_messages.conversation_id, (select auth.uid()))
  );

-- 3. SECURITY DEFINER helper for private Close Circle membership checks in Moments RLS
CREATE OR REPLACE FUNCTION public.is_close_circle_member(
  _owner_id uuid,
  _member_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_close_circle
    WHERE user_id = _owner_id
      AND member_id = coalesce(_member_id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_close_circle_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_close_circle_member(uuid, uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Moments viewable by authorized audience" ON public.moments;
CREATE POLICY "Moments viewable by authorized audience" ON public.moments
  FOR SELECT TO anon, authenticated
  USING (
    deleted_at IS NULL AND (
      author_id = (select auth.uid()) OR
      audience = 'public' OR
      (
        audience = 'followers' AND EXISTS (
          SELECT 1 FROM public.follows
          WHERE follower_id = (select auth.uid()) AND following_id = moments.author_id
        )
      ) OR
      (
        audience = 'hub' AND hub_id IS NOT NULL AND public.hub_role(moments.hub_id, (select auth.uid())) IS NOT NULL
      ) OR
      (
        audience = 'close_circle' AND public.is_close_circle_member(moments.author_id, (select auth.uid()))
      )
    )
  );
