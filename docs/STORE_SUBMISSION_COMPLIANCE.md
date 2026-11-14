# Ping by DOT — Mobile Store Submission & Compliance Guide

**Application**: Ping by DOT  
**Bundle ID / Package Name**: `app.lovable.pingbydot`  
**Web & Production URL**: https://pingbydot.lovable.app  
**Target Release**: Google Play Store & Apple App Store  
**Date**: November 12, 2026

---

## 1. App Store Connect (iOS) Compliance Data

### A. Metadata

- **App Name**: Ping by DOT
- **Subtitle**: Build in public. Connect in real time.
- **Primary Category**: Social Networking
- **Secondary Category**: Productivity
- **Privacy Policy URL**: `https://pingbydot.lovable.app/privacy`
- **Terms of Service & EULA URL**: `https://pingbydot.lovable.app/terms`
- **Support URL**: `https://pingbydot.lovable.app`
- **Support Email**: `support@pingbydot.app`

### B. Promotional Text & Descriptions

**Promotional Text**:

> Share a Moment in seconds. Broadcast official institutional Signals. Join Community Hubs. Chat directly with founders.

**Full Description**:

> Ping by DOT is the premier modern social network for founders, builders, universities, and institutions.
>
> • PINGS: Share ideas, launch milestones, and product progress with a clean public link anyone can open.
> • MOMENTS: Capture ephemeral 24-hour stories, record short-form video updates, react, and preserve key memories as permanent profile Highlights.
> • PRIVATE MESSAGING: Secure, high-speed one-to-one direct conversations with read receipts, presence indicators, and private media attachments.
> • HUBS: Dedicated community spaces for colleges, accelerators, and collectives with threaded discussions, shared feeds, and invite links.
> • SIGNALS: Verified institutional broadcast channels delivering official announcements with verified Champagne Gold badges.
> • DESIGN EXCELLENCE: High-contrast Dark Theme (Obsidian & Graphite with Electric Ping Green accents) and crisp Light Theme.

### C. Guideline 1.2 — User-Generated Content (UGC) Requirements

- **Terms of Use (EULA)**: Clearly displayed in-app at `/terms` stating zero tolerance for objectionable content or abusive users.
- **Reporting Mechanism**: Every Ping, Comment, Moment, Hub message, and Direct Message provides a &ldquo;Report&rdquo; option.
- **Blocking Mechanism**: Users can block any account instantly via Profile &gt; Block or Chat Header &gt; Block User. Blocked users cannot exchange direct messages or view profile content.
- **Moderation SLA**: In-app moderation team reviews flagged reports within 24 hours and terminates offending accounts.

### D. Guideline 5.1.1(v) — Account Deletion

- In-app account deletion is located at **Settings &gt; Danger Zone &gt; Delete Account**.
- Execution permanently purges the user profile, auth credentials, pings, comments, private message history, and uploaded media from production databases.

### E. App Review Information

- **Demo Reviewer Account**:
  - Email: `apple-reviewer@pingbydot.app`
  - Demo password: `PingReviewer2026!`
- **Review Notes**:
  > Ping by DOT provides social networking, community Hubs, institutional Signals, and private direct messaging. A demo reviewer account has been pre-configured with sample connections and joined Hubs. Camera and Photo permissions are requested only when capturing or attaching photos/videos to Pings, Moments, or Direct Messages.

---

## 2. Google Play Console (Android) Compliance Data

### A. Store Listing

- **App Title**: Ping by DOT
- **Short Description** (up to 80 chars):
  > Build in public, share Moments, join Hubs, and chat securely on Ping by DOT.
- **Target Audience & Content Rating**:
  - Target Age: 13+ (Teen)
  - Content Rating: IARC rating generated with Social Networking and user interaction flags.
- **Target SDK**: Android API 36 (Android 16)
- **Minimum SDK**: Android API 24 (Android 7.0)

### B. Data Safety Declarations

- **Data Collected**:
  - Personal Info: Name, Username, Email address, User IDs.
  - Photos & Videos: Uploaded voluntarily for Pings, Moments, and Direct Messages.
  - Messages: Direct messages exchanged between conversation participants.
- **Data Security Practices**:
  - Data encrypted in transit: **Yes (TLS 1.3 / HTTPS)**.
  - Data deletion mechanism provided: **Yes (In-App Account Deletion at `/settings`)**.
  - Account deletion request URL: `https://pingbydot.lovable.app/settings`.

---

## 3. Native Build & Release Commands

### Android Release Build (Android App Bundle - `.aab`)

```bash
# 1. Build web production bundle and sync Capacitor Android assets
npm run build
npx cap sync android

# 2. Build release bundle using Gradle
cd android
./gradlew bundleRelease
```

- **Output Artifact**: `android/app/build/outputs/bundle/release/app-release.aab`
- **Signing**: Configure keystore in `android/keystore.properties` or sign via Google Play App Signing.

### iOS Release Build (Xcode Archive)

```bash
# 1. Sync Capacitor iOS project
npm run build
npx cap sync ios

# 2. Open in Xcode to archive and upload to TestFlight / App Store Connect
npx cap open ios
```

- **Bundle Identifier**: `app.lovable.pingbydot`
- **Target**: iOS 16.0+ / iOS 26 SDK compatible.
