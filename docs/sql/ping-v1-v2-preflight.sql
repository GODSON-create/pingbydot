-- Ping V1/V2 database preflight. READ-ONLY: safe to run in Supabase SQL Editor.
-- Do not run a write migration until this report has been reviewed.

-- 1) Migration ledger (expected: applied through migration 0010 only).
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY id;

-- 2) Expected module tables and their presence.
WITH expected(table_name, release_area) AS (
  VALUES
    ('hubs','V1 Hubs'), ('hub_members','V1 Hubs'), ('hub_pings','V1 Hubs'),
    ('hub_invites','V1 Hubs'), ('hub_messages','V1 Hub messaging'),
    ('ping_read_receipts','V1 Hub read receipts'),
    ('user_privacy_preferences','V1 privacy'),
    ('signals','V1 Signals'), ('signal_publishers','V1 Signals'),
    ('signal_followers','V1 Signals'), ('signal_posts','V1 Signals'),
    ('signal_reads','V1 Signals'),
    ('moments','V1 Moments'), ('moment_views','V1 Moments'),
    ('moment_likes','V1 Moments'), ('moment_replies','V1 Moments'),
    ('moment_repings','V1 Moments'), ('highlights','V1 Highlights'),
    ('highlight_items','V1 Highlights'), ('user_close_circle','V1 privacy'),
    ('conversations','V1 direct messages'), ('conversation_messages','V1 direct messages')
)
SELECT e.release_area, e.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema='public' AND t.table_name=e.table_name
ORDER BY e.release_area, e.table_name;

-- 3) Relevant RPCs and signatures.
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'create_hub','join_hub','leave_hub','mark_hub_messages_read',
    'get_message_read_summary','create_signal','toggle_follow_signal',
    'mark_signal_read','get_signal_post_analytics','view_moment',
    'toggle_like_moment','reping_moment','delete_reping'
  )
ORDER BY p.proname, arguments;

-- 4) RLS status for all module tables.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relkind='r'
  AND c.relname IN (
    'hubs','hub_members','hub_pings','hub_invites','hub_messages',
    'ping_read_receipts','user_privacy_preferences','signals',
    'signal_publishers','signal_followers','signal_posts','signal_reads',
    'moments','moment_views','moment_likes','moment_replies',
    'moment_repings','highlights','highlight_items','user_close_circle',
    'conversations','conversation_messages'
  )
ORDER BY c.relname;

-- 5) Broad policies that need explicit review (permissive policies OR together).
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN (
    'profiles','pings','hubs','hub_members','hub_pings','hub_invites',
    'hub_messages','signals','signal_publishers','signal_followers',
    'signal_posts','signal_reads','moments','moment_views','moment_likes',
    'moment_replies','moment_repings','highlights','highlight_items',
    'user_close_circle','conversations','conversation_messages'
  )
ORDER BY tablename, policyname;

-- 6) Table grants for module tables.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN (
    'hubs','hub_members','hub_pings','hub_invites','hub_messages',
    'ping_read_receipts','user_privacy_preferences','signals',
    'signal_publishers','signal_followers','signal_posts','signal_reads',
    'moments','moment_views','moment_likes','moment_replies',
    'moment_repings','highlights','highlight_items','user_close_circle',
    'conversations','conversation_messages'
  )
ORDER BY table_name, grantee, privilege_type;

-- 7) Realtime publication membership.
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname='supabase_realtime'
ORDER BY tablename;

-- Expected from current inspection:
-- migration ledger stops at 10; tables from 0011 and 0012 are absent.
-- No conversations/conversation_messages schema exists. Migration 0005 is
-- misnamed: it creates comments, comment_likes, reports, notifications and
-- re-ping columns, not direct-message conversations.
