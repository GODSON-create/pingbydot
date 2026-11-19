# PING Master Product Roadmap (Five-Phase Blueprint)

**Project:** Ping by DOT (`GODSON-create/pingbydot`)  
**Objective:** Evolve Ping into a unified social, communication, discovery, business, and economic network while keeping Ping, DOT, GRIOT AI, and Avantage cleanly separated.  
**Last Updated:** 2026-11-19

---

## Product Layer Independence

- **Ping** — Broad social, communication, discovery, and economic network. Free everyday access with no compulsory verification, DOT ownership, or builder-programme requirement.
- **DOT** — Builder qualification, progression, and non-cash activity credit layer (strictly separated from fiat cash balances, revenue, and settlement liabilities).
- **GRIOT AI** — Intelligence layer (Phase 5, permission-bounded, never silently reading private messages).
- **Avantage** — Wider venture and capital ecosystem.

---

## Phase Overview & Live Status

| Phase | Name | Overall Status | Key Gate / Dependency |
| --- | --- | --- | --- |
| **Phase 1** | Foundation, Reliability and Experience | **Code Complete & Verified Locally** (Remote DB migrations `0022`–`0028` & physical Android/iOS device QA pending external credentials/hardware) | Operator approval + `LOVABLE_DB_MIGRATION_URL` for `0022`–`0028`; Android SDK/emulator for device run; macOS/Xcode for iOS |
| **Phase 2** | Social Network, Communication and Community | **Code Complete & Verified Locally** (Remote DB migrations `0022`–`0029` & RTC voice/video provider credentials pending) | Operator approval + `LOVABLE_DB_MIGRATION_URL` for `0022`–`0029`; RTC provider (LiveKit/Daily/Agora) before activating live voice/video calls |
| **Phase 3** | Multimedia, Music and Universal Distribution | **Code Complete & Verified Locally** (Remote DB migration `0030`, external video transcoding provider credentials, commercial music licensing, and Play/Apple Universal Link signing pending) | Operator approval + `LOVABLE_DB_MIGRATION_URL` (`0022`–`0030`); Cloudflare Stream / Mux credentials; commercial music licensing; Android SHA-256 & Apple Team ID for App/Universal Links |
| **Phase 4** | Business, Opportunities and Economic Infrastructure | **Code Complete & Verified Locally** (Remote DB migration `0031`, Paystack sandbox/live keys, Meta WhatsApp Business approval, commercial/tax/ad policy sign-off, and crypto rail approval pending) | Operator approval + `LOVABLE_DB_MIGRATION_URL` (`0022`–`0031`); `PAYSTACK_SECRET_KEY` + `VITE_PAYSTACK_PUBLIC_KEY`; commercial, tax & ad policy sign-off; optional Meta WhatsApp Business Platform credentials |
| **Phase 5** | AI, Developer Ecosystem, Native Applications and Scale | **Planned (Foundations Built)** — Feature flags, 1M readiness indexes (`0022`), staging load-test harness, and Capacitor native shell prepared; GRIOT AI, Developer Portal, OAuth, Webhooks, Business Messaging API, SDKs, offline queues, and continental localisation planned | AI provider credentials, OAuth security review, CDN/search infrastructure, Google Play & App Store signing |

---

## Detailed Phase 1 Status Checklist

- [x] **1.1 Complete system audit** — All routes, components, APIs, storage buckets, RLS policies, and live Supabase PostgREST state audited and recorded in `docs/quality/PING_BUG_REGISTER.md` and `docs/product/PING_FEATURE_INVENTORY.md`.
- [x] **1.2 Repair core features** — Pings, Moments, Hubs, Hub Forums/Chat, Signals, Explore, Profiles, Direct Messaging, Notifications, DOT Wallet, Subscriptions, Creator Analytics, and Admin hardened with profile auto-recovery (`ensureClientProfileRow`), upload retries, and explicit error diagnostics.
- [x] **1.3 Five-destination primary navigation** — Unified `HOME | EXPLORE | CREATE | HUBS | INBOX` across desktop sidebar, tablet header, and mobile bottom nav; unified 5-option `CreateStackModal` (Ping, Moment, Signal, Hub, Go Live); zero overlapping overlays; draft preservation across DM, Hub Chat, Onboarding, and Ping Composer.
- [x] **1.4 Authentication & universal onboarding** — Google + email auth, recovery, session restoration, 3-slide `WelcomeCarousel`, 4-step universal optional onboarding (name, username, country, optional avatar, 10 universal interest categories, suggested people & Hubs) without forcing founder/investor identity or repeating for returning users.
- [x] **1.5 Account & profile infrastructure** — Profile editing, username management, avatar upload, bio, location, country, website URL, interests, social connections, account visibility (`public`/`followers`/`private`), followers/following, blocked users, muted accounts (`user_mutes`), account deletion (`delete_user_account`), and self-service JSON data export (`export_my_account_data`).
- [x] **1.6 Reliability & performance infrastructure** — Centralised error capture & credential sanitization, `QueryClient` smart retry/reconnect defaults, media upload exponential backoff retry, rate limiting (`PING SHIELD`), structured sanitized telemetry (`trackApiError`, `trackPerformanceMetric`), typed feature flags (`src/lib/feature-flags.ts`), and scale indexes (`0022`).
- [x] **1.7 Native application preparation** — Capacitor 8 Android & iOS configs, icons/splash, safe areas, status bar, keyboard avoidance, deep links (`pingbydot://` + HTTPS), native share, camera/media pickers, opt-in push notifications, and non-leaking hardware back/network listeners. *(Blocked: live Android emulator/device execution & macOS/Xcode iOS signing.)*
- [ ] **1.8 Production remote DB migrations `0022`–`0028`** — *Blocked awaiting operator approval and `LOVABLE_DB_MIGRATION_URL` secret.*

---

## Detailed Phase 2 Status Checklist

- [x] **2.1 Social graph** — Mutual connections indicator (`mutualConnectionsQuery`), Save Account bookmark toggle (`user_saved_accounts`), and Follow Topics (`user_topic_follows`) with pre-`0029` graceful fallback.
- [x] **2.2 Ping content and interactions** — Clickable `@mentions` and `#hashtags` (`RichPingText`), multi-reactions (`PingReactionBar` + `ping_reactions`), interactive Polls (`PingPollCard` + `ping_polls`/`ping_poll_options`/`ping_poll_votes`), Quote & Re-Ping flow (`/create?quote=...`), and Content Scheduling (`scheduled_for`).
- [x] **2.3 Personalised Home feed** — Anti-engagement-bait relevance ranking engine (`src/lib/feed-engine.ts`), 5 feed tabs (`For You`, `Following`, `Latest`, `Trending`, `Opportunities`), followed-topic chips, and muted/blocked filtering.
- [x] **2.4 Moments & Highlights** — Multi-slide photo/video composer with retry preservation, 24h expiry, Close Circle privacy, Highlights, and profile Moments viewer.
- [x] **2.5 Direct messaging** — Message editing, quoted reply, forwarding dialog, per-message reactions, pinned messages banner, saved messages, in-conversation search, and conversation Mute / Archive controls. *(Voice/Video calls intentionally NOT faked — documented as `BLOCKED BY EXTERNAL DEPENDENCY` pending RTC provider credentials.)*
- [x] **2.6 Group communication** — Group conversation creation (`NewGroupChatDialog` + `create_group_conversation` RPC), group title/description, announcement-only admin posting mode, and member directory with admin removal/self-leave controls.
- [x] **2.7 Hubs community infrastructure** — Forums, Broadcasts, Group Room, Feed, Members, Governance, plus Phase 2 Hub Events & RSVPs (`HubEventsSection`, `hub_events`, `hub_event_rsvps`) and extensible `membership_model` column (paid community checkout kept disabled).
- [x] **2.8 Signals opportunity infrastructure** — Dedicated `/signals/opportunities` portal supporting all 14 blueprint categories, structured publishing, Apply/Express Interest workflow, 1-click DM follow-up, My Applications tracker, and Publisher Review Dashboard (`signal_opportunities`, `signal_applications`).
- [x] **2.9 Central notification centre** — Grouped notifications (`groupNotifications`), central `notifications` table (`0029`) merged with live network activity, Mark All Read, and per-category Notification Preferences in Settings.
- [x] **2.10 Global search & Explore** — Sort controls (`Relevant`, `Recent`, `Popular`), trending hashtag follow chips, muted/blocked filtering, and Opportunities Hub integration.
- [ ] **2.11 Production remote DB migration `0029` & Voice/Video RTC provider** — *Blocked awaiting operator approval + `LOVABLE_DB_MIGRATION_URL` (for `0022`–`0029`) and RTC provider credentials (for live calls).*

---

## Detailed Phase 3 Status Checklist

- [x] **3.1 Unified multimedia publishing** — Single unified composer (`PingComposer.tsx` + `create.tsx`) supporting Text, Single Image, Multi-Image Galleries (up to 4 photos), Video (MP4/WebM/MOV), Text/Image/Video + Music, captions, hashtags, mentions, location tags, drafts, scheduling, and pre-publish live preview.
- [x] **3.2 Dedicated multimedia feeds (shared content architecture)** — `/media` (`src/routes/media.tsx`) serving Video Feed (`VideoFeedPlayer.tsx` with autoplay preference, play/pause, mute/sound, captions toggle, views & watch-time analytics, reactions, comments, re-ping, share, copyright reporting), Image Gallery Feed with lightbox, Text Discussion Feed, and Moments — zero duplicated content systems.
- [x] **3.3 Provider-agnostic video infrastructure** — `src/lib/media-pipeline.ts` + `media_assets` / `ping_video_views` / `copyright_reports` (`0030`), client duration/size validation, client poster-frame capture, upload retry, and swappable adapter registry (`supabase_storage` active; `cloudflare_stream` and `mux` pluggable via env without app rebuild).
- [x] **3.4 Music & audio integration (rights-respecting)** — Reusable `content_music_attachments` & `music_tracks` (`0030`), `MusicAttachmentPicker.tsx`, `MusicAttachmentBar.tsx`, Ping CC0 Original starter stems, Original Audio uploads with mandatory ownership declaration, regional availability & takedown fallbacks, and commercial licensed catalog kept gated pending provider agreements.
- [x] **3.5–3.8 Universal sharing, rich share cards & honest platform restrictions** — `src/lib/sharing/universal.ts`, `UniversalShareDialog.tsx`, upgraded `ShareCardDialog.tsx`, attributed `?ref=` links, direct destinations (WhatsApp, X, Telegram, Facebook, LinkedIn, Email, SMS), Native Share Sheet, Copy Link, honest Instagram/Snapchat card-share guidance, and `.well-known/assetlinks.json` + `.well-known/apple-app-site-association` templates.
- [x] **3.9 Cross-platform content import** — `/share-target` (`src/routes/share-target.tsx`) parsing links from X, YouTube, Snapchat, WhatsApp, Instagram, LinkedIn, and websites with preserved source attribution and handoff to `/create` without copying restricted media.
- [x] **3.10 Honest share analytics** — `share_events` + `record_share_event` (`0030`) + inbound `?ref=` referral capture in `__root.tsx`, tracking initiated shares & attributed clicks without fabricating external completion metrics.
- [ ] **3.11 External Phase 3 production activations** — *Blocked awaiting remote DB migrations `0022`–`0030`, Cloudflare Stream / Mux credentials, commercial music licensing agreements, and Play/Apple Universal Link signing values.*

---

## Detailed Phase 4 Status Checklist

- [x] **4.1 Business & organisation profiles** — Separate business profiles (`/businesses`, `/b/$slug`, `/business`) with category, location, website, hours, verification status, and role-based team roster (`owner`, `admin`, `agent`, `analyst`) without sharing personal passwords (`business_profiles`, `business_team_members`, `is_business_member` in `0031`).
- [x] **4.2 Business pages & storefronts** — Product & service catalogues, pricing displays, booking/enquiry triggers, customer reviews & star reputation, and explicit merchant-of-record disclosure (`business_offerings`, `business_reviews`).
- [x] **4.3 & 4.6 Multi-agent business messaging & lead CRM** — Business Inbox with lead stages (`new -> qualified -> in_progress -> won/lost/closed`), agent assignment, saved replies, private internal notes, average response-time analytics, and formula-injection-safe authorised CSV lead export (`business_enquiries`, `business_saved_replies`).
- [x] **4.4 Business integrations & optional WhatsApp Business Platform** — Independent native Ping Business Inbox with explicit readiness architecture for Phase 5 CRM/booking APIs and optional official Meta WhatsApp Business Platform onboarding (never impersonating or bypassing WhatsApp rules).
- [x] **4.5 Structured opportunity marketplace** — Connected Signals Opportunities (`/signals/opportunities`) with search, 14 categories, location, eligibility, expiry, applicant & publisher review workflows.
- [x] **4.7 Creator monetisation** — Transparent Creator Partnerships & Commercial Portfolio (`creator_commercial_profiles` in `0031`, wired into `/analytics`) without promising earnings solely from likes/views.
- [x] **4.8 Controlled business advertising foundation** — Sponsored Ping / Signal / Hub campaign drafts with budgets & regional targeting (`ad_campaigns`, `ad_reports`), strictly gated (`billing_approved = false`, `pending_policy_review`) until approved billing & advertising policies exist.
- [x] **4.9 DOT wallet infrastructure & Paystack signed webhook** — Custom DOT top-up quotes (`10–100,000 DOT`), fraud/velocity limits (`create_dot_topup_intent`), signed HMAC-SHA512 Paystack webhook receiver (`/api/webhooks/paystack`), server-only idempotent settlement & reversals (`settle_dot_topup_intent`, `reverse_dot_topup_intent` revoked from `authenticated`/`anon`), provider-independent crypto rail placeholder kept inactive, and strict ledger separation from fiat balances/revenue.
- [x] **4.10 Paid community infrastructure foundation** — `hub_membership_plans` (`0031`) with `live_checkout_enabled = false` preserving free core Ping access.
- [x] **4.11 Economic outcome analytics & 4.12 Revenue architecture** — `/analytics` integrates `creatorEconomicSummaryQuery` strictly separating non-cash DOT credits from verified settled revenue, and `/business` documents all 10 revenue engines with pricing models and compliance gates.
- [ ] **4.13 External Phase 4 commercial activations** — *Blocked awaiting remote DB migrations `0022`–`0031`, Paystack sandbox/live keys, commercial/tax/ad policy sign-off, optional Meta WhatsApp approval, and explicit crypto provider approval.*

---

## Backlog Discovered During Audit (Mandatory Follow-Up Rule)

1. Migrate TanStack Start server functions from deprecated `.inputValidator()` to `.validator()` (maintenance).
2. ~~Filter muted accounts from Home feed and Explore feed~~ — **Completed in Phase 2** (`src/routes/index.tsx`, `src/routes/explore.tsx`, `src/lib/feed-engine.ts`).
3. Enforce `profile_visibility` (`followers` / `private`) server-side in `fetchPublicPings` and profile RLS policies after `0028` is live.
4. Add server-side rate limiting via Supabase RPC / edge layer to complement client-side `PING SHIELD` limits.
5. ~~Build persistent `notifications` table~~ — **Schema & client integration completed in Phase 2 (`0029`)**; push dispatch worker + DB triggers scheduled after `0029` is applied remotely.
6. Select & configure WebRTC/SFU provider (e.g., LiveKit / Daily / Agora) for real voice/video calls (never ship fake call buttons).
