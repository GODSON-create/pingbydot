-- Ping V1/V2 database postflight. READ-ONLY.
-- Run after the approved migrations and code/schema reconciliation.

SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;

WITH expected(table_name) AS (
  VALUES
    ('hubs'),('hub_members'),('hub_pings'),('hub_invites'),('hub_messages'),('hub_message_reactions'),
    ('ping_read_receipts'),('user_privacy_preferences'),
    ('signals'),('signal_publishers'),('signal_followers'),('signal_posts'),('signal_reads'),
    ('moments'),('moment_views'),('moment_likes'),('moment_replies'),('moment_repings'),
    ('highlights'),('highlight_items'),('user_close_circle'),
    ('conversations'),('conversation_members'),('private_messages'),('conversation_messages'),('user_blocks'),
    ('dot_wallets'),('dot_transactions'),('account_subscriptions'),('profile_reports'),
    ('saved_pings'),('hub_forums'),('hub_forum_members'),('hub_broadcasts'),('hub_broadcast_reads')
)
SELECT e.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status,
       COALESCE(c.relrowsecurity,false) AS rls_enabled
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema='public' AND t.table_name=e.table_name
LEFT JOIN pg_namespace n ON n.nspname='public'
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name AND c.relkind IN ('r', 'v')
ORDER BY e.table_name;

SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
AND p.proname IN (
 'create_hub','join_hub','leave_hub','delete_hub','mark_hub_messages_read',
 'get_message_read_summary','toggle_hub_message_reaction',
 'create_signal','update_signal','toggle_follow_signal','manage_signal_publisher',
 'mark_signal_read','get_signal_post_analytics','view_moment',
 'toggle_like_moment','reping_moment','delete_reping',
 'update_highlight','remove_moment_from_highlight',
 'create_conversation','send_message','get_or_create_direct_conversation','send_private_message',
 'is_admin','get_my_dot_summary','claim_daily_dot','upgrade_account_with_dots','get_public_account_tier',
 'get_creator_analytics','mark_hub_broadcast_read','is_conversation_member','is_close_circle_member'
)
ORDER BY p.proname, arguments;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
AND tablename IN (
 'hubs','hub_members','hub_pings','hub_invites','hub_messages','hub_message_reactions',
 'signals','signal_publishers','signal_followers','signal_posts','signal_reads',
 'moments','moment_views','moment_likes','moment_replies','moment_repings',
 'highlights','highlight_items','user_close_circle',
 'conversations','conversation_members','private_messages','user_blocks'
)
ORDER BY tablename, policyname;
