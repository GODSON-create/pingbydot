import { useState } from "react";
import { pageHead, siteUrl, NOINDEX } from "@/lib/site";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link2, UserPlus, Check, Building2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { profileQuery, type Profile, type Ping } from "@/lib/pings";
import { useGetOrCreateDirectConversation } from "@/lib/messages";
import { FounderAvatar } from "@/components/ping/Avatar";
import { PingCard } from "@/components/ping/PingCard";
import { ErrorComponent } from "@/routes/__root";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { PublicConnections } from "@/components/connections/PublicConnections";
import { ProfileHighlights } from "@/components/moments/ProfileHighlights";
import { userActiveMomentsQuery } from "@/lib/moments";
import { MomentViewerModal } from "@/components/moments/MomentViewerModal";
import { followQuery, myHubsQuery } from "@/lib/hub-queries";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/@{$username}")({
  staticData: { sitemap: true },
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(profileQuery(params.username));
    if (!data) throw notFound();
    return data;
  },
  errorComponent: ErrorComponent,
  notFoundComponent: () => (
    <div className="px-5 py-20 text-center">
      <h1 className="font-display text-4xl font-extrabold">No one here yet</h1>
      <p>That founder profile doesn't exist.</p>
      <Button asChild className="mt-6">
        <Link to="/explore">Explore Pings</Link>
      </Button>
    </div>
  ),
  head: ({ loaderData }) => {
    const p = loaderData?.profile;
    if (!p) return { meta: [{ title: "Profile unavailable — Ping by DOT" }, NOINDEX] };
    const name = p.display_name || `@${p.username}`;
    const head = pageHead({
      title: `${name} (@${p.username}) — Ping by DOT`,
      description: (p.bio || `See what @${p.username} is building in public on Ping.`).slice(
        0,
        200,
      ),
      path: `/@${encodeURIComponent(p.username)}`,
      type: "profile",
    });
    return { ...head, meta: [...head.meta, { property: "profile:username", content: p.username }] };
  },
  component: ProfilePage,
});

function FollowButton({
  profileId,
  currentUserId,
}: {
  profileId: string;
  currentUserId?: string | undefined;
}) {
  const qc = useQueryClient();
  const { data: follow } = useQuery(followQuery(profileId, currentUserId));

  const followMutation = useMutation({
    mutationFn: async (following: boolean) => {
      if (!currentUserId) throw new Error("Please log in to follow builders");
      if (following) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", profileId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: currentUserId, following_id: profileId });
        if (error) throw error;
      }
    },
    onMutate: async (following) => {
      await qc.cancelQueries({ queryKey: ["follow", profileId, currentUserId] });
      const previous = qc.getQueryData(["follow", profileId, currentUserId]);
      qc.setQueryData(["follow", profileId, currentUserId], (old: any) => ({
        ...old,
        isFollowing: !following,
        followers: (old?.followers ?? 0) + (following ? -1 : 1),
      }));
      return { previous };
    },
    onError: (_err, _variables, context: any) => {
      if (context?.previous) {
        qc.setQueryData(["follow", profileId, currentUserId], context.previous);
      }
      toast.error("Couldn't update follow status.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["follow", profileId] });
    },
  });

  const isFollowing = follow?.isFollowing ?? false;

  return (
    <Button
      variant={isFollowing ? "outline" : "hero"}
      size="sm"
      className="rounded-full"
      disabled={followMutation.isPending}
      onClick={() => {
        if (!currentUserId) {
          toast("Sign in to follow founders", {
            action: { label: "Log in", onClick: () => (window.location.href = "/login") },
          });
          return;
        }
        followMutation.mutate(isFollowing);
      }}
    >
      {isFollowing ? (
        <>
          <Check className="size-4" /> Following
        </>
      ) : (
        <>
          <UserPlus className="size-4" /> Follow
        </>
      )}
    </Button>
  );
}

function ProfilePage() {
  const { username } = Route.useParams();
  const { data } = useSuspenseQuery(profileQuery(username));
  if (!data) return null;
  return (
    <ProfileContent
      data={data as { profile: Profile; pings: Ping[]; connections: any[] }}
      username={username}
    />
  );
}

function ProfileContent({
  data,
  username,
}: {
  data: { profile: Profile; pings: Ping[]; connections: any[] };
  username: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const startChatMutation = useGetOrCreateDirectConversation();
  const { profile, pings, connections } = data;
  const isMe = user?.id === profile.id;
  const name = profile.display_name || profile.username || username;

  // Follow counts and status
  const { data: follow } = useQuery(followQuery(profile.id, user?.id));

  // Hubs joined by this founder
  const { data: joinedHubs } = useQuery(myHubsQuery(profile.id));

  return (
    <div className="pb-24">
      <section className="bg-hero">
        <div className="mx-auto max-w-4xl px-5 pb-10 pt-12">
          <div className="surface-card relative rounded-[2rem] p-6 sm:p-9 border border-border shadow-lift">
            <span className="sticker absolute -top-3 right-6 rotate-3 bg-lime text-lime-foreground">
              founder
            </span>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <FounderAvatar name={name} src={profile.avatar_url} size="xl" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{name}</h1>
                </div>
                <p className="text-muted-foreground text-sm">
                  @{profile.username} · on Ping since{" "}
                  {format(new Date(profile.created_at), "MMM yyyy")}
                </p>

                {/* Follower counts */}
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground">
                      {(follow?.followers ?? 0).toLocaleString()}
                    </strong>{" "}
                    followers
                  </span>
                  <span>·</span>
                  <span>
                    <strong className="text-foreground">
                      {(follow?.following ?? 0).toLocaleString()}
                    </strong>{" "}
                    following
                  </span>
                </div>

                {profile.bio && (
                  <p className="mt-3 max-w-xl whitespace-pre-line text-sm">{profile.bio}</p>
                )}
              </div>

              <div className="flex gap-2 sm:flex-col shrink-0">
                {!isMe && <FollowButton profileId={profile.id} currentUserId={user?.id} />}
                {!isMe && user && (
                  <Button
                    size="sm"
                    className="rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
                    disabled={startChatMutation.isPending}
                    onClick={async () => {
                      try {
                        const convId = await startChatMutation.mutateAsync(profile.id);
                        navigate({
                          to: "/messages",
                          search: { conversationId: convId },
                        });
                      } catch (e: any) {
                        toast.error(e.message || "Failed to start direct conversation");
                      }
                    }}
                  >
                    <MessageSquare className="size-4 mr-1.5" /> Message
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        siteUrl(`/@${encodeURIComponent(profile.username)}`),
                      );
                      toast.success("Profile link copied");
                    } catch {
                      toast.error("Couldn't copy. Copy the link from the address bar.");
                    }
                  }}
                >
                  <Link2 className="size-4" /> Copy link
                </Button>
                {isMe && (
                  <Button asChild size="sm" variant="secondary" className="rounded-full">
                    <Link to="/settings">Edit profile</Link>
                  </Button>
                )}
              </div>
            </div>
            <PublicConnections connections={connections} />
            <ProfileHighlights profile={profile} isMe={isMe} />
          </div>
        </div>
      </section>

      {/* Hubs Joined Section */}
      {joinedHubs && joinedHubs.length > 0 && (
        <section className="mx-auto max-w-4xl px-5 mt-6 mb-8">
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> Hubs Joined
          </h2>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {joinedHubs.map((jh) => (
              <Link
                key={jh.hub.id}
                to="/hubs/$slug"
                params={{ slug: jh.hub.slug }}
                className="surface-card flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5 hover:border-primary"
              >
                <span>{jh.hub.name}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  {jh.role}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Pings Section */}
      <section className="mx-auto max-w-4xl px-5 mt-4">
        <h2 className="font-display text-xl font-bold">
          {pings.length} {pings.length === 1 ? "Ping" : "Pings"}
        </h2>
        {pings.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed p-10 text-center text-muted-foreground">
            {isMe ? (
              <>
                <p>You haven't shared anything yet.</p>
                <Button asChild variant="hero" className="mt-4 rounded-full">
                  <Link to="/create">Create your first Ping</Link>
                </Button>
              </>
            ) : (
              <p>{name} hasn't shared a Ping yet.</p>
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {pings.map((p: any) => (
              <PingCard key={p.id} ping={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
