import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  ExternalLink,
  FileText,
  Flag,
  Image as ImageIcon,
  Link2,
  MessageSquare,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Users,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { followQuery } from "@/lib/hub-queries";
import { mutualConnectionsQuery } from "@/lib/social";
import { mutedUsersQuery, useMuteUser, useUnmuteUser } from "@/lib/mutes";
import { useBlockUser, type PrivateMessage } from "@/lib/messages";
import type { Profile } from "@/lib/pings";
import { FounderAvatar } from "@/components/ping/Avatar";
import { ResolvedMomentThumb } from "@/components/media/ResolvedPrivateMedia";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const URL_EXTRACT_RE = /https?:\/\/[^\s<>()]+/gi;

export interface SharedConversationAssets {
  media: Array<{ id: string; url: string; type: string; createdAt: string }>;
  files: Array<{ id: string; url: string; label: string; createdAt: string }>;
  links: Array<{ id: string; url: string; host: string; createdAt: string }>;
}

/**
 * Extracts shared media, files, and HTTPS links from a conversation's messages
 * for the Cascading Profile Inspection Panel (Section 6).
 */
export function extractSharedConversationAssets(
  messages: PrivateMessage[],
): SharedConversationAssets {
  const media: SharedConversationAssets["media"] = [];
  const files: SharedConversationAssets["files"] = [];
  const links: SharedConversationAssets["links"] = [];
  const seenLinks = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.media_url) {
      if (m.media_type === "image" || m.media_type === "video") {
        media.push({
          id: m.id,
          url: m.media_url,
          type: m.media_type,
          createdAt: m.created_at,
        });
      } else {
        files.push({
          id: m.id,
          url: m.media_url,
          label: m.content || (m.media_type === "audio" ? "Voice note" : "Attachment"),
          createdAt: m.created_at,
        });
      }
    }
    if (m.content) {
      const found = m.content.match(URL_EXTRACT_RE) ?? [];
      for (const raw of found) {
        if (seenLinks.has(raw)) continue;
        try {
          const parsed = new URL(raw);
          seenLinks.add(raw);
          links.push({
            id: `${m.id}-${links.length}`,
            url: parsed.href,
            host: parsed.hostname.replace(/^www\./, ""),
            createdAt: m.created_at,
          });
        } catch {
          // Skip malformed URLs
        }
      }
    }
  }

  return {
    media: media.slice(0, 12),
    files: files.slice(0, 12),
    links: links.slice(0, 12),
  };
}

interface CascadingProfilePanelProps {
  profile: Pick<Profile, "id" | "username" | "display_name" | "avatar_url" | "bio">;
  onClose: () => void;
  /** Optional conversation context when opened from Direct Messaging */
  messages?: PrivateMessage[] | undefined;
  isChatMuted?: boolean | undefined;
  isChatArchived?: boolean | undefined;
  onToggleChatMute?: (() => void) | undefined;
  onToggleChatArchive?: (() => void) | undefined;
  onStartChat?: ((userId: string) => void) | undefined;
  onBlocked?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Single reusable Cascading Profile Inspection Panel (Section 6 & 10).
 *
 * - Desktop: renders as an inline secondary right panel keeping conversation / search accessible.
 * - Mobile: renders as a smooth stacked slide-over panel with Back button preserving underlying
 *   scroll position and conversation context.
 */
export function CascadingProfilePanel({
  profile,
  onClose,
  messages,
  isChatMuted = false,
  isChatArchived = false,
  onToggleChatMute,
  onToggleChatArchive,
  onStartChat,
  onBlocked,
  className,
}: CascadingProfilePanelProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [assetTab, setAssetTab] = useState<"media" | "links" | "files">("media");
  const isSelf = Boolean(user?.id && user.id === profile.id);

  const { data: follow } = useQuery(followQuery(profile.id, user?.id));
  const { data: mutual } = useQuery(mutualConnectionsQuery(user?.id, profile.id));
  const { data: mutedList = [] } = useQuery(mutedUsersQuery(user?.id));

  const muteUser = useMuteUser();
  const unmuteUser = useUnmuteUser();
  const blockUser = useBlockUser();

  const isFollowing = follow?.isFollowing ?? false;
  const isMutedAccount = mutedList.some((m) => m.muted_id === profile.id);

  const followMutation = useMutation({
    mutationFn: async (currentlyFollowing: boolean) => {
      if (!user?.id) throw new Error("Sign in to follow people.");
      if (currentlyFollowing) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", profile.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: user.id, following_id: profile.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["follow", profile.id] });
      void qc.invalidateQueries({ queryKey: ["mutual-connections", user?.id, profile.id] });
      toast.success(
        isFollowing ? `Unfollowed @${profile.username}` : `Following @${profile.username}`,
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update follow"),
  });

  const sharedAssets = useMemo(
    () => (messages ? extractSharedConversationAssets(messages) : null),
    [messages],
  );

  const handleReport = async () => {
    if (!user?.id) return;
    try {
      const { error } = await supabase.from("profile_reports").insert({
        reporter_id: user.id,
        reported_user_id: profile.id,
        reason: "Reported from profile inspection panel",
      });
      if (error) throw error;
      toast.success(`Reported @${profile.username} for moderation review.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit report.");
    }
  };

  const displayName = profile.display_name || profile.username;

  return (
    <aside
      aria-label={`Profile details for ${displayName}`}
      data-testid="cascading-profile-panel"
      className={cn(
        "fixed inset-0 z-50 lg:static lg:z-auto flex flex-col w-full lg:w-80 shrink-0 h-full bg-card lg:bg-card/80 lg:rounded-3xl border border-border/70 p-5 overflow-y-auto shadow-lift lg:shadow-none animate-page-in",
        className,
      )}
    >
      {/* Top Bar: Mobile Back + Desktop Close */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Back to conversation"
            className="size-8 rounded-full lg:hidden"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Profile Inspector
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close participant profile"
          className="size-7 rounded-full"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Identity Header */}
      <div className="flex flex-col items-center text-center py-5 border-b border-border/50">
        <FounderAvatar name={displayName} src={profile.avatar_url} size="xl" />
        <div className="mt-3 flex items-center justify-center gap-1.5 max-w-full">
          <h4 className="font-display font-bold text-base text-foreground truncate">
            {displayName}
          </h4>
          <VerificationBadge userId={profile.id} size="sm" />
        </div>
        <p className="text-xs text-muted-foreground font-mono">@{profile.username}</p>

        {profile.bio && (
          <p className="text-xs text-foreground/85 mt-3 leading-relaxed line-clamp-4">
            {profile.bio}
          </p>
        )}

        {/* Mutual Connections */}
        {!isSelf && mutual && (mutual.isMutualFollow || mutual.sharedConnections.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-primary">
            <Users className="size-3.5 shrink-0" />
            {mutual.isMutualFollow && <span className="font-semibold">Mutual connection</span>}
            {mutual.sharedConnections.length > 0 && (
              <span className="text-muted-foreground">
                · {mutual.sharedConnections.length} shared
              </span>
            )}
          </div>
        )}

        {/* Primary Actions */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 w-full">
          {!isSelf && user && (
            <Button
              type="button"
              size="sm"
              variant={isFollowing ? "outline" : "hero"}
              disabled={followMutation.isPending}
              onClick={() => followMutation.mutate(isFollowing)}
              className="rounded-full text-xs flex-1 gap-1.5"
            >
              {isFollowing ? (
                <>
                  <UserCheck className="size-3.5" /> Following
                </>
              ) : (
                <>
                  <UserPlus className="size-3.5" /> Follow
                </>
              )}
            </Button>
          )}
          {!isSelf && onStartChat && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onStartChat(profile.id)}
              className="rounded-full text-xs flex-1 gap-1.5"
            >
              <MessageSquare className="size-3.5" /> Message
            </Button>
          )}
          <Button
            asChild
            size="sm"
            variant="outline"
            className="rounded-full text-xs w-full gap-1.5"
          >
            <Link to="/@{$username}" params={{ username: profile.username }} onClick={onClose}>
              <ExternalLink className="size-3.5" /> Open Full Profile
            </Link>
          </Button>
        </div>
      </div>

      {/* Shared Media, Links & Files (when opened inside chat) */}
      {sharedAssets && (
        <div className="py-4 border-b border-border/50 space-y-3">
          <div className="flex items-center gap-1 rounded-full bg-secondary/70 p-1">
            {(
              [
                { id: "media", label: `Media (${sharedAssets.media.length})`, icon: ImageIcon },
                { id: "links", label: `Links (${sharedAssets.links.length})`, icon: Link2 },
                { id: "files", label: `Files (${sharedAssets.files.length})`, icon: FileText },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAssetTab(t.id)}
                  className={cn(
                    "flex-1 inline-flex items-center justify-center gap-1 rounded-full py-1 text-[10px] font-bold transition-colors",
                    assetTab === t.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3" /> {t.label}
                </button>
              );
            })}
          </div>

          {assetTab === "media" &&
            (sharedAssets.media.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">
                No shared photos or videos yet.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {sharedAssets.media.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="aspect-square rounded-xl bg-secondary/70 border border-border/50 flex items-center justify-center overflow-hidden text-[10px] text-muted-foreground"
                  >
                    <ResolvedMomentThumb
                      mediaUrl={item.url}
                      mediaType={item.type}
                      alt="Shared conversation media"
                      className="size-full object-cover"
                    />
                  </div>
                ))}
              </div>
            ))}

          {assetTab === "links" &&
            (sharedAssets.links.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">
                No shared links in this conversation.
              </p>
            ) : (
              <div className="space-y-1.5">
                {sharedAssets.links.slice(0, 5).map((l) => (
                  <a
                    key={l.id}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/35 px-3 py-2 text-[11px] hover:bg-secondary transition-colors"
                  >
                    <span className="truncate font-medium text-foreground">{l.host}</span>
                    <ExternalLink className="size-3 text-primary shrink-0" />
                  </a>
                ))}
              </div>
            ))}

          {assetTab === "files" &&
            (sharedAssets.files.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">
                No shared documents or voice notes yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {sharedAssets.files.slice(0, 5).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/35 px-3 py-2 text-[11px]"
                  >
                    <FileText className="size-3.5 text-primary shrink-0" />
                    <span className="truncate text-foreground">{f.label}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}

      {/* Conversation & Safety Controls (Mute, Archive, Mute Account, Block, Report) */}
      <div className="pt-4 space-y-1.5 text-xs">
        {onToggleChatMute && (
          <button
            type="button"
            onClick={onToggleChatMute}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            {isChatMuted ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            <span>{isChatMuted ? "Unmute conversation" : "Mute conversation"}</span>
          </button>
        )}
        {onToggleChatArchive && (
          <button
            type="button"
            onClick={onToggleChatArchive}
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <Archive className="size-4" />
            <span>{isChatArchived ? "Unarchive chat" : "Archive chat"}</span>
          </button>
        )}

        {!isSelf && user && (
          <>
            <button
              type="button"
              onClick={() => {
                if (isMutedAccount) {
                  unmuteUser.mutate(
                    { userId: user.id, targetUserId: profile.id },
                    { onSuccess: () => toast.success(`Unmuted @${profile.username}`) },
                  );
                } else {
                  muteUser.mutate(
                    { userId: user.id, targetUserId: profile.id },
                    { onSuccess: () => toast.success(`Muted @${profile.username}`) },
                  );
                }
              }}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <VolumeX className="size-4" />
              <span>{isMutedAccount ? "Unmute account" : "Mute account"}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleReport()}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <Flag className="size-4" />
              <span>Report @{profile.username}</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await blockUser.mutateAsync(profile.id);
                  toast.success(`Blocked @${profile.username}`);
                  onClose();
                  onBlocked?.();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not block user.");
                }
              }}
              className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-destructive hover:bg-destructive/10 transition-colors"
            >
              <ShieldAlert className="size-4" />
              <span>Block @{profile.username}</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
