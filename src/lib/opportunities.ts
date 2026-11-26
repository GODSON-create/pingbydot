import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";

export const OPPORTUNITY_CATEGORIES = [
  { value: "funding", label: "Funding", emoji: "💰" },
  { value: "investment", label: "Investment", emoji: "📈" },
  { value: "jobs", label: "Jobs", emoji: "💼" },
  { value: "recruitment", label: "Recruitment", emoji: "🧑‍💻" },
  { value: "partnerships", label: "Partnerships", emoji: "🤝" },
  { value: "procurement", label: "Procurement", emoji: "📦" },
  { value: "grants", label: "Grants", emoji: "🏛️" },
  { value: "competitions", label: "Competitions", emoji: "🏆" },
  { value: "mentorship", label: "Mentorship", emoji: "🧭" },
  { value: "services", label: "Services", emoji: "🛠️" },
  { value: "research", label: "Research", emoji: "🔬" },
  { value: "events", label: "Events", emoji: "📅" },
  { value: "business_proposals", label: "Business Proposals", emoji: "📑" },
  { value: "product_requests", label: "Product Requests", emoji: "✨" },
] as const;

export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number]["value"];
export type OpportunityStatus = "open" | "closed" | "expired";
export type ApplicationStatus =
  "submitted" | "reviewing" | "shortlisted" | "accepted" | "declined" | "withdrawn";

export interface SignalOpportunity {
  id: string;
  publisher_id: string;
  signal_id?: string | null | undefined;
  category: OpportunityCategory;
  title: string;
  description: string;
  location: string;
  eligibility: string;
  required_info: string;
  expires_at: string | null;
  status: OpportunityStatus;
  created_at: string;
  updated_at?: string | undefined;
  publisher?: Profile | undefined;
  local_preview?: boolean | undefined;
}

export interface SignalApplication {
  id: string;
  opportunity_id: string;
  applicant_id: string;
  cover_note: string;
  portfolio_url: string | null;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
  applicant?: Profile | undefined;
}

const LOCAL_OPPS_KEY = "ping:local-signal-opportunities:v1";
const LOCAL_APPS_KEY = "ping:local-signal-applications:v1";

function isMissingOpportunitiesSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    e.code === "42P01" ||
    e.code === "42883" ||
    e.status === 404 ||
    msg.includes("signal_opportunities") ||
    msg.includes("signal_applications") ||
    msg.includes("could not find the table") ||
    msg.includes("could not find the function")
  );
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export function signalOpportunitiesQuery(category?: OpportunityCategory | "all", search?: string) {
  return {
    queryKey: ["signal-opportunities", category ?? "all", search ?? ""],
    staleTime: 30_000,
    queryFn: async (): Promise<SignalOpportunity[]> => {
      let query = (supabase as any)
        .from("signal_opportunities")
        .select(
          `
          id, publisher_id, signal_id, category, title, description, location, eligibility, required_info, expires_at, status, created_at, updated_at,
          publisher:profiles!signal_opportunities_publisher_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .order("created_at", { ascending: false })
        .limit(60);

      if (category && category !== "all") {
        query = query.eq("category", category);
      }

      const { data, error } = await query;
      let rows: SignalOpportunity[] = [];
      if (error) {
        if (!isMissingOpportunitiesSchema(error)) throw error;
        rows = readLocal<SignalOpportunity[]>(LOCAL_OPPS_KEY, []);
      } else {
        rows = (data ?? []) as SignalOpportunity[];
      }

      const term = (search ?? "").trim().toLowerCase();
      return rows.filter((opp) => {
        if (category && category !== "all" && opp.category !== category) return false;
        if (!term) return true;
        return (
          opp.title.toLowerCase().includes(term) ||
          opp.description.toLowerCase().includes(term) ||
          opp.location.toLowerCase().includes(term) ||
          opp.eligibility.toLowerCase().includes(term) ||
          opp.category.toLowerCase().includes(term)
        );
      });
    },
  };
}

export function useCreateSignalOpportunity(userId?: string, authorProfile?: Profile | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      category: OpportunityCategory;
      title: string;
      description: string;
      location: string;
      eligibility: string;
      required_info: string;
      expires_at?: string | null;
      signal_id?: string | null;
    }): Promise<SignalOpportunity> => {
      if (!userId) throw new Error("Sign in to publish an opportunity.");
      const payload = {
        publisher_id: userId,
        signal_id: input.signal_id ?? null,
        category: input.category,
        title: input.title.trim(),
        description: input.description.trim(),
        location: input.location.trim() || "Remote / Global",
        eligibility: input.eligibility.trim(),
        required_info: input.required_info.trim(),
        expires_at: input.expires_at || null,
        status: "open" as const,
      };

      const { data, error } = await (supabase as any)
        .from("signal_opportunities")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        if (!isMissingOpportunitiesSchema(error)) throw error;
        const created: SignalOpportunity = {
          ...payload,
          id: `local-opp-${Date.now()}`,
          created_at: new Date().toISOString(),
          publisher: authorProfile ?? undefined,
          local_preview: true,
        };
        const curr = readLocal<SignalOpportunity[]>(LOCAL_OPPS_KEY, []);
        writeLocal(LOCAL_OPPS_KEY, [created, ...curr]);
        return created;
      }

      return data as SignalOpportunity;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-opportunities"] });
    },
  });
}

export function useUpdateSignalOpportunityStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      opportunityId,
      status,
    }: {
      opportunityId: string;
      status: OpportunityStatus;
    }) => {
      const { error } = await (supabase as any)
        .from("signal_opportunities")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", opportunityId);

      if (error) {
        if (!isMissingOpportunitiesSchema(error)) throw error;
        const curr = readLocal<SignalOpportunity[]>(LOCAL_OPPS_KEY, []);
        writeLocal(
          LOCAL_OPPS_KEY,
          curr.map((o) => (o.id === opportunityId ? { ...o, status } : o)),
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-opportunities"] });
    },
  });
}

export function mySignalApplicationsQuery(userId?: string) {
  return {
    queryKey: ["my-signal-applications", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<SignalApplication[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("signal_applications")
        .select(
          "id, opportunity_id, applicant_id, cover_note, portfolio_url, status, created_at, updated_at",
        )
        .eq("applicant_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        if (!isMissingOpportunitiesSchema(error)) throw error;
        return readLocal<SignalApplication[]>(LOCAL_APPS_KEY, []).filter(
          (a) => a.applicant_id === userId,
        );
      }
      return (data ?? []) as SignalApplication[];
    },
  };
}

export function publisherApplicationsQuery(opportunityIds: string[], publisherId?: string) {
  return {
    queryKey: ["publisher-signal-applications", publisherId, opportunityIds.join(",")],
    enabled: Boolean(publisherId && opportunityIds.length > 0),
    queryFn: async (): Promise<SignalApplication[]> => {
      if (!publisherId || opportunityIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from("signal_applications")
        .select(
          `
          id, opportunity_id, applicant_id, cover_note, portfolio_url, status, created_at, updated_at,
          applicant:profiles!signal_applications_applicant_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .in("opportunity_id", opportunityIds)
        .order("created_at", { ascending: false });

      if (error) {
        if (!isMissingOpportunitiesSchema(error)) throw error;
        const set = new Set(opportunityIds);
        return readLocal<SignalApplication[]>(LOCAL_APPS_KEY, []).filter((a) =>
          set.has(a.opportunity_id),
        );
      }
      return (data ?? []) as SignalApplication[];
    },
  };
}

export function useSubmitSignalApplication(userId?: string, applicantProfile?: Profile | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      opportunityId: string;
      coverNote: string;
      portfolioUrl?: string | undefined;
    }) => {
      if (!userId) throw new Error("Sign in to submit an application.");
      const { data, error } = await (supabase as any).rpc("submit_signal_application", {
        p_opportunity_id: input.opportunityId,
        p_cover_note: input.coverNote.trim(),
        p_portfolio_url: input.portfolioUrl?.trim() || null,
      });

      if (error) {
        if (!isMissingOpportunitiesSchema(error)) throw error;
        const now = new Date().toISOString();
        const curr = readLocal<SignalApplication[]>(LOCAL_APPS_KEY, []);
        const filtered = curr.filter(
          (a) => !(a.opportunity_id === input.opportunityId && a.applicant_id === userId),
        );
        const created: SignalApplication = {
          id: `local-app-${Date.now()}`,
          opportunity_id: input.opportunityId,
          applicant_id: userId,
          cover_note: input.coverNote.trim(),
          portfolio_url: input.portfolioUrl?.trim() || null,
          status: "submitted",
          created_at: now,
          updated_at: now,
          applicant: applicantProfile ?? undefined,
        };
        writeLocal(LOCAL_APPS_KEY, [created, ...filtered]);
        return created;
      }

      return data as SignalApplication;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-signal-applications"] });
      qc.invalidateQueries({ queryKey: ["publisher-signal-applications"] });
    },
  });
}

export function useUpdateSignalApplicationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      status,
    }: {
      applicationId: string;
      status: ApplicationStatus;
    }) => {
      const { error } = await (supabase as any).rpc("update_signal_application_status", {
        p_application_id: applicationId,
        p_status: status,
      });

      if (error) {
        if (!isMissingOpportunitiesSchema(error)) throw error;
        const curr = readLocal<SignalApplication[]>(LOCAL_APPS_KEY, []);
        writeLocal(
          LOCAL_APPS_KEY,
          curr.map((a) =>
            a.id === applicationId ? { ...a, status, updated_at: new Date().toISOString() } : a,
          ),
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-signal-applications"] });
      qc.invalidateQueries({ queryKey: ["publisher-signal-applications"] });
    },
  });
}
