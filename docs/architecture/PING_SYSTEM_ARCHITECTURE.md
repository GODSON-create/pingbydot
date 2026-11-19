# PING System Architecture

**Project:** Ping by DOT (`GODSON-create/pingbydot`)  
**Architecture Style:** Modular Full-Stack TypeScript Monolith (SSR Web + Hybrid Native Capacitor Wrapper)  
**Last Updated:** 2026-11-19

---

## 1. Technology Stack

| Layer | Technology | Role |
| --- | --- | --- |
| **UI & Client Runtime** | React 19, TypeScript 5.8, Tailwind CSS v4, Radix UI, Lucide Icons, Sonner, Recharts | Design system (Obsidian `#090B0A`, Graphite `#171B18`, Electric Ping Green `#C7F36B`, Champagne Gold `#D8B66A`), WCAG AA/AAA contrast |
| **Routing & SSR** | TanStack Start (`@tanstack/react-start`), TanStack Router, TanStack Query v5, Vite 8, Nitro (Cloudflare target) | File-based SSR routes, validated URL search params, server functions (`createServerFn`), public social PNG card endpoint (`/api/public/ping-card/$id`) |
| **Backend & Database** | Supabase (PostgreSQL 15+, Auth, PostgREST, Realtime, Storage) + Drizzle ORM (`drizzle/migrations/0000`–`0030`) | Row Level Security (RLS) on all tables, SECURITY DEFINER / INVOKER RPCs, append-only audit & economic event ledgers |
| **Rich Sharing & OG Cards** | Satori + `@cf-wasm/resvg` | Shared Satori artwork tree for browser PNG export and public social image endpoint without arbitrary remote server-side fetches |
| **Mobile Native Wrapper** | Capacitor 8 (`@capacitor/android`, `@capacitor/ios`, App, Browser, Camera, Keyboard, Network, PushNotifications, Share, SplashScreen, StatusBar) | Shared web codebase compiled to `.output/mobile` SPA for Android (`app.lovable.pingbydot`) and iOS |
| **Testing & Quality** | Vitest 4, React Testing Library, jsdom, ESLint 9, Prettier | Unit, component, security policy, migration audit, and responsive layout verification |

---

## 2. Navigation & Surface Architecture

```text
PRIMARY NAVIGATION (5 Unified Destinations)
├── HOME     (/)          — Moments rail, 5-mode ranked feed (For You / Following / Latest / Trending / Opportunities), topic follows
├── EXPLORE  (/explore)   — Search, sort (Relevant/Recent/Popular), discovery filters, trending topics, Opportunities Hub
├── CREATE   (Modal)      — Unified Create Deck: Ping (/create with Polls & Scheduling), Moment, Signal, Opportunity, Hub, Go Live
├── HUBS     (/hubs)      — Community directory, Hub Forums, Broadcasts, Group Room, Feed, Events & RSVPs, Governance
└── INBOX    (/messages)  — Direct & Group Conversations (/messages & /signals) with edit/reply/forward/pin/react/save/search/archive

OPPORTUNITIES, MULTIMEDIA & DISTRIBUTION
├── Multimedia Feeds      (/media)                 — Dedicated Video, Image Gallery, Text & Moments feeds (shared content model)
├── Share Target Import   (/share-target)          — Cross-platform external link import with preserved source attribution
├── Signals Opportunities (/signals/opportunities) — 14-category structured opportunities, applications & publisher dashboard
└── Signal Channels       (/signals/channels)      — Institutional broadcast feeds & subscriber discussions

SECONDARY DESTINATIONS (Account Menu / Top Utility Controls)
├── Profile        (/@{$username}) — Public profile, PINGs, Moments/Highlights, Activity, Connections, Mute/Block/Report
├── Notifications  (Sheet)         — Replies, likes, and new followers with read-state tracking
├── DOT Wallet     (/balance)      — Non-cash DOT credit balance, daily streak check-in, ledger history
├── Analytics      (/analytics)    — 7/30/90-day creator engagement charts, category breakdown, top Pings
├── Upgrades       (/upgrades)     — Non-cash DOT tiers, Optional Identity/Professional Verification, Monetization catalog
├── Settings       (/settings)     — Profile, Location/Country/Website, Visibility, Social Connections, Privacy, Blocked, Muted, Data Export, Account Deletion
└── Administration (/admin)        — Role-verified moderation queue, Signal verification, Account verification review, Audit trail
```

---

## 3. Security & Data Integrity Boundaries

1. **Zero Service-Role Exposure in Client Code:** Client bundles only read `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Admin server functions (`src/lib/admin.functions.ts`) verify the caller's database role before importing any privileged client.
2. **Strict Row Level Security (RLS):** Every application table enables RLS and enforces least-privilege SQL grants. Automated security tests (`src/lib/security-policies.test.ts`) verify zero open `USING (true)` policies in migrations.
3. **Private Storage Isolation:**
   - `media` bucket (`0021`/`0027`): public read for Pings, Moments, avatars, Hub emblems; owner-folder-scoped writes (`(storage.foldername(name))[1] = auth.uid()::text`).
   - `dm-attachments` bucket (`0027`): **private** (`public = false`); read access restricted to uploader or active `conversation_members` via signed URLs (`storage://dm-attachments/...`).
4. **Economic & Payment Separation (`0019`, `0025`, `0026`, `0027`):**
   - `dot_wallets` and `dot_transactions` track non-cash DOT builder credits only; direct client writes are revoked.
   - `economic_events` is append-only; client RPC `record_network_event` strips forbidden financial/PII keys and blocks client-fabricated `transaction_completed` events.
   - `verified_economic_outcomes` is server-only (`currency <> 'DOT'`).
   - `account_verifications` prohibits direct client writes and blocks self-approval even for admins.
5. **Client Reliability Layer:**
   - Global `NavOverlayProvider` guarantees at most one open overlay and instant dismissal on route change.
   - `draft-store.ts` preserves unsent DM, Hub Chat, and Ping Composer drafts in `sessionStorage` and coordinates focused full-screen mobile chat states (`useFocusedWorkspace`).
   - `storage.ts` applies bounded exponential-backoff retries on transient network/5xx errors without retrying RLS/4xx errors.
   - `feature-flags.ts` governs controlled UI rollouts across Phases 1–5 without bypassing server permissions.
