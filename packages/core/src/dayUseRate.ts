/**
 * @hms/core - Late Check-Out & Day-Use Room Rate Calculator (dayUseRate.ts).
 *
 * Implements deterministic calculation of:
 * 1. Late Check-Out fees for departures extending past standard check-out (11:00/12:00):
 *    - Grace period: 0 charge (up to standard checkout + configured grace minutes)
 *    - Half-Day (50% charge): Departures up to 18:00 (6:00 PM)
 *    - Full-Night (100% charge): Departures extending past 18:00
 *    - Complimentary authorization: GM/Admin authorized waivers
 * 2. Day-Use / Transit room rates for Katunayake (BIA) & Colombo airport transit passengers:
 *    - 4-hour, 8-hour, or half-day occupancy up to 18:00 (50% base rate)
 *    - Extended day-use past 18:00 rolling into full-night charges (100% base rate)
 *
 * Architectural Guarantees:
 * - Zero external runtime npm dependencies (pure TypeScript).
 * - Multi-tenant isolation: enforces strict tenantId format and matching.
 * - RBAC enforcement: Front-desk and managerial roles authorized; unprivileged rejected.
 * - Multi-tenant SaaS subscription entitlement check.
 * - IRD/SLTDA 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT).
 * - Supports TAX_EXCLUSIVE and TAX_INCLUSIVE pricing models.
 * - Dual-currency conversion (LKR & USD foreign lock).
 * - SHA-256 hash-chained ImmutableAuditLog generation.
 * - Explicit Result<T, DomainError> return types.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import type { GuestResidencyTier, PricingModel } from "./rateQuote.js";
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

export type LateCheckoutTier = "GRACE_PERIOD" | "HALF_DAY" | "FULL_NIGHT" | "COMPLIMENTARY";

export type DayUsePackageType =
  | "TRANSIT_4HR"
  | "TRANSIT_8HR"
  | "HALF_DAY_DAY_USE"
  | "FULL_DAY_USE"
  | "CUSTOM";

export type StaffRole =
  | "SUPER_ADMIN"
  | "HOTEL_ADMIN"
  | "HOTEL_OWNER"
  | "GENERAL_MANAGER"
  | "FRONT_DESK"
  | "RESERVATIONIST"
  | "CASHIER"
  | "HOUSEKEEPING"
  | "KITCHEN_KDS"
  | "WAITER"
  | "GUEST";

export interface ActorContext {
  readonly actorUserId: string;
  readonly role: StaffRole | string;
}

export interface SaasSubscriptionContext {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowsDayUseRooms?: boolean | undefined;
}

export interface LateCheckoutPolicy {
  /** Standard check-out time in 24h 'HH:MM' (default '11:00') */
  readonly standardCheckoutTime: string;
  /** Minutes past standard checkout before charges apply (default 30) */
  readonly gracePeriodMinutes: number;
  /** Cutoff time in 24h 'HH:MM' up to which half-day applies (default '18:00') */
  readonly halfDayCutoffTime: string;
  /** Multiplier for departures up to 18:00 (default 0.50) */
  readonly halfDayMultiplier: number;
  /** Multiplier for departures after 18:00 (default 1.00) */
  readonly fullNightMultiplier: number;
}

export const DEFAULT_LATE_CHECKOUT_POLICY: LateCheckoutPolicy = {
  standardCheckoutTime: "11:00",
  gracePeriodMinutes: 30,
  halfDayCutoffTime: "18:00",
  halfDayMultiplier: 0.5,
  fullNightMultiplier: 1.0,
};

export interface LateCheckoutInput {
  readonly tenantId: string;
  readonly reservationId: string;
  readonly roomNumber: string;
  readonly baseDailyRateLkr: number;
  readonly actualCheckoutTime: string; // 'HH:MM'
  readonly standardCheckoutTime?: string | undefined; // 'HH:MM'
  readonly residencyTier?: GuestResidencyTier | undefined;
  readonly currency?: string | undefined;
  readonly exchangeRateUsdLkr?: number | undefined;
  readonly isComplimentary?: boolean | undefined;
  readonly complimentaryReason?: string | undefined;
  readonly authorizedBy: ActorContext;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
  readonly pricingModel?: PricingModel | undefined;
  readonly policy?: Partial<LateCheckoutPolicy> | undefined;
  readonly subscription?: SaasSubscriptionContext | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly isoTimestamp?: string | undefined;
}

export interface FolioLineDraft {
  readonly code: string;
  readonly description: string;
  readonly baseLkr: number;
  readonly scLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatLkr: number;
  readonly totalLkr: number;
  readonly currency: string;
  readonly foreignAmount?: number | undefined;
  readonly exchangeRateUsdLkr?: number | undefined;
}

export interface LateCheckoutCalculationResult {
  readonly tenantId: string;
  readonly reservationId: string;
  readonly roomNumber: string;
  readonly standardCheckoutTime: string;
  readonly actualCheckoutTime: string;
  readonly tier: LateCheckoutTier;
  readonly multiplier: number;
  readonly baseDailyRateLkr: number;
  readonly taxableBaseLkr: number;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly totalChargeLkr: number;
  readonly currency: string;
  readonly foreignAmount?: number | undefined;
  readonly exchangeRateUsdLkr?: number | undefined;
  readonly pricingModel: PricingModel;
  readonly isComplimentary: boolean;
  readonly folioLineDraft: FolioLineDraft;
  readonly auditEntry: AuditLogEntry;
}

export interface DayUseRateInput {
  readonly tenantId: string;
  readonly roomNumber: string;
  readonly date: string; // 'YYYY-MM-DD'
  readonly checkInTime: string; // 'HH:MM'
  readonly checkOutTime: string; // 'HH:MM'
  readonly baseOvernightRateLkr: number;
  readonly packageType?: DayUsePackageType | undefined;
  readonly residencyTier?: GuestResidencyTier | undefined;
  readonly currency?: string | undefined;
  readonly exchangeRateUsdLkr?: number | undefined;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
  readonly pricingModel?: PricingModel | undefined;
  readonly authorizedBy: ActorContext;
  readonly subscription?: SaasSubscriptionContext | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly isoTimestamp?: string | undefined;
}

export interface DayUseCalculationResult {
  readonly tenantId: string;
  readonly roomNumber: string;
  readonly date: string;
  readonly checkInTime: string;
  readonly checkOutTime: string;
  readonly durationHours: number;
  readonly isExtendedPast1800: boolean;
  readonly packageType: DayUsePackageType;
  readonly multiplier: number;
  readonly baseOvernightRateLkr: number;
  readonly taxableBaseLkr: number;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly totalChargeLkr: number;
  readonly currency: string;
  readonly foreignAmount?: number | undefined;
  readonly exchangeRateUsdLkr?: number | undefined;
  readonly pricingModel: PricingModel;
  readonly folioLineDraft: FolioLineDraft;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Internal Helpers & RBAC
// ============================================================================

const AUTHORIZED_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "HOTEL_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "FRONT_DESK",
  "RESERVATIONIST",
  "CASHIER",
]);

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parses 'HH:MM' 24-hour time string into minutes from midnight (0..1439).
 */
export function parseTimeToMinutes(timeStr: string): Result<number, DomainError> {
  if (typeof timeStr !== "string") {
    return domainErr("VALIDATION_FAILED", "Time must be a string");
  }
  const match = TIME_REGEX.exec(timeStr.trim());
  if (!match || match[1] === undefined || match[2] === undefined) {
    return domainErr(
      "VALIDATION_FAILED",
      `Invalid time format '${timeStr}'. Expected 24-hour 'HH:MM' format (e.g. '14:30')`,
      { timeStr },
    );
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  return ok(hours * 60 + minutes);
}

function validateActorPermission(actor: ActorContext): Result<true, DomainError> {
  if (!actor || !actor.actorUserId || actor.actorUserId.trim() === "") {
    return domainErr("UNAUTHORIZED", "actorUserId is required for fee calculation");
  }
  const roleUpper = actor.role.toUpperCase();
  if (!AUTHORIZED_ROLES.has(roleUpper)) {
    return domainErr(
      "UNAUTHORIZED",
      `Role '${actor.role}' is not authorized to calculate or apply room charges`,
      { role: actor.role },
    );
  }
  return ok(true);
}

function validateSubscription(
  expectedTenantId: string,
  sub?: SaasSubscriptionContext,
): Result<true, DomainError> {
  if (!sub) {
    return ok(true);
  }
  if (sub.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenantId '${sub.tenantId}' does not match requested tenant '${expectedTenantId}'`,
    );
  }
  if (!sub.active) {
    return domainErr(
      "QUOTA_EXCEEDED",
      "SaaS subscription is inactive or suspended. Cannot assess room rate",
      { tenantId: sub.tenantId },
    );
  }
  return ok(true);
}

function resolveLateCheckoutTier(
  actualMinutes: number,
  stdMinutes: number,
  policy: LateCheckoutPolicy,
  isComplimentary: boolean,
  halfDayCutoffMinutes: number,
): { tier: LateCheckoutTier; multiplier: number } {
  if (isComplimentary) {
    return { tier: "COMPLIMENTARY", multiplier: 0 };
  }
  const graceMinutes = policy.gracePeriodMinutes;
  if (actualMinutes <= stdMinutes + graceMinutes) {
    return { tier: "GRACE_PERIOD", multiplier: 0 };
  }
  if (actualMinutes <= halfDayCutoffMinutes) {
    return { tier: "HALF_DAY", multiplier: policy.halfDayMultiplier };
  }
  return { tier: "FULL_NIGHT", multiplier: policy.fullNightMultiplier };
}

function computeTaxesAndTotals(
  rawChargeLkr: number,
  pricingModel: PricingModel,
  taxConfig: SriLankaTaxConfig,
): Result<
  { taxableBaseLkr: number; taxBreakdown: TaxBreakdownResult; totalChargeLkr: number },
  DomainError
> {
  if (rawChargeLkr <= 0) {
    const zeroTax = calculateForwardTax(0, taxConfig);
    if (!zeroTax.ok) {
      return zeroTax;
    }
    return ok({
      taxableBaseLkr: 0,
      taxBreakdown: zeroTax.value,
      totalChargeLkr: 0,
    });
  }

  if (pricingModel === "TAX_INCLUSIVE") {
    const revResult = calculateReverseTax(rawChargeLkr, taxConfig);
    if (!revResult.ok) {
      return revResult;
    }
    return ok({
      taxableBaseLkr: revResult.value.baseLkr,
      taxBreakdown: revResult.value,
      totalChargeLkr: revResult.value.grandTotalLkr,
    });
  }

  const fwdResult = calculateForwardTax(rawChargeLkr, taxConfig);
  if (!fwdResult.ok) {
    return fwdResult;
  }
  return ok({
    taxableBaseLkr: fwdResult.value.baseLkr,
    taxBreakdown: fwdResult.value,
    totalChargeLkr: fwdResult.value.grandTotalLkr,
  });
}

function resolveForeignAmount(
  totalLkr: number,
  currency: string,
  exchangeRateUsdLkr?: number,
): { foreignAmount?: number; exchangeRateUsdLkr?: number } {
  if (currency === "LKR" || !currency) {
    return {};
  }
  if (!exchangeRateUsdLkr || exchangeRateUsdLkr <= 0) {
    return {};
  }
  const foreignVal = roundLkr(totalLkr / exchangeRateUsdLkr);
  return {
    foreignAmount: foreignVal,
    exchangeRateUsdLkr,
  };
}

function validateLateCheckoutInputs(input: LateCheckoutInput): Result<string, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const actorRes = validateActorPermission(input.authorizedBy);
  if (!actorRes.ok) {
    return actorRes;
  }
  const subRes = validateSubscription(tenantRes.value, input.subscription);
  if (!subRes.ok) {
    return subRes;
  }
  if (!input.reservationId || input.reservationId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "reservationId is required");
  }
  if (!input.roomNumber || input.roomNumber.trim() === "") {
    return domainErr("VALIDATION_FAILED", "roomNumber is required");
  }
  if (!Number.isFinite(input.baseDailyRateLkr) || input.baseDailyRateLkr < 0) {
    return domainErr("VALIDATION_FAILED", "baseDailyRateLkr must be a non-negative number", {
      baseDailyRateLkr: input.baseDailyRateLkr,
    });
  }
  return ok(tenantRes.value);
}

interface ResolvedPolicyTimes {
  readonly policy: LateCheckoutPolicy;
  readonly stdMinutes: number;
  readonly actualMinutes: number;
  readonly cutoffMinutes: number;
}

function resolveLateCheckoutPolicyTimes(
  input: LateCheckoutInput,
): Result<ResolvedPolicyTimes, DomainError> {
  const policy: LateCheckoutPolicy = {
    standardCheckoutTime:
      input.standardCheckoutTime ??
      input.policy?.standardCheckoutTime ??
      DEFAULT_LATE_CHECKOUT_POLICY.standardCheckoutTime,
    gracePeriodMinutes:
      input.policy?.gracePeriodMinutes ?? DEFAULT_LATE_CHECKOUT_POLICY.gracePeriodMinutes,
    halfDayCutoffTime:
      input.policy?.halfDayCutoffTime ?? DEFAULT_LATE_CHECKOUT_POLICY.halfDayCutoffTime,
    halfDayMultiplier:
      input.policy?.halfDayMultiplier ?? DEFAULT_LATE_CHECKOUT_POLICY.halfDayMultiplier,
    fullNightMultiplier:
      input.policy?.fullNightMultiplier ?? DEFAULT_LATE_CHECKOUT_POLICY.fullNightMultiplier,
  };

  const stdTimeRes = parseTimeToMinutes(policy.standardCheckoutTime);
  if (!stdTimeRes.ok) {
    return stdTimeRes;
  }
  const actualTimeRes = parseTimeToMinutes(input.actualCheckoutTime);
  if (!actualTimeRes.ok) {
    return actualTimeRes;
  }
  const cutoffTimeRes = parseTimeToMinutes(policy.halfDayCutoffTime);
  if (!cutoffTimeRes.ok) {
    return cutoffTimeRes;
  }

  return ok({
    policy,
    stdMinutes: stdTimeRes.value,
    actualMinutes: actualTimeRes.value,
    cutoffMinutes: cutoffTimeRes.value,
  });
}

function buildLateCheckoutFolioDraft(
  roomNumber: string,
  actualCheckoutTime: string,
  tier: LateCheckoutTier,
  taxableBaseLkr: number,
  taxBreakdown: TaxBreakdownResult,
  totalChargeLkr: number,
  currency: string,
  foreignInfo: { foreignAmount?: number; exchangeRateUsdLkr?: number },
): FolioLineDraft {
  const tierDesc =
    tier === "COMPLIMENTARY"
      ? "Complimentary Late Check-Out"
      : tier === "GRACE_PERIOD"
        ? "Within Standard Grace Period"
        : tier === "HALF_DAY"
          ? "Half-Day Late Check-Out Charge (50%)"
          : "Full-Night Late Check-Out Charge (100%)";

  return {
    code: "LATE_CHECKOUT_FEE",
    description: `Late Check-Out Fee (Room ${roomNumber}, departed ${actualCheckoutTime}) - ${tierDesc}`,
    baseLkr: taxableBaseLkr,
    scLkr: taxBreakdown.scLkr,
    tdlLkr: taxBreakdown.tdlLkr,
    ssclLkr: taxBreakdown.ssclLkr,
    vatLkr: taxBreakdown.vatLkr,
    totalLkr: totalChargeLkr,
    currency,
    foreignAmount: foreignInfo.foreignAmount,
    exchangeRateUsdLkr: foreignInfo.exchangeRateUsdLkr,
  };
}

// ============================================================================
// Public Domain Functions
// ============================================================================

/**
 * Calculates Late Check-Out fees for departures extending past standard check-out.
 *
 * Rules:
 * - Within grace period: 0 charge (tier: GRACE_PERIOD)
 * - Up to 18:00 (halfDayCutoff): 50% half-day charge (tier: HALF_DAY)
 * - After 18:00: 100% full-night charge (tier: FULL_NIGHT)
 * - Complimentary: 0 charge (tier: COMPLIMENTARY)
 */
export function calculateLateCheckoutFee(
  input: LateCheckoutInput,
): Result<LateCheckoutCalculationResult, DomainError> {
  const validationRes = validateLateCheckoutInputs(input);
  if (!validationRes.ok) {
    return validationRes;
  }
  const tenantId = validationRes.value;

  const timesRes = resolveLateCheckoutPolicyTimes(input);
  if (!timesRes.ok) {
    return timesRes;
  }
  const { policy, stdMinutes, actualMinutes, cutoffMinutes } = timesRes.value;

  const isComplimentary = Boolean(input.isComplimentary);
  const { tier, multiplier } = resolveLateCheckoutTier(
    actualMinutes,
    stdMinutes,
    policy,
    isComplimentary,
    cutoffMinutes,
  );

  const rawChargeLkr = roundLkr(input.baseDailyRateLkr * multiplier);
  const pricingModel = input.pricingModel ?? "TAX_EXCLUSIVE";
  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;

  const taxRes = computeTaxesAndTotals(rawChargeLkr, pricingModel, taxConfig);
  if (!taxRes.ok) {
    return taxRes;
  }
  const { taxableBaseLkr, taxBreakdown, totalChargeLkr } = taxRes.value;

  const currency = input.currency ?? "LKR";
  const foreignInfo = resolveForeignAmount(totalChargeLkr, currency, input.exchangeRateUsdLkr);

  const folioLineDraft = buildLateCheckoutFolioDraft(
    input.roomNumber,
    input.actualCheckoutTime,
    tier,
    taxableBaseLkr,
    taxBreakdown,
    totalChargeLkr,
    currency,
    foreignInfo,
  );

  const isoTs = input.isoTimestamp ?? new Date().toISOString();
  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.authorizedBy.actorUserId,
    action: "CALCULATE_LATE_CHECKOUT_FEE",
    entityType: "RESERVATION",
    entityId: input.reservationId,
    isoTs,
    afterJson: JSON.stringify({
      roomNumber: input.roomNumber,
      actualCheckoutTime: input.actualCheckoutTime,
      standardCheckoutTime: policy.standardCheckoutTime,
      tier,
      multiplier,
      totalChargeLkr,
      isComplimentary,
      complimentaryReason: input.complimentaryReason,
      currency,
    }),
    prevHash: input.prevAuditHash,
  });
  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId,
    reservationId: input.reservationId,
    roomNumber: input.roomNumber,
    standardCheckoutTime: policy.standardCheckoutTime,
    actualCheckoutTime: input.actualCheckoutTime,
    tier,
    multiplier,
    baseDailyRateLkr: roundLkr(input.baseDailyRateLkr),
    taxableBaseLkr,
    taxBreakdown,
    totalChargeLkr,
    currency,
    foreignAmount: foreignInfo.foreignAmount,
    exchangeRateUsdLkr: foreignInfo.exchangeRateUsdLkr,
    pricingModel,
    isComplimentary,
    folioLineDraft,
    auditEntry: auditRes.value,
  });
}

function resolveDayUsePackageMultiplier(
  packageType: DayUsePackageType,
  durationHours: number,
  checkOutMinutes: number,
  eighteenHoursMinutes: number,
): { multiplier: number; isExtendedPast1800: boolean } {
  const isExtended = checkOutMinutes > eighteenHoursMinutes;
  if (isExtended) {
    return { multiplier: 1.0, isExtendedPast1800: true };
  }

  switch (packageType) {
    case "TRANSIT_4HR":
      return { multiplier: 0.35, isExtendedPast1800: false };
    case "TRANSIT_8HR":
    case "HALF_DAY_DAY_USE":
      return { multiplier: 0.5, isExtendedPast1800: false };
    case "FULL_DAY_USE":
      return { multiplier: 1.0, isExtendedPast1800: false };
    case "CUSTOM": {
      const calcMult = durationHours <= 6 ? 0.35 : 0.5;
      return { multiplier: calcMult, isExtendedPast1800: false };
    }
    default:
      return { multiplier: 0.5, isExtendedPast1800: false };
  }
}

function validateDayUseInputs(input: DayUseRateInput): Result<string, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const actorRes = validateActorPermission(input.authorizedBy);
  if (!actorRes.ok) {
    return actorRes;
  }
  const subRes = validateSubscription(tenantRes.value, input.subscription);
  if (!subRes.ok) {
    return subRes;
  }
  if (!input.roomNumber || input.roomNumber.trim() === "") {
    return domainErr("VALIDATION_FAILED", "roomNumber is required");
  }
  if (!input.date || input.date.trim() === "") {
    return domainErr("VALIDATION_FAILED", "date is required (YYYY-MM-DD)");
  }
  if (!Number.isFinite(input.baseOvernightRateLkr) || input.baseOvernightRateLkr <= 0) {
    return domainErr("VALIDATION_FAILED", "baseOvernightRateLkr must be a positive number", {
      baseOvernightRateLkr: input.baseOvernightRateLkr,
    });
  }
  return ok(tenantRes.value);
}

function resolveDayUseDuration(
  checkInTime: string,
  checkOutTime: string,
): Result<{ checkInMin: number; checkOutMin: number; durationHours: number }, DomainError> {
  const inRes = parseTimeToMinutes(checkInTime);
  if (!inRes.ok) {
    return inRes;
  }
  const outRes = parseTimeToMinutes(checkOutTime);
  if (!outRes.ok) {
    return outRes;
  }

  const checkInMin = inRes.value;
  const checkOutMin = outRes.value;
  if (checkOutMin <= checkInMin) {
    return domainErr(
      "VALIDATION_FAILED",
      `Day-use check-out time '${checkOutTime}' must be later than check-in time '${checkInTime}'`,
      { checkInTime, checkOutTime },
    );
  }

  const durationMinutes = checkOutMin - checkInMin;
  const durationHours = Math.round((durationMinutes / 60 + Number.EPSILON) * 10) / 10;
  return ok({ checkInMin, checkOutMin, durationHours });
}

function buildDayUseFolioDraft(
  roomNumber: string,
  checkInTime: string,
  checkOutTime: string,
  packageType: DayUsePackageType,
  durationHours: number,
  isExtendedPast1800: boolean,
  taxableBaseLkr: number,
  taxBreakdown: TaxBreakdownResult,
  totalChargeLkr: number,
  currency: string,
  foreignInfo: { foreignAmount?: number; exchangeRateUsdLkr?: number },
): FolioLineDraft {
  const descSuffix = isExtendedPast1800
    ? "(Extended past 18:00 - Full Night 100%)"
    : `(${packageType} - ${durationHours} hrs)`;

  return {
    code: "DAY_USE_ROOM_CHARGE",
    description: `Day-Use Room Charge (Room ${roomNumber}, ${checkInTime} to ${checkOutTime}) ${descSuffix}`,
    baseLkr: taxableBaseLkr,
    scLkr: taxBreakdown.scLkr,
    tdlLkr: taxBreakdown.tdlLkr,
    ssclLkr: taxBreakdown.ssclLkr,
    vatLkr: taxBreakdown.vatLkr,
    totalLkr: totalChargeLkr,
    currency,
    foreignAmount: foreignInfo.foreignAmount,
    exchangeRateUsdLkr: foreignInfo.exchangeRateUsdLkr,
  };
}

/**
 * Calculates transit / day-use room rates for same-day guests.
 *
 * Designed for airport transit hotels (Katunayake / Negombo) and Colombo day-stay guests:
 * - Stays up to 18:00 charged at daytime package rate (default 50% of overnight rate)
 * - Stays extending past 18:00 convert automatically to full overnight rate (100%)
 */
export function calculateDayUseRate(
  input: DayUseRateInput,
): Result<DayUseCalculationResult, DomainError> {
  const validationRes = validateDayUseInputs(input);
  if (!validationRes.ok) {
    return validationRes;
  }
  const tenantId = validationRes.value;

  const durationRes = resolveDayUseDuration(input.checkInTime, input.checkOutTime);
  if (!durationRes.ok) {
    return durationRes;
  }
  const { checkOutMin, durationHours } = durationRes.value;

  const packageType = input.packageType ?? "HALF_DAY_DAY_USE";
  const { multiplier, isExtendedPast1800 } = resolveDayUsePackageMultiplier(
    packageType,
    durationHours,
    checkOutMin,
    18 * 60,
  );

  const rawChargeLkr = roundLkr(input.baseOvernightRateLkr * multiplier);
  const pricingModel = input.pricingModel ?? "TAX_EXCLUSIVE";
  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;

  const taxRes = computeTaxesAndTotals(rawChargeLkr, pricingModel, taxConfig);
  if (!taxRes.ok) {
    return taxRes;
  }
  const { taxableBaseLkr, taxBreakdown, totalChargeLkr } = taxRes.value;

  const currency = input.currency ?? "LKR";
  const foreignInfo = resolveForeignAmount(totalChargeLkr, currency, input.exchangeRateUsdLkr);

  const folioLineDraft = buildDayUseFolioDraft(
    input.roomNumber,
    input.checkInTime,
    input.checkOutTime,
    packageType,
    durationHours,
    isExtendedPast1800,
    taxableBaseLkr,
    taxBreakdown,
    totalChargeLkr,
    currency,
    foreignInfo,
  );

  const isoTs = input.isoTimestamp ?? new Date().toISOString();
  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.authorizedBy.actorUserId,
    action: "CALCULATE_DAY_USE_ROOM_CHARGE",
    entityType: "DAY_USE_ROOM",
    entityId: `${tenantId}:${input.roomNumber}:${input.date}`,
    isoTs,
    afterJson: JSON.stringify({
      roomNumber: input.roomNumber,
      date: input.date,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      durationHours,
      isExtendedPast1800,
      packageType,
      multiplier,
      totalChargeLkr,
      currency,
    }),
    prevHash: input.prevAuditHash,
  });
  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId,
    roomNumber: input.roomNumber,
    date: input.date,
    checkInTime: input.checkInTime,
    checkOutTime: input.checkOutTime,
    durationHours,
    isExtendedPast1800,
    packageType,
    multiplier,
    baseOvernightRateLkr: roundLkr(input.baseOvernightRateLkr),
    taxableBaseLkr,
    taxBreakdown,
    totalChargeLkr,
    currency,
    foreignAmount: foreignInfo.foreignAmount,
    exchangeRateUsdLkr: foreignInfo.exchangeRateUsdLkr,
    pricingModel,
    folioLineDraft,
    auditEntry: auditRes.value,
  });
}
