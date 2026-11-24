import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserPrivacy } from "@/lib/privacy";
import type { Profile } from "@/lib/pings";

export type MessageMediaType = "image" | "video" | "audio" | "document";
export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface PrivateMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  media_url: string | null;
  media_type: MessageMediaType | null;
  status: MessageStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  reply_to_id?: string | null;
  forwarded_from_id?: string | null;
  is_pinned?: boolean;
  edited_at?: string | null;
  retention_policy?: string | null;
  expires_at?: string | null;
  first_viewed_at?: string | null;
  expired_at?: string | null;
  is_saved_in_chat?: boolean;
  media_size_bytes?: number;
  is_system?: boolean;
  sender?: Profile;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  role: "owner" | "member" | "admin";
  joined_at: string;
  last_read_at: string;
  is_muted: boolean;
  is_archived: boolean;
  hidden_at: string | null;
  profile?: Profile;
}

export type ConversationRequestStatus = "accepted" | "pending" | "declined";

export interface Conversation {
  id: string;
  type: "direct" | "group";
  title?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  only_admins_can_post?: boolean;
  request_status?: ConversationRequestStatus;
  requested_by?: string | null;
  request_recipient_id?: string | null;
  request_responded_at?: string | null;
  retention_policy?: "24h_after_view" | "7d" | "30d" | "1y" | "until_deleted";
  retention_updated_at?: string | null;
  created_by: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
  other_member?: Profile | undefined;
  my_membership?: ConversationMember | undefined;
  unread_count: number;
}

function isMissingRpcError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST202" ||
    err.code === "42883" ||
    Boolean(err.message?.toLowerCase().includes("does not exist"))
  );
}

/**
 * Fetch all active conversations for the current user (single-query RPC with batched fallback).
 */
export function userConversationsQuery(currentUserId?: string, limit = 50, offset = 0) {
  return {
    queryKey: ["user-conversations", currentUserId, limit, offset],
    enabled: Boolean(currentUserId),
    queryFn: async (): Promise<Conversation[]> => {
      if (!currentUserId) return [];

      // Fast path: single indexed Postgres RPC (eliminates N+1 unread queries at scale)
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_my_conversations_summary",
        { _limit: limit, _offset: offset },
      );

      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData as unknown as Conversation[];
      }

      if (rpcError && !isMissingRpcError(rpcError)) {
        throw rpcError;
      }

      // Batched fallback when migration 0022 RPC is not yet deployed
      const { data: myMemberships, error: memError } = await supabase
        .from("conversation_members")
        .select(
          `
          conversation_id, user_id, role, joined_at, last_read_at, is_muted, is_archived, hidden_at,
          conversation:conversations!conversation_members_conversation_id_fkey(
            id, type, created_by, last_message_at, last_message_preview, created_at, updated_at
          )
        `,
        )
        .eq("user_id", currentUserId)
        .is("hidden_at", null)
        .order("joined_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (memError) {
        throw memError;
      }

      if (!myMemberships || myMemberships.length === 0) return [];

      const conversationIds = myMemberships.map((m) => m.conversation_id);

      const { data: allMembers, error: membersError } = await supabase
        .from("conversation_members")
        .select(
          `
          conversation_id, user_id, role,
          profile:profiles!conversation_members_user_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .in("conversation_id", conversationIds);

      if (membersError) {
        throw membersError;
      }

      // Compute unread counts with 1 bounded query instead of N per-conversation queries
      const unreadMap = new Map<string, number>();
      const minLastReadAt = myMemberships.reduce(
        (min, m) => {
          if (!min) return m.last_read_at;
          return new Date(m.last_read_at) < new Date(min) ? m.last_read_at : min;
        },
        myMemberships[0]?.last_read_at ?? new Date(0).toISOString(),
      );

      const { data: recentIncoming } = await supabase
        .from("private_messages")
        .select("conversation_id, created_at")
        .in("conversation_id", conversationIds)
        .neq("sender_id", currentUserId)
        .gt("created_at", minLastReadAt)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1000);

      const lastReadByConv = new Map(myMemberships.map((m) => [m.conversation_id, m.last_read_at]));
      for (const msg of recentIncoming ?? []) {
        const threshold = lastReadByConv.get(msg.conversation_id);
        if (threshold && new Date(msg.created_at) > new Date(threshold)) {
          unreadMap.set(msg.conversation_id, (unreadMap.get(msg.conversation_id) ?? 0) + 1);
        }
      }

      const conversations: Conversation[] = [];

      for (const m of myMemberships) {
        if (!m.conversation) continue;
        const conv = m.conversation as unknown as {
          id: string;
          type: "direct" | "group";
          created_by: string | null;
          last_message_at: string;
          last_message_preview: string | null;
          created_at: string;
          updated_at: string;
        };

        const otherMemberRow = (allMembers || []).find(
          (other) => other.conversation_id === conv.id && other.user_id !== currentUserId,
        );

        conversations.push({
          id: conv.id,
          type: conv.type,
          created_by: conv.created_by,
          last_message_at: conv.last_message_at,
          last_message_preview: conv.last_message_preview,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          my_membership: m as unknown as ConversationMember,
          other_member: otherMemberRow?.profile as unknown as Profile | undefined,
          unread_count: unreadMap.get(conv.id) ?? 0,
        });
      }

      conversations.sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
      );

      return conversations;
    },
  };
}

/**
 * Fetch a single conversation by ID so deep-links (?conversationId= or ?userId=) never flash empty
 * while paginated lists are loading or when the conversation is older than the first 50 rows.
 */
export function conversationByIdQuery(conversationId?: string, currentUserId?: string) {
  return {
    queryKey: ["conversation-by-id", conversationId, currentUserId],
    enabled: Boolean(conversationId && currentUserId),
    queryFn: async (): Promise<Conversation | null> => {
      if (!conversationId || !currentUserId) return null;

      let { data: myMember, error: memError } = await (supabase as any)
        .from("conversation_members")
        .select(
          `
          conversation_id, user_id, role, joined_at, last_read_at, is_muted, is_archived, hidden_at,
          conversation:conversations!conversation_members_conversation_id_fkey(
            id, type, title, description, avatar_url, only_admins_can_post,
            request_status, requested_by, request_recipient_id, request_responded_at,
            created_by, last_message_at, last_message_preview, created_at, updated_at
          )
        `,
        )
        .eq("conversation_id", conversationId)
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (
        memError &&
        (memError.code === "PGRST204" ||
          memError.code === "42703" ||
          String(memError.message ?? "")
            .toLowerCase()
            .includes("column"))
      ) {
        const legacy = await supabase
          .from("conversation_members")
          .select(
            `
            conversation_id, user_id, role, joined_at, last_read_at, is_muted, is_archived, hidden_at,
            conversation:conversations!conversation_members_conversation_id_fkey(
              id, type, created_by, last_message_at, last_message_preview, created_at, updated_at
            )
          `,
          )
          .eq("conversation_id", conversationId)
          .eq("user_id", currentUserId)
          .maybeSingle();
        myMember = legacy.data;
        memError = legacy.error;
      }

      if (memError) throw memError;
      if (!myMember || !myMember.conversation) return null;

      const { data: members, error: otherErr } = await supabase
        .from("conversation_members")
        .select(
          `
          conversation_id, user_id, role,
          profile:profiles!conversation_members_user_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("conversation_id", conversationId)
        .neq("user_id", currentUserId);

      if (otherErr) throw otherErr;

      const conv = myMember.conversation as unknown as {
        id: string;
        type: "direct" | "group";
        title?: string | null;
        description?: string | null;
        avatar_url?: string | null;
        only_admins_can_post?: boolean;
        request_status?: ConversationRequestStatus;
        requested_by?: string | null;
        request_recipient_id?: string | null;
        request_responded_at?: string | null;
        created_by: string | null;
        last_message_at: string;
        last_message_preview: string | null;
        created_at: string;
        updated_at: string;
      };
      const otherMemberRow = members?.[0];

      return {
        id: conv.id,
        type: conv.type,
        title: conv.title ?? null,
        description: conv.description ?? null,
        avatar_url: conv.avatar_url ?? null,
        only_admins_can_post: Boolean(conv.only_admins_can_post),
        request_status: conv.request_status ?? "accepted",
        requested_by: conv.requested_by ?? null,
        request_recipient_id: conv.request_recipient_id ?? null,
        request_responded_at: conv.request_responded_at ?? null,
        created_by: conv.created_by,
        last_message_at: conv.last_message_at,
        last_message_preview: conv.last_message_preview,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        my_membership: myMember as unknown as ConversationMember,
        other_member: otherMemberRow?.profile as unknown as Profile | undefined,
        unread_count: 0,
      };
    },
  };
}

/**
 * Fetch recent messages in an active conversation (bounded DESC query reversed chronologically).
 */
export function conversationMessagesQuery(
  conversationId?: string,
  currentUserId?: string,
  limit = 80,
) {
  return {
    queryKey: ["conversation-messages", conversationId, currentUserId, limit],
    enabled: Boolean(conversationId && currentUserId),
    queryFn: async (): Promise<PrivateMessage[]> => {
      if (!conversationId || !currentUserId) return [];

      let { data, error } = await (supabase as any)
        .from("private_messages")
        .select(
          `
          id, conversation_id, sender_id, content, media_url, media_type, status, deleted_at, created_at, updated_at,
          reply_to_id, forwarded_from_id, is_pinned, edited_at,
          retention_policy, expires_at, first_viewed_at, expired_at, is_saved_in_chat, media_size_bytes, is_system,
          sender:profiles!private_messages_sender_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (
        error &&
        (error.code === "PGRST204" ||
          error.code === "42703" ||
          String(error.message ?? "")
            .toLowerCase()
            .includes("column"))
      ) {
        const fallback = await supabase
          .from("private_messages")
          .select(
            `
            id, conversation_id, sender_id, content, media_url, media_type, status, deleted_at, created_at, updated_at,
            sender:profiles!private_messages_sender_id_fkey(id, username, display_name, avatar_url, bio, created_at)
          `,
          )
          .eq("conversation_id", conversationId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(limit);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        throw error;
      }

      return ((data || []) as any[])
        .map((msg) => ({
          ...msg,
          media_type: msg.media_type as MessageMediaType | null,
          status: msg.status as MessageStatus,
          sender: msg.sender as unknown as Profile,
        }))
        .reverse();
    },
  };
}

/**
 * Mutation: Get or Create Direct (1-to-1) Conversation with a specific user.
 */
export function useGetOrCreateDirectConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
        p_target_user_id: targetUserId,
      });

      if (error) throw error;
      return data as string; // conversation_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({ queryKey: ["blocked-users"] });
    },
  });
}

/**
 * Mutation: Send a Private Message.
 */
export function useSendPrivateMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      content,
      mediaUrl,
      mediaType,
    }: {
      conversationId: string;
      content: string;
      mediaUrl?: string | null;
      mediaType?: MessageMediaType | null;
    }) => {
      const { data, error } = await supabase.rpc("send_private_message", {
        p_conversation_id: conversationId,
        p_content: content.trim(),
        p_media_url: mediaUrl || null,
        p_media_type: mediaType || null,
      });

      if (error) throw error;
      return data as unknown as PrivateMessage;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({
        queryKey: ["conversation-messages", variables.conversationId],
      });
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
    },
  });
}

/**
 * Mutation: Mark conversation as read (optimistically zeroes unread badge and refreshes cleanly).
 */
export function useMarkConversationRead() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc("mark_conversation_read", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
    },
    onMutate: async (conversationId: string) => {
      await qc.cancelQueries({ queryKey: ["user-conversations"] });
      const previousLists = qc.getQueriesData<Conversation[]>({
        queryKey: ["user-conversations"],
      });
      qc.setQueriesData<Conversation[]>({ queryKey: ["user-conversations"] }, (old) =>
        old?.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)),
      );
      return { previousLists };
    },
    onError: (_err, _conversationId, context) => {
      if (context?.previousLists) {
        for (const [key, data] of context.previousLists) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _err, conversationId) => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({
        queryKey: ["conversation-messages", conversationId],
      });
    },
  });
}

/**
 * Mutation: Hide or delete conversation (individual user retention model).
 */
export function useHideConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc("hide_or_delete_conversation", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({ queryKey: ["blocked-users"] });
    },
  });
}

/**
 * Mutation: Block User.
 */
export function useBlockUser() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.rpc("block_user", {
        p_target_id: targetUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({ queryKey: ["blocked-users"] });
    },
  });
}

/**
 * Mutation: Soft delete (unsend) own private message.
 */
export function useDeletePrivateMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      conversationId,
    }: {
      messageId: string;
      conversationId: string;
    }) => {
      const { error } = await supabase
        .from("private_messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", messageId);
      if (error) throw error;
      return conversationId;
    },
    onSuccess: (conversationId) => {
      qc.invalidateQueries({ queryKey: ["conversation-messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
    },
  });
}

/**
 * Fetch blocked users list for current user.
 */
export function blockedUsersQuery(currentUserId?: string) {
  return {
    queryKey: ["blocked-users", currentUserId],
    enabled: Boolean(currentUserId),
    queryFn: async (): Promise<
      Array<{ blocked_id: string; created_at: string; profile?: Profile }>
    > => {
      if (!currentUserId) return [];
      const { data, error } = await supabase
        .from("user_blocks")
        .select(
          `
          blocked_id, created_at,
          profile:profiles!user_blocks_blocked_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("blocker_id", currentUserId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!data) return [];
      return data as unknown as Array<{
        blocked_id: string;
        created_at: string;
        profile?: Profile;
      }>;
    },
  };
}

/**
 * Mutation: Unblock User.
 */
export function useUnblockUser() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.rpc("unblock_user", {
        p_target_id: targetUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({ queryKey: ["blocked-users"] });
    },
  });
}

/**
 * Real-time message listener for active conversation (INSERT + UPDATE for read receipts & deletes).
 */
export function useConversationRealtime(
  conversationId: string | undefined,
  onNewMessage?: (msg: PrivateMessage) => void,
) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`direct_messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "private_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new as unknown as PrivateMessage;
            onNewMessage?.(newMsg);
          }
          qc.invalidateQueries({
            queryKey: ["conversation-messages", conversationId],
          });
          qc.invalidateQueries({ queryKey: ["user-conversations"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc, onNewMessage]);
}

/**
 * Global inbox realtime subscription keeping unread counts synced across header, sidebar & lists.
 */
export function useInboxRealtime(currentUserId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`dm_inbox:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "private_messages",
        },
        () => {
          qc.invalidateQueries({ queryKey: ["user-conversations"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["user-conversations"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, qc]);
}

/**
 * Real-time presence & typing indicator for 1-to-1 conversation (privacy-aware).
 */
export function useConversationPresence(
  conversationId: string | undefined,
  currentUserId: string | undefined,
  otherUserId: string | undefined,
) {
  const { preferences } = useUserPrivacy(currentUserId);
  const [otherOnline, setOtherOnline] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canBroadcast = Boolean(currentUserId && preferences.active_presence_enabled);

  useEffect(() => {
    if (!conversationId || !currentUserId || !otherUserId) {
      setOtherOnline(false);
      setOtherTyping(false);
      return;
    }

    const channel = supabase.channel(`dm-presence:${conversationId}`, {
      config: { presence: { key: currentUserId } },
    });
    channelRef.current = channel;

    const syncState = () => {
      const state = channel.presenceState() as Record<
        string,
        Array<{ user_id?: string; typing?: boolean }>
      >;
      const otherPresences = state[otherUserId] ?? [];
      setOtherOnline(otherPresences.length > 0);
      setOtherTyping(otherPresences.some((p) => p.typing === true));
    };

    channel
      .on("presence", { event: "sync" }, syncState)
      .on("presence", { event: "join" }, syncState)
      .on("presence", { event: "leave" }, syncState)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && canBroadcast) {
          try {
            await channel.track({ user_id: currentUserId, typing: false });
          } catch {
            // ignore transient presence errors
          }
        }
      });

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId, otherUserId, canBroadcast]);

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!canBroadcast || !channelRef.current || !currentUserId) return;
      void channelRef.current.track({ user_id: currentUserId, typing: isTyping });
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (isTyping) {
        typingTimerRef.current = setTimeout(() => {
          void channelRef.current?.track({ user_id: currentUserId, typing: false });
        }, 2500);
      }
    },
    [canBroadcast, currentUserId],
  );

  return { otherOnline, otherTyping, notifyTyping };
}

/* -------------------------------------------------------------------------- */
/*     PHASE 2.5 & 2.6: EDIT, PIN, REACT, SAVE, MUTE/ARCHIVE, GROUP CHATS     */
/* -------------------------------------------------------------------------- */

function isMissingPhase2Messaging(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST202" ||
    e.code === "PGRST205" ||
    e.code === "42883" ||
    e.code === "42P01" ||
    e.code === "42703" ||
    e.status === 404 ||
    msg.includes("does not exist") ||
    msg.includes("could not find the")
  );
}

const LOCAL_SAVED_MSGS_PREFIX = "ping:saved-messages:";
const LOCAL_MSG_REACTIONS_PREFIX = "ping:msg-reactions:";

export function conversationMembersQuery(conversationId?: string) {
  return {
    queryKey: ["conversation-members", conversationId],
    enabled: Boolean(conversationId),
    queryFn: async (): Promise<ConversationMember[]> => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("conversation_members")
        .select(
          `
          conversation_id, user_id, role, joined_at, last_read_at, is_muted, is_archived, hidden_at,
          profile:profiles!conversation_members_user_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("conversation_id", conversationId)
        .is("hidden_at", null);
      if (error) throw error;
      return ((data ?? []) as any[]).map((row) => ({
        ...row,
        profile: row.profile as Profile | undefined,
      }));
    },
  };
}

export function useEditPrivateMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      const trimmed = content.trim();
      if (!trimmed) throw new Error("Message cannot be empty.");
      const { error } = await (supabase as any).rpc("edit_private_message", {
        p_message_id: messageId,
        p_content: trimmed,
      });
      if (error) {
        if (!isMissingPhase2Messaging(error)) throw error;
        const { error: directErr } = await supabase
          .from("private_messages")
          .update({ content: trimmed, updated_at: new Date().toISOString() })
          .eq("id", messageId);
        if (directErr) throw directErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
    },
  });
}

export function useTogglePinPrivateMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await (supabase as any).rpc("toggle_pin_private_message", {
        p_message_id: messageId,
      });
      if (error) {
        if (isMissingPhase2Messaging(error)) {
          throw new Error("Message pinning requires database migration 0029.");
        }
        throw error;
      }
      return data as { message_id: string; is_pinned: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-messages", conversationId] });
    },
  });
}

export function conversationReactionsQuery(conversationId?: string, messageIds: string[] = []) {
  return {
    queryKey: ["conversation-message-reactions", conversationId, messageIds.join(",")],
    enabled: Boolean(conversationId && messageIds.length > 0),
    queryFn: async (): Promise<Record<string, Array<{ emoji: string; user_id: string }>>> => {
      if (!conversationId || messageIds.length === 0) return {};
      const { data, error } = await (supabase as any)
        .from("private_message_reactions")
        .select("message_id, emoji, user_id")
        .in("message_id", messageIds);

      if (error) {
        if (!isMissingPhase2Messaging(error)) throw error;
        if (typeof window === "undefined") return {};
        try {
          const raw = window.localStorage.getItem(`${LOCAL_MSG_REACTIONS_PREFIX}${conversationId}`);
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      }

      const map: Record<string, Array<{ emoji: string; user_id: string }>> = {};
      for (const row of (data ?? []) as Array<{
        message_id: string;
        emoji: string;
        user_id: string;
      }>) {
        (map[row.message_id] ??= []).push({ emoji: row.emoji, user_id: row.user_id });
      }
      return map;
    },
  };
}

export function useToggleMessageReaction(conversationId: string, userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      if (!userId) throw new Error("Sign in to react.");
      const { error } = await (supabase as any).rpc("toggle_private_message_reaction", {
        p_message_id: messageId,
        p_emoji: emoji,
      });
      if (error) {
        if (!isMissingPhase2Messaging(error)) throw error;
        if (typeof window !== "undefined") {
          const key = `${LOCAL_MSG_REACTIONS_PREFIX}${conversationId}`;
          const curr: Record<string, Array<{ emoji: string; user_id: string }>> = (() => {
            try {
              const raw = window.localStorage.getItem(key);
              return raw ? JSON.parse(raw) : {};
            } catch {
              return {};
            }
          })();
          const list = curr[messageId] ?? [];
          const exists = list.some((r) => r.emoji === emoji && r.user_id === userId);
          curr[messageId] = exists
            ? list.filter((r) => !(r.emoji === emoji && r.user_id === userId))
            : [...list, { emoji, user_id: userId }];
          window.localStorage.setItem(key, JSON.stringify(curr));
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-message-reactions", conversationId] });
    },
  });
}

export function savedMessagesQuery(userId?: string) {
  return {
    queryKey: ["saved-messages", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Set<string>> => {
      if (!userId) return new Set();
      const { data, error } = await (supabase as any)
        .from("saved_messages")
        .select("message_id")
        .eq("user_id", userId);
      if (error) {
        if (!isMissingPhase2Messaging(error)) throw error;
        if (typeof window === "undefined") return new Set();
        try {
          const raw = window.localStorage.getItem(`${LOCAL_SAVED_MSGS_PREFIX}${userId}`);
          return new Set(raw ? (JSON.parse(raw) as string[]) : []);
        } catch {
          return new Set();
        }
      }
      return new Set(((data ?? []) as Array<{ message_id: string }>).map((r) => r.message_id));
    },
  };
}

export function useToggleSaveMessage(userId?: string, conversationId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      currentlySaved,
    }: {
      messageId: string;
      currentlySaved: boolean;
    }) => {
      if (!userId) throw new Error("Sign in to save messages.");
      const nextSaved = !currentlySaved;

      // Primary authoritative RPC (enforces membership, quota, expiry survival/restoration)
      const { data: rpcData, error: rpcErr } = await (supabase as any).rpc(
        "toggle_save_private_message",
        {
          p_message_id: messageId,
          p_save: nextSaved,
        },
      );

      if (!rpcErr) {
        return Boolean((rpcData as { saved?: boolean } | null)?.saved ?? nextSaved);
      }

      if (!isMissingRpcError(rpcErr)) {
        throw rpcErr;
      }

      // Legacy fallback before migration 0039 is deployed remotely
      if (currentlySaved) {
        const { error } = await (supabase as any)
          .from("saved_messages")
          .delete()
          .eq("user_id", userId)
          .eq("message_id", messageId);
        if (error) {
          if (!isMissingPhase2Messaging(error)) throw error;
          if (typeof window !== "undefined") {
            const key = `${LOCAL_SAVED_MSGS_PREFIX}${userId}`;
            const curr: string[] = JSON.parse(window.localStorage.getItem(key) || "[]");
            window.localStorage.setItem(key, JSON.stringify(curr.filter((id) => id !== messageId)));
          }
        }
        return false;
      }
      const { error } = await (supabase as any)
        .from("saved_messages")
        .insert({ user_id: userId, message_id: messageId });
      if (error && error.code !== "23505") {
        if (!isMissingPhase2Messaging(error)) throw error;
        if (typeof window !== "undefined") {
          const key = `${LOCAL_SAVED_MSGS_PREFIX}${userId}`;
          const curr = new Set<string>(JSON.parse(window.localStorage.getItem(key) || "[]"));
          curr.add(messageId);
          window.localStorage.setItem(key, JSON.stringify(Array.from(curr)));
        }
      }
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-messages", userId] });
      qc.invalidateQueries({ queryKey: ["chat-retention-entitlement", userId] });
      if (conversationId) {
        qc.invalidateQueries({ queryKey: ["conversation-messages", conversationId] });
      }
    },
  });
}

export function useUpdateConversationPrefs(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      isMuted,
      isArchived,
    }: {
      conversationId: string;
      isMuted?: boolean;
      isArchived?: boolean;
    }) => {
      if (!userId) throw new Error("Sign in first.");
      const { error } = await (supabase as any).rpc("update_conversation_member_prefs", {
        p_conversation_id: conversationId,
        p_is_muted: isMuted ?? null,
        p_is_archived: isArchived ?? null,
      });
      if (error) {
        if (!isMissingPhase2Messaging(error)) throw error;
        const patch: { is_muted?: boolean; is_archived?: boolean } = {};
        if (typeof isMuted === "boolean") patch.is_muted = isMuted;
        if (typeof isArchived === "boolean") patch.is_archived = isArchived;
        const { error: updErr } = await supabase
          .from("conversation_members")
          .update(patch)
          .eq("conversation_id", conversationId)
          .eq("user_id", userId);
        if (updErr) throw updErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
    },
  });
}

export function useCreateGroupConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      title,
      description,
      memberIds,
      onlyAdminsCanPost,
    }: {
      title: string;
      description?: string;
      memberIds: string[];
      onlyAdminsCanPost?: boolean;
    }): Promise<string> => {
      const { data, error } = await (supabase as any).rpc("create_group_conversation", {
        p_title: title.trim(),
        p_description: (description ?? "").trim(),
        p_member_ids: memberIds,
        p_only_admins_can_post: Boolean(onlyAdminsCanPost),
      });
      if (error) {
        if (isMissingPhase2Messaging(error)) {
          throw new Error("Group conversations require database migration 0029.");
        }
        throw error;
      }
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
    },
  });
}

export function useAddGroupMember(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await (supabase as any).rpc("add_group_member", {
        p_conversation_id: conversationId,
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-members", conversationId] });
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
    },
  });
}

export function useRemoveGroupMember(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await (supabase as any).rpc("remove_group_member", {
        p_conversation_id: conversationId,
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation-members", conversationId] });
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
    },
  });
}

export function useAcceptMessageRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await (supabase as any).rpc("accept_message_request", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      return data as { conversation_id: string; request_status: "accepted" };
    },
    onSuccess: (_data, conversationId) => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-by-id", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversation-messages", conversationId] });
    },
  });
}

export function useDeclineMessageRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await (supabase as any).rpc("decline_message_request", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      return data as { conversation_id: string; request_status: "declined" };
    },
    onSuccess: (_data, conversationId) => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-by-id", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversation-messages", conversationId] });
    },
  });
}
