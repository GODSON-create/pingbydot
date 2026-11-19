#!/usr/bin/env node
/**
 * Cross-platform Android Gradle build runner for Ping by DOT.
 * Resolves the local Android SDK automatically, ensures Capacitor web assets are synced,
 * and invokes Gradle tasks without exposing signing credentials.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const ANDROID_DIR = path.resolve(ROOT, "android");
const LOCAL_PROPERTIES = path.join(ANDROID_DIR, "local.properties");
const KEYSTORE_PROPS = path.join(ANDROID_DIR, "keystore.properties");

const mode = process.argv[2] || "debug";
const TASKS = {
  debug: ":app:assembleDebug",
  "release-apk": ":app:assembleRelease",
  "release-aab": ":app:bundleRelease",
};

const gradleTask = TASKS[mode];
if (!gradleTask) {
  console.error(`Unknown mode "${mode}". Use: debug | release-apk | release-aab`);
  process.exit(1);
}

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
    path.join(os.homedir(), "Library", "Android", "sdk"),
    path.join(os.homedir(), "Android", "Sdk"),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

const sdkDir = resolveAndroidSdk();
if (!sdkDir) {
  console.error(
    "BLOCKED: Android SDK not found. Install Android SDK and set ANDROID_HOME or ANDROID_SDK_ROOT.",
  );
  process.exit(2);
}

const normalizedSdk = sdkDir.replace(/\\/g, "/");
fs.writeFileSync(
  LOCAL_PROPERTIES,
  `## Auto-generated local Android SDK pointer (git-ignored)\nsdk.dir=${normalizedSdk}\n`,
);

if (!fs.existsSync(path.resolve(ROOT, ".output/mobile/index.html"))) {
  console.log("Mobile web bundle missing; building and syncing Android assets first...");
  execSync("npm run android:sync", { cwd: ROOT, stdio: "inherit" });
}

if (mode !== "debug") {
  const hasProps = fs.existsSync(KEYSTORE_PROPS);
  const hasEnv = Boolean(
    process.env.PING_KEYSTORE_PATH &&
      process.env.PING_KEYSTORE_PASSWORD &&
      process.env.PING_KEY_ALIAS &&
      process.env.PING_KEY_PASSWORD,
  );
  if (!hasProps && !hasEnv) {
    console.warn(
      "NOTICE: No release keystore configured (android/keystore.properties or PING_KEYSTORE_* env vars). Release output will be unsigned until a signing key is supplied.",
    );
  }
}

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
execSync(`${gradlew} ${gradleTask} --no-daemon`, {
  cwd: ANDROID_DIR,
  stdio: "inherit",
  env: {
    ...process.env,
    ANDROID_HOME: sdkDir,
    ANDROID_SDK_ROOT: sdkDir,
  },
});
