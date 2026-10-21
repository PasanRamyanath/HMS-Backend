/**
 * Pure Zero-Dependency Hospitality Domain Engine: Tenant Module Entitlement Guard.
 * (`packages/core/src/tenant/hasModuleEntitlement.ts`)
 *
 * Enforces SaaS subscription plan boundaries and feature flags across AppSync mutations:
 * - STARTER_QR_ONLY: Contactless QR menu, KDS kitchen, LankaQR Pay.
 * - GROWTH_PMS_PLUS_QR: Front-desk PMS, Tape Chart, Housekeeping, Statutory Tax.
 * - ENTERPRISE_RESORT_ERP: All 13 modules including Banquets, Spa, Procurement, EPF/ETF Payroll.
 *
 * Guarantees:
 * - Pure TypeScript with zero runtime npm dependencies.
 * - Returns explicit Result<boolean, DomainError> with error code ENTITLEMENT_MODULE_DISABLED.
 * - Rejects room reservation creation if tenant plan is STARTER_QR_ONLY.
 */

import { type DomainError, type Result, domainErr, ok } from "../result.js";

export type PlanTier = "STARTER_QR_ONLY" | "GROWTH_PMS_PLUS_QR" | "ENTERPRISE_RESORT_ERP";

export type SubscriptionStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";

export type ModuleEntitlementKey =
  | "qrMenuAndOrdering"
  | "kdsKitchen"
  | "lankaQrPay"
  | "frontDeskPms"
  | "tapeChart"
  | "housekeeping"
  | "banquets"
  | "spaAndActivities"
  | "storesAndInventory"
  | "taxSltdaIrd"
  | "payrollEpfEtf"
  | "multiProperty"
  | "auditLogSha256";

export interface TenantSubscriptionState {
  readonly tenantId: string;
  readonly planTier: PlanTier;
  readonly status: SubscriptionStatus;
  readonly activeAddOns?: ReadonlyArray<string> | undefined;
  readonly customOverrides?: Readonly<Record<string, boolean>> | undefined;
  readonly maxRooms?: number | undefined;
  readonly currentRoomCount?: number | undefined;
}

export const TIER_INCLUDED_MODULES: Record<PlanTier, ReadonlySet<ModuleEntitlementKey>> = {
  STARTER_QR_ONLY: new Set<ModuleEntitlementKey>(["qrMenuAndOrdering", "kdsKitchen", "lankaQrPay"]),
  GROWTH_PMS_PLUS_QR: new Set<ModuleEntitlementKey>([
    "qrMenuAndOrdering",
    "kdsKitchen",
    "lankaQrPay",
    "frontDeskPms",
    "tapeChart",
    "housekeeping",
    "taxSltdaIrd",
    "auditLogSha256",
  ]),
  ENTERPRISE_RESORT_ERP: new Set<ModuleEntitlementKey>([
    "qrMenuAndOrdering",
    "kdsKitchen",
    "lankaQrPay",
    "frontDeskPms",
    "tapeChart",
    "housekeeping",
    "banquets",
    "spaAndActivities",
    "storesAndInventory",
    "taxSltdaIrd",
    "payrollEpfEtf",
    "multiProperty",
    "auditLogSha256",
  ]),
};

export const TIER_ROOM_LIMITS: Record<PlanTier, number> = {
  STARTER_QR_ONLY: 15,
  GROWTH_PMS_PLUS_QR: 40,
  ENTERPRISE_RESORT_ERP: 10000, // Unlimited
};

/**
 * Checks whether a tenant is entitled to use a specific hospitality module.
 * Returns ok(true) when entitled, or domainErr("ENTITLEMENT_MODULE_DISABLED" | "SUBSCRIPTION_INACTIVE") when restricted.
 */
export function hasModuleEntitlement(
  tenant: TenantSubscriptionState,
  moduleKey: ModuleEntitlementKey,
): Result<boolean, DomainError> {
  // 1. Subscription status check
  if (tenant.status !== "ACTIVE") {
    return domainErr(
      "SUBSCRIPTION_INACTIVE",
      `Tenant '${tenant.tenantId}' subscription is ${tenant.status}. Access to module '${moduleKey}' denied.`,
      { tenantId: tenant.tenantId, status: tenant.status, moduleKey },
    );
  }

  // 2. Custom override check (explicit boolean overrides plan defaults)
  if (tenant.customOverrides && typeof tenant.customOverrides[moduleKey] === "boolean") {
    const isOverriddenActive = Boolean(tenant.customOverrides[moduleKey]);
    if (isOverriddenActive) {
      return ok(true);
    }
    return domainErr(
      "ENTITLEMENT_MODULE_DISABLED",
      `Module '${moduleKey}' is explicitly disabled by administrative override for tenant '${tenant.tenantId}'.`,
      { tenantId: tenant.tenantId, moduleKey, override: false },
    );
  }

  // 3. Plan tier default included modules
  const tierModules = TIER_INCLUDED_MODULES[tenant.planTier];
  if (tierModules?.has(moduleKey)) {
    return ok(true);
  }

  // 4. Add-on module check
  if (tenant.activeAddOns?.includes(moduleKey)) {
    return ok(true);
  }

  // 5. Entitlement rejection
  return domainErr(
    "ENTITLEMENT_MODULE_DISABLED",
    `Tenant '${tenant.tenantId}' on plan '${tenant.planTier}' is not entitled to module '${moduleKey}'. Upgrade plan or activate module add-on.`,
    {
      tenantId: tenant.tenantId,
      planTier: tenant.planTier,
      requiredModule: moduleKey,
    },
  );
}

/**
 * Asserts module entitlement, returning Result<true, DomainError>.
 */
export function assertModuleEntitled(
  tenant: TenantSubscriptionState,
  moduleKey: ModuleEntitlementKey,
): Result<true, DomainError> {
  const result = hasModuleEntitlement(tenant, moduleKey);
  if (!result.ok) {
    return result;
  }
  return ok(true);
}

/**
 * Rung 2: Guard room reservation creation mutations in AppSync resolvers.
 * Rejects reservation if tenant plan is STARTER_QR_ONLY without frontDeskPms entitlement.
 */
export function canCreateReservation(tenant: TenantSubscriptionState): Result<true, DomainError> {
  const check = hasModuleEntitlement(tenant, "frontDeskPms");
  if (!check.ok) {
    return check;
  }
  return ok(true);
}

/**
 * Guard banquet booking creation mutations in AppSync resolvers.
 * Rejects banquet event order if tenant does not have banquets entitlement.
 */
export function canCreateBanquetBooking(
  tenant: TenantSubscriptionState,
): Result<true, DomainError> {
  const check = hasModuleEntitlement(tenant, "banquets");
  if (!check.ok) {
    return check;
  }
  return ok(true);
}

/**
 * Guard monthly payroll / EPF / ETF return runs in AppSync resolvers.
 * Rejects payroll execution if tenant does not have payrollEpfEtf entitlement.
 */
export function canRunPayroll(tenant: TenantSubscriptionState): Result<true, DomainError> {
  const check = hasModuleEntitlement(tenant, "payrollEpfEtf");
  if (!check.ok) {
    return check;
  }
  return ok(true);
}

/**
 * Validates whether a tenant's room count exceeds their plan limit.
 */
export function validateRoomCountQuota(
  tenant: TenantSubscriptionState,
  desiredRoomCount: number,
): Result<boolean, DomainError> {
  const limit = tenant.maxRooms ?? TIER_ROOM_LIMITS[tenant.planTier];
  if (desiredRoomCount > limit) {
    return domainErr(
      "PLAN_LIMITATION",
      `Room count ${desiredRoomCount} exceeds maximum limit of ${limit} rooms on '${tenant.planTier}' plan.`,
      {
        tenantId: tenant.tenantId,
        planTier: tenant.planTier,
        limit,
        desiredRoomCount,
      },
    );
  }
  return ok(true);
}
