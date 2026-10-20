/**
 * Unit Test Suite for Step 381 & Step 382: GRN Price-Spike & Variance Detector
 * (`packages/core/test/grnVariance.test.ts`)
 *
 * Validates:
 * 1. Pure comparator helper (isPriceSpike) for <=10% normal vs >10% spike
 * 2. Line item variance evaluation (exact match, short delivery, over delivery, rejections, price saving)
 * 3. Full GRN variance detection (detectGrnVariance):
 *    - Normal delivery vs 15% price spike vs short-delivery
 *    - Manager override authorization gate
 *    - Multi-tenant tenantId isolation & RBAC validation
 *    - SaasSubscription active & entitlement validation
 *    - SHA-256 hash-chained ImmutableAuditLog generation
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type DetectGrnVarianceInput,
  type GrnPoLineItem,
  type GrnReceivedLineItem,
  type GrnStaffActor,
  calculateLineItemVariance,
  detectGrnVariance,
  isPriceSpike,
  validateGrnSubscription,
  validateGrnVarianceActor,
} from "../src/grnVariance.js";

const TEST_TENANT_ID = "tenant-ceylon-heritage-01";

const VALID_ACTOR: GrnStaffActor = {
  userId: "user-store-01",
  role: "STORE_KEEPER",
  name: "Sunil Silva",
  tenantId: TEST_TENANT_ID,
};

const SAMPLE_PO_ITEMS: readonly GrnPoLineItem[] = [
  {
    stockItemId: "item-milk-01",
    sku: "FB-DAI-001",
    name: "Fresh Cow Milk 1L",
    category: "DAIRY",
    unitOfMeasure: "L",
    orderedQty: 50,
    agreedUnitCostLkr: 320,
    lastPurchaseCostLkr: 320,
    vatRatePercent: 0,
  },
  {
    stockItemId: "item-butter-02",
    sku: "FB-DAI-002",
    name: "Anchor Table Butter 227g",
    category: "DAIRY",
    unitOfMeasure: "pcs",
    orderedQty: 20,
    agreedUnitCostLkr: 950,
    lastPurchaseCostLkr: 950,
    vatRatePercent: 18,
  },
];

describe("Step 381 & Step 382: GRN Price-Spike & Variance Detector", () => {
  describe("1. isPriceSpike Comparator", () => {
    it("returns false when invoice cost matches agreed baseline", () => {
      const res = isPriceSpike(320, 320, 10);
      assert.equal(res.isSpike, false);
      assert.equal(res.varianceLkr, 0);
      assert.equal(res.variancePercent, 0);
    });

    it("returns false for price inflation within threshold (e.g. 5% and exact 10%)", () => {
      // 5% increase
      const res5 = isPriceSpike(336, 320, 10);
      assert.equal(res5.isSpike, false);
      assert.equal(res5.variancePercent, 5);

      // 10% exact boundary (not >10%)
      const res10 = isPriceSpike(352, 320, 10);
      assert.equal(res10.isSpike, false);
      assert.equal(res10.variancePercent, 10);
    });

    it("flags price spike when unit cost inflation exceeds 10% (e.g. 15% and 25%)", () => {
      // 15% jump: 320 * 1.15 = 368
      const res15 = isPriceSpike(368, 320, 10);
      assert.equal(res15.isSpike, true);
      assert.equal(res15.variancePercent, 15);
      assert.equal(res15.varianceLkr, 48);

      // 25% jump
      const res25 = isPriceSpike(400, 320, 10);
      assert.equal(res25.isSpike, true);
      assert.equal(res25.variancePercent, 25);
    });

    it("safely handles zero or negative baseline or invoice cost", () => {
      const zeroBase = isPriceSpike(100, 0);
      assert.equal(zeroBase.isSpike, false);
      assert.equal(zeroBase.variancePercent, 0);

      const zeroInvoice = isPriceSpike(0, 100);
      assert.equal(zeroInvoice.isSpike, false);
    });
  });

  describe("2. calculateLineItemVariance", () => {
    it("evaluates exact match accurately with zero variance and EXACT_MATCH flag", () => {
      const ordered = SAMPLE_PO_ITEMS[0];
      const delivered: GrnReceivedLineItem = {
        stockItemId: "item-milk-01",
        sku: "FB-DAI-001",
        deliveredQty: 50,
        acceptedQty: 50,
        rejectedQty: 0,
        invoiceUnitCostLkr: 320,
      };

      const result = calculateLineItemVariance(ordered, delivered);

      assert.equal(result.quantityVariance, 0);
      assert.equal(result.isShortDelivery, false);
      assert.equal(result.isOverDelivery, false);
      assert.equal(result.isPriceSpike, false);
      assert.deepEqual(result.flags, ["EXACT_MATCH"]);
      assert.equal(result.acceptedTotalLkr, 16000);
      assert.equal(result.costVarianceLkr, 0);
    });

    it("evaluates short-delivery (ordered 50, accepted 40) with SHORT_DELIVERY flag", () => {
      const ordered = SAMPLE_PO_ITEMS[0];
      const delivered: GrnReceivedLineItem = {
        stockItemId: "item-milk-01",
        sku: "FB-DAI-001",
        deliveredQty: 40,
        acceptedQty: 40,
        rejectedQty: 0,
        invoiceUnitCostLkr: 320,
      };

      const result = calculateLineItemVariance(ordered, delivered);

      assert.equal(result.quantityVariance, -10);
      assert.equal(result.quantityVariancePercent, -20);
      assert.equal(result.isShortDelivery, true);
      assert.ok(result.flags.includes("SHORT_DELIVERY"));
    });

    it("evaluates over-delivery (ordered 20, accepted 25) with OVER_DELIVERY flag", () => {
      const ordered = SAMPLE_PO_ITEMS[1];
      const delivered: GrnReceivedLineItem = {
        stockItemId: "item-butter-02",
        sku: "FB-DAI-002",
        deliveredQty: 25,
        acceptedQty: 25,
        rejectedQty: 0,
        invoiceUnitCostLkr: 950,
        vatRatePercent: 18,
      };

      const result = calculateLineItemVariance(ordered, delivered);

      assert.equal(result.quantityVariance, 5);
      assert.equal(result.quantityVariancePercent, 25);
      assert.equal(result.isOverDelivery, true);
      assert.ok(result.flags.includes("OVER_DELIVERY"));
    });

    it("evaluates quality rejection (10 damaged pots) with QUALITY_REJECTION flag", () => {
      const ordered = SAMPLE_PO_ITEMS[0];
      const delivered: GrnReceivedLineItem = {
        stockItemId: "item-milk-01",
        sku: "FB-DAI-001",
        deliveredQty: 50,
        acceptedQty: 40,
        rejectedQty: 10,
        rejectionReason: "DAMAGED",
        invoiceUnitCostLkr: 320,
      };

      const result = calculateLineItemVariance(ordered, delivered);

      assert.equal(result.rejectedQty, 10);
      assert.equal(result.rejectionReason, "DAMAGED");
      assert.ok(result.flags.includes("QUALITY_REJECTION"));
    });

    it("flags PRICE_SAVING when invoice unit cost is lower than PO", () => {
      const ordered = SAMPLE_PO_ITEMS[0];
      const delivered: GrnReceivedLineItem = {
        stockItemId: "item-milk-01",
        sku: "FB-DAI-001",
        deliveredQty: 50,
        acceptedQty: 50,
        invoiceUnitCostLkr: 300, // 20 LKR cheaper
      };

      const result = calculateLineItemVariance(ordered, delivered);

      assert.ok(result.flags.includes("PRICE_SAVING"));
      assert.equal(result.unitCostVarianceLkr, -20);
    });

    it("flags UNORDERED_ITEM when delivered stock item has no matching PO line", () => {
      const delivered: GrnReceivedLineItem = {
        stockItemId: "item-unknown-99",
        sku: "FB-EXT-099",
        deliveredQty: 5,
        acceptedQty: 5,
        invoiceUnitCostLkr: 500,
      };

      const result = calculateLineItemVariance(undefined, delivered);

      assert.ok(result.flags.includes("UNORDERED_ITEM"));
      assert.equal(result.orderedQty, 0);
    });
  });

  describe("3. detectGrnVariance Full GRN Workflow", () => {
    it("approves normal delivery with full quantities and agreed prices", () => {
      const input: DetectGrnVarianceInput = {
        tenantId: TEST_TENANT_ID,
        grnNumber: "GRN-202610-0001",
        poNumber: "PO-202610-0001",
        supplierId: "sup-dairy-01",
        supplierName: "Lanka Fresh Dairy",
        supplierInvoiceNumber: "INV-8899",
        orderedItems: SAMPLE_PO_ITEMS,
        deliveredItems: [
          {
            stockItemId: "item-milk-01",
            sku: "FB-DAI-001",
            deliveredQty: 50,
            acceptedQty: 50,
            invoiceUnitCostLkr: 320,
          },
          {
            stockItemId: "item-butter-02",
            sku: "FB-DAI-002",
            deliveredQty: 20,
            acceptedQty: 20,
            invoiceUnitCostLkr: 950,
            vatRatePercent: 18,
          },
        ],
        actor: VALID_ACTOR,
      };

      const result = detectGrnVariance(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { summary } = result.value;
      assert.equal(summary.verdict, "APPROVED_MATCH");
      assert.equal(summary.hasPriceSpikes, false);
      assert.equal(summary.hasShortDeliveries, false);
      assert.equal(summary.hasRejections, false);
      assert.equal(summary.requiresManagerApproval, false);
      assert.equal(summary.totalAcceptedQty, 70);
      assert.equal(summary.priceSpikeCount, 0);
    });

    it("detects short-delivery and returns SHORT_DELIVERY_CONFIRMED", () => {
      const input: DetectGrnVarianceInput = {
        tenantId: TEST_TENANT_ID,
        grnNumber: "GRN-202610-0002",
        poNumber: "PO-202610-0001",
        supplierId: "sup-dairy-01",
        supplierName: "Lanka Fresh Dairy",
        supplierInvoiceNumber: "INV-8900",
        orderedItems: SAMPLE_PO_ITEMS,
        deliveredItems: [
          {
            stockItemId: "item-milk-01",
            sku: "FB-DAI-001",
            deliveredQty: 30, // 20 short
            acceptedQty: 30,
            invoiceUnitCostLkr: 320,
          },
        ],
        actor: VALID_ACTOR,
      };

      const result = detectGrnVariance(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { summary, auditEntry } = result.value;
      assert.equal(summary.verdict, "SHORT_DELIVERY_CONFIRMED");
      assert.equal(summary.hasShortDeliveries, true);
      assert.equal(summary.shortDeliveryCount, 1);
      assert.ok(auditEntry, "Audit entry generated for short delivery");
    });

    it("flags 15% price spike and requires manager override", () => {
      const input: DetectGrnVarianceInput = {
        tenantId: TEST_TENANT_ID,
        grnNumber: "GRN-202610-0003",
        poNumber: "PO-202610-0001",
        supplierId: "sup-dairy-01",
        supplierName: "Lanka Fresh Dairy",
        supplierInvoiceNumber: "INV-8901",
        orderedItems: SAMPLE_PO_ITEMS,
        deliveredItems: [
          {
            stockItemId: "item-milk-01",
            sku: "FB-DAI-001",
            deliveredQty: 50,
            acceptedQty: 50,
            invoiceUnitCostLkr: 368, // 15% price spike (320 * 1.15)
          },
        ],
        actor: VALID_ACTOR,
      };

      const result = detectGrnVariance(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { summary } = result.value;
      assert.equal(summary.verdict, "REQUIRES_MANAGER_OVERRIDE");
      assert.equal(summary.hasPriceSpikes, true);
      assert.equal(summary.priceSpikeCount, 1);
      assert.equal(summary.requiresManagerApproval, true);
    });

    it("approves price spike when valid manager override is provided", () => {
      const input: DetectGrnVarianceInput = {
        tenantId: TEST_TENANT_ID,
        grnNumber: "GRN-202610-0004",
        poNumber: "PO-202610-0001",
        supplierId: "sup-dairy-01",
        supplierName: "Lanka Fresh Dairy",
        supplierInvoiceNumber: "INV-8902",
        orderedItems: SAMPLE_PO_ITEMS,
        deliveredItems: [
          {
            stockItemId: "item-milk-01",
            sku: "FB-DAI-001",
            deliveredQty: 50,
            acceptedQty: 50,
            invoiceUnitCostLkr: 368, // 15% price spike
          },
        ],
        managerOverride: {
          approvedByUserId: "mgr-01",
          approvalRole: "FINANCE_CONTROLLER",
          reason: "Emergency island-wide fresh milk supply shortage approved by GM",
        },
        actor: VALID_ACTOR,
      };

      const result = detectGrnVariance(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { summary, auditEntry } = result.value;
      assert.equal(summary.verdict, "MANAGER_APPROVED_OVERRIDE");
      assert.equal(summary.requiresManagerApproval, false);
      assert.ok(auditEntry);
      assert.equal(auditEntry.action, "GRN_VARIANCE_INSPECTED");
      assert.ok(auditEntry.entryHash.length === 64);
    });

    it("marks delivery as DISPUTED_DELIVERY when items are rejected", () => {
      const input: DetectGrnVarianceInput = {
        tenantId: TEST_TENANT_ID,
        grnNumber: "GRN-202610-0005",
        poNumber: "PO-202610-0001",
        supplierId: "sup-dairy-01",
        supplierName: "Lanka Fresh Dairy",
        supplierInvoiceNumber: "INV-8903",
        orderedItems: SAMPLE_PO_ITEMS,
        deliveredItems: [
          {
            stockItemId: "item-milk-01",
            sku: "FB-DAI-001",
            deliveredQty: 50,
            acceptedQty: 35,
            rejectedQty: 15,
            rejectionReason: "SUBSTANDARD_QUALITY",
            invoiceUnitCostLkr: 320,
          },
        ],
        actor: VALID_ACTOR,
      };

      const result = detectGrnVariance(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const { summary } = result.value;
      assert.equal(summary.verdict, "DISPUTED_DELIVERY");
      assert.equal(summary.hasRejections, true);
      assert.equal(summary.rejectedItemCount, 1);
    });
  });

  describe("4. Security, Tenant Isolation & Entitlements", () => {
    it("rejects when actor tenant does not match operation tenant", () => {
      const foreignActor: GrnStaffActor = {
        userId: "hacker-01",
        role: "STORE_KEEPER",
        tenantId: "other-resort-99",
      };

      const res = validateGrnVarianceActor(foreignActor, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "TENANT_MISMATCH");
    });

    it("rejects unauthorized staff roles for receiving store inventory", () => {
      const waiterActor: GrnStaffActor = {
        userId: "waiter-01",
        role: "RESTAURANT_WAITER",
        tenantId: TEST_TENANT_ID,
      };

      const res = validateGrnVarianceActor(waiterActor, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "PERMISSION_DENIED");
    });

    it("rejects inactive SaaS subscription", () => {
      const sub = {
        tenantId: TEST_TENANT_ID,
        active: false,
      };

      const res = validateGrnSubscription(sub, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "SUBSCRIPTION_INACTIVE");
    });

    it("rejects subscription without procurement entitlement", () => {
      const sub = {
        tenantId: TEST_TENANT_ID,
        active: true,
        allowsProcurement: false,
        tier: "STARTER",
      };

      const res = validateGrnSubscription(sub, TEST_TENANT_ID);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.equal(res.error.code, "PLAN_LIMITATION");
    });
  });
});
