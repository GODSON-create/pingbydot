import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Heart,
  MessageCircle,
  Pencil,
  Trash2,
  Flag,
  Repeat2,
  Check,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { readPublicComments } from "@/lib/public-comments.functions";
import {
  buildThreads,
  repingAttribution,
  canModifyComment,
  commentLikeCount,
  commentReportSchema,
  commentSchema,
  COMMENT_MAX,
  COMMENT_MAX_DEPTH,
  type CommentNode,
  type CommentRow,
} from "@/lib/comments";
import { pingSchema, PING_MAX } from "@/lib/validation";
import type { Ping } from "@/lib/pings";
import { FounderAvatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const threadKey = (pingId: string) => ["comments", pingId] as const;

function friendlyError(e: unknown) {
  const msg = e instanceof Error ? e.message : "";
  if (/unavailable/i.test(msg)) return "That conversation is no longer available.";
  return "Something went wrong. Please try again.";
}

export function CommentsSection({ ping }: { ping: Ping }) {
  const { user } = useAuth();
  const q = useInfiniteQuery({
    queryKey: threadKey(ping.id),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => readPublicComments({ data: { pingId: ping.id, page: pageParam } }),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
  });
  const rows = useMemo(
    () => (q.data?.pages.flatMap((p) => p.rows) ?? []) as unknown as CommentRow[],
    [q.data],
  );
  const threads = useMemo(() => buildThreads(rows), [rows]);
  const ids = rows.map((r) => r.id);
  const myLikes = useQuery({
    queryKey: ["my-comment-likes", user?.id, ping.id, ids.length],
    enabled: !!user && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comment_likes")
        .select("comment_id")
        .eq("user_id", user!.id)
        .in("comment_id", ids);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.comment_id));
    },
  });

  return (
    <section
      aria-labelledby="replies-title"
      className="surface-card mt-5 rounded-[2rem] p-5 sm:p-8"
    >
      <h2 id="replies-title" className="font-display text-2xl font-bold">
        Conversation
      </h2>
      {user ? (
        <CommentForm pingId={ping.id} parentId={null} className="mt-4" />
      ) : (
        <p className="mt-3 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Link
            to="/login"
            search={{ redirect: `/p/${ping.id}` } as never}
            className="font-semibold text-foreground underline"
          >
            Sign in
          </Link>{" "}
          to reply, like or reping replies. Anyone can read the conversation.
        </p>
      )}
      <div className="mt-6" aria-live="polite">
        {q.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading replies…
          </p>
        )}
        {q.isError && (
          <div role="alert" className="flex items-center gap-3 text-sm">
            Couldn't load replies.
            <Button size="sm" variant="outline" onClick={() => q.refetch()}>
              <RefreshCw /> Retry
            </Button>
          </div>
        )}
        {q.isSuccess && threads.length === 0 && (
          <p className="py-6 text-center text-muted-foreground">
            No replies yet. {user ? "Start the conversation." : "Be the first once you sign in."}
          </p>
        )}
        <ol className="space-y-5">
          {threads.map((c) => (
            <li key={c.id}>
              <CommentItem node={c} ping={ping} liked={myLikes.data} />
            </li>
          ))}
        </ol>
        {q.hasNextPage && (
          <Button
            variant="outline"
            className="mt-6 w-full"
            disabled={q.isFetchingNextPage}
            onClick={() => q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? "Loading…" : "Load more replies"}
          </Button>
        )}
      </div>
    </section>
  );
}

function CommentForm({
  pingId,
  parentId,
  onDone,
  className,
  autoFocus,
}: {
  pingId: string;
  parentId: string | null;
  onDone?: () => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const parsed = commentSchema.safeParse({ content: text });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid reply");
      if (!user) throw new Error("Please sign in again.");
      const { error } = await supabase.from("comments").insert({
        ping_id: pingId,
        parent_id: parentId,
        user_id: user.id,
        content: parsed.data.content,
      });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      setText("");
      setErr(null);
      await qc.invalidateQueries({ queryKey: threadKey(pingId) });
      await qc.invalidateQueries({ queryKey: ["ping", pingId] });
      toast.success("Reply posted");
      onDone?.();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Couldn't post reply."),
  });
  const id = `reply-${parentId ?? "root"}`;
  return (
    <form
      className={cn("space-y-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Label htmlFor={id} className="sr-only">
        {parentId ? "Write a reply" : "Reply to this Ping"}
      </Label>
      <Textarea
        id={id}
        value={text}
        maxLength={COMMENT_MAX}
        autoFocus={autoFocus}
        rows={parentId ? 2 : 3}
        placeholder={parentId ? "Write a reply…" : "Add to the conversation…"}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={!!err}
        aria-describedby={err ? `${id}-err` : undefined}
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn("text-xs text-muted-foreground", err && "text-destructive")}
          id={err ? `${id}-err` : undefined}
        >
          {err ?? `${text.length}/${COMMENT_MAX}`}
        </span>
        <div className="flex gap-2">
          {onDone && (
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={m.isPending || !text.trim()}>
            {m.isPending ? "Posting…" : "Reply"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function CommentItem({
  node,
  ping,
  liked,
}: {
  node: CommentNode;
  ping: Ping;
  liked?: Set<string> | undefined;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [repingOpen, setRepingOpen] = useState(false);
  const deleted = !!node.deleted_at;
  const name = node.author?.display_name || node.author?.username || "Founder";
  const mine = canModifyComment(node, user?.id);
  const refresh = () => qc.invalidateQueries({ queryKey: threadKey(ping.id) });
  const signIn = () => navigate({ to: "/login", search: { redirect: `/p/${ping.id}` } as never });

  const edit = useMutation({
    mutationFn: async () => {
      const parsed = commentSchema.safeParse({ content: draft });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid reply");
      const { error } = await supabase
        .from("comments")
        .update({ content: parsed.data.content })
        .eq("id", node.id)
        .eq("user_id", user!.id);
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      setEditing(false);
      await refresh();
      toast.success("Reply updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("comments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", node.id)
        .eq("user_id", user!.id);
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ["ping", ping.id] });
      toast.success("Reply deleted");
    },
    onError: () => toast.error("Couldn't delete. Please try again."),
  });
  const isLiked = liked?.has(node.id) ?? false;
  const like = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in");
      const { error } = isLiked
        ? await supabase
            .from("comment_likes")
            .delete()
            .eq("comment_id", node.id)
            .eq("user_id", user.id)
        : await supabase.from("comment_likes").insert({ comment_id: node.id, user_id: user.id });
      if (error && error.code !== "23505") throw error;
    },
    onSettled: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ["my-comment-likes"] });
    },
    onError: () => toast.error("Couldn't update like."),
  });

  return (
    <article
      id={`comment-${node.id}`}
      className={cn("scroll-mt-24", node.depth > 0 && "border-l-2 border-border pl-3 sm:pl-5")}
    >
      {deleted ? (
        <p className="py-2 text-sm italic text-muted-foreground">This reply was deleted.</p>
      ) : (
        <>
          <header className="flex items-center gap-2">
            <FounderAvatar name={name} src={node.author?.avatar_url ?? null} size="sm" />
            <span className="min-w-0 text-sm">
              {node.author ? (
                <Link
                  to="/@{$username}"
                  params={{ username: node.author.username }}
                  className="font-semibold hover:underline"
                >
                  {name}
                </Link>
              ) : (
                <span className="font-semibold">{name}</span>
              )}
              <span className="text-muted-foreground">
                {" "}
                ·{" "}
                <time dateTime={node.created_at}>
                  {formatDistanceToNowStrict(new Date(node.created_at))} ago
                </time>
                {new Date(node.updated_at).getTime() - new Date(node.created_at).getTime() > 5000 &&
                  " · edited"}
              </span>
            </span>
          </header>
          {editing ? (
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                edit.mutate();
              }}
            >
              <Label htmlFor={`edit-${node.id}`} className="sr-only">
                Edit reply
              </Label>
              <Textarea
                id={`edit-${node.id}`}
                value={draft}
                maxLength={COMMENT_MAX}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(node.content);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={edit.isPending || !draft.trim()}>
                  {edit.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-relaxed">
              {node.content}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-0.5 text-muted-foreground">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={isLiked}
              aria-label={`${isLiked ? "Unlike" : "Like"} reply, ${commentLikeCount(node)} likes`}
              disabled={like.isPending}
              onClick={() => (user ? like.mutate() : signIn())}
            >
              <Heart className={cn(isLiked && "fill-blush text-blush")} /> {commentLikeCount(node)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={replying}
              onClick={() => (user ? setReplying((v) => !v) : signIn())}
            >
              <MessageCircle /> Reply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (user ? setRepingOpen(true) : signIn())}
            >
              <Repeat2 /> Reping
            </Button>
            {mine && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(node.content);
                    setEditing(true);
                  }}
                >
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete
                </Button>
              </>
            )}
            {user && !mine && (
              <Button size="sm" variant="ghost" onClick={() => setReportOpen(true)}>
                <Flag /> Report
              </Button>
            )}
          </div>
          {replying && (
            <CommentForm
              pingId={ping.id}
              parentId={node.id}
              autoFocus
              className="mt-2"
              onDone={() => setReplying(false)}
            />
          )}
          {node.depth >= COMMENT_MAX_DEPTH && replying && (
            <p className="text-xs text-muted-foreground">
              Replies at this depth continue in the same thread.
            </p>
          )}
        </>
      )}
      {node.replies.length > 0 && (
        <ol className="mt-3 space-y-4">
          {node.replies.map((r) => (
            <li key={r.id}>
              <CommentItem node={r} ping={ping} liked={liked} />
            </li>
          ))}
        </ol>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reply?</AlertDialogTitle>
            <AlertDialogDescription>
              The text is removed permanently. Replies from others stay in the thread.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reportOpen && (
        <ReportCommentDialog commentId={node.id} onClose={() => setReportOpen(false)} />
      )}
      {repingOpen && <RepingDialog node={node} ping={ping} onClose={() => setRepingOpen(false)} />}
    </article>
  );
}

function ReportCommentDialog({ commentId, onClose }: { commentId: string; onClose: () => void }) {
  const { user } = useAuth();
  const [reason, setReason] = useState<
    "Spam" | "Harassment" | "Hate or abuse" | "Misleading" | "Other"
  >("Spam");
  const [details, setDetails] = useState("");
  const [done, setDone] = useState(false);
  const m = useMutation({
    mutationFn: async () => {
      const parsed = commentReportSchema.parse({ reason, details });
      const { error } = await supabase.from("comment_reports").insert({
        comment_id: commentId,
        reporter_id: user!.id,
        reason: parsed.reason,
        details: parsed.details || null,
      });
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: () => setDone(true),
    onError: () => toast.error("Couldn't send report. Please try again."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {done ? (
          <div className="text-center">
            <Check className="mx-auto size-8" />
            <DialogTitle className="mt-3">Thanks for reporting</DialogTitle>
            <DialogDescription className="mt-2">
              Your report was received and will be reviewed.
            </DialogDescription>
            <Button className="mt-6" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">Report this reply</DialogTitle>
              <DialogDescription>
                Reports are private. The author won't see who reported.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Reason</legend>
              {commentReportSchema.shape.reason.options.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="comment-report"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />{" "}
                  {r}
                </label>
              ))}
            </fieldset>
            <Label htmlFor="comment-report-details">Details (optional)</Label>
            <Textarea
              id="comment-report-details"
              maxLength={500}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={m.isPending} onClick={() => m.mutate()}>
                {m.isPending ? "Sending…" : "Send report"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RepingDialog({
  node,
  ping,
  onClose,
}: {
  node: CommentNode;
  ping: Ping;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const name = node.author?.display_name || node.author?.username || "Founder";
  const m = useMutation({
    mutationFn: async () => {
      const parsed = pingSchema.safeParse({ category: ping.category, content: text });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Add your thoughts");
      const { data, error } = await supabase
        .from("pings")
        .insert({
          user_id: user!.id,
          category: parsed.data.category,
          content: parsed.data.content,
          source_comment_id: node.id,
        })
        .select("id")
        .single();
      if (error) throw new Error(friendlyError(error));
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("Reping published");
      onClose();
      navigate({ to: "/p/$id", params: { id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reping."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Reping this reply</DialogTitle>
          <DialogDescription>
            Your new Ping credits {name} and links back to this conversation.
          </DialogDescription>
        </DialogHeader>
        <blockquote className="rounded-2xl border border-border bg-secondary/50 p-3 text-sm">
          <p className="line-clamp-4 whitespace-pre-line break-words">{node.content}</p>
          <footer className="mt-1 text-xs text-muted-foreground">
            — {name}
            {node.author ? ` (@${node.author.username})` : ""}
          </footer>
        </blockquote>
        <Label htmlFor={`reping-${node.id}`}>Your thoughts</Label>
        <Textarea
          id={`reping-${node.id}`}
          maxLength={PING_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Why does this reply matter?"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending || !text.trim()} onClick={() => m.mutate()}>
            {m.isPending ? "Publishing…" : "Publish Reping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RepingAttribution({ ping }: { ping: Ping }) {
  return <RepingAttributionInner ping={ping} />;
}
function RepingAttributionInner({ ping }: { ping: Ping }) {
  const a = repingAttribution({
    source_ping_id: ping.source_ping_id ?? null,
    source_comment_id: ping.source_comment_id ?? null,
    source_comment: ping.source_comment ?? null,
  });
  if (!a) return null;
  if (!a.available)
    return (
      <p className="relative z-10 mt-3 rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">
        Reping of a reply that's no longer available.
      </p>
    );
  return (
    <Link
      to="/p/$id"
      params={{ id: a.pingId }}
      hash={`comment-${a.commentId}`}
      className="relative z-10 mt-3 block rounded-2xl border border-border bg-secondary/50 p-3 text-sm hover:border-primary"
    >
      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <Repeat2 className="size-3.5" /> Reping of a reply by {a.name}
        {a.username ? ` @${a.username}` : ""}
      </span>
      <span className="mt-1 line-clamp-3 block whitespace-pre-line break-words">{a.content}</span>
      <span className="mt-1 block text-xs text-muted-foreground underline">
        View original conversation
      </span>
    </Link>
  );
}
