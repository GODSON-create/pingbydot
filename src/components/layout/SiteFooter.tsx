import { Link } from "@tanstack/react-router";
import { BrandLogo, PingMark } from "@/components/BrandLogo";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Link to="/" className="inline-flex items-center" aria-label="Ping by DOT home">
            <BrandLogo variant="silver" />
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Human coordination network. People, intent, discovery, and connection.
          </p>
          <div className="mt-4 flex items-center gap-2" aria-label="Official PING brand editions">
            <PingMark variant="lime" size="sm" alt="PING Lime Edition" />
            <PingMark variant="gold" size="sm" alt="PING Gold Edition" />
            <PingMark variant="silver" size="sm" alt="PING Silver Edition" />
          </div>
        </div>
        <nav className="flex flex-col gap-2 text-sm" aria-label="Product">
          <span className="font-display font-bold">Product</span>
          <Link to="/explore" className="text-muted-foreground hover:text-foreground">
            Explore
          </Link>
          <Link to="/clips" className="text-muted-foreground hover:text-foreground">
            Clips
          </Link>
          <Link to="/inbox" search={{}} className="text-muted-foreground hover:text-foreground">
            Inbox
          </Link>
          <Link to="/hubs" className="text-muted-foreground hover:text-foreground">
            Hubs (Groups)
          </Link>
          <Link to="/signals" className="text-muted-foreground hover:text-foreground">
            Signals (Broadcasts)
          </Link>
          <Link to="/create" className="text-muted-foreground hover:text-foreground">
            Create a Ping
          </Link>
          <Link to="/businesses" className="text-muted-foreground hover:text-foreground">
            Businesses
          </Link>
          <Link to="/developers" className="text-muted-foreground hover:text-foreground">
            Developer Platform
          </Link>
          <Link to="/download" className="text-muted-foreground hover:text-foreground">
            Download Ping App
          </Link>
        </nav>
        <nav className="flex flex-col gap-2 text-sm" aria-label="Account">
          <span className="font-display font-bold">Account & Legal</span>
          <Link to="/welcome" className="text-muted-foreground hover:text-foreground">
            Welcome Tour
          </Link>
          <Link to="/signup" className="text-muted-foreground hover:text-foreground">
            Sign up
          </Link>
          <Link to="/login" className="text-muted-foreground hover:text-foreground">
            Log in
          </Link>
          <Link to="/privacy" className="text-muted-foreground hover:text-foreground">
            Privacy Policy
          </Link>
          <Link to="/terms" className="text-muted-foreground hover:text-foreground">
            Terms of Service
          </Link>
          <a
            href="https://JoinArise.cv"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            ARISE ↗
          </a>
        </nav>
      </div>
      <p className="mx-auto max-w-6xl px-5 pb-8 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Ping by DOT. Open to everyone — connect, create, discover, and
        build together.
      </p>
    </footer>
  );
}
