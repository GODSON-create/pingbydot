import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Users, Eye, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMessageReadSummary, type ReadReceiptStatus } from "@/lib/read-receipts";
import { cn } from "@/lib/utils";

interface ReadReceiptDotProps {
  messageId: string;
  isAuthor: boolean;
  isActiveReader?: boolean;
  className?: string;
  showCount?: boolean;
}

export function ReadReceiptDot({
  messageId,
  isAuthor,
  isActiveReader = false,
  className,
  showCount = true,
}: ReadReceiptDotProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data: summary, isLoading } = useMessageReadSummary(messageId);

  const readCount = summary?.read_count ?? 0;
  const totalRecipients = summary?.total_recipients ?? 0;
  const readers = summary?.readers ?? [];

  // Determine visual status
  let status: ReadReceiptStatus = "unread";
  if (isActiveReader) {
    status = "active";
  } else if (readCount > 0) {
    status = "read";
  }

  // Visual dot element
  const dotElement = (
    <span
      className={cn(
        "relative inline-flex items-center justify-center transition-all select-none",
        status === "active" && "size-2.5",
        status !== "active" && "size-2",
        className
      )}
      aria-label={`Status: ${status === "active" ? "Active reading" : status === "read" ? "Read" : "Unread"}`}
      role="status"
    >
      {status === "active" ? (
        <span className="relative flex size-2.5 items-center justify-center">
          <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75 animate-ping-breathe" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        </span>
      ) : status === "read" ? (
        <span className="inline-flex size-2 rounded-full bg-emerald-500" />
      ) : (
        <span className="inline-flex size-2 rounded-full bg-foreground/80 dark:bg-black dark:border dark:border-neutral-500" />
      )}
    </span>
  );

  if (!isAuthor) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={status === "active" ? "Actively reading" : status === "read" ? "Read" : "Delivered"}>
        {dotElement}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        className="group inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary/70 transition-colors"
        title="View read status"
      >
        {dotElement}
        {showCount && totalRecipients > 0 && (
          <span className="text-[11px] font-medium tracking-tight group-hover:text-foreground">
            {readCount}/{totalRecipients}
          </span>
        )}
      </button>

      {/* Reader details modal */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Eye className="size-4 text-primary" />
              <span>Message Read Status</span>
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            <div className="flex items-center justify-between rounded-2xl bg-secondary/60 p-3 text-sm">
              <span className="text-muted-foreground font-medium">Read by</span>
              <span className="font-bold text-foreground">
                {readCount} of {totalRecipients} {totalRecipients === 1 ? "builder" : "builders"}
              </span>
            </div>

            {readers.length > 0 ? (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {readers.map((reader) => (
                  <div
                    key={reader.user_id}
                    className="flex items-center justify-between rounded-xl p-2 hover:bg-secondary/40 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="size-8">
                        <AvatarImage src={reader.avatar_url ?? undefined} alt={reader.display_name} />
                        <AvatarFallback className="text-xs font-bold uppercase">
                          {(reader.display_name || reader.username || "B").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-tight">
                          {reader.display_name || reader.username}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          @{reader.username}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      <span>{formatDistanceToNowStrict(new Date(reader.read_at))} ago</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {readCount > 0
                  ? "Readers have private read receipts enabled in their settings."
                  : "No recipients have read this message yet."}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
