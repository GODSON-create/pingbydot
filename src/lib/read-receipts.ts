import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReadReceiptStatus = "unread" | "read" | "active";

export interface MessageReader {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  read_at: string;
}

export interface MessageReadSummary {
  message_id: string;
  total_recipients: number;
  read_count: number;
  readers: MessageReader[];
}

export function readSummaryQuery(messageId: string | undefined) {
  return {
    queryKey: ["read-summary", messageId],
    enabled: Boolean(messageId),
    queryFn: async (): Promise<MessageReadSummary | null> => {
      if (!messageId) return null;

      const { data, error } = await (supabase.rpc as any)("get_message_read_summary", {
        _message_id: messageId,
      });

      if (error) {
        console.warn("Failed to fetch read summary:", error);
        return null;
      }

      return data as MessageReadSummary;
    },
  };
}

export function useMessageReadSummary(messageId: string | undefined) {
  return useQuery(readSummaryQuery(messageId));
}

export function useMarkMessagesRead(hubId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (messageIds: string[]) => {
      if (!hubId || messageIds.length === 0) return;

      const { error } = await (supabase.rpc as any)("mark_hub_messages_read", {
        _hub_id: hubId,
        _message_ids: messageIds,
      });

      if (error) {
        console.warn("Failed to mark messages read:", error);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["read-summary"] });
      qc.invalidateQueries({ queryKey: ["hub-messages", hubId] });
    },
  });
}
