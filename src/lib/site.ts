// Public site origin. Override with VITE_SITE_ORIGIN when moving to a custom domain;
// existing /p/{id} and /@{username} paths stay the same, only the origin changes.
const DEFAULT_ORIGIN = "https://pingbydot.lovable.app";

function normalizeOrigin(value: string | undefined): string {
  if (!value) return DEFAULT_ORIGIN;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.origin : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

export const SITE_ORIGIN = normalizeOrigin(
  import.meta.env["VITE_SITE_ORIGIN"] as string | undefined,
);
export const SITE_NAME = "Ping by DOT";

export const siteUrl = (path = "/") => new URL(path, SITE_ORIGIN).href;

// PENDING OFFICIAL LOGO: set this to the absolute public URL of the approved
// Ping by DOT logo once the file is installed (e.g. `${SITE_ORIGIN}/brand/ping-logo.png`).
// Kept null so no broken or placeholder logo URL is ever published.
export const OFFICIAL_LOGO_URL: string | null = null;

export function siteJsonLd() {
  const organization: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${SITE_ORIGIN}/#organization`,
    name: SITE_NAME,
    url: siteUrl("/"),
  };
  if (OFFICIAL_LOGO_URL) organization["logo"] = OFFICIAL_LOGO_URL;
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        name: SITE_NAME,
        url: siteUrl("/"),
        description: "Build in public. Share your story.",
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
      },
    ],
  };
}

/** Per-page title/description/canonical/OG/X tags for an indexable public page. */
export function pageHead(o: {
  title: string;
  description: string;
  path: string;
  type?: string;
  card?: "summary" | "summary_large_image";
}) {
  const url = siteUrl(o.path);
  return {
    meta: [
      { title: o.title },
      { name: "description", content: o.description },
      { property: "og:title", content: o.title },
      { property: "og:description", content: o.description },
      { property: "og:type", content: o.type ?? "website" },
      { property: "og:url", content: url },
      { name: "twitter:card", content: o.card ?? "summary" },
      { name: "twitter:title", content: o.title },
      { name: "twitter:description", content: o.description },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export const NOINDEX = { name: "robots", content: "noindex, nofollow" } as const;
