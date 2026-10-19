/**
 * @hms/core - Split-Folio Routing Engine.
 *
 * Implements automated split billing for Sri Lankan hospitality operations:
 * - Directs contracted ROOM & MEAL_PLAN charges to Tour Operator / DMC Master Folio (`FOLIO#<id>#MASTER_DMC`).
 * - Directs guest incidentals (FNB, SPA, MINIBAR, LAUNDRY, EXCURSION, CORKAGE) to Guest Personal Folio (`FOLIO#<id>#GUEST_PERSONAL`).
 * - Supports credit cap spillover where expenses exceeding travel agent voucher allowances spill into guest personal folio.
 * - Handles inter-folio line item transfers with cryptographic SHA-256 hash-chained audit logging.
 * - Calculates independent 4-stage compounding statutory taxes (SC 10% -> TDL 1% -> SSCL 2.5% -> VAT 18%) per sub-folio.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import {
  type AggregatedFolioTaxes,
  type FolioDepartment,
  type FolioLineItem,
  aggregateFolioTaxes,
} from "./folioMath.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { DEFAULT_SRI_LANKA_TAX_CONFIG, type SriLankaTaxConfig, roundLkr } from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

/**
 * Sub-folio destination partitions under a single guest stay reservation.
 */
export type SplitFolioTarget = "MASTER_DMC" | "GUEST_PERSONAL";

/**
 * Charge categories recognized by the split routing engine.
 */
export type SplitChargeCategory =
  | "ROOM"
  | "MEAL_PLAN"
  | "FNB"
  | "SPA"
  | "MINIBAR"
  | "LAUNDRY"
  | "EXCURSION"
  | "CORKAGE"
  | "OTHER";

/**
 * Reservation billing structure.
 */
export type ReservationBillingType = "DIRECT_GUEST" | "DMC_VOUCHER" | "CORPORATE" | "WHOLESALER";

/**
 * Destination Management Company (DMC) or Tour Operator contract coverage.
 */
export interface DmcVoucherCoverage {
  readonly contractId: string;
  readonly voucherNumber: string;
  readonly tourOperatorName: string;
  readonly includedMealPlan: "RO" | "BB" | "HB" | "FB" | "AI";
  /** Categories explicitly covered by the DMC voucher. Default: ["ROOM", "MEAL_PLAN"] */
  readonly coveredCategories?: ReadonlyArray<SplitChargeCategory> | undefined;
  /** Maximum credit limit in LKR that DMC will cover before spillover to guest */
  readonly creditLimitLkr?: number | undefined;
}

/**
 * Custom override rule directing specific line items or departments.
 */
export interface CustomRoutingRule {
  readonly category: SplitChargeCategory;
  readonly targetFolio: SplitFolioTarget;
  /** Optional cap in LKR for this specific category */
  readonly maxCoveredLkr?: number | undefined;
}

/**
 * Configuration profile for a reservation's split folio routing.
 */
export interface SplitFolioConfig {
  readonly tenantId: string;
  readonly reservationId: string;
  readonly billingType: ReservationBillingType;
  readonly dmcCoverage?: DmcVoucherCoverage | undefined;
  readonly fixedMasterCapLkr?: number | undefined;
  readonly customRules?: ReadonlyArray<CustomRoutingRule> | undefined;
}

/**
 * Unrouted charge posting item submitted by Front Desk, POS, KDS, or Housekeeping.
 */
export interface ChargePostingItem {
  readonly lineId: string;
  readonly category: SplitChargeCategory;
  readonly description: string;
  readonly quantity: number;
  readonly unitBaseLkr: number;
  readonly scExempt?: boolean | undefined;
  readonly targetFolioOverride?: SplitFolioTarget | undefined;
  readonly postedAt?: string | undefined;
}

/**
 * Charge item routed to a specific sub-folio partition with calculated line total.
 */
export interface RoutedFolioLine {
  readonly lineId: string;
  readonly category: SplitChargeCategory;
  readonly description: string;
  readonly quantity: number;
  readonly unitBaseLkr: number;
  readonly scExempt: boolean;
  readonly targetFolio: SplitFolioTarget;
  readonly folioPartitionKey: string;
  readonly lineBaseLkr: number;
  readonly isSpillover?: boolean | undefined;
  readonly postedAt: string;
}

/**
 * Comprehensive partitioned routing result across master and guest folios.
 */
export interface SplitFolioRoutingResult {
  readonly tenantId: string;
  readonly reservationId: string;
  readonly billingType: ReservationBillingType;
  readonly masterDmcPartitionKey: string;
  readonly guestPersonalPartitionKey: string;
  readonly masterDmcLines: ReadonlyArray<RoutedFolioLine>;
  readonly guestPersonalLines: ReadonlyArray<RoutedFolioLine>;
  readonly masterDmcTaxes: AggregatedFolioTaxes;
  readonly guestPersonalTaxes: AggregatedFolioTaxes;
  readonly totalMasterBaseLkr: number;
  readonly totalGuestBaseLkr: number;
  readonly grandTotalLkr: number;
}

/**
 * Input request for transferring a posted line between folios.
 */
export interface FolioLineTransferRequest {
  readonly tenantId: string;
  readonly reservationId: string;
  readonly lineId: string;
  readonly fromTarget: SplitFolioTarget;
  readonly toTarget: SplitFolioTarget;
  readonly reason: string;
  readonly staffUserId: string;
  readonly prevAuditHash: string;
  readonly isoTs?: string | undefined;
}

// ============================================================================
// Core Routing Pure Functions
// ============================================================================

/**
 * Generates the standardized DynamoDB composite partition key for a sub-folio.
 * Pattern: `FOLIO#<reservationId>#<target>`
 */
export function createFolioPartitionKey(reservationId: string, target: SplitFolioTarget): string {
  const cleanId = reservationId.trim().toUpperCase();
  return `FOLIO#${cleanId}#${target}`;
}

/**
 * Maps SplitChargeCategory to folioMath FolioDepartment.
 */
export function mapCategoryToDepartment(category: SplitChargeCategory): FolioDepartment {
  switch (category) {
    case "ROOM":
    case "MEAL_PLAN":
      return "ROOM";
    case "FNB":
      return "FNB";
    case "SPA":
      return "SPA";
    case "LAUNDRY":
      return "LAUNDRY";
    case "MINIBAR":
      return "MINIBAR";
    case "EXCURSION":
      return "EXCURSION";
    case "CORKAGE":
      return "CORKAGE";
    case "OTHER":
      return "ROOM";
  }
}

/**
 * Evaluates default destination folio for a charge category given reservation billing rules.
 *
 * DMC Contract Rules (Sri Lankan Tourism Standard):
 * - ROOM & MEAL_PLAN -> MASTER_DMC
 * - Incidentals (FNB, SPA, MINIBAR, LAUNDRY, EXCURSION, CORKAGE) -> GUEST_PERSONAL
 */
export function determineDefaultTarget(
  category: SplitChargeCategory,
  config: SplitFolioConfig,
): SplitFolioTarget {
  // Direct guest bookings have no DMC master folio; everything is guest personal
  if (config.billingType === "DIRECT_GUEST") {
    return "GUEST_PERSONAL";
  }

  // Check custom routing overrides first
  if (config.customRules && config.customRules.length > 0) {
    const override = config.customRules.find((r) => r.category === category);
    if (override) {
      return override.targetFolio;
    }
  }

  // DMC voucher or corporate contract coverage
  const covered = config.dmcCoverage?.coveredCategories ?? ["ROOM", "MEAL_PLAN"];
  if (covered.includes(category)) {
    return "MASTER_DMC";
  }

  return "GUEST_PERSONAL";
}

function convertToFolioLineItem(line: RoutedFolioLine): FolioLineItem {
  return {
    lineId: line.lineId,
    department: mapCategoryToDepartment(line.category),
    description: line.description,
    quantity: line.quantity,
    unitBaseLkr: line.unitBaseLkr,
    scExempt: line.scExempt,
    isVoided: false,
  };
}

interface AccumulatorState {
  currentMasterBase: number;
  readonly masterCap: number;
  readonly masterLines: RoutedFolioLine[];
  readonly guestLines: RoutedFolioLine[];
  readonly reservationId: string;
}

function processDirectTarget(
  item: ChargePostingItem,
  target: SplitFolioTarget,
  lineBase: number,
  acc: AccumulatorState,
  defaultTimestamp: string,
): void {
  const line: RoutedFolioLine = {
    lineId: item.lineId,
    category: item.category,
    description: item.description,
    quantity: item.quantity,
    unitBaseLkr: item.unitBaseLkr,
    scExempt: Boolean(item.scExempt),
    targetFolio: target,
    folioPartitionKey: createFolioPartitionKey(acc.reservationId, target),
    lineBaseLkr: lineBase,
    isSpillover: false,
    postedAt: item.postedAt ?? defaultTimestamp,
  };

  if (target === "MASTER_DMC") {
    acc.currentMasterBase += lineBase;
    acc.masterLines.push(line);
  } else {
    acc.guestLines.push(line);
  }
}

function processCappedMasterTarget(
  item: ChargePostingItem,
  lineBase: number,
  acc: AccumulatorState,
  defaultTimestamp: string,
): void {
  const remainingAllowance = Math.max(0, acc.masterCap - acc.currentMasterBase);

  if (remainingAllowance >= lineBase) {
    // Entire line fits within DMC master cap
    processDirectTarget(item, "MASTER_DMC", lineBase, acc, defaultTimestamp);
    return;
  }

  if (remainingAllowance <= 0) {
    // DMC master cap already exhausted; entire line spills over to guest personal
    const spilloverLine: RoutedFolioLine = {
      lineId: item.lineId,
      category: item.category,
      description: `${item.description} (DMC Cap Exceeded - Guest Paid)`,
      quantity: item.quantity,
      unitBaseLkr: item.unitBaseLkr,
      scExempt: Boolean(item.scExempt),
      targetFolio: "GUEST_PERSONAL",
      folioPartitionKey: createFolioPartitionKey(acc.reservationId, "GUEST_PERSONAL"),
      lineBaseLkr: lineBase,
      isSpillover: true,
      postedAt: item.postedAt ?? defaultTimestamp,
    };
    acc.guestLines.push(spilloverLine);
    return;
  }

  // Partial spillover: line crosses the master allowance boundary
  const masterBase = roundLkr(remainingAllowance);
  const guestBase = roundLkr(lineBase - masterBase);

  acc.currentMasterBase += masterBase;

  const masterPart: RoutedFolioLine = {
    lineId: `${item.lineId}-DMC`,
    category: item.category,
    description: `${item.description} (DMC Voucher Covered)`,
    quantity: 1,
    unitBaseLkr: masterBase,
    scExempt: Boolean(item.scExempt),
    targetFolio: "MASTER_DMC",
    folioPartitionKey: createFolioPartitionKey(acc.reservationId, "MASTER_DMC"),
    lineBaseLkr: masterBase,
    isSpillover: false,
    postedAt: item.postedAt ?? defaultTimestamp,
  };
  acc.masterLines.push(masterPart);

  const guestPart: RoutedFolioLine = {
    lineId: `${item.lineId}-GUEST`,
    category: item.category,
    description: `${item.description} (Over-Voucher Spillover)`,
    quantity: 1,
    unitBaseLkr: guestBase,
    scExempt: Boolean(item.scExempt),
    targetFolio: "GUEST_PERSONAL",
    folioPartitionKey: createFolioPartitionKey(acc.reservationId, "GUEST_PERSONAL"),
    lineBaseLkr: guestBase,
    isSpillover: true,
    postedAt: item.postedAt ?? defaultTimestamp,
  };
  acc.guestLines.push(guestPart);
}

function validateRoutingInputs(config: SplitFolioConfig): Result<string, DomainError> {
  const tenantRes = validateTenantId(config.tenantId);
  if (!tenantRes.ok) return tenantRes;

  if (!config.reservationId || config.reservationId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Reservation ID cannot be empty");
  }
  return ok(tenantRes.value);
}

function routeItems(
  items: ReadonlyArray<ChargePostingItem>,
  config: SplitFolioConfig,
  acc: AccumulatorState,
  defaultTimestamp: string,
): Result<void, DomainError> {
  for (const item of items) {
    if (item.quantity <= 0 || item.unitBaseLkr < 0) {
      return domainErr(
        "VALIDATION_FAILED",
        "Charge item quantity must be positive and unit price non-negative",
        { item },
      );
    }

    const lineBase = roundLkr(item.quantity * item.unitBaseLkr);
    const intendedTarget =
      item.targetFolioOverride ?? determineDefaultTarget(item.category, config);

    if (intendedTarget === "MASTER_DMC" && Number.isFinite(acc.masterCap)) {
      processCappedMasterTarget(item, lineBase, acc, defaultTimestamp);
    } else {
      processDirectTarget(item, intendedTarget, lineBase, acc, defaultTimestamp);
    }
  }
  return ok(undefined);
}

function computeSubFolioTaxes(
  masterLines: RoutedFolioLine[],
  guestLines: RoutedFolioLine[],
  taxConfig: SriLankaTaxConfig,
): Result<
  {
    masterDmcTaxes: AggregatedFolioTaxes;
    guestPersonalTaxes: AggregatedFolioTaxes;
    grandTotalLkr: number;
  },
  DomainError
> {
  const masterFolioLines = masterLines.map(convertToFolioLineItem);
  const guestFolioLines = guestLines.map(convertToFolioLineItem);

  const masterTaxesRes = aggregateFolioTaxes(masterFolioLines, { taxConfig });
  if (!masterTaxesRes.ok) return masterTaxesRes;

  const guestTaxesRes = aggregateFolioTaxes(guestFolioLines, { taxConfig });
  if (!guestTaxesRes.ok) return guestTaxesRes;

  const grandTotalLkr = roundLkr(
    masterTaxesRes.value.grandTotalLkr + guestTaxesRes.value.grandTotalLkr,
  );

  return ok({
    masterDmcTaxes: masterTaxesRes.value,
    guestPersonalTaxes: guestTaxesRes.value,
    grandTotalLkr,
  });
}

/**
 * Routes charge items between Master DMC and Guest Personal sub-folios,
 * evaluating voucher inclusions, credit limits, and spillover rules.
 */
export function routeFolioCharges(
  items: ReadonlyArray<ChargePostingItem>,
  config: SplitFolioConfig,
  taxConfig: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
): Result<SplitFolioRoutingResult, DomainError> {
  const validTenant = validateRoutingInputs(config);
  if (!validTenant.ok) return validTenant;

  const masterCap =
    config.fixedMasterCapLkr ?? config.dmcCoverage?.creditLimitLkr ?? Number.POSITIVE_INFINITY;

  const acc: AccumulatorState = {
    currentMasterBase: 0,
    masterCap,
    masterLines: [],
    guestLines: [],
    reservationId: config.reservationId,
  };

  const routeRes = routeItems(items, config, acc, new Date().toISOString());
  if (!routeRes.ok) return routeRes;

  const taxRes = computeSubFolioTaxes(acc.masterLines, acc.guestLines, taxConfig);
  if (!taxRes.ok) return taxRes;

  const { masterDmcTaxes, guestPersonalTaxes, grandTotalLkr } = taxRes.value;

  return ok({
    tenantId: validTenant.value,
    reservationId: config.reservationId,
    billingType: config.billingType,
    masterDmcPartitionKey: createFolioPartitionKey(config.reservationId, "MASTER_DMC"),
    guestPersonalPartitionKey: createFolioPartitionKey(config.reservationId, "GUEST_PERSONAL"),
    masterDmcLines: acc.masterLines,
    guestPersonalLines: acc.guestLines,
    masterDmcTaxes,
    guestPersonalTaxes,
    totalMasterBaseLkr: masterDmcTaxes.totalBaseLkr,
    totalGuestBaseLkr: guestPersonalTaxes.totalBaseLkr,
    grandTotalLkr,
  });
}

/**
 * Transfers a posted folio charge between Master DMC and Guest Personal sub-folios
 * (e.g., when DMC authorizes an extra dinner or guest requests paying for a room night).
 * Creates an immutable cryptographic SHA-256 audit entry.
 */
export function transferFolioLine(
  params: FolioLineTransferRequest,
  currentLines: ReadonlyArray<RoutedFolioLine>,
): Result<
  {
    readonly updatedLines: ReadonlyArray<RoutedFolioLine>;
    readonly transferredLine: RoutedFolioLine;
    readonly auditEntry: AuditLogEntry;
  },
  DomainError
> {
  const tenantRes = validateTenantId(params.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }

  if (!params.reason || params.reason.trim().length < 5) {
    return domainErr(
      "VALIDATION_FAILED",
      "Transfer reason must be at least 5 characters for statutory audit compliance",
    );
  }

  if (params.fromTarget === params.toTarget) {
    return domainErr("VALIDATION_FAILED", "Source and destination folio targets must be distinct");
  }

  const lineIndex = currentLines.findIndex((l) => l.lineId === params.lineId);
  if (lineIndex === -1) {
    return domainErr("NOT_FOUND", `Folio line '${params.lineId}' was not found`);
  }

  const original = currentLines[lineIndex];
  if (!original) {
    return domainErr("NOT_FOUND", `Folio line '${params.lineId}' was not found`);
  }

  if (original.targetFolio !== params.fromTarget) {
    return domainErr(
      "VALIDATION_FAILED",
      `Line currently resides on '${original.targetFolio}', not '${params.fromTarget}'`,
    );
  }

  const updatedLine: RoutedFolioLine = {
    ...original,
    targetFolio: params.toTarget,
    folioPartitionKey: createFolioPartitionKey(params.reservationId, params.toTarget),
  };

  const updatedLines = [
    ...currentLines.slice(0, lineIndex),
    updatedLine,
    ...currentLines.slice(lineIndex + 1),
  ];

  // Append SHA-256 audit entry
  const auditRes = createAuditEntry({
    tenantId: tenantRes.value,
    actorUserId: params.staffUserId,
    action: "UPDATE",
    entityType: "FolioLineItem",
    entityId: params.lineId,
    isoTs: params.isoTs ?? new Date().toISOString(),
    afterJson: JSON.stringify({
      previousTargetFolio: original.targetFolio,
      previousPartitionKey: original.folioPartitionKey,
      newTargetFolio: updatedLine.targetFolio,
      newPartitionKey: updatedLine.folioPartitionKey,
      lineBaseLkr: original.lineBaseLkr,
      transferredBy: params.staffUserId,
      reason: params.reason,
    }),
    prevHash: params.prevAuditHash,
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    updatedLines,
    transferredLine: updatedLine,
    auditEntry: auditRes.value,
  });
}

/**
 * Validates staff RBAC authorization for split folio operations.
 */
export function authorizeSplitFolioAction(
  tenantId: string,
  role: string,
  actorTenantId: string,
  action: "VIEW" | "ROUTE" | "TRANSFER",
): boolean {
  if (tenantId !== actorTenantId) {
    return false;
  }

  const allowedRoles: Record<string, ReadonlyArray<string>> = {
    VIEW: [
      "SUPER_ADMIN",
      "HOTEL_OWNER",
      "GENERAL_MANAGER",
      "FRONT_DESK",
      "RESERVATIONIST",
      "ACCOUNTANT",
    ],
    ROUTE: ["SUPER_ADMIN", "HOTEL_OWNER", "GENERAL_MANAGER", "FRONT_DESK", "RESERVATIONIST"],
    TRANSFER: ["SUPER_ADMIN", "HOTEL_OWNER", "GENERAL_MANAGER", "FRONT_DESK"],
  };

  const permitted = allowedRoles[action] ?? [];
  return permitted.includes(role);
}
