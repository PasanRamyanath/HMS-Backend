import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type PromoEvaluationResult,
  type PromoOffer,
  type PromoValidationInput,
  type RedeemOfferInput,
  SRI_LANKAN_BANK_BINS,
  type SriLankanBank,
  computeDiscountAmounts,
  createPromoOffer,
  identifySriLankanBank,
  redeemPromoOffer,
  validatePromoOffer,
} from "../src/index.js";

describe("Sri Lankan Bank Credit Card & Promo Coupon Engine (promoOffer.ts)", () => {
  const tenantId = "tenant-kandy-hills";

  const defaultSampathOffer: PromoOffer = {
    offerId: "promo-sampath-fb-25",
    tenantId,
    title: "Sampath Cards 25% Off Full Board & Half Board Stays",
    offerType: "BANK_CARD_BIN",
    bank: "SAMPATH_BANK",
    binPrefixes: ["406175", "453267", "524278"],
    discountBasis: "PERCENTAGE",
    discountValue: 25,
    maxDiscountCapLkr: 35000,
    validFrom: "2026-11-01",
    validUntil: "2026-12-15",
    blackoutDates: ["2026-11-23"], // Poya Day Blackout
    eligibleMealPlans: ["HB", "FB"],
    minNights: 2,
    minBookingAmountLkr: 50000,
    isActive: true,
    maxRedemptions: 100,
    currentRedemptions: 0,
  };

  const defaultHnbCouponOffer: PromoOffer = {
    offerId: "promo-hnb-direct-20",
    tenantId,
    title: "HNB Direct Seasonal 20% Off",
    offerType: "PROMO_COUPON_CODE",
    bank: "HATTON_NATIONAL_BANK",
    promoCode: "HNB20",
    discountBasis: "PERCENTAGE",
    discountValue: 20,
    validFrom: "2026-11-01",
    validUntil: "2026-11-30",
    eligibleMealPlans: ["BB", "HB", "FB"],
    minNights: 1,
    isActive: true,
    currentRedemptions: 5,
  };

  describe("1. Bank BIN Identification & Mapping", () => {
    it("identifies Sampath, Commercial Bank, HNB, and NTB Amex from card BIN prefixes", () => {
      assert.strictEqual(identifySriLankanBank("4061751234567890"), "SAMPATH_BANK");
      assert.strictEqual(identifySriLankanBank("4012450000000000"), "COMMERCIAL_BANK");
      assert.strictEqual(identifySriLankanBank("4159289999999999"), "HATTON_NATIONAL_BANK");
      assert.strictEqual(identifySriLankanBank("376910123456789"), "NATIONS_TRUST_BANK");
      assert.strictEqual(identifySriLankanBank("4090280000000000"), "BANK_OF_CEYLON");
      assert.strictEqual(identifySriLankanBank("4021330000000000"), "PEOPLES_BANK");
      assert.strictEqual(identifySriLankanBank("4019280000000000"), "HSBC_SRI_LANKA");
    });

    it("returns null for foreign, unknown, or truncated BIN numbers", () => {
      assert.strictEqual(identifySriLankanBank("999999"), null);
      assert.strictEqual(identifySriLankanBank("4061"), null); // under 6 digits
      assert.strictEqual(identifySriLankanBank(""), null);
    });

    it("verifies all registered bank BIN lists are non-empty", () => {
      for (const [bank, bins] of Object.entries(SRI_LANKAN_BANK_BINS)) {
        const bankName = bank as SriLankanBank;
        assert.ok(bins.length > 0, `Expected bins for bank ${bankName}`);
        for (const bin of bins) {
          assert.strictEqual(bin.length, 6);
        }
      }
    });
  });

  describe("2. Promo Offer Creation & Validation Rules", () => {
    it("creates valid promo offer successfully", () => {
      const res = createPromoOffer({
        offerId: "offer-new",
        tenantId,
        title: "Commercial Bank 20% Off",
        offerType: "BANK_CARD_BIN",
        bank: "COMMERCIAL_BANK",
        binPrefixes: ["401245"],
        discountBasis: "PERCENTAGE",
        discountValue: 20,
        validFrom: "2026-11-01",
        validUntil: "2026-11-30",
        eligibleMealPlans: ["FB"],
        isActive: true,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.currentRedemptions, 0);
        assert.strictEqual(res.value.title, "Commercial Bank 20% Off");
      }
    });

    it("rejects empty offer title", () => {
      const errTitle = createPromoOffer({
        ...defaultSampathOffer,
        title: "",
      });
      assert.strictEqual(errTitle.ok, false);
      if (!errTitle.ok) assert.strictEqual(errTitle.error.code, "VALIDATION_FAILED");
    });

    it("rejects percentage discount greater than 100", () => {
      const errPct = createPromoOffer({
        ...defaultSampathOffer,
        discountValue: 125,
      });
      assert.strictEqual(errPct.ok, false);
      if (!errPct.ok) assert.strictEqual(errPct.error.code, "VALIDATION_FAILED");
    });

    it("rejects inverted validFrom and validUntil dates", () => {
      const errDates = createPromoOffer({
        ...defaultSampathOffer,
        validFrom: "2026-12-01",
        validUntil: "2026-11-01",
      });
      assert.strictEqual(errDates.ok, false);
      if (!errDates.ok) assert.strictEqual(errDates.error.code, "VALIDATION_FAILED");
    });

    it("rejects coupon offer with empty promo code", () => {
      const errCoupon = createPromoOffer({
        ...defaultHnbCouponOffer,
        promoCode: "",
      });
      assert.strictEqual(errCoupon.ok, false);
      if (!errCoupon.ok) assert.strictEqual(errCoupon.error.code, "VALIDATION_FAILED");
    });

    it("rejects bank card offer with empty BIN prefixes", () => {
      const errBins = createPromoOffer({
        ...defaultSampathOffer,
        binPrefixes: [],
      });
      assert.strictEqual(errBins.ok, false);
      if (!errBins.ok) assert.strictEqual(errBins.error.code, "VALIDATION_FAILED");
    });
  });

  describe("3. Discount Computation & 4-Stage Compounding Tax Math", () => {
    it("computes exact percentage discount with ceiling capping", () => {
      // 25% of 100,000 = 25,000 (under 35,000 cap)
      const res1 = computeDiscountAmounts(100000, "PERCENTAGE", 25, 35000);
      assert.strictEqual(res1.discountAmountLkr, 25000);
      assert.strictEqual(res1.discountedBaseLkr, 75000);
      assert.strictEqual(res1.effectivePercentage, 25);

      // 25% of 200,000 = 50,000 (exceeds 35,000 cap -> capped at 35,000)
      const res2 = computeDiscountAmounts(200000, "PERCENTAGE", 25, 35000);
      assert.strictEqual(res2.discountAmountLkr, 35000);
      assert.strictEqual(res2.discountedBaseLkr, 165000);
      assert.strictEqual(res2.effectivePercentage, 17.5);
    });

    it("evaluates Sampath 25% Full Board promo with 4-stage tax compounding", () => {
      const input: PromoValidationInput = {
        tenantId,
        offer: defaultSampathOffer,
        cardBin: "406175",
        checkInDate: "2026-11-15",
        checkOutDate: "2026-11-18",
        nights: 3,
        mealPlan: "FB",
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
        taxConfig: DEFAULT_SRI_LANKA_TAX_CONFIG,
      };

      const evalRes = validatePromoOffer(input);
      assert.strictEqual(evalRes.ok, true);

      if (evalRes.ok) {
        const val: PromoEvaluationResult = evalRes.value;
        assert.strictEqual(val.originalBaseLkr, 100000);
        assert.strictEqual(val.discountAmountLkr, 25000);
        assert.strictEqual(val.discountedBaseLkr, 75000);
        assert.strictEqual(val.effectiveDiscountPercentage, 25);

        // Original 4-stage tax on 100,000 base:
        // SC (10%): 10,000 -> Subtotal A = 110,000
        // TDL (1%): 1,100
        // SSCL (2.5%): 2,750
        // VAT (18% on 113,850): 20,493
        // Grand: 134,343
        assert.strictEqual(val.originalTaxBreakdown.grandTotalLkr, 134343);

        // Discounted 4-stage tax on 75,000 base:
        // SC (10%): 7,500 -> Subtotal A = 82,500
        // TDL (1%): 825
        // SSCL (2.5%): 2,062.50
        // VAT Base: 82,500 + 825 + 2,062.50 = 85,387.50
        // VAT (18% on 85,387.50): 15,369.75
        // Grand: 82,500 + 825 + 2,062.50 + 15,369.75 = 100,757.25
        assert.strictEqual(val.discountedTaxBreakdown.grandTotalLkr, 100757.25);

        // Net savings on grand total: 134,343 - 100,757.25 = 33,585.75
        assert.strictEqual(val.grandTotalSavingsLkr, 33585.75);
      }
    });

    it("evaluates HNB coupon promo code accurately", () => {
      const input: PromoValidationInput = {
        tenantId,
        offer: defaultHnbCouponOffer,
        promoCode: "HNB20",
        checkInDate: "2026-11-10",
        checkOutDate: "2026-11-12",
        nights: 2,
        mealPlan: "HB",
        roomTypeId: "room-villa",
        baseAmountLkr: 60000,
      };

      const res = validatePromoOffer(input);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.discountAmountLkr, 12000); // 20% of 60,000
        assert.strictEqual(res.value.discountedBaseLkr, 48000);
      }
    });
  });

  describe("4. Sri Lankan Hospitality Restriction Enforcement", () => {
    it("rejects when meal plan is not eligible (e.g. RO/BB for Full Board only promo)", () => {
      const input: PromoValidationInput = {
        tenantId,
        offer: defaultSampathOffer, // requires HB or FB
        cardBin: "406175",
        checkInDate: "2026-11-15",
        checkOutDate: "2026-11-18",
        nights: 3,
        mealPlan: "RO", // Room Only
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
      };

      const res = validatePromoOffer(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "MEAL_PLAN_INELIGIBLE");
        assert.ok(res.error.message.includes("is not eligible for this bank offer"));
      }
    });

    it("rejects booking on Poya day blackout dates", () => {
      const input: PromoValidationInput = {
        tenantId,
        offer: defaultSampathOffer,
        cardBin: "406175",
        checkInDate: "2026-11-23", // Il Full Moon Poya Day
        checkOutDate: "2026-11-26",
        nights: 3,
        mealPlan: "FB",
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
      };

      const res = validatePromoOffer(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "BLACKOUT_DATE_CONFLICT");
      }
    });

    it("rejects when minimum stay nights requirement is not satisfied", () => {
      const input: PromoValidationInput = {
        tenantId,
        offer: defaultSampathOffer, // requires min 2 nights
        cardBin: "406175",
        checkInDate: "2026-11-15",
        checkOutDate: "2026-11-16",
        nights: 1, // Only 1 night
        mealPlan: "FB",
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
      };

      const res = validatePromoOffer(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "MIN_NIGHTS_NOT_MET");
      }
    });

    it("rejects when card BIN does not match participating bank range", () => {
      const input: PromoValidationInput = {
        tenantId,
        offer: defaultSampathOffer, // requires Sampath BINs
        cardBin: "490822", // ComBank BIN
        checkInDate: "2026-11-15",
        checkOutDate: "2026-11-18",
        nights: 3,
        mealPlan: "FB",
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
      };

      const res = validatePromoOffer(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "INVALID_BIN");
      }
    });

    it("rejects when coupon code is invalid or mismatched", () => {
      const input: PromoValidationInput = {
        tenantId,
        offer: defaultHnbCouponOffer,
        promoCode: "WRONGCODE",
        checkInDate: "2026-11-10",
        checkOutDate: "2026-11-12",
        nights: 2,
        mealPlan: "HB",
        roomTypeId: "room-villa",
        baseAmountLkr: 60000,
      };

      const res = validatePromoOffer(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "INVALID_PROMO_CODE");
      }
    });

    it("enforces tenant isolation preventing cross-tenant promo redemption", () => {
      const input: PromoValidationInput = {
        tenantId: "tenant-other-hotel",
        offer: defaultSampathOffer, // tenant-kandy-hills
        cardBin: "406175",
        checkInDate: "2026-11-15",
        checkOutDate: "2026-11-18",
        nights: 3,
        mealPlan: "FB",
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
      };

      const res = validatePromoOffer(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });
  });

  describe("5. Offer Redemption & Immutable Audit Hash-Chaining", () => {
    it("records redemption, increments counter, and appends valid SHA-256 audit entry", () => {
      // 1. Evaluate valid offer
      const evalRes = validatePromoOffer({
        tenantId,
        offer: defaultSampathOffer,
        cardBin: "406175",
        checkInDate: "2026-11-15",
        checkOutDate: "2026-11-18",
        nights: 3,
        mealPlan: "FB",
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
      });
      assert.strictEqual(evalRes.ok, true);
      if (!evalRes.ok) return;

      const redeemInput: RedeemOfferInput = {
        tenantId,
        actorUserId: "usr-frontdesk-01",
        offer: defaultSampathOffer,
        bookingReference: "DIR-KANDY-987654",
        evaluation: evalRes.value,
      };

      const redeemRes = redeemPromoOffer(redeemInput);
      assert.strictEqual(redeemRes.ok, true);

      if (redeemRes.ok) {
        const { updatedOffer, auditEntry } = redeemRes.value;
        assert.strictEqual(updatedOffer.currentRedemptions, 1);
        assert.strictEqual(auditEntry.action, "PROMO_OFFER_REDEEMED");
        assert.strictEqual(auditEntry.entityType, "PROMO_OFFER");
        assert.strictEqual(auditEntry.entityId, "promo-sampath-fb-25");
        assert.strictEqual(auditEntry.entryHash.length, 64);
        assert.ok(auditEntry.afterJson.includes("DIR-KANDY-987654"));
        assert.ok(auditEntry.afterJson.includes("33585.75"));
      }
    });

    it("rejects redemption when maxRedemptions quota is reached", () => {
      const exhaustedOffer: PromoOffer = {
        ...defaultSampathOffer,
        maxRedemptions: 5,
        currentRedemptions: 5,
      };

      const evalRes = validatePromoOffer({
        tenantId,
        offer: exhaustedOffer,
        cardBin: "406175",
        checkInDate: "2026-11-15",
        checkOutDate: "2026-11-18",
        nights: 3,
        mealPlan: "FB",
        roomTypeId: "room-deluxe",
        baseAmountLkr: 100000,
      });

      assert.strictEqual(evalRes.ok, false);
      if (!evalRes.ok) {
        assert.strictEqual(evalRes.error.code, "PROMO_QUOTA_EXCEEDED");
      }
    });
  });
});
