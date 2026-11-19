# Ping by DOT — Mobile Application & Pre-Store Distribution Guide

This document describes building, signing, versioning, testing, and distributing the **Ping by DOT** native mobile applications built on **Capacitor 8** (`app.lovable.pingbydot`).

---

## 1. Native Identity & Preserved Identifiers

| Platform | Field | Value |
| --- | --- | --- |
| Both | App Name | `Ping by DOT` |
| Both | Package / Bundle ID | `app.lovable.pingbydot` |
| Both | Custom URL Scheme | `pingbydot://` |
| Both | Verified Web Host (App / Universal Links) | `https://pingbydot.lovable.app` |
| Android | `minSdkVersion` / `targetSdkVersion` | `24` (Android 7.0) / `36` |
| iOS | `IPHONEOS_DEPLOYMENT_TARGET` / Families | `15.0` / `1,2` (iPhone & iPad) |

---

## 2. Generating Brand Assets & Preparing Mobile Bundle

1. Regenerate all Android & iOS launcher icons and Obsidian `#090B0A` splash screens from [public/brand/ping-icon.svg](../public/brand/ping-icon.svg):
   ```bash
   npm run mobile:assets
   ```
2. Build the offline-capable Capacitor SPA bundle (`.output/mobile`) and sync all native plugins (`app`, `browser`, `camera`, `keyboard`, `network`, `push-notifications`, `share`, `splash-screen`, `status-bar`):
   ```bash
   npm run cap:sync
   ```
   *(Optional live-reload dev override only: set `CAPACITOR_SERVER_URL=http://<LAN_IP>:4175` when running `npx cap sync`; leave unset for self-contained bundled releases.)*

---

## 3. Versioning & Release Numbering

- **Android (`android/app/build.gradle`)**: Reads `PING_VERSION_CODE` (default `1`, strictly monotonic integer required for every Google Play upload) and `PING_VERSION_NAME` (default `1.0.0`) from Gradle properties (`-PPING_VERSION_CODE=2`) or environment variables.
- **iOS (`ios/App/App.xcodeproj/project.pbxproj`)**: Uses `MARKETING_VERSION` (`1.0.0`) and `CURRENT_PROJECT_VERSION` (`1`). Increment `CURRENT_PROJECT_VERSION` for every TestFlight build.

---

## 4. Android Pre-Store Distribution (Debug APK, Signed Release APK & Play Store AAB)

### Build Artifacts
- **Internal Testing Debug APK**:
  ```bash
  npm run android:assemble:debug
  # Output: android/app/build/outputs/apk/debug/app-debug.apk
  ```
- **Signed External Distribution APK**:
  ```bash
  npm run android:assemble:release
  # Output: android/app/build/outputs/apk/release/app-release.apk
  ```
- **Google Play Store App Bundle (AAB)**:
  ```bash
  npm run android:bundle:release
  # Output: android/app/build/outputs/bundle/release/app-release.aab
  ```

### Release Signing Security
Never commit keystores (`.jks`, `.keystore`) or `android/keystore.properties` to Git (all are excluded in `.gitignore` and `android/.gitignore`). Back up your upload key securely (Play App Signing upload key cannot be replaced without Play Console support).

Provide signing credentials in **either**:
1. Local git-ignored `android/keystore.properties`:
   ```properties
   storeFile=C:/secure/keys/ping-upload.jks
   storePassword=<YOUR_STORE_PASSWORD>
   keyAlias=ping-upload
   keyPassword=<YOUR_KEY_PASSWORD>
   ```
2. Or CI environment variables: `PING_KEYSTORE_PATH`, `PING_KEYSTORE_PASSWORD`, `PING_KEY_ALIAS`, `PING_KEY_PASSWORD`.

*Optional Release Firebase Push*: Place `google-services.json` (matching package `app.lovable.pingbydot`) into `android/app/google-services.json` (also git-ignored) before assembling release builds.

---

## 5. iOS Pre-Store Distribution (TestFlight & App Store Connect)

> Requires **macOS + Xcode**, an active **Apple Developer Program** membership, and App Store Connect access.

1. Sync web bundle & iOS Swift Package plugins on macOS:
   ```bash
   npm run ios:sync
   open ios/App/App.xcodeproj
   ```
2. In Xcode -> **App target -> Signing & Capabilities**:
   - Select your Apple Developer **Team** (`DEVELOPMENT_TEAM`) with `app.lovable.pingbydot`.
   - Confirm **Push Notifications** (`aps-environment`) and **Associated Domains** (`applinks:pingbydot.lovable.app`) from [App.entitlements](../ios/App/App/App.entitlements).
   - *(If using Firebase/APNs)* configure Push key (`.p8`) in Apple Developer Portal and attach `GoogleService-Info.plist` (git-ignored) if using FCM.
3. Update [ios/App/ExportOptions.plist.template](../ios/App/ExportOptions.plist.template) to a local git-ignored `ExportOptions.plist` with your `teamID`, then archive and export:
   ```bash
   xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' archive -archivePath build/PingByDOT.xcarchive
   xcodebuild -exportArchive -archivePath build/PingByDOT.xcarchive -exportOptionsPlist ios/App/ExportOptions.plist -exportPath build/ios-export
   ```
4. Upload to TestFlight via **Xcode Organizer** or `xcrun altool` / App Store Connect API key (`AuthKey_<KEY_ID>.p8`, never committed).

---

## 6. External Backend & Store Prerequisites Checklist

1. **Supabase Auth Redirect Allowlist**: Add **`pingbydot://login`** and **`pingbydot://login*`** alongside `https://pingbydot.lovable.app/login` in Supabase **Authentication -> URL Configuration -> Redirect URLs**.
2. **Supabase Google OAuth Provider**: Configure Google Web Client ID + Client Secret in Supabase Auth so `@capacitor/browser` (`Chrome Custom Tabs` / `ASWebAuthenticationSession`) completes Google login and returns cleanly via `pingbydot://login?code=...`.
3. **App Links / Universal Links Domain Verification**: Host `/.well-known/assetlinks.json` (Android SHA-256 Play App Signing + upload key fingerprints) and `/.well-known/apple-app-site-association` on `https://pingbydot.lovable.app`.
4. **Push Delivery Credentials**: Add Firebase `google-services.json` (`app.lovable.pingbydot`) for Android and APNs `.p8` key / Apple Developer certificate for iOS.
