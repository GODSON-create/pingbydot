-- ==============================================================================
-- Migration 0019: Lock Down Financial & Private Table Privileges (Revoke Default Grants)
-- Ensures Supabase default schema privileges cannot leave write permissions on
-- DOT financial tables or anonymous read access on private tables.
-- ==============================================================================

-- 1. Strict Financial Table Lockdown (DOT Economy: SELECT-only for authenticated, zero anon access)
REVOKE ALL ON public.dot_wallets, public.dot_transactions, public.account_subscriptions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dot_wallets, public.dot_transactions, public.account_subscriptions
  TO authenticated;
GRANT ALL ON public.dot_wallets, public.dot_transactions, public.account_subscriptions
  TO service_role;

-- 2. Private / Authenticated-Only Tables (Revoke all anon access)
REVOKE ALL ON
  public.user_privacy_preferences,
  public.ping_read_receipts,
  public.signal_followers,
  public.signal_reads,
  public.moment_views,
  public.moment_replies,
  public.user_close_circle,
  public.hub_message_reactions,
  public.profile_reports,
  public.saved_pings,
  public.hub_forum_members,
  public.hub_broadcast_reads
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.user_privacy_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ping_read_receipts TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.signal_followers TO authenticated;
GRANT SELECT, INSERT ON public.signal_reads TO authenticated;
GRANT SELECT, INSERT ON public.moment_views TO authenticated;
GRANT SELECT, INSERT ON public.moment_replies TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_close_circle TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.hub_message_reactions TO authenticated;
GRANT SELECT, INSERT ON public.profile_reports TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.saved_pings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.hub_forum_members TO authenticated;
GRANT SELECT, INSERT ON public.hub_broadcast_reads TO authenticated;

GRANT ALL ON
  public.user_privacy_preferences,
  public.ping_read_receipts,
  public.signal_followers,
  public.signal_reads,
  public.moment_views,
  public.moment_replies,
  public.user_close_circle,
  public.hub_message_reactions,
  public.profile_reports,
  public.saved_pings,
  public.hub_forum_members,
  public.hub_broadcast_reads
TO service_role;
