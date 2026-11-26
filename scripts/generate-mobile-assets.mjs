#!/usr/bin/env node
/**
 * Generates official Ping by DOT mobile app icons and splash screens for
 * Android (`android/app/src/main/res`) and iOS (`ios/App/App/Assets.xcassets`)
 * from Ping's official brand vector mark (`public/brand/ping-icon.svg`).
 */
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@cf-wasm/resvg";

const ROOT = process.cwd();
const SVG_PATH = path.resolve(ROOT, "public/brand/ping-icon.svg");
const ANDROID_RES = path.resolve(ROOT, "android/app/src/main/res");
const IOS_ASSETS = path.resolve(ROOT, "ios/App/App/Assets.xcassets");
const OBSIDIAN_BG = "#090B0A";

async function renderSvgPng(svg, width, height) {
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: "width", value: width },
  });
  const rendered = resvg.render();
  if (rendered.width !== width || rendered.height !== height) {
    throw new Error(`Expected ${width}x${height}, got ${rendered.width}x${rendered.height}`);
  }
  return rendered.asPng();
}

function extractInnerLogoBody(svgSource) {
  // Keep defs + mark elements inside viewBox 0..120 without the outer rounded rect card when needed
  const defsMatch = svgSource.match(/<defs>[\s\S]*?<\/defs>/);
  const defs = defsMatch ? defsMatch[0] : "";
  const pathsMatch = svgSource.match(/<\/defs>([\s\S]*?)<\/svg>/);
  const inner = pathsMatch ? pathsMatch[1] : "";
  const markOnly = inner.replace(/<rect[^>]*width="112"[^>]*\/>/, "").trim();
  return { defs, inner: inner.trim(), markOnly };
}

function buildSquareIconSvg({ defs, markOnly, paddingRatio = 0.22, circular = false }) {
  const size = 1024;
  const contentBox = size * (1 - paddingRatio * 2);
  const scale = contentBox / 120;
  const offset = size * paddingRatio;

  const clipDef = circular
    ? `<clipPath id="roundClip"><circle cx="512" cy="512" r="512"/></clipPath>`
    : "";
  const groupOpen = circular ? `<g clip-path="url(#roundClip)">` : `<g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${defs.replace("</defs>", `${clipDef}</defs>`)}
  ${groupOpen}
    <rect x="0" y="0" width="${size}" height="${size}" fill="${OBSIDIAN_BG}"/>
    <g transform="translate(${offset}, ${offset}) scale(${scale})">
      ${markOnly}
    </g>
  </g>
</svg>`;
}

function buildForegroundSvg({ defs, markOnly }) {
  // Android adaptive icons keep main artwork comfortably inside the center 66% safe zone
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${defs}
  <g transform="translate(232, 232) scale(4.666667)">
    ${markOnly}
  </g>
</svg>`;
}

function buildSplashSvg({ defs, markOnly }, width, height) {
  const minSide = Math.min(width, height);
  const markPx = Math.round(minSide * 0.24);
  const scale = markPx / 120;
  const tx = (width - markPx) / 2;
  const ty = (height - markPx) / 2 - Math.round(minSide * 0.04);
  const barW = Math.round(minSide * 0.16);
  const barH = Math.max(4, Math.round(minSide * 0.008));
  const barX = (width - barW) / 2;
  const barY = ty + markPx + Math.round(minSide * 0.08);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${defs}
  <rect x="0" y="0" width="${width}" height="${height}" fill="${OBSIDIAN_BG}"/>
  <circle cx="${width / 2}" cy="${height / 2}" r="${Math.round(minSide * 0.45)}" fill="#c7f36b" fill-opacity="0.06"/>
  <g transform="translate(${tx}, ${ty}) scale(${scale})">
    ${markOnly}
  </g>
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#c7f36b" fill-opacity="0.72"/>
</svg>`;
}

function writeFileEnsure(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const rawSvg = fs.readFileSync(SVG_PATH, "utf8");
const parts = extractInnerLogoBody(rawSvg);

const squareIconSvg = buildSquareIconSvg({ ...parts, paddingRatio: 0.16, circular: false });
const roundIconSvg = buildSquareIconSvg({ ...parts, paddingRatio: 0.18, circular: true });
const foregroundSvg = buildForegroundSvg(parts);

const ANDROID_DENSITIES = [
  { name: "mdpi", launcher: 48, adaptive: 108, port: [320, 480], land: [480, 320] },
  { name: "hdpi", launcher: 72, adaptive: 162, port: [480, 800], land: [800, 480] },
  { name: "xhdpi", launcher: 96, adaptive: 216, port: [720, 1280], land: [1280, 720] },
  { name: "xxhdpi", launcher: 144, adaptive: 324, port: [1080, 1920], land: [1920, 1080] },
  { name: "xxxhdpi", launcher: 192, adaptive: 432, port: [1440, 2560], land: [2560, 1440] },
];

for (const d of ANDROID_DENSITIES) {
  const mipmapDir = path.join(ANDROID_RES, `mipmap-${d.name}`);
  writeFileEnsure(
    path.join(mipmapDir, "ic_launcher.png"),
    await renderSvgPng(squareIconSvg, d.launcher, d.launcher),
  );
  writeFileEnsure(
    path.join(mipmapDir, "ic_launcher_round.png"),
    await renderSvgPng(roundIconSvg, d.launcher, d.launcher),
  );
  writeFileEnsure(
    path.join(mipmapDir, "ic_launcher_foreground.png"),
    await renderSvgPng(foregroundSvg, d.adaptive, d.adaptive),
  );

  const portSplashSvg = buildSplashSvg(parts, d.port[0], d.port[1]);
  writeFileEnsure(
    path.join(ANDROID_RES, `drawable-port-${d.name}`, "splash.png"),
    await renderSvgPng(portSplashSvg, d.port[0], d.port[1]),
  );

  const landSplashSvg = buildSplashSvg(parts, d.land[0], d.land[1]);
  writeFileEnsure(
    path.join(ANDROID_RES, `drawable-land-${d.name}`, "splash.png"),
    await renderSvgPng(landSplashSvg, d.land[0], d.land[1]),
  );
}

// Default Android splash drawable
writeFileEnsure(
  path.join(ANDROID_RES, "drawable", "splash.png"),
  await renderSvgPng(buildSplashSvg(parts, 1080, 1920), 1080, 1920),
);

// Update adaptive launcher background color to Obsidian #090B0A
writeFileEnsure(
  path.join(ANDROID_RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${OBSIDIAN_BG}</color>\n</resources>\n`,
);

// iOS Universal 1024x1024 opaque AppIcon + 2732x2732 Splash imageset
const iosAppIcon = await renderSvgPng(
  buildSquareIconSvg({ ...parts, paddingRatio: 0.14, circular: false }),
  1024,
  1024,
);
writeFileEnsure(path.join(IOS_ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"), iosAppIcon);

const iosSplash2732 = await renderSvgPng(buildSplashSvg(parts, 2732, 2732), 2732, 2732);
for (const filename of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  writeFileEnsure(path.join(IOS_ASSETS, "Splash.imageset", filename), iosSplash2732);
}

console.log("Generated official Ping by DOT Android & iOS icons and splash screens cleanly.");
