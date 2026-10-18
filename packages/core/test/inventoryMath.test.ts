import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateRecipeFoodCost,
  createInventoryDeductionAuditEntry,
  deductFifoBatches,
} from "../src/inventoryMath.js";

describe("FIFO Inventory Batch Deduction & Recipe BOM Costing Engine (inventoryMath.ts)", () => {
  const TEST_TENANT = "amanwella-tangalle";

  describe("deductFifoBatches", () => {
    it("depletes oldest batches first according to chronological FIFO order", () => {
      const batches = [
        {
          batchId: "BATCH-SEP-10",
          receivedAtIso: "2026-09-10T08:00:00.000Z",
          initialQty: 20,
          remainingQty: 20,
          unitCostLkr: 550, // 550 LKR/kg
        },
        {
          batchId: "BATCH-SEP-01",
          receivedAtIso: "2026-09-01T08:00:00.000Z",
          initialQty: 10,
          remainingQty: 10,
          unitCostLkr: 500, // 500 LKR/kg
        },
      ];

      // Required: 15 units
      const res = deductFifoBatches(batches, 15, { reorderThreshold: 10 });
      assert.equal(res.ok, true);
      if (!res.ok) return;

      const result = res.value;
      assert.equal(result.totalDeductedQty, 15);
      // 10 units @ 500 = 5000 + 5 units @ 550 = 2750 -> 7750 LKR
      assert.equal(result.totalCogsLkr, 7750);
      assert.equal(result.remainingTotalQty, 15);
      assert.equal(result.exhaustedBatchIds.length, 1);
      assert.equal(result.exhaustedBatchIds[0], "BATCH-SEP-01");

      assert.equal(result.allocations.length, 2);
      assert.equal(result.allocations[0]?.batchId, "BATCH-SEP-01");
      assert.equal(result.allocations[0]?.deductedQty, 10);
      assert.equal(result.allocations[0]?.costLkr, 5000);

      assert.equal(result.allocations[1]?.batchId, "BATCH-SEP-10");
      assert.equal(result.allocations[1]?.deductedQty, 5);
      assert.equal(result.allocations[1]?.costLkr, 2750);

      // Remaining 15 > reorderThreshold 10 -> not low stock
      assert.equal(result.isLowStock, false);
    });

    it("triggers low-stock alert when remaining inventory reaches reorder threshold", () => {
      const batches = [
        {
          batchId: "BATCH-01",
          receivedAtIso: "2026-09-01T00:00:00.000Z",
          initialQty: 10,
          remainingQty: 10,
          unitCostLkr: 100,
        },
      ];

      const res = deductFifoBatches(batches, 8, { reorderThreshold: 5 });
      assert.equal(res.ok, true);
      if (!res.ok) return;

      assert.equal(res.value.remainingTotalQty, 2);
      assert.equal(res.value.isLowStock, true); // 2 <= 5
    });

    it("rejects request when insufficient inventory stock is available", () => {
      const batches = [
        {
          batchId: "BATCH-01",
          receivedAtIso: "2026-09-01T00:00:00.000Z",
          initialQty: 5,
          remainingQty: 5,
          unitCostLkr: 100,
        },
      ];

      const res = deductFifoBatches(batches, 10);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "VALIDATION_FAILED");
      }
    });
  });

  describe("calculateRecipeFoodCost", () => {
    it("calculates exact portion food cost and COGS for multi-ingredient BOM recipe", () => {
      const stockMap = {
        "ING-ARRACK": {
          ingredientId: "ING-ARRACK",
          availableQty: 10,
          reorderThreshold: 2,
          batches: [
            {
              batchId: "BATCH-ARRACK-01",
              receivedAtIso: "2026-09-01T00:00:00.000Z",
              initialQty: 10,
              remainingQty: 10,
              unitCostLkr: 3500, // 3,500 LKR per liter
            },
          ],
        },
        "ING-LIME": {
          ingredientId: "ING-LIME",
          availableQty: 5,
          reorderThreshold: 1,
          batches: [
            {
              batchId: "BATCH-LIME-01",
              receivedAtIso: "2026-09-01T00:00:00.000Z",
              initialQty: 5,
              remainingQty: 5,
              unitCostLkr: 400, // 400 LKR per kg
            },
          ],
        },
      };

      const res = calculateRecipeFoodCost(
        "RECIPE-CEYLON-PUNCH",
        "Ceylon Arrack Punch",
        2, // 2 cocktail portions
        [
          {
            ingredientId: "ING-ARRACK",
            ingredientName: "Old Reserve Arrack",
            quantityRequired: 0.1, // 0.1L per portion
            unitOfMeasure: "liters",
          },
          {
            ingredientId: "ING-LIME",
            ingredientName: "Fresh Kaffir Lime",
            quantityRequired: 0.05, // 0.05kg per portion
            unitOfMeasure: "kg",
          },
        ],
        stockMap,
      );

      assert.equal(res.ok, true);
      if (!res.ok) return;

      const cost = res.value;
      assert.equal(cost.portions, 2);
      // Arrack: 2 * 0.1 = 0.2L * 3500 = 700 LKR
      // Lime: 2 * 0.05 = 0.1kg * 400 = 40 LKR
      // Total = 740 LKR
      assert.equal(cost.totalCostLkr, 740);
      assert.equal(cost.costPerPortionLkr, 370);
      assert.equal(cost.hasLowStockAlert, false);
      assert.equal(cost.lines.length, 2);
    });

    it("creates cryptographically chained audit log for inventory deduction", () => {
      const deductionRes = deductFifoBatches(
        [
          {
            batchId: "BATCH-01",
            receivedAtIso: "2026-09-01T00:00:00.000Z",
            initialQty: 10,
            remainingQty: 10,
            unitCostLkr: 250,
          },
        ],
        5,
      );

      assert.equal(deductionRes.ok, true);
      if (!deductionRes.ok) return;

      const auditRes = createInventoryDeductionAuditEntry(
        TEST_TENANT,
        "actor-executive-chef",
        "ITEM-CHICKEN-BREAST",
        deductionRes.value,
        "2026-10-18T17:02:00.000Z",
      );

      assert.equal(auditRes.ok, true);
      if (!auditRes.ok) return;

      const audit = auditRes.value;
      assert.equal(audit.tenantId, TEST_TENANT);
      assert.equal(audit.action, "FIFO_INVENTORY_DEDUCTION");
      assert.equal(audit.entityType, "InventoryItem");
      assert.equal(audit.entityId, "ITEM-CHICKEN-BREAST");
      assert.equal(audit.entryHash.length, 64);
    });
  });
});
