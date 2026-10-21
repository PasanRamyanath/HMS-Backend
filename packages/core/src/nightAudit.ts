/**
 * @hms/core - Pure Night Audit Aggregation Engine (nightAudit.ts)
 *
 * Implements Step 401 (Phase 17.01) of the Sri Lanka HMS Master Architecture Plan:
 * Deterministic domain engine executing the daily statutory 23:59 SLST Night Audit:
 *
 * 1. Aggregates all in-house room reservations, guest counts, and room nights.
 * 2. SLTDA Nationality Classification: Splits Foreign Guest Nights by Country Code
 *    (UK, India, Germany, France, Russia, etc.) and Sri Lankan Domestic Guest Nights.
 * 3. Hospitality KPI Calculations:
 *    - Average Daily Rate (ADR) = Total Room Revenue / Paid Occupied Rooms
 *    - Revenue Per Available Room (RevPAR) = Total Room Revenue / Total Available Rooms
 *    - Room Occupancy % & Bed Occupancy %
 * 4. Revenue Pool Aggregations: Room Revenue, F&B Revenue, Ancillaries / Other.
 * 5. Compounding Statutory Tax & Service Charge Pools (SC -> TDL -> SSCL -> VAT):
 *    - 10% Service Charge Pool for employee welfare/distribution
 *    - 1% Tourism Development Levy (TDL) for SLTDA remittance
 *    - 2.5% Social Security Contribution Levy (SSCL) for IRD
 *    - 18% Value Added Tax (VAT) for IRD
 * 6. Multi-Tenant SaaS isolation, RBAC role guard, and SaasSubscription entitlement checks.
 * 7. Cryptographic SHA-256 hash-chained ImmutableAuditLog entry generation.
 *
 * Zero external runtime npm dependencies (Node 22 standard library only).
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

/**
 * Authorized staff roles permitted to execute or trigger the Night Audit.
 */
export type NightAuditStaffRole =
  | "NIGHT_AUDITOR"
  | "FRONT_DESK_MANAGER"
  | "FINANCE_CONTROLLER"
  | "GENERAL_MANAGER"
  | "SUPER_ADMIN";

export const NIGHT_AUDIT_AUTHORIZED_ROLES: readonly NightAuditStaffRole[] = [
  "NIGHT_AUDITOR",
  "FRONT_DESK_MANAGER",
  "FINANCE_CONTROLLER",
  "GENERAL_MANAGER",
  "SUPER_ADMIN",
];

export interface NightAuditActor {
  readonly userId: string;
  readonly role: NightAuditStaffRole;
  readonly tenantId: string;
}

export interface NightAuditSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowsNightAudit?: boolean | undefined;
}

/**
 * Residency / citizenship classification for statutory SLTDA tourist reporting.
 */
export type NightAuditResidencyTier =
  | "SRI_LANKAN_CITIZEN"
  | "RESIDENT_VISA"
  | "FOREIGN_TOURIST"
  | "LOCAL"
  | "FOREIGN";

/**
 * In-house reservation record active on the business night.
 */
export interface InHouseReservationRecord {
  readonly reservationId: string;
  readonly tenantId: string;
  readonly roomNumber: string;
  readonly roomTypeId: string;
  readonly guestFullName?: string | undefined;
  /** ISO 3166-1 alpha-2 country code (e.g., "LK", "GB", "IN", "DE", "FR", "RU") */
  readonly nationalityCountryCode: string;
  readonly residencyTier: NightAuditResidencyTier;
  readonly adultsCount: number;
  readonly childrenCount: number;
  /** Nightly base room rate before taxes and levies in LKR */
  readonly roomRateLkr?: number | undefined;
  readonly isComplimentary?: boolean | undefined;
  readonly isHouseUse?: boolean | undefined;
  readonly isTaxExempt?: boolean | undefined;
  readonly status?: "CHECKED_IN" | "IN_HOUSE" | "CHECKED_OUT" | undefined;
}

/**
 * Folio line revenue category.
 */
export type FolioRevenueCategory =
  | "ROOM"
  | "FOOD_AND_BEVERAGE"
  | "SPA"
  | "EXCURSION"
  | "BANQUET"
  | "LAUNDRY"
  | "TRANSPORT"
  | "OTHER";

/**
 * Posted folio line transaction for the audited business date.
 */
export interface NightAuditFolioLineInput {
  readonly folioLineId: string;
  readonly tenantId: string;
  readonly category: FolioRevenueCategory;
  readonly description?: string | undefined;
  readonly baseLkr: number;
  readonly scLkr?: number | undefined;
  readonly tdlLkr?: number | undefined;
  readonly ssclLkr?: number | undefined;
  readonly vatLkr?: number | undefined;
  readonly grandTotalLkr?: number | undefined;
  readonly taxExempt?: boolean | undefined;
}

export interface NightAuditCalculationInput {
  readonly tenantId: string;
  /** ISO date format YYYY-MM-DD */
  readonly businessDate: string;
  /** Physical total rooms available in property inventory */
  readonly totalAvailableRooms: number;
  /** Total physical beds available in property (optional, defaults to totalAvailableRooms * 2) */
  readonly totalAvailableBeds?: number | undefined;
  readonly reservations: readonly InHouseReservationRecord[];
  readonly folioLines?: readonly NightAuditFolioLineInput[] | undefined;
  readonly actor: NightAuditActor;
  readonly taxConfig?: Partial<SriLankaTaxConfig> | undefined;
  readonly subscription?: NightAuditSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly timestamp?: string | undefined;
}

/**
 * SLTDA per-country guest and bed-night breakdown.
 */
export interface NationalityGuestStat {
  readonly countryCode: string;
  readonly guestCount: number;
  readonly guestNights: number;
  readonly isDomestic: boolean;
}

/**
 * Comprehensive Night Audit calculation output.
 */
export interface NightAuditCalculationResult {
  readonly tenantId: string;
  readonly businessDate: string;

  // Room Inventory & Occupancy
  readonly totalAvailableRooms: number;
  readonly occupiedRooms: number;
  readonly complimentaryRooms: number;
  readonly houseUseRooms: number;
  readonly revenueRooms: number;
  readonly roomOccupancyRate: number; // 0.00 to 100.00 %

  // Bed Inventory & Occupancy
  readonly totalAvailableBeds: number;
  readonly occupiedBeds: number;
  readonly bedOccupancyRate: number; // 0.00 to 100.00 %

  // Guest Statistics & SLTDA Breakdown
  readonly totalGuests: number;
  readonly totalForeignGuests: number;
  readonly totalLocalGuests: number;
  readonly foreignGuestNights: number;
  readonly localGuestNights: number;
  readonly totalGuestNights: number;
  readonly nationalityBreakdown: Record<string, NationalityGuestStat>;

  // Hospitality Performance KPIs (LKR)
  readonly adrLkr: number; // Average Daily Rate
  readonly revParLkr: number; // Revenue Per Available Room

  // Revenue Breakdown (Base LKR)
  readonly roomRevenueLkr: number;
  readonly fAndBRevenueLkr: number;
  readonly otherRevenueLkr: number;
  readonly totalNetRevenueLkr: number;

  // Statutory Tax & Service Charge Pools (LKR)
  readonly serviceChargePoolLkr: number; // 10% Staff Pool
  readonly tdlPoolLkr: number; // 1% SLTDA
  readonly ssclPoolLkr: number; // 2.5% IRD
  readonly vatPoolLkr: number; // 18% IRD
  readonly totalTaxAndLevyLkr: number; // TDL + SSCL + VAT
  readonly grandTotalRevenueLkr: number;

  // Cryptographic Audit Trail
  readonly auditLog: AuditLogEntry;
}

/**
 * Identifies whether a guest is a Sri Lankan domestic guest based on ISO country code or residency tier.
 */
export function isSriLankanDomestic(
  countryCode: string | undefined,
  residencyTier: NightAuditResidencyTier | string | undefined,
): boolean {
  if (countryCode && countryCode.trim().toUpperCase() === "LK") {
    return true;
  }
  if (
    residencyTier === "SRI_LANKAN_CITIZEN" ||
    residencyTier === "RESIDENT_VISA" ||
    residencyTier === "LOCAL"
  ) {
    return true;
  }
  return false;
}

/**
 * Validates the actor role and tenant isolation.
 */
export function validateNightAuditActor(
  actor: NightAuditActor,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!actor || !actor.userId || actor.userId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Actor userId must not be empty");
  }

  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match operation tenant '${expectedTenantId}'`,
    );
  }

  if (!NIGHT_AUDIT_AUTHORIZED_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized to execute night audit calculations`,
      { allowedRoles: NIGHT_AUDIT_AUTHORIZED_ROLES },
    );
  }

  return ok(undefined);
}

/**
 * Validates multi-tenant SaaS subscription entitlements for Night Audit.
 */
export function validateNightAuditSubscription(
  sub: NightAuditSaasSubscription | undefined,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!sub) return ok(undefined);

  if (sub.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenant '${sub.tenantId}' does not match operation tenant '${expectedTenantId}'`,
    );
  }

  if (!sub.active) {
    return domainErr("SUBSCRIPTION_INACTIVE", "SaaS subscription for this property is inactive", {
      tenantId: expectedTenantId,
    });
  }

  if (sub.allowsNightAudit === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "Automated night audit and SLTDA statutory compliance engine is not entitled under current plan tier",
      { tier: sub.tier },
    );
  }

  return ok(undefined);
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface SingleReservationStat {
  isDomestic: boolean;
  country: string;
  guestCount: number;
  isComplimentary: boolean;
  isHouseUse: boolean;
  roomRateLkr: number;
  scLkr: number;
  tdlLkr: number;
  ssclLkr: number;
  vatLkr: number;
}

function computeReservationTax(
  rate: number,
  isTaxExempt: boolean | undefined,
  config: SriLankaTaxConfig,
): { sc: number; tdl: number; sscl: number; vat: number } {
  if (rate <= 0 || isTaxExempt) {
    return { sc: 0, tdl: 0, sscl: 0, vat: 0 };
  }
  const taxRes = calculateForwardTax(rate, config);
  if (!taxRes.ok) {
    return { sc: 0, tdl: 0, sscl: 0, vat: 0 };
  }
  return {
    sc: taxRes.value.scLkr,
    tdl: taxRes.value.tdlLkr,
    sscl: taxRes.value.ssclLkr,
    vat: taxRes.value.vatLkr,
  };
}

function processSingleReservation(
  res: InHouseReservationRecord,
  taxConfig: SriLankaTaxConfig,
): SingleReservationStat {
  const isDomestic = isSriLankanDomestic(res.nationalityCountryCode, res.residencyTier);
  const country = (res.nationalityCountryCode || (isDomestic ? "LK" : "OTHER"))
    .toUpperCase()
    .trim();

  const rawCount = (res.adultsCount || 0) + (res.childrenCount || 0);
  const guestCount = rawCount > 0 ? rawCount : 1;

  if (res.isComplimentary || res.isHouseUse) {
    return {
      isDomestic,
      country,
      guestCount,
      isComplimentary: Boolean(res.isComplimentary),
      isHouseUse: Boolean(res.isHouseUse),
      roomRateLkr: 0,
      scLkr: 0,
      tdlLkr: 0,
      ssclLkr: 0,
      vatLkr: 0,
    };
  }

  const rate = res.roomRateLkr && res.roomRateLkr > 0 ? roundLkr(res.roomRateLkr) : 0;
  const taxes = computeReservationTax(rate, res.isTaxExempt, taxConfig);

  return {
    isDomestic,
    country,
    guestCount,
    isComplimentary: false,
    isHouseUse: false,
    roomRateLkr: rate,
    scLkr: taxes.sc,
    tdlLkr: taxes.tdl,
    ssclLkr: taxes.sscl,
    vatLkr: taxes.vat,
  };
}

interface GuestAggregates {
  totalGuests: number;
  totalForeignGuests: number;
  totalLocalGuests: number;
  foreignGuestNights: number;
  localGuestNights: number;
  totalGuestNights: number;
  complimentaryRooms: number;
  houseUseRooms: number;
  revenueRooms: number;
  nationalityBreakdown: Record<string, NationalityGuestStat>;
  unpostedRoomRevenueLkr: number;
  unpostedScLkr: number;
  unpostedTdlLkr: number;
  unpostedSsclLkr: number;
  unpostedVatLkr: number;
}

function aggregateGuestStats(
  reservations: readonly InHouseReservationRecord[],
  taxConfig: SriLankaTaxConfig,
): GuestAggregates {
  let totalGuests = 0;
  let totalForeignGuests = 0;
  let totalLocalGuests = 0;
  let complimentaryRooms = 0;
  let houseUseRooms = 0;
  let revenueRooms = 0;
  let unpostedRoomRevenueLkr = 0;
  let unpostedScLkr = 0;
  let unpostedTdlLkr = 0;
  let unpostedSsclLkr = 0;
  let unpostedVatLkr = 0;

  const breakdown: Record<string, NationalityGuestStat> = {};

  for (const res of reservations) {
    const stat = processSingleReservation(res, taxConfig);
    totalGuests += stat.guestCount;

    if (stat.isDomestic) {
      totalLocalGuests += stat.guestCount;
    } else {
      totalForeignGuests += stat.guestCount;
    }

    const currentCountryStat = breakdown[stat.country] ?? {
      countryCode: stat.country,
      guestCount: 0,
      guestNights: 0,
      isDomestic: stat.isDomestic,
    };
    breakdown[stat.country] = {
      countryCode: stat.country,
      guestCount: currentCountryStat.guestCount + stat.guestCount,
      guestNights: currentCountryStat.guestNights + stat.guestCount,
      isDomestic: stat.isDomestic,
    };

    if (stat.isComplimentary) {
      complimentaryRooms += 1;
    } else if (stat.isHouseUse) {
      houseUseRooms += 1;
    } else {
      revenueRooms += 1;
      unpostedRoomRevenueLkr = roundLkr(unpostedRoomRevenueLkr + stat.roomRateLkr);
      unpostedScLkr = roundLkr(unpostedScLkr + stat.scLkr);
      unpostedTdlLkr = roundLkr(unpostedTdlLkr + stat.tdlLkr);
      unpostedSsclLkr = roundLkr(unpostedSsclLkr + stat.ssclLkr);
      unpostedVatLkr = roundLkr(unpostedVatLkr + stat.vatLkr);
    }
  }

  return {
    totalGuests,
    totalForeignGuests,
    totalLocalGuests,
    foreignGuestNights: totalForeignGuests,
    localGuestNights: totalLocalGuests,
    totalGuestNights: totalGuests,
    complimentaryRooms,
    houseUseRooms,
    revenueRooms,
    nationalityBreakdown: breakdown,
    unpostedRoomRevenueLkr,
    unpostedScLkr,
    unpostedTdlLkr,
    unpostedSsclLkr,
    unpostedVatLkr,
  };
}

interface SingleFolioLineAmounts {
  category: FolioRevenueCategory;
  baseLkr: number;
  scLkr: number;
  tdlLkr: number;
  ssclLkr: number;
  vatLkr: number;
}

function processSingleFolioLine(
  line: NightAuditFolioLineInput,
  taxConfig: SriLankaTaxConfig,
): SingleFolioLineAmounts {
  const base = roundLkr(Math.max(0, line.baseLkr || 0));
  if (line.taxExempt) {
    return { category: line.category, baseLkr: base, scLkr: 0, tdlLkr: 0, ssclLkr: 0, vatLkr: 0 };
  }

  if (
    line.scLkr !== undefined ||
    line.tdlLkr !== undefined ||
    line.ssclLkr !== undefined ||
    line.vatLkr !== undefined
  ) {
    return {
      category: line.category,
      baseLkr: base,
      scLkr: line.scLkr || 0,
      tdlLkr: line.tdlLkr || 0,
      ssclLkr: line.ssclLkr || 0,
      vatLkr: line.vatLkr || 0,
    };
  }

  if (base > 0) {
    const taxRes = calculateForwardTax(base, taxConfig);
    if (taxRes.ok) {
      return {
        category: line.category,
        baseLkr: base,
        scLkr: taxRes.value.scLkr,
        tdlLkr: taxRes.value.tdlLkr,
        ssclLkr: taxRes.value.ssclLkr,
        vatLkr: taxRes.value.vatLkr,
      };
    }
  }

  return { category: line.category, baseLkr: base, scLkr: 0, tdlLkr: 0, ssclLkr: 0, vatLkr: 0 };
}

interface RevenueAndTaxes {
  roomRevenueLkr: number;
  fAndBRevenueLkr: number;
  otherRevenueLkr: number;
  totalNetRevenueLkr: number;
  serviceChargePoolLkr: number;
  tdlPoolLkr: number;
  ssclPoolLkr: number;
  vatPoolLkr: number;
  totalTaxAndLevyLkr: number;
  grandTotalRevenueLkr: number;
}

interface FolioLinesAggregate {
  roomRev: number;
  fbRev: number;
  otherRev: number;
  scPool: number;
  tdlPool: number;
  ssclPool: number;
  vatPool: number;
  hasRoomFolioLine: boolean;
}

function sumFolioLines(
  folioLines: readonly NightAuditFolioLineInput[],
  taxConfig: SriLankaTaxConfig,
): FolioLinesAggregate {
  let roomRev = 0;
  let fbRev = 0;
  let otherRev = 0;
  let scPool = 0;
  let tdlPool = 0;
  let ssclPool = 0;
  let vatPool = 0;
  let hasRoomFolioLine = false;

  for (const line of folioLines) {
    const parsed = processSingleFolioLine(line, taxConfig);
    if (parsed.category === "ROOM") {
      roomRev = roundLkr(roomRev + parsed.baseLkr);
      hasRoomFolioLine = true;
    } else if (parsed.category === "FOOD_AND_BEVERAGE") {
      fbRev = roundLkr(fbRev + parsed.baseLkr);
    } else {
      otherRev = roundLkr(otherRev + parsed.baseLkr);
    }
    scPool = roundLkr(scPool + parsed.scLkr);
    tdlPool = roundLkr(tdlPool + parsed.tdlLkr);
    ssclPool = roundLkr(ssclPool + parsed.ssclLkr);
    vatPool = roundLkr(vatPool + parsed.vatLkr);
  }

  return { roomRev, fbRev, otherRev, scPool, tdlPool, ssclPool, vatPool, hasRoomFolioLine };
}

function aggregateRevenueAndTaxes(
  folioLines: readonly NightAuditFolioLineInput[] | undefined,
  taxConfig: SriLankaTaxConfig,
  guestAggs: GuestAggregates,
): RevenueAndTaxes {
  const aggregated =
    folioLines && folioLines.length > 0
      ? sumFolioLines(folioLines, taxConfig)
      : {
          roomRev: 0,
          fbRev: 0,
          otherRev: 0,
          scPool: 0,
          tdlPool: 0,
          ssclPool: 0,
          vatPool: 0,
          hasRoomFolioLine: false,
        };

  let roomRev = aggregated.roomRev;
  let scPool = aggregated.scPool;
  let tdlPool = aggregated.tdlPool;
  let ssclPool = aggregated.ssclPool;
  let vatPool = aggregated.vatPool;

  if (!aggregated.hasRoomFolioLine && guestAggs.unpostedRoomRevenueLkr > 0) {
    roomRev = roundLkr(roomRev + guestAggs.unpostedRoomRevenueLkr);
    scPool = roundLkr(scPool + guestAggs.unpostedScLkr);
    tdlPool = roundLkr(tdlPool + guestAggs.unpostedTdlLkr);
    ssclPool = roundLkr(ssclPool + guestAggs.unpostedSsclLkr);
    vatPool = roundLkr(vatPool + guestAggs.unpostedVatLkr);
  }

  const totalNetRevenueLkr = roundLkr(roomRev + aggregated.fbRev + aggregated.otherRev);
  const totalTaxAndLevyLkr = roundLkr(tdlPool + ssclPool + vatPool);
  const grandTotalRevenueLkr = roundLkr(totalNetRevenueLkr + scPool + totalTaxAndLevyLkr);

  return {
    roomRevenueLkr: roomRev,
    fAndBRevenueLkr: aggregated.fbRev,
    otherRevenueLkr: aggregated.otherRev,
    totalNetRevenueLkr,
    serviceChargePoolLkr: scPool,
    tdlPoolLkr: tdlPool,
    ssclPoolLkr: ssclPool,
    vatPoolLkr: vatPool,
    totalTaxAndLevyLkr,
    grandTotalRevenueLkr,
  };
}

function validateTenantIsolation(
  tenantId: string,
  reservations: readonly InHouseReservationRecord[],
  folioLines: readonly NightAuditFolioLineInput[] | undefined,
): Result<void, DomainError> {
  for (const res of reservations) {
    if (res.tenantId !== tenantId) {
      return domainErr(
        "TENANT_MISMATCH",
        `Reservation '${res.reservationId}' belongs to tenant '${res.tenantId}', expected '${tenantId}'`,
      );
    }
  }

  if (folioLines) {
    for (const line of folioLines) {
      if (line.tenantId !== tenantId) {
        return domainErr(
          "TENANT_MISMATCH",
          `Folio line '${line.folioLineId}' belongs to tenant '${line.tenantId}', expected '${tenantId}'`,
        );
      }
    }
  }

  return ok(undefined);
}

function validateNightAuditInput(input: NightAuditCalculationInput): Result<
  {
    tenantId: string;
    businessDate: string;
    totalAvailableRooms: number;
    totalAvailableBeds: number;
  },
  DomainError
> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) return tenantRes;
  const tenantId = tenantRes.value;

  if (!input.businessDate || !DATE_REGEX.test(input.businessDate.trim())) {
    return domainErr(
      "VALIDATION_FAILED",
      "businessDate must be a valid ISO date string formatted as YYYY-MM-DD",
      { businessDate: input.businessDate },
    );
  }
  const businessDate = input.businessDate.trim();

  const actorRes = validateNightAuditActor(input.actor, tenantId);
  if (!actorRes.ok) return actorRes;

  const subRes = validateNightAuditSubscription(input.subscription, tenantId);
  if (!subRes.ok) return subRes;

  if (
    !Number.isFinite(input.totalAvailableRooms) ||
    input.totalAvailableRooms < 0 ||
    !Number.isInteger(input.totalAvailableRooms)
  ) {
    return domainErr("VALIDATION_FAILED", "totalAvailableRooms must be a non-negative integer", {
      totalAvailableRooms: input.totalAvailableRooms,
    });
  }

  const isolationRes = validateTenantIsolation(tenantId, input.reservations, input.folioLines);
  if (!isolationRes.ok) return isolationRes;

  const totalAvailableRooms = input.totalAvailableRooms;
  const totalAvailableBeds =
    input.totalAvailableBeds !== undefined
      ? Math.max(0, Math.floor(input.totalAvailableBeds))
      : totalAvailableRooms * 2;

  return ok({
    tenantId,
    businessDate,
    totalAvailableRooms,
    totalAvailableBeds,
  });
}

/**
 * Deterministic engine for computing daily Night Audit KPIs, SLTDA guest statistics,
 * compounding tax pools, and cryptographically verified audit records.
 *
 * @param input NightAuditCalculationInput configuration and transaction data
 * @returns Result containing complete NightAuditCalculationResult or DomainError
 */
export function runNightAuditCalculation(
  input: NightAuditCalculationInput,
): Result<NightAuditCalculationResult, DomainError> {
  const validationRes = validateNightAuditInput(input);
  if (!validationRes.ok) {
    return validationRes;
  }
  const { tenantId, businessDate, totalAvailableRooms, totalAvailableBeds } = validationRes.value;

  const taxConfig: SriLankaTaxConfig = {
    ...DEFAULT_SRI_LANKA_TAX_CONFIG,
    ...(input.taxConfig ?? {}),
  };

  const guestAggs = aggregateGuestStats(input.reservations, taxConfig);
  const occupiedRooms = input.reservations.length;
  const roomOccupancyRate =
    totalAvailableRooms > 0 ? roundLkr((occupiedRooms / totalAvailableRooms) * 100) : 0;

  const occupiedBeds = guestAggs.totalGuests;
  const bedOccupancyRate =
    totalAvailableBeds > 0 ? roundLkr((occupiedBeds / totalAvailableBeds) * 100) : 0;

  const rev = aggregateRevenueAndTaxes(input.folioLines, taxConfig, guestAggs);

  const adrDenominator = guestAggs.revenueRooms > 0 ? guestAggs.revenueRooms : occupiedRooms;
  const adrLkr =
    adrDenominator > 0 && rev.roomRevenueLkr > 0
      ? roundLkr(rev.roomRevenueLkr / adrDenominator)
      : 0;

  const revParLkr =
    totalAvailableRooms > 0 && rev.roomRevenueLkr > 0
      ? roundLkr(rev.roomRevenueLkr / totalAvailableRooms)
      : 0;

  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.actor.userId,
    action: "NIGHT_AUDIT_EXECUTED",
    entityType: "NightAudit",
    entityId: `${tenantId}#${businessDate}`,
    isoTs: input.timestamp || new Date().toISOString(),
    afterJson: JSON.stringify({
      tenantId,
      businessDate,
      totalAvailableRooms,
      occupiedRooms,
      roomOccupancyRate,
      adrLkr,
      revParLkr,
      totalNetRevenueLkr: rev.totalNetRevenueLkr,
      serviceChargePoolLkr: rev.serviceChargePoolLkr,
      tdlPoolLkr: rev.tdlPoolLkr,
      ssclPoolLkr: rev.ssclPoolLkr,
      vatPoolLkr: rev.vatPoolLkr,
      totalGuests: guestAggs.totalGuests,
      foreignGuestNights: guestAggs.foreignGuestNights,
      localGuestNights: guestAggs.localGuestNights,
    }),
    prevHash: input.prevAuditHash,
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId,
    businessDate,
    totalAvailableRooms,
    occupiedRooms,
    complimentaryRooms: guestAggs.complimentaryRooms,
    houseUseRooms: guestAggs.houseUseRooms,
    revenueRooms: guestAggs.revenueRooms,
    roomOccupancyRate,
    totalAvailableBeds,
    occupiedBeds,
    bedOccupancyRate,
    totalGuests: guestAggs.totalGuests,
    totalForeignGuests: guestAggs.totalForeignGuests,
    totalLocalGuests: guestAggs.totalLocalGuests,
    foreignGuestNights: guestAggs.foreignGuestNights,
    localGuestNights: guestAggs.localGuestNights,
    totalGuestNights: guestAggs.totalGuestNights,
    nationalityBreakdown: guestAggs.nationalityBreakdown,
    adrLkr,
    revParLkr,
    roomRevenueLkr: rev.roomRevenueLkr,
    fAndBRevenueLkr: rev.fAndBRevenueLkr,
    otherRevenueLkr: rev.otherRevenueLkr,
    totalNetRevenueLkr: rev.totalNetRevenueLkr,
    serviceChargePoolLkr: rev.serviceChargePoolLkr,
    tdlPoolLkr: rev.tdlPoolLkr,
    ssclPoolLkr: rev.ssclPoolLkr,
    vatPoolLkr: rev.vatPoolLkr,
    totalTaxAndLevyLkr: rev.totalTaxAndLevyLkr,
    grandTotalRevenueLkr: rev.grandTotalRevenueLkr,
    auditLog: auditRes.value,
  });
}
