/**
 * @hms/core - Banquet Kitchen Bulk Ingredient Requisition Generator Tests (banquetBomAggregator.test.ts)
 *
 * Implements Step 340 & Step 341 (Phase 14.15 & 14.16) of the Sri Lanka HMS Master Architecture Plan:
 * Unit test suite for banquet kitchen recipe BOM ingredient scaling, stock shortage detection,
 * and immutable audit trail generation:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries
 * 2. Input Validation (pax counts, empty menu selections)
 * 3. 250-Pax Wedding Ingredient Scaling (Guaranteed + Buffer)
 * 4. Multi-Dish Ingredient Overlap Consolidation (Cashews, Coconut Milk, Spices)
 * 5. Table Bite Platter BOM Additions (Hot Butter Cuttlefish, Cashew Fry)
 * 6. Inventory Stock Snapshot Comparison & Shortage Detection
 * 7. Cryptographic SHA-256 Immutable Audit Log Verification
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BanquetBitePlatterBom,
  type BanquetKitchenActor,
  type BanquetRequisitionInput,
  GENESIS_HASH,
  type RecipeDishBom,
  type StockSnapshot,
  generateBanquetKitchenRequisition,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Fixtures
// ============================================================================

const TENANT_A = "galle-face-heritage";
const TENANT_B = "kandy-hills-resort";

const ACTOR_CHEF: BanquetKitchenActor = {
  userId: "usr-chef-01",
  role: "EXECUTIVE_CHEF",
  tenantId: TENANT_A,
};

const ACTOR_STOREKEEPER: BanquetKitchenActor = {
  userId: "usr-store-01",
  role: "STOREKEEPER",
  tenantId: TENANT_A,
};

const ACTOR_UNAUTHORIZED: BanquetKitchenActor = {
  userId: "usr-hk-01",
  role: "HOUSEKEEPING_ATTENDANT",
  tenantId: TENANT_A,
};

const MOCK_WEDDING_DISHES: readonly RecipeDishBom[] = [
  {
    dishId: "dish-yellow-rice",
    dishName: "Sri Lankan Yellow Basmati Rice with Ghee & Cashews",
    portionMultiplier: 1.0,
    ingredients: [
      {
        ingredientId: "ing-basmati",
        ingredientName: "Basmati Rice Extra Long Grain",
        category: "GRAIN",
        qtyPerPortion: 0.12, // 120g per pax
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 650,
      },
      {
        ingredientId: "ing-ghee",
        ingredientName: "Pure Cow Ghee",
        category: "OIL_FAT",
        qtyPerPortion: 0.015,
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 2400,
      },
      {
        ingredientId: "ing-cashew",
        ingredientName: "Raw Whole Cashews (Grade A)",
        category: "SPICE_CONDIMENT",
        qtyPerPortion: 0.02,
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 4200,
      },
    ],
  },
  {
    dishId: "dish-chicken-curry",
    dishName: "Kandyan Spiced Black Chicken Curry",
    portionMultiplier: 1.0,
    ingredients: [
      {
        ingredientId: "ing-chicken",
        ingredientName: "Fresh Chicken (Curry Cut)",
        category: "MEAT",
        qtyPerPortion: 0.18, // 180g per pax
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 1450,
      },
      {
        ingredientId: "ing-coconut-milk",
        ingredientName: "Fresh Coconut Milk (Extracted)",
        category: "DAIRY",
        qtyPerPortion: 0.06, // 60ml per pax
        unitOfMeasure: "L",
        estimatedUnitCostLkr: 450,
      },
    ],
  },
  {
    dishId: "dish-prawns-devilled",
    dishName: "Negombo Lagoon Devilled Prawns",
    portionMultiplier: 1.0,
    ingredients: [
      {
        ingredientId: "ing-prawns",
        ingredientName: "Lagoon Jumbo Prawns (Headless)",
        category: "SEAFOOD",
        qtyPerPortion: 0.15, // 150g per pax
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 3200,
      },
    ],
  },
  {
    dishId: "dish-cashew-curry",
    dishName: "Cashew Nut & Green Pea Curry",
    portionMultiplier: 1.0,
    ingredients: [
      {
        ingredientId: "ing-cashew",
        ingredientName: "Raw Whole Cashews (Grade A)",
        category: "SPICE_CONDIMENT",
        qtyPerPortion: 0.06, // 60g per pax
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 4200,
      },
      {
        ingredientId: "ing-coconut-milk",
        ingredientName: "Fresh Coconut Milk (Extracted)",
        category: "DAIRY",
        qtyPerPortion: 0.05, // 50ml per pax
        unitOfMeasure: "L",
        estimatedUnitCostLkr: 450,
      },
    ],
  },
  {
    dishId: "dish-watalappam",
    dishName: "Watalappam with Kithul Jaggery & Cashews",
    portionMultiplier: 1.0,
    ingredients: [
      {
        ingredientId: "ing-cashew",
        ingredientName: "Raw Whole Cashews (Grade A)",
        category: "SPICE_CONDIMENT",
        qtyPerPortion: 0.01, // 10g per pax
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 4200,
      },
      {
        ingredientId: "ing-coconut-milk",
        ingredientName: "Fresh Coconut Milk (Extracted)",
        category: "DAIRY",
        qtyPerPortion: 0.08, // 80ml per pax
        unitOfMeasure: "L",
        estimatedUnitCostLkr: 450,
      },
    ],
  },
];

const MOCK_BITES: readonly BanquetBitePlatterBom[] = [
  {
    itemId: "bite-hbc",
    name: "Hot Butter Cuttlefish (HBC)",
    plattersCount: 50, // 25 tables x 2 platters
    ingredients: [
      {
        ingredientId: "ing-cuttlefish",
        ingredientName: "Fresh Ocean Cuttlefish Rings",
        category: "SEAFOOD",
        qtyPerPortion: 0.35, // 350g per platter
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 2800,
      },
      {
        ingredientId: "ing-butter",
        ingredientName: "Salted Table Butter",
        category: "DAIRY",
        qtyPerPortion: 0.05,
        unitOfMeasure: "KG",
        estimatedUnitCostLkr: 2200,
      },
    ],
  },
];

const MOCK_STOCKS: readonly StockSnapshot[] = [
  { ingredientId: "ing-basmati", availableQty: 20.0, unitOfMeasure: "KG" },
  { ingredientId: "ing-chicken", availableQty: 0.0, unitOfMeasure: "KG" },
  { ingredientId: "ing-prawns", availableQty: 10.0, unitOfMeasure: "KG" },
  { ingredientId: "ing-coconut-milk", availableQty: 60.0, unitOfMeasure: "L" },
  { ingredientId: "ing-cashew", availableQty: 5.0, unitOfMeasure: "KG" },
  { ingredientId: "ing-cuttlefish", availableQty: 5.0, unitOfMeasure: "KG" },
  { ingredientId: "ing-ghee", availableQty: 10.0, unitOfMeasure: "KG" },
  { ingredientId: "ing-butter", availableQty: 5.0, unitOfMeasure: "KG" },
];

function unwrapOk<T>(res: { ok: boolean; value?: T; error?: unknown }): T {
  assert.strictEqual(res.ok, true);
  return res.value as T;
}

function unwrapErr<E>(res: { ok: boolean; value?: unknown; error?: E }): E {
  assert.strictEqual(res.ok, false);
  return res.error as E;
}

// ============================================================================
// Tests
// ============================================================================

describe("Step 340 & 341: banquetBomAggregator — Banquet Kitchen Bulk Ingredient Requisition Generator", () => {
  describe("1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries", () => {
    it("allows EXECUTIVE_CHEF and STOREKEEPER to generate kitchen requisitions", () => {
      const input: BanquetRequisitionInput = {
        tenantId: TENANT_A,
        eventId: "EVT-2026-0889",
        functionNumber: "BEO-9842",
        eventName: "Samarawickrama Wedding",
        eventDate: "2026-10-25",
        guaranteedPax: 100,
        bufferPax: 10,
        selectedDishes: MOCK_WEDDING_DISHES,
      };

      const resChef = generateBanquetKitchenRequisition(ACTOR_CHEF, input);
      assert.strictEqual(resChef.ok, true);

      const resStore = generateBanquetKitchenRequisition(ACTOR_STOREKEEPER, input);
      assert.strictEqual(resStore.ok, true);
    });

    it("rejects unauthorized staff roles with PERMISSION_DENIED error", () => {
      const input: BanquetRequisitionInput = {
        tenantId: TENANT_A,
        eventId: "EVT-2026-0889",
        functionNumber: "BEO-9842",
        eventName: "Samarawickrama Wedding",
        eventDate: "2026-10-25",
        guaranteedPax: 100,
        bufferPax: 10,
        selectedDishes: MOCK_WEDDING_DISHES,
      };

      const res = generateBanquetKitchenRequisition(ACTOR_UNAUTHORIZED, input);
      const err = unwrapErr<{ code: string }>(res);
      assert.strictEqual(err.code, "PERMISSION_DENIED");
    });

    it("rejects cross-tenant execution with TENANT_MISMATCH error", () => {
      const crossTenantInput: BanquetRequisitionInput = {
        tenantId: TENANT_B, // Cross-tenant!
        eventId: "EVT-2026-0889",
        functionNumber: "BEO-9842",
        eventName: "Samarawickrama Wedding",
        eventDate: "2026-10-25",
        guaranteedPax: 100,
        bufferPax: 10,
        selectedDishes: MOCK_WEDDING_DISHES,
      };

      const res = generateBanquetKitchenRequisition(ACTOR_CHEF, crossTenantInput);
      const err = unwrapErr<{ code: string }>(res);
      assert.strictEqual(err.code, "TENANT_MISMATCH");
    });
  });

  describe("2. Input Validation", () => {
    it("rejects zero or negative guaranteedPax with VALIDATION_FAILED", () => {
      const inputZero: BanquetRequisitionInput = {
        tenantId: TENANT_A,
        eventId: "EVT-2026-0889",
        functionNumber: "BEO-9842",
        eventName: "Samarawickrama Wedding",
        eventDate: "2026-10-25",
        guaranteedPax: 0,
        bufferPax: 10,
        selectedDishes: MOCK_WEDDING_DISHES,
      };

      const resZero = generateBanquetKitchenRequisition(ACTOR_CHEF, inputZero);
      const errZero = unwrapErr<{ code: string }>(resZero);
      assert.strictEqual(errZero.code, "VALIDATION_FAILED");

      const inputNegative: BanquetRequisitionInput = {
        ...inputZero,
        guaranteedPax: -50,
      };
      const resNeg = generateBanquetKitchenRequisition(ACTOR_CHEF, inputNegative);
      const errNeg = unwrapErr<{ code: string }>(resNeg);
      assert.strictEqual(errNeg.code, "VALIDATION_FAILED");
    });

    it("rejects empty menu and bite selection with INVALID_ORDER_ITEMS", () => {
      const inputEmpty: BanquetRequisitionInput = {
        tenantId: TENANT_A,
        eventId: "EVT-2026-0889",
        functionNumber: "BEO-9842",
        eventName: "Samarawickrama Wedding",
        eventDate: "2026-10-25",
        guaranteedPax: 200,
        bufferPax: 20,
        selectedDishes: [],
        selectedBites: [],
      };

      const res = generateBanquetKitchenRequisition(ACTOR_CHEF, inputEmpty);
      const err = unwrapErr<{ code: string }>(res);
      assert.strictEqual(err.code, "INVALID_ORDER_ITEMS");
    });
  });

  describe("3. 250-Pax Wedding Ingredient Scaling & Overlapping Ingredients Consolidation", () => {
    it("accurately calculates 250-pax + 25-pax buffer (275 prep pax) ingredient requirements", () => {
      const input: BanquetRequisitionInput = {
        tenantId: TENANT_A,
        eventId: "EVT-2026-WED-250",
        functionNumber: "BEO-250",
        eventName: "Jayawardena & Senanayake Wedding",
        eventDate: "2026-11-20",
        guaranteedPax: 250,
        bufferPax: 25, // 10% buffer -> 275 prep pax
        selectedDishes: MOCK_WEDDING_DISHES,
        selectedBites: MOCK_BITES,
        stockSnapshots: MOCK_STOCKS,
        prevAuditHash: GENESIS_HASH,
      };

      const result = unwrapOk(generateBanquetKitchenRequisition(ACTOR_CHEF, input));

      assert.strictEqual(result.prepPaxCount, 275);
      assert.strictEqual(result.tenantId, TENANT_A);
      assert.strictEqual(result.functionNumber, "BEO-250");

      // Verify Basmati Rice: 0.12 kg * 275 = 33.00 kg
      const basmati = result.items.find((i) => i.ingredientId === "ing-basmati");
      assert.ok(basmati);
      assert.strictEqual(basmati.totalRequiredQty, 33);
      assert.strictEqual(basmati.currentStockQty, 20);
      assert.strictEqual(basmati.shortageQty, 13);
      assert.strictEqual(basmati.isShortage, true);
      assert.strictEqual(basmati.estimatedProcurementCostLkr, 13 * 650); // 8,450 LKR

      // Verify Fresh Chicken: 0.18 kg * 275 = 49.50 kg
      const chicken = result.items.find((i) => i.ingredientId === "ing-chicken");
      assert.ok(chicken);
      assert.strictEqual(chicken.totalRequiredQty, 49.5);
      assert.strictEqual(chicken.currentStockQty, 0);
      assert.strictEqual(chicken.shortageQty, 49.5);
      assert.strictEqual(chicken.isShortage, true);
      assert.strictEqual(chicken.estimatedProcurementCostLkr, 49.5 * 1450); // 71,775 LKR

      // Verify Jumbo Prawns: 0.15 kg * 275 = 41.25 kg
      const prawns = result.items.find((i) => i.ingredientId === "ing-prawns");
      assert.ok(prawns);
      assert.strictEqual(prawns.totalRequiredQty, 41.25);
      assert.strictEqual(prawns.currentStockQty, 10);
      assert.strictEqual(prawns.shortageQty, 31.25);
      assert.strictEqual(prawns.isShortage, true);

      // Verify Overlapping Cashews:
      // Yellow Rice (0.02) + Cashew Curry (0.06) + Watalappam (0.01) = 0.09 kg * 275 = 24.75 kg
      const cashews = result.items.find((i) => i.ingredientId === "ing-cashew");
      assert.ok(cashews);
      assert.strictEqual(cashews.totalRequiredQty, 24.75);
      assert.strictEqual(cashews.currentStockQty, 5);
      assert.strictEqual(cashews.shortageQty, 19.75);
      assert.strictEqual(cashews.isShortage, true);

      // Verify Overlapping Coconut Milk:
      // Chicken Curry (0.06) + Cashew Curry (0.05) + Watalappam (0.08) = 0.19 L * 275 = 52.25 L
      const coconutMilk = result.items.find((i) => i.ingredientId === "ing-coconut-milk");
      assert.ok(coconutMilk);
      assert.strictEqual(coconutMilk.totalRequiredQty, 52.25);
      assert.strictEqual(coconutMilk.currentStockQty, 60);
      assert.strictEqual(coconutMilk.shortageQty, 0); // Sufficient stock!
      assert.strictEqual(coconutMilk.isShortage, false);
      assert.strictEqual(coconutMilk.estimatedProcurementCostLkr, 0);

      // Verify Table Bite Platter Cuttlefish (50 platters * 0.35 kg = 17.50 kg)
      const cuttlefish = result.items.find((i) => i.ingredientId === "ing-cuttlefish");
      assert.ok(cuttlefish);
      assert.strictEqual(cuttlefish.totalRequiredQty, 17.5);
      assert.strictEqual(cuttlefish.currentStockQty, 5);
      assert.strictEqual(cuttlefish.shortageQty, 12.5);

      // Summary cost metrics
      assert.ok(result.totalEstimatedProcurementCostLkr > 0);
      assert.ok(result.totalTheoreticalRawCostLkr > result.totalEstimatedProcurementCostLkr);
      assert.ok(result.rawCostPerGuaranteedPaxLkr > 0);
    });
  });

  describe("4. SHA-256 Hash-Chained Immutable Audit Log Integrity", () => {
    it("produces valid cryptographic audit entry conforming to the chain standard", () => {
      const input: BanquetRequisitionInput = {
        tenantId: TENANT_A,
        eventId: "EVT-AUDIT-TEST",
        functionNumber: "BEO-AUDIT",
        eventName: "Audit Test Wedding",
        eventDate: "2026-10-25",
        guaranteedPax: 150,
        bufferPax: 15,
        selectedDishes: MOCK_WEDDING_DISHES,
        prevAuditHash: GENESIS_HASH,
      };

      const result = unwrapOk(generateBanquetKitchenRequisition(ACTOR_CHEF, input));

      assert.ok(result.auditEntry);
      assert.strictEqual(result.auditEntry.tenantId, TENANT_A);
      assert.strictEqual(result.auditEntry.actorUserId, ACTOR_CHEF.userId);
      assert.strictEqual(result.auditEntry.action, "GENERATE_BANQUET_KITCHEN_REQUISITION");
      assert.strictEqual(result.auditEntry.prevHash, GENESIS_HASH);
      assert.strictEqual(result.auditEntry.entryHash.length, 64);

      // Verify cryptographic chain
      const chainValid = verifyAuditChain([result.auditEntry], GENESIS_HASH);
      assert.strictEqual(chainValid.ok, true);
    });
  });
});
