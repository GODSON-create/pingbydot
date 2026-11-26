# Ping by DOT — Vercel Production Deployment Runbook (`justping.cv`)

> **Status:** Prepared locally on branch `security/ping-stage2-remediation` — **NO** Vercel project settings, DNS records, or production deployments have been modified.

---

## 1. Current Local Build & Hosting Architecture Inspection

- **Framework:** TanStack Start (`@tanstack/react-start@1.168.60`) + Vite 8 (`vite@8.1.5`) + React 19 + Nitro 3 (`nitro@3.0.260603-beta`).
- **Config (`vite.config.ts`):** Uses `@lovable.dev/vite-tanstack-config`, whose Nitro plugin defaults to the **`cloudflare`** preset (generating `.output/server/wrangler.json` for Lovable Cloud / Cloudflare Workers) unless overridden via `NITRO_PRESET` or Vercel's Nitro preset detection.
- **Current Repo Files:**
  - No `vercel.json` currently exists in the repository (to avoid disrupting Lovable Cloud deployments before explicit approval).
  - `src/lib/site.ts` computes `SITE_ORIGIN` from `VITE_SITE_ORIGIN` (defaulting to `https://pingbydot.lovable.app` if unset).
  - `public/manifest.webmanifest`, `public/sw.js`, `public/.well-known/assetlinks.json`, and `public/.well-known/apple-app-site-association` are served as static assets from `public/`.

---

## 2. Live Vercel Project Inspection Blocker (Action Needed Before Cutover)

Live inspection of the Vercel project serving **`justping.cv`** and **`www.justping.cv`** (connected GitHub repository, current production branch, active domains, and configured environment variable names) requires authenticating the Vercel plugin or Vercel CLI:
- Local `vercel` CLI is not installed on this workstation, and the `vercel-plugin` MCP server is currently awaiting user sign-in.
- Once signed in, run the read-only verification commands below **before** changing any production settings:

```bash
vercel whoami
vercel project ls
vercel domains inspect justping.cv
vercel domains inspect www.justping.cv
vercel env ls
```

---

## 3. Target Git & Environment Promotion Policy

| Branch / Event | Vercel Environment | Target Domain | Notes |
| --- | --- | --- | --- |
| Feature branches (e.g. `security/ping-stage2-remediation`) | **Preview** | `*.vercel.app` preview URL | Automatic preview deploy for QA; never alters production DNS or `justping.cv`. |
| Pull Request merged into `main` | **Production** | `https://justping.cv` & `https://www.justping.cv` | Single production branch (`main`). Preserve both apex and `www` domains and existing redirect/TLS settings. |

---

## 4. Proposed `vercel.json` Configuration (Apply Only After Explicit Approval)

Because `@lovable.dev/vite-tanstack-config` defaults Nitro to `cloudflare`, Vercel deployments should explicitly set `NITRO_PRESET=vercel` in the Vercel project build command (or Vercel Environment Variables) and apply proper PWA + `.well-known` headers:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "NITRO_PRESET=vercel npm run build",
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        { "key": "Content-Type", "value": "application/manifest+json; charset=utf-8" },
        { "key": "Cache-Control", "value": "public, max-age=3600" }
      ]
    },
    {
      "source": "/.well-known/apple-app-site-association",
      "headers": [
        { "key": "Content-Type", "value": "application/json; charset=utf-8" },
        { "key": "Cache-Control", "value": "public, max-age=3600" }
      ]
    },
    {
      "source": "/.well-known/assetlinks.json",
      "headers": [
        { "key": "Content-Type", "value": "application/json; charset=utf-8" },
        { "key": "Cache-Control", "value": "public, max-age=3600" }
      ]
    }
  ]
}
```

> **Note:** Leaving `vite.config.ts` unchanged keeps `npm run build` (Lovable Cloud / Cloudflare) and `npm run mobile:web` (Capacitor SPA) 100% intact, while setting `NITRO_PRESET=vercel` on Vercel targets Vercel Functions cleanly. Verify in a **Preview Deployment** first before merging to `main`!

---

## 5. Required Vercel Environment Variables (Names Only — Never Commit Secrets)

### Required for Production (`main` → `justping.cv`) and Preview
- `NITRO_PRESET` = `vercel` (Build-time Nitro output target for Vercel)
- `VITE_SUPABASE_URL` — Lovable Cloud / Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase anon/publishable client key
- `VITE_SITE_ORIGIN` = `https://justping.cv` (Production) / preview origin or `https://justping.cv` (Preview)

### Optional Server-Side / Phase 2 Variables (Keep Disabled Until Explicitly Approved)
- `VITE_MEDIA_PROVIDER` = `lovable_cloud` (do **not** set to `cloudflare_r2` until R2 cutover is approved)
- `PING_MEDIA_PROVIDER` = `lovable_cloud`
- `SUPABASE_SERVICE_ROLE_KEY` (only needed when server-side R2 / retention cron API routes are enabled)
- `PING_RETENTION_CRON_SECRET` (only needed when retention purge cron is explicitly enabled)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL` (only for approved Phase 2 R2 cutover)

---

## 6. Post-Preview Verification Checklist (Before Merging to `main`)

1. Verify Supabase Auth **Redirect URLs** include `https://justping.cv/login`, `https://www.justping.cv/login`, `https://*.vercel.app/login` (if testing previews), and `pingbydot://login`.
2. Confirm `/manifest.webmanifest`, `/sw.js`, `/download`, `/.well-known/assetlinks.json`, and `/.well-known/apple-app-site-association` all return `HTTP 200` with expected `Content-Type` headers on the Preview URL.
3. Confirm SSR routes (`/`, `/explore`, `/hubs`, `/signals/channels`, `/download`) and API routes resolve without `500` errors under Nitro Vercel preset.
4. Confirm `justping.cv` and `www.justping.cv` remain bound exclusively to the Production (`main`) deployment.
