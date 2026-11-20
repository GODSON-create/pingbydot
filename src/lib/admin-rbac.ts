/**
 * Ping by DOT — Appointment-Based Administrator RBAC & Module Policy
 *
 * Implements the 7 configurable administrative roles and granular per-permission
 * evaluation mirrored by PostgreSQL migration `0035_admin_control_centre_and_early_access.sql`.
 *
 * Security invariants:
 * - Only the Platform Owner can appoint/revoke administrators, assign roles,
 *   toggle individual per-user permission overrides, and view full admin activity.
 * - Ordinary administrators cannot appoint other administrators unless explicitly
 *   granted `admin.appoint_admins` by the Platform Owner.
 * - Self-escalation is unconditionally forbidden.
 * - Private message content is NEVER exposed in any administrative module.
 */

export const ADMIN_ROLES = [
  "platform_owner",
  "admin",
  "moderator",
  "support",
  "analyst",
  "finance_admin",
  "community_admin",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Backward-compatible specialist roles introduced in migration 0034. */
export const LEGACY_SPECIALIST_ROLES = [
  "spotlight_editor",
  "financial_admin",
  "learn_admin",
] as const;

export type AnyStaffRole = AdminRole | (typeof LEGACY_SPECIALIST_ROLES)[number];

export interface AdminRoleDefinition {
  role: AdminRole;
  label: string;
  description: string;
  appointableViaUi: boolean;
  defaultPermissions: readonly AdminPermission[];
}

export const ADMIN_PERMISSIONS = [
  "overview.view",
  "people.view",
  "people.verify",
  "content.view",
  "content.moderate",
  "communities.view",
  "communities.manage",
  "communications.view_metrics",
  "economy.view",
  "economy.manage_plans",
  "economy.moderate_boosts",
  "business.view",
  "business.manage",
  "growth.view",
  "learn.manage_schedule",
  "system.view_health",
  "admin.view_staff",
  "admin.view_audit",
  "admin.appoint_admins",
  "admin.revoke_admins",
  "admin.manage_permissions",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_LABELS: Record<
  AdminPermission,
  { label: string; module: AdminModuleId; sensitive?: boolean }
> = {
  "overview.view": { label: "View Platform Overview", module: "overview" },
  "people.view": { label: "View Accounts & Profiles", module: "people" },
  "people.verify": { label: "Review Account & Signal Verifications", module: "people" },
  "content.view": { label: "Inspect Pings, Moments, Clips & Reports", module: "content" },
  "content.moderate": { label: "Hide/Restore Content & Resolve Reports", module: "content" },
  "communities.view": { label: "View Hubs & Signals Metrics", module: "communities" },
  "communities.manage": {
    label: "Manage Signals Verification & Community Safety",
    module: "communities",
  },
  "communications.view_metrics": {
    label: "View Aggregate Messaging Delivery Metrics (No Message Bodies)",
    module: "communications",
  },
  "economy.view": { label: "View DOT Economy, Subscriptions & Boosts", module: "economy" },
  "economy.manage_plans": {
    label: "Configure Membership Plans & Pricing",
    module: "economy",
    sensitive: true,
  },
  "economy.moderate_boosts": {
    label: "Moderate & Refund Boost Campaigns",
    module: "economy",
    sensitive: true,
  },
  "business.view": { label: "View Business Profiles & Storefronts", module: "business" },
  "business.manage": { label: "Manage Business Verification & Leads", module: "business" },
  "growth.view": { label: "View Referrals, Early Access & Downloads", module: "growth" },
  "learn.manage_schedule": { label: "Configure Ping Learn Release Schedule", module: "growth" },
  "system.view_health": {
    label: "View System Health, Errors & Failed Jobs",
    module: "system_health",
  },
  "admin.view_staff": { label: "View Appointed Administrators", module: "administration" },
  "admin.view_audit": { label: "View Administrative Activity Audit Log", module: "administration" },
  "admin.appoint_admins": {
    label: "Appoint Administrators (Owner-Delegated)",
    module: "administration",
    sensitive: true,
  },
  "admin.revoke_admins": {
    label: "Revoke Administrator Access (Owner Only)",
    module: "administration",
    sensitive: true,
  },
  "admin.manage_permissions": {
    label: "Assign/Revoke Individual Permissions (Owner Only)",
    module: "administration",
    sensitive: true,
  },
};

export const ADMIN_MODULES = [
  "overview",
  "people",
  "content",
  "communities",
  "communications",
  "economy",
  "business",
  "growth",
  "system_health",
  "administration",
] as const;

export type AdminModuleId = (typeof ADMIN_MODULES)[number];

export interface AdminModuleDescriptor {
  id: AdminModuleId;
  label: string;
  shortLabel: string;
  requiredPermission: AdminPermission;
  description: string;
}

export const ADMIN_MODULE_DESCRIPTORS: readonly AdminModuleDescriptor[] = [
  {
    id: "overview",
    label: "1. Overview",
    shortLabel: "Overview",
    requiredPermission: "overview.view",
    description:
      "Real-time platform pulse, accounts, DAU/WAU/MAU, online presence, and activity totals.",
  },
  {
    id: "people",
    label: "2. People",
    shortLabel: "People",
    requiredPermission: "people.view",
    description: "User directory, new registrations, and identity/business verification reviews.",
  },
  {
    id: "content",
    label: "3. Content",
    shortLabel: "Content",
    requiredPermission: "content.view",
    description: "Published Pings, Moments, Clips, Repings, moderation queue, and report outcomes.",
  },
  {
    id: "communities",
    label: "4. Communities",
    shortLabel: "Communities",
    requiredPermission: "communities.view",
    description: "Hubs, memberships, Signals, followers, and institutional Signal verification.",
  },
  {
    id: "communications",
    label: "5. Communications",
    shortLabel: "Communications",
    requiredPermission: "communications.view_metrics",
    description:
      "Aggregate message throughput and delivery failure telemetry. Private message bodies are never exposed.",
  },
  {
    id: "economy",
    label: "6. Economy",
    shortLabel: "Economy",
    requiredPermission: "economy.view",
    description:
      "DOT ledger activity, Builder Plus/Pro subscriptions, Boost campaigns, and economic readiness.",
  },
  {
    id: "business",
    label: "7. Business",
    shortLabel: "Business",
    requiredPermission: "business.view",
    description:
      "Business profiles, storefronts, customer enquiries, and commercial partnership readiness.",
  },
  {
    id: "growth",
    label: "8. Growth",
    shortLabel: "Growth",
    requiredPermission: "growth.view",
    description:
      "Referral links, download attribution across external sites, early-access signups, and Ping Learn progression.",
  },
  {
    id: "system_health",
    label: "9. System Health",
    shortLabel: "System Health",
    requiredPermission: "system.view_health",
    description:
      "Database telemetry status, application errors, failed background jobs, and migration readiness.",
  },
  {
    id: "administration",
    label: "10. Administration",
    shortLabel: "Administration",
    requiredPermission: "admin.view_audit",
    description:
      "Platform Owner staff appointments, granular permission overrides, and immutable audit trails.",
  },
];

export const ADMIN_ROLE_DEFINITIONS: Record<AdminRole, AdminRoleDefinition> = {
  platform_owner: {
    role: "platform_owner",
    label: "Platform Owner",
    description:
      "Supreme governance authority. Sole default authority to appoint/revoke admins, assign roles, grant/revoke individual permissions, and audit all administrative activity.",
    appointableViaUi: false,
    defaultPermissions: [...ADMIN_PERMISSIONS],
  },
  admin: {
    role: "admin",
    label: "Administrator",
    description:
      "Senior operations administrator across people, content, communities, economy, business, and system health. Cannot appoint or revoke other administrators unless explicitly granted permission by the Platform Owner.",
    appointableViaUi: true,
    defaultPermissions: [
      "overview.view",
      "people.view",
      "people.verify",
      "content.view",
      "content.moderate",
      "communities.view",
      "communities.manage",
      "communications.view_metrics",
      "economy.view",
      "economy.manage_plans",
      "economy.moderate_boosts",
      "business.view",
      "business.manage",
      "growth.view",
      "learn.manage_schedule",
      "system.view_health",
      "admin.view_staff",
      "admin.view_audit",
    ],
  },
  moderator: {
    role: "moderator",
    label: "Moderator",
    description:
      "Trust & safety reviewer handling reported Pings, Clips, Moments, and content visibility actions with mandatory audit reasons.",
    appointableViaUi: true,
    defaultPermissions: [
      "overview.view",
      "content.view",
      "content.moderate",
      "communities.view",
      "admin.view_audit",
    ],
  },
  support: {
    role: "support",
    label: "Support",
    description:
      "Member and business support specialist inspecting accounts, verification applications, delivery health metrics (never private message text), and early-access registrations.",
    appointableViaUi: true,
    defaultPermissions: [
      "overview.view",
      "people.view",
      "people.verify",
      "communications.view_metrics",
      "business.view",
      "growth.view",
      "system.view_health",
    ],
  },
  analyst: {
    role: "analyst",
    label: "Analyst",
    description:
      "Read-only analytics role inspecting real platform metrics, growth referrals, download attribution, economy aggregates, and system health without mutation rights.",
    appointableViaUi: true,
    defaultPermissions: [
      "overview.view",
      "people.view",
      "content.view",
      "communities.view",
      "communications.view_metrics",
      "economy.view",
      "business.view",
      "growth.view",
      "system.view_health",
    ],
  },
  finance_admin: {
    role: "finance_admin",
    label: "Finance Administrator",
    description:
      "Economic governance administrator managing DOT membership plans, Boost campaign refunds, economic readiness, and business commercial oversight.",
    appointableViaUi: true,
    defaultPermissions: [
      "overview.view",
      "economy.view",
      "economy.manage_plans",
      "economy.moderate_boosts",
      "business.view",
      "business.manage",
      "admin.view_audit",
    ],
  },
  community_admin: {
    role: "community_admin",
    label: "Community Administrator",
    description:
      "Community ecosystem lead overseeing Hubs, Signals verification, Ping Learn schedules, and community content moderation.",
    appointableViaUi: true,
    defaultPermissions: [
      "overview.view",
      "people.view",
      "content.view",
      "content.moderate",
      "communities.view",
      "communities.manage",
      "growth.view",
      "learn.manage_schedule",
    ],
  },
};

export interface UserPermissionOverride {
  permission: AdminPermission;
  effect: "grant" | "revoke";
}

export interface EffectiveAdminAccess {
  isAdmin: boolean;
  isPlatformOwner: boolean;
  roles: AnyStaffRole[];
  permissions: AdminPermission[];
}

/**
 * Deterministically resolves a user's effective permission set from their
 * appointed roles and Platform-Owner-assigned individual overrides.
 *
 * Rules:
 * 1. `platform_owner` always receives every permission.
 * 2. Ordinary users (no recognized admin role) receive ZERO permissions even if stray
 *    override rows exist.
 * 3. `revoke` overrides remove a permission granted by a role.
 * 4. `grant` overrides add an individual permission granted by the Platform Owner.
 */
export function resolveEffectiveAdminPermissions(
  roles: readonly string[],
  overrides: readonly UserPermissionOverride[] = [],
): EffectiveAdminAccess {
  const normalizedRoles = Array.from(
    new Set(
      roles.filter(
        (r): r is AnyStaffRole =>
          (ADMIN_ROLES as readonly string[]).includes(r) ||
          (LEGACY_SPECIALIST_ROLES as readonly string[]).includes(r),
      ),
    ),
  );

  const isPlatformOwner = normalizedRoles.includes("platform_owner");
  if (isPlatformOwner) {
    return {
      isAdmin: true,
      isPlatformOwner: true,
      roles: normalizedRoles,
      permissions: [...ADMIN_PERMISSIONS],
    };
  }

  const recognizedAdminRoles = normalizedRoles.filter((r): r is AdminRole =>
    (ADMIN_ROLES as readonly string[]).includes(r),
  );

  const permSet = new Set<AdminPermission>();

  for (const role of recognizedAdminRoles) {
    for (const perm of ADMIN_ROLE_DEFINITIONS[role].defaultPermissions) {
      permSet.add(perm);
    }
  }

  // Legacy specialist roles from migration 0034 map cleanly to scoped capabilities
  if (normalizedRoles.includes("financial_admin")) {
    for (const perm of ADMIN_ROLE_DEFINITIONS.finance_admin.defaultPermissions) {
      permSet.add(perm);
    }
  }
  if (normalizedRoles.includes("learn_admin")) {
    permSet.add("overview.view");
    permSet.add("growth.view");
    permSet.add("learn.manage_schedule");
  }

  // Only appointed staff may hold individual overrides
  const hasStaffRole =
    recognizedAdminRoles.length > 0 ||
    normalizedRoles.includes("financial_admin") ||
    normalizedRoles.includes("learn_admin");

  if (!hasStaffRole) {
    return {
      isAdmin: false,
      isPlatformOwner: false,
      roles: normalizedRoles,
      permissions: [],
    };
  }

  for (const ov of overrides) {
    if (!(ADMIN_PERMISSIONS as readonly string[]).includes(ov.permission)) continue;
    // Owner-exclusive governance permissions can never be delegated via overrides
    if (
      ov.effect === "grant" &&
      (ov.permission === "admin.revoke_admins" || ov.permission === "admin.manage_permissions")
    ) {
      continue;
    }
    if (ov.effect === "revoke") {
      permSet.delete(ov.permission);
    } else if (ov.effect === "grant") {
      permSet.add(ov.permission);
    }
  }

  const permissions = Array.from(permSet);
  return {
    isAdmin: permissions.length > 0,
    isPlatformOwner: false,
    roles: normalizedRoles,
    permissions,
  };
}

export function hasAdminPermission(
  access: Pick<EffectiveAdminAccess, "isPlatformOwner" | "permissions"> | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!access) return false;
  if (access.isPlatformOwner) return true;
  return access.permissions.includes(permission);
}

export function getAccessibleAdminModules(
  access: Pick<EffectiveAdminAccess, "isPlatformOwner" | "permissions"> | null | undefined,
): AdminModuleDescriptor[] {
  return ADMIN_MODULE_DESCRIPTORS.filter((m) => hasAdminPermission(access, m.requiredPermission));
}

export interface RoleMutationDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Pure policy check verifying whether `actor` may appoint or revoke `targetUserId`
 * for `targetRole`. Mirrored identically on the PostgreSQL server (`owner_appoint_admin`
 * / `owner_revoke_admin` / `owner_set_user_permission`).
 */
export function evaluateAdminRoleMutation(params: {
  action: "appoint" | "revoke" | "set_permission";
  actorId: string;
  actorAccess: EffectiveAdminAccess;
  targetUserId: string;
  targetRole?: AdminRole | undefined;
}): RoleMutationDecision {
  const { action, actorId, actorAccess, targetUserId, targetRole } = params;

  if (!actorId || !targetUserId) {
    return { allowed: false, reason: "Actor and target account identifiers are required." };
  }
  if (actorId === targetUserId) {
    return {
      allowed: false,
      reason: "Self-escalation or self-modification of administrative privileges is forbidden.",
    };
  }
  if (targetRole === "platform_owner") {
    return {
      allowed: false,
      reason: "Platform Owner cannot be assigned or revoked through standard UI/RPC calls.",
    };
  }
  if (action === "appoint") {
    if (actorAccess.isPlatformOwner || hasAdminPermission(actorAccess, "admin.appoint_admins")) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        "Only the Platform Owner (or an administrator explicitly granted admin.appoint_admins by the Platform Owner) can appoint administrators.",
    };
  }
  if (action === "revoke") {
    if (actorAccess.isPlatformOwner) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Only the Platform Owner can revoke administrator access.",
    };
  }
  if (action === "set_permission") {
    if (actorAccess.isPlatformOwner) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Only the Platform Owner can assign or revoke individual administrator permissions.",
    };
  }
  return { allowed: false, reason: "Unsupported governance action." };
}

export function formatAdminRoleLabel(role: string): string {
  if ((ADMIN_ROLES as readonly string[]).includes(role)) {
    return ADMIN_ROLE_DEFINITIONS[role as AdminRole].label;
  }
  if (role === "spotlight_editor") return "Spotlight Editor";
  if (role === "financial_admin") return "Finance Administrator (Legacy)";
  if (role === "learn_admin") return "Learn Administrator (Legacy)";
  return role;
}
