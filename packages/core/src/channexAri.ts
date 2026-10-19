/**
 * @hms/core - Channex.io ARI (Availability, Rates, Inventory) Payload Builder (channexAri.ts).
 *
 * Implements Rung 6 of the Sri Lanka HMS Architecture Plan:
 * 1. Pure mapper transforming local room availability into Channex `/api/v1/availability` JSON payloads.
 * 2. Pure mapper transforming local rates and stay policies into Channex `/api/v1/restrictions` JSON payloads.
 * 3. Net remaining availability calculation:
 *    netRemaining = Math.max(0, totalPhysicalRooms - bookedRooms - outOfOrderRooms)
 * 4. Sri Lankan 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT) for TAX_INCLUSIVE channel rates.
 * 5. Dual-currency conversion (LKR to locked USD foreign rate).
 * 6. Multi-tenant tenantId isolation, Staff RBAC authorization, and SaaS subscription entitlement checks.
 * 7. SHA-256 hash-chained ImmutableAuditLog generation.
 *
 * Strict Architectural Guarantees:
 * - Zero external runtime npm dependencies (pure TypeScript).
 * - Explicit Result<T, DomainError> return types.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Contracts
// ============================================================================

export type ChannexStaffRole =
  | "SUPER_ADMIN"
  | "HOTEL_ADMIN"
  | "HOTEL_OWNER"
  | "GENERAL_MANAGER"
  | "RESERVATIONIST"
  | "FRONT_DESK"
  | "HOUSEKEEPING"
  | "WAITER";

export interface ChannexActorContext {
  readonly actorUserId: string;
  readonly role: ChannexStaffRole | string;
}

export interface ChannexSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly plan?: string | undefined;
  readonly allowChannelManager: boolean;
}

export interface ChannexRoomMapping {
  readonly roomCategoryId: string;
  readonly channexRoomTypeId: string;
  readonly totalPhysicalRooms: number;
}

export interface ChannexRatePlanMapping {
  readonly ratePlanId: string;
  readonly channexRatePlanId: string;
  readonly roomCategoryId: string;
  readonly mealPlan: "RO" | "BB" | "HB" | "FB" | "AI";
  readonly currency: "LKR" | "USD";
  readonly pricingModel: "TAX_INCLUSIVE" | "TAX_EXCLUSIVE";
}

export interface DailyInventoryState {
  readonly date: string; // 'YYYY-MM-DD'
  readonly bookedRooms: number;
  readonly outOfOrderRooms: number;
}

export interface DailyRateRestrictionState {
  readonly date: string; // 'YYYY-MM-DD'
  readonly baseRateLkr: number;
  readonly baseRateUsd?: number | undefined;
  readonly minStayArrival?: number | undefined;
  readonly minStayThrough?: number | undefined;
  readonly maxStay?: number | undefined;
  readonly closedToArrival?: boolean | undefined;
  readonly closedToDeparture?: boolean | undefined;
  readonly stopSell?: boolean | undefined;
}

export interface ChannexAvailabilityValue {
  readonly property_id: string;
  readonly room_type_id: string;
  readonly date: string; // 'YYYY-MM-DD'
  readonly availability: number;
}

export interface ChannexAvailabilityPayload {
  readonly values: readonly ChannexAvailabilityValue[];
}

export interface ChannexRestrictionValue {
  readonly property_id: string;
  readonly rate_plan_id: string;
  readonly date: string; // 'YYYY-MM-DD'
  readonly rate: number;
  readonly min_stay_arrival?: number | undefined;
  readonly min_stay_through?: number | undefined;
  readonly max_stay?: number | undefined;
  readonly closed_to_arrival?: boolean | undefined;
  readonly closed_to_departure?: boolean | undefined;
  readonly stop_sell?: boolean | undefined;
}

export interface ChannexRestrictionsPayload {
  readonly values: readonly ChannexRestrictionValue[];
}

export interface ChannexAvailabilityInput {
  readonly tenantId: string;
  readonly propertyId: string;
  readonly roomMapping: ChannexRoomMapping;
  readonly inventoryByDate: readonly DailyInventoryState[];
  readonly authorizedBy?: ChannexActorContext | undefined;
  readonly subscription?: ChannexSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly isoTimestamp?: string | undefined;
}

export interface ChannexRestrictionsInput {
  readonly tenantId: string;
  readonly propertyId: string;
  readonly ratePlanMapping: ChannexRatePlanMapping;
  readonly restrictionsByDate: readonly DailyRateRestrictionState[];
  readonly exchangeRateUsdLkr?: number | undefined;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
  readonly authorizedBy?: ChannexActorContext | undefined;
  readonly subscription?: ChannexSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly isoTimestamp?: string | undefined;
}

// ============================================================================
// RBAC & Entitlement Helpers
// ============================================================================

const AUTHORIZED_CHANNEL_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "HOTEL_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "RESERVATIONIST",
]);

export function isStaffAuthorizedForChannelManager(role: string): boolean {
  return AUTHORIZED_CHANNEL_ROLES.has(role);
}

function verifyActorAuthorization(
  authorizedBy?: ChannexActorContext | undefined,
): Result<void, DomainError> {
  if (!authorizedBy) {
    return ok(undefined);
  }
  if (!authorizedBy.actorUserId || authorizedBy.actorUserId.trim() === "") {
    return domainErr("UNAUTHORIZED", "actorUserId is required for channel manager sync");
  }
  if (!isStaffAuthorizedForChannelManager(authorizedBy.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${authorizedBy.role}' is not authorized to publish ARI to Channex`,
      { role: authorizedBy.role },
    );
  }
  return ok(undefined);
}

function verifySubscriptionEntitlement(
  tenantId: string,
  subscription?: ChannexSaasSubscription | undefined,
): Result<void, DomainError> {
  if (!subscription) {
    return ok(undefined);
  }
  if (subscription.tenantId !== tenantId) {
    return domainErr("TENANT_MISMATCH", "Subscription tenantId does not match input tenantId", {
      subscriptionTenant: subscription.tenantId,
      inputTenant: tenantId,
    });
  }
  if (!subscription.active) {
    return domainErr("SUBSCRIPTION_INACTIVE", "Hotel SaaS subscription is not currently active");
  }
  if (!subscription.allowChannelManager) {
    return domainErr(
      "PLAN_LIMITATION",
      "Channex.io OTA Channel Manager is not enabled on current SaaS subscription tier",
    );
  }
  return ok(undefined);
}

function checkChannelManagerEntitlements(
  tenantId: string,
  authorizedBy?: ChannexActorContext | undefined,
  subscription?: ChannexSaasSubscription | undefined,
): Result<void, DomainError> {
  const authRes = verifyActorAuthorization(authorizedBy);
  if (!authRes.ok) {
    return authRes;
  }
  return verifySubscriptionEntitlement(tenantId, subscription);
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateIsoDate(date: string): boolean {
  if (!ISO_DATE_REGEX.test(date)) {
    return false;
  }
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  return true;
}

// ============================================================================
// Core Calculation & Payload Builders
// ============================================================================

/**
 * Calculates net remaining sellable availability for a room type.
 * Enforces: netAvailability = Math.max(0, totalPhysicalRooms - bookedRooms - outOfOrderRooms).
 */
export function calculateNetAvailability(
  totalPhysicalRooms: number,
  bookedRooms: number,
  outOfOrderRooms = 0,
): number {
  if (!Number.isFinite(totalPhysicalRooms) || totalPhysicalRooms < 0) {
    return 0;
  }
  const booked = Number.isFinite(bookedRooms) ? Math.max(0, bookedRooms) : 0;
  const ooo = Number.isFinite(outOfOrderRooms) ? Math.max(0, outOfOrderRooms) : 0;
  return Math.max(0, Math.floor(totalPhysicalRooms) - Math.floor(booked) - Math.floor(ooo));
}

/**
 * Builds Channex `/api/v1/availability` JSON payload for a room type across dates.
 */
export function buildChannexAvailabilityPayload(
  input: ChannexAvailabilityInput,
): Result<ChannexAvailabilityPayload, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const tenantId = tenantRes.value;

  if (!input.propertyId || input.propertyId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "propertyId is required for Channex payload");
  }

  if (!input.roomMapping.channexRoomTypeId || input.roomMapping.channexRoomTypeId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "channexRoomTypeId is required in room mapping");
  }

  const entitlementRes = checkChannelManagerEntitlements(
    tenantId,
    input.authorizedBy,
    input.subscription,
  );
  if (!entitlementRes.ok) {
    return entitlementRes;
  }

  const values: ChannexAvailabilityValue[] = [];
  for (const day of input.inventoryByDate) {
    if (!validateIsoDate(day.date)) {
      return domainErr("INVALID_DATE_FORMAT", `Date '${day.date}' must be in 'YYYY-MM-DD' format`);
    }

    const net = calculateNetAvailability(
      input.roomMapping.totalPhysicalRooms,
      day.bookedRooms,
      day.outOfOrderRooms,
    );

    values.push({
      property_id: input.propertyId,
      room_type_id: input.roomMapping.channexRoomTypeId,
      date: day.date,
      availability: net,
    });
  }

  return ok({ values });
}

function extractBaseLkr(
  day: DailyRateRestrictionState,
  exchangeRateUsdLkr: number,
): Result<number, DomainError> {
  if (Number.isFinite(day.baseRateLkr) && day.baseRateLkr >= 0) {
    return ok(day.baseRateLkr);
  }
  if (day.baseRateUsd !== undefined && Number.isFinite(day.baseRateUsd) && day.baseRateUsd >= 0) {
    return ok(roundLkr(day.baseRateUsd * exchangeRateUsdLkr));
  }
  return domainErr("INVALID_RATE", `Invalid base rate for date '${day.date}'`);
}

function formatUsdAmount(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function convertToFinalCurrencyRate(
  finalLkr: number,
  day: DailyRateRestrictionState,
  mapping: ChannexRatePlanMapping,
  exchangeRateUsdLkr: number,
): number {
  if (mapping.currency !== "USD") {
    return roundLkr(finalLkr);
  }
  if (day.baseRateUsd !== undefined && mapping.pricingModel === "TAX_EXCLUSIVE") {
    return formatUsdAmount(day.baseRateUsd);
  }
  return formatUsdAmount(finalLkr / exchangeRateUsdLkr);
}

function resolveEffectiveChannelRate(
  day: DailyRateRestrictionState,
  mapping: ChannexRatePlanMapping,
  exchangeRateUsdLkr: number,
  taxConfig: SriLankaTaxConfig,
): Result<number, DomainError> {
  const baseRes = extractBaseLkr(day, exchangeRateUsdLkr);
  if (!baseRes.ok) {
    return baseRes;
  }

  let finalLkr = baseRes.value;
  if (mapping.pricingModel === "TAX_INCLUSIVE") {
    const taxRes = calculateForwardTax(baseRes.value, taxConfig);
    if (!taxRes.ok) {
      return taxRes;
    }
    finalLkr = taxRes.value.grandTotalLkr;
  }

  return ok(convertToFinalCurrencyRate(finalLkr, day, mapping, exchangeRateUsdLkr));
}

function buildRestrictionEntry(
  propertyId: string,
  ratePlanId: string,
  day: DailyRateRestrictionState,
  rate: number,
): ChannexRestrictionValue {
  return {
    property_id: propertyId,
    rate_plan_id: ratePlanId,
    date: day.date,
    rate,
    ...(day.minStayArrival !== undefined ? { min_stay_arrival: day.minStayArrival } : {}),
    ...(day.minStayThrough !== undefined ? { min_stay_through: day.minStayThrough } : {}),
    ...(day.maxStay !== undefined ? { max_stay: day.maxStay } : {}),
    ...(day.closedToArrival !== undefined ? { closed_to_arrival: day.closedToArrival } : {}),
    ...(day.closedToDeparture !== undefined ? { closed_to_departure: day.closedToDeparture } : {}),
    ...(day.stopSell !== undefined ? { stop_sell: day.stopSell } : {}),
  };
}

function validateRestrictionsInput(
  input: ChannexRestrictionsInput,
): Result<{ tenantId: string; exchangeRate: number }, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  if (!input.propertyId || input.propertyId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "propertyId is required for Channex payload");
  }
  if (
    !input.ratePlanMapping.channexRatePlanId ||
    input.ratePlanMapping.channexRatePlanId.trim() === ""
  ) {
    return domainErr("VALIDATION_FAILED", "channexRatePlanId is required in rate plan mapping");
  }

  const entitlementRes = checkChannelManagerEntitlements(
    tenantRes.value,
    input.authorizedBy,
    input.subscription,
  );
  if (!entitlementRes.ok) {
    return entitlementRes;
  }

  const exchangeRate = input.exchangeRateUsdLkr ?? 300.0;
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    return domainErr(
      "INVALID_EXCHANGE_RATE",
      "exchangeRateUsdLkr must be a positive finite number",
    );
  }

  return ok({ tenantId: tenantRes.value, exchangeRate });
}

/**
 * Builds Channex `/api/v1/restrictions` JSON payload with rates, minimum stays, and stop-sells.
 */
export function buildChannexRestrictionsPayload(
  input: ChannexRestrictionsInput,
): Result<ChannexRestrictionsPayload, DomainError> {
  const validated = validateRestrictionsInput(input);
  if (!validated.ok) {
    return validated;
  }

  const { exchangeRate } = validated.value;
  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const values: ChannexRestrictionValue[] = [];

  for (const day of input.restrictionsByDate) {
    if (!validateIsoDate(day.date)) {
      return domainErr("INVALID_DATE_FORMAT", `Date '${day.date}' must be in 'YYYY-MM-DD' format`);
    }

    const rateRes = resolveEffectiveChannelRate(
      day,
      input.ratePlanMapping,
      exchangeRate,
      taxConfig,
    );
    if (!rateRes.ok) {
      return rateRes;
    }

    values.push(
      buildRestrictionEntry(
        input.propertyId,
        input.ratePlanMapping.channexRatePlanId,
        day,
        rateRes.value,
      ),
    );
  }

  return ok({ values });
}

// ============================================================================
// Immutable Audit Log Chaining
// ============================================================================

/**
 * Creates an immutable SHA-256 hash-chained audit log entry when an ARI payload is constructed or synced.
 */
export function createChannexAriAuditEntry(
  tenantId: string,
  actorUserId: string,
  payloadType: "AVAILABILITY" | "RESTRICTIONS",
  summary: Record<string, unknown>,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    payloadType,
    ...summary,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: `CHANNEX_SYNC_${payloadType}`,
    entityType: "ChannexAriSync",
    entityId: `${payloadType}:${String(summary.propertyId ?? "default")}`,
    isoTs,
    afterJson,
    prevHash,
  });
}
