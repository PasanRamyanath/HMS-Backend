import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BABY_COT_RATE_LKR,
  DEFAULT_DRIVER_BED_RATE_LKR,
  DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR,
  DEFAULT_EXTRA_BED_RATE_LKR,
  DEFAULT_MEAL_PLAN_SUPPLEMENTS_LKR,
  DEFAULT_SRI_LANKAN_SEASONAL_BANDS,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type RateQuoteInput,
  calculateChildNightSupplement,
  calculateDriverCost,
  calculateNightTaxes,
  calculateStayQuote,
  createRateQuoteAuditEntry,
  evaluateSingleChild,
  generateStayNights,
  isDateInSeasonalBand,
  resolveEffectiveBaseRoomRate,
  resolveSeasonForDate,
} from "../src/index.js";

describe("Rate Calculator Pure Helper (rateQuote.ts)", () => {
  const validTenantId = "tenant-amaya-resort";

  describe("Helper Functions & Defaults", () => {
    it("evaluates single child correctly for infant, junior, and teen", () => {
      const infant = evaluateSingleChild({ ageYears: 2, needsBabyCot: true }, 8500, 50, 6000, 1500);
      assert.strictEqual(infant.meals, 0);
      assert.strictEqual(infant.cots, 1500);
      assert.strictEqual(infant.beds, 0);

      const junior = evaluateSingleChild(
        { ageYears: 7, needsExtraBed: true },
        8500,
        50,
        6000,
        1500,
      );
      assert.strictEqual(junior.meals, 4250);
      assert.strictEqual(junior.beds, 6000);
      assert.strictEqual(junior.cots, 0);

      const teen = evaluateSingleChild({ ageYears: 15 }, 8500, 50, 6000, 1500);
      assert.strictEqual(teen.meals, 8500);
    });

    it("resolves driver cost accurately", () => {
      assert.strictEqual(calculateDriverCost(undefined), 0);
      assert.strictEqual(calculateDriverCost({ required: false }), 0);
      assert.strictEqual(
        calculateDriverCost({ required: true, dailyRateLkr: 2500, dailyMealAllowanceLkr: 1500 }),
        4000,
      );
    });

    it("resolves effective base room rate for foreign vs resident", () => {
      const residentInput: RateQuoteInput = {
        tenantId: validTenantId,
        checkInDate: "2026-10-10",
        checkOutDate: "2026-10-11",
        roomCategoryId: "cat-1",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "RO",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 30000,
      };
      assert.strictEqual(resolveEffectiveBaseRoomRate(residentInput), 30000);

      const foreignInput: RateQuoteInput = {
        ...residentInput,
        residencyTier: "FOREIGN",
        baseRateUsd: 120,
        exchangeRateUsdLkr: 305,
      };
      assert.strictEqual(resolveEffectiveBaseRoomRate(foreignInput), 36600);
    });

    it("calculates night taxes for inclusive and exclusive models", () => {
      const excl = calculateNightTaxes(10000, "TAX_EXCLUSIVE", DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.strictEqual(excl.ok, true);
      if (excl.ok) {
        assert.strictEqual(excl.value.breakdown.baseLkr, 10000);
        assert.strictEqual(excl.value.totalLkr, 13434.3);
      }

      const incl = calculateNightTaxes(13434.3, "TAX_INCLUSIVE", DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.strictEqual(incl.ok, true);
      if (incl.ok) {
        assert.strictEqual(incl.value.totalLkr, 13434.3);
      }
    });

    it("verifies default constants are exportable", () => {
      assert.strictEqual(DEFAULT_BABY_COT_RATE_LKR, 1500);
      assert.strictEqual(DEFAULT_EXTRA_BED_RATE_LKR, 6000);
      assert.strictEqual(DEFAULT_DRIVER_BED_RATE_LKR, 2500);
      assert.strictEqual(DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR, 1500);
      assert.strictEqual(DEFAULT_MEAL_PLAN_SUPPLEMENTS_LKR.RO, 0);
      assert.strictEqual(DEFAULT_MEAL_PLAN_SUPPLEMENTS_LKR.AI, 22000);
    });
  });

  describe("Seasonal Calendar Math", () => {
    it("correctly identifies dates in peak festive season (Dec 15 - Jan 15)", () => {
      assert.strictEqual(isDateInSeasonalBand("12-25", "12-15", "01-15"), true);
      assert.strictEqual(isDateInSeasonalBand("01-05", "12-15", "01-15"), true);
      assert.strictEqual(isDateInSeasonalBand("11-30", "12-15", "01-15"), false);
      assert.strictEqual(isDateInSeasonalBand("02-10", "12-15", "01-15"), false);
    });

    it("resolves correct multiplier across seasonal bands", () => {
      const peak = resolveSeasonForDate("2026-12-24", DEFAULT_SRI_LANKAN_SEASONAL_BANDS);
      assert.strictEqual(peak.seasonName, "Peak Festive Season");
      assert.strictEqual(peak.multiplier, 1.35);

      const monsoon = resolveSeasonForDate("2026-05-20", DEFAULT_SRI_LANKAN_SEASONAL_BANDS);
      assert.strictEqual(monsoon.seasonName, "South-West Monsoon");
      assert.strictEqual(monsoon.multiplier, 0.85);

      const standard = resolveSeasonForDate("2026-10-15", DEFAULT_SRI_LANKAN_SEASONAL_BANDS);
      assert.strictEqual(standard.seasonName, "Standard Tariffs");
      assert.strictEqual(standard.multiplier, 1.0);
    });

    it("generates stay night dates accurately", () => {
      const nights = generateStayNights("2026-12-14", "2026-12-17");
      assert.deepStrictEqual(nights, ["2026-12-14", "2026-12-15", "2026-12-16"]);
    });
  });

  describe("Child Supplement Rules (calculateChildNightSupplement)", () => {
    it("evaluates infant (3 yrs) as 100% complimentary stay & dine", () => {
      const result = calculateChildNightSupplement([{ ageYears: 3 }], 8500);
      assert.strictEqual(result.childMealsLkr, 0);
      assert.strictEqual(result.childExtraBedsLkr, 0);
      assert.strictEqual(result.childBabyCotsLkr, 0);
    });

    it("charges baby cot for infant when requested", () => {
      const result = calculateChildNightSupplement(
        [{ ageYears: 2, needsBabyCot: true }],
        8500,
        50,
        6000,
        1500,
      );
      assert.strictEqual(result.childMealsLkr, 0);
      assert.strictEqual(result.childBabyCotsLkr, 1500);
    });

    it("evaluates junior child (8 yrs) on HB with 50% meal supplement and free bed", () => {
      const result = calculateChildNightSupplement([{ ageYears: 8 }], 8500, 50);
      // 8,500 * 50% = 4,250 LKR
      assert.strictEqual(result.childMealsLkr, 4250);
      assert.strictEqual(result.childExtraBedsLkr, 0);
    });

    it("evaluates junior child (10 yrs) with extra bed", () => {
      const result = calculateChildNightSupplement(
        [{ ageYears: 10, needsExtraBed: true }],
        8500,
        50,
        6000,
      );
      assert.strictEqual(result.childMealsLkr, 4250);
      assert.strictEqual(result.childExtraBedsLkr, 6000);
    });

    it("evaluates teen (14 yrs) as adult meal supplement with extra bed", () => {
      const result = calculateChildNightSupplement(
        [{ ageYears: 14, needsExtraBed: true }],
        8500,
        50,
        6000,
      );
      assert.strictEqual(result.childMealsLkr, 8500);
      assert.strictEqual(result.childExtraBedsLkr, 6000);
    });
  });

  describe("Validation Rules", () => {
    it("rejects invalid check-in / check-out dates", () => {
      const res = calculateStayQuote({
        tenantId: validTenantId,
        checkInDate: "2026-12-20",
        checkOutDate: "2026-12-18", // before checkIn
        roomCategoryId: "cat-deluxe",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "RO",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 25000,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });

    it("rejects zero adult count", () => {
      const res = calculateStayQuote({
        tenantId: validTenantId,
        checkInDate: "2026-12-10",
        checkOutDate: "2026-12-11",
        roomCategoryId: "cat-deluxe",
        residencyTier: "RESIDENT",
        adultCount: 0,
        mealPlan: "BB",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 20000,
      });

      assert.strictEqual(res.ok, false);
    });

    it("rejects negative base rate", () => {
      const res = calculateStayQuote({
        tenantId: validTenantId,
        checkInDate: "2026-12-10",
        checkOutDate: "2026-12-11",
        roomCategoryId: "cat-deluxe",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "BB",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: -5000,
      });

      assert.strictEqual(res.ok, false);
    });
  });

  describe("Resident Stay Quote Calculations (TAX_EXCLUSIVE)", () => {
    it("computes 1-night Room Only (RO) resident stay with standard 34.34% tax compounding", () => {
      const input: RateQuoteInput = {
        tenantId: validTenantId,
        checkInDate: "2026-10-10",
        checkOutDate: "2026-10-11",
        roomCategoryId: "cat-deluxe",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "RO",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 20000,
      };

      const res = calculateStayQuote(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const quote = res.value;
      assert.strictEqual(quote.totalNights, 1);
      assert.strictEqual(quote.totalBaseRoomLkr, 20000);
      assert.strictEqual(quote.totalMealSupplementsLkr, 0);

      // Tax compounding on 20,000 LKR base:
      // SC (10%) = 2,000 -> Subtotal A = 22,000
      // TDL (1%) = 220
      // SSCL (2.5%) = 550
      // VAT Base = 22,770
      // VAT (18%) = 4,098.60
      // Grand Total = 22,000 + 220 + 550 + 4,098.60 = 26,868.60
      assert.strictEqual(quote.totalServiceChargeLkr, 2000);
      assert.strictEqual(quote.totalTdlLkr, 220);
      assert.strictEqual(quote.totalSsclLkr, 550);
      assert.strictEqual(quote.totalVatLkr, 4098.6);
      assert.strictEqual(quote.grandTotalLkr, 26868.6);
    });

    it("computes 2-night Peak Season cross-over (Dec 14 standard to Dec 15 peak)", () => {
      const input: RateQuoteInput = {
        tenantId: validTenantId,
        checkInDate: "2026-12-14",
        checkOutDate: "2026-12-16",
        roomCategoryId: "cat-ocean-villa",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "BB",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 40000,
      };

      const res = calculateStayQuote(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const quote = res.value;
      assert.strictEqual(quote.totalNights, 2);

      // Night 1 (Dec 14): Standard (1.0x) -> 40,000 room + 7,000 BB meals (2x 3,500) = 47,000 taxable base
      const night1 = quote.nights[0];
      assert.ok(night1);
      assert.strictEqual(night1.seasonName, "Standard Tariffs");
      assert.strictEqual(night1.baseRoomRateLkr, 40000);
      assert.strictEqual(night1.mealPlanSupplementLkr, 7000);

      // Night 2 (Dec 15): Peak (1.35x) -> 40,000 * 1.35 = 54,000 room + 7,000 BB meals = 61,000 taxable base
      const night2 = quote.nights[1];
      assert.ok(night2);
      assert.strictEqual(night2.seasonName, "Peak Festive Season");
      assert.strictEqual(night2.baseRoomRateLkr, 54000);
      assert.strictEqual(night2.mealPlanSupplementLkr, 7000);

      assert.strictEqual(quote.totalBaseRoomLkr, 94000);
      assert.strictEqual(quote.totalMealSupplementsLkr, 14000);
    });

    it("includes child supplements, extra bed, baby cot, and driver quarters", () => {
      const input: RateQuoteInput = {
        tenantId: validTenantId,
        checkInDate: "2026-10-01",
        checkOutDate: "2026-10-02",
        roomCategoryId: "cat-suite",
        residencyTier: "RESIDENT",
        adultCount: 2,
        children: [
          { ageYears: 4, needsBabyCot: true }, // Infant: 0 meals, 1500 baby cot
          { ageYears: 8, needsExtraBed: true }, // Junior: 50% HB (4,250) + 6000 extra bed
        ],
        mealPlan: "HB", // 8,500 LKR per adult
        driverAccommodation: {
          required: true,
          dormBedId: "dorm-bed-01",
          dailyRateLkr: DEFAULT_DRIVER_BED_RATE_LKR,
          dailyMealAllowanceLkr: DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR,
        },
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 50000,
      };

      const res = calculateStayQuote(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const quote = res.value;
      assert.strictEqual(quote.totalBaseRoomLkr, 50000);
      assert.strictEqual(quote.totalMealSupplementsLkr, 17000); // 2 adults * 8,500
      assert.strictEqual(quote.totalChildSupplementsLkr, 4250); // 1 child * 4,250
      assert.strictEqual(quote.totalExtraBedsLkr, 6000); // 1 extra bed
      assert.strictEqual(quote.totalBabyCotsLkr, 1500); // 1 baby cot
      assert.strictEqual(quote.totalDriverAllowanceLkr, 4000); // 2,500 bed + 1,500 meals

      // Total taxable supply = 50,000 + 17,000 + 4,250 + 6,000 + 1,500 + 4,000 = 82,750 LKR
      assert.strictEqual(quote.totalTaxableSupplyLkr, 82750);
    });
  });

  describe("Reverse Tax Inclusive Derivation (TAX_INCLUSIVE)", () => {
    it("extracts taxes backwards so grandTotalLkr equals published tariff", () => {
      const publishedTariffLkr = 50000;
      const input: RateQuoteInput = {
        tenantId: validTenantId,
        checkInDate: "2026-10-10",
        checkOutDate: "2026-10-11",
        roomCategoryId: "cat-standard",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "RO",
        pricingModel: "TAX_INCLUSIVE",
        baseRateLkr: publishedTariffLkr,
      };

      const res = calculateStayQuote(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const quote = res.value;
      assert.strictEqual(quote.grandTotalLkr, publishedTariffLkr);
      assert.strictEqual(quote.pricingModel, "TAX_INCLUSIVE");
      // Total taxable supply base + all taxes should equal publishedTariffLkr
      const totalReconstructed =
        quote.totalTaxableSupplyLkr +
        quote.totalServiceChargeLkr +
        quote.totalTdlLkr +
        quote.totalSsclLkr +
        quote.totalVatLkr;
      assert.strictEqual(Math.round(totalReconstructed), publishedTariffLkr);
    });
  });

  describe("Foreign Currency Rate Quotes & CBSL Exchange Rate Locking", () => {
    it("converts USD rate to LKR base and returns quoted foreign total in USD", () => {
      const baseRateUsd = 150;
      const exchangeRateUsdLkr = 305.0; // 150 USD * 305 = 45,750 LKR base

      const input: RateQuoteInput = {
        tenantId: validTenantId,
        checkInDate: "2026-11-01",
        checkOutDate: "2026-11-02",
        roomCategoryId: "cat-presidential",
        residencyTier: "FOREIGN",
        adultCount: 2,
        mealPlan: "RO",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 0,
        baseRateUsd,
        exchangeRateUsdLkr,
        quotedCurrency: "USD",
      };

      const res = calculateStayQuote(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const quote = res.value;
      assert.strictEqual(quote.totalBaseRoomLkr, 45750);
      assert.strictEqual(quote.quotedCurrency, "USD");
      assert.strictEqual(quote.effectiveExchangeRate, 305.0);
      // Total in LKR with taxes: 45,750 * 1.34343 = 61,461.92 LKR
      // In USD: 61,461.92 / 305.0 = ~201.51 USD
      assert.ok(quote.grandTotalQuotedCurrency > 200);
      assert.ok(quote.grandTotalQuotedCurrency < 205);
    });
  });

  describe("Cryptographically Chained Audit Logging", () => {
    it("creates a SHA-256 hash-chained immutable audit log for stay quote", () => {
      const quoteRes = calculateStayQuote({
        tenantId: validTenantId,
        checkInDate: "2026-10-10",
        checkOutDate: "2026-10-12",
        roomCategoryId: "cat-deluxe",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "BB",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 25000,
      });

      assert.strictEqual(quoteRes.ok, true);
      if (!quoteRes.ok) return;

      const auditRes = createRateQuoteAuditEntry(
        validTenantId,
        "user-frontdesk-1",
        quoteRes.value,
        new Date().toISOString(),
      );

      assert.strictEqual(auditRes.ok, true);
      if (!auditRes.ok) return;

      const entry = auditRes.value;
      assert.strictEqual(entry.tenantId, validTenantId);
      assert.strictEqual(entry.action, "CALCULATE_RATE_QUOTE");
      assert.strictEqual(entry.entityType, "RateQuote");
      assert.strictEqual(typeof entry.entryHash, "string");
      assert.strictEqual(entry.entryHash.length, 64); // SHA-256 hex string length
    });
  });
});
