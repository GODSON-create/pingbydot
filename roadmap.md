# Launch repair
- [ ] Admin first: locked roles, manual owner bootstrap, verified admin dashboard, moderation audit and paginated management.
- [ ] Produce owner/admin/non-admin QA report with verified checks and explicit blockers.
- [x] Official logo preparation: inspect assets, connect reusable navigation/artwork slots with text fallback, verify sharing without publishing.
- [ ] Official logo placement and logo-derived favicon: blocked until the user supplies authentic PNG/SVG artwork; actual logo aspect ratio and light/dark contrast require that asset.
- [x] Sharing follow-up QA: validate PNG exports, SSR metadata, public URLs, mobile fallbacks and cache responses; fix scoped bugs without publishing.
- [x] Rich sharing: branded card preview, PNG export, native/file/link sharing and public per-Ping social images.
- [x] Verify rich sharing cases and document deployment limitations without publishing.
- [ ] Restore Data API permissions without changing owner-only write policies.
- [ ] Repair Explore, Ping details, public share rendering and error handling.
- [ ] Repair signup/login and verify authenticated publishing.
- [ ] Run tests, browser checks, schema/security checks and report unverified launch risks.
# Ping V2 (queued — paused until the user resumes the queue)
- [x] Day 1: SEO metadata, JSON-LD, sitemap.xml, robots.txt, logo integration points (official logo still pending).
- [ ] Official logo install: blocked until the approved PNG/SVG is uploaded.
- [ ] Ping Connections (paused): WhatsApp, Snapchat, Instagram, X on profiles at the same time. Settings section to add/edit/remove each one, with its own public on/off switch and an optional primary contact (the other three stay visible). WhatsApp uses a validated international number opening wa.me, with an optional safely encoded message; the number is shown only if WhatsApp is set to public. Snapchat links to the add-friend page; Instagram/X link to the profile pages, with no promise of opening a direct message. Normalize every link and block unsafe ones (such as javascript: links). Use brand icons with accessible labels, plus a note that tapping a link may open the other app. No messaging inside Ping or in-app web views. Count clicks in aggregate only if a privacy notice covers it. Tests for validation, visibility and link destinations.
