/**
 * @hms/core - Multi-Tier Hospitality Rate & Stay Quote Calculator.
 *
 * Implements comprehensive multi-night rate quote generation:
 * - Dual-residency rate evaluation (Resident in LKR, Foreign in USD/EUR/GBP)
 * - Sri Lankan seasonal calendar band multipliers (Peak, Shoulder, Monsoon)
 * - 5 standard meal plans (RO, BB, HB, FB, AI)
 * - Age-stratified child policy (0-5 Infant free, 6-11 Junior 50% meals, 12+ Teen/Adult full)
 * - Extra bed & baby cot supplements
 * - Chauffeur / driver quarters accommodation & meal allowance
 * - IRD/SLTDA 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT)
 * - Both TAX_INCLUSIVE (reverse extraction) and TAX_EXCLUSIVE (forward compounding) pricing models
 * - Multi-currency conversion with locked exchange rates
 * - SHA-256 hash-chained immutable audit log generation
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

export type GuestResidencyTier = "RESIDENT" | "FOREIGN" | "RESIDENT_LKR" | "FOREIGN_USD_LOCKED";

export type MealPlanType = "RO" | "BB" | "HB" | "FB" | "AI";

export type SeasonalBandType = "PEAK" | "SHOULDER" | "MONSOON" | "STANDARD";

export type PricingModel = "TAX_INCLUSIVE" | "TAX_EXCLUSIVE";

export interface SeasonalBandRule {
  readonly id: string;
  readonly name: string;
  readonly bandType: SeasonalBandType;
  /** ISO date string or MM-DD recurring pattern (e.g. '12-15' or '2026-12-15') */
  readonly startDate: string;
  /** ISO date string or MM-DD recurring pattern (e.g. '01-15' or '2027-01-15') */
  readonly endDate: string;
  /** Multiplier applied to base room rate (e.g. 1.35 for peak, 0.85 for monsoon) */
  readonly multiplier: number;
}

export interface ChildGuest {
  readonly ageYears: number;
  readonly needsExtraBed?: boolean | undefined;
  readonly needsBabyCot?: boolean | undefined;
}

export interface DriverAccommodationOption {
  readonly required: boolean;
  readonly dormBedId?: string | undefined;
  readonly dailyRateLkr?: number | undefined;
  readonly dailyMealAllowanceLkr?: number | undefined;
}

export interface RateQuoteNightBreakdown {
  readonly date: string; // 'YYYY-MM-DD'
  readonly seasonName: string;
  readonly seasonalMultiplier: number;
  readonly baseRoomRateLkr: number;
  readonly mealPlanSupplementLkr: number;
  readonly childSupplementsLkr: number;
  readonly extraBedsLkr: number;
  readonly babyCotsLkr: number;
  readonly driverAllowanceLkr: number;
  readonly taxableBaseLkr: number;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly nightTotalLkr: number;
}

export interface RateQuoteInput {
  readonly tenantId: string;
  readonly checkInDate: string; // 'YYYY-MM-DD'
  readonly checkOutDate: string; // 'YYYY-MM-DD'
  readonly roomCategoryId: string;
  readonly residencyTier: GuestResidencyTier;
  readonly adultCount: number;
  readonly children?: readonly ChildGuest[] | undefined;
  readonly mealPlan: MealPlanType;
  readonly extraBedsCount?: number | undefined;
  readonly babyCotsCount?: number | undefined;
  readonly driverAccommodation?: DriverAccommodationOption | undefined;
  readonly pricingModel: PricingModel;
  readonly baseRateLkr: number;
  readonly baseRateUsd?: number | undefined;
  readonly exchangeRateUsdLkr?: number | undefined;
  readonly seasonalBands?: readonly SeasonalBandRule[] | undefined;
  readonly mealPlanSupplementsLkr?: Partial<Record<MealPlanType, number>> | undefined;
  readonly childMealDiscountPercent?: number | undefined; // default 50%
  readonly extraBedRateLkr?: number | undefined;
  readonly babyCotRateLkr?: number | undefined;
  readonly taxConfig?: Partial<SriLankaTaxConfig> | undefined;
  readonly quotedCurrency?: string | undefined; // default 'LKR'
  readonly targetExchangeRate?: number | undefined; // LKR per 1 unit of quotedCurrency
}

export interface RateQuoteResult {
  readonly tenantId: string;
  readonly roomCategoryId: string;
  readonly residencyTier: GuestResidencyTier;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly totalNights: number;
  readonly pricingModel: PricingModel;
  readonly nights: readonly RateQuoteNightBreakdown[];
  readonly totalBaseRoomLkr: number;
  readonly totalMealSupplementsLkr: number;
  readonly totalChildSupplementsLkr: number;
  readonly totalExtraBedsLkr: number;
  readonly totalBabyCotsLkr: number;
  readonly totalDriverAllowanceLkr: number;
  readonly totalTaxableSupplyLkr: number;
  readonly totalServiceChargeLkr: number;
  readonly totalTdlLkr: number;
  readonly totalSsclLkr: number;
  readonly totalVatLkr: number;
  readonly grandTotalLkr: number;
  readonly grandTotalQuotedCurrency: number;
  readonly quotedCurrency: string;
  readonly effectiveExchangeRate: number;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_MEAL_PLAN_SUPPLEMENTS_LKR: Record<MealPlanType, number> = {
  RO: 0,
  BB: 3500,
  HB: 8500,
  FB: 14000,
  AI: 22000,
};

export const DEFAULT_EXTRA_BED_RATE_LKR = 6000;
export const DEFAULT_BABY_COT_RATE_LKR = 1500;
export const DEFAULT_DRIVER_BED_RATE_LKR = 2500;
export const DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR = 1500;

export const DEFAULT_SRI_LANKAN_SEASONAL_BANDS: readonly SeasonalBandRule[] = [
  {
    id: "season-peak",
    name: "Peak Festive Season",
    bandType: "PEAK",
    startDate: "12-15",
    endDate: "01-15",
    multiplier: 1.35,
  },
  {
    id: "season-shoulder-summer",
    name: "Summer Shoulder Season",
    bandType: "SHOULDER",
    startDate: "07-01",
    endDate: "08-31",
    multiplier: 1.1,
  },
  {
    id: "season-monsoon",
    name: "South-West Monsoon",
    bandType: "MONSOON",
    startDate: "05-01",
    endDate: "06-30",
    multiplier: 0.85,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

export function isDateInSeasonalBand(
  dateMmDd: string,
  startMmDd: string,
  endMmDd: string,
): boolean {
  if (startMmDd <= endMmDd) {
    return dateMmDd >= startMmDd && dateMmDd <= endMmDd;
  }
  return dateMmDd >= startMmDd || dateMmDd <= endMmDd;
}

export function resolveSeasonForDate(
  dateIso: string,
  seasonalBands: readonly SeasonalBandRule[] = DEFAULT_SRI_LANKAN_SEASONAL_BANDS,
): { seasonName: string; multiplier: number } {
  const mmDd = dateIso.length >= 10 ? dateIso.slice(5, 10) : dateIso;

  for (const band of seasonalBands) {
    const startMmDd = band.startDate.length >= 10 ? band.startDate.slice(5, 10) : band.startDate;
    const endMmDd = band.endDate.length >= 10 ? band.endDate.slice(5, 10) : band.endDate;

    if (isDateInSeasonalBand(mmDd, startMmDd, endMmDd)) {
      return { seasonName: band.name, multiplier: band.multiplier };
    }
  }

  return { seasonName: "Standard Tariffs", multiplier: 1.0 };
}

export function generateStayNights(checkInDate: string, checkOutDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${checkInDate}T12:00:00Z`);
  const end = new Date(`${checkOutDate}T12:00:00Z`);

  while (current < end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export function evaluateSingleChild(
  child: ChildGuest,
  mealPlanRate: number,
  childDiscountPct: number,
  extraBedRate: number,
  babyCotRate: number,
): { meals: number; beds: number; cots: number } {
  if (child.ageYears < 6) {
    return {
      meals: 0,
      beds: 0,
      cots: child.needsBabyCot ? babyCotRate : 0,
    };
  }

  const extraBedCharge = child.needsExtraBed ? extraBedRate : 0;
  if (child.ageYears < 12) {
    const discountRatio = Math.max(0, 1 - childDiscountPct / 100);
    return {
      meals: roundLkr(mealPlanRate * discountRatio),
      beds: extraBedCharge,
      cots: 0,
    };
  }

  return {
    meals: mealPlanRate,
    beds: extraBedCharge,
    cots: 0,
  };
}

export function calculateChildNightSupplement(
  children: readonly ChildGuest[],
  mealPlanRate: number,
  childDiscountPct = 50,
  extraBedRate = DEFAULT_EXTRA_BED_RATE_LKR,
  babyCotRate = DEFAULT_BABY_COT_RATE_LKR,
): { childMealsLkr: number; childExtraBedsLkr: number; childBabyCotsLkr: number } {
  let childMealsLkr = 0;
  let childExtraBedsLkr = 0;
  let childBabyCotsLkr = 0;

  for (const child of children) {
    const res = evaluateSingleChild(
      child,
      mealPlanRate,
      childDiscountPct,
      extraBedRate,
      babyCotRate,
    );
    childMealsLkr += res.meals;
    childExtraBedsLkr += res.beds;
    childBabyCotsLkr += res.cots;
  }

  return { childMealsLkr, childExtraBedsLkr, childBabyCotsLkr };
}

export function resolveEffectiveBaseRoomRate(input: RateQuoteInput): number {
  const isForeign =
    input.residencyTier === "FOREIGN" || input.residencyTier === "FOREIGN_USD_LOCKED";

  if (
    isForeign &&
    typeof input.baseRateUsd === "number" &&
    input.baseRateUsd > 0 &&
    typeof input.exchangeRateUsdLkr === "number" &&
    input.exchangeRateUsdLkr > 0
  ) {
    return roundLkr(input.baseRateUsd * input.exchangeRateUsdLkr);
  }

  return input.baseRateLkr;
}

export function calculateDriverCost(driver?: DriverAccommodationOption): number {
  if (!driver?.required) {
    return 0;
  }
  const bed = driver.dailyRateLkr ?? DEFAULT_DRIVER_BED_RATE_LKR;
  const meal = driver.dailyMealAllowanceLkr ?? DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR;
  return roundLkr(bed + meal);
}

export function calculateNightTaxes(
  supplyLkr: number,
  model: PricingModel,
  config: SriLankaTaxConfig,
): Result<{ breakdown: TaxBreakdownResult; totalLkr: number }, DomainError> {
  if (model === "TAX_INCLUSIVE") {
    const res = calculateReverseTax(supplyLkr, config);
    if (!res.ok) {
      return res;
    }
    return ok({ breakdown: res.value, totalLkr: supplyLkr });
  }

  const res = calculateForwardTax(supplyLkr, config);
  if (!res.ok) {
    return res;
  }
  return ok({ breakdown: res.value, totalLkr: res.value.grandTotalLkr });
}

function validateInput(input: RateQuoteInput): Result<void, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }

  if (!input.checkInDate || !input.checkOutDate) {
    return domainErr("VALIDATION_FAILED", "Check-in and check-out dates are required");
  }

  const checkIn = new Date(`${input.checkInDate}T12:00:00Z`);
  const checkOut = new Date(`${input.checkOutDate}T12:00:00Z`);

  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return domainErr(
      "VALIDATION_FAILED",
      "Invalid check-in or check-out date format (expected YYYY-MM-DD)",
    );
  }

  if (checkIn >= checkOut) {
    return domainErr("VALIDATION_FAILED", "Check-out date must be strictly after check-in date");
  }

  if (typeof input.adultCount !== "number" || input.adultCount < 1) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least 1 adult guest is required for stay calculation",
    );
  }

  if (typeof input.baseRateLkr !== "number" || input.baseRateLkr < 0) {
    return domainErr("VALIDATION_FAILED", "Base room rate must be a non-negative number");
  }

  return ok(undefined);
}

// ============================================================================
// Night Processor & Aggregator Helpers
// ============================================================================

interface NightContext {
  readonly adultMealRate: number;
  readonly extraBedRate: number;
  readonly babyCotRate: number;
  readonly effectiveBaseRoomLkr: number;
  readonly nightDriverLkr: number;
  readonly seasonalBands?: readonly SeasonalBandRule[] | undefined;
  readonly adultCount: number;
  readonly children?: readonly ChildGuest[] | undefined;
  readonly childMealDiscountPercent?: number | undefined;
  readonly extraBedsCount?: number | undefined;
  readonly babyCotsCount?: number | undefined;
  readonly pricingModel: PricingModel;
  readonly fullTaxConfig: SriLankaTaxConfig;
}

export function processStayNight(
  nightDate: string,
  ctx: NightContext,
): Result<RateQuoteNightBreakdown, DomainError> {
  const season = resolveSeasonForDate(nightDate, ctx.seasonalBands);
  const nightBaseRoomLkr = roundLkr(ctx.effectiveBaseRoomLkr * season.multiplier);
  const nightAdultMealsLkr = roundLkr(ctx.adultMealRate * ctx.adultCount);

  const childCalc = calculateChildNightSupplement(
    ctx.children || [],
    ctx.adultMealRate,
    ctx.childMealDiscountPercent ?? 50,
    ctx.extraBedRate,
    ctx.babyCotRate,
  );

  const standaloneExtraBeds = roundLkr((ctx.extraBedsCount ?? 0) * ctx.extraBedRate);
  const standaloneBabyCots = roundLkr((ctx.babyCotsCount ?? 0) * ctx.babyCotRate);
  const nightExtraBedsLkr = roundLkr(standaloneExtraBeds + childCalc.childExtraBedsLkr);
  const nightBabyCotsLkr = roundLkr(standaloneBabyCots + childCalc.childBabyCotsLkr);

  const nightTaxableSupply = roundLkr(
    nightBaseRoomLkr +
      nightAdultMealsLkr +
      childCalc.childMealsLkr +
      nightExtraBedsLkr +
      nightBabyCotsLkr +
      ctx.nightDriverLkr,
  );

  const taxRes = calculateNightTaxes(nightTaxableSupply, ctx.pricingModel, ctx.fullTaxConfig);
  if (!taxRes.ok) {
    return taxRes;
  }

  return ok({
    date: nightDate,
    seasonName: season.seasonName,
    seasonalMultiplier: season.multiplier,
    baseRoomRateLkr: nightBaseRoomLkr,
    mealPlanSupplementLkr: nightAdultMealsLkr,
    childSupplementsLkr: childCalc.childMealsLkr,
    extraBedsLkr: nightExtraBedsLkr,
    babyCotsLkr: nightBabyCotsLkr,
    driverAllowanceLkr: ctx.nightDriverLkr,
    taxableBaseLkr: taxRes.value.breakdown.baseLkr,
    taxBreakdown: taxRes.value.breakdown,
    nightTotalLkr: taxRes.value.totalLkr,
  });
}

export function buildFinalRateQuoteResult(
  input: RateQuoteInput,
  nights: readonly RateQuoteNightBreakdown[],
): RateQuoteResult {
  let totalBaseRoomLkr = 0;
  let totalMealSupplementsLkr = 0;
  let totalChildSupplementsLkr = 0;
  let totalExtraBedsLkr = 0;
  let totalBabyCotsLkr = 0;
  let totalDriverAllowanceLkr = 0;

  for (const n of nights) {
    totalBaseRoomLkr = roundLkr(totalBaseRoomLkr + n.baseRoomRateLkr);
    totalMealSupplementsLkr = roundLkr(totalMealSupplementsLkr + n.mealPlanSupplementLkr);
    totalChildSupplementsLkr = roundLkr(totalChildSupplementsLkr + n.childSupplementsLkr);
    totalExtraBedsLkr = roundLkr(totalExtraBedsLkr + n.extraBedsLkr);
    totalBabyCotsLkr = roundLkr(totalBabyCotsLkr + n.babyCotsLkr);
    totalDriverAllowanceLkr = roundLkr(totalDriverAllowanceLkr + n.driverAllowanceLkr);
  }

  const totalTaxableSupplyLkr = roundLkr(nights.reduce((s, n) => s + n.taxBreakdown.baseLkr, 0));
  const totalServiceChargeLkr = roundLkr(nights.reduce((s, n) => s + n.taxBreakdown.scLkr, 0));
  const totalTdlLkr = roundLkr(nights.reduce((s, n) => s + n.taxBreakdown.tdlLkr, 0));
  const totalSsclLkr = roundLkr(nights.reduce((s, n) => s + n.taxBreakdown.ssclLkr, 0));
  const totalVatLkr = roundLkr(nights.reduce((s, n) => s + n.taxBreakdown.vatLkr, 0));
  const grandTotalLkr = roundLkr(nights.reduce((s, n) => s + n.nightTotalLkr, 0));

  const quotedCurrency = input.quotedCurrency || "LKR";
  const effectiveExchangeRate =
    quotedCurrency !== "LKR"
      ? (input.targetExchangeRate ?? input.exchangeRateUsdLkr ?? 305.0)
      : 1.0;

  const grandTotalQuotedCurrency =
    quotedCurrency !== "LKR" && effectiveExchangeRate > 0
      ? roundLkr(grandTotalLkr / effectiveExchangeRate)
      : grandTotalLkr;

  return {
    tenantId: input.tenantId,
    roomCategoryId: input.roomCategoryId,
    residencyTier: input.residencyTier,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
    totalNights: nights.length,
    pricingModel: input.pricingModel,
    nights,
    totalBaseRoomLkr,
    totalMealSupplementsLkr,
    totalChildSupplementsLkr,
    totalExtraBedsLkr,
    totalBabyCotsLkr,
    totalDriverAllowanceLkr,
    totalTaxableSupplyLkr,
    totalServiceChargeLkr,
    totalTdlLkr,
    totalSsclLkr,
    totalVatLkr,
    grandTotalLkr,
    grandTotalQuotedCurrency,
    quotedCurrency,
    effectiveExchangeRate,
  };
}

// ============================================================================
// Main Pure Calculator: calculateStayQuote
// ============================================================================

export function calculateStayQuote(input: RateQuoteInput): Result<RateQuoteResult, DomainError> {
  const validation = validateInput(input);
  if (!validation.ok) {
    return validation;
  }

  const nightDates = generateStayNights(input.checkInDate, input.checkOutDate);
  if (nightDates.length === 0) {
    return domainErr("VALIDATION_FAILED", "Stay duration must be at least 1 night");
  }

  const mealSupplements = {
    ...DEFAULT_MEAL_PLAN_SUPPLEMENTS_LKR,
    ...(input.mealPlanSupplementsLkr || {}),
  };

  const ctx: NightContext = {
    adultMealRate: mealSupplements[input.mealPlan] ?? 0,
    extraBedRate: input.extraBedRateLkr ?? DEFAULT_EXTRA_BED_RATE_LKR,
    babyCotRate: input.babyCotRateLkr ?? DEFAULT_BABY_COT_RATE_LKR,
    effectiveBaseRoomLkr: resolveEffectiveBaseRoomRate(input),
    nightDriverLkr: calculateDriverCost(input.driverAccommodation),
    seasonalBands: input.seasonalBands,
    adultCount: input.adultCount,
    children: input.children,
    childMealDiscountPercent: input.childMealDiscountPercent,
    extraBedsCount: input.extraBedsCount,
    babyCotsCount: input.babyCotsCount,
    pricingModel: input.pricingModel,
    fullTaxConfig: {
      ...DEFAULT_SRI_LANKA_TAX_CONFIG,
      ...(input.taxConfig || {}),
    },
  };

  const nights: RateQuoteNightBreakdown[] = [];
  for (const date of nightDates) {
    const nightRes = processStayNight(date, ctx);
    if (!nightRes.ok) {
      return nightRes;
    }
    nights.push(nightRes.value);
  }

  return ok(buildFinalRateQuoteResult(input, nights));
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry when a rate quote is computed.
 */
export function createRateQuoteAuditEntry(
  tenantId: string,
  actorUserId: string,
  quote: RateQuoteResult,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    roomCategoryId: quote.roomCategoryId,
    residencyTier: quote.residencyTier,
    checkInDate: quote.checkInDate,
    checkOutDate: quote.checkOutDate,
    totalNights: quote.totalNights,
    pricingModel: quote.pricingModel,
    grandTotalLkr: quote.grandTotalLkr,
    grandTotalQuotedCurrency: quote.grandTotalQuotedCurrency,
    quotedCurrency: quote.quotedCurrency,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "CALCULATE_RATE_QUOTE",
    entityType: "RateQuote",
    entityId: `${quote.roomCategoryId}:${quote.checkInDate}`,
    isoTs,
    afterJson,
    prevHash,
  });
}
