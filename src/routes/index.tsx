import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Heart, Link2, Share2, Sparkles, Users, Infinity as InfinityIcon, Compass, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Reveal } from "@/components/Reveal";
import { AriseCallout } from "@/components/AriseCallout";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ping — Build in public. Share your story." },
      { name: "description", content: "Share progress, ideas, milestones and opportunities as Pings with public links. Connect with people who care about what you're building." },
      { property: "og:title", content: "Ping — Build in public. Share your story." },
      { property: "og:description", content: "You're building something. Let the world see it." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const SAMPLES = [
  { id: "a", name: "Amara Osei", user: "amara", bio: "Building a pickup app for neighbourhood bakeries. Ex-pastry chef.", tag: "🚀 Launch", tone: "bg-lime text-lime-foreground", text: "We opened the waitlist for Crumb today. Three bakeries on my street agreed to pilot end-of-day boxes next week.", cta: "Join the waitlist", likes: 24 },
  { id: "b", name: "Tomás Reyes", user: "tomas", bio: "Solo dev making a budgeting tool for freelancers.", tag: "🙋 Question", tone: "bg-blush text-blush-foreground", text: "Freelancers: do you set money aside for tax per invoice or once a month? Deciding the default for Ledgerly.", cta: null, likes: 11 },
  { id: "c", name: "Priya Nair", user: "priya", bio: "Climate hardware. Tinkering with low-cost soil sensors.", tag: "🏁 Milestone", tone: "bg-sun text-foreground", text: "Sensor v3 survived 30 days outdoors through rain. Battery is still at 71%. Field test with two farms starts in May.", cta: "Read the build log", likes: 38 },
];

function MiniPing({ s, className, style }: { s: (typeof SAMPLES)[number]; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("glass w-72 rounded-3xl p-4", className)} style={style}>
      <div className="flex items-center gap-2.5">
        <FounderAvatar name={s.name} size="sm" />
        <div className="min-w-0 flex-1 text-sm"><p className="truncate font-semibold">{s.name}</p><p className="text-xs text-muted-foreground">@{s.user}</p></div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.tone)}>{s.tag}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{s.text}</p>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Heart className="size-3.5 fill-blush-foreground text-blush-foreground" /> {s.likes}</span>
        <span className="inline-flex items-center gap-1"><Link2 className="size-3.5" /> ping/p/{s.id}…</span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -right-20 top-0 size-[28rem] rounded-full bg-lime/40 blur-3xl animate-drift" />
        <div className="absolute -left-24 top-40 size-[22rem] rounded-full bg-blush/60 blur-3xl animate-drift [animation-delay:-8s]" />
      </div>
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
        <div>
          <span className="sticker -rotate-2 bg-card">✦ Build in public. Share your story.</span>
          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[0.95] sm:text-7xl">
            You're building something. <span className="text-shimmer">Let the world see it.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            Share progress, ideas, milestones and opportunities as Pings. Each one gets a link anyone can open — so your ideas have somewhere to go, and people who care can find you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="hero" size="lg"><Link to="/signup">Create your first Ping</Link></Button>
            <Button asChild variant="glass" size="lg"><Link to="/explore">Explore Pings <ArrowRight /></Link></Button>
          </div>
        </div>
        <div className="relative mx-auto h-[26rem] w-full max-w-md" aria-label="Example Pings (sample content)">
          <MiniPing s={SAMPLES[0]} className="absolute left-0 top-2 animate-float-a" style={{ "--r": "-4deg" } as React.CSSProperties} />
          <MiniPing s={SAMPLES[2]} className="absolute right-0 top-36 animate-float-b" style={{ "--r": "3deg" } as React.CSSProperties} />
          <div className="glass absolute bottom-6 left-6 flex items-center gap-2 rounded-full px-4 py-2 text-sm animate-float-b">
            <Heart className="size-4 fill-blush-foreground text-blush-foreground" /> Tomás liked your Ping
          </div>
          <span className="sticker absolute right-8 top-0 rotate-6 bg-lime text-lime-foreground">sample</span>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: Sparkles, t: "Share", d: "Amara posts a Ping about her waitlist opening." },
  { icon: Compass, t: "Discover", d: "Someone browsing Explore — or tapping a WhatsApp link — finds it." },
  { icon: Heart, t: "React", d: "They like it. Amara sees that the story landed." },
  { icon: Users, t: "Connect", d: "They open her profile, follow her link, and reach out." },
];

function Travels() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-28 px-5 py-20">
      <Reveal><h2 className="font-display text-4xl font-extrabold sm:text-5xl">How a Ping travels</h2></Reveal>
      <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <Reveal as="li" key={s.t} delay={i * 90} className="surface-card lift rounded-3xl p-6">
            <span className="flex size-11 items-center justify-center rounded-full border-[1.5px] border-foreground bg-lime"><s.icon className="size-5" /></span>
            <p className="mt-5 text-xs font-bold text-muted-foreground">0{i + 1}</p>
            <h3 className="font-display text-xl font-bold">{s.t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

function Demo() {
  const [i, setI] = useState(0);
  const [view, setView] = useState<"ping" | "profile" | "share">("ping");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const s = SAMPLES[i];
  const isLiked = !!liked[s.id];
  return (
    <section id="demo" className="scroll-mt-28 bg-forest grain py-20 text-primary-foreground">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <span className="sticker bg-lime text-lime-foreground">interactive preview</span>
          <h2 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">Try it before you sign up</h2>
          <p className="mt-2 max-w-lg text-primary-foreground/75">Sample Pings only — nothing here is published or saved.</p>
        </Reveal>
        <div className="mt-10 grid gap-8 lg:grid-cols-[18rem_1fr]">
          <div className="flex gap-2 overflow-x-auto lg:flex-col" role="tablist" aria-label="Sample Pings">
            {SAMPLES.map((x, k) => (
              <button key={x.id} role="tab" aria-selected={k === i} onClick={() => setI(k)} className={cn("glass-dark shrink-0 rounded-2xl px-4 py-3 text-left transition-all", k === i && "ring-2 ring-lime")}>
                <p className="text-sm font-semibold">{x.name}</p><p className="text-xs text-primary-foreground/70">{x.tag}</p>
              </button>
            ))}
          </div>
          <div>
            <div className="inline-flex rounded-full bg-forest-deep/60 p-1" role="tablist" aria-label="Preview view">
              {(["ping", "profile", "share"] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors", view === v ? "bg-lime text-lime-foreground" : "text-primary-foreground/80 hover:text-primary-foreground")}>
                  {v === "share" ? "Share link" : v}
                </button>
              ))}
            </div>
            <div key={`${s.id}-${view}`} className="mt-5 max-w-xl animate-page-in rounded-3xl bg-card p-6 text-card-foreground shadow-lift">
              {view === "ping" && (
                <>
                  <div className="flex items-center gap-3"><FounderAvatar name={s.name} /><div className="flex-1"><p className="font-semibold">{s.name}</p><p className="text-xs text-muted-foreground">@{s.user} · sample</p></div><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", s.tone)}>{s.tag}</span></div>
                  <p className="mt-4 text-lg leading-relaxed">{s.text}</p>
                  {s.cta && <div className="mt-4 rounded-2xl border bg-secondary/60 px-4 py-3 text-sm font-semibold">{s.cta} ↗</div>}
                  <div className="mt-4 flex items-center gap-2 border-t pt-3">
                    <button onClick={() => setLiked({ ...liked, [s.id]: !isLiked })} aria-pressed={isLiked} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold", isLiked ? "bg-blush text-blush-foreground" : "text-muted-foreground hover:bg-blush/60")}>
                      <Heart key={String(isLiked)} className={cn("size-4", isLiked && "fill-current animate-pop")} /> {s.likes + (isLiked ? 1 : 0)}
                    </button>
                    <button onClick={() => setView("share")} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:bg-secondary"><Share2 className="size-4" /> Reping</button>
                  </div>
                </>
              )}
              {view === "profile" && (
                <div className="flex flex-col items-start gap-3">
                  <FounderAvatar name={s.name} size="lg" />
                  <div><p className="font-display text-2xl font-bold">{s.name}</p><p className="text-sm text-muted-foreground">@{s.user}</p></div>
                  <p>{s.bio}</p>
                  <p className="text-sm text-muted-foreground">Every Ping they share shows up on this public profile.</p>
                </div>
              )}
              {view === "share" && (
                <div>
                  <p className="font-display text-xl font-bold">Every Ping has its own link</p>
                  <div className="mt-4 flex items-center gap-2 rounded-2xl border bg-secondary/60 p-2 pl-4 font-mono text-sm">
                    <span className="flex-1 truncate">yourping.app/p/{s.id}-sample</span>
                    <Button size="sm" onClick={() => toast("This is a preview link. Real Pings get a live link you can copy.")}>Copy</Button>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">Share it with your phone's share sheet, on WhatsApp, or paste it anywhere. Anyone can read it without an account.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: Link2, t: "Public, shareable links", d: "Every Ping lives at a stable URL anyone can open — no sign-up wall." },
  { icon: Users, t: "Founder profiles", d: "One page with your bio and every Ping you've shared, in order." },
  { icon: Heart, t: "Reactions", d: "Signed-in people can like a Ping once. Small signal, real people." },
  { icon: InfinityIcon, t: "Unlimited Pings", d: "Share as often as you build. Tiny steps count." },
  { icon: Compass, t: "Discovery", d: "Explore the newest Pings by type: launches, questions, opportunities and more." },
];

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <Reveal><h2 className="max-w-2xl font-display text-4xl font-extrabold sm:text-5xl">Everything a story needs to travel. Nothing it doesn't.</h2></Reveal>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, k) => (
          <Reveal key={f.t} delay={k * 70} className={cn("surface-card lift rounded-3xl p-7", k === 0 && "lg:row-span-2 bg-accent")}>
            <f.icon className="size-6" />
            <h3 className="mt-4 font-display text-xl font-bold">{f.t}</h3>
            <p className="mt-1 text-muted-foreground">{f.d}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Landing() {
  return (
    <>
      <Hero />
      <Travels />
      <Demo />
      <Features />
      <section className="mx-auto max-w-6xl px-5">
        <Reveal className="relative overflow-hidden rounded-[2rem] border-[1.5px] border-foreground bg-lime p-10 text-center text-lime-foreground sm:p-16">
          <h2 className="font-display text-4xl font-extrabold sm:text-6xl">Your next step deserves an audience.</h2>
          <p className="mx-auto mt-3 max-w-md">Write a Ping about what you did this week. It takes a minute.</p>
          <Button asChild size="lg" className="mt-8"><Link to="/signup">Create your first Ping</Link></Button>
        </Reveal>
        <div className="mt-10"><AriseCallout /></div>
      </section>
    </>
  );
}
