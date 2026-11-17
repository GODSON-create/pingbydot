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
  sender?: Profile;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  role: "member" | "admin";
  joined_at: string;
  last_read_at: string;
  is_muted: boolean;
  is_archived: boolean;
  hidden_at: string | null;
  profile?: Profile;
}

export interface Conversation {
  id: string;
  type: "direct" | "group";
  created_by: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
  other_member?: Profile | undefined;
  my_membership?: ConversationMember | undefined;
  unread_count: number;
}

/**
 * Fetch all active conversations for the current user.
 */
export function userConversationsQuery(currentUserId?: string) {
  return {
    queryKey: ["user-conversations", currentUserId],
    enabled: Boolean(currentUserId),
    queryFn: async (): Promise<Conversation[]> => {
      if (!currentUserId) return [];

      // Fetch user's conversation memberships
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
        .is("hidden_at", null);

      if (memError) {
        console.warn("Failed to fetch conversation memberships:", memError);
        return [];
      }

      if (!myMemberships || myMemberships.length === 0) return [];

      const conversationIds = myMemberships.map((m) => m.conversation_id);

      // Fetch other members for these direct conversations
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
        console.warn("Failed to fetch other conversation members:", membersError);
      }

      // Compute unread counts per conversation
      const unreadMap = new Map<string, number>();
      await Promise.all(
        myMemberships.map(async (m) => {
          const { count } = await supabase
            .from("private_messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", m.conversation_id)
            .neq("sender_id", currentUserId)
            .gt("created_at", m.last_read_at)
            .is("deleted_at", null);

          unreadMap.set(m.conversation_id, count ?? 0);
        }),
      );

      // Map to full Conversation objects
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

      // Sort by newest activity first
      conversations.sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
      );

      return conversations;
    },
  };
}

/**
 * Fetch messages in an active conversation.
 */
export function conversationMessagesQuery(conversationId?: string, currentUserId?: string) {
  return {
    queryKey: ["conversation-messages", conversationId, currentUserId],
    enabled: Boolean(conversationId && currentUserId),
    queryFn: async (): Promise<PrivateMessage[]> => {
      if (!conversationId || !currentUserId) return [];

      const { data, error } = await supabase
        .from("private_messages")
        .select(
          `
          id, conversation_id, sender_id, content, media_url, media_type, status, deleted_at, created_at, updated_at,
          sender:profiles!private_messages_sender_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (error) {
        console.warn("Failed to load conversation messages:", error);
        return [];
      }

      return (data || []).map((msg) => ({
        ...msg,
        media_type: msg.media_type as MessageMediaType | null,
        status: msg.status as MessageStatus,
        sender: msg.sender as unknown as Profile,
      }));
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
 * Mutation: Mark conversation as read.
 */
export function useMarkConversationRead() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc("mark_conversation_read", {
        p_conversation_id: conversationId,
      });
      if (error) console.warn("Failed to mark conversation read:", error);
    },
    onSuccess: (_, conversationId) => {
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

      if (error || !data) return [];
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
