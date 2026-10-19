import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ChargePostingItem,
  type DmcVoucherCoverage,
  GENESIS_HASH,
  type RoutedFolioLine,
  type SplitFolioConfig,
  authorizeSplitFolioAction,
  createFolioPartitionKey,
  determineDefaultTarget,
  mapCategoryToDepartment,
  routeFolioCharges,
  transferFolioLine,
  verifyAuditChain,
} from "../src/index.js";

const TEST_TENANT_ID = "cinnamon-bentota-beach";
const TEST_RESERVATION_ID = "RES-2026-LK-88410";

describe("Split-Folio Routing Engine (splitFolioRouter.ts)", () => {
  describe("1. Multi-Tenant Isolation & Composite Partition Keys", () => {
    it("generates deterministic composite partition keys for master and guest sub-folios", () => {
      const masterKey = createFolioPartitionKey(TEST_RESERVATION_ID, "MASTER_DMC");
      const guestKey = createFolioPartitionKey(TEST_RESERVATION_ID, "GUEST_PERSONAL");

      assert.strictEqual(masterKey, `FOLIO#${TEST_RESERVATION_ID}#MASTER_DMC`);
      assert.strictEqual(guestKey, `FOLIO#${TEST_RESERVATION_ID}#GUEST_PERSONAL`);
    });

    it("rejects routing if tenant ID is invalid", () => {
      const config: SplitFolioConfig = {
        tenantId: "INVALID TENANT!!",
        reservationId: TEST_RESERVATION_ID,
        billingType: "DIRECT_GUEST",
      };

      const result = routeFolioCharges([], config);
      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    });

    it("maps split charge categories to operational folio departments", () => {
      assert.strictEqual(mapCategoryToDepartment("ROOM"), "ROOM");
      assert.strictEqual(mapCategoryToDepartment("MEAL_PLAN"), "ROOM");
      assert.strictEqual(mapCategoryToDepartment("FNB"), "FNB");
      assert.strictEqual(mapCategoryToDepartment("SPA"), "SPA");
      assert.strictEqual(mapCategoryToDepartment("LAUNDRY"), "LAUNDRY");
      assert.strictEqual(mapCategoryToDepartment("MINIBAR"), "MINIBAR");
      assert.strictEqual(mapCategoryToDepartment("EXCURSION"), "EXCURSION");
      assert.strictEqual(mapCategoryToDepartment("CORKAGE"), "CORKAGE");
    });
  });

  describe("2. Default Target Folio Determination Rules", () => {
    it("routes all charges to GUEST_PERSONAL for direct guest bookings", () => {
      const directConfig: SplitFolioConfig = {
        tenantId: TEST_TENANT_ID,
        reservationId: TEST_RESERVATION_ID,
        billingType: "DIRECT_GUEST",
      };

      assert.strictEqual(determineDefaultTarget("ROOM", directConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("MEAL_PLAN", directConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("FNB", directConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("SPA", directConfig), "GUEST_PERSONAL");
    });

    it("routes ROOM and MEAL_PLAN to MASTER_DMC for DMC tour operator bookings", () => {
      const dmcConfig: SplitFolioConfig = {
        tenantId: TEST_TENANT_ID,
        reservationId: TEST_RESERVATION_ID,
        billingType: "DMC_VOUCHER",
        dmcCoverage: {
          contractId: "DMC-AITKEN-2026",
          voucherNumber: "VCH-99412",
          tourOperatorName: "Aitken Spence Travels",
          includedMealPlan: "HB",
          coveredCategories: ["ROOM", "MEAL_PLAN"],
        },
      };

      // Contracted stay lines
      assert.strictEqual(determineDefaultTarget("ROOM", dmcConfig), "MASTER_DMC");
      assert.strictEqual(determineDefaultTarget("MEAL_PLAN", dmcConfig), "MASTER_DMC");

      // In-house incidental lines
      assert.strictEqual(determineDefaultTarget("FNB", dmcConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("SPA", dmcConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("MINIBAR", dmcConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("LAUNDRY", dmcConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("EXCURSION", dmcConfig), "GUEST_PERSONAL");
    });

    it("honors custom routing rules for VIP or corporate agreements", () => {
      const customConfig: SplitFolioConfig = {
        tenantId: TEST_TENANT_ID,
        reservationId: TEST_RESERVATION_ID,
        billingType: "CORPORATE",
        customRules: [
          { category: "ROOM", targetFolio: "MASTER_DMC" },
          { category: "SPA", targetFolio: "MASTER_DMC" }, // Corporate covers executive spa
          { category: "FNB", targetFolio: "GUEST_PERSONAL" },
        ],
      };

      assert.strictEqual(determineDefaultTarget("ROOM", customConfig), "MASTER_DMC");
      assert.strictEqual(determineDefaultTarget("SPA", customConfig), "MASTER_DMC");
      assert.strictEqual(determineDefaultTarget("FNB", customConfig), "GUEST_PERSONAL");
    });
  });

  describe("3. Full Lifecycle Split Folio Routing with 4-Stage Compounding Taxes", () => {
    const dmcCoverage: DmcVoucherCoverage = {
      contractId: "DMC-JETWING-2026",
      voucherNumber: "JW-VCH-55102",
      tourOperatorName: "Jetwing Travels Sri Lanka",
      includedMealPlan: "FB",
      coveredCategories: ["ROOM", "MEAL_PLAN"],
    };

    const dmcConfig: SplitFolioConfig = {
      tenantId: TEST_TENANT_ID,
      reservationId: TEST_RESERVATION_ID,
      billingType: "DMC_VOUCHER",
      dmcCoverage,
    };

    const postings: ReadonlyArray<ChargePostingItem> = [
      {
        lineId: "line-room-1",
        category: "ROOM",
        description: "Deluxe Ocean Suite - 3 Nights",
        quantity: 3,
        unitBaseLkr: 50000,
      },
      {
        lineId: "line-meal-1",
        category: "MEAL_PLAN",
        description: "Full Board Meal Plan Supplement",
        quantity: 3,
        unitBaseLkr: 15000,
      },
      {
        lineId: "line-fnb-extra-1",
        category: "FNB",
        description: "Poolside Cocktail & Snack Bar",
        quantity: 2,
        unitBaseLkr: 6000,
      },
      {
        lineId: "line-spa-1",
        category: "SPA",
        description: "Ceylon Ayurvedic Herbal Body Massage",
        quantity: 1,
        unitBaseLkr: 20000,
      },
      {
        lineId: "line-minibar-1",
        category: "MINIBAR",
        description: "In-Room Mini Bar Refreshments",
        quantity: 1,
        unitBaseLkr: 8500,
      },
      {
        lineId: "line-laundry-1",
        category: "LAUNDRY",
        description: "Express Shirt & Dress Pressing",
        quantity: 4,
        unitBaseLkr: 1200,
      },
    ];

    it("partitions lines accurately between Master DMC and Guest Personal folios", () => {
      const result = routeFolioCharges(postings, dmcConfig);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const split = result.value;
      assert.strictEqual(split.tenantId, TEST_TENANT_ID);
      assert.strictEqual(split.reservationId, TEST_RESERVATION_ID);
      assert.strictEqual(split.masterDmcLines.length, 2);
      assert.strictEqual(split.guestPersonalLines.length, 4);

      // Verify Master DMC lines
      const masterCategories = split.masterDmcLines.map((l) => l.category);
      assert.deepStrictEqual(masterCategories, ["ROOM", "MEAL_PLAN"]);
      // Master Base: (3 * 50,000) + (3 * 15,000) = 150,000 + 45,000 = 195,000 LKR
      assert.strictEqual(split.totalMasterBaseLkr, 195000);

      // Verify Guest Personal lines
      const guestCategories = split.guestPersonalLines.map((l) => l.category);
      assert.deepStrictEqual(guestCategories, ["FNB", "SPA", "MINIBAR", "LAUNDRY"]);
      // Guest Base: (2 * 6,000) + 20,000 + 8,500 + (4 * 1,200) = 12,000 + 20,000 + 8,500 + 4,800 = 45,300 LKR
      assert.strictEqual(split.totalGuestBaseLkr, 45300);
    });

    it("computes independent 4-stage compounding statutory taxes for both sub-folios", () => {
      const result = routeFolioCharges(postings, dmcConfig);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const { masterDmcTaxes, guestPersonalTaxes, grandTotalLkr } = result.value;

      // Master DMC Taxes (Base: 195,000 LKR):
      // SC (10%): 19,500
      // Subtotal after SC: 214,500
      // TDL (1% of 214,500): 2,145
      // SSCL (2.5% of 214,500): 5,362.50
      // VAT Base: 214,500 + 2,145 + 5,362.50 = 222,007.50
      // VAT (18% of 222,007.50): 39,961.35
      // Master Grand Total: 222,007.50 + 39,961.35 = 261,968.85
      assert.strictEqual(masterDmcTaxes.totalBaseLkr, 195000);
      assert.strictEqual(masterDmcTaxes.totalScLkr, 19500);
      assert.strictEqual(masterDmcTaxes.totalTdlLkr, 2145);
      assert.strictEqual(masterDmcTaxes.totalSsclLkr, 5362.5);
      assert.strictEqual(masterDmcTaxes.totalVatLkr, 39961.35);
      assert.strictEqual(masterDmcTaxes.grandTotalLkr, 261968.85);

      // Guest Personal Taxes (Base: 45,300 LKR):
      // SC (10%): 4,530
      // Subtotal after SC: 49,830
      // TDL (1% of 49,830): 498.30
      // SSCL (2.5% of 49,830): 1,245.75
      // VAT Base: 49,830 + 498.30 + 1,245.75 = 51,574.05
      // VAT (18% of 51,574.05): 9,283.33 (rounded)
      // Guest Grand Total: 51,574.05 + 9,283.33 = 60,857.38
      assert.strictEqual(guestPersonalTaxes.totalBaseLkr, 45300);
      assert.strictEqual(guestPersonalTaxes.totalScLkr, 4530);
      assert.strictEqual(guestPersonalTaxes.totalTdlLkr, 498.3);
      assert.strictEqual(guestPersonalTaxes.totalSsclLkr, 1245.75);
      assert.strictEqual(guestPersonalTaxes.totalVatLkr, 9283.33);
      assert.strictEqual(guestPersonalTaxes.grandTotalLkr, 60857.38);

      // Combined Grand Total
      // 261,968.85 + 60,857.38 = 322,826.23
      assert.strictEqual(grandTotalLkr, 322826.23);
    });
  });

  describe("4. DMC Voucher Credit Cap & Over-Allowance Spillover", () => {
    it("splits charge line when DMC voucher credit cap is reached", () => {
      // Contract with LKR 150,000 maximum master cap
      const cappedConfig: SplitFolioConfig = {
        tenantId: TEST_TENANT_ID,
        reservationId: TEST_RESERVATION_ID,
        billingType: "DMC_VOUCHER",
        fixedMasterCapLkr: 150000,
        dmcCoverage: {
          contractId: "DMC-WALKERS-2026",
          voucherNumber: "W-8819",
          tourOperatorName: "Walkers Tours",
          includedMealPlan: "BB",
        },
      };

      const postings: ReadonlyArray<ChargePostingItem> = [
        {
          lineId: "line-room",
          category: "ROOM",
          description: "Water Villa (Base)",
          quantity: 1,
          unitBaseLkr: 120000,
        },
        {
          lineId: "line-meal",
          category: "MEAL_PLAN",
          description: "Buffet Breakfast Supplement",
          quantity: 1,
          unitBaseLkr: 50000,
        },
      ];

      const result = routeFolioCharges(postings, cappedConfig);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const { masterDmcLines, guestPersonalLines, totalMasterBaseLkr, totalGuestBaseLkr } =
        result.value;

      // Master cap is exactly 150,000
      assert.strictEqual(totalMasterBaseLkr, 150000);
      // Remainder (20,000) spills over into guest personal
      assert.strictEqual(totalGuestBaseLkr, 20000);

      // Verify the split meal line
      assert.strictEqual(masterDmcLines.length, 2);
      assert.strictEqual(masterDmcLines[0]?.lineBaseLkr, 120000);
      assert.strictEqual(masterDmcLines[1]?.lineBaseLkr, 30000);

      assert.strictEqual(guestPersonalLines.length, 1);
      assert.strictEqual(guestPersonalLines[0]?.lineBaseLkr, 20000);
      assert.strictEqual(guestPersonalLines[0]?.isSpillover, true);
      assert.ok(guestPersonalLines[0]?.description.includes("Spillover"));
    });
  });

  describe("5. Front-Desk Folio Line Item Transfers & Audit Chaining", () => {
    it("transfers line item from Guest Personal to Master DMC with cryptographic SHA-256 audit log", () => {
      const initialLine: RoutedFolioLine = {
        lineId: "line-spa-special",
        category: "SPA",
        description: "Ayurvedic Treatment Voucher Addon",
        quantity: 1,
        unitBaseLkr: 15000,
        scExempt: false,
        targetFolio: "GUEST_PERSONAL",
        folioPartitionKey: `FOLIO#${TEST_RESERVATION_ID}#GUEST_PERSONAL`,
        lineBaseLkr: 15000,
        postedAt: "2026-10-19T08:00:00.000Z",
      };

      const transferReq = {
        tenantId: TEST_TENANT_ID,
        reservationId: TEST_RESERVATION_ID,
        lineId: "line-spa-special",
        fromTarget: "GUEST_PERSONAL" as const,
        toTarget: "MASTER_DMC" as const,
        reason: "DMC agent authorized spa treatment as complimentary honeymoon perk",
        staffUserId: "usr-frontdesk-pasan",
        prevAuditHash: GENESIS_HASH,
        isoTs: "2026-10-19T09:00:00.000Z",
      };

      const transferRes = transferFolioLine(transferReq, [initialLine]);
      assert.strictEqual(transferRes.ok, true);
      if (!transferRes.ok) return;

      const { updatedLines, transferredLine, auditEntry } = transferRes.value;

      // Line destination moved to MASTER_DMC
      assert.strictEqual(transferredLine.targetFolio, "MASTER_DMC");
      assert.strictEqual(
        transferredLine.folioPartitionKey,
        `FOLIO#${TEST_RESERVATION_ID}#MASTER_DMC`,
      );
      assert.strictEqual(updatedLines[0]?.targetFolio, "MASTER_DMC");

      // Audit entry verified
      assert.strictEqual(auditEntry.action, "UPDATE");
      assert.strictEqual(auditEntry.entityType, "FolioLineItem");
      assert.strictEqual(auditEntry.actorUserId, "usr-frontdesk-pasan");
      assert.strictEqual(auditEntry.prevHash, GENESIS_HASH);

      // Verify audit chain
      const chainRes = verifyAuditChain([auditEntry]);
      assert.strictEqual(chainRes.ok, true);
    });

    it("rejects line transfer when target matches current folio or reason is too brief", () => {
      const line: RoutedFolioLine = {
        lineId: "line-1",
        category: "FNB",
        description: "Juice",
        quantity: 1,
        unitBaseLkr: 1000,
        scExempt: false,
        targetFolio: "GUEST_PERSONAL",
        folioPartitionKey: `FOLIO#${TEST_RESERVATION_ID}#GUEST_PERSONAL`,
        lineBaseLkr: 1000,
        postedAt: "2026-10-19T08:00:00.000Z",
      };

      // Same target
      const resSame = transferFolioLine(
        {
          tenantId: TEST_TENANT_ID,
          reservationId: TEST_RESERVATION_ID,
          lineId: "line-1",
          fromTarget: "GUEST_PERSONAL",
          toTarget: "GUEST_PERSONAL",
          reason: "Valid reason for test",
          staffUserId: "user-1",
          prevAuditHash: GENESIS_HASH,
        },
        [line],
      );
      assert.strictEqual(resSame.ok, false);
      if (!resSame.ok) {
        assert.strictEqual(resSame.error.code, "VALIDATION_FAILED");
      }

      // Reason too short
      const resShort = transferFolioLine(
        {
          tenantId: TEST_TENANT_ID,
          reservationId: TEST_RESERVATION_ID,
          lineId: "line-1",
          fromTarget: "GUEST_PERSONAL",
          toTarget: "MASTER_DMC",
          reason: "no",
          staffUserId: "user-1",
          prevAuditHash: GENESIS_HASH,
        },
        [line],
      );
      assert.strictEqual(resShort.ok, false);
      if (!resShort.ok) {
        assert.strictEqual(resShort.error.code, "VALIDATION_FAILED");
      }
    });
  });

  describe("6. Staff RBAC Authorization Matrix", () => {
    it("authorizes Front Desk, General Manager, and Owner for folio operations", () => {
      assert.strictEqual(
        authorizeSplitFolioAction(TEST_TENANT_ID, "FRONT_DESK", TEST_TENANT_ID, "ROUTE"),
        true,
      );
      assert.strictEqual(
        authorizeSplitFolioAction(TEST_TENANT_ID, "GENERAL_MANAGER", TEST_TENANT_ID, "TRANSFER"),
        true,
      );
      assert.strictEqual(
        authorizeSplitFolioAction(TEST_TENANT_ID, "HOTEL_OWNER", TEST_TENANT_ID, "TRANSFER"),
        true,
      );
      assert.strictEqual(
        authorizeSplitFolioAction(TEST_TENANT_ID, "ACCOUNTANT", TEST_TENANT_ID, "VIEW"),
        true,
      );
    });

    it("rejects unauthorized staff roles (Housekeeping, Waiter) from transferring folio charges", () => {
      assert.strictEqual(
        authorizeSplitFolioAction(TEST_TENANT_ID, "HOUSEKEEPING", TEST_TENANT_ID, "TRANSFER"),
        false,
      );
      assert.strictEqual(
        authorizeSplitFolioAction(TEST_TENANT_ID, "WAITER", TEST_TENANT_ID, "TRANSFER"),
        false,
      );
    });

    it("blocks cross-tenant access deterministically", () => {
      assert.strictEqual(
        authorizeSplitFolioAction(
          TEST_TENANT_ID,
          "GENERAL_MANAGER",
          "other-tenant-jetwing",
          "VIEW",
        ),
        false,
      );
    });
  });
});
