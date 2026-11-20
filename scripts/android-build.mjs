#!/usr/bin/env node
/**
 * Cross-platform Android Gradle build runner for Ping by DOT.
 *
 * Security & Distribution Guarantees:
 * - Resolves local Android SDK automatically without exposing signing credentials.
 * - Strictly refuses to distribute unsigned or debug builds when `--require-signed`
 *   is passed (or when building public release artifacts with `PING_REQUIRE_SIGNED=1`).
 * - Computes and writes a verified `.sha256` checksum sidecar file automatically for
 *   every signed release APK/AAB produced.
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const ANDROID_DIR = path.resolve(ROOT, "android");
const LOCAL_PROPERTIES = path.join(ANDROID_DIR, "local.properties");
const KEYSTORE_PROPS = path.join(ANDROID_DIR, "keystore.properties");

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--")) || "debug";
const requireSigned =
  args.includes("--require-signed") || process.env.PING_REQUIRE_SIGNED === "1";

const TASKS = {
  debug: {
    task: ":app:assembleDebug",
    output: path.join(ANDROID_DIR, "app/build/outputs/apk/debug/app-debug.apk"),
  },
  "release-apk": {
    task: ":app:assembleRelease",
    output: path.join(ANDROID_DIR, "app/build/outputs/apk/release/app-release.apk"),
  },
  "release-aab": {
    task: ":app:bundleRelease",
    output: path.join(ANDROID_DIR, "app/build/outputs/bundle/release/app-release.aab"),
  },
};

const spec = TASKS[mode];
if (!spec) {
  console.error(
    `Unknown mode "${mode}". Use: debug | release-apk | release-aab [--require-signed]`,
  );
  process.exit(1);
}

if (mode === "debug" && requireSigned) {
  console.error(
    "BLOCKED: Debug APKs must NEVER be distributed publicly. Use 'release-apk --require-signed' with a valid release keystore.",
  );
  process.exit(2);
}

function hasSigningConfig() {
  if (fs.existsSync(KEYSTORE_PROPS)) return true;
  return Boolean(
    process.env.PING_KEYSTORE_PATH &&
      process.env.PING_KEYSTORE_PASSWORD &&
      process.env.PING_KEY_ALIAS &&
      process.env.PING_KEY_PASSWORD,
  );
}

if (mode !== "debug" && !hasSigningConfig()) {
  const msg =
    "Release signing keystore not configured (missing android/keystore.properties and PING_KEYSTORE_* env vars).";
  if (requireSigned) {
    console.error(`BLOCKED: ${msg} Refusing to build an unsigned public release artifact.`);
    process.exit(2);
  }
  console.warn(`NOTICE: ${msg} Release output will remain unsigned and MUST NOT be distributed.`);
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
    "BLOCKED: Android SDK not found. Install JDK 17+ and Android SDK, then set ANDROID_HOME or ANDROID_SDK_ROOT.",
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

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
execSync(`${gradlew} ${spec.task} --no-daemon`, {
  cwd: ANDROID_DIR,
  stdio: "inherit",
  env: {
    ...process.env,
    ANDROID_HOME: sdkDir,
    ANDROID_SDK_ROOT: sdkDir,
  },
});

if (mode !== "debug" && fs.existsSync(spec.output)) {
  const fileBuffer = fs.readFileSync(spec.output);
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const checksumPath = `${spec.output}.sha256`;
  fs.writeFileSync(checksumPath, `${sha256}  ${path.basename(spec.output)}\n`, "utf8");
  console.log(`SHA-256 checksum generated: ${checksumPath}`);
  console.log(`SHA-256: ${sha256}`);
}
