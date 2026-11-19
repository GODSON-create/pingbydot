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
| **Phase 2** | Social Network, Communication and Community | **In Progress (Foundations Built)** — Follows, Pings, Moments, DMs, Hub Forums/Chat, Signal Channels, Notifications, Explore exist; group chat, voice/video calls, polls, scheduled posts, rich reactions, and opportunity applications scheduled next | Phase 1 sign-off + remote DB migrations `0022`–`0028` |
| **Phase 3** | Multimedia, Music and Universal Distribution | **Planned (Foundations Built)** — Satori Share Cards, Web/Native Share API, deep links, and image/video uploads exist; dedicated Video/Image/Text feeds, external video transcoding, licensed music catalog, and OS share-intent imports planned | Video transcoding provider selection & licensed music catalog rights |
| **Phase 4** | Business, Opportunities and Economic Infrastructure | **Planned (Foundations Built)** — `economic_events`, `verified_economic_outcomes`, `account_verifications`, `monetization_offerings`, and `dot_topup_intents` schemas prepared; Business profiles, storefronts, multi-agent business inboxes, Paystack webhook settlement, and ads engine planned | Paystack sandbox/live keys, commercial & tax policy approval, Meta WhatsApp Business Platform approval (optional) |
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

## Backlog Discovered During Audit (Mandatory Follow-Up Rule)

1. Migrate TanStack Start server functions from deprecated `.inputValidator()` to `.validator()` (Phase 2 maintenance).
2. Filter muted accounts from Home feed, Explore feed, and Notification sheet queries once `0028` is live (Phase 2).
3. Enforce `profile_visibility` (`followers` / `private`) server-side in `fetchPublicPings` and profile RLS policies after `0028` is live (Phase 2).
4. Add server-side rate limiting via Supabase RPC / edge layer to complement client-side `PING SHIELD` limits (Phase 2).
5. Build persistent `notifications` table + push dispatch pipeline to replace client-side notification fan-out queries (Phase 2).
