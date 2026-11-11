// scripts/wcag-audit.cjs
function oklchToRgb(l, c, h) {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  let r = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  let g = -1.2684380046 * L + 2.6097574011 * M - 0.3413183965 * S;
  let bl = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;

  const toGamma = (v) => {
    v = Math.max(0, Math.min(1, v));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  };

  const toLinear = (v) => {
    v = Math.max(0, Math.min(1, v));
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  const R = toGamma(r);
  const G = toGamma(g);
  const B = toGamma(bl);

  // Relative luminance Y according to WCAG 2.1
  const Y = 0.2126 * toLinear(R) + 0.7152 * toLinear(G) + 0.0722 * toLinear(B);

  const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
  const hex = `#${toHex(R)}${toHex(G)}${toHex(B)}`;

  return { Y, hex, R, G, B };
}

function contrast(y1, y2) {
  const [bright, dark] = y1 > y2 ? [y1, y2] : [y2, y1];
  return (bright + 0.05) / (dark + 0.05);
}

// Light Mode Palette
const lightPalette = {
  background: [0.988, 0.016, 84],
  card: [0.997, 0.006, 84],
  secondary: [0.955, 0.022, 84],
  muted: [0.955, 0.02, 84],
  foreground: [0.19, 0.018, 165],
  secondary_fg: [0.25, 0.045, 167],
  muted_fg: [0.47, 0.022, 160],
  primary: [0.33, 0.055, 167],
  primary_fg: [0.985, 0.015, 90],
  lime: [0.91, 0.17, 125],
  lime_fg: [0.24, 0.045, 167],
  blush: [0.89, 0.06, 12],
  blush_fg: [0.36, 0.09, 12],
  sun: [0.88, 0.11, 80],
  destructive: [0.56, 0.2, 27],
  destructive_fg: [0.985, 0.01, 90],
};

// Refined Dark Mode Palette
const darkPalette = {
  background: [0.12, 0.012, 150],
  card: [0.175, 0.014, 150],
  secondary: [0.23, 0.016, 150],
  muted: [0.21, 0.015, 150],
  popover: [0.20, 0.016, 150],
  input_well: [0.145, 0.012, 150],
  
  border: [0.36, 0.02, 150],
  input_border: [0.49, 0.025, 150],
  control_border: [0.49, 0.025, 150],

  foreground: [0.965, 0.006, 100],
  secondary_fg: [0.90, 0.01, 150],
  muted_fg: [0.76, 0.015, 150],
  disabled_fg: [0.52, 0.015, 150],

  primary: [0.82, 0.19, 142],
  primary_fg: [0.12, 0.03, 150],

  lime: [0.85, 0.18, 125],
  lime_fg: [0.12, 0.03, 150],

  accent_bg: [0.24, 0.035, 150],
  accent_fg: [0.88, 0.12, 142],

  blush_bg: [0.28, 0.05, 18],
  blush_fg: [0.92, 0.05, 18],

  sun_bg: [0.30, 0.07, 75],
  sun_fg: [0.94, 0.08, 75],

  destructive: [0.55, 0.22, 27],
  destructive_fg: [0.985, 0.01, 90],
};

function runAudit(name, pal, pairs) {
  console.log(`\n=================== ${name} AUDIT ===================`);
  const data = {};
  for (const [k, [l, c, h]] of Object.entries(pal)) {
    data[k] = oklchToRgb(l, c, h);
  }

  let allOk = true;
  for (const [fg, bg, note] of pairs) {
    const fgKey = fg.split(" ")[0];
    const cr = contrast(data[fgKey].Y, data[bg].Y);
    const target = note.includes("3.0") ? 3.0 : 4.5;
    const passed = cr >= target;
    if (!passed) allOk = false;
    const badge = cr >= 7.0 ? "AAA" : cr >= 4.5 ? "AA" : cr >= 3.0 ? "AA-lg" : "FAIL";
    console.log(`${fg.padEnd(30)} on ${bg.padEnd(12)} -> ${cr.toFixed(2)}:1 [${badge}] (${note})`);
  }
  console.log(`\n${name} All Criteria Met:`, allOk);
  return allOk;
}

const darkPairs = [
  ["foreground (normal text)", "card", "Target >= 4.5:1"],
  ["foreground (normal text)", "background", "Target >= 4.5:1"],
  ["secondary_fg (secondary)", "card", "Target >= 4.5:1"],
  ["secondary_fg (secondary)", "secondary", "Target >= 4.5:1"],
  ["muted_fg (timestamps/labels)", "card", "Target >= 4.5:1"],
  ["muted_fg (timestamps/labels)", "background", "Target >= 4.5:1"],
  ["muted_fg (timestamps/labels)", "secondary", "Target >= 4.5:1"],
  ["muted_fg (timestamps/labels)", "input_well", "Target >= 4.5:1"],
  ["foreground (typed text)", "input_well", "Target >= 4.5:1"],
  ["primary_fg", "primary", "Target >= 4.5:1"],
  ["lime_fg", "lime", "Target >= 4.5:1"],
  ["accent_fg", "accent_bg", "Target >= 4.5:1"],
  ["blush_fg", "blush_bg", "Target >= 4.5:1"],
  ["sun_fg", "sun_bg", "Target >= 4.5:1"],
  ["foreground (on sun chip)", "sun_bg", "Target >= 4.5:1"],
  ["destructive_fg", "destructive", "Target >= 4.5:1"],
  ["input_border", "input_well", "Target >= 3.0:1 (UI component)"],
  ["control_border", "card", "Target >= 3.0:1 (UI component)"],
  ["primary", "background", "Target >= 3.0:1 (active accent)"],
  ["primary", "card", "Target >= 3.0:1 (active accent)"],
];

const lightPairs = [
  ["foreground", "card", "Target >= 4.5:1"],
  ["foreground", "background", "Target >= 4.5:1"],
  ["secondary_fg", "card", "Target >= 4.5:1"],
  ["muted_fg", "card", "Target >= 4.5:1"],
  ["primary_fg", "primary", "Target >= 4.5:1"],
  ["lime_fg", "lime", "Target >= 4.5:1"],
  ["blush_fg", "blush", "Target >= 4.5:1"],
  ["foreground", "sun", "Target >= 4.5:1"],
  ["destructive_fg", "destructive", "Target >= 4.5:1"],
];

const darkOk = runAudit("DARK THEME", darkPalette, darkPairs);
const lightOk = runAudit("LIGHT THEME", lightPalette, lightPairs);
console.log("\n>>> OVERALL SYSTEM AUDIT:", darkOk && lightOk ? "PASSED" : "FAILED");
