/**
 * Room Discrepancy Detector - Sleep / Skip Discrepancy (roomDiscrepancy.ts)
 *
 * Hospitality Revenue Protection & Security Engine for Sri Lankan hotels, resorts, and boutique villas.
 *
 * Operational & Hospitality Principles:
 * - Compares Front-Desk PMS Reservation / Occupancy state (OCCUPIED vs VACANT) against
 *   Housekeeping physical room observations made by attendants during morning cleaning or evening turndown.
 * - Flags High-Risk Discrepancy Conditions:
 *   1. "SKIP": Front Desk says OCCUPIED, but Housekeeping observes room VACANT (luggage missing, bed untouched or empty).
 *      Risk: Walk-out / skipper without paying folio, unannounced early checkout, or keycard fraud.
 *   2. "SLEEP": Front Desk says VACANT / OUT_OF_ORDER, but Housekeeping observes bed SLEPT IN or OCCUPIED.
 *      Risk: Unauthorized occupant, off-the-books cash room sale by night staff, or unregistered guest.
 *   3. "PERSONS_MISMATCH": Front Desk registered count differs from observed guests (e.g., 1 registered vs 3 observed).
 *      Risk: Undeclared extra occupants bypassing per-person supplements or meal entitlements.
 * - Sri Lankan Statutory Tax Compounding:
 *   - Evaluates potential unbilled revenue / recovery value with statutory 4-stage tax math (SC -> TDL -> SSCL -> VAT).
 * - Multi-Tenant SaaS Security & RBAC:
 *   - Tenant isolation via validateTenantId.
 *   - RolePermissionMatrix RBAC (Supervisor, Front Desk Manager, GM, SuperAdmin).
 *   - Immutable SHA-256 hash-chained audit log creation.
 * - Zero external npm dependencies & strict cognitive complexity <= 12 per function.
 */

import { type AuditLogEntry, GENESIS_HASH, computeAuditEntryHash } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type FrontDeskRoomStatus = "OCCUPIED" | "VACANT" | "OUT_OF_ORDER" | "BLOCKED";

export type HousekeepingObservationStatus =
  | "OBSERVED_OCCUPIED"
  | "OBSERVED_VACANT"
  | "OBSERVED_SLEPT"
  | "OBSERVED_DND"
  | "OBSERVED_MAINTENANCE";

export type DiscrepancyType =
  | "MATCH_OCCUPIED"
  | "MATCH_VACANT"
  | "MATCH_OUT_OF_ORDER"
  | "SKIP"
  | "SLEEP"
  | "PERSONS_MISMATCH"
  | "STATUS_UNKNOWN";

export type DiscrepancySeverity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type DiscrepancyActionRecommendation =
  | "NO_ACTION_REQUIRED"
  | "CONTACT_GUEST_AND_LOCK_KEYCARD_CHECK_FOLIO"
  | "INVESTIGATE_UNAUTHORIZED_OCCUPANT_ALERT_SECURITY"
  | "VERIFY_GUEST_COUNT_AND_APPLY_SUPPLEMENT"
  | "SCHEDULE_SUPERVISOR_REINSPECTION";

export type DiscrepancyStaffRole =
  | "SUPER_ADMIN"
  | "HOTEL_OWNER"
  | "GENERAL_MANAGER"
  | "FRONT_DESK_MANAGER"
  | "HOUSEKEEPING_SUPERVISOR"
  | "FRONT_DESK_AGENT"
  | "HOUSEKEEPING_ATTENDANT";

export type DiscrepancyPermission =
  | "DETECT_ROOM_DISCREPANCY"
  | "RESOLVE_ROOM_DISCREPANCY"
  | "OVERRIDE_ROOM_STATUS"
  | "WAIVE_DISCREPANCY_CHARGE";

export interface FrontDeskRoomRecord {
  readonly roomId: string;
  readonly roomNumber: string;
  readonly status: FrontDeskRoomStatus;
  readonly registeredGuestsCount: number;
  readonly guestName?: string | undefined;
  readonly reservationId?: string | undefined;
  readonly expectedCheckOutDateIso?: string | undefined;
  readonly currentFolioBalanceLkr?: number | undefined;
  readonly nightlyRateLkr?: number | undefined;
}

export interface HousekeepingObservationRecord {
  readonly roomId: string;
  readonly roomNumber: string;
  readonly observationStatus: HousekeepingObservationStatus;
  readonly observedGuestsCount: number;
  readonly hasLuggage: boolean;
  readonly bedSleptIn: boolean;
  readonly attendantId: string;
  readonly attendantName: string;
  readonly inspectedAtIso: string;
  readonly notes?: string | undefined;
}

export interface DiscrepancyFinancialImpact {
  readonly baseAmountLkr: number;
  readonly taxes: TaxBreakdownResult;
  readonly totalRecoveryLkr: number;
}

export interface RoomDiscrepancyItem {
  readonly roomId: string;
  readonly roomNumber: string;
  readonly discrepancyType: DiscrepancyType;
  readonly severity: DiscrepancySeverity;
  readonly isDiscrepancy: boolean;
  readonly frontDeskStatus: FrontDeskRoomStatus;
  readonly housekeepingStatus: HousekeepingObservationStatus;
  readonly fdGuestsCount: number;
  readonly hkGuestsCount: number;
  readonly hasLuggage: boolean;
  readonly bedSleptIn: boolean;
  readonly recommendation: DiscrepancyActionRecommendation;
  readonly financialImpact?: DiscrepancyFinancialImpact | undefined;
  readonly guestName?: string | undefined;
  readonly reservationId?: string | undefined;
  readonly attendantName: string;
  readonly inspectedAtIso: string;
  readonly notes?: string | undefined;
}

export interface DetectRoomDiscrepanciesInput {
  readonly tenantId: string;
  readonly auditDateIso: string;
  readonly frontDeskRooms: readonly FrontDeskRoomRecord[];
  readonly housekeepingObservations: readonly HousekeepingObservationRecord[];
  readonly defaultNightlyRateLkr?: number | undefined;
  readonly extraPersonSupplementLkr?: number | undefined;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
}

export interface RoomDiscrepancyReport {
  readonly tenantId: string;
  readonly auditDateIso: string;
  readonly totalRoomsChecked: number;
  readonly matchingRoomsCount: number;
  readonly totalDiscrepanciesCount: number;
  readonly skipCount: number;
  readonly sleepCount: number;
  readonly personsMismatchCount: number;
  readonly unknownStatusCount: number;
  readonly totalPotentialRevenueRiskLkr: number;
  readonly items: readonly RoomDiscrepancyItem[];
  readonly auditLogPayload: Readonly<Record<string, unknown>>;
}

export type DiscrepancyResolutionAction =
  | "CONFIRMED_SKIPPER_FOLIO_POSTED"
  | "GUEST_CHECKED_OUT_LATE_UPDATED"
  | "UNAUTHORIZED_SLEEPER_EVICTED"
  | "WALK_IN_BACKDATED_BILLED"
  | "EXTRA_PERSON_CHARGE_POSTED"
  | "FALSE_ALARM_DISMISSED";

export interface ResolveDiscrepancyInput {
  readonly tenantId: string;
  readonly roomId: string;
  readonly resolutionAction: DiscrepancyResolutionAction;
  readonly actorUserId: string;
  readonly actorRole: DiscrepancyStaffRole;
  readonly resolutionNotes: string;
  readonly resolvedAtIso: string;
  readonly adjustedFolioAmountLkr?: number | undefined;
  readonly prevAuditHash?: string | undefined;
}

export interface DiscrepancyResolutionResult {
  readonly tenantId: string;
  readonly roomId: string;
  readonly resolved: boolean;
  readonly resolutionAction: DiscrepancyResolutionAction;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Constants & Defaults
// ============================================================================

export const DEFAULT_EXTRA_PERSON_SUPPLEMENT_LKR = 3500;
export const DEFAULT_DISCREPANCY_ROOM_RATE_LKR = 22000;

// ============================================================================
// RBAC Matrix
// ============================================================================

const ROLE_PERMISSIONS: Readonly<Record<DiscrepancyStaffRole, readonly DiscrepancyPermission[]>> = {
  SUPER_ADMIN: [
    "DETECT_ROOM_DISCREPANCY",
    "RESOLVE_ROOM_DISCREPANCY",
    "OVERRIDE_ROOM_STATUS",
    "WAIVE_DISCREPANCY_CHARGE",
  ],
  HOTEL_OWNER: [
    "DETECT_ROOM_DISCREPANCY",
    "RESOLVE_ROOM_DISCREPANCY",
    "OVERRIDE_ROOM_STATUS",
    "WAIVE_DISCREPANCY_CHARGE",
  ],
  GENERAL_MANAGER: [
    "DETECT_ROOM_DISCREPANCY",
    "RESOLVE_ROOM_DISCREPANCY",
    "OVERRIDE_ROOM_STATUS",
    "WAIVE_DISCREPANCY_CHARGE",
  ],
  FRONT_DESK_MANAGER: [
    "DETECT_ROOM_DISCREPANCY",
    "RESOLVE_ROOM_DISCREPANCY",
    "OVERRIDE_ROOM_STATUS",
  ],
  HOUSEKEEPING_SUPERVISOR: ["DETECT_ROOM_DISCREPANCY", "RESOLVE_ROOM_DISCREPANCY"],
  FRONT_DESK_AGENT: ["DETECT_ROOM_DISCREPANCY"],
  HOUSEKEEPING_ATTENDANT: ["DETECT_ROOM_DISCREPANCY"],
};

/**
 * Validates RBAC permissions for room discrepancy operations.
 */
export function authorizeDiscrepancyOperation(
  userTenantId: string,
  role: DiscrepancyStaffRole,
  targetTenantId: string,
  permission: DiscrepancyPermission,
): Result<boolean, DomainError> {
  const normUserTenant = userTenantId.trim().toLowerCase();
  const normTargetTenant = targetTenantId.trim().toLowerCase();

  if (role !== "SUPER_ADMIN" && normUserTenant !== normTargetTenant) {
    return domainErr("TENANT_MISMATCH", "Cross-tenant room discrepancy operations are forbidden", {
      userTenantId,
      targetTenantId,
    });
  }

  const permissions = ROLE_PERMISSIONS[role] ?? [];
  if (!permissions.includes(permission)) {
    return domainErr("PERMISSION_DENIED", `Role '${role}' lacks permission '${permission}'`, {
      role,
      permission,
    });
  }

  return ok(true);
}

// ============================================================================
// Discrepancy Classification & Pure Math (Complexity <= 12)
// ============================================================================

function computeSkipFinancialImpact(
  fd: FrontDeskRoomRecord,
  defaultNightlyRateLkr: number,
  taxConfig: SriLankaTaxConfig,
): DiscrepancyFinancialImpact {
  const baseRate = fd.nightlyRateLkr ?? defaultNightlyRateLkr;
  const taxResult = calculateForwardTax(baseRate, taxConfig);
  const taxBreakdown = taxResult.ok
    ? taxResult.value
    : {
        baseLkr: baseRate,
        scLkr: roundLkr(baseRate * 0.1),
        subtotalAfterScLkr: roundLkr(baseRate * 1.1),
        tdlLkr: roundLkr(baseRate * 1.1 * 0.01),
        ssclLkr: roundLkr(baseRate * 1.1 * 0.025),
        vatBaseLkr: roundLkr(baseRate * 1.1 * 1.035),
        vatLkr: roundLkr(baseRate * 1.1 * 1.035 * 0.18),
        grandTotalLkr: roundLkr(baseRate * 1.3414),
        effectiveTaxRate: 0.3414,
        isVatRegistered: true,
      };

  const folioOutstanding = fd.currentFolioBalanceLkr ?? 0;
  const totalRecoveryLkr = roundLkr(folioOutstanding + taxBreakdown.grandTotalLkr);

  return {
    baseAmountLkr: baseRate,
    taxes: taxBreakdown,
    totalRecoveryLkr,
  };
}

function computeSleepFinancialImpact(
  nightlyRateLkr: number,
  taxConfig: SriLankaTaxConfig,
): DiscrepancyFinancialImpact {
  const taxResult = calculateForwardTax(nightlyRateLkr, taxConfig);
  const taxBreakdown = taxResult.ok
    ? taxResult.value
    : {
        baseLkr: nightlyRateLkr,
        scLkr: roundLkr(nightlyRateLkr * 0.1),
        subtotalAfterScLkr: roundLkr(nightlyRateLkr * 1.1),
        tdlLkr: roundLkr(nightlyRateLkr * 1.1 * 0.01),
        ssclLkr: roundLkr(nightlyRateLkr * 1.1 * 0.025),
        vatBaseLkr: roundLkr(nightlyRateLkr * 1.1 * 1.035),
        vatLkr: roundLkr(nightlyRateLkr * 1.1 * 1.035 * 0.18),
        grandTotalLkr: roundLkr(nightlyRateLkr * 1.3414),
        effectiveTaxRate: 0.3414,
        isVatRegistered: true,
      };

  return {
    baseAmountLkr: nightlyRateLkr,
    taxes: taxBreakdown,
    totalRecoveryLkr: taxBreakdown.grandTotalLkr,
  };
}

function computePersonsMismatchFinancialImpact(
  extraGuestsCount: number,
  supplementPerGuestLkr: number,
  taxConfig: SriLankaTaxConfig,
): DiscrepancyFinancialImpact {
  const baseSupplement = roundLkr(extraGuestsCount * supplementPerGuestLkr);
  const taxResult = calculateForwardTax(baseSupplement, taxConfig);
  const taxBreakdown = taxResult.ok
    ? taxResult.value
    : {
        baseLkr: baseSupplement,
        scLkr: roundLkr(baseSupplement * 0.1),
        subtotalAfterScLkr: roundLkr(baseSupplement * 1.1),
        tdlLkr: roundLkr(baseSupplement * 1.1 * 0.01),
        ssclLkr: roundLkr(baseSupplement * 1.1 * 0.025),
        vatBaseLkr: roundLkr(baseSupplement * 1.1 * 1.035),
        vatLkr: roundLkr(baseSupplement * 1.1 * 1.035 * 0.18),
        grandTotalLkr: roundLkr(baseSupplement * 1.3414),
        effectiveTaxRate: 0.3414,
        isVatRegistered: true,
      };

  return {
    baseAmountLkr: baseSupplement,
    taxes: taxBreakdown,
    totalRecoveryLkr: taxBreakdown.grandTotalLkr,
  };
}

function evaluateOccupiedDiscrepancy(
  fd: FrontDeskRoomRecord,
  hk: HousekeepingObservationRecord,
  defaultNightlyRateLkr: number,
  extraPersonSupplementLkr: number,
  taxConfig: SriLankaTaxConfig,
): {
  readonly discrepancyType: DiscrepancyType;
  readonly severity: DiscrepancySeverity;
  readonly isDiscrepancy: boolean;
  readonly recommendation: DiscrepancyActionRecommendation;
  readonly financialImpact?: DiscrepancyFinancialImpact | undefined;
} {
  // If HK observed DND, observation is uncertain and requires follow-up
  if (hk.observationStatus === "OBSERVED_DND") {
    return {
      discrepancyType: "STATUS_UNKNOWN",
      severity: "LOW",
      isDiscrepancy: false,
      recommendation: "SCHEDULE_SUPERVISOR_REINSPECTION",
    };
  }

  // If HK observes room empty/vacant without luggage or slept bed -> SKIP condition
  if (
    hk.observationStatus === "OBSERVED_VACANT" ||
    (!hk.hasLuggage && !hk.bedSleptIn && hk.observedGuestsCount === 0)
  ) {
    const hasFolioBalance = (fd.currentFolioBalanceLkr ?? 0) > 0;
    const severity: DiscrepancySeverity = hasFolioBalance ? "CRITICAL" : "HIGH";
    const financialImpact = computeSkipFinancialImpact(fd, defaultNightlyRateLkr, taxConfig);
    return {
      discrepancyType: "SKIP",
      severity,
      isDiscrepancy: true,
      recommendation: "CONTACT_GUEST_AND_LOCK_KEYCARD_CHECK_FOLIO",
      financialImpact,
    };
  }

  // Check for person count discrepancy
  if (hk.observedGuestsCount > fd.registeredGuestsCount) {
    const diff = hk.observedGuestsCount - fd.registeredGuestsCount;
    const financialImpact = computePersonsMismatchFinancialImpact(
      diff,
      extraPersonSupplementLkr,
      taxConfig,
    );
    return {
      discrepancyType: "PERSONS_MISMATCH",
      severity: "MEDIUM",
      isDiscrepancy: true,
      recommendation: "VERIFY_GUEST_COUNT_AND_APPLY_SUPPLEMENT",
      financialImpact,
    };
  }

  // Both agree room is occupied
  return {
    discrepancyType: "MATCH_OCCUPIED",
    severity: "NONE",
    isDiscrepancy: false,
    recommendation: "NO_ACTION_REQUIRED",
  };
}

function evaluateVacantDiscrepancy(
  fd: FrontDeskRoomRecord,
  hk: HousekeepingObservationRecord,
  defaultNightlyRateLkr: number,
  taxConfig: SriLankaTaxConfig,
): {
  readonly discrepancyType: DiscrepancyType;
  readonly severity: DiscrepancySeverity;
  readonly isDiscrepancy: boolean;
  readonly recommendation: DiscrepancyActionRecommendation;
  readonly financialImpact?: DiscrepancyFinancialImpact | undefined;
} {
  // If HK observes room occupied or bed slept in or luggage present -> SLEEP condition
  const hasPhysicalOccupancy =
    hk.observationStatus === "OBSERVED_OCCUPIED" ||
    hk.observationStatus === "OBSERVED_SLEPT" ||
    hk.bedSleptIn ||
    hk.hasLuggage ||
    hk.observedGuestsCount > 0;

  if (hasPhysicalOccupancy) {
    const nightlyRate = fd.nightlyRateLkr ?? defaultNightlyRateLkr;
    const financialImpact = computeSleepFinancialImpact(nightlyRate, taxConfig);
    return {
      discrepancyType: "SLEEP",
      severity: "CRITICAL",
      isDiscrepancy: true,
      recommendation: "INVESTIGATE_UNAUTHORIZED_OCCUPANT_ALERT_SECURITY",
      financialImpact,
    };
  }

  if (hk.observationStatus === "OBSERVED_DND") {
    // Vacant room with DND is suspicious
    const nightlyRate = fd.nightlyRateLkr ?? defaultNightlyRateLkr;
    const financialImpact = computeSleepFinancialImpact(nightlyRate, taxConfig);
    return {
      discrepancyType: "SLEEP",
      severity: "CRITICAL",
      isDiscrepancy: true,
      recommendation: "INVESTIGATE_UNAUTHORIZED_OCCUPANT_ALERT_SECURITY",
      financialImpact,
    };
  }

  return {
    discrepancyType: "MATCH_VACANT",
    severity: "NONE",
    isDiscrepancy: false,
    recommendation: "NO_ACTION_REQUIRED",
  };
}

function evaluateOutOfOrderDiscrepancy(
  fd: FrontDeskRoomRecord,
  hk: HousekeepingObservationRecord,
  defaultNightlyRateLkr: number,
  taxConfig: SriLankaTaxConfig,
): {
  readonly discrepancyType: DiscrepancyType;
  readonly severity: DiscrepancySeverity;
  readonly isDiscrepancy: boolean;
  readonly recommendation: DiscrepancyActionRecommendation;
  readonly financialImpact?: DiscrepancyFinancialImpact | undefined;
} {
  const hasPhysicalOccupancy =
    hk.observationStatus === "OBSERVED_OCCUPIED" ||
    hk.observationStatus === "OBSERVED_SLEPT" ||
    hk.bedSleptIn ||
    hk.hasLuggage ||
    hk.observedGuestsCount > 0;

  if (hasPhysicalOccupancy) {
    const nightlyRate = fd.nightlyRateLkr ?? defaultNightlyRateLkr;
    const financialImpact = computeSleepFinancialImpact(nightlyRate, taxConfig);
    return {
      discrepancyType: "SLEEP",
      severity: "CRITICAL",
      isDiscrepancy: true,
      recommendation: "INVESTIGATE_UNAUTHORIZED_OCCUPANT_ALERT_SECURITY",
      financialImpact,
    };
  }

  return {
    discrepancyType: "MATCH_OUT_OF_ORDER",
    severity: "NONE",
    isDiscrepancy: false,
    recommendation: "NO_ACTION_REQUIRED",
  };
}

/**
 * Evaluates room discrepancy between front-desk record and housekeeping observation.
 */
export function classifyRoomDiscrepancy(
  fd: FrontDeskRoomRecord,
  hk: HousekeepingObservationRecord,
  defaultNightlyRateLkr: number = DEFAULT_DISCREPANCY_ROOM_RATE_LKR,
  extraPersonSupplementLkr: number = DEFAULT_EXTRA_PERSON_SUPPLEMENT_LKR,
  taxConfig: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
): RoomDiscrepancyItem {
  let evaluated: {
    readonly discrepancyType: DiscrepancyType;
    readonly severity: DiscrepancySeverity;
    readonly isDiscrepancy: boolean;
    readonly recommendation: DiscrepancyActionRecommendation;
    readonly financialImpact?: DiscrepancyFinancialImpact | undefined;
  };

  switch (fd.status) {
    case "OCCUPIED":
      evaluated = evaluateOccupiedDiscrepancy(
        fd,
        hk,
        defaultNightlyRateLkr,
        extraPersonSupplementLkr,
        taxConfig,
      );
      break;
    case "VACANT":
      evaluated = evaluateVacantDiscrepancy(fd, hk, defaultNightlyRateLkr, taxConfig);
      break;
    case "OUT_OF_ORDER":
    case "BLOCKED":
      evaluated = evaluateOutOfOrderDiscrepancy(fd, hk, defaultNightlyRateLkr, taxConfig);
      break;
  }

  return {
    roomId: fd.roomId,
    roomNumber: fd.roomNumber,
    discrepancyType: evaluated.discrepancyType,
    severity: evaluated.severity,
    isDiscrepancy: evaluated.isDiscrepancy,
    frontDeskStatus: fd.status,
    housekeepingStatus: hk.observationStatus,
    fdGuestsCount: fd.registeredGuestsCount,
    hkGuestsCount: hk.observedGuestsCount,
    hasLuggage: hk.hasLuggage,
    bedSleptIn: hk.bedSleptIn,
    recommendation: evaluated.recommendation,
    financialImpact: evaluated.financialImpact,
    guestName: fd.guestName,
    reservationId: fd.reservationId,
    attendantName: hk.attendantName,
    inspectedAtIso: hk.inspectedAtIso,
    notes: hk.notes,
  };
}

// ============================================================================
// Batch Discrepancy Detection & Report Generator
// ============================================================================

function validateDetectInput(input: DetectRoomDiscrepanciesInput): Result<string, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }

  if (typeof input.auditDateIso !== "string" || input.auditDateIso.trim() === "") {
    return domainErr("VALIDATION_FAILED", "auditDateIso must be a non-empty string");
  }

  if (!Array.isArray(input.frontDeskRooms) || input.frontDeskRooms.length === 0) {
    return domainErr("VALIDATION_FAILED", "At least one frontDeskRoom record is required");
  }

  if (
    !Array.isArray(input.housekeepingObservations) ||
    input.housekeepingObservations.length === 0
  ) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least one housekeepingObservation record is required",
    );
  }

  return ok(tenantRes.value);
}

function countDiscrepancyMetrics(items: readonly RoomDiscrepancyItem[]): {
  readonly totalRoomsChecked: number;
  readonly matchingRoomsCount: number;
  readonly totalDiscrepanciesCount: number;
  readonly skipCount: number;
  readonly sleepCount: number;
  readonly personsMismatchCount: number;
  readonly unknownStatusCount: number;
  readonly totalPotentialRevenueRiskLkr: number;
} {
  let matchingRoomsCount = 0;
  let totalDiscrepanciesCount = 0;
  let skipCount = 0;
  let sleepCount = 0;
  let personsMismatchCount = 0;
  let unknownStatusCount = 0;
  let totalPotentialRevenueRiskLkr = 0;

  for (const item of items) {
    if (item.financialImpact) {
      totalPotentialRevenueRiskLkr += item.financialImpact.totalRecoveryLkr;
    }

    if (!item.isDiscrepancy) {
      if (item.discrepancyType === "STATUS_UNKNOWN") {
        unknownStatusCount += 1;
      } else {
        matchingRoomsCount += 1;
      }
      continue;
    }

    totalDiscrepanciesCount += 1;
    if (item.discrepancyType === "SKIP") {
      skipCount += 1;
    } else if (item.discrepancyType === "SLEEP") {
      sleepCount += 1;
    } else if (item.discrepancyType === "PERSONS_MISMATCH") {
      personsMismatchCount += 1;
    }
  }

  return {
    totalRoomsChecked: items.length,
    matchingRoomsCount,
    totalDiscrepanciesCount,
    skipCount,
    sleepCount,
    personsMismatchCount,
    unknownStatusCount,
    totalPotentialRevenueRiskLkr: roundLkr(totalPotentialRevenueRiskLkr),
  };
}

/**
 * Runs bulk discrepancy detection across hotel inventory.
 */
export function detectRoomDiscrepancies(
  input: DetectRoomDiscrepanciesInput,
): Result<RoomDiscrepancyReport, DomainError> {
  const validTenant = validateDetectInput(input);
  if (!validTenant.ok) {
    return validTenant;
  }

  const tenantId = validTenant.value;
  const hkMap = new Map<string, HousekeepingObservationRecord>();
  for (const hk of input.housekeepingObservations) {
    hkMap.set(hk.roomId, hk);
  }

  const defaultRate = input.defaultNightlyRateLkr ?? DEFAULT_DISCREPANCY_ROOM_RATE_LKR;
  const supplement = input.extraPersonSupplementLkr ?? DEFAULT_EXTRA_PERSON_SUPPLEMENT_LKR;
  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;

  const items: RoomDiscrepancyItem[] = [];

  for (const fd of input.frontDeskRooms) {
    const hk = hkMap.get(fd.roomId);
    if (!hk) {
      // Missing housekeeping observation is flagged as UNKNOWN status
      items.push({
        roomId: fd.roomId,
        roomNumber: fd.roomNumber,
        discrepancyType: "STATUS_UNKNOWN",
        severity: "LOW",
        isDiscrepancy: false,
        frontDeskStatus: fd.status,
        housekeepingStatus: "OBSERVED_VACANT",
        fdGuestsCount: fd.registeredGuestsCount,
        hkGuestsCount: 0,
        hasLuggage: false,
        bedSleptIn: false,
        recommendation: "SCHEDULE_SUPERVISOR_REINSPECTION",
        guestName: fd.guestName,
        reservationId: fd.reservationId,
        attendantName: "UNASSIGNED",
        inspectedAtIso: input.auditDateIso,
        notes: "Missing attendant physical inspection observation.",
      });
      continue;
    }

    const item = classifyRoomDiscrepancy(fd, hk, defaultRate, supplement, taxConfig);
    items.push(item);
  }

  const metrics = countDiscrepancyMetrics(items);

  const auditLogPayload: Readonly<Record<string, unknown>> = {
    action: "DETECT_ROOM_DISCREPANCY_AUDIT",
    tenantId,
    auditDateIso: input.auditDateIso,
    totalRoomsChecked: metrics.totalRoomsChecked,
    totalDiscrepanciesCount: metrics.totalDiscrepanciesCount,
    skipCount: metrics.skipCount,
    sleepCount: metrics.sleepCount,
    personsMismatchCount: metrics.personsMismatchCount,
    totalPotentialRevenueRiskLkr: metrics.totalPotentialRevenueRiskLkr,
  };

  return ok({
    tenantId,
    auditDateIso: input.auditDateIso,
    totalRoomsChecked: metrics.totalRoomsChecked,
    matchingRoomsCount: metrics.matchingRoomsCount,
    totalDiscrepanciesCount: metrics.totalDiscrepanciesCount,
    skipCount: metrics.skipCount,
    sleepCount: metrics.sleepCount,
    personsMismatchCount: metrics.personsMismatchCount,
    unknownStatusCount: metrics.unknownStatusCount,
    totalPotentialRevenueRiskLkr: metrics.totalPotentialRevenueRiskLkr,
    items,
    auditLogPayload,
  });
}

// ============================================================================
// Discrepancy Resolution & Hash-Chained Audit Trail
// ============================================================================

/**
 * Resolves a room discrepancy with supervisor/manager sign-off and hash-chained audit logging.
 */
export function resolveRoomDiscrepancy(
  input: ResolveDiscrepancyInput,
): Result<DiscrepancyResolutionResult, DomainError> {
  const validTenant = validateTenantId(input.tenantId);
  if (!validTenant.ok) {
    return validTenant;
  }

  const authRes = authorizeDiscrepancyOperation(
    input.tenantId,
    input.actorRole,
    input.tenantId,
    "RESOLVE_ROOM_DISCREPANCY",
  );
  if (!authRes.ok) {
    return authRes;
  }

  if (typeof input.roomId !== "string" || input.roomId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "roomId must be a non-empty string");
  }

  if (typeof input.resolutionNotes !== "string" || input.resolutionNotes.trim() === "") {
    return domainErr(
      "VALIDATION_FAILED",
      "resolutionNotes must be provided for supervisor audit trail",
    );
  }

  const tenantId = validTenant.value;
  const prevHash = input.prevAuditHash ?? GENESIS_HASH;
  const afterPayload = JSON.stringify({
    roomId: input.roomId,
    resolutionAction: input.resolutionAction,
    notes: input.resolutionNotes,
    adjustedFolioAmountLkr: input.adjustedFolioAmountLkr ?? 0,
    resolvedAtIso: input.resolvedAtIso,
  });

  const entryHash = computeAuditEntryHash({
    prevHash,
    tenantId,
    actorUserId: input.actorUserId,
    action: `RESOLVE_DISCREPANCY_${input.resolutionAction}`,
    entityType: "ROOM_DISCREPANCY",
    entityId: input.roomId,
    isoTs: input.resolvedAtIso,
    afterJson: afterPayload,
  });

  const auditEntry: AuditLogEntry = {
    tenantId,
    actorUserId: input.actorUserId,
    action: `RESOLVE_DISCREPANCY_${input.resolutionAction}`,
    entityType: "ROOM_DISCREPANCY",
    entityId: input.roomId,
    isoTs: input.resolvedAtIso,
    afterJson: afterPayload,
    prevHash,
    entryHash,
  };

  return ok({
    tenantId,
    roomId: input.roomId,
    resolved: true,
    resolutionAction: input.resolutionAction,
    auditEntry,
  });
}

/**
 * Computes a hash-chained audit entry for the discrepancy detection report.
 */
export function computeDiscrepancyAuditEntry(
  report: RoomDiscrepancyReport,
  actorUserId: string,
  prevHash: string = GENESIS_HASH,
): AuditLogEntry {
  const afterJson = JSON.stringify(report.auditLogPayload);
  const entryHash = computeAuditEntryHash({
    prevHash,
    tenantId: report.tenantId,
    actorUserId,
    action: "AUDIT_ROOM_DISCREPANCY_BATCH",
    entityType: "ROOM_DISCREPANCY_REPORT",
    entityId: `${report.tenantId}-${report.auditDateIso}`,
    isoTs: report.auditDateIso,
    afterJson,
  });

  return {
    tenantId: report.tenantId,
    actorUserId,
    action: "AUDIT_ROOM_DISCREPANCY_BATCH",
    entityType: "ROOM_DISCREPANCY_REPORT",
    entityId: `${report.tenantId}-${report.auditDateIso}`,
    isoTs: report.auditDateIso,
    afterJson,
    prevHash,
    entryHash,
  };
}
