/**
 * @hms/core - Spa Herbal Oil & Consumables BOM Deduction Unit Tests (spaConsumables.test.ts)
 *
 * Implements Step 364 & Step 365 (Phase 15.14 & 15.15) of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive unit test suite for deducting Ayurveda spa consumables and herbal medicated oils:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries
 * 2. Standard Shirodhara & Abhyanga FIFO Oil Depletion
 * 3. Multi-Batch FIFO Depletion Across Acquisition Price Tiers
 * 4. Insufficient Inventory Stock Error Handling
 * 5. Low-Stock Reorder Threshold Alert Generation
 * 6. Session Duration Scaling Multiplier
 * 7. Custom Therapy BOM Protocol Overrides
 * 8. Cryptographic SHA-256 Immutable Audit Log Verification
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AYURVEDA_BOM_PRESETS,
  GENESIS_HASH,
  type InventoryBatch,
  type SpaConsumableItemStock,
  type SpaConsumablesActor,
  type SpaDeductionRequest,
  type SpaStaffRole,
  deductSpaConsumables,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Fixtures & Sample Batches
// ============================================================================

const TENANT_RESORT = "resort-bentota-ayurveda";
const TENANT_OTHER = "hotel-colombo-city";

const DOCTOR_ACTOR: SpaConsumablesActor = {
  userId: "doc-haritha-01",
  role: "AYURVEDA_DOCTOR",
  tenantId: TENANT_RESORT,
};

const THERAPIST_ACTOR: SpaConsumablesActor = {
  userId: "therapist-niluka-05",
  role: "SENIOR_THERAPIST",
  tenantId: TENANT_RESORT,
};

const UNAUTHORIZED_ACTOR: SpaConsumablesActor = {
  userId: "waiter-kamal-09",
  role: "WAITER" as unknown as SpaStaffRole,
  tenantId: TENANT_RESORT,
};

function createSampleInventory(): SpaConsumableItemStock[] {
  return [
    {
      itemId: "OIL-MAHANARAYANA-ML",
      name: "Mahanarayana Medicated Herbal Oil",
      category: "HERBAL_OIL",
      unitOfMeasure: "ml",
      reorderThreshold: 200,
      batches: [
        {
          batchId: "BATCH-MAHA-001",
          receivedAtIso: "2026-10-01T08:00:00.000Z",
          initialQty: 500,
          remainingQty: 500,
          unitCostLkr: 2.5, // LKR 2.50 per ml = LKR 2,500/L
        },
        {
          batchId: "BATCH-MAHA-002",
          receivedAtIso: "2026-10-15T08:00:00.000Z",
          initialQty: 1000,
          remainingQty: 1000,
          unitCostLkr: 2.8, // LKR 2.80 per ml
        },
      ],
    },
    {
      itemId: "OIL-KING-COCONUT-ML",
      name: "Organic Virgin King Coconut Base Oil",
      category: "HERBAL_OIL",
      unitOfMeasure: "ml",
      reorderThreshold: 150,
      batches: [
        {
          batchId: "BATCH-KCOCONUT-001",
          receivedAtIso: "2026-10-05T09:00:00.000Z",
          initialQty: 1000,
          remainingQty: 200,
          unitCostLkr: 1.2, // LKR 1.20 per ml
        },
      ],
    },
    {
      itemId: "LINEN-GAUZE-BAND",
      name: "Sterile Cotton Forehead Gauze Band",
      category: "LINEN_DISPOSABLE",
      unitOfMeasure: "unit",
      reorderThreshold: 10,
      batches: [
        {
          batchId: "BATCH-GAUZE-001",
          receivedAtIso: "2026-09-20T10:00:00.000Z",
          initialQty: 50,
          remainingQty: 15,
          unitCostLkr: 150.0,
        },
      ],
    },
    {
      itemId: "OIL-PINDA-ML",
      name: "Pinda Thailaya Cooling Herbal Oil",
      category: "HERBAL_OIL",
      unitOfMeasure: "ml",
      reorderThreshold: 100,
      batches: [
        {
          batchId: "BATCH-PINDA-001",
          receivedAtIso: "2026-10-10T11:00:00.000Z",
          initialQty: 300,
          remainingQty: 300,
          unitCostLkr: 3.0,
        },
      ],
    },
    {
      itemId: "POULTICE-HERBAL-KIZHI",
      name: "Pre-made Medicated Herbal Leaf Kizhi Poultices",
      category: "HERBAL_POULTICE",
      unitOfMeasure: "packet",
      reorderThreshold: 10,
      batches: [
        {
          batchId: "BATCH-KIZHI-001",
          receivedAtIso: "2026-10-12T07:30:00.000Z",
          initialQty: 20,
          remainingQty: 8,
          unitCostLkr: 450.0,
        },
      ],
    },
  ];
}

// ============================================================================
// Test Suites
// ============================================================================

describe("Spa Consumables BOM FIFO Deduction Engine", () => {
  it("exports standard Ayurveda BOM presets with authentic Sri Lankan formulas", () => {
    assert.ok(AYURVEDA_BOM_PRESETS.SHIRODHARA);
    assert.ok(AYURVEDA_BOM_PRESETS.ABHYANGA);
    assert.ok(AYURVEDA_BOM_PRESETS.PINDA_SWEDA);
    assert.ok(AYURVEDA_BOM_PRESETS.SWEDANA);
    assert.ok(AYURVEDA_BOM_PRESETS.MUKHA_LEPA);
    assert.ok(AYURVEDA_BOM_PRESETS.NASYA);

    assert.equal(AYURVEDA_BOM_PRESETS.SHIRODHARA.bomLines.length, 3);
    const mahanarayanaLine = AYURVEDA_BOM_PRESETS.SHIRODHARA.bomLines.find(
      (l) => l.itemId === "OIL-MAHANARAYANA-ML",
    );
    assert.ok(mahanarayanaLine);
    assert.equal(mahanarayanaLine.quantityRequired, 400);
  });

  it("rejects unauthorized actor roles outside spa staff permissions", () => {
    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: UNAUTHORIZED_ACTOR,
      therapySessionId: "APPT-1001",
      therapyCode: "SHIRODHARA",
      inventory: createSampleInventory(),
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "PERMISSION_DENIED");
    }
  });

  it("rejects tenant mismatch between actor and request", () => {
    const crossTenantActor: SpaConsumablesActor = {
      ...DOCTOR_ACTOR,
      tenantId: TENANT_OTHER,
    };

    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: crossTenantActor,
      therapySessionId: "APPT-1002",
      therapyCode: "SHIRODHARA",
      inventory: createSampleInventory(),
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "TENANT_MISMATCH");
    }
  });

  it("deducts Shirodhara BOM consumables correctly in FIFO order and calculates exact COGS", () => {
    const inventory = createSampleInventory();
    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: THERAPIST_ACTOR,
      therapySessionId: "APPT-1003",
      therapyCode: "SHIRODHARA",
      inventory,
      previousAuditHash: GENESIS_HASH,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const result = res.value;
    assert.equal(result.therapyCode, "SHIRODHARA");
    assert.equal(result.deductionLines.length, 3);

    // 1. Mahanarayana: 400ml @ 2.50 = LKR 1000.00
    const mahaLine = result.deductionLines.find((l) => l.itemId === "OIL-MAHANARAYANA-ML");
    assert.ok(mahaLine);
    assert.equal(mahaLine.quantityDeducted, 400);
    assert.equal(mahaLine.lineCogsLkr, 1000.0);
    assert.equal(mahaLine.remainingQty, 1100); // (500-400) + 1000

    // 2. King Coconut: 100ml @ 1.20 = LKR 120.00
    const coconutLine = result.deductionLines.find((l) => l.itemId === "OIL-KING-COCONUT-ML");
    assert.ok(coconutLine);
    assert.equal(coconutLine.quantityDeducted, 100);
    assert.equal(coconutLine.lineCogsLkr, 120.0);
    assert.equal(coconutLine.remainingQty, 100); // 200 - 100

    // 3. Gauze: 1 unit @ 150 = LKR 150.00
    const gauzeLine = result.deductionLines.find((l) => l.itemId === "LINEN-GAUZE-BAND");
    assert.ok(gauzeLine);
    assert.equal(gauzeLine.quantityDeducted, 1);
    assert.equal(gauzeLine.lineCogsLkr, 150.0);

    // Total COGS: 1000 + 120 + 150 = 1270.00 LKR
    assert.equal(result.totalCogsLkr, 1270.0);

    // King Coconut remaining is 100ml, reorder threshold is 150ml -> Low stock alert
    assert.equal(coconutLine.isLowStock, true);
    assert.ok(result.lowStockAlerts.length >= 1);

    // Verifies audit log entry
    assert.equal(result.auditLog.action, "SPA_CONSUMABLES_DEDUCTED");
    assert.equal(result.auditLog.prevHash, GENESIS_HASH);
    const chainVerification = verifyAuditChain([result.auditLog], GENESIS_HASH);
    assert.equal(chainVerification.ok, true);
  });

  it("handles multi-batch FIFO depletion across two distinct price tiers", () => {
    const multiBatches: InventoryBatch[] = [
      {
        batchId: "OLD-BATCH-01",
        receivedAtIso: "2026-09-01T00:00:00.000Z",
        initialQty: 100,
        remainingQty: 100,
        unitCostLkr: 2.0,
      },
      {
        batchId: "NEW-BATCH-02",
        receivedAtIso: "2026-10-01T00:00:00.000Z",
        initialQty: 500,
        remainingQty: 500,
        unitCostLkr: 3.0,
      },
    ];

    const inventory: SpaConsumableItemStock[] = [
      {
        itemId: "OIL-MAHANARAYANA-ML",
        name: "Mahanarayana Medicated Herbal Oil",
        category: "HERBAL_OIL",
        unitOfMeasure: "ml",
        reorderThreshold: 50,
        batches: multiBatches,
      },
      {
        itemId: "OIL-PINDA-ML",
        name: "Pinda Thailaya Cooling Herbal Oil",
        category: "HERBAL_OIL",
        unitOfMeasure: "ml",
        reorderThreshold: 50,
        batches: [
          {
            batchId: "PINDA-01",
            receivedAtIso: "2026-10-01T00:00:00.000Z",
            initialQty: 200,
            remainingQty: 200,
            unitCostLkr: 4.0,
          },
        ],
      },
    ];

    // Abhyanga requires 150ml Mahanarayana.
    // 100ml from OLD-BATCH-01 (@ 2.00) + 50ml from NEW-BATCH-02 (@ 3.00) = 200 + 150 = LKR 350.00
    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1004",
      therapyCode: "ABHYANGA",
      inventory,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const mahaLine = res.value.deductionLines.find((l) => l.itemId === "OIL-MAHANARAYANA-ML");
    assert.ok(mahaLine);
    assert.equal(mahaLine.quantityDeducted, 150);
    assert.equal(mahaLine.lineCogsLkr, 350.0);
    assert.deepEqual(mahaLine.exhaustedBatchIds, ["OLD-BATCH-01"]);
    assert.equal(mahaLine.batchAllocations.length, 2);
    assert.equal(mahaLine.remainingQty, 450);
  });

  it("fails gracefully with VALIDATION_FAILED if stock is insufficient", () => {
    const lowInventory: SpaConsumableItemStock[] = [
      {
        itemId: "OIL-MAHANARAYANA-ML",
        name: "Mahanarayana Medicated Herbal Oil",
        category: "HERBAL_OIL",
        unitOfMeasure: "ml",
        reorderThreshold: 50,
        batches: [
          {
            batchId: "BATCH-TINY",
            receivedAtIso: "2026-10-01T00:00:00.000Z",
            initialQty: 50,
            remainingQty: 50, // Only 50ml available, but Shirodhara requires 400ml!
            unitCostLkr: 2.5,
          },
        ],
      },
      {
        itemId: "OIL-KING-COCONUT-ML",
        name: "Organic Virgin King Coconut Base Oil",
        category: "HERBAL_OIL",
        unitOfMeasure: "ml",
        reorderThreshold: 10,
        batches: [
          {
            batchId: "BATCH-KCOCONUT",
            receivedAtIso: "2026-10-01T00:00:00.000Z",
            initialQty: 200,
            remainingQty: 200,
            unitCostLkr: 1.2,
          },
        ],
      },
      {
        itemId: "LINEN-GAUZE-BAND",
        name: "Sterile Cotton Forehead Gauze Band",
        category: "LINEN_DISPOSABLE",
        unitOfMeasure: "unit",
        reorderThreshold: 2,
        batches: [
          {
            batchId: "BATCH-GAUZE",
            receivedAtIso: "2026-10-01T00:00:00.000Z",
            initialQty: 10,
            remainingQty: 10,
            unitCostLkr: 150,
          },
        ],
      },
    ];

    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1005",
      therapyCode: "SHIRODHARA",
      inventory: lowInventory,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "VALIDATION_FAILED");
    }
  });

  it("scales consumables proportionally with sessionMultiplier (e.g. 1.5x for 90-min session)", () => {
    const inventory = createSampleInventory();
    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1006",
      therapyCode: "ABHYANGA", // Standard: 150ml Maha + 50ml Pinda
      sessionMultiplier: 1.5, // Extended: 225ml Maha + 75ml Pinda
      inventory,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const mahaLine = res.value.deductionLines.find((l) => l.itemId === "OIL-MAHANARAYANA-ML");
    assert.ok(mahaLine);
    assert.equal(mahaLine.quantityDeducted, 225); // 150 * 1.5

    const pindaLine = res.value.deductionLines.find((l) => l.itemId === "OIL-PINDA-ML");
    assert.ok(pindaLine);
    assert.equal(pindaLine.quantityDeducted, 75); // 50 * 1.5
  });

  it("supports custom therapy BOM protocol overrides", () => {
    const inventory = createSampleInventory();
    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1007",
      therapyCode: "DOCTOR_CUSTOM_DETOX",
      customBomLines: [
        {
          itemId: "OIL-PINDA-ML",
          itemName: "Pinda Thailaya Cooling Herbal Oil",
          category: "HERBAL_OIL",
          quantityRequired: 80,
          unitOfMeasure: "ml",
        },
      ],
      inventory,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.deductionLines.length, 1);
    assert.equal(res.value.deductionLines[0].quantityDeducted, 80);
    assert.equal(res.value.deductionLines[0].lineCogsLkr, 240.0); // 80 * 3.0
  });

  it("strictly enforces chronological FIFO sorting regardless of array insertion order", () => {
    const unsortedBatches: InventoryBatch[] = [
      {
        batchId: "LATEST-BATCH-03",
        receivedAtIso: "2026-10-20T10:00:00.000Z",
        initialQty: 500,
        remainingQty: 500,
        unitCostLkr: 5.0,
      },
      {
        batchId: "EARLIEST-BATCH-01",
        receivedAtIso: "2026-09-01T10:00:00.000Z",
        initialQty: 100,
        remainingQty: 100,
        unitCostLkr: 2.0,
      },
      {
        batchId: "MIDDLE-BATCH-02",
        receivedAtIso: "2026-10-01T10:00:00.000Z",
        initialQty: 200,
        remainingQty: 200,
        unitCostLkr: 3.0,
      },
    ];

    const inventory: SpaConsumableItemStock[] = [
      {
        itemId: "OIL-MAHANARAYANA-ML",
        name: "Mahanarayana Medicated Herbal Oil",
        category: "HERBAL_OIL",
        unitOfMeasure: "ml",
        reorderThreshold: 100,
        batches: unsortedBatches,
      },
      {
        itemId: "OIL-PINDA-ML",
        name: "Pinda Thailaya Cooling Herbal Oil",
        category: "HERBAL_OIL",
        unitOfMeasure: "ml",
        reorderThreshold: 50,
        batches: [
          {
            batchId: "PINDA-01",
            receivedAtIso: "2026-10-01T00:00:00.000Z",
            initialQty: 100,
            remainingQty: 100,
            unitCostLkr: 2.5,
          },
        ],
      },
    ];

    // Abhyanga requires 150ml Mahanarayana:
    // Should deplete EARLIEST-BATCH-01 (100ml @ 2.00 = 200) + MIDDLE-BATCH-02 (50ml @ 3.00 = 150) = 350 LKR
    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1008",
      therapyCode: "ABHYANGA",
      inventory,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const mahaLine = res.value.deductionLines.find((l) => l.itemId === "OIL-MAHANARAYANA-ML");
    assert.ok(mahaLine);
    assert.equal(mahaLine.lineCogsLkr, 350.0);
    assert.equal(mahaLine.batchAllocations[0].batchId, "EARLIEST-BATCH-01");
    assert.equal(mahaLine.batchAllocations[0].deductedQty, 100);
    assert.equal(mahaLine.batchAllocations[1].batchId, "MIDDLE-BATCH-02");
    assert.equal(mahaLine.batchAllocations[1].deductedQty, 50);
  });

  it("rejects request if required consumable item is not found in inventory", () => {
    // Inventory missing King Coconut Oil and Gauze Band
    const partialInventory: SpaConsumableItemStock[] = [
      {
        itemId: "OIL-MAHANARAYANA-ML",
        name: "Mahanarayana Medicated Herbal Oil",
        category: "HERBAL_OIL",
        unitOfMeasure: "ml",
        reorderThreshold: 100,
        batches: [
          {
            batchId: "B1",
            receivedAtIso: "2026-10-01T00:00:00.000Z",
            initialQty: 500,
            remainingQty: 500,
            unitCostLkr: 2.5,
          },
        ],
      },
    ];

    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1009",
      therapyCode: "SHIRODHARA",
      inventory: partialInventory,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "NOT_FOUND");
    }
  });

  it("validates empty therapySessionId and non-positive session multipliers", () => {
    const inventory = createSampleInventory();

    const emptySessionReq: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "   ",
      therapyCode: "ABHYANGA",
      inventory,
    };
    const res1 = deductSpaConsumables(emptySessionReq);
    assert.equal(res1.ok, false);
    if (!res1.ok) {
      assert.equal(res1.error.code, "VALIDATION_FAILED");
    }

    const invalidMultReq: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1010",
      therapyCode: "ABHYANGA",
      sessionMultiplier: -0.5,
      inventory,
    };
    const res2 = deductSpaConsumables(invalidMultReq);
    assert.equal(res2.ok, false);
    if (!res2.ok) {
      assert.equal(res2.error.code, "VALIDATION_FAILED");
    }
  });

  it("detects cryptographic tampering in SHA-256 audit log payload", () => {
    const inventory = createSampleInventory();
    const request: SpaDeductionRequest = {
      tenantId: TENANT_RESORT,
      actor: DOCTOR_ACTOR,
      therapySessionId: "APPT-1011",
      therapyCode: "ABHYANGA",
      inventory,
      previousAuditHash: GENESIS_HASH,
    };

    const res = deductSpaConsumables(request);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    // Tamper with the audit log entry
    const tamperedEntry = {
      ...res.value.auditLog,
      afterJson: JSON.stringify({ therapySessionId: "APPT-1011", totalCogsLkr: 0.0 }),
    };

    const chainRes = verifyAuditChain([tamperedEntry], GENESIS_HASH);
    assert.equal(chainRes.ok, false);
    if (!chainRes.ok) {
      assert.equal(chainRes.error.code, "AUDIT_CHAIN_CORRUPTED");
    }
  });

  it("authorizes all valid spa operations roles in RBAC matrix", () => {
    const allowedRoles: readonly SpaStaffRole[] = [
      "AYURVEDA_DOCTOR",
      "SPA_MANAGER",
      "SENIOR_THERAPIST",
      "THERAPIST",
      "GENERAL_MANAGER",
      "SUPER_ADMIN",
    ];

    const inventory = createSampleInventory();

    for (const role of allowedRoles) {
      const actor: SpaConsumablesActor = {
        userId: `usr-${role.toLowerCase()}`,
        role,
        tenantId: TENANT_RESORT,
      };

      const request: SpaDeductionRequest = {
        tenantId: TENANT_RESORT,
        actor,
        therapySessionId: `APPT-ROLE-${role}`,
        therapyCode: "ABHYANGA",
        inventory,
      };

      const res = deductSpaConsumables(request);
      assert.equal(res.ok, true, `Role ${role} should be authorized`);
    }
  });
});
