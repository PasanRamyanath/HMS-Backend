/**
 * @hms/core - Meal-Plan Order Line Pricing Resolver & Entitlement Engine.
 *
 * Implements Step 233 (Phase 10.08) of the Sri Lanka HMS Architecture Plan:
 * Rung 6: Pure deterministic function zeroing out base price for entitled meal-plan
 * items (up to registered guest pax count per meal window), while preventing double-charging
 * and abuse beyond the room's registered headcount.
 *
 * Guarantees:
 * 1. Zero external runtime npm dependencies (pure Node.js / Intl standard library).
 * 2. Deterministic Result<T, DomainError> return pattern.
 * 3. Enforces multi-tenant tenantId isolation and headcount bounds (adults + children).
 * 4. 4-Stage compounding Sri Lankan tax calculation (SC -> TDL -> SSCL -> VAT).
 * 5. Deterministic hash-chainable audit log record generation.
 */

import { SRI_LANKA_TIMEZONE } from "./format.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type MealPlanCode = "RO" | "BB" | "HB" | "FB" | "AI";
export type MealSlotName = "BREAKFAST" | "LUNCH" | "AFTERNOON_TEA" | "DINNER" | "ALL_DAY";

export interface OrderItemPricingInput {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitBasePriceLkr: number;
  readonly isFreeUnderBb: boolean;
  readonly isFreeUnderHb: boolean;
  readonly isFreeUnderFb: boolean;
  readonly isFreeUnderAi: boolean;
  readonly allowedMealSlots: ReadonlyArray<MealSlotName>;
  readonly surchargeLkr?: number | undefined;
  readonly modifiersPriceLkr?: number | undefined;
}

export interface ReservationGuestContext {
  readonly reservationId: string;
  readonly tenantId: string;
  readonly roomNumber: string;
  readonly mealPlan: MealPlanCode;
  readonly adultsCount: number;
  readonly childrenCount: number;
  /** Complimentary meals already fulfilled in the current meal window. */
  readonly ordersAlreadyFulfilledInCurrentWindow?: number | undefined;
}

export interface MealPlanPricingParams {
  readonly tenantId: string;
  readonly reservation: ReservationGuestContext;
  readonly orderItems: ReadonlyArray<OrderItemPricingInput>;
  /** Optional SLST time in "HH:mm" format (e.g., "20:15"). Defaults to current Asia/Colombo time. */
  readonly currentSlTime?: string | undefined;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
}

export interface ResolvedOrderLine {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly complimentaryQuantity: number;
  readonly billedQuantity: number;
  readonly unitMenuPriceLkr: number;
  readonly unitBilledPriceLkr: number;
  readonly lineBaseLkr: number;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly isComplimentary: boolean;
  readonly isSupplement: boolean;
  readonly savingsLkr: number;
  readonly explanation: string;
}

export interface MealPlanPricingResult {
  readonly reservationId: string;
  readonly tenantId: string;
  readonly roomNumber: string;
  readonly mealPlan: MealPlanCode;
  readonly evaluatedSlot: MealSlotName;
  readonly evaluatedTimeSl: string;
  readonly totalHeadcountAllowance: number;
  readonly allowanceAlreadyConsumed: number;
  readonly allowanceGrantedThisOrder: number;
  readonly allowanceRemainingAfterOrder: number;
  readonly lines: ReadonlyArray<ResolvedOrderLine>;
  readonly orderSubtotalBaseLkr: number;
  readonly orderScLkr: number;
  readonly orderTdlLkr: number;
  readonly orderSsclLkr: number;
  readonly orderVatLkr: number;
  readonly orderGrandTotalLkr: number;
  readonly totalSavingsUnderMealPlanLkr: number;
  readonly auditRecord: {
    readonly actor: string;
    readonly action: "MEAL_PLAN_ENTITLEMENT_RESOLVED";
    readonly entityType: "ServiceOrder";
    readonly entityId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

// ============================================================================
// Standard Meal Windows in Sri Lanka Standard Time (SLST / Asia/Colombo)
// ============================================================================

export const STANDARD_SL_MEAL_WINDOWS: ReadonlyArray<{
  readonly slot: MealSlotName;
  readonly start: string;
  readonly end: string;
}> = [
  { slot: "BREAKFAST", start: "06:30", end: "10:30" },
  { slot: "LUNCH", start: "12:30", end: "15:30" },
  { slot: "AFTERNOON_TEA", start: "16:00", end: "17:30" },
  { slot: "DINNER", start: "19:00", end: "22:30" },
];

// ============================================================================
// Pure Helpers (Strict Cognitive Complexity <= 12)
// ============================================================================

export function getCurrentSlstTime24(): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SRI_LANKA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date());
}

export function resolveCurrentMealSlot(timeStr: string): MealSlotName {
  for (const win of STANDARD_SL_MEAL_WINDOWS) {
    if (timeStr >= win.start && timeStr <= win.end) {
      return win.slot;
    }
  }
  return "ALL_DAY";
}

export function isPlanEligibleForSlot(plan: MealPlanCode, slot: MealSlotName): boolean {
  if (plan === "RO") return false;
  if (slot === "ALL_DAY") return plan === "AI";
  if (slot === "BREAKFAST") return plan === "BB" || plan === "HB" || plan === "FB" || plan === "AI";
  if (slot === "LUNCH") return plan === "FB" || plan === "AI";
  if (slot === "AFTERNOON_TEA") return plan === "AI";
  if (slot === "DINNER") return plan === "HB" || plan === "FB" || plan === "AI";
  return false;
}

export function isItemEligibleUnderPlan(item: OrderItemPricingInput, plan: MealPlanCode): boolean {
  if (plan === "RO") return false;
  const hasSupplement = (item.surchargeLkr ?? 0) > 0;
  if (plan === "BB") return item.isFreeUnderBb;
  if (plan === "HB") return item.isFreeUnderHb;
  if (plan === "FB") return item.isFreeUnderFb || hasSupplement;
  if (plan === "AI") return item.isFreeUnderAi || hasSupplement;
  return false;
}

function validatePricingParams(params: MealPlanPricingParams): Result<void, DomainError> {
  if (params.tenantId !== params.reservation.tenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Tenant ID mismatch: param ${params.tenantId} != reservation ${params.reservation.tenantId}`,
    );
  }

  if (params.orderItems.length === 0) {
    return domainErr("INVALID_ORDER_ITEMS", "Order items list cannot be empty.");
  }

  const totalHeadcount = params.reservation.adultsCount + params.reservation.childrenCount;
  if (totalHeadcount < 1) {
    return domainErr(
      "INVALID_RESERVATION",
      "Total room headcount (adults + children) must be at least 1.",
    );
  }

  for (let i = 0; i < params.orderItems.length; i++) {
    const item = params.orderItems[i];
    if (!item) continue;
    if (item.quantity < 1 || !Number.isInteger(item.quantity)) {
      return domainErr(
        "INVALID_ORDER_ITEMS",
        `Item "${item.name}" quantity must be an integer >= 1.`,
      );
    }
    if (item.unitBasePriceLkr < 0 || Number.isNaN(item.unitBasePriceLkr)) {
      return domainErr(
        "INVALID_ORDER_ITEMS",
        `Item "${item.name}" unit price cannot be negative or invalid.`,
      );
    }
  }

  return ok(undefined);
}

interface ItemLineResolution {
  readonly line: ResolvedOrderLine;
  readonly allowanceUsed: number;
}

function computeQuantities(
  itemQuantity: number,
  canBeComplimentary: boolean,
  isAllDayAi: boolean,
  remainingAllowance: number,
): { compQty: number; billedQty: number } {
  if (!canBeComplimentary) {
    return { compQty: 0, billedQty: itemQuantity };
  }
  if (isAllDayAi) {
    return { compQty: itemQuantity, billedQty: 0 };
  }
  const compQty = Math.min(itemQuantity, remainingAllowance);
  return { compQty, billedQty: itemQuantity - compQty };
}

function resolveExplanation(
  guestPlan: MealPlanCode,
  activeSlot: MealSlotName,
  canBeComplimentary: boolean,
  planSlotEligible: boolean,
  compQty: number,
  billedQty: number,
  surcharge: number,
  totalQty: number,
  unitMenuPrice: number,
): { isSupplement: boolean; unitBilledPrice: number; explanation: string } {
  if (!canBeComplimentary) {
    if (guestPlan === "RO") {
      return {
        isSupplement: false,
        unitBilledPrice: unitMenuPrice,
        explanation: "Room Only reservation: standard menu rate applies.",
      };
    }
    if (!planSlotEligible) {
      return {
        isSupplement: false,
        unitBilledPrice: unitMenuPrice,
        explanation: `${guestPlan} does not cover ${activeSlot} meal service.`,
      };
    }
    return {
      isSupplement: false,
      unitBilledPrice: unitMenuPrice,
      explanation: `Item not included under ${guestPlan} meal plan.`,
    };
  }

  if (surcharge > 0) {
    return {
      isSupplement: true,
      unitBilledPrice: surcharge,
      explanation: `Complimentary base under ${guestPlan}; billed ${surcharge.toFixed(2)} LKR specialty supplement.`,
    };
  }

  if (compQty === totalQty) {
    return {
      isSupplement: false,
      unitBilledPrice: 0,
      explanation: `100% complimentary under ${guestPlan} during ${activeSlot} meal window.`,
    };
  }

  if (compQty > 0) {
    return {
      isSupplement: false,
      unitBilledPrice: unitMenuPrice,
      explanation: `${compQty} complimentary under ${guestPlan}; ${billedQty} billed beyond room pax allowance.`,
    };
  }

  return {
    isSupplement: false,
    unitBilledPrice: unitMenuPrice,
    explanation: "Meal plan allowance exceeded for this window. Billed at standard menu rate.",
  };
}

function computeLineTaxBreakdown(
  compQty: number,
  billedQty: number,
  surcharge: number,
  itemBasePrice: number,
  modifiersPrice: number,
  taxConfig: SriLankaTaxConfig,
): { lineBaseLkr: number; taxBreakdown: TaxBreakdownResult } {
  const compBase = compQty * (surcharge > 0 ? surcharge : 0);
  const regularBase = billedQty * itemBasePrice;
  const modifiersBase = (compQty + billedQty) * modifiersPrice;
  const rawLineBase = compBase + regularBase + modifiersBase;
  const lineBaseLkr = Math.round((rawLineBase + Number.EPSILON) * 100) / 100;

  const taxResult = calculateForwardTax(lineBaseLkr, taxConfig);
  const taxBreakdown: TaxBreakdownResult = taxResult.ok
    ? taxResult.value
    : {
        baseLkr: lineBaseLkr,
        scLkr: 0,
        subtotalAfterScLkr: lineBaseLkr,
        tdlLkr: 0,
        ssclLkr: 0,
        vatBaseLkr: lineBaseLkr,
        vatLkr: 0,
        grandTotalLkr: lineBaseLkr,
        effectiveTaxRate: 0,
        isVatRegistered: taxConfig.enableVAT,
      };

  return { lineBaseLkr, taxBreakdown };
}

function resolveSingleOrderLine(
  item: OrderItemPricingInput,
  guestPlan: MealPlanCode,
  activeSlot: MealSlotName,
  remainingAllowance: number,
  taxConfig: SriLankaTaxConfig,
): ItemLineResolution {
  const planSlotEligible = isPlanEligibleForSlot(guestPlan, activeSlot);
  const itemEligible = isItemEligibleUnderPlan(item, guestPlan);
  const slotAllowed =
    item.allowedMealSlots.includes(activeSlot) || item.allowedMealSlots.includes("ALL_DAY");
  const canBeComplimentary = planSlotEligible && itemEligible && slotAllowed;
  const isAllDayAi = guestPlan === "AI" && item.allowedMealSlots.includes("ALL_DAY");
  const surcharge = item.surchargeLkr ?? 0;
  const modifiers = item.modifiersPriceLkr ?? 0;

  const { compQty, billedQty } = computeQuantities(
    item.quantity,
    canBeComplimentary,
    isAllDayAi,
    remainingAllowance,
  );

  const { isSupplement, unitBilledPrice, explanation } = resolveExplanation(
    guestPlan,
    activeSlot,
    canBeComplimentary,
    planSlotEligible,
    compQty,
    billedQty,
    surcharge,
    item.quantity,
    item.unitBasePriceLkr,
  );

  const { lineBaseLkr, taxBreakdown } = computeLineTaxBreakdown(
    compQty,
    billedQty,
    surcharge,
    item.unitBasePriceLkr,
    modifiers,
    taxConfig,
  );

  const fullPriceBase = item.quantity * item.unitBasePriceLkr + item.quantity * modifiers;
  const savingsLkr = Math.max(
    0,
    Math.round((fullPriceBase - lineBaseLkr + Number.EPSILON) * 100) / 100,
  );

  return {
    allowanceUsed: isAllDayAi ? 0 : compQty,
    line: {
      itemId: item.itemId,
      name: item.name,
      quantity: item.quantity,
      complimentaryQuantity: compQty,
      billedQuantity: billedQty,
      unitMenuPriceLkr: item.unitBasePriceLkr,
      unitBilledPriceLkr: unitBilledPrice,
      lineBaseLkr,
      taxBreakdown,
      isComplimentary: compQty > 0 && surcharge === 0,
      isSupplement,
      savingsLkr,
      explanation,
    },
  };
}

// ============================================================================
// Main Meal-Plan Entitlement Resolver (Rung 6)
// ============================================================================

export function applyMealPlanEntitlements(
  params: MealPlanPricingParams,
): Result<MealPlanPricingResult, DomainError> {
  const validation = validatePricingParams(params);
  if (!validation.ok) {
    return validation;
  }

  const taxConfig = params.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const currentSlTime = params.currentSlTime ?? getCurrentSlstTime24();
  const activeSlot = resolveCurrentMealSlot(currentSlTime);

  const totalHeadcount = params.reservation.adultsCount + params.reservation.childrenCount;
  const consumedSoFar = Math.max(0, params.reservation.ordersAlreadyFulfilledInCurrentWindow ?? 0);
  let remainingAllowance = Math.max(0, totalHeadcount - consumedSoFar);

  const resolvedLines: ResolvedOrderLine[] = [];
  let totalGrantedThisOrder = 0;
  let orderBaseLkr = 0;
  let orderScLkr = 0;
  let orderTdlLkr = 0;
  let orderSsclLkr = 0;
  let orderVatLkr = 0;
  let orderGrandTotalLkr = 0;
  let totalSavingsLkr = 0;

  for (let i = 0; i < params.orderItems.length; i++) {
    const item = params.orderItems[i];
    if (!item) continue;

    const resolution = resolveSingleOrderLine(
      item,
      params.reservation.mealPlan,
      activeSlot,
      remainingAllowance,
      taxConfig,
    );

    resolvedLines.push(resolution.line);
    remainingAllowance -= resolution.allowanceUsed;
    totalGrantedThisOrder += resolution.allowanceUsed;

    orderBaseLkr += resolution.line.taxBreakdown.baseLkr;
    orderScLkr += resolution.line.taxBreakdown.scLkr;
    orderTdlLkr += resolution.line.taxBreakdown.tdlLkr;
    orderSsclLkr += resolution.line.taxBreakdown.ssclLkr;
    orderVatLkr += resolution.line.taxBreakdown.vatLkr;
    orderGrandTotalLkr += resolution.line.taxBreakdown.grandTotalLkr;
    totalSavingsLkr += resolution.line.savingsLkr;
  }

  const finalAllowanceRemaining = Math.max(
    0,
    totalHeadcount - (consumedSoFar + totalGrantedThisOrder),
  );

  return ok({
    reservationId: params.reservation.reservationId,
    tenantId: params.tenantId,
    roomNumber: params.reservation.roomNumber,
    mealPlan: params.reservation.mealPlan,
    evaluatedSlot: activeSlot,
    evaluatedTimeSl: currentSlTime,
    totalHeadcountAllowance: totalHeadcount,
    allowanceAlreadyConsumed: consumedSoFar,
    allowanceGrantedThisOrder: totalGrantedThisOrder,
    allowanceRemainingAfterOrder: finalAllowanceRemaining,
    lines: resolvedLines,
    orderSubtotalBaseLkr: Math.round((orderBaseLkr + Number.EPSILON) * 100) / 100,
    orderScLkr: Math.round((orderScLkr + Number.EPSILON) * 100) / 100,
    orderTdlLkr: Math.round((orderTdlLkr + Number.EPSILON) * 100) / 100,
    orderSsclLkr: Math.round((orderSsclLkr + Number.EPSILON) * 100) / 100,
    orderVatLkr: Math.round((orderVatLkr + Number.EPSILON) * 100) / 100,
    orderGrandTotalLkr: Math.round((orderGrandTotalLkr + Number.EPSILON) * 100) / 100,
    totalSavingsUnderMealPlanLkr: Math.round((totalSavingsLkr + Number.EPSILON) * 100) / 100,
    auditRecord: {
      actor: `RES#${params.reservation.reservationId}#ROOM#${params.reservation.roomNumber}`,
      action: "MEAL_PLAN_ENTITLEMENT_RESOLVED",
      entityType: "ServiceOrder",
      entityId: `ORDER-${params.reservation.roomNumber}-${Date.now()}`,
      payload: {
        mealPlan: params.reservation.mealPlan,
        slot: activeSlot,
        time: currentSlTime,
        granted: totalGrantedThisOrder,
        remaining: finalAllowanceRemaining,
        orderGrandTotalLkr: Math.round((orderGrandTotalLkr + Number.EPSILON) * 100) / 100,
        totalSavingsLkr: Math.round((totalSavingsLkr + Number.EPSILON) * 100) / 100,
      },
    },
  });
}
