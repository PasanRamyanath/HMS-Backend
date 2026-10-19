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
  type TaxBreakdownResult,
  calculateForwardTax,
  calculateReverseTax,
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

/**
 * Creates an immutable SHA-256 hash-chained audit log entry when an OTA booking revision is processed.
 */
export function createChannexBookingAuditEntry(
  tenantId: string,
  actorUserId: string,
  bookingRef: string,
  status: string,
  summary: Record<string, unknown>,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    bookingRef,
    status,
    ...summary,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: `OTA_BOOKING_${status}`,
    entityType: "Reservation",
    entityId: bookingRef,
    isoTs,
    afterJson,
    prevHash,
  });
}

// ============================================================================
// Channex Booking Revision Parser (Rung 6)
// ============================================================================

export interface ChannexRoomTypeMapping {
  readonly localRoomTypeId: string;
  readonly localRoomTypeName?: string;
  readonly defaultMealPlan?: "RO" | "BB" | "HB" | "FB" | "AI";
}

export type ChannexRoomMap = Record<string, ChannexRoomTypeMapping>;

export interface ChannexParseOptions {
  readonly tenantId?: string;
  readonly exchangeRateUsdLkr?: number;
  readonly prevAuditHash?: string;
  readonly authorizedBy?: ChannexActorContext;
  readonly subscription?: ChannexSaasSubscription;
  readonly actorUserId?: string;
  readonly isoTs?: string;
}

export interface ParsedOtaGuest {
  readonly fullName: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly countryIso: string;
  readonly residencyTier: "RESIDENT" | "NON_RESIDENT";
}

export interface ParsedOtaRoomDay {
  readonly date: string;
  readonly amountLkr: number;
}

export interface ParsedOtaRoomStay {
  readonly channexRoomTypeId: string;
  readonly localRoomTypeId: string;
  readonly localRoomTypeName: string;
  readonly mealPlan: "RO" | "BB" | "HB" | "FB" | "AI";
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly roomTotalGrossLkr: number;
  readonly days: readonly ParsedOtaRoomDay[];
}

export interface ParsedChannexReservation {
  readonly tenantId?: string;
  readonly bookingRef: string;
  readonly otaReservationCode: string;
  readonly channexBookingId: string;
  readonly channelName: string;
  readonly source: string;
  readonly status: "CONFIRMED" | "MODIFIED" | "CANCELLED";
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly nights: number;
  readonly quotedCurrency: string;
  readonly originalTotalPrice: number;
  readonly lockedExchangeRateLkr: number;
  readonly grossTotalLkr: number;
  readonly otaCommissionAmountLkr: number;
  readonly otaCommissionPercentage: number;
  readonly netPayableToHotelLkr: number;
  readonly guest: ParsedOtaGuest;
  readonly rooms: readonly ParsedOtaRoomStay[];
  readonly mealPlan: "RO" | "BB" | "HB" | "FB" | "AI";
  readonly specialRequests: string;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly auditLog?: AuditLogEntry;
}

function unpackBookingPayload(
  rawInput: string | unknown,
): Result<Record<string, unknown>, DomainError> {
  let parsed: unknown = rawInput;
  if (typeof rawInput === "string") {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      return domainErr("VALIDATION_FAILED", "Invalid JSON syntax in revisionJson");
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return domainErr("VALIDATION_FAILED", "revisionJson must be an object or JSON string");
  }

  const record = parsed as Record<string, unknown>;
  if (record.booking && typeof record.booking === "object") {
    return ok(record.booking as Record<string, unknown>);
  }
  return ok(record);
}

function parseCustomerDetails(customer: Record<string, unknown> | undefined): ParsedOtaGuest {
  if (!customer || typeof customer !== "object") {
    return {
      fullName: "OTA Guest",
      firstName: "OTA",
      lastName: "Guest",
      email: "",
      phone: "",
      countryIso: "",
      residencyTier: "NON_RESIDENT",
    };
  }

  const firstName = String(customer.name ?? customer.first_name ?? "").trim();
  const lastName = String(customer.surname ?? customer.last_name ?? "").trim();
  const rawFull = String(customer.full_name ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || rawFull || "OTA Guest";
  const countryIso = String(customer.country ?? customer.country_code ?? "")
    .trim()
    .toUpperCase();
  const isResident = countryIso === "LK" || countryIso === "LKA";

  return {
    fullName,
    firstName: firstName || fullName,
    lastName,
    email: String(customer.email ?? "").trim(),
    phone: String(customer.phone ?? customer.telephone ?? "").trim(),
    countryIso,
    residencyTier: isResident ? "RESIDENT" : "NON_RESIDENT",
  };
}

export function resolveMealPlan(
  breakfastIncluded?: boolean,
  mealPlanStr?: string,
): "RO" | "BB" | "HB" | "FB" | "AI" {
  if (breakfastIncluded) {
    return "BB";
  }
  if (!mealPlanStr) {
    return "RO";
  }
  const clean = mealPlanStr.trim().toUpperCase();
  if (clean === "BB" || clean.includes("BREAKFAST")) {
    return "BB";
  }
  if (clean === "HB" || clean.includes("HALF")) {
    return "HB";
  }
  if (clean === "FB" || clean.includes("FULL")) {
    return "FB";
  }
  if (clean === "AI" || clean.includes("ALL_INCLUSIVE")) {
    return "AI";
  }
  return "RO";
}

function extractSpecialRequests(
  booking: Record<string, unknown>,
  customer: Record<string, unknown> | undefined,
): string {
  const parts: string[] = [];
  if (typeof booking.notes === "string" && booking.notes.trim()) {
    parts.push(booking.notes.trim());
  }
  if (typeof booking.special_requests === "string" && booking.special_requests.trim()) {
    parts.push(booking.special_requests.trim());
  }
  if (customer && typeof customer.notes === "string" && customer.notes.trim()) {
    parts.push(customer.notes.trim());
  }
  return Array.from(new Set(parts)).join("; ");
}

function calculateStayNights(arrival: string, departure: string): number {
  const arr = Date.parse(arrival);
  const dep = Date.parse(departure);
  if (!Number.isFinite(arr) || !Number.isFinite(dep) || dep <= arr) {
    return 1;
  }
  return Math.max(1, Math.round((dep - arr) / 86400000));
}

function mapChannexStatus(rawStatus: unknown): "CONFIRMED" | "MODIFIED" | "CANCELLED" {
  const s = String(rawStatus ?? "new")
    .toLowerCase()
    .trim();
  if (s === "cancelled" || s === "canceled") {
    return "CANCELLED";
  }
  if (s === "modified" || s === "updated" || s === "revision") {
    return "MODIFIED";
  }
  return "CONFIRMED";
}

function calculateOtaFinancials(
  rawTotal: unknown,
  currency: string,
  exchangeRate: number,
  rawCommission: unknown,
  rawCommissionPct: unknown,
) {
  const numTotal = typeof rawTotal === "number" && Number.isFinite(rawTotal) ? rawTotal : 0;
  const isUsd = currency === "USD";
  const grossTotalLkr = roundLkr(isUsd ? numTotal * exchangeRate : numTotal);

  let commLkr = 0;
  let commPct = 0;
  if (typeof rawCommission === "number" && Number.isFinite(rawCommission) && rawCommission > 0) {
    commLkr = roundLkr(isUsd ? rawCommission * exchangeRate : rawCommission);
    commPct = grossTotalLkr > 0 ? roundLkr((commLkr / grossTotalLkr) * 100) : 0;
  } else if (
    typeof rawCommissionPct === "number" &&
    Number.isFinite(rawCommissionPct) &&
    rawCommissionPct > 0
  ) {
    commPct = roundLkr(rawCommissionPct);
    commLkr = roundLkr(grossTotalLkr * (commPct / 100));
  }

  const netPayableToHotelLkr = roundLkr(grossTotalLkr - commLkr);

  return {
    originalTotalPrice: numTotal,
    grossTotalLkr,
    otaCommissionAmountLkr: commLkr,
    otaCommissionPercentage: commPct,
    netPayableToHotelLkr,
  };
}

function extractOccupancy(rawOcc: unknown): { adults: number; children: number; infants: number } {
  const occ = (rawOcc as Record<string, unknown>) ?? {};
  const adults = typeof occ.adults === "number" ? Math.max(1, occ.adults) : 1;
  const children = typeof occ.children === "number" ? Math.max(0, occ.children) : 0;
  const infants = typeof occ.infants === "number" ? Math.max(0, occ.infants) : 0;
  return { adults, children, infants };
}

function extractRoomDays(
  rawDays: unknown,
  isUsd: boolean,
  exchangeRate: number,
): ParsedOtaRoomDay[] {
  if (!Array.isArray(rawDays)) {
    return [];
  }
  return rawDays.map((d: Record<string, unknown>) => ({
    date: String(d.date ?? ""),
    amountLkr: roundLkr(isUsd ? Number(d.amount ?? 0) * exchangeRate : Number(d.amount ?? 0)),
  }));
}

function mapBookingRoom(
  room: Record<string, unknown>,
  roomMap: ChannexRoomMap,
  arrivalDate: string,
  departureDate: string,
  currency: string,
  exchangeRate: number,
): Result<ParsedOtaRoomStay, DomainError> {
  const channexRoomTypeId = String(room.room_type_id ?? "").trim();
  if (!channexRoomTypeId) {
    return domainErr("VALIDATION_FAILED", "Missing room_type_id in room entry");
  }

  const mapping = roomMap[channexRoomTypeId];
  if (!mapping) {
    return domainErr(
      "NOT_FOUND",
      `Room type '${channexRoomTypeId}' is not mapped to any local room type`,
      { channexRoomTypeId },
    );
  }

  const breakfastIncluded = Boolean(room.breakfast_included);
  const mealPlanStr = typeof room.meal_plan === "string" ? room.meal_plan : undefined;
  const mealPlan = mapping.defaultMealPlan ?? resolveMealPlan(breakfastIncluded, mealPlanStr);

  const { adults, children, infants } = extractOccupancy(room.occupancy);
  const rawAmount = typeof room.amount === "number" ? room.amount : 0;
  const isUsd = currency === "USD";
  const roomTotalGrossLkr = roundLkr(isUsd ? rawAmount * exchangeRate : rawAmount);
  const days = extractRoomDays(room.days, isUsd, exchangeRate);

  return ok({
    channexRoomTypeId,
    localRoomTypeId: mapping.localRoomTypeId,
    localRoomTypeName: mapping.localRoomTypeName ?? mapping.localRoomTypeId,
    mealPlan,
    adults,
    children,
    infants,
    checkInDate: String(room.checkin_date ?? arrivalDate),
    checkOutDate: String(room.checkout_date ?? departureDate),
    roomTotalGrossLkr,
    days,
  });
}

function mapAllBookingRooms(
  rawRooms: unknown,
  roomMap: ChannexRoomMap,
  arrivalDate: string,
  departureDate: string,
  currency: string,
  exchangeRate: number,
): Result<ParsedOtaRoomStay[], DomainError> {
  if (!Array.isArray(rawRooms) || rawRooms.length === 0) {
    return domainErr("VALIDATION_FAILED", "Booking payload must contain at least one room entry");
  }

  const rooms: ParsedOtaRoomStay[] = [];
  for (const rawRoom of rawRooms) {
    if (!rawRoom || typeof rawRoom !== "object") {
      return domainErr("VALIDATION_FAILED", "Invalid room entry structure in rooms array");
    }
    const mappedRes = mapBookingRoom(
      rawRoom as Record<string, unknown>,
      roomMap,
      arrivalDate,
      departureDate,
      currency,
      exchangeRate,
    );
    if (!mappedRes.ok) {
      return mappedRes;
    }
    rooms.push(mappedRes.value);
  }

  return ok(rooms);
}

interface BookingIdentifiers {
  readonly channexBookingId: string;
  readonly otaReservationCode: string;
  readonly channelName: string;
  readonly source: string;
  readonly status: "CONFIRMED" | "MODIFIED" | "CANCELLED";
}

function resolveBookingIdentifiers(
  booking: Record<string, unknown>,
): Result<BookingIdentifiers, DomainError> {
  const channexBookingId = String(booking.id ?? "").trim();
  if (!channexBookingId) {
    return domainErr("VALIDATION_FAILED", "Missing Channex booking id");
  }
  const otaReservationCode = String(booking.ota_reservation_code ?? channexBookingId).trim();
  const channelName = String(booking.ota_name ?? booking.channel_id ?? "Channex").trim();
  const source = `OTA_${channelName.toUpperCase().replace(/\s+/g, "_")}`;
  const status = mapChannexStatus(booking.status);
  return ok({ channexBookingId, otaReservationCode, channelName, source, status });
}

interface BookingDates {
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly nights: number;
}

function resolveBookingDates(booking: Record<string, unknown>): Result<BookingDates, DomainError> {
  const checkInDate = String(booking.arrival_date ?? booking.checkin_date ?? "").trim();
  const checkOutDate = String(booking.departure_date ?? booking.checkout_date ?? "").trim();
  if (!validateIsoDate(checkInDate) || !validateIsoDate(checkOutDate)) {
    return domainErr(
      "INVALID_DATE_FORMAT",
      "arrival_date and departure_date must be in YYYY-MM-DD format",
    );
  }
  const nights = calculateStayNights(checkInDate, checkOutDate);
  return ok({ checkInDate, checkOutDate, nights });
}

function resolveExchangeRate(options?: ChannexParseOptions): Result<number, DomainError> {
  const exchangeRate = options?.exchangeRateUsdLkr ?? 300.0;
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    return domainErr(
      "INVALID_EXCHANGE_RATE",
      "exchangeRateUsdLkr must be a positive finite number",
    );
  }
  return ok(exchangeRate);
}

function validateBookingTenantAndEntitlements(
  booking: Record<string, unknown>,
  options?: ChannexParseOptions,
): Result<string | undefined, DomainError> {
  const tenantId =
    options?.tenantId ?? (typeof booking.tenantId === "string" ? booking.tenantId : undefined);
  if (!tenantId) {
    return ok(undefined);
  }
  const tenantRes = validateTenantId(tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const entitlementRes = checkChannelManagerEntitlements(
    tenantRes.value,
    options?.authorizedBy,
    options?.subscription,
  );
  if (!entitlementRes.ok) {
    return entitlementRes;
  }
  return ok(tenantRes.value);
}

function createRevisionAuditLogIfTenant(
  tenantId: string | undefined,
  bookingRef: string,
  status: string,
  channexBookingId: string,
  channelName: string,
  grossTotalLkr: number,
  commissionLkr: number,
  options?: ChannexParseOptions,
): AuditLogEntry | undefined {
  if (!tenantId) {
    return undefined;
  }
  const actorUserId =
    options?.actorUserId ?? options?.authorizedBy?.actorUserId ?? "CHANNEX_WEBHOOK_INGRESS";
  const isoTs = options?.isoTs ?? new Date().toISOString();
  const auditRes = createChannexBookingAuditEntry(
    tenantId,
    actorUserId,
    bookingRef,
    status,
    {
      channexBookingId,
      channelName,
      grossTotalLkr,
      commissionLkr,
    },
    isoTs,
    options?.prevAuditHash,
  );
  return auditRes.ok ? auditRes.value : undefined;
}

/**
 * Parses a Channex Booking Revision payload (from Booking.com, Agoda, Expedia, etc.),
 * maps rooms to internal hotel room types, calculates OTA commission, extracts guest info,
 * and derives the 4-stage reverse tax breakdown (SC -> TDL -> SSCL -> VAT).
 */
export function parseChannexBookingRevision(
  revisionJson: string | unknown,
  roomMap: ChannexRoomMap,
  taxConfig: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
  options?: ChannexParseOptions,
): Result<ParsedChannexReservation, DomainError> {
  const unpackRes = unpackBookingPayload(revisionJson);
  if (!unpackRes.ok) {
    return unpackRes;
  }
  const booking = unpackRes.value;

  const tenantRes = validateBookingTenantAndEntitlements(booking, options);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const tenantId = tenantRes.value;

  const idRes = resolveBookingIdentifiers(booking);
  if (!idRes.ok) {
    return idRes;
  }
  const identifiers = idRes.value;

  const datesRes = resolveBookingDates(booking);
  if (!datesRes.ok) {
    return datesRes;
  }
  const dates = datesRes.value;

  const exRateRes = resolveExchangeRate(options);
  if (!exRateRes.ok) {
    return exRateRes;
  }
  const exchangeRate = exRateRes.value;

  const currency = String(booking.currency ?? "LKR")
    .toUpperCase()
    .trim();
  const financials = calculateOtaFinancials(
    booking.total_price,
    currency,
    exchangeRate,
    booking.ota_commission,
    booking.commission_percentage,
  );

  const customer = booking.customer as Record<string, unknown> | undefined;
  const guest = parseCustomerDetails(customer);

  const roomsRes = mapAllBookingRooms(
    booking.rooms,
    roomMap,
    dates.checkInDate,
    dates.checkOutDate,
    currency,
    exchangeRate,
  );
  if (!roomsRes.ok) {
    return roomsRes;
  }
  const rooms = roomsRes.value;

  const taxRes = calculateReverseTax(financials.grossTotalLkr, taxConfig);
  if (!taxRes.ok) {
    return taxRes;
  }

  const auditLog = createRevisionAuditLogIfTenant(
    tenantId,
    identifiers.otaReservationCode,
    identifiers.status,
    identifiers.channexBookingId,
    identifiers.channelName,
    financials.grossTotalLkr,
    financials.otaCommissionAmountLkr,
    options,
  );

  return ok({
    ...(tenantId ? { tenantId } : {}),
    bookingRef: identifiers.otaReservationCode,
    otaReservationCode: identifiers.otaReservationCode,
    channexBookingId: identifiers.channexBookingId,
    channelName: identifiers.channelName,
    source: identifiers.source,
    status: identifiers.status,
    checkInDate: dates.checkInDate,
    checkOutDate: dates.checkOutDate,
    nights: dates.nights,
    quotedCurrency: currency,
    originalTotalPrice: financials.originalTotalPrice,
    lockedExchangeRateLkr: exchangeRate,
    grossTotalLkr: financials.grossTotalLkr,
    otaCommissionAmountLkr: financials.otaCommissionAmountLkr,
    otaCommissionPercentage: financials.otaCommissionPercentage,
    netPayableToHotelLkr: financials.netPayableToHotelLkr,
    guest,
    rooms,
    mealPlan: rooms[0]?.mealPlan ?? "RO",
    specialRequests: extractSpecialRequests(booking, customer),
    taxBreakdown: taxRes.value,
    ...(auditLog ? { auditLog } : {}),
  });
}
