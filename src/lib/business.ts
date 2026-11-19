import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";

export const BUSINESS_CATEGORIES = [
  { value: "technology", label: "Technology & Software" },
  { value: "retail", label: "Retail & Commerce" },
  { value: "services", label: "Professional Services" },
  { value: "creative", label: "Creative Studio & Media" },
  { value: "education", label: "Education & Training" },
  { value: "finance", label: "Finance & Advisory" },
  { value: "health", label: "Health & Wellness" },
  { value: "hospitality", label: "Food & Hospitality" },
  { value: "logistics", label: "Logistics & Supply Chain" },
  { value: "nonprofit", label: "Institution / Association / NGO" },
] as const;

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]["value"];
export type BusinessRole = "owner" | "admin" | "agent" | "analyst";
export type LeadStatus = "new" | "qualified" | "in_progress" | "won" | "lost" | "closed";
export type EnquiryType =
  "general" | "product_enquiry" | "appointment_booking" | "partnership" | "support";

export interface BusinessProfile {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  logo_url: string | null;
  cover_url: string | null;
  location: string;
  country: string;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_hours: string;
  auto_reply_enabled: boolean;
  auto_reply_message: string;
  merchant_disclosure: string;
  verified_status: "unverified" | "pending" | "verified";
  whatsapp_business_connected: boolean;
  created_at: string;
  updated_at?: string | undefined;
}

export interface BusinessTeamMember {
  business_id: string;
  user_id: string;
  role: BusinessRole;
  created_at: string;
  profile?: Profile | undefined;
}

export interface BusinessOffering {
  id: string;
  business_id: string;
  kind: "product" | "service";
  title: string;
  description: string;
  price_display: string;
  currency: string;
  media_urls: string[];
  booking_enabled: boolean;
  status: "active" | "draft" | "archived";
  created_at: string;
}

export interface BusinessReview {
  id: string;
  business_id: string;
  reviewer_id: string;
  rating: number;
  comment: string;
  created_at: string;
  reviewer?: Profile | undefined;
}

export interface BusinessEnquiry {
  id: string;
  business_id: string;
  customer_id: string;
  offering_id: string | null;
  enquiry_type: EnquiryType;
  subject: string;
  message: string;
  preferred_date: string | null;
  lead_status: LeadStatus;
  assigned_agent_id: string | null;
  labels: string[];
  internal_notes: string;
  reply_message: string | null;
  first_response_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: Profile | undefined;
}

export interface BusinessSavedReply {
  id: string;
  business_id: string;
  shortcut: string;
  title: string;
  body: string;
  created_by: string;
  created_at: string;
}

export interface AdCampaignDraft {
  id: string;
  business_id: string;
  created_by: string;
  placement: "sponsored_ping" | "sponsored_signal" | "sponsored_hub";
  title: string;
  target_url: string | null;
  target_regions: string[];
  target_interests: string[];
  budget_currency: string;
  budget_minor: number;
  starts_at: string | null;
  ends_at: string | null;
  status: "draft" | "pending_policy_review" | "paused" | "rejected" | "completed";
  billing_approved: false;
  created_at: string;
}

export interface CreatorCommercialProfile {
  user_id: string;
  open_for_sponsorships: boolean;
  open_for_brand_deals: boolean;
  portfolio_summary: string;
  rate_card_notes: string;
  enquiry_email: string | null;
  media_kit_url: string | null;
  updated_at?: string | undefined;
}

const LOCAL_BIZ_KEY = "ping:local-businesses:v1";
const LOCAL_OFFERINGS_KEY = "ping:local-business-offerings:v1";
const LOCAL_REVIEWS_KEY = "ping:local-business-reviews:v1";
const LOCAL_ENQUIRIES_KEY = "ping:local-business-enquiries:v1";
const LOCAL_REPLIES_KEY = "ping:local-business-replies:v1";
const LOCAL_TEAM_KEY = "ping:local-business-team:v1";
const LOCAL_ADS_KEY = "ping:local-ad-campaigns:v1";
const LOCAL_CREATOR_COMM_PREFIX = "ping:creator-commercial:";

function isMissingPhase4Schema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    e.code === "42P01" ||
    e.code === "42883" ||
    e.status === 404 ||
    msg.includes("does not exist") ||
    msg.includes("could not find the")
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

function writeLocal<T>(key: string, val: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore storage errors
  }
}

export function slugifyBusinessName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

export function computeBusinessReputation(reviews: BusinessReview[]): {
  averageRating: number;
  reviewCount: number;
} {
  if (reviews.length === 0) return { averageRating: 0, reviewCount: 0 };
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return {
    averageRating: Math.round((sum / reviews.length) * 10) / 10,
    reviewCount: reviews.length,
  };
}

export function computeAvgResponseMinutes(enquiries: BusinessEnquiry[]): number | null {
  const responded = enquiries.filter((e) => Boolean(e.first_response_at));
  if (responded.length === 0) return null;
  const totalMins = responded.reduce((acc, e) => {
    const start = new Date(e.created_at).getTime();
    const end = new Date(e.first_response_at!).getTime();
    return acc + Math.max(0, (end - start) / 60_000);
  }, 0);
  return Math.round(totalMins / responded.length);
}

/**
 * Safe CSV export of authorised business leads (escapes formula injection chars per OWASP).
 */
export function buildLeadsCsv(enquiries: BusinessEnquiry[]): string {
  const escapeCell = (val: string | null | undefined): string => {
    let s = String(val ?? "").replace(/\r?\n/g, " ");
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const headers = [
    "id",
    "created_at",
    "enquiry_type",
    "lead_status",
    "subject",
    "labels",
    "preferred_date",
    "first_response_at",
  ];
  const rows = enquiries.map((e) =>
    [
      escapeCell(e.id),
      escapeCell(e.created_at),
      escapeCell(e.enquiry_type),
      escapeCell(e.lead_status),
      escapeCell(e.subject),
      escapeCell(e.labels.join("; ")),
      escapeCell(e.preferred_date),
      escapeCell(e.first_response_at),
    ].join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

/**
 * Business integrations & optional Meta WhatsApp Business readiness (Phase 4.4).
 * Ping's native Business Inbox operates independently — WhatsApp is strictly optional.
 */
export function getBusinessIntegrationReadiness() {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const whatsappConfigured = Boolean(env?.["VITE_META_WHATSAPP_APP_ID"]);
  return {
    nativePingInboxActive: true,
    whatsappBusiness: {
      optional: true,
      configured: whatsappConfigured,
      status: whatsappConfigured
        ? "Official Meta Embedded Signup Configured"
        : "Optional — requires official Meta WhatsApp Business Platform approval & credentials",
      policyNote:
        "Ping never impersonates WhatsApp or bypasses template/consent rules. Businesses can run their full inbox natively on Ping without connecting WhatsApp.",
    },
    apiIntegrations: [
      { id: "website_widget", label: "Website Enquiry Embed", phase: "Phase 5 API" },
      {
        id: "crm_webhooks",
        label: "CRM Lead Webhooks (HubSpot / Salesforce / Zoho)",
        phase: "Phase 5 API",
      },
      { id: "support_helpdesk", label: "Customer Support Desk Sync", phase: "Phase 5 API" },
      { id: "booking_sync", label: "External Booking & Calendar Sync", phase: "Phase 5 API" },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/*                         BUSINESS PROFILES QUERIES                          */
/* -------------------------------------------------------------------------- */

export function businessesQuery(search = "", category = "all") {
  return queryOptions({
    queryKey: ["businesses", search, category],
    staleTime: 30_000,
    queryFn: async (): Promise<BusinessProfile[]> => {
      let query = (supabase as any)
        .from("business_profiles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (category && category !== "all") {
        query = query.eq("category", category);
      }

      const { data, error } = await query;
      let rows: BusinessProfile[] = [];
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        rows = readLocal<BusinessProfile[]>(LOCAL_BIZ_KEY, []);
      } else {
        rows = (data ?? []) as BusinessProfile[];
      }

      const term = search.trim().toLowerCase();
      return rows.filter((b) => {
        if (category && category !== "all" && b.category !== category) return false;
        if (!term) return true;
        return (
          b.name.toLowerCase().includes(term) ||
          b.tagline.toLowerCase().includes(term) ||
          b.description.toLowerCase().includes(term) ||
          b.location.toLowerCase().includes(term) ||
          b.category.toLowerCase().includes(term)
        );
      });
    },
  });
}

export function businessBySlugQuery(slug?: string | undefined) {
  return queryOptions({
    queryKey: ["business-by-slug", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<BusinessProfile | null> => {
      if (!slug) return null;
      const { data, error } = await (supabase as any)
        .from("business_profiles")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<BusinessProfile[]>(LOCAL_BIZ_KEY, []).find((b) => b.slug === slug) ?? null;
      }
      return (data as BusinessProfile | null) ?? null;
    },
  });
}

export function myBusinessesQuery(userId?: string | undefined) {
  return queryOptions({
    queryKey: ["my-businesses", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<BusinessProfile[]> => {
      if (!userId) return [];
      const { data: owned, error: ownedErr } = await (supabase as any)
        .from("business_profiles")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });

      if (ownedErr) {
        if (!isMissingPhase4Schema(ownedErr)) throw ownedErr;
        const team = readLocal<BusinessTeamMember[]>(LOCAL_TEAM_KEY, []).filter(
          (m) => m.user_id === userId,
        );
        const memberBizIds = new Set(team.map((m) => m.business_id));
        return readLocal<BusinessProfile[]>(LOCAL_BIZ_KEY, []).filter(
          (b) => b.owner_id === userId || memberBizIds.has(b.id),
        );
      }

      const { data: memberships } = await (supabase as any)
        .from("business_team_members")
        .select("business:business_profiles(*)")
        .eq("user_id", userId);

      const map = new Map<string, BusinessProfile>();
      for (const b of (owned ?? []) as BusinessProfile[]) map.set(b.id, b);
      for (const m of (memberships ?? []) as Array<{ business?: BusinessProfile | null }>) {
        if (m.business) map.set(m.business.id, m.business);
      }
      return Array.from(map.values());
    },
  });
}

export function useCreateBusinessProfile(userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      slug?: string | undefined;
      category: string;
      tagline: string;
      description: string;
      location: string;
      country: string;
      websiteUrl?: string | undefined;
      contactEmail?: string | undefined;
      contactPhone?: string | undefined;
      businessHours?: string | undefined;
    }): Promise<BusinessProfile> => {
      if (!userId) throw new Error("Sign in to create a business profile.");
      const slug = slugifyBusinessName(input.slug || input.name);
      if (slug.length < 3)
        throw new Error("Business name must generate a slug of at least 3 characters.");

      const payload = {
        owner_id: userId,
        slug,
        name: input.name.trim(),
        category: input.category,
        tagline: input.tagline.trim(),
        description: input.description.trim(),
        location: input.location.trim(),
        country: input.country.trim(),
        website_url: input.websiteUrl?.trim() || null,
        contact_email: input.contactEmail?.trim() || null,
        contact_phone: input.contactPhone?.trim() || null,
        business_hours: input.businessHours?.trim() || "Mon–Fri 9:00 AM – 5:00 PM",
        auto_reply_enabled: false,
        auto_reply_message: "Thanks for reaching out! A team member will respond shortly.",
        merchant_disclosure:
          "Products and services listed here are fulfilled directly by this business. Ping is not the merchant of record.",
        verified_status: "unverified" as const,
        whatsapp_business_connected: false,
      };

      const { data, error } = await (supabase as any)
        .from("business_profiles")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        const created: BusinessProfile = {
          ...payload,
          id: `local-biz-${Date.now()}`,
          logo_url: null,
          cover_url: null,
          created_at: new Date().toISOString(),
        };
        const curr = readLocal<BusinessProfile[]>(LOCAL_BIZ_KEY, []);
        writeLocal(LOCAL_BIZ_KEY, [created, ...curr]);
        return created;
      }

      return data as BusinessProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["businesses"] });
      qc.invalidateQueries({ queryKey: ["my-businesses"] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                      OFFERINGS, REVIEWS, TEAM & INBOX                      */
/* -------------------------------------------------------------------------- */

export function businessOfferingsQuery(businessId?: string | undefined) {
  return queryOptions({
    queryKey: ["business-offerings", businessId],
    enabled: Boolean(businessId),
    queryFn: async (): Promise<BusinessOffering[]> => {
      if (!businessId) return [];
      const { data, error } = await (supabase as any)
        .from("business_offerings")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<BusinessOffering[]>(LOCAL_OFFERINGS_KEY, []).filter(
          (o) => o.business_id === businessId,
        );
      }
      return (data ?? []) as BusinessOffering[];
    },
  });
}

export function useCreateBusinessOffering(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      kind: "product" | "service";
      title: string;
      description: string;
      priceDisplay: string;
      currency: string;
      bookingEnabled: boolean;
    }): Promise<BusinessOffering> => {
      const payload = {
        business_id: businessId,
        kind: input.kind,
        title: input.title.trim(),
        description: input.description.trim(),
        price_display: input.priceDisplay.trim() || "Contact for pricing",
        currency: input.currency || "USD",
        media_urls: [] as string[],
        booking_enabled: input.bookingEnabled,
        status: "active" as const,
      };
      const { data, error } = await (supabase as any)
        .from("business_offerings")
        .insert(payload)
        .select("*")
        .single();
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        const created: BusinessOffering = {
          ...payload,
          id: `local-off-${Date.now()}`,
          created_at: new Date().toISOString(),
        };
        writeLocal(LOCAL_OFFERINGS_KEY, [
          created,
          ...readLocal<BusinessOffering[]>(LOCAL_OFFERINGS_KEY, []),
        ]);
        return created;
      }
      return data as BusinessOffering;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-offerings", businessId] });
    },
  });
}

export function businessReviewsQuery(businessId?: string | undefined) {
  return queryOptions({
    queryKey: ["business-reviews", businessId],
    enabled: Boolean(businessId),
    queryFn: async (): Promise<BusinessReview[]> => {
      if (!businessId) return [];
      const { data, error } = await (supabase as any)
        .from("business_reviews")
        .select(
          `
          id, business_id, reviewer_id, rating, comment, created_at,
          reviewer:profiles!business_reviews_reviewer_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<BusinessReview[]>(LOCAL_REVIEWS_KEY, []).filter(
          (r) => r.business_id === businessId,
        );
      }
      return (data ?? []) as BusinessReview[];
    },
  });
}

export function useSubmitBusinessReview(businessId: string, userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rating: number; comment: string }) => {
      if (!userId) throw new Error("Sign in to leave a review.");
      const payload = {
        business_id: businessId,
        reviewer_id: userId,
        rating: Math.max(1, Math.min(5, Math.round(input.rating))),
        comment: input.comment.trim(),
      };
      const { error } = await (supabase as any).from("business_reviews").insert(payload);
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        const curr = readLocal<BusinessReview[]>(LOCAL_REVIEWS_KEY, []).filter(
          (r) => !(r.business_id === businessId && r.reviewer_id === userId),
        );
        writeLocal(LOCAL_REVIEWS_KEY, [
          { ...payload, id: `local-rev-${Date.now()}`, created_at: new Date().toISOString() },
          ...curr,
        ]);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-reviews", businessId] });
    },
  });
}

export function businessEnquiriesQuery(businessId?: string | undefined) {
  return queryOptions({
    queryKey: ["business-enquiries", businessId],
    enabled: Boolean(businessId),
    queryFn: async (): Promise<BusinessEnquiry[]> => {
      if (!businessId) return [];
      const { data, error } = await (supabase as any)
        .from("business_enquiries")
        .select(
          `
          *,
          customer:profiles!business_enquiries_customer_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<BusinessEnquiry[]>(LOCAL_ENQUIRIES_KEY, []).filter(
          (e) => e.business_id === businessId,
        );
      }
      return (data ?? []) as BusinessEnquiry[];
    },
  });
}

export function useSubmitBusinessEnquiry(businessId: string, userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      enquiryType: EnquiryType;
      subject: string;
      message: string;
      offeringId?: string | undefined;
      preferredDate?: string | undefined;
    }) => {
      if (!userId) throw new Error("Sign in to send a business enquiry.");
      const payload = {
        business_id: businessId,
        customer_id: userId,
        offering_id: input.offeringId ?? null,
        enquiry_type: input.enquiryType,
        subject: input.subject.trim(),
        message: input.message.trim(),
        preferred_date: input.preferredDate?.trim() || null,
        lead_status: "new" as const,
      };
      const { error } = await (supabase as any).from("business_enquiries").insert(payload);
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        const now = new Date().toISOString();
        const created: BusinessEnquiry = {
          ...payload,
          id: `local-enq-${Date.now()}`,
          assigned_agent_id: null,
          labels: [],
          internal_notes: "",
          reply_message: null,
          first_response_at: null,
          created_at: now,
          updated_at: now,
        };
        writeLocal(LOCAL_ENQUIRIES_KEY, [
          created,
          ...readLocal<BusinessEnquiry[]>(LOCAL_ENQUIRIES_KEY, []),
        ]);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-enquiries", businessId] });
    },
  });
}

export function useUpdateBusinessEnquiry(businessId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      enquiryId: string;
      leadStatus?: LeadStatus | undefined;
      assignedAgentId?: string | null | undefined;
      labels?: string[] | undefined;
      internalNotes?: string | undefined;
      replyMessage?: string | undefined;
    }) => {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { updated_at: now };
      if (input.leadStatus !== undefined) patch["lead_status"] = input.leadStatus;
      if (input.assignedAgentId !== undefined) patch["assigned_agent_id"] = input.assignedAgentId;
      if (input.labels !== undefined) patch["labels"] = input.labels;
      if (input.internalNotes !== undefined) patch["internal_notes"] = input.internalNotes;
      if (input.replyMessage !== undefined) {
        patch["reply_message"] = input.replyMessage;
        patch["first_response_at"] = now;
      }

      const { error } = await (supabase as any)
        .from("business_enquiries")
        .update(patch)
        .eq("id", input.enquiryId);
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        const updated = readLocal<BusinessEnquiry[]>(LOCAL_ENQUIRIES_KEY, []).map((e) =>
          e.id === input.enquiryId ? ({ ...e, ...patch } as BusinessEnquiry) : e,
        );
        writeLocal(LOCAL_ENQUIRIES_KEY, updated);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-enquiries", businessId] });
    },
  });
}

export function businessSavedRepliesQuery(businessId?: string | undefined) {
  return queryOptions({
    queryKey: ["business-saved-replies", businessId],
    enabled: Boolean(businessId),
    queryFn: async (): Promise<BusinessSavedReply[]> => {
      if (!businessId) return [];
      const { data, error } = await (supabase as any)
        .from("business_saved_replies")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<BusinessSavedReply[]>(LOCAL_REPLIES_KEY, []).filter(
          (r) => r.business_id === businessId,
        );
      }
      return (data ?? []) as BusinessSavedReply[];
    },
  });
}

export function useCreateSavedReply(businessId: string, userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { shortcut: string; title: string; body: string }) => {
      if (!userId) throw new Error("Sign in required.");
      const payload = {
        business_id: businessId,
        shortcut: input.shortcut.trim().toLowerCase(),
        title: input.title.trim(),
        body: input.body.trim(),
        created_by: userId,
      };
      const { error } = await (supabase as any).from("business_saved_replies").insert(payload);
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        writeLocal(LOCAL_REPLIES_KEY, [
          { ...payload, id: `local-sr-${Date.now()}`, created_at: new Date().toISOString() },
          ...readLocal<BusinessSavedReply[]>(LOCAL_REPLIES_KEY, []),
        ]);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-saved-replies", businessId] });
    },
  });
}

export function businessTeamQuery(businessId?: string | undefined) {
  return queryOptions({
    queryKey: ["business-team", businessId],
    enabled: Boolean(businessId),
    queryFn: async (): Promise<BusinessTeamMember[]> => {
      if (!businessId) return [];
      const { data, error } = await (supabase as any)
        .from("business_team_members")
        .select(
          `
          business_id, user_id, role, created_at,
          profile:profiles!business_team_members_user_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("business_id", businessId);
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<BusinessTeamMember[]>(LOCAL_TEAM_KEY, []).filter(
          (m) => m.business_id === businessId,
        );
      }
      return (data ?? []) as BusinessTeamMember[];
    },
  });
}

export function useAddBusinessTeamMember(businessId: string, addedBy?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { username: string; role: Exclude<BusinessRole, "owner"> }) => {
      const cleanUsername = input.username.trim().replace(/^@/, "").toLowerCase();
      const { data: profileRow, error: profErr } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio, created_at")
        .eq("username", cleanUsername)
        .maybeSingle();
      if (profErr || !profileRow) {
        throw new Error(`No Ping member found with @${cleanUsername}.`);
      }

      const payload = {
        business_id: businessId,
        user_id: profileRow.id,
        role: input.role,
        added_by: addedBy ?? null,
      };
      const { error } = await (supabase as any).from("business_team_members").insert(payload);
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        const curr = readLocal<BusinessTeamMember[]>(LOCAL_TEAM_KEY, []).filter(
          (m) => !(m.business_id === businessId && m.user_id === profileRow.id),
        );
        writeLocal(LOCAL_TEAM_KEY, [
          ...curr,
          {
            business_id: businessId,
            user_id: profileRow.id,
            role: input.role,
            created_at: new Date().toISOString(),
            profile: profileRow as Profile,
          },
        ]);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-team", businessId] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*             CONTROLLED ADVERTISING & CREATOR COMMERCIAL PROFILE            */
/* -------------------------------------------------------------------------- */

export function businessAdCampaignsQuery(businessId?: string | undefined) {
  return queryOptions({
    queryKey: ["business-ad-campaigns", businessId],
    enabled: Boolean(businessId),
    queryFn: async (): Promise<AdCampaignDraft[]> => {
      if (!businessId) return [];
      const { data, error } = await (supabase as any)
        .from("ad_campaigns")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<AdCampaignDraft[]>(LOCAL_ADS_KEY, []).filter(
          (c) => c.business_id === businessId,
        );
      }
      return (data ?? []) as AdCampaignDraft[];
    },
  });
}

export function useCreateAdCampaignDraft(businessId: string, userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      placement: "sponsored_ping" | "sponsored_signal" | "sponsored_hub";
      title: string;
      targetUrl?: string | undefined;
      targetRegions: string[];
      targetInterests: string[];
      budgetCurrency: string;
      budgetMinor: number;
    }): Promise<AdCampaignDraft> => {
      if (!userId) throw new Error("Sign in required.");
      const payload = {
        business_id: businessId,
        created_by: userId,
        placement: input.placement,
        title: input.title.trim(),
        target_url: input.targetUrl?.trim() || null,
        target_regions: input.targetRegions.length > 0 ? input.targetRegions : ["GLOBAL"],
        target_interests: input.targetInterests,
        budget_currency: input.budgetCurrency || "USD",
        budget_minor: Math.max(100, Math.round(input.budgetMinor)),
        starts_at: null,
        ends_at: null,
        status: "pending_policy_review" as const,
        billing_approved: false as const,
      };
      const { data, error } = await (supabase as any)
        .from("ad_campaigns")
        .insert(payload)
        .select("*")
        .single();
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        const created: AdCampaignDraft = {
          ...payload,
          id: `local-ad-${Date.now()}`,
          created_at: new Date().toISOString(),
        };
        writeLocal(LOCAL_ADS_KEY, [created, ...readLocal<AdCampaignDraft[]>(LOCAL_ADS_KEY, [])]);
        return created;
      }
      return data as AdCampaignDraft;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-ad-campaigns", businessId] });
    },
  });
}

export function creatorCommercialProfileQuery(userId?: string | undefined) {
  return queryOptions({
    queryKey: ["creator-commercial-profile", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<CreatorCommercialProfile> => {
      const empty: CreatorCommercialProfile = {
        user_id: userId ?? "",
        open_for_sponsorships: false,
        open_for_brand_deals: false,
        portfolio_summary: "",
        rate_card_notes: "",
        enquiry_email: null,
        media_kit_url: null,
      };
      if (!userId) return empty;
      const { data, error } = await (supabase as any)
        .from("creator_commercial_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        return readLocal<CreatorCommercialProfile>(`${LOCAL_CREATOR_COMM_PREFIX}${userId}`, empty);
      }
      return (data as CreatorCommercialProfile | null) ?? empty;
    },
  });
}

export function useSaveCreatorCommercialProfile(userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profile: Omit<CreatorCommercialProfile, "user_id">) => {
      if (!userId) throw new Error("Sign in required.");
      const payload = {
        user_id: userId,
        ...profile,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("creator_commercial_profiles")
        .upsert(payload, { onConflict: "user_id" });
      if (error) {
        if (!isMissingPhase4Schema(error)) throw error;
        writeLocal(`${LOCAL_CREATOR_COMM_PREFIX}${userId}`, payload);
      }
      return payload;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["creator-commercial-profile", userId] });
    },
  });
}
