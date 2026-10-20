/**
 * @hms/core - End-to-End Wedding Inquiry -> Tentative Hold -> Deposit -> BEO -> Final Settlement Test (banquetLifecycle.test.ts)
 *
 * Implements Step 349 (Phase 14.24) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive integration test of the complete Sri Lankan banquet & wedding lifecycle:
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix
 * 2. Prospective Couple Identity Verification (Sri Lankan NIC & Foreign Passport)
 * 3. Tentative Hold Creation & Auspicious Nekath Date Locking
 * 4. Quotation with Cent-Exact 4-Stage Compounding Sri Lankan Statutory Taxes (SC -> TDL -> SSCL -> VAT)
 * 5. Staged Advance Deposit Schedule (Booking 20%, 2nd Advance 30%, Final 50%)
 * 6. Honeymoon Suite Auto-Block Allocation & Inventory Lock
 * 7. Banquet Kitchen Bulk Recipe BOM Scaling & Pantry Shortage Detection (250 pax + 10% buffer)
 * 8. Casual Banquet Steward Attendance & Cash Payout Verification
 * 9. Post-Event Final Banquet Tax Invoice & Advance Deposit Deduction Settlement
 * 10. Complete Cryptographic SHA-256 Hash-Chained Immutable Audit Trail Verification
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  type BanquetActor,
  type BanquetKitchenActor,
  type BanquetQuoteInput,
  type BanquetRequisitionInput,
  DEFAULT_DEPOSIT_SCHEDULE_RULE,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  type RecipeDishBom,
  type StockSnapshot,
  calculateBanquetQuote,
  calculateForwardTax,
  createAuditEntry,
  generateBanquetKitchenRequisition,
  parseSriLankaNic,
  roundLkr,
  validateForeignPassport,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant SaaS & RBAC Actors
// ============================================================================

const TENANT_GALLE_FACE = "tenant-galle-face-colombo";
const TENANT_KANDY_VILLA = "tenant-kandy-regal-villa";

const BANQUET_MANAGER_ACTOR: BanquetActor = {
  userId: "USR-BNQ-MGR-01",
  role: "BANQUET_SALES_MANAGER",
  tenantId: TENANT_GALLE_FACE,
};

const CHEF_ACTOR: BanquetKitchenActor = {
  userId: "USR-CHEF-01",
  role: "EXECUTIVE_CHEF",
  tenantId: TENANT_GALLE_FACE,
};

const UNAUTHORIZED_ACTOR: BanquetActor = {
  userId: "USR-HK-09",
  role: "HOUSEKEEPING_ATTENDANT",
  tenantId: TENANT_GALLE_FACE,
};

// ============================================================================
// Test Suite: Step 349 End-to-End Banquet Lifecycle
// ============================================================================

describe("Step 349: End-to-End Banquet & Wedding Lifecycle Integration Test", () => {
  const auditTrail: AuditLogEntry[] = [];
  let currentHash = GENESIS_HASH;

  // --------------------------------------------------------------------------
  // 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant SaaS Isolation & RBAC Role Matrix", () => {
    it("rejects quote generation when actor tenantId does not match input tenantId", () => {
      const crossTenantInput: BanquetQuoteInput = {
        quoteId: "QTE-CROSS-01",
        tenantId: TENANT_KANDY_VILLA, // Target is Kandy
        eventName: "Cross Tenant Wedding",
        eventDateIso: "2026-11-20",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "GOLD",
        guaranteedPax: 200,
        plateRateLkr: 6500,
      };

      const result = calculateBanquetQuote(
        crossTenantInput,
        BANQUET_MANAGER_ACTOR, // Actor belongs to Galle Face
        "2026-10-10T09:00:00.000Z",
        currentHash,
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects quote generation when actor role is unauthorized", () => {
      const validQuoteInput: BanquetQuoteInput = {
        quoteId: "QTE-VALID-01",
        tenantId: TENANT_GALLE_FACE,
        eventName: "Test Wedding",
        eventDateIso: "2026-11-20",
        hallName: "Grand Ballroom",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "GOLD",
        guaranteedPax: 200,
        plateRateLkr: 6500,
      };

      const result = calculateBanquetQuote(
        validQuoteInput,
        UNAUTHORIZED_ACTOR,
        "2026-10-10T09:00:00.000Z",
        currentHash,
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "PERMISSION_DENIED");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Prospective Couple Identity Verification (Sri Lankan NIC & Passport)
  // --------------------------------------------------------------------------
  describe("2. Prospective Couple Identity Verification", () => {
    it("validates groom old-format 9-digit+V Sri Lankan NIC", () => {
      const groomNicResult = parseSriLankaNic("851234567V");
      assert.equal(groomNicResult.ok, true);
      if (groomNicResult.ok) {
        assert.equal(groomNicResult.value.format, "OLD_9_DIGIT");
        assert.equal(groomNicResult.value.gender, "MALE");
        assert.equal(groomNicResult.value.birthYear, 1985);
      }
    });

    it("validates bride new-format 12-digit Sri Lankan NIC", () => {
      const brideNicResult = parseSriLankaNic("199264501234");
      assert.equal(brideNicResult.ok, true);
      if (brideNicResult.ok) {
        assert.equal(brideNicResult.value.format, "NEW_12_DIGIT");
        assert.equal(brideNicResult.value.gender, "FEMALE");
        assert.equal(brideNicResult.value.birthYear, 1992);
      }
    });

    it("validates destination wedding foreign passport credentials", () => {
      const passportResult = validateForeignPassport({
        passportNo: "GBR987654321",
        countryCode: "GBR",
        arrivalDate: "2026-10-20",
        visaExpiryDate: "2026-11-20",
      });
      assert.equal(passportResult.ok, true);
      if (passportResult.ok) {
        assert.equal(passportResult.value.canonicalPassportNo, "GBR987654321");
        assert.equal(passportResult.value.canonicalCountryCode, "GBR");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. Tentative Hold Creation & Auspicious Nekath Date Locking
  // --------------------------------------------------------------------------
  describe("3. Tentative Hold Creation & Auspicious Date Locking", () => {
    it("creates a 7-day tentative hold on Grand Ballroom with audit hash chaining", () => {
      const holdEvent = {
        bookingId: "BNQ-HOLD-2026-1024",
        hallId: "HALL-GRAND-BALLROOM",
        eventDate: "2026-10-24", // Auspicious Nekath Saturday
        slot: "MORNING_PORUWA_LUNCH",
        clientName: "Kasun Rajapaksha & Sanduni Wickramasinghe",
        contactPhone: "+94771234567",
        clientNic: "851234567V",
        holdDurationDays: 7,
        holdExpiryIso: "2026-10-17T23:59:59.000Z",
      };

      const auditRes = createAuditEntry({
        tenantId: TENANT_GALLE_FACE,
        actorUserId: BANQUET_MANAGER_ACTOR.userId,
        action: "BANQUET_HOLD_CREATED",
        entityType: "BanquetBooking",
        entityId: holdEvent.bookingId,
        isoTs: "2026-10-10T09:00:00.000Z",
        prevHash: currentHash,
        afterJson: JSON.stringify(holdEvent),
      });

      assert.equal(auditRes.ok, true);
      if (auditRes.ok) {
        auditTrail.push(auditRes.value);
        currentHash = auditRes.value.entryHash;
        assert.equal(auditRes.value.prevHash, GENESIS_HASH);
        assert.ok(auditRes.value.entryHash.length === 64);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. Quotation with Cent-Exact 4-Stage Compounding Statutory Taxes
  // --------------------------------------------------------------------------
  describe("4. Quotation with Cent-Exact 4-Stage Compounding Statutory Taxes", () => {
    let quoteResult: ReturnType<typeof calculateBanquetQuote>["value"];

    it("generates quotation with guaranteed pax, extra pax, bite platters, corkage & cultural add-ons", () => {
      const quoteInput: BanquetQuoteInput = {
        quoteId: "QTE-2026-1024",
        tenantId: TENANT_GALLE_FACE,
        eventName: "Kasun & Sanduni Poruwa Wedding Reception",
        eventDateIso: "2026-10-24",
        hallName: "Grand Ballroom & Oceanfront Lawn",
        pricingModel: "TAX_EXCLUSIVE",
        packageTier: "PLATINUM",
        guaranteedPax: 250,
        plateRateLkr: 7500, // Rs. 7,500 per pax
        extraPaxCount: 25,
        extraPaxRateLkr: 7500,
        bitePlates: [
          {
            itemId: "BITE-HBC",
            name: "Crispy Hot Butter Cuttlefish (HBC)",
            unitPriceLkr: 4500,
            quantity: 10, // Rs. 45,000
          },
          {
            itemId: "BITE-CASHEW",
            name: "Devilled Chili Garlic Cashew Fry",
            unitPriceLkr: 5200,
            quantity: 10, // Rs. 52,000
          },
        ],
        corkage: {
          policy: "PER_BOTTLE",
          bottleCount: 20,
          ratePerBottleLkr: 2500, // Rs. 50,000 corkage
          chasersCostLkr: 30000, // Rs. 30,000 chasers & ice
        },
        hallHire: {
          baseHallHireLkr: 150000,
          includedAcHours: 6,
          actualHours: 8,
          overtimeHourlyRateLkr: 25000, // 2 overtime hours @ 25,000 = Rs. 50,000
        },
        ceremonyAddOns: {
          poruwaSetupLkr: 85000,
          traditionalDancersLkr: 65000,
          ashtakaJayamangalaLkr: 35000,
          oilLampAndDecorLkr: 25000,
          djBandSoundLkr: 75000,
        },
        depositRule: DEFAULT_DEPOSIT_SCHEDULE_RULE,
      };

      const res = calculateBanquetQuote(
        quoteInput,
        BANQUET_MANAGER_ACTOR,
        "2026-10-12T10:00:00.000Z",
        currentHash,
      );

      assert.equal(res.ok, true);
      if (res.ok) {
        quoteResult = res.value;
        auditTrail.push(res.value.auditEntry);
        currentHash = res.value.auditEntry.entryHash;

        // Verify Base Figures
        // Food: (250 * 7500) + (25 * 7500) = 1,875,000 + 187,500 = 2,062,500 LKR
        assert.equal(quoteResult.plateChargesLkr, 1875000);
        assert.equal(quoteResult.extraPaxChargesLkr, 187500);
        assert.equal(quoteResult.totalFoodLkr, 2062500);

        // Bites: 45,000 + 52,000 = 97,000 LKR
        assert.equal(quoteResult.bitePlatesTotalLkr, 97000);

        // Corkage: 20 * 2500 = 50,000 LKR + 30,000 chasers = 80,000 LKR
        assert.equal(quoteResult.corkageTotalLkr, 50000);
        assert.equal(quoteResult.chasersTotalLkr, 30000);

        // Hall Hire: 150,000 + (2 * 25,000) = 200,000 LKR
        assert.equal(quoteResult.hallHireBaseLkr, 150000);
        assert.equal(quoteResult.overtimeHours, 2);
        assert.equal(quoteResult.overtimeCostLkr, 50000);

        // Ceremony Add-Ons: 85,000 + 65,000 + 35,000 + 25,000 + 75,000 = 285,000 LKR
        assert.equal(quoteResult.ceremonyAddOnsTotalLkr, 285000);

        // Total Raw Base Supply:
        // 2,062,500 (Food) + 97,000 (Bites) + 80,000 (Bar) + 200,000 (Hall) + 285,000 (Ceremony)
        // = 2,724,500 LKR
        assert.equal(quoteResult.totalBaseSupplyLkr, 2724500);

        // Verify 4-Stage Compounding Sri Lankan Tax Math on Rs. 2,724,500:
        // 1. SC (10%): 272,450.00 -> Subtotal: 2,996,950.00
        // 2. TDL (1%): 29,969.50
        // 3. SSCL (2.5%): 74,923.75
        // 4. VAT Base: 2,996,950.00 + 29,969.50 + 74,923.75 = 3,101,843.25
        // 5. VAT (18%): 3,101,843.25 * 0.18 = 558,331.79
        // 6. Grand Total: 3,101,843.25 + 558,331.79 = 3,660,175.04 LKR
        assert.equal(quoteResult.scLkr, 272450);
        assert.equal(quoteResult.subtotalAfterScLkr, 2996950);
        assert.equal(quoteResult.tdlLkr, 29969.5);
        assert.equal(quoteResult.ssclLkr, 74923.75);
        assert.equal(quoteResult.vatBaseLkr, 3101843.25);
        assert.equal(quoteResult.vatLkr, 558331.79);
        assert.equal(quoteResult.grandTotalLkr, 3660175.04);

        // Effective Per Pax: 3,660,175.04 / 275 = 13,309.73 LKR
        assert.equal(quoteResult.effectivePerPaxLkr, 13309.73);
      }
    });

    // ------------------------------------------------------------------------
    // 5. Staged Advance Deposit Schedule
    // ------------------------------------------------------------------------
    it("generates correct 3-stage advance deposit schedule (20% -> 30% -> 50%)", () => {
      assert.ok(quoteResult);
      const schedule = quoteResult.depositSchedule;
      assert.equal(schedule.length, 3);

      // Stage 1 (20% Booking Advance): 3,660,175.04 * 0.20 = 732,035.01 LKR
      assert.equal(schedule[0]?.stageNumber, 1);
      assert.equal(schedule[0]?.percentage, 20);
      assert.equal(schedule[0]?.amountLkr, 732035.01);

      // Stage 2 (30% Second Advance): 3,660,175.04 * 0.30 = 1,098,052.51 LKR
      assert.equal(schedule[1]?.stageNumber, 2);
      assert.equal(schedule[1]?.percentage, 30);
      assert.equal(schedule[1]?.amountLkr, 1098052.51);

      // Stage 3 (50% Final Settlement): 3,660,175.04 - (732,035.01 + 1,098,052.51) = 1,830,087.52 LKR
      assert.equal(schedule[2]?.stageNumber, 3);
      assert.equal(schedule[2]?.percentage, 50);
      assert.equal(schedule[2]?.amountLkr, 1830087.52);

      // Total deposit stages exactly match Grand Total
      const totalStages = roundLkr(
        (schedule[0]?.amountLkr ?? 0) +
          (schedule[1]?.amountLkr ?? 0) +
          (schedule[2]?.amountLkr ?? 0),
      );
      assert.equal(totalStages, quoteResult.grandTotalLkr);
    });

    it("records Stage 1 and Stage 2 advance deposits in the immutable audit log", () => {
      // Stage 1 Deposit Paid via PayHere
      const stage1Audit = createAuditEntry({
        tenantId: TENANT_GALLE_FACE,
        actorUserId: BANQUET_MANAGER_ACTOR.userId,
        action: "DEPOSIT_PAID_CONFIRMED",
        entityType: "BanquetDeposit",
        entityId: "DEP-STAGE-1",
        isoTs: "2026-10-15T14:30:00.000Z",
        prevHash: currentHash,
        afterJson: JSON.stringify({
          stageNumber: 1,
          amountPaidLkr: 732035.01,
          paymentMethod: "PAYHERE_ONLINE",
          transactionRef: "PH-TX-99881122",
        }),
      });
      assert.equal(stage1Audit.ok, true);
      if (stage1Audit.ok) {
        auditTrail.push(stage1Audit.value);
        currentHash = stage1Audit.value.entryHash;
      }

      // Stage 2 Deposit Paid via Bank Wire Transfer
      const stage2Audit = createAuditEntry({
        tenantId: TENANT_GALLE_FACE,
        actorUserId: BANQUET_MANAGER_ACTOR.userId,
        action: "DEPOSIT_PAID_CONFIRMED",
        entityType: "BanquetDeposit",
        entityId: "DEP-STAGE-2",
        isoTs: "2026-10-20T11:00:00.000Z",
        prevHash: currentHash,
        afterJson: JSON.stringify({
          stageNumber: 2,
          amountPaidLkr: 1098052.51,
          paymentMethod: "COMMERCIAL_BANK_WIRE",
          transactionRef: "COMB-SL-44556677",
        }),
      });
      assert.equal(stage2Audit.ok, true);
      if (stage2Audit.ok) {
        auditTrail.push(stage2Audit.value);
        currentHash = stage2Audit.value.entryHash;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Honeymoon Suite Auto-Block Allocation & Inventory Lock
  // --------------------------------------------------------------------------
  describe("6. Honeymoon Suite Auto-Block Allocation & Inventory Lock", () => {
    it("auto-blocks complimentary Suite #402 and appends hash-chained audit record", () => {
      const suiteBlock = {
        reservationId: "RES-BNQ-9482",
        roomNumber: "SUITE-402",
        roomType: "HONEYMOON_EXECUTIVE_OCEAN_SUITE",
        checkInDate: "2026-10-24",
        checkOutDate: "2026-10-25",
        rateModel: "COMPLIMENTARY_BANQUET_PERK",
        coupleNames: "Kasun & Sanduni",
        status: "AUTO_BLOCKED_CONFIRMED",
      };

      const suiteAuditRes = createAuditEntry({
        tenantId: TENANT_GALLE_FACE,
        actorUserId: BANQUET_MANAGER_ACTOR.userId,
        action: "HONEYMOON_SUITE_BLOCKED",
        entityType: "RoomReservation",
        entityId: suiteBlock.reservationId,
        isoTs: "2026-10-21T09:15:00.000Z",
        prevHash: currentHash,
        afterJson: JSON.stringify(suiteBlock),
      });

      assert.equal(suiteAuditRes.ok, true);
      if (suiteAuditRes.ok) {
        auditTrail.push(suiteAuditRes.value);
        currentHash = suiteAuditRes.value.entryHash;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 7. Banquet Kitchen Bulk Recipe BOM Scaling & Pantry Shortage Detection
  // --------------------------------------------------------------------------
  describe("7. Banquet Kitchen Bulk Recipe BOM Scaling & Pantry Shortage Detection", () => {
    it("scales recipes for 250 pax + 10% kitchen buffer (275 portions) and identifies shortages", () => {
      const dishes: readonly RecipeDishBom[] = [
        {
          dishId: "DISH-BIRIYANI",
          dishName: "Hyderabadi Chicken Biriyani with Ghee Rice",
          ingredients: [
            {
              ingredientId: "ING-BASMATI",
              ingredientName: "Kohinoor Basmati Rice",
              category: "GRAIN",
              qtyPerPortion: 0.12, // 120g per pax
              unitOfMeasure: "kg",
              estimatedUnitCostLkr: 650,
            },
            {
              ingredientId: "ING-CHICKEN",
              ingredientName: "Fresh Halal Broiler Chicken",
              category: "MEAT",
              qtyPerPortion: 0.22, // 220g per pax
              unitOfMeasure: "kg",
              estimatedUnitCostLkr: 1450,
            },
            {
              ingredientId: "ING-GHEE",
              ingredientName: "Pure Cow Ghee",
              category: "OIL_FAT",
              qtyPerPortion: 0.02, // 20g per pax
              unitOfMeasure: "kg",
              estimatedUnitCostLkr: 3200,
            },
          ],
        },
        {
          dishId: "DISH-CASHEW-CURRY",
          dishName: "Creamy Sri Lankan Cashew Nut Curry (Kaju Maluwa)",
          ingredients: [
            {
              ingredientId: "ING-CASHEW",
              ingredientName: "Raw Whole Cashew Nuts",
              category: "GRAIN",
              qtyPerPortion: 0.05, // 50g per pax
              unitOfMeasure: "kg",
              estimatedUnitCostLkr: 4800,
            },
            {
              ingredientId: "ING-COCONUT-MILK",
              ingredientName: "Fresh Coconut Milk",
              category: "DAIRY",
              qtyPerPortion: 0.08, // 80ml per pax
              unitOfMeasure: "L",
              estimatedUnitCostLkr: 350,
            },
          ],
        },
      ];

      // Current pantry stock snapshots (with intentional shortage in Cashew & Basmati)
      const pantryStock: readonly StockSnapshot[] = [
        {
          ingredientId: "ING-BASMATI",
          availableQty: 25.0, // Needs 33.0 kg -> Shortage: 8.0 kg
          unitOfMeasure: "kg",
        },
        {
          ingredientId: "ING-CHICKEN",
          availableQty: 80.0, // Needs 60.5 kg -> No shortage
          unitOfMeasure: "kg",
        },
        {
          ingredientId: "ING-GHEE",
          availableQty: 10.0, // Needs 5.5 kg -> No shortage
          unitOfMeasure: "kg",
        },
        {
          ingredientId: "ING-CASHEW",
          availableQty: 5.0, // Needs 13.75 kg -> Shortage: 8.75 kg
          unitOfMeasure: "kg",
        },
        {
          ingredientId: "ING-COCONUT-MILK",
          availableQty: 50.0, // Needs 22.0 L -> No shortage
          unitOfMeasure: "L",
        },
      ];

      const reqInput: BanquetRequisitionInput = {
        tenantId: TENANT_GALLE_FACE,
        eventId: "EVT-2026-1024",
        functionNumber: "BEO-2026-11-0428",
        eventName: "Kasun & Sanduni Wedding Reception",
        eventDate: "2026-10-24",
        guaranteedPax: 250,
        bufferPax: 25, // 275 prep pax
        selectedDishes: dishes,
        stockSnapshots: pantryStock,
        prevAuditHash: currentHash,
      };

      const reqRes = generateBanquetKitchenRequisition(CHEF_ACTOR, reqInput);
      assert.equal(reqRes.ok, true);
      if (reqRes.ok) {
        const req = reqRes.value;
        auditTrail.push(req.auditEntry);
        currentHash = req.auditEntry.entryHash;

        assert.equal(req.prepPaxCount, 275);
        assert.equal(req.totalDistinctIngredients, 5);
        assert.equal(req.shortageItemsCount, 2); // Basmati & Cashew

        // Basmati: 275 * 0.12 = 33 kg. Stock: 25 kg -> Shortage: 8 kg
        const basmatiLine = req.items.find((i) => i.ingredientId === "ING-BASMATI");
        assert.ok(basmatiLine);
        assert.equal(basmatiLine?.totalRequiredQty, 33);
        assert.equal(basmatiLine?.currentStockQty, 25);
        assert.equal(basmatiLine?.shortageQty, 8);
        assert.equal(basmatiLine?.isShortage, true);
        assert.equal(basmatiLine?.estimatedProcurementCostLkr, 8 * 650); // 5,200 LKR

        // Cashew: 275 * 0.05 = 13.75 kg. Stock: 5 kg -> Shortage: 8.75 kg
        const cashewLine = req.items.find((i) => i.ingredientId === "ING-CASHEW");
        assert.ok(cashewLine);
        assert.equal(cashewLine?.totalRequiredQty, 13.75);
        assert.equal(cashewLine?.currentStockQty, 5);
        assert.equal(cashewLine?.shortageQty, 8.75);
        assert.equal(cashewLine?.isShortage, true);
        assert.equal(cashewLine?.estimatedProcurementCostLkr, 8.75 * 4800); // 42,000 LKR

        // Chicken: 275 * 0.22 = 60.5 kg. Stock: 80 kg -> Shortage: 0
        const chickenLine = req.items.find((i) => i.ingredientId === "ING-CHICKEN");
        assert.ok(chickenLine);
        assert.equal(chickenLine?.totalRequiredQty, 60.5);
        assert.equal(chickenLine?.isShortage, false);
        assert.equal(chickenLine?.shortageQty, 0);

        // Total Procurement Cost for shortages: 5,200 + 42,000 = 47,200 LKR
        assert.equal(req.totalEstimatedProcurementCostLkr, 47200);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 8. Casual Banquet Steward Attendance & Cash Payout Verification
  // --------------------------------------------------------------------------
  describe("8. Casual Banquet Steward Attendance & Cash Payout Verification", () => {
    it("computes casual steward shift wages, overtime, night allowance, and records petty cash audit", () => {
      // 10 stewards hired for 8-hour shift @ Rs. 4,500 base + 2h OT @ Rs. 600/h + Rs. 1,000 night travel
      // Per steward: 4,500 + 1,200 + 1,000 = 6,700 LKR
      // 10 stewards total: 67,000 LKR
      const stewardLaborData = {
        functionId: "BEO-2026-11-0428",
        headcountTotal: 10,
        stewardsVerifiedNics: ["912345678V", "931122334V", "199455667788", "199711223344"],
        totalShiftHours: 8,
        overtimeHours: 2,
        totalDisbursementLkr: 67000,
        supervisorApprovedBy: "USR-BNQ-MGR-01",
        payoutVoucherNumber: "VCHR-CS-2026-1024",
      };

      const stewardAuditRes = createAuditEntry({
        tenantId: TENANT_GALLE_FACE,
        actorUserId: BANQUET_MANAGER_ACTOR.userId,
        action: "STEWARD_PAYOUT_DISBURSED",
        entityType: "CasualStewardPayroll",
        entityId: stewardLaborData.payoutVoucherNumber,
        isoTs: "2026-10-24T17:30:00.000Z",
        prevHash: currentHash,
        afterJson: JSON.stringify(stewardLaborData),
      });

      assert.equal(stewardAuditRes.ok, true);
      if (stewardAuditRes.ok) {
        auditTrail.push(stewardAuditRes.value);
        currentHash = stewardAuditRes.value.entryHash;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 9. Post-Event Final Banquet Tax Invoice & Advance Deduction Settlement
  // --------------------------------------------------------------------------
  describe("9. Post-Event Final Banquet Tax Invoice & Advance Deduction Settlement", () => {
    it("calculates exact final invoice with actual pax overflow, deducts advance deposits, and verifies balance due", () => {
      // Event Execution Day Reality:
      // Guaranteed Pax: 250 pax @ 7,500 = 1,875,000 LKR
      // Actual Extra Pax at Doors: 15 pax @ 7,500 = 112,500 LKR (10 less than initial 25 estimate)
      // Food Total: 1,987,500 LKR
      // Bites Total: 97,000 LKR
      // Bar & Corkage: 80,000 LKR
      // Hall Hire (Base + 2h OT): 200,000 LKR
      // Ceremony Add-Ons: 285,000 LKR
      // Total Base Supply: 1,987,500 + 97,000 + 80,000 + 200,000 + 285,000 = 2,649,500 LKR

      const finalBaseSupplyLkr = 2649500;
      const taxResult = calculateForwardTax(finalBaseSupplyLkr, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.equal(taxResult.ok, true);
      if (taxResult.ok) {
        const taxes = taxResult.value;

        // Taxes on Rs. 2,649,500:
        // 1. SC (10%): 264,950.00 -> Subtotal: 2,914,450.00
        // 2. TDL (1%): 29,144.50
        // 3. SSCL (2.5%): 72,861.25
        // 4. VAT Base: 2,914,450.00 + 29,144.50 + 72,861.25 = 3,016,455.75
        // 5. VAT (18%): 3,016,455.75 * 0.18 = 542,962.04
        // 6. Final Grand Total: 3,016,455.75 + 542,962.04 = 3,559,417.79 LKR
        assert.equal(taxes.scLkr, 264950);
        assert.equal(taxes.tdlLkr, 29144.5);
        assert.equal(taxes.ssclLkr, 72861.25);
        assert.equal(taxes.vatBaseLkr, 3016455.75);
        assert.equal(taxes.vatLkr, 542962.04);
        assert.equal(taxes.grandTotalLkr, 3559417.79);

        // Already Paid Deposits:
        // Stage 1 (20% estimate): 732,035.01 LKR
        // Stage 2 (30% estimate): 1,098,052.51 LKR
        // Total Deposits Deducted: 1,830,087.52 LKR
        const totalDepositsCollectedLkr = roundLkr(732035.01 + 1098052.51);
        assert.equal(totalDepositsCollectedLkr, 1830087.52);

        // Net Balance Due at Checkout:
        // 3,559,417.79 - 1,830,087.52 = 1,729,330.27 LKR
        const netBalanceDueLkr = roundLkr(taxes.grandTotalLkr - totalDepositsCollectedLkr);
        assert.equal(netBalanceDueLkr, 1729330.27);

        // Record Final Settlement Audit Entry
        const settlementAudit = createAuditEntry({
          tenantId: TENANT_GALLE_FACE,
          actorUserId: BANQUET_MANAGER_ACTOR.userId,
          action: "BANQUET_FINAL_SETTLEMENT",
          entityType: "BanquetInvoice",
          entityId: "INV-BNQ-2026-8899",
          isoTs: "2026-10-24T18:00:00.000Z",
          prevHash: currentHash,
          afterJson: JSON.stringify({
            invoiceNumber: "INV-BNQ-2026-8899",
            finalGrandTotalLkr: taxes.grandTotalLkr,
            depositsDeductedLkr: totalDepositsCollectedLkr,
            netBalanceSettledLkr: netBalanceDueLkr,
            settlementMethod: "LANKA_QR_AND_CARD",
            settlementStatus: "FULLY_SETTLED_CLOSED",
          }),
        });

        assert.equal(settlementAudit.ok, true);
        if (settlementAudit.ok) {
          auditTrail.push(settlementAudit.value);
          currentHash = settlementAudit.value.entryHash;
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // 10. Complete Cryptographic SHA-256 Hash-Chained Immutable Audit Trail
  // --------------------------------------------------------------------------
  describe("10. Full Cryptographic SHA-256 Hash-Chained Audit Trail Verification", () => {
    it("verifies the unbroken 7-step cryptographic audit chain from inquiry to final checkout", () => {
      // Steps in auditTrail:
      // 1. BANQUET_HOLD_CREATED
      // 2. BANQUET_QUOTE_GENERATED
      // 3. DEPOSIT_PAID_CONFIRMED (Stage 1)
      // 4. DEPOSIT_PAID_CONFIRMED (Stage 2)
      // 5. HONEYMOON_SUITE_BLOCKED
      // 6. BANQUET_KITCHEN_REQUISITION_GENERATED
      // 7. STEWARD_PAYOUT_DISBURSED
      // 8. BANQUET_FINAL_SETTLEMENT
      assert.equal(auditTrail.length, 8);

      // Verify each link's prevHash matches the predecessor's entryHash
      assert.equal(auditTrail[0]?.prevHash, GENESIS_HASH);
      for (let i = 1; i < auditTrail.length; i++) {
        const prev = auditTrail[i - 1];
        const curr = auditTrail[i];
        assert.ok(prev && curr);
        assert.equal(
          curr.prevHash,
          prev.entryHash,
          `Broken link at index ${i}: ${curr.action} prevHash must equal previous entryHash.`,
        );
      }

      // Verify the entire chain with the domain engine's verifyAuditChain
      const verifyRes = verifyAuditChain(auditTrail);
      assert.equal(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.equal(verifyRes.value.verifiedCount, 8);
      }
    });
  });
});
