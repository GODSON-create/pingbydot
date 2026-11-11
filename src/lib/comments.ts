import { z } from "zod";

export const COMMENT_MAX = 1000;
export const COMMENT_MAX_DEPTH = 2;
export const COMMENT_PAGE_SIZE = 20;

export const commentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Write a reply first")
    .max(COMMENT_MAX, `Keep replies under ${COMMENT_MAX} characters`),
});

export const commentReportSchema = z.object({
  reason: z.enum(["Spam", "Harassment", "Hate or abuse", "Misleading", "Other"]),
  details: z.string().trim().max(500).default(""),
});

export type CommentAuthor = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

export type CommentRow = {
  id: string;
  ping_id: string;
  user_id: string;
  parent_id: string | null;
  root_id: string | null;
  depth: number;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  author: CommentAuthor | null;
  likes: { count: number }[];
};

export type CommentNode = CommentRow & { replies: CommentNode[] };

/** Depth a new reply will land at: replies to the deepest level stay at that level (flattened). */
export function replyDepth(parentDepth: number) {
  return Math.min(parentDepth + 1, COMMENT_MAX_DEPTH);
}

/** Builds chronological nested threads. Deleted comments without live replies are dropped. */
export function buildThreads(rows: CommentRow[]): CommentNode[] {
  const sorted = [...rows].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const byId = new Map<string, CommentNode>();
  for (const r of sorted) byId.set(r.id, { ...r, replies: [] });
  const roots: CommentNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (node.parent_id && parent) parent.replies.push(node);
    else if (!node.parent_id) roots.push(node);
  }
  const prune = (list: CommentNode[]): CommentNode[] =>
    list
      .map((n) => ({ ...n, replies: prune(n.replies) }))
      .filter((n) => !n.deleted_at || n.replies.length > 0);
  return prune(roots);
}

export const canModifyComment = (
  comment: Pick<CommentRow, "user_id" | "deleted_at">,
  userId: string | undefined,
) => !!userId && comment.user_id === userId && !comment.deleted_at;

export const commentLikeCount = (c: Pick<CommentRow, "likes">) => c.likes?.[0]?.count ?? 0;

export type RepingSource = {
  source_ping_id: string | null;
  source_comment_id: string | null;
  source_comment: {
    id: string;
    ping_id: string;
    content: string;
    deleted_at: string | null;
    author: { username: string; display_name: string } | null;
  } | null;
};

/** Attribution for a Ping created from a reply. Hidden/deleted sources never expose their text. */
export function repingAttribution(p: RepingSource) {
  if (!p.source_comment_id && !p.source_ping_id) return null;
  const c = p.source_comment;
  if (!c || c.deleted_at || !c.content)
    return { available: false as const, pingId: p.source_ping_id };
  return {
    available: true as const,
    pingId: c.ping_id,
    commentId: c.id,
    content: c.content,
    name: c.author?.display_name || c.author?.username || "A founder",
    username: c.author?.username ?? null,
  };
}
