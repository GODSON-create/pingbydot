# PING Early-Access Installation & Multi-Channel Distribution Guide

**Canonical Official Download URL:** `/download`  
**Package / Bundle Identifier:** `app.lovable.pingbydot`  
**Current Early-Access Release Version:** `1.0.0-ea.1`  
**Last Updated:** 2026-11-20

---

## 1. Distribution Channel Status Matrix (Honest Assessment)

| Channel | Current Status | Verification Evidence | Known Blockers / Owner Actions Required |
| --- | --- | --- | --- |
| **Progressive Web App (PWA)** | **`VERIFIED` (Code & Assets Ready)** | `public/manifest.webmanifest`, real PNG icons (`192`, `512`, maskable `512`, `apple-touch-icon-180`), `public/offline.html`, privacy-hardened `public/sw.js`, `src/lib/pwa.ts`, `PwaInstallAndUpdateBanner.tsx`, logout cache wipe in `src/lib/auth.tsx`, unit-tested. | Deploy production web build over HTTPS to activate live `beforeinstallprompt` & Safari Add-to-Home-Screen on real mobile devices. |
| **Official Download Centre (`/download`)** | **`VERIFIED` (Code & UI Ready)** | `src/routes/download.tsx`, `src/lib/distribution.ts`, `public/releases/early-access-manifest.json`, unit-tested with referral attribution (`?ref=` / `?site=` / `?utm_source=`) and early-access form. | Apply migration `0035` remotely so `early_access_registrations` & `download_attribution_events` persist to live Supabase. |
| **Android Release APK (Signed)** | **`BLOCKED`** | `capacitor.config.ts`, `android/app/build.gradle` (ProGuard/R8 enabled, keystore signing block configured), hardened `scripts/android-build.mjs` (`--require-signed` refuses unsigned/debug distribution & auto-generates `.sha256`). | Current Windows build host has **no JDK, Android SDK, ADB, release keystore, or physical Android test device**. Do **NOT** distribute `app-debug.apk`. |
| **iOS Native / TestFlight** | **`BLOCKED`** | `ios/App/App/Info.plist`, `ios/App/ExportOptions.plist.template`, updated `public/.well-known/apple-app-site-association`. | Requires **macOS + Xcode + Apple Developer Program Team ID & signing certificates** to archive and upload to App Store Connect / TestFlight. |

---

## 2. Linking From All Three External Owner Websites

All three external websites should link directly to the **single canonical Download Centre** with distinct query parameters so Ping's `/admin` → **8. Growth** module records real, unfabricated attribution per site:

- Website 1: `https://<your-ping-domain>/download?ref=site1&site=<domain1>&utm_source=<domain1>&utm_medium=banner&utm_campaign=early_access`
- Website 2: `https://<your-ping-domain>/download?ref=site2&site=<domain2>&utm_source=<domain2>&utm_medium=banner&utm_campaign=early_access`
- Website 3: `https://<your-ping-domain>/download?ref=site3&site=<domain3>&utm_source=<domain3>&utm_medium=banner&utm_campaign=early_access`

**Important:** Never mirror APK binaries separately on external websites. Point every download CTA to `/download` so users always see the latest version, verified SHA-256 checksum, release notes, and safe PWA fallback.

---

## 3. Progressive Web App (PWA) Architecture & Privacy Rules

- **Manifest (`public/manifest.webmanifest`):** Configured as `display: "standalone"`, Obsidian background `#090B0A`, Forest theme `#173C32`, real PNG icons (`192x192`, `512x512`, `maskable 512x512`), app shortcuts (`Create`, `Explore`, `Inbox`, `Hubs`), and Web Share Target (`/share-target`).
- **Privacy-Hardened Service Worker (`public/sw.js`):**
  - Caches **ONLY** immutable static assets (`/assets/*`, `/icons/*`, `/brand/*`, `/manifest.webmanifest`, `/offline.html`).
  - Explicitly bypasses and **NEVER caches** `/rest/v1/`, `/auth/v1/`, `/realtime/`, `/storage/v1/object/sign/`, `/storage/v1/object/authenticated/`, `/api/`, `/_server`, `/admin`, `/messages`, `/settings`, `/wallet`, `/oauth/`, `/spotlight/editorial`, any non-GET request, any cross-origin request, or any request containing `Authorization` or `apikey` headers.
  - On user sign-out (`SIGNED_OUT` in `src/lib/auth.tsx`), `clearPwaCachesOnLogout()` sends `CLEAR_ALL_CACHES` to the active service worker and wipes `window.caches`.
- **Controlled Updates:** When a new service worker finishes installing, `PwaInstallAndUpdateBanner.tsx` presents a non-intrusive **Refresh Ping** button that sends `SKIP_WAITING` and reloads cleanly once activated.

---

## 4. Android Signed Release Procedure (Once JDK + Android SDK + Keystore Are Provisioned)

1. **Prerequisites:** Install JDK 17+, Android SDK (API 35 / Build Tools), and generate a dedicated release upload keystore (store securely outside Git — **never commit keystores or passwords**):
   ```bash
   keytool -genkeypair -v -keystore ping-release.jks -alias ping-release \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **Configure Signing Credentials** (git-ignored `android/keystore.properties` or environment variables `PING_KEYSTORE_PATH`, `PING_KEYSTORE_PASSWORD`, `PING_KEY_ALIAS`, `PING_KEY_PASSWORD`).
3. **Sync Web Assets & Build Signed APK (blocks accidental unsigned/debug output):**
   ```bash
   npm run android:sync
   node scripts/android-build.mjs release-apk --require-signed
   ```
4. **Verify Output & SHA-256 Checksum:**
   - Artifact: `android/app/build/outputs/apk/release/app-release.apk`
   - Automatic sidecar checksum: `android/app/build/outputs/apk/release/app-release.apk.sha256`
5. **Configure Android App Links:**
   - Extract signing certificate SHA-256 via `keytool -list -v -keystore ping-release.jks -alias ping-release`.
   - Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` in `public/.well-known/assetlinks.json`.
6. **Publish Release Metadata:**
   - Host the signed APK over HTTPS, then update `public/releases/early-access-manifest.json` (`android.status: "available"`, `android.downloadUrl`, and exact `android.sha256`).
7. **Versioning & Update Policy:** Increment `versionCode` (strictly monotonic integer) and `versionName` (`MAJOR.MINOR.PATCH-ea.N`) in `android/app/build.gradle` before every release build.

---

## 5. iOS Archive & TestFlight Procedure (Requires macOS + Xcode)

1. **Prerequisites:** macOS with Xcode 16+, active Apple Developer Program membership, App Store Connect record for bundle ID `app.lovable.pingbydot`.
2. **Sync Capacitor iOS Project:**
   ```bash
   npm run ios:sync
   ```
3. **Configure Signing & Universal Links:**
   - Copy `ios/App/ExportOptions.plist.template` → `ios/App/ExportOptions.plist` and replace `YOUR_APPLE_TEAM_ID` with your Apple Developer Team ID.
   - Replace `REPLACE_TEAM_ID` in `public/.well-known/apple-app-site-association`.
   - Inspect `ios/App/App/Info.plist` camera/photo/microphone usage strings and `pingbydot://` URL scheme.
4. **Archive & Upload to TestFlight:**
   - Open `ios/App/App.xcworkspace` in Xcode → **Product → Archive** → **Distribute App → TestFlight & App Store**.
   - Once Apple External Beta Review approves the build, generate the public TestFlight link and update `public/releases/early-access-manifest.json` (`ios.status: "available"`, `ios.testFlightUrl`).

---

## 6. Device Verification Checklist (Must Be Executed On Real Hardware Before General Availability)

- [ ] **Android Chrome PWA:** Install via `beforeinstallprompt`, confirm standalone icon, offline screen when Airplane Mode enabled, and cache wipe on sign-out (`NOT TESTED` — awaiting HTTPS deployment & device).
- [ ] **iPhone Safari PWA:** Install via Share → Add to Home Screen, verify `apple-touch-icon-180.png`, safe-area padding, keyboard resizing, and login persistence (`NOT TESTED` — awaiting HTTPS deployment & device).
- [ ] **Android Signed Release APK:** Install on Android 10–15 device, verify SHA-256, deep links (`pingbydot://` and HTTPS App Links), camera/media upload, and clean upgrade from previous `versionCode` (`BLOCKED` — awaiting signed build & device).
- [ ] **iOS TestFlight Build:** Install via TestFlight on physical iPhone, verify Universal Links, push opt-in, and full auth/messaging loop (`BLOCKED` — awaiting macOS/Xcode archive & Apple review).
