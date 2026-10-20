/**
 * @hms/core - Excursion Vendor Commission & Net Payout Calculator (excursionSplit.ts)
 *
 * Implements Step 357 (Phase 15.07) / Rung 6 of the Sri Lanka HMS Master Architecture Plan:
 * Legally compliant agency pass-through vs. principal hotel accounting for Sri Lankan excursions.
 *
 * Prevents hotels from illegally overpaying ~34.34% compounding hospitality taxes
 * (10% SC -> 1% TDL -> 2.5% SSCL -> 18% VAT) on third-party disbursements such as
 * Department of Wildlife Conservation (DWC) Yala/Wilpattu park permits, boat charters,
 * and independent safari jeep fleets.
 *
 * Complies with:
 * - Inland Revenue Department (IRD) Value Added Tax Act No. 14 of 2002 (Disbursements/Agency rules)
 * - Tourism Act No. 38 of 2005 (TDL 1% on hotel gross turnover)
 * - Social Security Contribution Levy (SSCL) Act No. 25 of 2022
 * - Shop & Office Employees Act (10% Service Charge restricted to hotel direct supplies)
 *
 * Multi-Tenant Contract:
 * - Validates tenant boundary isolation
 * - Role-Based Access Control (RBAC)
 * - Zero external dependencies (uses native node:crypto for SHA-256 audit chaining)
 * - Returns deterministic Result<T, DomainError>
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
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

export type ExcursionCategory =
  | "WILDLIFE_SAFARI"
  | "WHALE_WATCHING"
  | "TEA_ESTATE_TRAIL"
  | "GEM_MINE_EXPEDITION"
  | "CULTURAL_HERITAGE"
  | "RIVER_BOAT_SAFARI"
  | "WATER_SPORTS"
  | "AIRPORT_EXCURSION";

export type PassThroughType =
  | "GOVERNMENT_WILDLIFE_PERMIT"
  | "SLTDA_HERITAGE_TICKET"
  | "THIRD_PARTY_VEHICLE_HIRE"
  | "THIRD_PARTY_BOAT_HIRE"
  | "INDEPENDENT_GUIDE_FEE";

export interface ExcursionActor {
  readonly userId: string;
  readonly role: string;
  readonly tenantId: string;
}

export const EXCURSION_AUTHORIZED_ROLES: readonly string[] = [
  "SUPER_ADMIN",
  "HOTEL_ADMIN",
  "GENERAL_MANAGER",
  "DUTY_MANAGER",
  "FRONT_DESK",
  "CONCIERGE",
  "EXCURSION_OFFICER",
  "RESERVATION_AGENT",
];

export interface PassThroughCostItem {
  readonly type: PassThroughType;
  readonly description: string;
  readonly amountLkr: number;
  readonly recipientVendorName: string;
  readonly recipientVendorVatNumber?: string | undefined;
}

export interface ExcursionSplitInput {
  readonly tenantId: string;
  readonly actor: ExcursionActor;
  readonly bookingId: string;
  readonly reservationId: string;
  readonly roomNumber: string;
  readonly guestName: string;
  readonly category: ExcursionCategory;
  readonly description: string;
  readonly passThroughItems: readonly PassThroughCostItem[];
  readonly hotelMarkupLkr: number;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
  readonly previousAuditHash?: string | undefined;
}

export interface VendorPayableSummary {
  readonly vendorName: string;
  readonly passThroughType: PassThroughType;
  readonly totalPayableLkr: number;
  readonly isVatRegistered: boolean;
}

export interface ExcursionFolioLineItem {
  readonly lineId: string;
  readonly description: string;
  readonly category: "PASS_THROUGH_DISBURSEMENT" | "HOTEL_TOUR_COMMISSION";
  readonly amountLkr: number;
  readonly isServiceChargeExempt: boolean;
  readonly isTaxable: boolean;
}

export interface ExcursionSplitResult {
  readonly bookingId: string;
  readonly tenantId: string;
  readonly totalPassThroughLkr: number;
  readonly hotelTaxableBaseLkr: number;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly totalHotelBillLkr: number;
  readonly grandTotalGuestPayableLkr: number;
  readonly netVendorPayables: readonly VendorPayableSummary[];
  readonly unbundledTaxSavingsLkr: number;
  readonly folioLineItems: readonly ExcursionFolioLineItem[];
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Authorization & Validation
// ============================================================================

export function isAuthorizedExcursionRole(role: string): boolean {
  return EXCURSION_AUTHORIZED_ROLES.includes(role.toUpperCase());
}

export function validatePassThroughCostItem(item: PassThroughCostItem): Result<true, DomainError> {
  if (item.amountLkr < 0 || Number.isNaN(item.amountLkr)) {
    return domainErr(
      "INVALID_TAX_BASE",
      `Pass-through item '${item.description}' amount cannot be negative.`,
    );
  }
  if (!item.recipientVendorName || item.recipientVendorName.trim().length === 0) {
    return domainErr(
      "VALIDATION_FAILED",
      `Pass-through item '${item.description}' requires a recipient vendor name.`,
    );
  }
  return ok(true);
}

export function validateActor(actor: ExcursionActor, tenantId: string): Result<true, DomainError> {
  if (actor.tenantId !== tenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant ${actor.tenantId} does not match request tenant ${tenantId}.`,
    );
  }

  if (!isAuthorizedExcursionRole(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role ${actor.role} is not authorized for excursion financial splits.`,
    );
  }

  return ok(true);
}

export function validateExcursionSplitInput(input: ExcursionSplitInput): Result<true, DomainError> {
  if (!input.tenantId || input.tenantId.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "Tenant ID is required.");
  }

  const actorValid = validateActor(input.actor, input.tenantId);
  if (!actorValid.ok) return actorValid;

  if (!input.bookingId || input.bookingId.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "Booking ID is required.");
  }

  if (!input.roomNumber || input.roomNumber.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "Room number is required.");
  }

  if (input.hotelMarkupLkr < 0 || Number.isNaN(input.hotelMarkupLkr)) {
    return domainErr("INVALID_TAX_BASE", "Hotel markup cannot be negative or NaN.");
  }

  for (const item of input.passThroughItems) {
    const itemValid = validatePassThroughCostItem(item);
    if (!itemValid.ok) return itemValid;
  }

  return ok(true);
}

// ============================================================================
// Core Domain Logic: Split & Net Payout Calculation
// ============================================================================

export function aggregateVendorPayables(
  items: readonly PassThroughCostItem[],
): readonly VendorPayableSummary[] {
  const map = new Map<string, { total: number; type: PassThroughType; vatReg: boolean }>();

  for (const item of items) {
    const safeAmount = roundLkr(item.amountLkr);
    const existing = map.get(item.recipientVendorName);
    const isVat = Boolean(
      item.recipientVendorVatNumber && item.recipientVendorVatNumber.trim().length > 0,
    );

    if (existing) {
      existing.total = roundLkr(existing.total + safeAmount);
    } else {
      map.set(item.recipientVendorName, {
        total: safeAmount,
        type: item.type,
        vatReg: isVat,
      });
    }
  }

  const results: VendorPayableSummary[] = [];
  for (const [vendorName, data] of map.entries()) {
    results.push({
      vendorName,
      passThroughType: data.type,
      totalPayableLkr: data.total,
      isVatRegistered: data.vatReg,
    });
  }

  return results;
}

export function buildFolioLineItems(
  bookingId: string,
  passThroughItems: readonly PassThroughCostItem[],
  hotelMarkupLkr: number,
  category: ExcursionCategory,
): readonly ExcursionFolioLineItem[] {
  const lines: ExcursionFolioLineItem[] = [];

  // Pass-through disbursements (SC-exempt, 0% tax loading)
  for (let idx = 0; idx < passThroughItems.length; idx += 1) {
    const item = passThroughItems[idx];
    if (item && item.amountLkr > 0) {
      lines.push({
        lineId: `${bookingId}-DISB-${idx + 1}`,
        description: `Excursion Pass-Through: ${item.description} (${item.recipientVendorName})`,
        category: "PASS_THROUGH_DISBURSEMENT",
        amountLkr: roundLkr(item.amountLkr),
        isServiceChargeExempt: true,
        isTaxable: false,
      });
    }
  }

  // Hotel Taxable Commission / Markup line
  if (hotelMarkupLkr > 0) {
    lines.push({
      lineId: `${bookingId}-COMM-1`,
      description: `Excursion Handling & Facilitation: ${category.replace(/_/g, " ")}`,
      category: "HOTEL_TOUR_COMMISSION",
      amountLkr: roundLkr(hotelMarkupLkr),
      isServiceChargeExempt: false,
      isTaxable: true,
    });
  }

  return lines;
}

export function computeExcursionFinancialSplit(
  input: ExcursionSplitInput,
): Result<ExcursionSplitResult, DomainError> {
  const validation = validateExcursionSplitInput(input);
  if (!validation.ok) {
    return domainErr(validation.error.code, validation.error.message);
  }

  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;

  // 1. Calculate Total Pass-Through Disbursements
  let totalPassThrough = 0;
  for (const item of input.passThroughItems) {
    totalPassThrough = roundLkr(totalPassThrough + item.amountLkr);
  }

  const safeHotelMarkup = roundLkr(input.hotelMarkupLkr);

  // 2. Compute 4-Stage Compounding Taxes on Hotel Markup ONLY
  const markupTaxResult = calculateForwardTax(safeHotelMarkup, taxConfig);
  if (!markupTaxResult.ok) {
    return domainErr(markupTaxResult.error.code, markupTaxResult.error.message);
  }
  const taxBreakdown = markupTaxResult.value;

  // 3. Compute Hypothetical "Bundled" Tax (if whole price was taxed blindly)
  // This calculates the statutory tax savings achieved by proper split accounting
  const combinedGross = roundLkr(totalPassThrough + safeHotelMarkup);
  const bundledTaxResult = calculateForwardTax(combinedGross, taxConfig);
  const bundledTotalTax = bundledTaxResult.ok
    ? roundLkr(bundledTaxResult.value.grandTotalLkr - combinedGross)
    : 0;

  const actualHotelTax = roundLkr(taxBreakdown.grandTotalLkr - safeHotelMarkup);
  const unbundledTaxSavings = roundLkr(Math.max(0, bundledTotalTax - actualHotelTax));

  // 4. Financial Totals
  const totalHotelBill = taxBreakdown.grandTotalLkr;
  const grandTotalGuestPayable = roundLkr(totalHotelBill + totalPassThrough);

  // 5. Vendor Payables and Folio Lines
  const netVendorPayables = aggregateVendorPayables(input.passThroughItems);
  const folioLineItems = buildFolioLineItems(
    input.bookingId,
    input.passThroughItems,
    safeHotelMarkup,
    input.category,
  );

  // 6. Generate SHA-256 Hash-Chained Audit Log Record
  const auditResult = createAuditEntry({
    tenantId: input.tenantId,
    actorUserId: input.actor.userId,
    action: "EXCURSION_SPLIT_POSTED",
    entityType: "ExcursionBooking",
    entityId: input.bookingId,
    isoTs: new Date().toISOString(),
    afterJson: JSON.stringify({
      reservationId: input.reservationId,
      roomNumber: input.roomNumber,
      guestName: input.guestName,
      category: input.category,
      totalPassThroughLkr: totalPassThrough,
      hotelTaxableBaseLkr: safeHotelMarkup,
      totalHotelTaxesLkr: actualHotelTax,
      grandTotalGuestPayableLkr: grandTotalGuestPayable,
      taxSavingsLkr: unbundledTaxSavings,
      vendorsCount: netVendorPayables.length,
    }),
    prevHash: input.previousAuditHash,
  });

  if (!auditResult.ok) {
    return domainErr(auditResult.error.code, auditResult.error.message);
  }

  return ok({
    bookingId: input.bookingId,
    tenantId: input.tenantId,
    totalPassThroughLkr: totalPassThrough,
    hotelTaxableBaseLkr: safeHotelMarkup,
    taxBreakdown,
    totalHotelBillLkr: totalHotelBill,
    grandTotalGuestPayableLkr: grandTotalGuestPayable,
    netVendorPayables,
    unbundledTaxSavingsLkr: unbundledTaxSavings,
    folioLineItems,
    auditEntry: auditResult.value,
  });
}
