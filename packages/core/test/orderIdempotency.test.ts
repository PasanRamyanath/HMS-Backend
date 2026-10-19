import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CreateGuestOrderRequest,
  type GuestOrderItemInput,
  type IdempotencyRecord,
  buildDynamoDbIdempotencyCondition,
  buildIdempotencyRecord,
  computeOrderRequestHash,
  processGuestOrderIdempotency,
  validateIdempotencyKey,
} from "../src/orderIdempotency.js";

describe("Step 270: Guest Order Idempotency Guard (orderIdempotency.ts)", () => {
  describe("1. validateIdempotencyKey", () => {
    it("accepts valid UUID v4 and alphanumeric tokens", () => {
      const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const nonce = "ORDER_NONCE_20261019_XYZ123";

      const res1 = validateIdempotencyKey(uuid);
      assert.strictEqual(res1.ok, true);
      if (res1.ok) {
        assert.strictEqual(res1.value, uuid);
      }

      const res2 = validateIdempotencyKey(nonce);
      assert.strictEqual(res2.ok, true);
      if (res2.ok) {
        assert.strictEqual(res2.value, nonce);
      }
    });

    it("rejects empty, short (<8), or too long (>128) keys", () => {
      const resEmpty = validateIdempotencyKey("");
      assert.strictEqual(resEmpty.ok, false);
      if (!resEmpty.ok) {
        assert.strictEqual(resEmpty.error.code, "INVALID_IDEMPOTENCY_KEY");
      }

      const resShort = validateIdempotencyKey("abc");
      assert.strictEqual(resShort.ok, false);
      if (!resShort.ok) {
        assert.strictEqual(resShort.error.code, "INVALID_IDEMPOTENCY_KEY");
      }

      const resLong = validateIdempotencyKey("a".repeat(129));
      assert.strictEqual(resLong.ok, false);
      if (!resLong.ok) {
        assert.strictEqual(resLong.error.code, "INVALID_IDEMPOTENCY_KEY");
      }
    });

    it("rejects keys with invalid special characters", () => {
      const res = validateIdempotencyKey("key-with-invalid-symbol@#$!");
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "INVALID_IDEMPOTENCY_KEY");
      }
    });
  });

  describe("2. Canonical Request Hash & DynamoDB Condition", () => {
    const sampleRequest: CreateGuestOrderRequest = {
      tenantId: "tenant-yala-safari",
      clientOrderUuid: "uuid-safari-1234-5678",
      locationId: "tent-04",
      items: [
        {
          dishId: "dish-curry",
          dishName: "Sri Lankan Black Pork Curry",
          unitPriceLkr: 2500,
          quantity: 2,
        },
        {
          dishId: "dish-roti",
          dishName: "Godamba Roti Basket",
          unitPriceLkr: 800,
          quantity: 1,
        },
      ],
      paymentMethod: "ROOM_FOLIO",
      actorId: "guest-safari-04",
      folioId: "folio-9988",
    };

    it("produces deterministic SHA-256 hash regardless of item ordering", () => {
      const hash1 = computeOrderRequestHash(sampleRequest);

      // Reordered items in request
      const reversedRequest: CreateGuestOrderRequest = {
        ...sampleRequest,
        items: [...sampleRequest.items].reverse(),
      };
      const hash2 = computeOrderRequestHash(reversedRequest);

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 64);
    });

    it("generates DynamoDB condition expression attribute_not_exists(PK)", () => {
      const condition = buildDynamoDbIdempotencyCondition("tenant-galle", "client-uuid-999");
      assert.strictEqual(condition.conditionExpression, "attribute_not_exists(PK)");
      assert.strictEqual(
        condition.keyExpression.PK,
        "TENANT#tenant-galle#IDEMPOTENCY#client-uuid-999",
      );
      assert.strictEqual(condition.keyExpression.SK, "RECORD");
    });

    it("builds complete IdempotencyRecord with TTL", () => {
      const record: IdempotencyRecord = buildIdempotencyRecord(
        sampleRequest,
        "ORD-TEST-001",
        6425.5,
        86400,
      );

      assert.strictEqual(record.status, "COMPLETED");
      assert.strictEqual(record.orderId, "ORD-TEST-001");
      assert.strictEqual(record.grandTotalLkr, 6425.5);
      assert.ok(record.expiresAtTtl > Math.floor(Date.now() / 1000));
    });
  });

  describe("3. processGuestOrderIdempotency Engine", () => {
    it("validates missing tenantId, locationId, or empty items", () => {
      const resNoTenant = processGuestOrderIdempotency({
        tenantId: "",
        clientOrderUuid: "uuid-order-12345",
        locationId: "room-101",
        items: [{ dishId: "d1", dishName: "Tea", unitPriceLkr: 500, quantity: 1 }],
        paymentMethod: "CASH",
        actorId: "runner-1",
      });
      assert.strictEqual(resNoTenant.ok, false);

      const resNoItems = processGuestOrderIdempotency({
        tenantId: "tenant-1",
        clientOrderUuid: "uuid-order-12345",
        locationId: "room-101",
        items: [],
        paymentMethod: "CASH",
        actorId: "runner-1",
      });
      assert.strictEqual(resNoItems.ok, false);
      if (!resNoItems.ok) {
        assert.strictEqual(resNoItems.error.code, "INVALID_ORDER_ITEMS");
      }
    });

    it("successfully computes 4-stage statutory taxes and generates audit hash chain", () => {
      const items: ReadonlyArray<GuestOrderItemInput> = [
        {
          dishId: "dish-kottu",
          dishName: "Cheese Chicken Kottu",
          unitPriceLkr: 2000,
          quantity: 2, // 4,000
          modifiersTotalLkr: 200, // +400 = 4,400
        },
        {
          dishId: "dish-tea",
          dishName: "Ceylon Dilmah Pot",
          unitPriceLkr: 600,
          quantity: 1, // 600
        },
      ];
      // Total base: 4,400 + 600 = 5,000

      const result = processGuestOrderIdempotency({
        tenantId: "tenant-colombo-resort",
        clientOrderUuid: "client-order-nonce-2026",
        locationId: "room-204",
        items,
        paymentMethod: "ROOM_FOLIO",
        actorId: "guest-session-runner",
      });

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const val = result.value;
        assert.strictEqual(val.tenantId, "tenant-colombo-resort");
        assert.strictEqual(val.locationId, "room-204");
        assert.strictEqual(val.subtotalBaseLkr, 5000);
        assert.strictEqual(val.netTaxableSupplyLkr, 5000);

        // 4-stage tax verification:
        // Base = 5,000
        // SC 10% = 500 -> Subtotal A = 5,500
        // TDL 1% = 55
        // SSCL 2.5% = 137.5
        // VAT Base = 5,500 + 55 + 137.5 = 5,692.5
        // VAT 18% = 1,024.65
        // Grand Total = 5,500 + 55 + 137.5 + 1,024.65 = 6,717.15
        assert.strictEqual(val.taxBreakdown.scLkr, 500);
        assert.strictEqual(val.taxBreakdown.subtotalAfterScLkr, 5500);
        assert.strictEqual(val.taxBreakdown.tdlLkr, 55);
        assert.strictEqual(val.taxBreakdown.ssclLkr, 137.5);
        assert.strictEqual(val.taxBreakdown.vatLkr, 1024.65);
        assert.strictEqual(val.grandTotalLkr, 6717.15);

        // Idempotency DynamoDB condition check
        assert.strictEqual(val.dynamoDbCondition.conditionExpression, "attribute_not_exists(PK)");

        // Hash-chained audit entry check
        assert.strictEqual(val.auditEntry.action, "GUEST_ORDER_SUBMITTED");
        assert.strictEqual(val.auditEntry.entityType, "ORDER");
        assert.strictEqual(val.auditEntry.entryHash.length, 64);
      }
    });

    it("applies meal plan deduction and recalculates statutory taxes correctly", () => {
      const items: ReadonlyArray<GuestOrderItemInput> = [
        {
          dishId: "dish-breakfast",
          dishName: "English Breakfast Set",
          unitPriceLkr: 3000,
          quantity: 2,
          isMealPlanCovered: true, // 6,000 covered
          modifiersTotalLkr: 500, // 1,000 extra upgrade
        },
      ];
      // Subtotal base: (3000 + 500) * 2 = 7,000
      // Meal plan deduction: 3000 * 2 = 6,000
      // Net taxable supply: 1,000

      const result = processGuestOrderIdempotency({
        tenantId: "tenant-bentota-villas",
        clientOrderUuid: "uuid-bentota-778899",
        locationId: "villa-03",
        items,
        paymentMethod: "LANKA_QR",
        actorId: "guest-villa-03",
      });

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const val = result.value;
        assert.strictEqual(val.subtotalBaseLkr, 7000);
        assert.strictEqual(val.mealPlanDeductionLkr, 6000);
        assert.strictEqual(val.netTaxableSupplyLkr, 1000);

        // Taxes computed on 1,000:
        // Base = 1,000
        // SC 10% = 100 -> Subtotal A = 1,100
        // TDL 1% = 11
        // SSCL 2.5% = 27.5
        // VAT Base = 1,100 + 11 + 27.5 = 1,138.5
        // VAT 18% = 204.93
        // Grand Total = 1,100 + 11 + 27.5 + 204.93 = 1,343.43
        assert.strictEqual(val.taxBreakdown.scLkr, 100);
        assert.strictEqual(val.taxBreakdown.tdlLkr, 11);
        assert.strictEqual(val.taxBreakdown.ssclLkr, 27.5);
        assert.strictEqual(val.taxBreakdown.vatLkr, 204.93);
        assert.strictEqual(val.grandTotalLkr, 1343.43);
      }
    });
  });
});
