import { Link } from "@tanstack/react-router";
import { Wordmark } from "./SiteHeader";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">Build in public. Share your story.</p>
        </div>
        <nav className="flex flex-col gap-2 text-sm" aria-label="Product">
          <span className="font-display font-bold">Product</span>
          <Link to="/explore" className="text-muted-foreground hover:text-foreground">Explore Pings</Link>
          <Link to="/create" className="text-muted-foreground hover:text-foreground">Create a Ping</Link>
          <Link to="/" hash="how" className="text-muted-foreground hover:text-foreground">How it works</Link>
        </nav>
        <nav className="flex flex-col gap-2 text-sm" aria-label="Account">
          <span className="font-display font-bold">Account</span>
          <Link to="/signup" className="text-muted-foreground hover:text-foreground">Sign up</Link>
          <Link to="/login" className="text-muted-foreground hover:text-foreground">Log in</Link>
          <a href="https://JoinArise.cv" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">ARISE ↗</a>
        </nav>
      </div>
      <p className="mx-auto max-w-6xl px-5 pb-8 text-xs text-muted-foreground">© {new Date().getFullYear()} Ping. Made for people building things.</p>
    </footer>
  );
}
