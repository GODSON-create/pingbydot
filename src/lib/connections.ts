export const PLATFORMS = ["whatsapp", "snapchat", "instagram", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  whatsapp: "WhatsApp",
  snapchat: "Snapchat",
  instagram: "Instagram",
  x: "X",
};

export type Connection = {
  platform: Platform;
  handle: string;
  is_public: boolean;
  is_primary: boolean;
};

type Result = { ok: true; handle: string } | { ok: false; error: string };

const PATTERN: Record<Platform, RegExp> = {
  whatsapp: /^[1-9][0-9]{7,14}$/,
  snapchat: /^[a-z][a-z0-9._-]{1,13}[a-z0-9]$/,
  instagram: /^[a-z0-9._]{1,30}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
};

const HOSTS: Record<Exclude<Platform, "whatsapp">, string[]> = {
  snapchat: ["snapchat.com", "www.snapchat.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
};

const RESERVED_X = new Set([
  "home",
  "intent",
  "i",
  "share",
  "settings",
  "messages",
  "explore",
  "search",
]);
const RESERVED_IG = new Set(["p", "reel", "reels", "explore", "accounts", "stories", "direct"]);

const ERRORS: Record<Platform, string> = {
  whatsapp: "Use your full international number with country code, e.g. +44 7700 900123",
  snapchat: "Use your Snapchat username (3–15 letters, numbers, . _ -) or snapchat.com/add link",
  instagram: "Use your Instagram username or instagram.com profile link",
  x: "Use your X username (up to 15 letters, numbers, _) or x.com profile link",
};

/** Normalize user input into a stored handle. URLs only accepted for the platform's own https host. */
export function normalizeConnection(platform: Platform, raw: string): Result {
  const input = raw.trim();
  const fail = { ok: false as const, error: ERRORS[platform] };
  if (!input || input.length > 200) return fail;

  if (platform === "whatsapp") {
    let s = input;
    const wa = s.match(
      /^https:\/\/(?:wa\.me|api\.whatsapp\.com)\/(?:send\?phone=)?\+?([0-9]+)\/?$/i,
    );
    if (wa?.[1]) s = wa[1];
    else if (/[a-z]:/i.test(s) || /[^0-9+\s().-]/.test(s)) return fail;
    if (!s.startsWith("+") && !wa && !s.startsWith("00")) return fail; // must be international
    const digits = s.replace(/^00/, "").replace(/[^0-9]/g, "");
    return PATTERN.whatsapp.test(digits) ? { ok: true, handle: digits } : fail;
  }

  let handle = input;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.includes("/")) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
    } catch {
      return fail;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return fail;
    if (!HOSTS[platform].includes(url.hostname.toLowerCase())) return fail;
    if (url.username || url.password || url.port) return fail;
    const parts = url.pathname.split("/").filter(Boolean);
    if (platform === "snapchat") {
      if (parts[0] !== "add" || parts.length !== 2) return fail;
      handle = parts[1] ?? "";
    } else {
      if (parts.length !== 1) return fail;
      handle = parts[0] ?? "";
    }
  }
  handle = handle.replace(/^@/, "");
  if (platform !== "x") handle = handle.toLowerCase();
  if (!PATTERN[platform].test(handle)) return fail;
  if (platform === "x" && RESERVED_X.has(handle.toLowerCase())) return fail;
  if (platform === "instagram" && RESERVED_IG.has(handle)) return fail;
  return { ok: true, handle };
}

/** Build the only URL we ever link to, from a validated stored handle. */
export function connectionUrl(platform: Platform, handle: string): string | null {
  if (!PLATFORMS.includes(platform)) return null;
  if (!PATTERN[platform].test(handle)) return null;
  if (platform === "x" && RESERVED_X.has(handle.toLowerCase())) return null;
  if (platform === "instagram" && RESERVED_IG.has(handle)) return null;
  const h = encodeURIComponent(handle);
  switch (platform) {
    case "whatsapp":
      return `https://wa.me/${h}`;
    case "snapchat":
      return `https://www.snapchat.com/add/${h}`;
    case "instagram":
      return `https://www.instagram.com/${h}/`;
    case "x":
      return `https://x.com/${h}`;
  }
}

export function connectionDisplay(platform: Platform, handle: string) {
  return platform === "whatsapp" ? `+${handle}` : `@${handle}`;
}

/** Only public rows, in fixed platform order, primary first. Defence in depth on top of database rules. */
export function publicConnections<T extends Connection>(rows: T[]): T[] {
  return rows
    .filter(
      (r) => r.is_public && PLATFORMS.includes(r.platform) && connectionUrl(r.platform, r.handle),
    )
    .sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform),
    );
}
