# PR #2 — Title

`feat(ping): V1/V2 human-coordination redesign, official brand marks, migrations 0011–0020, and security hardening`

---

# PR #2 — Body

## Overview

Evolves **Ping by DOT** into a mobile-first human-coordination network (`release/ping-v1-stabilization` → `main`) while preserving all existing Supabase authentication, backend integrations, and production user data (`profiles`, `pings`).

---

## Feature Implementations Included

- **Shell & 5-Destination Navigation (`__root.tsx`, `BottomNav.tsx`, `DesktopSidebar.tsx`, `SiteHeader.tsx`)**:
  - 5 primary destinations: **Home**, **Explore**, **Create** (elevated center action), **Community**, and **Profile** with mobile safe-area inset support and responsive desktop rail.
  - Contextual **4-item Community Bar** (`Back`, `Hub`, `Signal`, `Moment`) when entering Community spaces.
- **Official PING Brand & Boot Splash (`BrandLogo.tsx`, `BootSplashScreen.tsx`, `public/brand/*`)**:
  - Color-matched official PING marks across **Lime** (primary network, feed, analytics), **Gold** (DOT Wallet, upgrades, institutional broadcasts), and **Silver** (Moments, footer, admin, 404), plus the dark Boot Splash Screen.
- **Home Feed & Structured Intents (`index.tsx`, `PingCard.tsx`, `PingComposer.tsx`, `CreateStackModal.tsx`)**:
  - Stacked 3-option Create menu (**Create a PING**, **Create a Moment**, **Go Live** modular live-session dialog).
  - Structured intent taxonomy (`building`, `need`, `offer`, `opportunity`, `idea`, `question`, `collaboration`, `update`), bookmarks (`saved_pings`), likes, comments, shares, and For You / Following selectors.
- **Explore & Intent Discovery (`explore.tsx`)**:
  - Search (`"Find people, intentions, opportunities and more..."`), 6 horizontally scrollable filters (`All`, `PINGs`, `People`, `Moments`, `Communities`, `Opportunities`), Moments rail, People you should know, matching intentions, and recommended communities.
- **Moments & Close Circle (`MomentsTray.tsx`, `MomentComposer.tsx`, `MomentViewerModal.tsx`, `CloseCircleDialog.tsx`)**:
  - Horizontally scrollable Moments rail, vertical swipeable full-screen viewer with like/comment/reply/re-ping/share controls, Highlights, optional Ping/Hub Forum/Project links, and owner-private Close Circle audience isolation.
- **Hub Forums, Institutional Broadcasts & Signal 1-to-1 Chat (`HubForumsAndBroadcasts.tsx`, `hubs.tsx`, `hubs.$slug.tsx`, `messages.tsx`, `signals.tsx`, `signals.$slug.tsx`)**:
  - Subject-based Hub Forums (`general`, `topic`, `restricted`, `announcement`) and separate Institutional Broadcasts with role-scoped audience delivery (`public`, `all_members`, `forum_members`, `staff`) and atomic read tracking (`mark_hub_broadcast_read`).
  - Normalized 1-to-1 encrypted-isolation Direct Messaging (`conversations`, `conversation_members`, `private_messages`, `user_blocks`) under **Signal**, with block controls, unread counts, and typing presence.
- **Profile Redesign, DOT Wallet Economy & Upgrades (`@{$username}.tsx`, `balance.tsx`, `upgrades.tsx`, `analytics.tsx`)**:
  - Top-right three-line slide-over drawer surfacing live DOT Balance Summary, DOT Wallet, Verification/Upgrades (`Free`, `Builder Plus`, `Founder Pro`, `Institution`), Creator Analytics, Settings, Privacy & Security, Notifications, Help & Support, Account Management, and Logout.

---

## Database Migrations Applied & Verified (`0011`–`0020` on `exlttyafomvqfwgzzjrm`)

Building on pre-existing migrations `0000`–`0010`:

| Migration | Summary |
| :--- | :--- |
| `0011_hubs_signals_read_receipts` | Privacy preferences, Hub messages, Ping read receipts, Institutional Signals, publishers/followers/reads, syntax repair on `signal_reads` policy |
| `0012_moments_highlights_reping` | Moments, views, likes, replies, repings, Highlights, Highlight items, Close Circle table + RPCs |
| `0013_critical_repairs_hubs_signals` | Fixed Signal publisher self-promotion loophole (`manage_signal_publisher`, `verify_signal`, `update_hub`) |
| `0014_private_direct_messaging` | Direct conversations, membership, `private_messages`, `conversation_messages`, `user_blocks`, DM RPCs & Realtime |
| `0015_product_completion_sprint` | `is_admin(uuid)` helper, `hub_message_reactions`, per-user reaction toggle, `delete_hub`, `update_signal`, highlight RPCs |
| `0016_profile_economy_analytics_and_fixes` | `dot_wallets`, `dot_transactions`, `account_subscriptions`, `profile_reports`, unique `(user_id, source, reference_id)` transaction index, DOT & analytics RPCs |
| `0017_human_coordination_forums_broadcasts` | Structured Ping columns, Moment Ping/Forum/project refs, `saved_pings`, `hub_forums`, `hub_forum_members`, `hub_broadcasts`, `hub_broadcast_reads` |
| `0018_fix_conversation_rls_and_close_circle` | Fixed `42P17` infinite recursion in `conversation_members` RLS, qualified `private_messages.conversation_id`, added `is_conversation_member` & `is_close_circle_member` |
| `0019_lockdown_economy_and_private_grants` | Revoked default Supabase write grants on `dot_wallets`, `dot_transactions`, `account_subscriptions` (`SELECT`-only for `authenticated`), revoked `anon` privileges on 12 private tables |
| `0020_pre_merge_security_hardening` | Pre-merge security review fixes: enforced caller identity (`auth.uid()`) & revoked `anon` execute on `is_close_circle_member`; split public vs authenticated Moments RLS; enforced caller identity in `is_conversation_member`; hardened `upgrade_account_with_dots` duplicate-tier guard, made `dot_transactions` append-only against `service_role` `UPDATE`/`TRUNCATE`, revoked `PUBLIC`/`anon`/`service_role` execute on user wallet mutators and `PUBLIC`/`anon` on 20 auth RPCs; enforced `target_audience` & staff checks on `hub_broadcasts` and `hub_forum_members` |

---

## Pre-Merge Verification Evidence

- **Remote Schema (`exlttyafomvqfwgzzjrm`)**: `10/10` release migrations (`0011`–`0020`) recorded (`20` ledger rows total); `31/31` new tables present with RLS enabled; `40/40` PostgREST RPCs present and auth-gated; existing `profiles` and `pings` preserved untouched.
- **Close Circle Privacy Test**: Verified `anon` cannot execute `is_close_circle_member`, legitimate `'public'` Moment reads work anonymously (`1/1`), Close Circle member `User B` sees private Moment (`1`), outsider `User C` sees `0`, and spoofing third-party `_member_id` throws `42501 Forbidden`.
- **Two-Account Direct Message Isolation Test**: Verified `User A` & `User B` read/send in their 1-to-1 conversation (`2` members, `2` messages), third-party `User C` sees `0/0` rows, cannot send (`blocked`), and spoofing `_user_id` on `is_conversation_member` throws `42501 Forbidden`.
- **DOT Wallet Authorization Test**: Verified `50 -> 60` check-in and upgrade ledger consistency (`sum = balance`), duplicate `claim_daily_dot` and duplicate active-tier `upgrade_account_with_dots` blocked, direct `authenticated` writes to `dot_wallets`/`dot_transactions` blocked (`42501`), cross-user financial reads return `0/0`, and `service_role` `UPDATE`/`TRUNCATE` on `dot_transactions` & mutator RPC execute revoked.
- **Hub Broadcast & Forum Permission Test**: Verified outsider sees only `'public'` broadcasts (`1`), regular member sees `public` + `all_members` + `forum_members` (`3`) and `0` `'staff'` broadcasts, authorized read increments `read_count` (`1`), and non-member `staff_only` forum join, unauthorized read receipt, and non-staff broadcast publish are blocked.
- **Migration Runner (`scripts/migrate-remote.mjs`)**: Verified pinned to `exlttyafomvqfwgzzjrm`, blocks shared transaction pooler (`6543`), separates schema verification from persistence/authorization testing, refuses to report skipped tests as passed, and uses `VerificationRollbackSignal` (never swallows SQL errors).
- **Local Automated Checks**: `npm run lint` (`0` errors), `npx tsc --noEmit` (`0` errors), `npm test` (`23/23` files, `141/141` tests), `node scripts/wcag-audit.cjs` (`PASSED`), and `npm run build` (`vite build` + Nitro SSR).
