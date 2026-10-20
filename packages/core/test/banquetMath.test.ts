/**
 * @hms/core - Sri Lankan Wedding & Banquet Pricing Calculator Tests (banquetMath.test.ts)
 *
 * Implements Step 326 & Step 327 (Phase 14.01 & 14.02) of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive unit test suite for wedding, homecoming, and corporate banquet quotations:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries
 * 2. Input Validation (pax counts, plate rates, deposit schedule percentages)
 * 3. Tax-Exclusive Corporate Banquet: 200 pax guaranteed + 15 overflow + 20 tables devilled bites + corkage waiver
 * 4. Tax-Inclusive Nett Per-Plate Wedding Package (e.g. LKR 8,500 Nett) with Reverse Tax Math
 * 5. Corkage Policy Variants (Waived, Per-Bottle, Per-Pax, Fixed Hall Fee)
 * 6. Hall Hire & AC Overtime Calculations
 * 7. Traditional Ceremony Add-Ons (Poruwa, Kandyan Dancers, Ashtaka, Oil Lamp)
 * 8. Staged Advance Deposit Schedule (Booking 20%, 2nd Advance 30%, Final 50%)
 * 9. Cryptographically Hash-Chained SHA-256 Audit Log Integrity
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BanquetActor,
  type BanquetQuoteInput,
  type BitePlateItem,
  GENESIS_HASH,
  calculateBanquetQuote,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Fixtures
// ============================================================================

const TENANT_A = "galle-face-heritage";
const TENANT_B = "kandy-hills-resort";

const ACTOR_SALES_MGR: BanquetActor = {
  userId: "usr-sales-01",
  role: "BANQUET_SALES_MANAGER",
  tenantId: TENANT_A,
};

const ACTOR_COORDINATOR: BanquetActor = {
  userId: "usr-coord-01",
  role: "SALES_COORDINATOR",
  tenantId: TENANT_A,
};

const ACTOR_UNAUTHORIZED: BanquetActor = {
  userId: "usr-hk-01",
  role: "HOUSEKEEPING_ATTENDANT",
  tenantId: TENANT_A,
};

function unwrapOk<T>(res: { ok: boolean; value?: T; error?: unknown }): T {
  assert.strictEqual(res.ok, true);
  return res.value as T;
}

function unwrapErr<E>(res: { ok: boolean; value?: unknown; error?: E }): E {
  assert.strictEqual(res.ok, false);
  return res.error as E;
}

describe("Step 326 & 327: Sri Lankan Banquet & Wedding Pricing Calculator (banquetMath.test.ts)", () => {
  // --------------------------------------------------------------------------
  // 1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant Isolation & Role Boundaries", () => {
    const baseInput: BanquetQuoteInput = {
      quoteId: "q-test-01",
      tenantId: TENANT_A,
      eventName: "Senanayake & Jayawardena Wedding",
      eventDateIso: "2026-11-28T10:00:00.000Z",
      hallName: "Grand Ballroom",
      pricingModel: "TAX_EXCLUSIVE",
      packageTier: "GOLD",
      guaranteedPax: 150,
      plateRateLkr: 7500,
    };

    it("rejects quote generation across mismatched tenant boundaries", () => {
      const crossTenantActor: BanquetActor = {
        userId: "usr-intruder",
        role: "BANQUET_SALES_MANAGER",
        tenantId: TENANT_B,
      };

      const result = calculateBanquetQuote(
        baseInput,
        crossTenantActor,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      const err = unwrapErr(result);
      assert.strictEqual(err.code, "TENANT_MISMATCH");
    });

    it("rejects unauthorized staff roles (e.g. HOUSEKEEPING_ATTENDANT)", () => {
      const result = calculateBanquetQuote(
        baseInput,
        ACTOR_UNAUTHORIZED,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      const err = unwrapErr(result);
      assert.strictEqual(err.code, "PERMISSION_DENIED");
    });

    it("allows authorized roles such as SALES_COORDINATOR and BANQUET_SALES_MANAGER", () => {
      const result = calculateBanquetQuote(
        baseInput,
        ACTOR_COORDINATOR,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      assert.strictEqual(result.ok, true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Input Validation Checks
  // --------------------------------------------------------------------------
  describe("2. Input Validation", () => {
    it("rejects quote with guaranteedPax < 1", () => {
      const input: BanquetQuoteInput = {
        quoteId: "q-val-01",
        tenantId: TENANT_A,
        eventName: "Zero Pax Banquet",
        eventDateIso: "2026-11-28T10:00:00.000Z",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "BRONZE",
        guaranteedPax: 0,
        plateRateLkr: 5000,
      };

      const result = calculateBanquetQuote(
        input,
        ACTOR_SALES_MGR,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      const err = unwrapErr(result);
      assert.strictEqual(err.code, "VALIDATION_FAILED");
      assert.ok(err.message.includes("at least 1"));
    });

    it("rejects negative plate rates or negative extra pax counts", () => {
      const inputNegRate: BanquetQuoteInput = {
        quoteId: "q-val-02",
        tenantId: TENANT_A,
        eventName: "Negative Rate Banquet",
        eventDateIso: "2026-11-28T10:00:00.000Z",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "BRONZE",
        guaranteedPax: 100,
        plateRateLkr: -500,
      };

      const res1 = calculateBanquetQuote(
        inputNegRate,
        ACTOR_SALES_MGR,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      assert.strictEqual(unwrapErr(res1).code, "VALIDATION_FAILED");

      const inputNegExtra: BanquetQuoteInput = {
        ...inputNegRate,
        plateRateLkr: 5000,
        extraPaxCount: -5,
      };
      const res2 = calculateBanquetQuote(
        inputNegExtra,
        ACTOR_SALES_MGR,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      assert.strictEqual(unwrapErr(res2).code, "VALIDATION_FAILED");
    });

    it("rejects custom deposit schedule if percentages do not sum to 100%", () => {
      const inputBadDeposit: BanquetQuoteInput = {
        quoteId: "q-val-03",
        tenantId: TENANT_A,
        eventName: "Bad Deposit Banquet",
        eventDateIso: "2026-11-28T10:00:00.000Z",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "BRONZE",
        guaranteedPax: 100,
        plateRateLkr: 5000,
        depositRule: {
          bookingAdvancePct: 20,
          secondAdvancePct: 30,
          finalSettlementPct: 40, // Sum = 90%
        },
      };

      const result = calculateBanquetQuote(
        inputBadDeposit,
        ACTOR_SALES_MGR,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      const err = unwrapErr(result);
      assert.strictEqual(err.code, "VALIDATION_FAILED");
      assert.ok(err.message.includes("sum to 100%"));
    });
  });

  // --------------------------------------------------------------------------
  // 3. Rung 5 / Rung 6 Comprehensive Corporate Banquet Scenario (Tax-Exclusive)
  // --------------------------------------------------------------------------
  describe("3. Rung 5 & 6 Tax-Exclusive Corporate Banquet Calculation", () => {
    it("calculates 200 guaranteed pax + 15 overflow + 20 tables devilled bites + corkage waiver", () => {
      const bitePlates: BitePlateItem[] = [
        {
          itemId: "bp-cashew",
          name: "Devilled Cashew Nuts Platter",
          unitPriceLkr: 2500,
          quantity: 20, // 50,000 LKR
        },
        {
          itemId: "bp-cuttlefish",
          name: "Hot Butter Cuttlefish Platter",
          unitPriceLkr: 3000,
          quantity: 20, // 60,000 LKR
        },
      ];

      const input: BanquetQuoteInput = {
        quoteId: "quote-corp-2026",
        tenantId: TENANT_A,
        eventName: "Dialog Axiata Annual Gala Dinner",
        eventDateIso: "2026-12-15T18:00:00.000Z",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "PLATINUM",
        guaranteedPax: 200,
        plateRateLkr: 6000, // 200 * 6,000 = 1,200,000 LKR
        extraPaxCount: 15,
        extraPaxRateLkr: 6000, // 15 * 6,000 = 90,000 LKR
        bitePlates, // Total 110,000 LKR
        corkage: {
          policy: "WAIVED",
          chasersCostLkr: 25000, // Soft drinks, soda, tonic
        },
        hallHire: {
          baseHallHireLkr: 100000,
          includedAcHours: 7,
          actualHours: 9,
          overtimeHourlyRateLkr: 25000, // 2 hours overtime = 50,000 LKR
        },
        ceremonyAddOns: {
          poruwaSetupLkr: 0,
          traditionalDancersLkr: 35000,
          djBandSoundLkr: 40000,
        },
      };

      const quoteRes = calculateBanquetQuote(
        input,
        ACTOR_SALES_MGR,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      const quote = unwrapOk(quoteRes);

      // Verify line items:
      assert.strictEqual(quote.guaranteedPax, 200);
      assert.strictEqual(quote.extraPaxCount, 15);
      assert.strictEqual(quote.totalPax, 215);

      assert.strictEqual(quote.plateChargesLkr, 1200000);
      assert.strictEqual(quote.extraPaxChargesLkr, 90000);
      assert.strictEqual(quote.totalFoodLkr, 1290000);

      assert.strictEqual(quote.bitePlatesTotalLkr, 110000);
      assert.strictEqual(quote.corkageTotalLkr, 0); // Waived
      assert.strictEqual(quote.chasersTotalLkr, 25000);
      assert.strictEqual(quote.hallHireBaseLkr, 100000);
      assert.strictEqual(quote.overtimeHours, 2);
      assert.strictEqual(quote.overtimeCostLkr, 50000);
      assert.strictEqual(quote.ceremonyAddOnsTotalLkr, 75000);

      // Total Base Supply:
      // 1,290,000 (food) + 110,000 (bites) + 0 (corkage) + 25,000 (chasers) + 100,000 (hall) + 50,000 (overtime) + 75,000 (ceremony)
      // = 1,650,000 LKR
      assert.strictEqual(quote.totalBaseSupplyLkr, 1650000);

      // 4-Stage Sri Lankan Compounding Taxes on LKR 1,650,000:
      // Stage 1: SC (10%): 1,650,000 * 0.10 = 165,000
      assert.strictEqual(quote.scLkr, 165000);
      // Subtotal A: 1,815,000
      assert.strictEqual(quote.subtotalAfterScLkr, 1815000);
      // Stage 2: TDL (1%): 1,815,000 * 0.01 = 18,150
      assert.strictEqual(quote.tdlLkr, 18150);
      // Stage 3: SSCL (2.5%): 1,815,000 * 0.025 = 45,375
      assert.strictEqual(quote.ssclLkr, 45375);
      // VAT Base: 1,815,000 + 18,150 + 45,375 = 1,878,525
      assert.strictEqual(quote.vatBaseLkr, 1878525);
      // Stage 4: VAT (18%): 1,878,525 * 0.18 = 338,134.50
      assert.strictEqual(quote.vatLkr, 338134.5);
      // Grand Total: 1,815,000 + 18,150 + 45,375 + 338,134.50 = 2,216,659.50 LKR
      assert.strictEqual(quote.grandTotalLkr, 2216659.5);

      // Effective per pax: 2,216,659.50 / 215 = 10,310.04 LKR
      assert.strictEqual(quote.effectivePerPaxLkr, 10310.04);

      // Staged Advance Deposit Schedule:
      assert.strictEqual(quote.depositSchedule.length, 3);
      // Stage 1 (20%): 2,216,659.50 * 0.20 = 443,331.90 LKR
      assert.strictEqual(quote.depositSchedule[0]?.amountLkr, 443331.9);
      // Stage 2 (30%): 2,216,659.50 * 0.30 = 664,997.85 LKR
      assert.strictEqual(quote.depositSchedule[1]?.amountLkr, 664997.85);
      // Stage 3 (50%): 2,216,659.50 - 443,331.90 - 664,997.85 = 1,108,329.75 LKR
      assert.strictEqual(quote.depositSchedule[2]?.amountLkr, 1108329.75);

      // Sum of deposit stages exactly equals grandTotalLkr
      const depositSum = quote.depositSchedule.reduce(
        (acc, stage) => Math.round((acc + stage.amountLkr + Number.EPSILON) * 100) / 100,
        0,
      );
      assert.strictEqual(depositSum, quote.grandTotalLkr);

      // Verify Audit Trail entry
      assert.strictEqual(quote.auditEntry.action, "BANQUET_QUOTE_GENERATED");
      assert.strictEqual(quote.auditEntry.tenantId, TENANT_A);
      const auditChainRes = verifyAuditChain([quote.auditEntry]);
      assert.strictEqual(auditChainRes.ok, true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Tax-Inclusive Nett Per-Plate Wedding Package Scenario
  // --------------------------------------------------------------------------
  describe("4. Tax-Inclusive Nett Per-Plate Wedding Package", () => {
    it("derives exact base supply and statutory taxes from LKR 8,500 Nett per-plate quote", () => {
      const input: BanquetQuoteInput = {
        quoteId: "quote-wedding-8500",
        tenantId: TENANT_A,
        eventName: "Perera & De Silva Wedding Reception",
        eventDateIso: "2026-11-20T11:00:00.000Z",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_INCLUSIVE_NETT",
        packageTier: "GOLD",
        guaranteedPax: 250,
        plateRateLkr: 8500, // 250 * 8,500 = 2,125,000 LKR Gross Nett Total
      };

      const quoteRes = calculateBanquetQuote(
        input,
        ACTOR_SALES_MGR,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      const quote = unwrapOk(quoteRes);

      // Grand total must equal exact gross quote
      assert.strictEqual(quote.grandTotalLkr, 2125000);
      assert.strictEqual(quote.effectivePerPaxLkr, 8500);

      // Mathematical verification of derived taxes:
      // Subtotal after SC + TDL + SSCL + VAT must reconcile to 2,125,000 LKR
      const derivedSum = quote.subtotalAfterScLkr + quote.tdlLkr + quote.ssclLkr + quote.vatLkr;
      assert.strictEqual(derivedSum, 2125000);
      assert.ok(quote.totalBaseSupplyLkr < 2125000);
      assert.ok(quote.scLkr > 0);
      assert.ok(quote.vatLkr > 0);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Corkage Policy Variations
  // --------------------------------------------------------------------------
  describe("5. Corkage Policy Variations", () => {
    it("handles PER_BOTTLE corkage calculation", () => {
      const input: BanquetQuoteInput = {
        quoteId: "quote-cork-01",
        tenantId: TENANT_A,
        eventName: "Rotary Club Dinner",
        eventDateIso: "2026-11-25T19:00:00.000Z",
        hallName: "Cedar Hall",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "SILVER",
        guaranteedPax: 100,
        plateRateLkr: 5000,
        corkage: {
          policy: "PER_BOTTLE",
          bottleCount: 30,
          ratePerBottleLkr: 1500, // 30 * 1,500 = 45,000 LKR
        },
      };

      const quote = unwrapOk(
        calculateBanquetQuote(input, ACTOR_SALES_MGR, "2026-10-20T12:00:00.000Z", GENESIS_HASH),
      );
      assert.strictEqual(quote.corkageTotalLkr, 45000);
    });

    it("handles PER_PAX_FLAT corkage calculation", () => {
      const input: BanquetQuoteInput = {
        quoteId: "quote-cork-02",
        tenantId: TENANT_A,
        eventName: "Alumni Reunion",
        eventDateIso: "2026-11-26T19:00:00.000Z",
        hallName: "Cedar Hall",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "SILVER",
        guaranteedPax: 100,
        extraPaxCount: 10, // 110 pax total
        plateRateLkr: 5000,
        corkage: {
          policy: "PER_PAX_FLAT",
          ratePerPaxLkr: 400, // 110 * 400 = 44,000 LKR
        },
      };

      const quote = unwrapOk(
        calculateBanquetQuote(input, ACTOR_SALES_MGR, "2026-10-20T12:00:00.000Z", GENESIS_HASH),
      );
      assert.strictEqual(quote.corkageTotalLkr, 44000);
    });

    it("handles FIXED_HALL_FEE corkage calculation", () => {
      const input: BanquetQuoteInput = {
        quoteId: "quote-cork-03",
        tenantId: TENANT_A,
        eventName: "Corporate Launch",
        eventDateIso: "2026-11-27T19:00:00.000Z",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "GOLD",
        guaranteedPax: 200,
        plateRateLkr: 7000,
        corkage: {
          policy: "FIXED_HALL_FEE",
          fixedFeeLkr: 75000,
        },
      };

      const quote = unwrapOk(
        calculateBanquetQuote(input, ACTOR_SALES_MGR, "2026-10-20T12:00:00.000Z", GENESIS_HASH),
      );
      assert.strictEqual(quote.corkageTotalLkr, 75000);
    });
  });
});
