# Pingbydot

Build Ping as a polished, responsive, full-stack web app in this new project. This is a new standalone project in the Ping's Lovable workspace. Do not modify any other project. Treat this as a real product, not a static landing-page mockup.

PRODUCT
Ping is a friendly, playful, polished social platform for people to build in public and share their stories. Users publish unlimited items called “Pings” (never call them posts in product UI) about ventures, ideas, launches, milestones, questions, opportunities, and progress. Every Ping has a stable public share URL. Anyone can read a public Ping without signing up; verified users can like, create Pings, and use account-based actions. Each founder profile has a public URL and lists their Pings. The product should encourage human connection and public sharing.

BRAND / VISUAL DIRECTION
Tagline: “Build in public. Share your story.”
Personality: warm, human, expressive, playful but credible; polished founder network with playful touches, not a corporate dashboard and not childish. Do not copy a template's palette/layout. Explore a coherent initial palette of deep forest green (#173C32), electric lime (#C7F36B), warm paper (#FFF9EF), near-black text, and restrained soft pink/warm accent moments. Use these as a starting system, not as a reason to paint every element bright green.
Use expressive, confident display typography paired with very readable body/UI typography; generous whitespace; rounded cards; nuanced borders; strong hierarchy; occasional playful labels/stickers; overlapping/floating content cards used sparingly and purposefully. Prioritize excellent mobile design as well as desktop.
IMPORTANT MOTION AND FINISH: The site must feel crafted and alive, not “backcoded”, generic, or like a bare template. Add tasteful continuous motion where it improves the experience: soft ambient background movement, gently floating/levitating hero cards, subtle gradient/light movement, smooth entrance/reveal transitions as sections enter, small hover/tap feedback, animated reaction/like feedback, and smooth navigation/section transitions. Use tasteful glassmorphism on selected elements (translucent glass surfaces, backdrop blur, delicate borders, layered light/shadow) rather than applying it everywhere. Use CSS transforms/opacity and lightweight CSS animations or an appropriate existing motion library if available. Keep animations performant, not distracting, and respect prefers-reduced-motion. Avoid heavy video, excessive particle effects, layout shifts, or motion that interferes with reading and controls. The interface must still feel complete if motion is reduced or unavailable. No fake loading states or animation that delays usability.

APP STRUCTURE
Build a single application containing both public marketing pages and the real product.
Routes/pages:
- / : high-quality public landing page
- /explore : public discovery/feed of sample or real public Pings
- /signup and /login : account flows
- /create : create a Ping (requires authentication)
- /p/:id or an equivalent stable public Ping route
- /@:username or an equivalent public founder profile route
- /settings : profile/account settings
Ensure routing and mobile navigation work. Include a clean not-found state.

LANDING PAGE EXPERIENCE
Create a visually rich but clear narrative:
1. Responsive header with Ping wordmark, Explore, About/how it works, Log in, and a prominent “Create your first Ping” CTA.
2. Hero with headline around “You’re building something. Let the world see it.” and supporting copy explaining that people share progress, ideas, milestones, and opportunities, connect with people who care, and give ideas somewhere to go. Primary CTA: “Create your first Ping”; secondary CTA: “Explore Pings”.
3. A layered, animated visual composition of realistic example Ping cards, founder identities, reactions, and share cues. It should clearly demonstrate the product, not just abstract blobs. Cards should feel lively, subtly float, and have varied but consistent composition.
4. A short “how a Ping travels” section showing a person sharing, another discovering, reacting, and connecting.
5. Interactive product demo embedded on the page: visitors can switch among a few example Pings, inspect a founder profile preview, and see the share-link treatment. The demo is explicitly a preview; it must not pretend to publish real data. Make interactions actually work.
6. Feature/value sections covering public shareable links, founder profiles, reactions, unlimited Pings, and discovery.
7. A closing invitation and footer. Include an ARISE opportunity callout linking exactly to https://JoinArise.cv, with careful neutral wording and no implication that likes or joining Ping guarantees funding.
Avoid generic template filler, repeated paragraphs, fake statistics, fake testimonials, or invented traction numbers. Use grounded sample content and label it as demo/sample content where needed.

CORE MVP PRODUCT
- Auth: signup/login/logout, email verification and password recovery where supported by the selected backend.
- Profile: unique username, display name, avatar/profile image where feasible, short bio; editable settings.
- Pings: authenticated users can create unlimited text Pings; support optional image upload only if it fits cleanly with storage/security. Optional external call-to-action URL on a Ping (website, waitlist, buy, contact).
- Feed/explore: responsive list/grid of recent public Pings; filters/categories only if lightweight and useful.
- Ping detail: public read view with creator/profile link, timestamp, content, optional image/CTA, like count, share actions.
- Public profile: /@username (or equivalent), bio/avatar, all that user's public Pings.
- Likes: verified/authenticated users can like/unlike; enforce one like per user per Ping and persist to database.
- Reping/share: share the Ping URL through native share where supported, plus WhatsApp share and copy-link fallback. Do not promise a dedicated story API or claim recipient counts.
- Edit/delete: users can edit/delete only their own Pings.
- Report: basic report-abuse action and a safe empty/report confirmation state.
- ARISE callout: link to https://JoinArise.cv. Do not claim that likes, a pass purchase, or Ping activity automatically qualifies anyone for funding.
- Secure data access: enable managed backend/database/auth if available in this project, create appropriate tables and row-level security/access policies. Prefer the default Lovable-managed backend path; avoid adding unnecessary external services. Do not leave privileged keys in client code. If backend provisioning or secrets require user action, build the UI and clearly identify the required next step rather than pretending it is connected.
- Persistent database model should cover profiles, pings, likes (unique user+ping), and content reports; platform settings only if needed. Avoid storing unnecessary personal data.
- Public reading of public Pings/profiles should work without account; mutations require appropriate authentication.
- Use useful empty states, validation, accessible labels, error feedback, and responsive loading states.

OUT OF SCOPE FOR MVP
No chat, calls, reels/video, internal payments/donations, complicated ranking/recommendation algorithms, or elaborate follower system. Do not introduce unnecessary scope.

QUALITY BAR / BUILD PROCESS
First build a cohesive, production-minded first pass, not a wireframe. Reuse components and design tokens. Use semantic HTML, keyboard-accessible interactions, sensible contrast, and mobile-first responsive behavior. Ensure buttons and links do what they say. Avoid lorem ipsum. Use realistic sample Ping content without presenting it as real platform activity. Do not invent social proof. Make the landing page excellent even if backend setup still requires connection. Build the functional core alongside the marketing pages; do not stop at the landing page. After implementing, check the app for obvious type/build/runtime issues and fix them. Report what is functional, what depends on backend/auth provisioning or user setup, and any important remaining gaps. Do not publish/deploy automatically; provide preview/editor links for review first.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pingbydot.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/df6363f4-f355-4cb6-ad64-f6efcc958a36).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
