# PING Bug Register & System Audit Log

**Project:** Ping by DOT (`GODSON-create/pingbydot`)  
**Branch:** `fix/full-system-audit-repair`  
**Last Updated:** 2026-11-19  
**Classification Standard:** `VERIFIED WORKING` | `BROKEN` | `PARTIALLY WORKING` | `UI ONLY` | `BLOCKED BY EXTERNAL DEPENDENCY` | `NOT TESTED`

---

## 1. Active & Resolved Defect Register

| Bug ID | Area | Severity | Classification (Pre-Fix → Post-Fix) | Root Cause | Resolution / Status |
| --- | --- | --- | --- | --- | --- |
| **BUG-001** | Native & Web Lifecycle (`src/lib/native.ts`, `src/routes/__root.tsx`) | High | `BROKEN` → `VERIFIED WORKING` | `initializeNativeApp` re-attached `window.addEventListener("online"/"offline")` on every overlay/help toggle without cleanup, and Android `App.addListener("backButton")` captured a stale initial closure (`activeOverlay="none"`). | Guarded web connectivity binding with `webConnectivityBound` and routed native `backButton`/`appUrlOpen` through mutable `latestOnHardwareBack`/`latestNavigate` refs. Verified by unit tests. |
| **BUG-002** | Media Upload Reliability (`src/lib/storage.ts`) | High | `PARTIALLY WORKING` → `VERIFIED WORKING` | `uploadUserMedia` and `uploadPrivateDmMedia` had zero retry backoff on transient network/5xx/timeout errors. | Implemented `withTransientRetry` exponential backoff (up to 3 attempts on transient network/5xx/408/429 errors) while failing fast on 4xx, RLS, and missing-bucket errors. Verified by unit tests. |
| **BUG-003** | Draft Preservation (`src/components/ping/PingComposer.tsx`, `src/lib/draft-store.ts`) | Medium | `PARTIALLY WORKING` → `VERIFIED WORKING` | DM and Hub chat preserved drafts, but navigating away from `/create` discarded unfinished Ping drafts (headline, content, needs/offers, CTA, media). | Added `sessionStorage`-backed `getPingComposerDraft` / `savePingComposerDraft` / `clearPingComposerDraft`, automatic restoration banner with discard action, and automatic clear on publish. |
| **BUG-004** | Primary Navigation Architecture (`BottomNav.tsx`, `DesktopSidebar.tsx`, `SiteHeader.tsx`, `CreateStackModal.tsx`) | High | `PARTIALLY WORKING` → `VERIFIED WORKING` | Mobile bottom bar lacked `Inbox` (had `Community` + `Profile`) and `CreateStackModal` omitted direct entry points for `Create a Signal` and `Create a Hub`. | Aligned primary navigation across desktop, tablet, and mobile to the 5 destinations (`HOME \| EXPLORE \| CREATE \| HUBS \| INBOX`), moved mobile Profile shortcut to top header, and expanded `CreateStackModal` to Ping, Moment, Signal, Hub, and Go Live. |
| **BUG-005** | Account & Profile Controls (`settings.tsx`, `@{$username}.tsx`, `0028`) | Medium | `PARTIALLY WORKING` → `VERIFIED WORKING` (Code) / `BLOCKED BY EXTERNAL DEPENDENCY` (Remote DB DDL) | Settings lacked `location`, `website_url`, `profile_visibility`, Muted Accounts manager, and Account Data Export workflow. | Added forward-only migration `0028_phase1_profile_controls_and_mutes.sql` (strict owner-only RLS + `export_my_account_data()` RPC), UI controls in Settings & Profile, and graceful pre-0028 fallbacks. Remote DDL execution awaits operator approval + `LOVABLE_DB_MIGRATION_URL`. |
| **BUG-006** | Remote Database Migrations `0022`–`0028` Pending on Live Supabase (`exlttyafomvqfwgzzjrm`) | Critical | `BLOCKED BY EXTERNAL DEPENDENCY` | Live read-only PostgREST probe on 2026-11-19 confirmed tables/columns from `0000`–`0021` are live (15 profiles, 18 Pings, `media` bucket), while `0022`–`0028` (`hub_forum_posts`, `signal_messages`, `profiles.country/interests/location/website_url/profile_visibility`, `economic_events`, `account_verifications`, `monetization_offerings`, `dot_topup_intents`, `user_mutes`) return `PGRST205`/`400`. `LOVABLE_DB_MIGRATION_URL` is not configured locally. | Recorded as explicit production-migration blocker. App surfaces degrade cleanly with clear diagnostic messages rather than crashing; awaits operator approval and `LOVABLE_DB_MIGRATION_URL` to execute `npm run db:migrate`. |
| **BUG-007** | Parallel Vitest Timeout Flake (`src/test/phase1-qa-remediations.test.tsx`) | Low | `PARTIALLY WORKING` → `VERIFIED WORKING` | Dynamic `import("@/routes/index")` test hit its 15s timeout when 36 jsdom suites ran simultaneously on Windows CPU contention. | Increased test timeout to 30s; verified passing solo and in full suite runs. |
| **BUG-008** | TanStack Start Deprecation Warning (`inputValidator()`) | Low | `PARTIALLY WORKING` | `vite build` logs deprecation notices for `createServerFn().inputValidator()` in `admin.functions.ts`, `public-pings.functions.ts`, `public-hubs.functions.ts`, `public-comments.functions.ts`. | Logged in backlog for safe API migration in Phase 2 once TanStack Start version pin is audited. |
| **BUG-009** | Android Emulator / Physical Device Verification & iOS Xcode Signing | Medium | `BLOCKED BY EXTERNAL DEPENDENCY` | Local Windows host lacks Android SDK/ADB/JDK and macOS/Xcode; pre-built `android/app/build/outputs/apk/debug/app-debug.apk` exists from 2026-11-18. | Documented as `BLOCKED BY EXTERNAL DEPENDENCY`; Android device testing requires Android SDK/emulator or USB device, and iOS release readiness requires macOS + Xcode + Apple signing. |

---

## 2. Live Read-Only Supabase Verification Snapshot (2026-11-19)

Target project: `https://exlttyafomvqfwgzzjrm.supabase.co` (publishable key, zero writes performed).

| Resource | HTTP Status | Observed State | Classification |
| --- | --- | --- | --- |
| `public.profiles` | `206` | 15 rows live | `VERIFIED WORKING` |
| `public.pings` | `206` | 18 rows live | `VERIFIED WORKING` |
| `public.hubs`, `public.hub_forums`, `public.hub_broadcasts` | `200` | Tables live (0 rows) | `VERIFIED WORKING` |
| `public.moments`, `public.signals`, `public.signal_posts` | `200` | Tables live (0 rows) | `VERIFIED WORKING` |
| `public.private_messages`, `public.user_privacy_preferences` | `401` (`42501`) | Anon access properly denied by RLS/grants | `VERIFIED WORKING` |
| `storage.buckets` (`media`) | `200` | Bucket accessible | `VERIFIED WORKING` |
| `public.hub_forum_posts`, `public.signal_messages` (`0022`) | `404` (`PGRST205`) | Migration `0022` not yet applied remotely | `BLOCKED BY EXTERNAL DEPENDENCY` |
| `profiles.country/interests/onboarding_completed_at` (`0023`–`0024`) | `400` | Migrations `0023`–`0024` not yet applied remotely | `BLOCKED BY EXTERNAL DEPENDENCY` |
| `public.economic_events` (`0025`) | `404` (`PGRST205`) | Migration `0025` not yet applied remotely | `BLOCKED BY EXTERNAL DEPENDENCY` |
| `public.account_verifications`, `public.monetization_offerings` (`0026`) | `404` (`PGRST205`) | Migration `0026` not yet applied remotely | `BLOCKED BY EXTERNAL DEPENDENCY` |
| `public.dot_topup_intents`, `hubs.avatar_url` (`0027`) | `404` / `400` | Migration `0027` not yet applied remotely | `BLOCKED BY EXTERNAL DEPENDENCY` |
| `public.user_mutes`, `profiles.location/website_url/profile_visibility` (`0028`) | Pending | New forward-only migration `0028` awaiting operator approval | `BLOCKED BY EXTERNAL DEPENDENCY` |
