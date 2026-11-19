# PING API, Server Functions & RPC Catalogue

**Project:** Ping by DOT (`GODSON-create/pingbydot`)  
**Last Updated:** 2026-11-19

---

## 1. HTTP & Server-Rendered Routes

| Endpoint / Route | Source File | Auth / Visibility | Purpose |
| --- | --- | --- | --- |
| `GET /api/public/ping-card/$id` | `src/routes/api/public/ping-card/$id.ts` | Public (non-hidden Pings only) | Renders Satori + resvg branded PNG share card with content-derived ETag & short caching; zero server-side arbitrary remote fetches |
| `GET /sitemap.xml` | `src/routes/sitemap[.]xml.ts` | Public | Router-derived XML sitemap + paginated public Ping & profile URLs (excludes private routes) |

---

## 2. TanStack Start Server Functions (`createServerFn`)

| Server Function | Source File | Auth / Permission | Purpose |
| --- | --- | --- | --- |
| `readPublicPings` | `src/lib/public-pings.functions.ts` | Public (publishable client) | Anonymous SSR reads for public feed, Ping detail (`/p/$id`), and public profile (`/@{$username}`) |
| `readPublicHubs` / `readPublicHub` | `src/lib/public-hubs.functions.ts` | Public (publishable client) | Public Hub directory and Hub detail SSR queries |
| `readPublicComments` | `src/lib/public-comments.functions.ts` | Public (publishable client) | Paginated root comments & nested replies for a public Ping |
| `checkAdminAccess` | `src/lib/admin.functions.ts` | Authenticated (verified `user_roles`) | Verifies whether current user holds an active admin role |
| `getAdminOverview` | `src/lib/admin.functions.ts` | Admin only | Platform totals (accounts, 30d active creators, Pings, hidden Pings, likes, open reports) |
| `getAdminList` | `src/lib/admin.functions.ts` | Admin only | Paginated moderation & management lists (`pings`, `users`, `reports`, `signals`, `verifications`, `audit`) |
| `moderatePing` | `src/lib/admin.functions.ts` | Admin only | Atomic hide/restore Ping or resolve report with mandatory audit trail reason |
| `verifySignal` | `src/lib/admin.functions.ts` | Admin only | Approve/reject institutional Signal verification status |
| `reviewVerification` | `src/lib/admin.functions.ts` | Admin only (anti-self-approval) | Approve/reject/revoke optional identity or professional verification request |

---

## 3. Supabase PostgreSQL RPCs

| RPC Name | Migration | Caller Grant | Purpose |
| --- | --- | --- | --- |
| `ensure_my_profile()` | `0022` / `0023` | `authenticated` | Idempotently creates missing `public.profiles` row for newly authenticated user |
| `complete_my_onboarding(...)` | `0023` / `0024` | `authenticated` | Persists universal onboarding (name, username, bio, avatar, country, interests, pathways, skip) |
| `save_profile_connection(...)` | `0008` | `authenticated` (SECURITY INVOKER) | Atomically saves external social connection & updates primary flag |
| `delete_user_account()` | `0014`+ | `authenticated` | Permanently deletes caller's account and associated data |
| `export_my_account_data()` | `0028` | `authenticated` | Returns owner-scoped JSON export of profile, Pings, Moments, hubs, connections, mutes/blocks, privacy & wallet |
| `create_hub(...)` / `update_hub(...)` / `delete_hub(...)` / `join_hub(...)` / `share_ping_to_hub(...)` | `0009` / `0015` / `0022` | `authenticated` | Hub lifecycle, membership/access requests, default forum seeding, and Ping cross-posting |
| `toggle_hub_message_reaction(...)` / `mark_hub_broadcast_read(...)` | `0015` / `0017` / `0020` | `authenticated` | Per-user Hub chat reaction toggles and audience-checked broadcast read receipts |
| `create_signal(...)` / `update_signal(...)` / `toggle_follow_signal(...)` / `add_signal_publisher(...)` / `remove_signal_publisher(...)` | `0011` / `0013` / `0015` | `authenticated` | Institutional Signal channel CRUD, follow counts, and role-checked publisher management |
| `reping_moment(...)` / `update_highlight(...)` / `remove_moment_from_highlight(...)` / `is_close_circle_member(...)` | `0012` / `0015` / `0018` / `0020` | `authenticated` | Moment re-pinging with audience-expansion guards, highlights curation, and anti-enumeration close circle check |
| `get_or_create_direct_conversation(...)` / `send_private_message(...)` / `get_my_conversations_summary(...)` / `mark_conversation_read(...)` / `block_user(...)` | `0014` / `0018` / `0020` / `0022` | `authenticated` | Private 1-on-1 DM conversations, single-query inbox summaries, read states, and blocking |
| `get_my_dot_summary()` / `claim_daily_dot()` / `upgrade_account_with_dots(...)` | `0016` / `0019` | `authenticated` | Server-validated non-cash DOT wallet reads, daily check-in streak rewards, and credit tier upgrades |
| `record_network_event(...)` | `0025` | `authenticated` | Append-only economic/activity event logger with server-side PII & financial key scrubbing |
| `record_verified_economic_outcome(...)` | `0025` | `service_role` ONLY | Server-only settlement ledger writer (`currency <> 'DOT'`) |
| `submit_verification_request(...)` / `review_verification_request(...)` / `get_public_verification_badges(...)` | `0026` | `authenticated` / `admin` / `anon+auth` | Optional identity & professional verification workflow with anti-self-approval guard |
| `get_monetization_foundation()` | `0026` | `anon`, `authenticated` | Returns non-compulsory offering catalog (`live_fiat_payments_enabled = false`) |
| `toggle_ping_reaction(...)` / `vote_ping_poll(...)` | `0029` | `authenticated` | Multi-reaction toggle and single-vote-per-user poll voting with expiry enforcement |
| `edit_private_message(...)` / `toggle_pin_private_message(...)` / `toggle_private_message_reaction(...)` / `update_conversation_member_prefs(...)` | `0029` | `authenticated` | Sender-verified message editing, member-verified pinning/reactions, and mute/archive preferences |
| `create_group_conversation(...)` / `add_group_member(...)` / `remove_group_member(...)` / `update_group_conversation(...)` | `0029` | `authenticated` | Group conversation creation, announcement-mode governance, and owner/admin member management |
| `submit_signal_application(...)` / `update_signal_application_status(...)` | `0029` | `authenticated` | Structured opportunity applications with publisher-only review transitions & applicant withdraw |
| `mark_notifications_read(...)` | `0029` | `authenticated` | Owner-scoped read-state update for central `public.notifications` inbox |
| `record_ping_video_view(...)` | `0030` | `anon`, `authenticated` | Records bounded video view & watch-time seconds for non-hidden Pings |
| `record_share_event(...)` | `0030` | `anon`, `authenticated` | Logs honest share analytics (`share_initiated`, `link_clicked`, `signup_attributed`) with referral codes |

---

## 4. Storage Buckets

| Bucket | Migration | Public | Max Size | Access Policy |
| --- | --- | --- | --- | --- |
| `media` | `0021` / `0027` | Yes | 50 MB | Public read; authenticated users write/update/delete strictly under `{auth.uid()}/...` |
| `dm-attachments` | `0027` | **No (Private)** | 50 MB | Authenticated upload under `{auth.uid()}/dm/{conversationId}/...`; signed URL read restricted to uploader or active `conversation_members` |
