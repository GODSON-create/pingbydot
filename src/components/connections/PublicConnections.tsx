import { ArrowUpRight, Star } from "lucide-react";
import {
  PLATFORM_LABEL,
  connectionDisplay,
  connectionUrl,
  publicConnections,
  type Connection,
} from "@/lib/connections";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "./PlatformIcon";

export function PublicConnections({ connections }: { connections: Connection[] }) {
  const visible = publicConnections(connections);
  if (!visible.length) return null;
  return (
    <section aria-label="Social connections" className="mt-6 border-t pt-5" data-no-gesture>
      <h2 className="font-display text-lg font-bold">Connect</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {visible.map((connection) => {
          const url = connectionUrl(connection.platform, connection.handle);
          if (!url) return null;
          const label = PLATFORM_LABEL[connection.platform];
          return (
            <Button
              key={connection.platform}
              asChild
              variant={connection.is_primary ? "secondary" : "outline"}
              className="h-auto min-h-14 justify-start rounded-xl px-4 py-3"
            >
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                aria-label={`Open ${label} ${connectionDisplay(connection.platform, connection.handle)}${connection.is_primary ? ", primary contact" : ""} (opens in a new tab)`}
              >
                <PlatformIcon platform={connection.platform} />
                <span className="min-w-0 flex-1 whitespace-normal break-all">
                  <span className="block">{label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {connectionDisplay(connection.platform, connection.handle)}
                  </span>
                </span>
                {connection.is_primary && <Star className="fill-current" aria-hidden="true" />}
                <ArrowUpRight aria-hidden="true" />
              </a>
            </Button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Links open the platform’s app when available, or its website. Instagram and X open profiles,
        not direct messages.
      </p>
    </section>
  );
}
