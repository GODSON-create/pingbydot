#!/usr/bin/env node
/**
 * Builds an offline-capable SPA web bundle in `.output/mobile` for Capacitor
 * Android and iOS without altering the standard Nitro SSR production build.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STAGING_DIR = path.resolve(ROOT, ".output-mobile");
const TARGET_DIR = path.resolve(ROOT, ".output/mobile");

fs.rmSync(STAGING_DIR, { recursive: true, force: true });
fs.rmSync(TARGET_DIR, { recursive: true, force: true });

execSync("npx vite build", {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    PING_MOBILE_BUILD: "1",
  },
});

const publicSrc = path.join(STAGING_DIR, "public");
if (!fs.existsSync(publicSrc)) {
  throw new Error(`Expected mobile build public assets at ${publicSrc}`);
}

fs.mkdirSync(path.dirname(TARGET_DIR), { recursive: true });
fs.cpSync(publicSrc, TARGET_DIR, { recursive: true });

const shellCandidate = ["_shell.html", "_spa.html", "200.html", "index.html"].find((name) =>
  fs.existsSync(path.join(TARGET_DIR, name)),
);

if (!shellCandidate) {
  const listed = fs.readdirSync(TARGET_DIR);
  throw new Error(
    `Expected TanStack Start SPA HTML shell in ${TARGET_DIR}; found: ${listed.join(", ")}`,
  );
}

if (shellCandidate !== "index.html") {
  fs.copyFileSync(path.join(TARGET_DIR, shellCandidate), path.join(TARGET_DIR, "index.html"));
}

fs.rmSync(STAGING_DIR, { recursive: true, force: true });
console.log(`Prepared offline-capable Capacitor web bundle at ${TARGET_DIR} (from ${shellCandidate}).`);
