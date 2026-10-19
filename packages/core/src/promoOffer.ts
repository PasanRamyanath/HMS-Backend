/**
 * @hms/core - Sri Lankan Bank Credit Card & Promo Coupon Offer Engine.
 *
 * Implements seasonal and partner bank credit card promotion verification:
 * - Bank card BIN validation for major Sri Lankan banks (Sampath, Commercial Bank, HNB, NTB Amex)
 * - Promo code alphanumeric coupon matching
 * - Meal plan eligibility (mandating Half Board / Full Board for seasonal bank offers)
 * - Poya day, festival, and peak season blackout calendar enforcement
 * - Pre-tax base supply discount calculation complying with IRD tax regulations
 * - 4-stage compounding statutory taxes (SC 10% -> TDL 1% -> SSCL 2.5% -> VAT 18%)
 * - SHA-256 hash-chained immutable audit log creation for redemptions
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import type { MealPlanType } from "./rateQuote.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Contracts
// ============================================================================

export type SriLankanBank =
  | "SAMPATH_BANK"
  | "COMMERCIAL_BANK"
  | "HATTON_NATIONAL_BANK"
  | "NATIONS_TRUST_BANK"
  | "BANK_OF_CEYLON"
  | "PEOPLES_BANK"
  | "STANDARD_CHARTERED"
  | "HSBC_SRI_LANKA";

export type OfferType = "BANK_CARD_BIN" | "PROMO_COUPON_CODE";

export type DiscountBasis = "PERCENTAGE" | "FIXED_LKR";

export interface PromoOffer {
  readonly offerId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly offerType: OfferType;
  readonly bank?: SriLankanBank | undefined;
  readonly binPrefixes?: ReadonlyArray<string> | undefined;
  readonly promoCode?: string | undefined;
  readonly discountBasis: DiscountBasis;
  readonly discountValue: number;
  readonly maxDiscountCapLkr?: number | undefined;
  readonly validFrom: string; // YYYY-MM-DD
  readonly validUntil: string; // YYYY-MM-DD
  readonly blackoutDates?: ReadonlyArray<string> | undefined; // YYYY-MM-DD
  readonly eligibleMealPlans: ReadonlyArray<MealPlanType>;
  readonly minNights?: number | undefined;
  readonly minBookingAmountLkr?: number | undefined;
  readonly applicableRoomTypeIds?: ReadonlyArray<string> | undefined;
  readonly isActive: boolean;
  readonly maxRedemptions?: number | undefined;
  readonly currentRedemptions: number;
}

export interface PromoValidationInput {
  readonly tenantId: string;
  readonly offer: PromoOffer;
  readonly promoCode?: string | undefined;
  readonly cardBin?: string | undefined; // 6 or 8 digits
  readonly checkInDate: string; // YYYY-MM-DD
  readonly checkOutDate: string; // YYYY-MM-DD
  readonly nights: number;
  readonly mealPlan: MealPlanType;
  readonly roomTypeId: string;
  readonly baseAmountLkr: number;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
}

export interface PromoEvaluationResult {
  readonly offerId: string;
  readonly title: string;
  readonly bank?: SriLankanBank | undefined;
  readonly originalBaseLkr: number;
  readonly discountAmountLkr: number;
  readonly discountedBaseLkr: number;
  readonly effectiveDiscountPercentage: number;
  readonly originalTaxBreakdown: TaxBreakdownResult;
  readonly discountedTaxBreakdown: TaxBreakdownResult;
  readonly baseSavingsLkr: number;
  readonly grandTotalSavingsLkr: number;
}

export interface RedeemOfferInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly offer: PromoOffer;
  readonly bookingReference: string;
  readonly evaluation: PromoEvaluationResult;
  readonly prevAuditHash?: string | undefined;
}

export interface RedeemOfferOutput {
  readonly updatedOffer: PromoOffer;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Known Sri Lankan Bank BIN Ranges (First 6 Digits)
// ============================================================================

export const SRI_LANKAN_BANK_BINS: Readonly<Record<SriLankanBank, ReadonlyArray<string>>> = {
  SAMPATH_BANK: ["406175", "453267", "489504", "524278", "542156", "524388"],
  COMMERCIAL_BANK: ["401245", "409139", "490822", "521085", "540134", "528574"],
  HATTON_NATIONAL_BANK: ["415928", "426588", "450534", "518933", "539983", "524580"],
  NATIONS_TRUST_BANK: ["376910", "376911", "376912", "421456", "530022"],
  BANK_OF_CEYLON: ["409028", "421370", "456578", "527357"],
  PEOPLES_BANK: ["402133", "453211", "544922"],
  STANDARD_CHARTERED: ["402778", "492988", "548888"],
  HSBC_SRI_LANKA: ["401928", "450747", "541288", "510805"],
};

export function identifySriLankanBank(bin: string): SriLankanBank | null {
  const cleanBin = bin.trim().replace(/\D/g, "").slice(0, 6);
  if (cleanBin.length < 6) return null;

  for (const [bank, prefixes] of Object.entries(SRI_LANKAN_BANK_BINS)) {
    if (prefixes.some((p) => cleanBin.startsWith(p))) {
      return bank as SriLankanBank;
    }
  }
  return null;
}

// ============================================================================
// Internal Validation Steps (Cognitive Complexity <= 12)
// ============================================================================

function checkTenantIsolation(
  inputTenantId: string,
  offerTenantId: string,
): Result<void, DomainError> {
  const tenantRes = validateTenantId(inputTenantId);
  if (!tenantRes.ok) return tenantRes;
  if (inputTenantId !== offerTenantId) {
    return domainErr("TENANT_MISMATCH", "Promo offer does not belong to specified tenant", {
      inputTenantId,
      offerTenantId,
    });
  }
  return ok(undefined);
}

function checkOfferDatesAndStatus(
  offer: PromoOffer,
  checkInDate: string,
): Result<void, DomainError> {
  if (!offer.isActive) {
    return domainErr("PROMO_EXPIRED", "Promotion is currently inactive or suspended", {
      offerId: offer.offerId,
    });
  }

  if (offer.maxRedemptions !== undefined && offer.currentRedemptions >= offer.maxRedemptions) {
    return domainErr("PROMO_QUOTA_EXCEEDED", "Maximum promotion redemptions quota reached", {
      offerId: offer.offerId,
      maxRedemptions: offer.maxRedemptions,
      currentRedemptions: offer.currentRedemptions,
    });
  }

  if (checkInDate < offer.validFrom || checkInDate > offer.validUntil) {
    return domainErr(
      "PROMO_EXPIRED",
      "Stay check-in date falls outside promotion validity period",
      {
        offerId: offer.offerId,
        checkInDate,
        validFrom: offer.validFrom,
        validUntil: offer.validUntil,
      },
    );
  }

  if (offer.blackoutDates?.includes(checkInDate)) {
    return domainErr(
      "BLACKOUT_DATE_CONFLICT",
      "Stay check-in date coincides with an excluded peak/Poya blackout date",
      {
        offerId: offer.offerId,
        blackoutDate: checkInDate,
      },
    );
  }

  return ok(undefined);
}

function checkEligibilityRules(
  offer: PromoOffer,
  mealPlan: MealPlanType,
  nights: number,
  roomTypeId: string,
  baseAmountLkr: number,
): Result<void, DomainError> {
  // Meal plan restriction
  if (!offer.eligibleMealPlans.includes(mealPlan)) {
    return domainErr(
      "MEAL_PLAN_INELIGIBLE",
      `Meal plan ${mealPlan} is not eligible for this bank offer (requires ${offer.eligibleMealPlans.join(", ")})`,
      {
        mealPlan,
        eligibleMealPlans: offer.eligibleMealPlans,
      },
    );
  }

  // Minimum length of stay
  if (offer.minNights !== undefined && nights < offer.minNights) {
    return domainErr(
      "MIN_NIGHTS_NOT_MET",
      `Offer requires a minimum stay of ${offer.minNights} nights (selected: ${nights})`,
      {
        minNights: offer.minNights,
        nights,
      },
    );
  }

  // Minimum booking amount
  if (offer.minBookingAmountLkr !== undefined && baseAmountLkr < offer.minBookingAmountLkr) {
    return domainErr(
      "VALIDATION_FAILED",
      `Booking base amount LKR ${baseAmountLkr} does not meet the minimum threshold of LKR ${offer.minBookingAmountLkr}`,
      {
        baseAmountLkr,
        minBookingAmountLkr: offer.minBookingAmountLkr,
      },
    );
  }

  // Room type restriction
  if (
    offer.applicableRoomTypeIds &&
    offer.applicableRoomTypeIds.length > 0 &&
    !offer.applicableRoomTypeIds.includes(roomTypeId)
  ) {
    return domainErr("VALIDATION_FAILED", "Offer is not applicable for the selected room type", {
      roomTypeId,
      applicableRoomTypeIds: offer.applicableRoomTypeIds,
    });
  }

  return ok(undefined);
}

function checkPromoCodeMatch(offer: PromoOffer, promoCode?: string): Result<void, DomainError> {
  const code = promoCode?.trim().toUpperCase();
  if (!code || code !== offer.promoCode?.trim().toUpperCase()) {
    return domainErr("INVALID_PROMO_CODE", "Invalid or mismatched coupon promo code", {
      providedCode: promoCode,
      expectedCode: offer.promoCode,
    });
  }
  return ok(undefined);
}

function checkCardBinMatch(offer: PromoOffer, cardBin?: string): Result<void, DomainError> {
  const cleanBin = cardBin?.trim().replace(/\D/g, "").slice(0, 6);
  if (!cleanBin || cleanBin.length < 6) {
    return domainErr("INVALID_BIN", "Card BIN prefix must contain at least 6 numeric digits", {
      cardBin,
    });
  }

  if (offer.binPrefixes && offer.binPrefixes.length > 0) {
    const match = offer.binPrefixes.some((prefix) => cleanBin.startsWith(prefix));
    if (!match) {
      return domainErr(
        "INVALID_BIN",
        `Card BIN prefix (${cleanBin}) is not eligible for this bank offer`,
        {
          cardBin: cleanBin,
          eligiblePrefixes: offer.binPrefixes,
        },
      );
    }
  }
  return ok(undefined);
}

function checkCardOrPromoCodeMatch(
  offer: PromoOffer,
  promoCode?: string,
  cardBin?: string,
): Result<void, DomainError> {
  if (offer.offerType === "PROMO_COUPON_CODE") {
    return checkPromoCodeMatch(offer, promoCode);
  }
  if (offer.offerType === "BANK_CARD_BIN") {
    return checkCardBinMatch(offer, cardBin);
  }
  return ok(undefined);
}

// ============================================================================
// Discount Calculation (IRD Compliant Pre-Tax Base Supply)
// ============================================================================

export function computeDiscountAmounts(
  baseAmountLkr: number,
  discountBasis: DiscountBasis,
  discountValue: number,
  maxCapLkr?: number,
): { discountAmountLkr: number; discountedBaseLkr: number; effectivePercentage: number } {
  let discount = 0;

  if (discountBasis === "PERCENTAGE") {
    const fraction = Math.max(0, Math.min(100, discountValue)) / 100;
    discount = roundLkr(baseAmountLkr * fraction);
  } else {
    discount = roundLkr(Math.min(baseAmountLkr, Math.max(0, discountValue)));
  }

  if (maxCapLkr !== undefined && maxCapLkr > 0) {
    discount = Math.min(discount, maxCapLkr);
  }

  const discountedBaseLkr = roundLkr(Math.max(0, baseAmountLkr - discount));
  const effectivePercentage = baseAmountLkr > 0 ? roundLkr((discount / baseAmountLkr) * 100) : 0;

  return {
    discountAmountLkr: discount,
    discountedBaseLkr,
    effectivePercentage,
  };
}

// ============================================================================
// Public API: Promo Offer Evaluation & Redemption
// ============================================================================

/**
 * Evaluates whether a stay is eligible for a promo offer and computes the statutory tax savings.
 */
export function validatePromoOffer(
  input: PromoValidationInput,
): Result<PromoEvaluationResult, DomainError> {
  const tenantCheck = checkTenantIsolation(input.tenantId, input.offer.tenantId);
  if (!tenantCheck.ok) return tenantCheck;

  const dateCheck = checkOfferDatesAndStatus(input.offer, input.checkInDate);
  if (!dateCheck.ok) return dateCheck;

  const eligibilityCheck = checkEligibilityRules(
    input.offer,
    input.mealPlan,
    input.nights,
    input.roomTypeId,
    input.baseAmountLkr,
  );
  if (!eligibilityCheck.ok) return eligibilityCheck;

  const credentialCheck = checkCardOrPromoCodeMatch(input.offer, input.promoCode, input.cardBin);
  if (!credentialCheck.ok) return credentialCheck;

  // Compute Discount on Pre-Tax Base
  const { discountAmountLkr, discountedBaseLkr, effectivePercentage } = computeDiscountAmounts(
    input.baseAmountLkr,
    input.offer.discountBasis,
    input.offer.discountValue,
    input.offer.maxDiscountCapLkr,
  );

  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const originalTaxRes = calculateForwardTax(input.baseAmountLkr, taxConfig);
  if (!originalTaxRes.ok) return originalTaxRes;

  const discountedTaxRes = calculateForwardTax(discountedBaseLkr, taxConfig);
  if (!discountedTaxRes.ok) return discountedTaxRes;

  const originalTax = originalTaxRes.value;
  const discountedTax = discountedTaxRes.value;

  const grandTotalSavingsLkr = roundLkr(originalTax.grandTotalLkr - discountedTax.grandTotalLkr);

  return ok({
    offerId: input.offer.offerId,
    title: input.offer.title,
    bank: input.offer.bank,
    originalBaseLkr: input.baseAmountLkr,
    discountAmountLkr,
    discountedBaseLkr,
    effectiveDiscountPercentage: effectivePercentage,
    originalTaxBreakdown: originalTax,
    discountedTaxBreakdown: discountedTax,
    baseSavingsLkr: discountAmountLkr,
    grandTotalSavingsLkr,
  });
}

function validateOfferCreationRules(
  params: Omit<PromoOffer, "currentRedemptions">,
): Result<void, DomainError> {
  if (!params.title || params.title.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "Offer title cannot be empty");
  }

  if (params.discountValue <= 0) {
    return domainErr("VALIDATION_FAILED", "Discount value must be greater than zero");
  }

  if (params.discountBasis === "PERCENTAGE" && params.discountValue > 100) {
    return domainErr("VALIDATION_FAILED", "Percentage discount cannot exceed 100%");
  }

  if (params.validFrom > params.validUntil) {
    return domainErr("VALIDATION_FAILED", "validFrom date cannot be after validUntil date");
  }

  if (
    params.offerType === "PROMO_COUPON_CODE" &&
    (!params.promoCode || params.promoCode.trim().length === 0)
  ) {
    return domainErr("VALIDATION_FAILED", "Promo code is required for coupon offers");
  }

  if (
    params.offerType === "BANK_CARD_BIN" &&
    (!params.binPrefixes || params.binPrefixes.length === 0)
  ) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least one BIN prefix is required for bank card offers",
    );
  }

  return ok(undefined);
}

/**
 * Creates and registers a new promotional offer with strict validation.
 */
export function createPromoOffer(
  params: Omit<PromoOffer, "currentRedemptions">,
): Result<PromoOffer, DomainError> {
  const tenantCheck = validateTenantId(params.tenantId);
  if (!tenantCheck.ok) return tenantCheck;

  const rulesCheck = validateOfferCreationRules(params);
  if (!rulesCheck.ok) return rulesCheck;

  return ok({
    ...params,
    currentRedemptions: 0,
  });
}

/**
 * Records a redemption of a promotional offer, increments redemptions count,
 * and appends an immutable hash-chained audit log entry.
 */
export function redeemPromoOffer(input: RedeemOfferInput): Result<RedeemOfferOutput, DomainError> {
  const tenantCheck = checkTenantIsolation(input.tenantId, input.offer.tenantId);
  if (!tenantCheck.ok) return tenantCheck;

  if (
    input.offer.maxRedemptions !== undefined &&
    input.offer.currentRedemptions >= input.offer.maxRedemptions
  ) {
    return domainErr("PROMO_QUOTA_EXCEEDED", "Offer has reached maximum redemptions limit", {
      offerId: input.offer.offerId,
      maxRedemptions: input.offer.maxRedemptions,
    });
  }

  const updatedOffer: PromoOffer = {
    ...input.offer,
    currentRedemptions: input.offer.currentRedemptions + 1,
  };

  const auditPayload = {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "PROMO_OFFER_REDEEMED",
    entityType: "PROMO_OFFER",
    entityId: input.offer.offerId,
    isoTs: new Date().toISOString(),
    afterJson: JSON.stringify({
      offerId: input.offer.offerId,
      bookingReference: input.bookingReference,
      discountAmountLkr: input.evaluation.discountAmountLkr,
      grandTotalSavingsLkr: input.evaluation.grandTotalSavingsLkr,
      newRedemptionsCount: updatedOffer.currentRedemptions,
    }),
    prevHash: input.prevAuditHash,
  };

  const auditEntryRes = createAuditEntry(auditPayload);
  if (!auditEntryRes.ok) return auditEntryRes;

  return ok({
    updatedOffer,
    auditEntry: auditEntryRes.value,
  });
}
