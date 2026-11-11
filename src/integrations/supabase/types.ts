export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      comment_likes: {
        Row: {
          comment_id: string;
          created_at: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comment_reports: {
        Row: {
          comment_id: string;
          created_at: string;
          details: string | null;
          id: string;
          reason: string;
          reporter_id: string;
          resolved_at: string | null;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason: string;
          reporter_id: string;
          resolved_at?: string | null;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          reason?: string;
          reporter_id?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "comment_reports_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          content: string;
          created_at: string;
          deleted_at: string | null;
          depth: number;
          hidden_at: string | null;
          id: string;
          parent_id: string | null;
          ping_id: string;
          root_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          deleted_at?: string | null;
          depth?: number;
          hidden_at?: string | null;
          id?: string;
          parent_id?: string | null;
          ping_id: string;
          root_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          deleted_at?: string | null;
          depth?: number;
          hidden_at?: string | null;
          id?: string;
          parent_id?: string | null;
          ping_id?: string;
          root_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_ping_id_fkey";
            columns: ["ping_id"];
            isOneToOne: false;
            referencedRelation: "pings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      follows: {
        Row: {
          created_at: string;
          follower_id: string;
          following_id: string;
        };
        Insert: {
          created_at?: string;
          follower_id: string;
          following_id: string;
        };
        Update: {
          created_at?: string;
          follower_id?: string;
          following_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_following_id_fkey";
            columns: ["following_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      hub_invites: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string | null;
          hub_id: string;
          id: string;
          max_uses: number | null;
          revoked_at: string | null;
          token: string;
          uses: number;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          expires_at?: string | null;
          hub_id: string;
          id?: string;
          max_uses?: number | null;
          revoked_at?: string | null;
          token?: string;
          uses?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string | null;
          hub_id?: string;
          id?: string;
          max_uses?: number | null;
          revoked_at?: string | null;
          token?: string;
          uses?: number;
        };
        Relationships: [
          {
            foreignKeyName: "hub_invites_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hub_invites_hub_id_fkey";
            columns: ["hub_id"];
            isOneToOne: false;
            referencedRelation: "hubs";
            referencedColumns: ["id"];
          },
        ];
      };
      hub_members: {
        Row: {
          hub_id: string;
          invited_by: string | null;
          joined_at: string;
          role: string;
          status: string;
          user_id: string;
        };
        Insert: {
          hub_id: string;
          invited_by?: string | null;
          joined_at?: string;
          role?: string;
          status?: string;
          user_id: string;
        };
        Update: {
          hub_id?: string;
          invited_by?: string | null;
          joined_at?: string;
          role?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hub_members_hub_id_fkey";
            columns: ["hub_id"];
            isOneToOne: false;
            referencedRelation: "hubs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hub_members_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hub_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      hub_pings: {
        Row: {
          added_by: string;
          created_at: string;
          hub_id: string;
          intent: string | null;
          is_pinned: boolean;
          ping_id: string;
          removed_at: string | null;
        };
        Insert: {
          added_by: string;
          created_at?: string;
          hub_id: string;
          intent?: string | null;
          is_pinned?: boolean;
          ping_id: string;
          removed_at?: string | null;
        };
        Update: {
          added_by?: string;
          created_at?: string;
          hub_id?: string;
          intent?: string | null;
          is_pinned?: boolean;
          ping_id?: string;
          removed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "hub_pings_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hub_pings_hub_id_fkey";
            columns: ["hub_id"];
            isOneToOne: false;
            referencedRelation: "hubs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hub_pings_ping_id_fkey";
            columns: ["ping_id"];
            isOneToOne: false;
            referencedRelation: "pings";
            referencedColumns: ["id"];
          },
        ];
      };
      hubs: {
        Row: {
          access: string;
          category: string;
          created_at: string;
          description: string;
          hidden_at: string | null;
          id: string;
          member_count: number;
          member_limit: number;
          name: string;
          owner_id: string;
          ping_count: number;
          resources: Json;
          rules: string;
          slug: string;
          tagline: string;
          updated_at: string;
          verified: boolean;
        };
        Insert: {
          access?: string;
          category?: string;
          created_at?: string;
          description?: string;
          hidden_at?: string | null;
          id?: string;
          member_count?: number;
          member_limit?: number;
          name: string;
          owner_id: string;
          ping_count?: number;
          resources?: Json;
          rules?: string;
          slug: string;
          tagline?: string;
          updated_at?: string;
          verified?: boolean;
        };
        Update: {
          access?: string;
          category?: string;
          created_at?: string;
          description?: string;
          hidden_at?: string | null;
          id?: string;
          member_count?: number;
          member_limit?: number;
          name?: string;
          owner_id?: string;
          ping_count?: number;
          resources?: Json;
          rules?: string;
          slug?: string;
          tagline?: string;
          updated_at?: string;
          verified?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "hubs_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      likes: {
        Row: {
          created_at: string;
          ping_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ping_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          ping_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "likes_ping_id_fkey";
            columns: ["ping_id"];
            isOneToOne: false;
            referencedRelation: "pings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_audit: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          reason: string;
          target_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          reason: string;
          target_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          reason?: string;
          target_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          actor_id: string | null;
          comment_id: string;
          created_at: string;
          id: string;
          kind: string;
          ping_id: string;
          read_at: string | null;
          user_id: string;
        };
        Insert: {
          actor_id?: string | null;
          comment_id: string;
          created_at?: string;
          id?: string;
          kind: string;
          ping_id: string;
          read_at?: string | null;
          user_id: string;
        };
        Update: {
          actor_id?: string | null;
          comment_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          ping_id?: string;
          read_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_ping_id_fkey";
            columns: ["ping_id"];
            isOneToOne: false;
            referencedRelation: "pings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      pings: {
        Row: {
          category: string;
          content: string;
          created_at: string;
          cta_label: string | null;
          cta_url: string | null;
          hidden_at: string | null;
          id: string;
          image_url: string | null;
          source_comment_id: string | null;
          source_ping_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          category?: string;
          content: string;
          created_at?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          hidden_at?: string | null;
          id?: string;
          image_url?: string | null;
          source_comment_id?: string | null;
          source_ping_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          category?: string;
          content?: string;
          created_at?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          hidden_at?: string | null;
          id?: string;
          image_url?: string | null;
          source_comment_id?: string | null;
          source_ping_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pings_source_comment_id_fkey";
            columns: ["source_comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pings_source_ping_id_fkey";
            columns: ["source_ping_id"];
            isOneToOne: false;
            referencedRelation: "pings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_connections: {
        Row: {
          created_at: string;
          handle: string;
          id: string;
          is_primary: boolean;
          is_public: boolean;
          platform: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          handle: string;
          id?: string;
          is_primary?: boolean;
          is_public?: boolean;
          platform: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          handle?: string;
          id?: string;
          is_primary?: boolean;
          is_public?: boolean;
          platform?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_connections_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          bio: string;
          created_at: string;
          display_name: string;
          id: string;
          username: string;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string;
          created_at?: string;
          display_name?: string;
          id: string;
          username: string;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string;
          created_at?: string;
          display_name?: string;
          id?: string;
          username?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          details: string | null;
          id: string;
          ping_id: string;
          reason: string;
          reporter_id: string;
          resolved_at: string | null;
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          id?: string;
          ping_id: string;
          reason: string;
          reporter_id: string;
          resolved_at?: string | null;
        };
        Update: {
          created_at?: string;
          details?: string | null;
          id?: string;
          ping_id?: string;
          reason?: string;
          reporter_id?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reports_ping_id_fkey";
            columns: ["ping_id"];
            isOneToOne: false;
            referencedRelation: "pings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      hub_messages: {
        Row: {
          content: string;
          created_at: string;
          deleted_at: string | null;
          hub_id: string;
          id: string;
          is_system: boolean;
          media_url: string | null;
          reactions: Json;
          reply_to_id: string | null;
          sender_id: string;
          updated_at: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          deleted_at?: string | null;
          hub_id: string;
          id?: string;
          is_system?: boolean;
          media_url?: string | null;
          reactions?: Json;
          reply_to_id?: string | null;
          sender_id: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          deleted_at?: string | null;
          hub_id?: string;
          id?: string;
          is_system?: boolean;
          media_url?: string | null;
          reactions?: Json;
          reply_to_id?: string | null;
          sender_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hub_messages_hub_id_fkey";
            columns: ["hub_id"];
            isOneToOne: false;
            referencedRelation: "hubs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hub_messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ping_read_receipts: {
        Row: {
          delivered_at: string;
          hub_id: string;
          last_interacted_at: string;
          message_id: string;
          read_at: string | null;
          recipient_id: string;
        };
        Insert: {
          delivered_at?: string;
          hub_id: string;
          last_interacted_at?: string;
          message_id: string;
          read_at?: string | null;
          recipient_id: string;
        };
        Update: {
          delivered_at?: string;
          hub_id?: string;
          last_interacted_at?: string;
          message_id?: string;
          read_at?: string | null;
          recipient_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ping_read_receipts_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "hub_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ping_read_receipts_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_privacy_preferences: {
        Row: {
          active_presence_enabled: boolean;
          last_active_enabled: boolean;
          read_receipts_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active_presence_enabled?: boolean;
          last_active_enabled?: boolean;
          read_receipts_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active_presence_enabled?: boolean;
          last_active_enabled?: boolean;
          read_receipts_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_privacy_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      signals: {
        Row: {
          avatar_url: string | null;
          cover_url: string | null;
          created_at: string;
          created_by: string;
          description: string;
          follower_count: number;
          id: string;
          institution_type: string;
          name: string;
          post_count: number;
          slug: string;
          tagline: string;
          updated_at: string;
          verification_details: Json;
          verification_status: string;
          verified: boolean;
          website_url: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          cover_url?: string | null;
          created_at?: string;
          created_by: string;
          description?: string;
          follower_count?: number;
          id?: string;
          institution_type?: string;
          name: string;
          post_count?: number;
          slug: string;
          tagline?: string;
          updated_at?: string;
          verification_details?: Json;
          verification_status?: string;
          verified?: boolean;
          website_url?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          cover_url?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string;
          follower_count?: number;
          id?: string;
          institution_type?: string;
          name?: string;
          post_count?: number;
          slug?: string;
          tagline?: string;
          updated_at?: string;
          verification_details?: Json;
          verification_status?: string;
          verified?: boolean;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "signals_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_publishers: {
        Row: {
          assigned_by: string | null;
          created_at: string;
          role: string;
          signal_id: string;
          user_id: string;
        };
        Insert: {
          assigned_by?: string | null;
          created_at?: string;
          role?: string;
          signal_id: string;
          user_id: string;
        };
        Update: {
          assigned_by?: string | null;
          created_at?: string;
          role?: string;
          signal_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_publishers_signal_id_fkey";
            columns: ["signal_id"];
            isOneToOne: false;
            referencedRelation: "signals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signal_publishers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_followers: {
        Row: {
          created_at: string;
          notifications_enabled: boolean;
          signal_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          notifications_enabled?: boolean;
          signal_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          notifications_enabled?: boolean;
          signal_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_followers_signal_id_fkey";
            columns: ["signal_id"];
            isOneToOne: false;
            referencedRelation: "signals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signal_followers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_posts: {
        Row: {
          author_id: string;
          category: string;
          content: string;
          created_at: string;
          id: string;
          is_urgent: boolean;
          media_urls: Json;
          read_count: number;
          signal_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          category?: string;
          content: string;
          created_at?: string;
          id?: string;
          is_urgent?: boolean;
          media_urls?: Json;
          read_count?: number;
          signal_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          category?: string;
          content?: string;
          created_at?: string;
          id?: string;
          is_urgent?: boolean;
          media_urls?: Json;
          read_count?: number;
          signal_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_posts_signal_id_fkey";
            columns: ["signal_id"];
            isOneToOne: false;
            referencedRelation: "signals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signal_posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_reads: {
        Row: {
          post_id: string;
          read_at: string;
          signal_id: string;
          user_id: string;
        };
        Insert: {
          post_id: string;
          read_at?: string;
          signal_id: string;
          user_id: string;
        };
        Update: {
          post_id?: string;
          read_at?: string;
          signal_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_reads_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "signal_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signal_reads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      moments: {
        Row: {
          id: string;
          author_id: string;
          media_url: string;
          media_type: string;
          caption: string | null;
          overlay_text: string | null;
          stickers: Json;
          mentions: Json;
          location: string | null;
          duration: number;
          audience: string;
          hub_id: string | null;
          is_discoverable: boolean;
          allow_comments: boolean;
          allow_sharing: boolean;
          allow_repings: boolean;
          expires_at: string;
          is_archived: boolean;
          deleted_at: string | null;
          view_count: number;
          like_count: number;
          reping_count: number;
          reply_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          author_id: string;
          media_url: string;
          media_type?: string;
          caption?: string | null;
          overlay_text?: string | null;
          stickers?: Json;
          mentions?: Json;
          location?: string | null;
          duration?: number;
          audience?: string;
          hub_id?: string | null;
          is_discoverable?: boolean;
          allow_comments?: boolean;
          allow_sharing?: boolean;
          allow_repings?: boolean;
          expires_at?: string;
          is_archived?: boolean;
          deleted_at?: string | null;
          view_count?: number;
          like_count?: number;
          reping_count?: number;
          reply_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          author_id?: string;
          media_url?: string;
          media_type?: string;
          caption?: string | null;
          overlay_text?: string | null;
          stickers?: Json;
          mentions?: Json;
          location?: string | null;
          duration?: number;
          audience?: string;
          hub_id?: string | null;
          is_discoverable?: boolean;
          allow_comments?: boolean;
          allow_sharing?: boolean;
          allow_repings?: boolean;
          expires_at?: string;
          is_archived?: boolean;
          deleted_at?: string | null;
          view_count?: number;
          like_count?: number;
          reping_count?: number;
          reply_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moments_hub_id_fkey";
            columns: ["hub_id"];
            isOneToOne: false;
            referencedRelation: "hubs";
            referencedColumns: ["id"];
          },
        ];
      };
      moment_views: {
        Row: {
          id: string;
          moment_id: string;
          viewer_id: string;
          viewed_at: string;
        };
        Insert: {
          id?: string;
          moment_id: string;
          viewer_id: string;
          viewed_at?: string;
        };
        Update: {
          id?: string;
          moment_id?: string;
          viewer_id?: string;
          viewed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moment_views_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moment_views_viewer_id_fkey";
            columns: ["viewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      moment_likes: {
        Row: {
          id: string;
          moment_id: string;
          user_id: string;
          reaction: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          moment_id: string;
          user_id: string;
          reaction?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          moment_id?: string;
          user_id?: string;
          reaction?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moment_likes_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moment_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      moment_replies: {
        Row: {
          id: string;
          moment_id: string;
          sender_id: string;
          recipient_id: string;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          moment_id: string;
          sender_id: string;
          recipient_id: string;
          message: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          moment_id?: string;
          sender_id?: string;
          recipient_id?: string;
          message?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moment_replies_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moment_replies_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      moment_repings: {
        Row: {
          id: string;
          moment_id: string;
          user_id: string;
          caption: string | null;
          audience: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          moment_id: string;
          user_id: string;
          caption?: string | null;
          audience?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          moment_id?: string;
          user_id?: string;
          caption?: string | null;
          audience?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moment_repings_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moment_repings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      highlights: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          cover_url: string | null;
          display_order: number;
          is_private: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          cover_url?: string | null;
          display_order?: number;
          is_private?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          cover_url?: string | null;
          display_order?: number;
          is_private?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "highlights_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      highlight_items: {
        Row: {
          id: string;
          highlight_id: string;
          moment_id: string;
          display_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          highlight_id: string;
          moment_id: string;
          display_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          highlight_id?: string;
          moment_id?: string;
          display_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "highlight_items_highlight_id_fkey";
            columns: ["highlight_id"];
            isOneToOne: false;
            referencedRelation: "highlights";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "highlight_items_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["id"];
          },
        ];
      };
      user_close_circle: {
        Row: {
          id: string;
          user_id: string;
          member_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          member_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          member_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_close_circle_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_hub: {
        Args: {
          _access?: string;
          _category?: string;
          _description?: string;
          _name: string;
          _resources?: Json;
          _rules?: string;
          _slug: string;
          _tagline?: string;
        };
        Returns: Json;
      };
      create_signal: {
        Args: {
          _description?: string;
          _institution_type?: string;
          _name: string;
          _slug: string;
          _tagline?: string;
          _website_url?: string;
        };
        Returns: Json;
      };
      get_message_read_summary: {
        Args: { _message_id: string };
        Returns: Json;
      };
      get_signal_post_analytics: {
        Args: { _post_id: string };
        Returns: Json;
      };
      get_user_privacy: {
        Args: { _user: string };
        Returns: Json;
      };
      mark_hub_messages_read: {
        Args: { _hub_id: string; _message_ids: string[] };
        Returns: undefined;
      };
      mark_signal_read: {
        Args: { _post_id: string };
        Returns: undefined;
      };
      signal_role: {
        Args: { _signal: string; _user: string };
        Returns: string;
      };
      toggle_follow_signal: {
        Args: { _signal: string };
        Returns: boolean;
      };

      view_moment: {
        Args: { _moment_id: string };
        Returns: undefined;
      };
      toggle_like_moment: {
        Args: { _moment_id: string; _reaction?: string };
        Returns: boolean;
      };
      reping_moment: {
        Args: {
          _moment_id: string;
          _caption?: string;
          _audience?: string;
        };
        Returns: string;
      };
      delete_reping: {
        Args: { _reping_id: string };
        Returns: undefined;
      };
      admin_metrics: { Args: never; Returns: Json };
      admin_moderate: {
        Args: {
          _action: string;
          _actor: string;
          _reason: string;
          _target: string;
        };
        Returns: undefined;
      };
      can_view_hub_content: { Args: { _hub: string }; Returns: boolean };
      create_hub_invite: {
        Args: { _days?: number; _hub: string; _max_uses?: number };
        Returns: string;
      };
      hub_role: { Args: { _hub: string; _user: string }; Returns: string };
      invite_to_hub: {
        Args: { _hub: string; _username: string };
        Returns: undefined;
      };
      is_ping_admin: { Args: never; Returns: boolean };
      join_hub: { Args: { _hub: string; _token?: string }; Returns: string };
      leave_hub: { Args: { _hub: string }; Returns: undefined };
      manage_hub_member: {
        Args: { _action: string; _hub: string; _role?: string; _user: string };
        Returns: undefined;
      };
      moderate_hub_ping: {
        Args: { _action: string; _hub: string; _ping: string };
        Returns: undefined;
      };
      revoke_hub_invite: { Args: { _invite: string }; Returns: undefined };
      save_profile_connection: {
        Args: {
          _handle: string;
          _is_primary: boolean;
          _is_public: boolean;
          _platform: string;
        };
        Returns: undefined;
      };
      share_ping_to_hub: {
        Args: { _hub: string; _intent?: string; _ping: string };
        Returns: undefined;
      };
      manage_signal_publisher: {
        Args: {
          _action: string;
          _role?: string;
          _signal: string;
          _username: string;
        };
        Returns: undefined;
      };
      request_signal_verification: {
        Args: {
          _details?: Json;
          _signal: string;
        };
        Returns: undefined;
      };
      verify_signal: {
        Args: {
          _signal: string;
          _status: string;
        };
        Returns: undefined;
      };
      update_hub: {
        Args: {
          _access?: string;
          _category?: string;
          _description?: string;
          _hub: string;
          _name: string;
          _resources?: Json;
          _rules?: string;
          _tagline?: string;
        };
        Returns: Database["public"]["Tables"]["hubs"]["Row"];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
