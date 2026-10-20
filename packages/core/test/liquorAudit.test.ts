/**
 * Unit Test Suite for Step 385 & Step 386: Bar Liquor Shot / Peg Variance Auditor
 * (`packages/core/test/liquorAudit.test.ts`)
 *
 * Validates:
 * 1. Sri Lankan standard peg volumes (25ml single, 50ml double, 750ml bottle)
 * 2. Theoretical POS drink sales + cocktail BOM volume calculation
 * 3. Old Arrack 750ml bottle peg reconciliation:
 *    - Perfect balance (30x 25ml single pegs from 1 bottle)
 *    - Over-pouring / unbilled drinks (shortage)
 *    - Under-pouring (surplus)
 * 4. Cost of Goods Sold (COGS) shrinkage and retail revenue loss in LKR
 * 5. Multi-tenant tenantId isolation & RBAC RolePermissionMatrix validation
 * 6. Cryptographic SHA-256 ImmutableAuditLog creation
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BarAuditStaffActor,
  type BarLiquorItemConfig,
  type BarPosSalesInput,
  type BarShiftStockInput,
  type CalculateLiquorVarianceInput,
  calculateItemLiquorVariance,
  calculateLiquorVariance,
  calculateTheoreticalSalesVolumeMl,
  validateBarAuditActor,
  validateBarAuditSubscription,
} from "../src/liquorAudit.js";

const TEST_TENANT_ID = "tenant-bentota-resort-01";

const VALID_BARTENDER: BarAuditStaffActor = {
  userId: "user-bar-01",
  role: "BAR_MANAGER",
  name: "Roshan Bartender",
  tenantId: TEST_TENANT_ID,
};

const OLD_ARRACK_CONFIG: BarLiquorItemConfig = {
  liquorId: "liq-old-arrack-750",
  brandName: "DCSL Old Arrack 750ml",
  category: "ARRACK",
  bottleSizeMl: 750,
  bottleCostLkr: 3750, // 5 LKR per ml
  sellingPricePerSinglePegLkr: 350, // 350 LKR per 25ml single peg
  sellingPricePerDoublePegLkr: 650, // 650 LKR per 50ml double peg
  spillageAllowancePercent: 2.0,
};

const WHITE_RUM_CONFIG: BarLiquorItemConfig = {
  liquorId: "liq-rockland-rum-750",
  brandName: "Rockland White Rum 750ml",
  category: "RUM",
  bottleSizeMl: 750,
  bottleCostLkr: 4500, // 6 LKR per ml
  sellingPricePerSinglePegLkr: 400,
  sellingPricePerDoublePegLkr: 750,
  spillageAllowancePercent: 2.0,
};

describe("Step 385 & Step 386: Bar Liquor Shot / Peg Variance Auditor", () => {
  describe("1. Theoretical Sales Volume Calculations", () => {
    it("converts 30x 25ml single pegs into 750ml exact volume", () => {
      const volumeMl = calculateTheoreticalSalesVolumeMl({
        singlePegsSold: 30,
        doublePegsSold: 0,
        fullBottlesSold: 0,
        bottleSizeMl: 750,
      });

      assert.equal(volumeMl, 750);
    });

    it("converts 15x 50ml double pegs into 750ml exact volume", () => {
      const volumeMl = calculateTheoreticalSalesVolumeMl({
        singlePegsSold: 0,
        doublePegsSold: 15,
        fullBottlesSold: 0,
        bottleSizeMl: 750,
      });

      assert.equal(volumeMl, 750);
    });

    it("aggregates mixed sales: single pegs, double pegs, bottles, cocktails, and comps", () => {
      // 10 single pegs (250ml) + 4 double pegs (200ml) + 1 full bottle (750ml) + 120ml cocktails + 30ml promo
      const volumeMl = calculateTheoreticalSalesVolumeMl({
        singlePegsSold: 10,
        doublePegsSold: 4,
        fullBottlesSold: 1,
        bottleSizeMl: 750,
        cocktailPoursMl: 120,
        promotionalFreePoursMl: 30,
      });

      assert.equal(volumeMl, 1350);
    });
  });

  describe("2. Item-Level Peg Reconciliation (Old Arrack 750ml)", () => {
    it("evaluates a perfectly balanced shift with 0ml variance", () => {
      const stock: BarShiftStockInput = {
        liquorId: "liq-old-arrack-750",
        openingFullBottles: 1,
        openingOpenBottleMl: 0,
        receivedFullBottles: 0,
        closingFullBottles: 0,
        closingOpenBottleMl: 0,
      };

      const sales: BarPosSalesInput = {
        liquorId: "liq-old-arrack-750",
        singlePegsSold: 30, // 30 x 25ml = 750ml
        doublePegsSold: 0,
        fullBottlesSold: 0,
      };

      const result = calculateItemLiquorVariance(OLD_ARRACK_CONFIG, stock, sales);

      assert.equal(result.totalAvailableVolumeMl, 750);
      assert.equal(result.theoreticalSalesVolumeMl, 750);
      assert.equal(result.theoreticalClosingVolumeMl, 0);
      assert.equal(result.physicalClosingVolumeMl, 0);
      assert.equal(result.varianceVolumeMl, 0);
      assert.equal(result.variancePegs25ml, 0);
      assert.equal(result.costVarianceLkr, 0);
      assert.equal(result.retailRevenueVarianceLkr, 0);
      assert.equal(result.status, "BALANCED");
      assert.equal(result.isExcessiveShrinkage, false);
    });

    it("detects over-pouring / unbilled drinks (50ml shortage = 2 single pegs missing)", () => {
      const stock: BarShiftStockInput = {
        liquorId: "liq-old-arrack-750",
        openingFullBottles: 1, // 750ml
        openingOpenBottleMl: 0,
        receivedFullBottles: 0,
        closingFullBottles: 0,
        closingOpenBottleMl: 200, // Physical count: only 200ml left in bottle
      };

      const sales: BarPosSalesInput = {
        liquorId: "liq-old-arrack-750",
        singlePegsSold: 20, // 20 x 25ml = 500ml sold. Theoretical closing should be 250ml
        doublePegsSold: 0,
        fullBottlesSold: 0,
      };

      const result = calculateItemLiquorVariance(OLD_ARRACK_CONFIG, stock, sales);

      // 200ml physical vs 250ml theoretical = -50ml shortage
      assert.equal(result.varianceVolumeMl, -50);
      assert.equal(result.variancePegs25ml, -2);
      // Cost: 50ml * 5 LKR/ml = 250 LKR COGS loss
      assert.equal(result.costVarianceLkr, -250);
      // Retail: -2 pegs * 350 LKR = -700 LKR unbilled revenue
      assert.equal(result.retailRevenueVarianceLkr, -700);
      assert.equal(result.status, "OVER_POURED_OR_UNBILLED");
      assert.equal(result.isExcessiveShrinkage, true);
    });

    it("detects under-pouring / surplus (guest under-served)", () => {
      const stock: BarShiftStockInput = {
        liquorId: "liq-old-arrack-750",
        openingFullBottles: 1,
        openingOpenBottleMl: 0,
        receivedFullBottles: 0,
        closingFullBottles: 0,
        closingOpenBottleMl: 300, // Physical count: 300ml left
      };

      const sales: BarPosSalesInput = {
        liquorId: "liq-old-arrack-750",
        singlePegsSold: 20, // 500ml sold. Theoretical closing: 250ml
        doublePegsSold: 0,
        fullBottlesSold: 0,
      };

      const result = calculateItemLiquorVariance(OLD_ARRACK_CONFIG, stock, sales);

      // 300ml physical vs 250ml theoretical = +50ml surplus
      assert.equal(result.varianceVolumeMl, 50);
      assert.equal(result.variancePegs25ml, 2);
      assert.equal(result.status, "UNDER_POURED");
    });
  });

  describe("3. calculateLiquorVariance Full Shift Workflow", () => {
    it("successfully audits multiple bar spirits and returns a CLEAN_AUDIT verdict", () => {
      const input: CalculateLiquorVarianceInput = {
        tenantId: TEST_TENANT_ID,
        shiftId: "shift-evening-20261020",
        barLocation: "Pool & Lounge Bar",
        auditDate: "2026-10-20",
        liquorConfigs: [OLD_ARRACK_CONFIG, WHITE_RUM_CONFIG],
        stockInputs: [
          {
            liquorId: "liq-old-arrack-750",
            openingFullBottles: 2,
            openingOpenBottleMl: 250,
            receivedFullBottles: 1,
            closingFullBottles: 2,
            closingOpenBottleMl: 250,
          },
          {
            liquorId: "liq-rockland-rum-750",
            openingFullBottles: 1,
            openingOpenBottleMl: 0,
            receivedFullBottles: 0,
            closingFullBottles: 0,
            closingOpenBottleMl: 0,
          },
        ],
        salesInputs: [
          {
            liquorId: "liq-old-arrack-750",
            singlePegsSold: 10,
            doublePegsSold: 10, // 250 + 500 = 750ml (1 full bottle used)
            fullBottlesSold: 0,
          },
          {
            liquorId: "liq-rockland-rum-750",
            singlePegsSold: 0,
            doublePegsSold: 15, // 15 x 50ml = 750ml (1 bottle)
            fullBottlesSold: 0,
          },
        ],
        actor: VALID_BARTENDER,
      };

      const res = calculateLiquorVariance(input);
      assert.ok(res.ok);
      if (!res.ok) return;

      const { summary, itemVariances, auditEntry } = res.value;
      assert.equal(summary.totalAuditedItems, 2);
      assert.equal(summary.verdict, "CLEAN_AUDIT");
      assert.equal(summary.totalShrinkageCostLkr, 0);
      assert.equal(summary.totalRetailRevenueShortageLkr, 0);
      assert.equal(itemVariances.length, 2);
      assert.ok(auditEntry);
      assert.equal(auditEntry.action, "BAR_LIQUOR_AUDIT_COMPLETED");
      assert.equal(auditEntry.entryHash.length, 64);
    });

    it("flags DISCREPANCY_FLAGGED / INVESTIGATION_REQUIRED when excessive shrinkage occurs", () => {
      const input: CalculateLiquorVarianceInput = {
        tenantId: TEST_TENANT_ID,
        shiftId: "shift-night-leak",
        barLocation: "Beach Shack Bar",
        auditDate: "2026-10-20",
        liquorConfigs: [OLD_ARRACK_CONFIG],
        stockInputs: [
          {
            liquorId: "liq-old-arrack-750",
            openingFullBottles: 3, // 2250ml
            openingOpenBottleMl: 0,
            receivedFullBottles: 0,
            closingFullBottles: 0, // Only 0 full, 0 open left
            closingOpenBottleMl: 0,
          },
        ],
        salesInputs: [
          {
            liquorId: "liq-old-arrack-750",
            singlePegsSold: 10, // Only 250ml billed on POS
            doublePegsSold: 0,
            fullBottlesSold: 0,
          },
        ],
        actor: VALID_BARTENDER,
      };

      const res = calculateLiquorVariance(input);
      assert.ok(res.ok);
      if (!res.ok) return;

      const { summary } = res.value;
      assert.equal(summary.verdict, "INVESTIGATION_REQUIRED");
      assert.ok(summary.totalShrinkageCostLkr > 5000);
      assert.equal(summary.excessiveShrinkageCount, 1);
    });
  });

  describe("4. Security, Tenant Boundary & Entitlements", () => {
    it("rejects when actor tenantId does not match operation tenantId", () => {
      const foreignActor: BarAuditStaffActor = {
        userId: "hacker-bar-01",
        role: "BAR_MANAGER",
        tenantId: "foreign-resort-99",
      };

      const res = validateBarAuditActor(foreignActor, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "TENANT_MISMATCH");
    });

    it("rejects unauthorized staff role (e.g. HOUSEKEEPING_RUNNER)", () => {
      const unauthorizedActor: BarAuditStaffActor = {
        userId: "hk-runner-01",
        role: "HOUSEKEEPING_RUNNER",
        tenantId: TEST_TENANT_ID,
      };

      const res = validateBarAuditActor(unauthorizedActor, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "PERMISSION_DENIED");
    });

    it("rejects inactive SaaS subscription", () => {
      const sub = {
        tenantId: TEST_TENANT_ID,
        active: false,
      };

      const res = validateBarAuditSubscription(sub, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "SUBSCRIPTION_INACTIVE");
    });

    it("rejects subscription without bar auditing entitlement", () => {
      const sub = {
        tenantId: TEST_TENANT_ID,
        active: true,
        allowsBarAuditing: false,
        tier: "BASIC_ROOMS_ONLY",
      };

      const res = validateBarAuditSubscription(sub, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "PLAN_LIMITATION");
    });
  });
});
