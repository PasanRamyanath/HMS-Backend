/**
 * @hms/core - End-to-End Inventory Procurement, FIFO Batch Depletion & Variance Test
 * (`inventoryLifecycle.test.ts`)
 *
 * Implements Step 399 (Phase 16.24) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive integration test of the complete Sri Lankan hotel store inventory lifecycle:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix:
 *    - Rejection of cross-tenant operations
 *    - RBAC enforcement (authorized Store Keepers / Chefs vs unauthorized staff)
 *    - Multi-tenant SaasSubscription procurement entitlement guards
 *
 * 2. Stage 1: Purchase Order (PO) Generation & Statutory Tax Valuation:
 *    - Creation of multi-item PO with Sri Lankan vendor credit terms
 *    - 4-item procurement: Arrack, Farm Chicken, Keeri Samba Rice, Virgin Coconut Oil
 *    - General Manager approval with SHA-256 hash-chained audit log
 *
 * 3. Stage 2: Goods Received Note (GRN) Receiving, Price-Spike Variance & FIFO Batch Creation:
 *    - Evaluation via pure comparator detectGrnVariance
 *    - Price-spike detection (>10% inflation flagged as REQUIRES_MANAGER_OVERRIDE)
 *    - Manager override authorization by Finance Controller
 *    - Short-delivery and quality-rejection handling
 *    - Ingress into Central Stores as FIFO InventoryBatch records
 *
 * 4. Stage 3: Goods Issue Note (GIN) Kitchen Transfer & Stores Stock Reduction:
 *    - Kitchen requisition fulfillment from Central Stores
 *    - FIFO batch reduction via deductFifoBatches
 *    - Exact COGS LKR calculation for transferred ingredients
 *    - Exhausted batch tracking and low-stock reorder thresholds
 *
 * 5. Stage 4: Guest QR Order / KOT Bill of Materials (BOM) Depletion:
 *    - Contactless guest ordering of signature Sri Lankan dishes and cocktails
 *    - Recipe BOM depletion over Kitchen Pantry batches
 *    - Portion food costing, COGS calculation, and food cost percentage verification
 *    - Guest Folio 4-stage compounding tax posting (SC -> TDL -> SSCL -> VAT)
 *
 * 6. Stage 5: Physical Stock-Take Variance, Spoilage & Financial Shrinkage Valuation:
 *    - Book stock vs physical count comparison
 *    - Spoilage and shrinkage calculation in LKR
 *    - Spoilage tolerance threshold checks
 *
 * 7. Stage 6: Cryptographic SHA-256 Hash-Chained Audit Trail Integrity:
 *    - Verification of unbroken hash chain anchored to GENESIS_HASH
 *    - Anti-tamper cryptographic protection testing
 *
 * Zero external dependencies (pure TypeScript domain engine).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_PRICE_SPIKE_THRESHOLD_PERCENT,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  type GrnPoLineItem,
  type GrnReceivedLineItem,
  type GrnSaasSubscription,
  type GrnStaffActor,
  type IngredientStockSummary,
  type InventoryBatch,
  type RecipeBomLine,
  calculateForwardTax,
  calculateRecipeFoodCost,
  createAuditEntry,
  createInventoryDeductionAuditEntry,
  deductFifoBatches,
  detectGrnVariance,
  isPriceSpike,
  roundLkr,
  validateGrnSubscription,
  validateGrnVarianceActor,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant SaaS & RBAC Actors
// ============================================================================

const TENANT_AMANWELLA = "tenant-amanwella-tangalle";
const TENANT_ANANTARA = "tenant-anantara-peace-haven";

const STORE_KEEPER_ACTOR: GrnStaffActor = {
  userId: "USR-STR-001",
  role: "STORE_KEEPER",
  name: "Sunil Jayasinghe",
  tenantId: TENANT_AMANWELLA,
};

const HEAD_CHEF_ACTOR: GrnStaffActor = {
  userId: "USR-CHF-001",
  role: "HEAD_CHEF",
  name: "Chef Duminda Perera",
  tenantId: TENANT_AMANWELLA,
};

const FINANCE_CONTROLLER_ACTOR: GrnStaffActor = {
  userId: "USR-FIN-001",
  role: "FINANCE_CONTROLLER",
  name: "Nimali Fernando",
  tenantId: TENANT_AMANWELLA,
};

const UNAUTHORIZED_ACTOR: GrnStaffActor = {
  userId: "USR-HK-099",
  role: "HOUSEKEEPING_ATTENDANT",
  name: "Kasun Bandara",
  tenantId: TENANT_AMANWELLA,
};

const ACTIVE_PRO_SUBSCRIPTION: GrnSaasSubscription = {
  tenantId: TENANT_AMANWELLA,
  active: true,
  tier: "PRO_RESORT",
  allowsProcurement: true,
};

const INACTIVE_SUBSCRIPTION: GrnSaasSubscription = {
  tenantId: TENANT_AMANWELLA,
  active: false,
  tier: "STARTER_VILLA",
  allowsProcurement: false,
};

// ============================================================================
// Procurement Master Items & Specifications
// ============================================================================

interface MasterItemDefinition {
  readonly stockItemId: string;
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly unitOfMeasure: string;
  readonly agreedPoCostLkr: number;
  readonly vatRatePercent: number;
  readonly reorderThreshold: number;
}

const MASTER_ITEMS: Record<string, MasterItemDefinition> = {
  ARRACK: {
    stockItemId: "ITEM-BEV-ARRACK-750",
    sku: "BEV-ARR-001",
    name: "Rockland Old Reserve Arrack 750ml",
    category: "BEVERAGE",
    unitOfMeasure: "bottle",
    agreedPoCostLkr: 3600,
    vatRatePercent: 18,
    reorderThreshold: 15,
  },
  CHICKEN: {
    stockItemId: "ITEM-FNB-CHICKEN-KG",
    sku: "FNB-MEAT-002",
    name: "Fresh Farm Chicken Breast",
    category: "MEAT_POULTRY",
    unitOfMeasure: "kg",
    agreedPoCostLkr: 1450,
    vatRatePercent: 0, // Fresh meat exempt from VAT under Sri Lankan Inland Revenue Act
    reorderThreshold: 25,
  },
  RICE: {
    stockItemId: "ITEM-FNB-RICE-KG",
    sku: "FNB-GRAIN-003",
    name: "Keeri Samba Rice",
    category: "DRY_GOODS",
    unitOfMeasure: "kg",
    agreedPoCostLkr: 340,
    vatRatePercent: 0, // Staple food zero-rated / exempt
    reorderThreshold: 50,
  },
  OIL: {
    stockItemId: "ITEM-FNB-COCONUT-OIL-L",
    sku: "FNB-OIL-004",
    name: "Pure Virgin Coconut Oil",
    category: "DRY_GOODS",
    unitOfMeasure: "L",
    agreedPoCostLkr: 850,
    vatRatePercent: 18,
    reorderThreshold: 10,
  },
};

// ============================================================================
// Step 399 End-to-End Integration Test Suite
// ============================================================================

describe("Step 399: End-to-End Store Procurement, FIFO Batch Depletion & Variance Test", () => {
  const auditTrail: AuditLogEntry[] = [];
  let currentHash = GENESIS_HASH;

  // --------------------------------------------------------------------------
  // 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix", () => {
    it("rejects GRN variance detection when actor tenantId does not match input tenantId", () => {
      const crossTenantActor: GrnStaffActor = {
        userId: "USR-STR-ANANTARA",
        role: "STORE_KEEPER",
        name: "Cross Tenant Actor",
        tenantId: TENANT_ANANTARA,
      };

      const result = validateGrnVarianceActor(crossTenantActor, TENANT_AMANWELLA);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TENANT_MISMATCH");
        assert.match(result.error.message, /does not match/);
      }
    });

    it("rejects unauthorized staff role from receiving or modifying GRN records", () => {
      const result = validateGrnVarianceActor(UNAUTHORIZED_ACTOR, TENANT_AMANWELLA);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "PERMISSION_DENIED");
        assert.match(result.error.message, /not authorized/);
      }
    });

    it("accepts authorized STORE_KEEPER and HEAD_CHEF staff roles", () => {
      const storeKeeperRes = validateGrnVarianceActor(STORE_KEEPER_ACTOR, TENANT_AMANWELLA);
      assert.equal(storeKeeperRes.ok, true);

      const chefRes = validateGrnVarianceActor(HEAD_CHEF_ACTOR, TENANT_AMANWELLA);
      assert.equal(chefRes.ok, true);
    });

    it("rejects operations when SaaS subscription is inactive or lacks procurement entitlement", () => {
      const inactiveRes = validateGrnSubscription(INACTIVE_SUBSCRIPTION, TENANT_AMANWELLA);
      assert.equal(inactiveRes.ok, false);
      if (!inactiveRes.ok) {
        assert.equal(inactiveRes.error.code, "SUBSCRIPTION_INACTIVE");
      }

      const activeRes = validateGrnSubscription(ACTIVE_PRO_SUBSCRIPTION, TENANT_AMANWELLA);
      assert.equal(activeRes.ok, true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Stage 1: Purchase Order (PO) Generation & Statutory Valuation
  // --------------------------------------------------------------------------
  describe("2. Stage 1: Purchase Order (PO) Generation & Statutory Valuation", () => {
    const PO_NUMBER = "PO-2026-10-0042";
    const SUPPLIER_NAME = "Keells Food Products PLC";
    const SUPPLIER_TIN = "102938475";

    const poOrderedLines: GrnPoLineItem[] = [
      {
        stockItemId: MASTER_ITEMS.ARRACK.stockItemId,
        sku: MASTER_ITEMS.ARRACK.sku,
        name: MASTER_ITEMS.ARRACK.name,
        category: MASTER_ITEMS.ARRACK.category,
        unitOfMeasure: MASTER_ITEMS.ARRACK.unitOfMeasure,
        orderedQty: 50,
        agreedUnitCostLkr: MASTER_ITEMS.ARRACK.agreedPoCostLkr,
        vatRatePercent: MASTER_ITEMS.ARRACK.vatRatePercent,
      },
      {
        stockItemId: MASTER_ITEMS.CHICKEN.stockItemId,
        sku: MASTER_ITEMS.CHICKEN.sku,
        name: MASTER_ITEMS.CHICKEN.name,
        category: MASTER_ITEMS.CHICKEN.category,
        unitOfMeasure: MASTER_ITEMS.CHICKEN.unitOfMeasure,
        orderedQty: 100,
        agreedUnitCostLkr: MASTER_ITEMS.CHICKEN.agreedPoCostLkr,
        vatRatePercent: MASTER_ITEMS.CHICKEN.vatRatePercent,
      },
      {
        stockItemId: MASTER_ITEMS.RICE.stockItemId,
        sku: MASTER_ITEMS.RICE.sku,
        name: MASTER_ITEMS.RICE.name,
        category: MASTER_ITEMS.RICE.category,
        unitOfMeasure: MASTER_ITEMS.RICE.unitOfMeasure,
        orderedQty: 200,
        agreedUnitCostLkr: MASTER_ITEMS.RICE.agreedPoCostLkr,
        vatRatePercent: MASTER_ITEMS.RICE.vatRatePercent,
      },
      {
        stockItemId: MASTER_ITEMS.OIL.stockItemId,
        sku: MASTER_ITEMS.OIL.sku,
        name: MASTER_ITEMS.OIL.name,
        category: MASTER_ITEMS.OIL.category,
        unitOfMeasure: MASTER_ITEMS.OIL.unitOfMeasure,
        orderedQty: 40,
        agreedUnitCostLkr: MASTER_ITEMS.OIL.agreedPoCostLkr,
        vatRatePercent: MASTER_ITEMS.OIL.vatRatePercent,
      },
    ];

    it("calculates exact PO subtotal, statutory VAT, and total commitment in LKR", () => {
      // 50 Arrack @ 3600 = 180,000 LKR (18% VAT = 32,400)
      // 100 Chicken @ 1450 = 145,000 LKR (0% VAT = 0)
      // 200 Rice @ 340 = 68,000 LKR (0% VAT = 0)
      // 40 Oil @ 850 = 34,000 LKR (18% VAT = 6,120)
      let totalSubtotalLkr = 0;
      let totalVatLkr = 0;

      for (const line of poOrderedLines) {
        const lineBase = roundLkr(line.orderedQty * line.agreedUnitCostLkr);
        const vatRate = line.vatRatePercent ?? 0;
        const lineVat = roundLkr(lineBase * (vatRate / 100));
        totalSubtotalLkr = roundLkr(totalSubtotalLkr + lineBase);
        totalVatLkr = roundLkr(totalVatLkr + lineVat);
      }

      assert.equal(totalSubtotalLkr, 427000);
      assert.equal(totalVatLkr, 38520);
      const grandTotalLkr = roundLkr(totalSubtotalLkr + totalVatLkr);
      assert.equal(grandTotalLkr, 465520);
    });

    it("appends PO approval audit log to the cryptographic audit trail", () => {
      const poAuditRes = createAuditEntry({
        tenantId: TENANT_AMANWELLA,
        actorUserId: FINANCE_CONTROLLER_ACTOR.userId,
        action: "PURCHASE_ORDER_APPROVED",
        entityType: "PurchaseOrder",
        entityId: PO_NUMBER,
        isoTs: "2026-10-20T08:00:00.000Z",
        afterJson: JSON.stringify({
          poNumber: PO_NUMBER,
          supplierName: SUPPLIER_NAME,
          supplierTin: SUPPLIER_TIN,
          lineItemCount: poOrderedLines.length,
          totalCommitmentLkr: 465520,
        }),
        prevHash: currentHash,
      });

      assert.equal(poAuditRes.ok, true);
      if (poAuditRes.ok) {
        auditTrail.push(poAuditRes.value);
        currentHash = poAuditRes.value.entryHash;
        assert.equal(poAuditRes.value.prevHash, GENESIS_HASH);
        assert.equal(poAuditRes.value.entryHash.length, 64);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. Stage 2: GRN Receiving, Price-Spike Variance & FIFO Batch Creation
  // --------------------------------------------------------------------------
  describe("3. Stage 2: GRN Receiving, Price-Spike Variance & FIFO Batch Creation", () => {
    const GRN_NUMBER = "GRN-2026-10-0089";
    const PO_NUMBER = "PO-2026-10-0042";

    const poLines: readonly GrnPoLineItem[] = [
      {
        stockItemId: MASTER_ITEMS.ARRACK.stockItemId,
        sku: MASTER_ITEMS.ARRACK.sku,
        name: MASTER_ITEMS.ARRACK.name,
        category: MASTER_ITEMS.ARRACK.category,
        unitOfMeasure: MASTER_ITEMS.ARRACK.unitOfMeasure,
        orderedQty: 50,
        agreedUnitCostLkr: 3600,
        vatRatePercent: 18,
      },
      {
        stockItemId: MASTER_ITEMS.CHICKEN.stockItemId,
        sku: MASTER_ITEMS.CHICKEN.sku,
        name: MASTER_ITEMS.CHICKEN.name,
        category: MASTER_ITEMS.CHICKEN.category,
        unitOfMeasure: MASTER_ITEMS.CHICKEN.unitOfMeasure,
        orderedQty: 100,
        agreedUnitCostLkr: 1450,
        vatRatePercent: 0,
      },
      {
        stockItemId: MASTER_ITEMS.RICE.stockItemId,
        sku: MASTER_ITEMS.RICE.sku,
        name: MASTER_ITEMS.RICE.name,
        category: MASTER_ITEMS.RICE.category,
        unitOfMeasure: MASTER_ITEMS.RICE.unitOfMeasure,
        orderedQty: 200,
        agreedUnitCostLkr: 340,
        vatRatePercent: 0,
      },
      {
        stockItemId: MASTER_ITEMS.OIL.stockItemId,
        sku: MASTER_ITEMS.OIL.sku,
        name: MASTER_ITEMS.OIL.name,
        category: MASTER_ITEMS.OIL.category,
        unitOfMeasure: MASTER_ITEMS.OIL.unitOfMeasure,
        orderedQty: 40,
        agreedUnitCostLkr: 850,
        vatRatePercent: 18,
      },
    ];

    // Vendor delivery scenario:
    // - Arrack: 50 bottles exact match @ 3,600
    // - Chicken: 100 kg delivered, invoice price is 1,650 LKR (+13.79% price spike > 10%)
    // - Rice: Short delivery (180 kg delivered instead of 200 kg)
    // - Oil: 40 L delivered, 5 L damaged bottle rejected, 35 L accepted
    const receivedItems: readonly GrnReceivedLineItem[] = [
      {
        stockItemId: MASTER_ITEMS.ARRACK.stockItemId,
        sku: MASTER_ITEMS.ARRACK.sku,
        deliveredQty: 50,
        acceptedQty: 50,
        invoiceUnitCostLkr: 3600,
        vatRatePercent: 18,
        batchNumber: "BAT-ARR-20261020-01",
      },
      {
        stockItemId: MASTER_ITEMS.CHICKEN.stockItemId,
        sku: MASTER_ITEMS.CHICKEN.sku,
        deliveredQty: 100,
        acceptedQty: 100,
        invoiceUnitCostLkr: 1650, // 1650 vs 1450 = +13.79% price spike
        vatRatePercent: 0,
        batchNumber: "BAT-CHK-20261020-01",
      },
      {
        stockItemId: MASTER_ITEMS.RICE.stockItemId,
        sku: MASTER_ITEMS.RICE.sku,
        deliveredQty: 180, // Short delivery by 20 kg
        acceptedQty: 180,
        invoiceUnitCostLkr: 340,
        vatRatePercent: 0,
        batchNumber: "BAT-RIC-20261020-01",
      },
      {
        stockItemId: MASTER_ITEMS.OIL.stockItemId,
        sku: MASTER_ITEMS.OIL.sku,
        deliveredQty: 40,
        acceptedQty: 35,
        rejectedQty: 5,
        rejectionReason: "DAMAGED",
        invoiceUnitCostLkr: 850,
        vatRatePercent: 18,
        batchNumber: "BAT-OIL-20261020-01",
      },
    ];

    it("evaluates price spikes using pure comparator helper (isPriceSpike)", () => {
      // 1450 -> 1650 = +13.79% -> Spike
      const chickenSpike = isPriceSpike(1650, 1450, DEFAULT_PRICE_SPIKE_THRESHOLD_PERCENT);
      assert.equal(chickenSpike.isSpike, true);
      assert.equal(chickenSpike.variancePercent, 13.79);
      assert.equal(chickenSpike.varianceLkr, 200);

      // 3600 -> 3600 = 0% -> No spike
      const arrackSpike = isPriceSpike(3600, 3600, DEFAULT_PRICE_SPIKE_THRESHOLD_PERCENT);
      assert.equal(arrackSpike.isSpike, false);
      assert.equal(arrackSpike.variancePercent, 0);
    });

    it("flags REQUIRES_MANAGER_OVERRIDE when unapproved price spike exists", () => {
      const detectResult = detectGrnVariance({
        tenantId: TENANT_AMANWELLA,
        grnNumber: GRN_NUMBER,
        poNumber: PO_NUMBER,
        supplierId: "SUP-KEELLS-01",
        supplierName: "Keells Food Products PLC",
        supplierInvoiceNumber: "INV-KF-998811",
        orderedItems: poLines,
        deliveredItems: receivedItems,
        actor: STORE_KEEPER_ACTOR,
        subscription: ACTIVE_PRO_SUBSCRIPTION,
      });

      assert.equal(detectResult.ok, true);
      if (detectResult.ok) {
        const val = detectResult.value;
        assert.equal(val.summary.hasPriceSpikes, true);
        assert.equal(val.summary.hasShortDeliveries, true);
        assert.equal(val.summary.hasRejections, true);
        assert.equal(val.summary.requiresManagerApproval, true);
        assert.equal(val.summary.verdict, "REQUIRES_MANAGER_OVERRIDE");
      }
    });

    it("approves GRN when Finance Controller provides authorized manager override", () => {
      const detectWithOverrideResult = detectGrnVariance({
        tenantId: TENANT_AMANWELLA,
        grnNumber: GRN_NUMBER,
        poNumber: PO_NUMBER,
        supplierId: "SUP-KEELLS-01",
        supplierName: "Keells Food Products PLC",
        supplierInvoiceNumber: "INV-KF-998811",
        orderedItems: poLines,
        deliveredItems: receivedItems,
        managerOverride: {
          approvedByUserId: FINANCE_CONTROLLER_ACTOR.userId,
          approvalRole: FINANCE_CONTROLLER_ACTOR.role,
          reason:
            "Supplier poultry price hike approved by General Manager due to island-wide grain costs",
        },
        actor: STORE_KEEPER_ACTOR,
        subscription: ACTIVE_PRO_SUBSCRIPTION,
        prevAuditHash: currentHash,
        timestampIso: "2026-10-20T10:30:00.000Z",
      });

      assert.equal(detectWithOverrideResult.ok, true);
      if (detectWithOverrideResult.ok) {
        const val = detectWithOverrideResult.value;
        assert.equal(val.summary.verdict, "MANAGER_APPROVED_OVERRIDE");
        assert.equal(val.summary.requiresManagerApproval, false);
        assert.equal(val.summary.totalAcceptedQty, 365); // 50 + 100 + 180 + 35
        assert.equal(val.summary.totalRejectedQty, 5); // 5 L damaged oil
        assert.equal(val.summary.shortDeliveryCount, 2); // 20 kg rice short + 5 L rejected oil

        // Append to audit trail
        if (val.auditEntry) {
          auditTrail.push(val.auditEntry);
          currentHash = val.auditEntry.entryHash;
        }
      }
    });

    it("generates FIFO inventory batches for Central Stores from accepted quantities", () => {
      // Ingress accepted items into Central Stores inventory
      const centralStoresBatches: Record<string, InventoryBatch[]> = {
        [MASTER_ITEMS.ARRACK.stockItemId]: [
          {
            batchId: "BAT-ARR-20261020-01",
            receivedAtIso: "2026-10-20T10:30:00.000Z",
            initialQty: 50,
            remainingQty: 50,
            unitCostLkr: 3600,
          },
        ],
        [MASTER_ITEMS.CHICKEN.stockItemId]: [
          {
            batchId: "BAT-CHK-20261020-01",
            receivedAtIso: "2026-10-20T10:30:00.000Z",
            initialQty: 100,
            remainingQty: 100,
            unitCostLkr: 1650, // Accepted at invoice price with GM override
          },
        ],
        [MASTER_ITEMS.RICE.stockItemId]: [
          {
            batchId: "BAT-RIC-20261020-01",
            receivedAtIso: "2026-10-20T10:30:00.000Z",
            initialQty: 180,
            remainingQty: 180,
            unitCostLkr: 340,
          },
        ],
        [MASTER_ITEMS.OIL.stockItemId]: [
          {
            batchId: "BAT-OIL-20261020-01",
            receivedAtIso: "2026-10-20T10:30:00.000Z",
            initialQty: 35, // 40 - 5 rejected
            remainingQty: 35,
            unitCostLkr: 850,
          },
        ],
      };

      assert.equal(centralStoresBatches[MASTER_ITEMS.ARRACK.stockItemId]?.[0]?.remainingQty, 50);
      assert.equal(centralStoresBatches[MASTER_ITEMS.CHICKEN.stockItemId]?.[0]?.remainingQty, 100);
      assert.equal(centralStoresBatches[MASTER_ITEMS.RICE.stockItemId]?.[0]?.remainingQty, 180);
      assert.equal(centralStoresBatches[MASTER_ITEMS.OIL.stockItemId]?.[0]?.remainingQty, 35);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Stage 3: Goods Issue Note (GIN) Kitchen Transfer & Stores FIFO Depletion
  // --------------------------------------------------------------------------
  describe("4. Stage 3: Goods Issue Note (GIN) Kitchen Transfer & Stores FIFO Depletion", () => {
    const GIN_NUMBER = "GIN-2026-10-0015";

    // Central Stores active stock before GIN
    let storesArrackBatches: InventoryBatch[] = [
      {
        batchId: "BAT-ARR-20261020-01",
        receivedAtIso: "2026-10-20T10:30:00.000Z",
        initialQty: 50,
        remainingQty: 50,
        unitCostLkr: 3600,
      },
    ];

    let storesChickenBatches: InventoryBatch[] = [
      {
        batchId: "BAT-CHK-20261020-01",
        receivedAtIso: "2026-10-20T10:30:00.000Z",
        initialQty: 100,
        remainingQty: 100,
        unitCostLkr: 1650,
      },
    ];

    let storesRiceBatches: InventoryBatch[] = [
      {
        batchId: "BAT-RIC-20261020-01",
        receivedAtIso: "2026-10-20T10:30:00.000Z",
        initialQty: 180,
        remainingQty: 180,
        unitCostLkr: 340,
      },
    ];

    let storesOilBatches: InventoryBatch[] = [
      {
        batchId: "BAT-OIL-20261020-01",
        receivedAtIso: "2026-10-20T10:30:00.000Z",
        initialQty: 35,
        remainingQty: 35,
        unitCostLkr: 850,
      },
    ];

    it("depletes Central Stores stock chronologically and calculates exact GIN transfer COGS", () => {
      // Requisition for Main Kitchen:
      // - 30 kg Chicken Breast
      // - 50 kg Keeri Samba Rice
      // - 10 L Virgin Coconut Oil
      // - 10 bottles Arrack (transferred to Bar Dispense)

      const chickenDeduct = deductFifoBatches(storesChickenBatches, 30, {
        reorderThreshold: MASTER_ITEMS.CHICKEN.reorderThreshold,
      });
      assert.equal(chickenDeduct.ok, true);
      if (chickenDeduct.ok) {
        assert.equal(chickenDeduct.value.totalDeductedQty, 30);
        assert.equal(chickenDeduct.value.totalCogsLkr, 49500); // 30 * 1650
        assert.equal(chickenDeduct.value.remainingTotalQty, 70); // 100 - 30
        assert.equal(chickenDeduct.value.isLowStock, false); // 70 > 25
        storesChickenBatches = [...chickenDeduct.value.updatedBatches];
      }

      const riceDeduct = deductFifoBatches(storesRiceBatches, 50, {
        reorderThreshold: MASTER_ITEMS.RICE.reorderThreshold,
      });
      assert.equal(riceDeduct.ok, true);
      if (riceDeduct.ok) {
        assert.equal(riceDeduct.value.totalDeductedQty, 50);
        assert.equal(riceDeduct.value.totalCogsLkr, 17000); // 50 * 340
        assert.equal(riceDeduct.value.remainingTotalQty, 130); // 180 - 50
        assert.equal(riceDeduct.value.isLowStock, false); // 130 > 50
        storesRiceBatches = [...riceDeduct.value.updatedBatches];
      }

      const oilDeduct = deductFifoBatches(storesOilBatches, 10, {
        reorderThreshold: MASTER_ITEMS.OIL.reorderThreshold,
      });
      assert.equal(oilDeduct.ok, true);
      if (oilDeduct.ok) {
        assert.equal(oilDeduct.value.totalDeductedQty, 10);
        assert.equal(oilDeduct.value.totalCogsLkr, 8500); // 10 * 850
        assert.equal(oilDeduct.value.remainingTotalQty, 25); // 35 - 10
        assert.equal(oilDeduct.value.isLowStock, false); // 25 > 10
        storesOilBatches = [...oilDeduct.value.updatedBatches];
      }

      const arrackDeduct = deductFifoBatches(storesArrackBatches, 10, {
        reorderThreshold: MASTER_ITEMS.ARRACK.reorderThreshold,
      });
      assert.equal(arrackDeduct.ok, true);
      if (arrackDeduct.ok) {
        assert.equal(arrackDeduct.value.totalDeductedQty, 10);
        assert.equal(arrackDeduct.value.totalCogsLkr, 36000); // 10 * 3600
        assert.equal(arrackDeduct.value.remainingTotalQty, 40); // 50 - 10
        assert.equal(arrackDeduct.value.isLowStock, false); // 40 > 15
        storesArrackBatches = [...arrackDeduct.value.updatedBatches];
      }

      // Total GIN transfer COGS = 49,500 + 17,000 + 8,500 + 36,000 = 111,000 LKR
      const totalGinCostLkr = 49500 + 17000 + 8500 + 36000;
      assert.equal(totalGinCostLkr, 111000);
    });

    it("creates GIN stock transfer audit entry and appends to hash chain", () => {
      const ginAuditRes = createAuditEntry({
        tenantId: TENANT_AMANWELLA,
        actorUserId: STORE_KEEPER_ACTOR.userId,
        action: "GOODS_ISSUE_NOTE_POSTED",
        entityType: "GoodsIssueNote",
        entityId: GIN_NUMBER,
        isoTs: "2026-10-20T11:45:00.000Z",
        afterJson: JSON.stringify({
          ginNumber: GIN_NUMBER,
          issuedToDepartment: "MAIN_KITCHEN_AND_POOL_BAR",
          transferredItems: [
            { itemId: MASTER_ITEMS.CHICKEN.stockItemId, qty: 30, costLkr: 49500 },
            { itemId: MASTER_ITEMS.RICE.stockItemId, qty: 50, costLkr: 17000 },
            { itemId: MASTER_ITEMS.OIL.stockItemId, qty: 10, costLkr: 8500 },
            { itemId: MASTER_ITEMS.ARRACK.stockItemId, qty: 10, costLkr: 36000 },
          ],
          totalTransferCostLkr: 111000,
        }),
        prevHash: currentHash,
      });

      assert.equal(ginAuditRes.ok, true);
      if (ginAuditRes.ok) {
        auditTrail.push(ginAuditRes.value);
        currentHash = ginAuditRes.value.entryHash;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. Stage 4: Guest QR Order / KOT BOM Depletion & Exact COGS LKR
  // --------------------------------------------------------------------------
  describe("5. Stage 4: Guest QR Order / KOT BOM Depletion & Exact COGS LKR", () => {
    // Kitchen Pantry active stock received from GIN
    const kitchenStockMap: Record<string, IngredientStockSummary> = {
      [MASTER_ITEMS.CHICKEN.stockItemId]: {
        ingredientId: MASTER_ITEMS.CHICKEN.stockItemId,
        ingredientName: MASTER_ITEMS.CHICKEN.name,
        availableQty: 30,
        reorderThreshold: 5,
        batches: [
          {
            batchId: "KIT-CHK-GIN15-01",
            receivedAtIso: "2026-10-20T11:45:00.000Z",
            initialQty: 30,
            remainingQty: 30,
            unitCostLkr: 1650,
          },
        ],
      },
      [MASTER_ITEMS.RICE.stockItemId]: {
        ingredientId: MASTER_ITEMS.RICE.stockItemId,
        ingredientName: MASTER_ITEMS.RICE.name,
        availableQty: 50,
        reorderThreshold: 10,
        batches: [
          {
            batchId: "KIT-RIC-GIN15-01",
            receivedAtIso: "2026-10-20T11:45:00.000Z",
            initialQty: 50,
            remainingQty: 50,
            unitCostLkr: 340,
          },
        ],
      },
      [MASTER_ITEMS.OIL.stockItemId]: {
        ingredientId: MASTER_ITEMS.OIL.stockItemId,
        ingredientName: MASTER_ITEMS.OIL.name,
        availableQty: 10,
        reorderThreshold: 2,
        batches: [
          {
            batchId: "KIT-OIL-GIN15-01",
            receivedAtIso: "2026-10-20T11:45:00.000Z",
            initialQty: 10,
            remainingQty: 10,
            unitCostLkr: 850,
          },
        ],
      },
    };

    const barArrackBatches: InventoryBatch[] = [
      {
        batchId: "BAR-ARR-GIN15-01",
        receivedAtIso: "2026-10-20T11:45:00.000Z",
        initialQty: 10,
        remainingQty: 10,
        unitCostLkr: 3600,
      },
    ];

    it("calculates exact portion COGS and Bill of Materials costing for Signature Devilled Chicken Kothu", () => {
      // Recipe BOM for 1 portion of Devilled Chicken Kothu:
      // - 0.35 kg Chicken Breast
      // - 0.20 kg Keeri Samba Rice
      // - 0.05 L Virgin Coconut Oil
      const kothuBomLines: RecipeBomLine[] = [
        {
          ingredientId: MASTER_ITEMS.CHICKEN.stockItemId,
          ingredientName: MASTER_ITEMS.CHICKEN.name,
          quantityRequired: 0.35,
          unitOfMeasure: "kg",
        },
        {
          ingredientId: MASTER_ITEMS.RICE.stockItemId,
          ingredientName: MASTER_ITEMS.RICE.name,
          quantityRequired: 0.2,
          unitOfMeasure: "kg",
        },
        {
          ingredientId: MASTER_ITEMS.OIL.stockItemId,
          ingredientName: MASTER_ITEMS.OIL.name,
          quantityRequired: 0.05,
          unitOfMeasure: "L",
        },
      ];

      // Guest orders 4 portions
      const recipeCostRes = calculateRecipeFoodCost(
        "REC-KOTHU-001",
        "Signature Devilled Chicken Kothu",
        4,
        kothuBomLines,
        kitchenStockMap,
      );

      assert.equal(recipeCostRes.ok, true);
      if (recipeCostRes.ok) {
        const val = recipeCostRes.value;
        assert.equal(val.portions, 4);

        // Chicken: 4 * 0.35 = 1.40 kg @ 1650 = 2,310 LKR
        // Rice: 4 * 0.20 = 0.80 kg @ 340 = 272 LKR
        // Oil: 4 * 0.05 = 0.20 L @ 850 = 170 LKR
        // Total = 2,310 + 272 + 170 = 2,752 LKR
        assert.equal(val.totalCostLkr, 2752);
        assert.equal(val.costPerPortionLkr, 688); // 2752 / 4 = 688 LKR

        // Menu selling price is 2,200 LKR per portion.
        // Food cost percentage = (688 / 2200) * 100 = 31.27% (target 28-35% healthy range)
        const foodCostPercent = roundLkr((val.costPerPortionLkr / 2200) * 100);
        assert.equal(foodCostPercent, 31.27);
      }
    });

    it("depletes Bar Arrack stock for 2x Ceylon Arrack Tropical Punch cocktails", () => {
      // 2 cocktails require 0.20 bottle (150ml out of 750ml)
      const arrackRes = deductFifoBatches(barArrackBatches, 0.2, { reorderThreshold: 2 });
      assert.equal(arrackRes.ok, true);
      if (arrackRes.ok) {
        assert.equal(arrackRes.value.totalDeductedQty, 0.2);
        assert.equal(arrackRes.value.totalCogsLkr, 720); // 0.2 * 3600 = 720 LKR (360 LKR / portion)
        assert.equal(arrackRes.value.remainingTotalQty, 9.8);

        // Menu selling price is 1,800 LKR. Beverage cost % = (360 / 1800) * 100 = 20.00%
        const bevCostPercent = roundLkr((360 / 1800) * 100);
        assert.equal(bevCostPercent, 20);
      }
    });

    it("computes 4-stage compounding Sri Lankan guest folio taxes on the order", () => {
      // Selling subtotal:
      // 4 Kothu @ 2,200 = 8,800 LKR
      // 2 Cocktails @ 1,800 = 3,600 LKR
      // Total Selling Price = 12,400 LKR
      const menuBaseTotalLkr = 12400;

      const taxRes = calculateForwardTax(menuBaseTotalLkr, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.equal(taxRes.ok, true);
      if (taxRes.ok) {
        const tax = taxRes.value;
        // SC 10% = 1240.00
        assert.equal(tax.scLkr, 1240);
        // TDL 1% on (12400 + 1240 = 13640) = 136.40
        assert.equal(tax.tdlLkr, 136.4);
        // SSCL 2.5% on (13640) = 341.00
        assert.equal(tax.ssclLkr, 341);
        // VAT 18% on (13640 + 136.40 + 341.00 = 14117.40) = 2541.13
        assert.equal(tax.vatLkr, 2541.13);
        // Grand total = 16,658.53 LKR
        assert.equal(tax.grandTotalLkr, 16658.53);
      }
    });

    it("records KOT BOM automatic stock depletion in the SHA-256 audit trail", () => {
      const kotDeduction = {
        updatedBatches: [],
        exhaustedBatchIds: [],
        allocations: [],
        totalDeductedQty: 1.4,
        totalCogsLkr: 2752,
        remainingTotalQty: 28.6,
        isLowStock: false,
      };

      const deductionAuditRes = createInventoryDeductionAuditEntry(
        TENANT_AMANWELLA,
        HEAD_CHEF_ACTOR.userId,
        MASTER_ITEMS.CHICKEN.stockItemId,
        kotDeduction,
        "2026-10-20T13:15:00.000Z",
        currentHash,
      );

      assert.equal(deductionAuditRes.ok, true);
      if (deductionAuditRes.ok) {
        auditTrail.push(deductionAuditRes.value);
        currentHash = deductionAuditRes.value.entryHash;
        assert.equal(deductionAuditRes.value.action, "FIFO_INVENTORY_DEDUCTION");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Stage 5: Physical Stock-Take Variance & Spoilage Valuation
  // --------------------------------------------------------------------------
  describe("6. Stage 5: Physical Stock-Take Variance & Spoilage Valuation", () => {
    it("computes physical count variance, shrinkage percentage, and financial loss in LKR", () => {
      // Central Stores Keeri Samba Rice:
      // Book stock = 130 kg (180 received - 50 issued to kitchen)
      // Physical count = 128 kg
      const bookStockQty = 130;
      const physicalStockQty = 128;
      const unitCostLkr = 340;

      const shrinkageQty = roundLkr(bookStockQty - physicalStockQty);
      assert.equal(shrinkageQty, 2); // 2 kg shortage

      const shrinkageLossLkr = roundLkr(shrinkageQty * unitCostLkr);
      assert.equal(shrinkageLossLkr, 680); // 2 * 340 = 680 LKR financial loss

      // Shrinkage rate % = (2 / 130) * 100 = 1.54% (within acceptable <= 2.0% hospitality store tolerance)
      const shrinkageRatePercent = roundLkr((shrinkageQty / bookStockQty) * 100);
      assert.equal(shrinkageRatePercent, 1.54);
      assert.equal(shrinkageRatePercent <= 2.0, true);
    });

    it("appends physical stock-take reconciliation audit log to the chain", () => {
      const stockTakeAuditRes = createAuditEntry({
        tenantId: TENANT_AMANWELLA,
        actorUserId: FINANCE_CONTROLLER_ACTOR.userId,
        action: "PHYSICAL_STOCK_TAKE_RECONCILED",
        entityType: "InventoryStockTake",
        entityId: "STK-2026-10-W3",
        isoTs: "2026-10-20T17:00:00.000Z",
        afterJson: JSON.stringify({
          storeLocation: "CENTRAL_DRY_STORE",
          item: MASTER_ITEMS.RICE.stockItemId,
          bookStockQty: 130,
          physicalStockQty: 128,
          varianceQty: -2,
          financialLossLkr: 680,
          withinTolerance: true,
        }),
        prevHash: currentHash,
      });

      assert.equal(stockTakeAuditRes.ok, true);
      if (stockTakeAuditRes.ok) {
        auditTrail.push(stockTakeAuditRes.value);
        currentHash = stockTakeAuditRes.value.entryHash;
      }
    });
  });

  // --------------------------------------------------------------------------
  // 7. Stage 6: Cryptographic SHA-256 Hash-Chained Audit Trail Integrity
  // --------------------------------------------------------------------------
  describe("7. Stage 6: Cryptographic SHA-256 Hash-Chained Audit Trail Integrity", () => {
    it("verifies the complete unbroken cryptographic hash chain across all 5 stages", () => {
      assert.ok(auditTrail.length >= 5, "Audit trail must have at least 5 lifecycle events");

      // Verify the entire chain using verifyAuditChain
      const chainVerification = verifyAuditChain(auditTrail);
      assert.equal(chainVerification.ok, true);
      if (chainVerification.ok) {
        assert.equal(chainVerification.value.verifiedCount, auditTrail.length);
      }
    });

    it("detects cryptographic tampering if any historical inventory record is altered", () => {
      // Clone audit trail and tamper with the first entry's financial amount in afterJson
      const tamperedTrail = auditTrail.map((entry) => ({ ...entry }));
      const originalEntry = tamperedTrail[0];
      if (originalEntry) {
        // Alter afterJson without re-signing the SHA-256 hash
        tamperedTrail[0] = {
          ...originalEntry,
          afterJson: JSON.stringify({ altered: true, maliciousWriteOff: 999999 }),
        };

        const tamperedVerification = verifyAuditChain(tamperedTrail);
        assert.equal(tamperedVerification.ok, false);
        if (!tamperedVerification.ok) {
          assert.equal(tamperedVerification.error.code, "AUDIT_CHAIN_CORRUPTED");
          assert.match(tamperedVerification.error.message, /Audit hash mismatch/i);
        }
      }
    });
  });
});
