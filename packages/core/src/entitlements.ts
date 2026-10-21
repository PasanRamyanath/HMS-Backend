/**
 * Module Entitlement & Tier Feature Flag Access Control
 * Sri Lankan Cloud SaaS Hotel Management System
 */

export {
  type ModuleEntitlementKey,
  type PlanTier,
  type TenantSubscriptionState,
  assertModuleEntitled,
  canCreateBanquetBooking,
  canCreateReservation,
  canRunPayroll,
  hasModuleEntitlement,
  validateRoomCountQuota,
} from "./tenant/hasModuleEntitlement.js";
