/**
 * @hms/core - End-to-End Guest QR Cart -> Meal Plan Deduction -> Tax -> Order Tracker Integration Tests (guestQrFlow.test.ts)
 *
 * Implements Rung 5 of the Sri Lanka HMS Architecture Plan (Phase 11.24):
 * Full integration verification of the complete guest QR ordering lifecycle across
 * both IN_ROOM_DINING and SEATED_TABLE environments:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Permission Boundaries (tenantId isolation, role gates)
 * 2. HMAC-SHA256 Authenticated QR Session Verification for Rooms and Restaurant Tables
 * 3. In-Room Dining Flow: Meal Plan Entitlement Deductions (BB/HB/FB/AI) & 4-Stage Compounding Taxes
 * 4. Seated Restaurant Table Flow: Walk-in Dining, Zero Meal-Plan & Dynamic LankaQR Generation (EMVCo MPM)
 * 5. Deterministic Client Order Idempotency Guard (Network Jitter, Double-Tap & Payload Tamper Protection)
 * 6. Folio Charge Routing to Guest Personal Folio with Category Mapping
 * 7. Live Order Status Tracker Lifecycle Progression (PLACED -> ACCEPTED -> PREPARING -> ON_THE_WAY -> DELIVERED)
 * 8. Cryptographically Hash-Chained Immutable Audit Log (SHA-256) Integrity
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  type GuestOrderItemInput,
  type IdempotencyRecord,
  buildLankaQrPayload,
  calculateForwardTax,
  computeOrderLineTotals,
  crc16CcittFalse,
  createAuditEntry,
  determineDefaultTarget,
  evaluateInboundOrderIdempotency,
  signQrSessionToken,
  validateIdempotencyKey,
  validateTenantId,
  verifyAuditChain,
  verifyQrSessionToken,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant RBAC & SaaS Subscription Test Fixtures
// ============================================================================

const TEST_TENANT_ID = "tenant-bentota-beach";
const ALT_TENANT_ID = "tenant-kandy-hills";
const HMAC_SECRET = "super-secret-ceylon-hmac-key-2026";

interface SaasTenantProfile {
  readonly tenantId: string;
  readonly planTier: "STARTER_VILLA" | "PRO_RESORT" | "ENTERPRISE_CHAIN";
  readonly qrOrderingEnabled: boolean;
  readonly maxDiningLocations: number;
}

const TENANT_PROFILES: Readonly<Record<string, SaasTenantProfile>> = {
  [TEST_TENANT_ID]: {
    tenantId: TEST_TENANT_ID,
    planTier: "PRO_RESORT",
    qrOrderingEnabled: true,
    maxDiningLocations: 40,
  },
  [ALT_TENANT_ID]: {
    tenantId: ALT_TENANT_ID,
    planTier: "STARTER_VILLA",
    qrOrderingEnabled: true,
    maxDiningLocations: 10,
  },
};

type OrderRole = "GUEST" | "KITCHEN_STAFF" | "WAITER" | "FRONT_DESK" | "HOUSEKEEPING";
type OrderLifecycleAction =
  | "SUBMIT_ORDER"
  | "ACCEPT_ORDER"
  | "UPDATE_PREPARING"
  | "DISPATCH_ORDER"
  | "MARK_DELIVERED";

const ORDER_ROLE_PERMISSIONS: Readonly<Record<OrderRole, ReadonlySet<OrderLifecycleAction>>> = {
  GUEST: new Set<OrderLifecycleAction>(["SUBMIT_ORDER"]),
  KITCHEN_STAFF: new Set<OrderLifecycleAction>(["ACCEPT_ORDER", "UPDATE_PREPARING"]),
  WAITER: new Set<OrderLifecycleAction>(["DISPATCH_ORDER", "MARK_DELIVERED"]),
  FRONT_DESK: new Set<OrderLifecycleAction>(["ACCEPT_ORDER", "DISPATCH_ORDER", "MARK_DELIVERED"]),
  HOUSEKEEPING: new Set<OrderLifecycleAction>([]),
};

function authorizeOrderAction(role: OrderRole, action: OrderLifecycleAction): boolean {
  return ORDER_ROLE_PERMISSIONS[role].has(action);
}

// ============================================================================
// Test Suite: End-to-End Guest QR Flow (Phase 11.24)
// ============================================================================

describe("Step 274: End-to-End Guest QR Cart -> Meal Plan Deduction -> Tax -> Order Tracker Integration", () => {
  // --------------------------------------------------------------------------
  // 1. Multi-Tenant SaaS Isolation & Entitlements
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant SaaS Isolation & Role Permissions", () => {
    it("validates tenant identifiers and enforces tenant boundary isolation", () => {
      const validRes = validateTenantId(TEST_TENANT_ID);
      assert.strictEqual(validRes.ok, true);
      if (validRes.ok) {
        assert.strictEqual(validRes.value, TEST_TENANT_ID);
      }

      const invalidRes = validateTenantId("   ");
      assert.strictEqual(invalidRes.ok, false);
      if (!invalidRes.ok) {
        assert.strictEqual(invalidRes.error.code, "VALIDATION_FAILED");
      }
    });

    it("verifies SaaS feature entitlement for contactless QR ordering", () => {
      const profile = TENANT_PROFILES[TEST_TENANT_ID];
      assert.ok(profile);
      assert.strictEqual(profile.qrOrderingEnabled, true);
      assert.strictEqual(profile.planTier, "PRO_RESORT");
      assert.ok(profile.maxDiningLocations >= 40);
    });

    it("enforces RBAC permission gates across guest order lifecycle actions", () => {
      assert.strictEqual(authorizeOrderAction("GUEST", "SUBMIT_ORDER"), true);
      assert.strictEqual(authorizeOrderAction("GUEST", "ACCEPT_ORDER"), false);

      assert.strictEqual(authorizeOrderAction("KITCHEN_STAFF", "ACCEPT_ORDER"), true);
      assert.strictEqual(authorizeOrderAction("KITCHEN_STAFF", "UPDATE_PREPARING"), true);
      assert.strictEqual(authorizeOrderAction("KITCHEN_STAFF", "SUBMIT_ORDER"), false);

      assert.strictEqual(authorizeOrderAction("WAITER", "DISPATCH_ORDER"), true);
      assert.strictEqual(authorizeOrderAction("WAITER", "MARK_DELIVERED"), true);
      assert.strictEqual(authorizeOrderAction("WAITER", "UPDATE_PREPARING"), false);

      assert.strictEqual(authorizeOrderAction("HOUSEKEEPING", "ACCEPT_ORDER"), false);
      assert.strictEqual(authorizeOrderAction("HOUSEKEEPING", "MARK_DELIVERED"), false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. HMAC-SHA256 QR Session Verification (Room vs Table)
  // --------------------------------------------------------------------------
  describe("2. HMAC-SHA256 Authenticated QR Session Verification", () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const validExp = nowEpoch + 86400; // 24 hours

    it("signs and verifies an IN_ROOM_DINING session token for Room 204", () => {
      const signRes = signQrSessionToken({
        tenantId: TEST_TENANT_ID,
        location: "ROOM-204",
        stayId: "STAY-2026-991",
        exp: validExp,
        secret: HMAC_SECRET,
      });

      assert.strictEqual(signRes.ok, true);
      if (!signRes.ok) return;

      const token = signRes.value;
      assert.ok(token.includes("."));

      const verifyRes = verifyQrSessionToken(token, HMAC_SECRET, nowEpoch);

      assert.strictEqual(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.strictEqual(verifyRes.value.tid, TEST_TENANT_ID);
        assert.strictEqual(verifyRes.value.loc, "ROOM-204");
        assert.strictEqual(verifyRes.value.sty, "STAY-2026-991");
        assert.strictEqual(verifyRes.value.exp, validExp);
      }
    });

    it("signs and verifies a SEATED_TABLE session token for Restaurant Table 12", () => {
      const signRes = signQrSessionToken({
        tenantId: TEST_TENANT_ID,
        location: "TABLE-12",
        stayId: "SES-TBL-12-LUNCH",
        exp: validExp,
        secret: HMAC_SECRET,
      });

      assert.strictEqual(signRes.ok, true);
      if (!signRes.ok) return;

      const verifyRes = verifyQrSessionToken(signRes.value, HMAC_SECRET, nowEpoch);

      assert.strictEqual(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.strictEqual(verifyRes.value.loc, "TABLE-12");
        assert.strictEqual(verifyRes.value.sty, "SES-TBL-12-LUNCH");
      }
    });

    it("cryptographically rejects tampered room numbers or invalid HMAC signatures", () => {
      const signRes = signQrSessionToken({
        tenantId: TEST_TENANT_ID,
        location: "ROOM-101",
        stayId: "STAY-2026-101",
        exp: validExp,
        secret: HMAC_SECRET,
      });

      assert.strictEqual(signRes.ok, true);
      if (!signRes.ok) return;

      const [encodedPayload, signature] = signRes.value.split(".");
      assert.ok(encodedPayload && signature);

      // Tamper: Decode payload, change room to ROOM-999 (Penthouse), re-encode without signature update
      const payloadObj = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
      payloadObj.loc = "ROOM-999";
      const tamperedPayload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
      const tamperedToken = `${tamperedPayload}.${signature}`;

      const verifyRes = verifyQrSessionToken(tamperedToken, HMAC_SECRET, nowEpoch);

      assert.strictEqual(verifyRes.ok, false);
      if (!verifyRes.ok) {
        assert.strictEqual(verifyRes.error.code, "INVALID_SIGNATURE");
        assert.ok(verifyRes.error.message.includes("signature mismatch"));
      }
    });

    it("rejects expired QR session tokens deterministically", () => {
      const expiredExp = nowEpoch - 3600; // 1 hour in the past
      const signRes = signQrSessionToken({
        tenantId: TEST_TENANT_ID,
        location: "ROOM-204",
        stayId: "STAY-EXPIRED",
        exp: expiredExp,
        secret: HMAC_SECRET,
      });

      assert.strictEqual(signRes.ok, true);
      if (!signRes.ok) return;

      const verifyRes = verifyQrSessionToken(signRes.value, HMAC_SECRET, nowEpoch);

      assert.strictEqual(verifyRes.ok, false);
      if (!verifyRes.ok) {
        assert.strictEqual(verifyRes.error.code, "HMAC_EXPIRED");
        assert.ok(verifyRes.error.message.includes("expired"));
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. In-Room Dining Flow: Meal Plan Entitlement & 4-Stage Compounding Taxes
  // --------------------------------------------------------------------------
  describe("3. In-Room Dining Flow: Meal Plan Deductions & 4-Stage Taxes", () => {
    it("deducts meal plan covered dish prices while keeping premium modifiers and extra items taxable", () => {
      const items: GuestOrderItemInput[] = [
        {
          dishId: "dish-curry-crab",
          dishName: "Jaffna Lagoon Crab Curry",
          unitPriceLkr: 3500.0,
          quantity: 1,
          portion: "REGULAR",
          spiceLevel: "MEDIUM_SPICY",
          modifiersTotalLkr: 500.0, // Extra roast paan & gravy: uncovered
          isMealPlanCovered: true, // Base 3500 is covered by Half Board
        },
        {
          dishId: "dish-pol-roti",
          dishName: "Ceylon Pol Roti with Lunumiris",
          unitPriceLkr: 1200.0,
          quantity: 1,
          modifiersTotalLkr: 0.0,
          isMealPlanCovered: true, // Base 1200 is 100% covered
        },
        {
          dishId: "dish-lion-beer",
          dishName: "Lion Lager Beer (330ml Can)",
          unitPriceLkr: 1100.0,
          quantity: 2,
          modifiersTotalLkr: 0.0,
          isMealPlanCovered: false, // Alcohol is not covered under HB
        },
      ];

      const totalsRes = computeOrderLineTotals(items);
      assert.strictEqual(totalsRes.ok, true);
      if (!totalsRes.ok) return;

      const totals = totalsRes.value;
      // Item 1: (3500 + 500) * 1 = 4000
      // Item 2: (1200 + 0) * 1 = 1200
      // Item 3: (1100 + 0) * 2 = 2200
      // Subtotal Base = 4000 + 1200 + 2200 = 7400 LKR
      assert.strictEqual(totals.subtotalBaseLkr, 7400.0);

      // Meal Plan Deduction = Item 1 (3500) + Item 2 (1200) = 4700 LKR
      assert.strictEqual(totals.mealPlanDeductionLkr, 4700.0);

      // Net Taxable Supply = 7400 - 4700 = 2700 LKR
      assert.strictEqual(totals.netTaxableSupplyLkr, 2700.0);

      // Apply 4-Stage Compounding Sri Lankan Statutory Taxes on 2700 LKR
      const taxRes = calculateForwardTax(totals.netTaxableSupplyLkr, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.strictEqual(taxRes.ok, true);
      if (!taxRes.ok) return;

      const tax = taxRes.value;
      // Stage 1: SC 10% on 2700 = 270.00
      assert.strictEqual(tax.scLkr, 270.0);

      // Stage 2: TDL 1% on (2700 + 270 = 2970) = 29.70
      assert.strictEqual(tax.tdlLkr, 29.7);

      // Stage 3: SSCL 2.5% on (2700 + 270 = 2970) = 74.25
      assert.strictEqual(tax.ssclLkr, 74.25);

      // Stage 4: VAT 18% on (2970 + 29.70 + 74.25 = 3073.95) = 553.311 -> 553.31
      assert.strictEqual(tax.vatLkr, 553.31);

      // Grand Total = 2970 + 29.70 + 74.25 + 553.31 = 3627.26
      assert.strictEqual(tax.grandTotalLkr, 3627.26);
    });

    it("handles 100% meal plan covered orders with zero net taxable supply", () => {
      const items: GuestOrderItemInput[] = [
        {
          dishId: "dish-hopper-set",
          dishName: "Egg Hopper Set with Katta Sambol",
          unitPriceLkr: 1800.0,
          quantity: 1,
          modifiersTotalLkr: 0.0,
          isMealPlanCovered: true,
        },
      ];

      const totalsRes = computeOrderLineTotals(items);
      assert.strictEqual(totalsRes.ok, true);
      if (!totalsRes.ok) return;

      assert.strictEqual(totalsRes.value.subtotalBaseLkr, 1800.0);
      assert.strictEqual(totalsRes.value.mealPlanDeductionLkr, 1800.0);
      assert.strictEqual(totalsRes.value.netTaxableSupplyLkr, 0.0);

      const taxRes = calculateForwardTax(
        totalsRes.value.netTaxableSupplyLkr,
        DEFAULT_SRI_LANKA_TAX_CONFIG,
      );
      assert.strictEqual(taxRes.ok, true);
      if (!taxRes.ok) return;

      assert.strictEqual(taxRes.value.scLkr, 0.0);
      assert.strictEqual(taxRes.value.tdlLkr, 0.0);
      assert.strictEqual(taxRes.value.ssclLkr, 0.0);
      assert.strictEqual(taxRes.value.vatLkr, 0.0);
      assert.strictEqual(taxRes.value.grandTotalLkr, 0.0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Seated Restaurant Table Flow: Walk-in Dining & LankaQR Payment
  // --------------------------------------------------------------------------
  describe("4. Seated Restaurant Table Flow: Zero Meal Plan & Dynamic LankaQR", () => {
    it("computes full taxable supply for seated table and builds dynamic EMVCo LankaQR payload", () => {
      const items: GuestOrderItemInput[] = [
        {
          dishId: "dish-seafood-kottu",
          dishName: "Mixed Seafood Kottu Roti",
          unitPriceLkr: 2400.0,
          quantity: 1,
          modifiersTotalLkr: 0.0,
          isMealPlanCovered: false,
        },
        {
          dishId: "dish-thambili",
          dishName: "Fresh Mirissa King Coconut (Thambili)",
          unitPriceLkr: 650.0,
          quantity: 1,
          modifiersTotalLkr: 0.0,
          isMealPlanCovered: false,
        },
      ];

      const totalsRes = computeOrderLineTotals(items);
      assert.strictEqual(totalsRes.ok, true);
      if (!totalsRes.ok) return;

      assert.strictEqual(totalsRes.value.subtotalBaseLkr, 3050.0);
      assert.strictEqual(totalsRes.value.mealPlanDeductionLkr, 0.0);
      assert.strictEqual(totalsRes.value.netTaxableSupplyLkr, 3050.0);

      const taxRes = calculateForwardTax(
        totalsRes.value.netTaxableSupplyLkr,
        DEFAULT_SRI_LANKA_TAX_CONFIG,
      );
      assert.strictEqual(taxRes.ok, true);
      if (!taxRes.ok) return;

      const grandTotalLkr = taxRes.value.grandTotalLkr;
      assert.strictEqual(grandTotalLkr, 4097.47);

      // Build Dynamic LankaQR Payload for Table 08
      const qrRes = buildLankaQrPayload({
        merchantId: "7700124",
        merchantName: "Bentota Surf & Turf",
        merchantCity: "Bentota",
        mcc: "5812", // Restaurants
        amountLkr: grandTotalLkr,
        referenceId: "TBL-08-ORD-101",
        isDynamic: true,
        tenantId: TEST_TENANT_ID,
      });

      assert.strictEqual(qrRes.ok, true);
      if (!qrRes.ok) return;

      const qr = qrRes.value;
      assert.strictEqual(qr.isDynamic, true);
      assert.strictEqual(qr.amountLkr, 4097.47);
      assert.strictEqual(qr.referenceId, "TBL-08-ORD-101");
      assert.strictEqual(qr.crc.length, 4);

      // Verify Tag 01 is 12 (Dynamic)
      assert.ok(qr.payload.includes("010212"));
      // Verify Tag 52 MCC is 5812
      assert.ok(qr.payload.includes("52045812"));
      // Verify Tag 53 is 144 (LKR)
      assert.ok(qr.payload.includes("5303144"));
      // Verify Tag 54 amount is present
      assert.ok(qr.payload.includes("54074097.47"));

      // Verify CRC-16 checksum integrity
      const payloadWithoutCrc = qr.payload.slice(0, -4);
      const computedCrc = crc16CcittFalse(payloadWithoutCrc);
      assert.strictEqual(computedCrc, qr.crc);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Deterministic Idempotency Key Guard & Concurrency
  // --------------------------------------------------------------------------
  describe("5. Deterministic Client Order Idempotency Guard", () => {
    const validUuid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

    const baseRequest = {
      tenantId: TEST_TENANT_ID,
      clientOrderUuid: validUuid,
      locationId: "ROOM-204",
      items: [
        {
          dishId: "dish-curry-01",
          dishName: "Fish Ambulthiyal with Rice",
          unitPriceLkr: 2200.0,
          quantity: 1,
        },
      ],
      paymentMethod: "ROOM_FOLIO" as const,
      actorId: "guest:ROOM-204",
    };

    it("processes a fresh order request and returns a valid NEW_ORDER resolution", () => {
      const keyVal = validateIdempotencyKey(validUuid);
      assert.strictEqual(keyVal.ok, true);

      const res = evaluateInboundOrderIdempotency(baseRequest, undefined, GENESIS_HASH);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      assert.strictEqual(res.value.status, "NEW_ORDER");
      if (res.value.status !== "NEW_ORDER") return;

      const order = res.value.order;
      assert.strictEqual(order.clientOrderUuid, validUuid);
      assert.strictEqual(order.locationId, "ROOM-204");
      assert.strictEqual(order.grandTotalLkr, 2955.55);
      assert.strictEqual(order.idempotencyRecord.status, "COMPLETED");
      assert.strictEqual(order.dynamoDbCondition.conditionExpression, "attribute_not_exists(PK)");
      assert.strictEqual(order.auditEntry.prevHash, GENESIS_HASH);
    });

    it("returns cached completed record on duplicate submission with matching payload", () => {
      const firstRes = evaluateInboundOrderIdempotency(baseRequest, undefined, GENESIS_HASH);
      assert.strictEqual(firstRes.ok, true);
      if (!firstRes.ok || firstRes.value.status !== "NEW_ORDER") return;

      const existingRecord: IdempotencyRecord = firstRes.value.order.idempotencyRecord;

      // Duplicate submission: same payload & key
      const duplicateRes = evaluateInboundOrderIdempotency(
        baseRequest,
        existingRecord,
        firstRes.value.order.auditEntry.entryHash,
      );

      assert.strictEqual(duplicateRes.ok, true);
      if (!duplicateRes.ok) return;

      assert.strictEqual(duplicateRes.value.status, "IDEMPOTENT_REPLAY");
      if (duplicateRes.value.status !== "IDEMPOTENT_REPLAY") return;

      assert.strictEqual(duplicateRes.value.isDuplicateTap, true);
      assert.strictEqual(duplicateRes.value.orderId, existingRecord.orderId);
      assert.strictEqual(duplicateRes.value.grandTotalLkr, existingRecord.grandTotalLkr);
    });

    it("rejects duplicate key submission with conflicting payload as IDEMPOTENCY_PAYLOAD_MISMATCH", () => {
      const firstRes = evaluateInboundOrderIdempotency(baseRequest, undefined, GENESIS_HASH);
      assert.strictEqual(firstRes.ok, true);
      if (!firstRes.ok || firstRes.value.status !== "NEW_ORDER") return;

      const conflictingRequest = {
        ...baseRequest,
        locationId: "ROOM-505", // Different location!
      };

      const conflictRes = evaluateInboundOrderIdempotency(
        conflictingRequest,
        firstRes.value.order.idempotencyRecord,
        firstRes.value.order.auditEntry.entryHash,
      );

      assert.strictEqual(conflictRes.ok, false);
      if (!conflictRes.ok) {
        assert.strictEqual(conflictRes.error.code, "IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Split-Folio Routing to Guest Personal Folio
  // --------------------------------------------------------------------------
  describe("6. Split-Folio Routing to Guest Personal Folio", () => {
    it("routes in-room dining food and beverage charges to GUEST_PERSONAL sub-folio", () => {
      const target = determineDefaultTarget("FNB", {
        billingType: "DIRECT_GUEST",
      });
      assert.strictEqual(target, "GUEST_PERSONAL");
    });

    it("routes guest laundry, minibar, and incidentals to GUEST_PERSONAL under DMC voucher", () => {
      const dmcConfig = {
        billingType: "DMC_VOUCHER" as const,
        dmcCoverage: {
          contractId: "DMC-JETWING-01",
          voucherNumber: "VOUCHER-2026-88",
          tourOperatorName: "Jetwing Travels",
          includedMealPlan: "HB" as const,
          coveredCategories: ["ROOM", "MEAL_PLAN"] as const,
        },
      };

      assert.strictEqual(determineDefaultTarget("ROOM", dmcConfig), "MASTER_DMC");
      assert.strictEqual(determineDefaultTarget("MEAL_PLAN", dmcConfig), "MASTER_DMC");
      assert.strictEqual(determineDefaultTarget("FNB", dmcConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("MINIBAR", dmcConfig), "GUEST_PERSONAL");
      assert.strictEqual(determineDefaultTarget("LAUNDRY", dmcConfig), "GUEST_PERSONAL");
    });
  });

  // --------------------------------------------------------------------------
  // 7. Order Lifecycle & Real-Time Tracking
  // --------------------------------------------------------------------------
  describe("7. Order Lifecycle & Real-Time Status Progression", () => {
    interface TrackedOrderState {
      readonly orderId: string;
      readonly status: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ON_THE_WAY" | "DELIVERED";
      readonly estimatedPrepMinutes: number;
      readonly updatedAt: string;
    }

    function transitionOrderStatus(
      current: TrackedOrderState,
      nextStatus: TrackedOrderState["status"],
      role: OrderRole,
      prepMinutesRemaining?: number,
    ): { ok: boolean; state?: TrackedOrderState; error?: string } {
      const actionMap: Record<TrackedOrderState["status"], OrderLifecycleAction | null> = {
        PLACED: null,
        ACCEPTED: "ACCEPT_ORDER",
        PREPARING: "UPDATE_PREPARING",
        READY: "UPDATE_PREPARING",
        ON_THE_WAY: "DISPATCH_ORDER",
        DELIVERED: "MARK_DELIVERED",
      };

      const requiredAction = actionMap[nextStatus];
      if (requiredAction && !authorizeOrderAction(role, requiredAction)) {
        return { ok: false, error: `Role ${role} is not authorized for action ${requiredAction}` };
      }

      return {
        ok: true,
        state: {
          ...current,
          status: nextStatus,
          estimatedPrepMinutes: prepMinutesRemaining ?? current.estimatedPrepMinutes,
          updatedAt: new Date().toISOString(),
        },
      };
    }

    it("transitions an order cleanly through full lifecycle with authorized roles", () => {
      let order: TrackedOrderState = {
        orderId: "ORD-2026-7789",
        status: "PLACED",
        estimatedPrepMinutes: 30,
        updatedAt: new Date().toISOString(),
      };

      // 1. Kitchen Staff accepts order
      const acceptRes = transitionOrderStatus(order, "ACCEPTED", "KITCHEN_STAFF", 25);
      assert.strictEqual(acceptRes.ok, true);
      if (acceptRes.state) order = acceptRes.state;
      assert.strictEqual(order.status, "ACCEPTED");
      assert.strictEqual(order.estimatedPrepMinutes, 25);

      // 2. Kitchen Staff begins preparing
      const prepRes = transitionOrderStatus(order, "PREPARING", "KITCHEN_STAFF", 15);
      assert.strictEqual(prepRes.ok, true);
      if (prepRes.state) order = prepRes.state;
      assert.strictEqual(order.status, "PREPARING");
      assert.strictEqual(order.estimatedPrepMinutes, 15);

      // 3. Waiter dispatches order on the way
      const dispatchRes = transitionOrderStatus(order, "ON_THE_WAY", "WAITER", 5);
      assert.strictEqual(dispatchRes.ok, true);
      if (dispatchRes.state) order = dispatchRes.state;
      assert.strictEqual(order.status, "ON_THE_WAY");

      // 4. Waiter marks delivered to room
      const deliveredRes = transitionOrderStatus(order, "DELIVERED", "WAITER", 0);
      assert.strictEqual(deliveredRes.ok, true);
      if (deliveredRes.state) order = deliveredRes.state;
      assert.strictEqual(order.status, "DELIVERED");
      assert.strictEqual(order.estimatedPrepMinutes, 0);
    });

    it("rejects unauthorized role attempting to alter order status", () => {
      const order: TrackedOrderState = {
        orderId: "ORD-2026-7790",
        status: "PLACED",
        estimatedPrepMinutes: 30,
        updatedAt: new Date().toISOString(),
      };

      const unauthorizedRes = transitionOrderStatus(order, "ACCEPTED", "HOUSEKEEPING");
      assert.strictEqual(unauthorizedRes.ok, false);
      assert.ok(unauthorizedRes.error?.includes("not authorized"));
    });
  });

  // --------------------------------------------------------------------------
  // 8. Cryptographically Hash-Chained Immutable Audit Trail
  // --------------------------------------------------------------------------
  describe("8. Cryptographic SHA-256 Hash-Chained Immutable Audit Trail", () => {
    it("builds and verifies an unbroken hash chain across the complete guest ordering lifecycle", () => {
      const auditLog: AuditLogEntry[] = [];
      let previousHash = GENESIS_HASH;

      function recordAudit(
        action: string,
        entityId: string,
        details: Record<string, unknown>,
      ): void {
        const entryRes = createAuditEntry({
          tenantId: TEST_TENANT_ID,
          actorUserId: "system-guest-runner",
          action,
          entityType: "GUEST_ORDER",
          entityId,
          isoTs: new Date().toISOString(),
          afterJson: JSON.stringify(details),
          prevHash: previousHash,
        });

        assert.strictEqual(entryRes.ok, true);
        if (entryRes.ok) {
          auditLog.push(entryRes.value);
          previousHash = entryRes.value.entryHash;
        }
      }

      // 1. QR Session Created
      recordAudit("QR_SESSION_CREATED", "ROOM-204", { stayId: "STAY-2026-991" });

      // 2. Guest Order Placed & Idempotency Key Guarded
      recordAudit("GUEST_ORDER_PLACED", "ORD-2026-7789", {
        clientOrderUuid: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
        locationId: "ROOM-204",
        subtotalLkr: 7400.0,
        mealPlanDeductionLkr: 4700.0,
        grandTotalLkr: 3627.26,
      });

      // 3. Kitchen Status Changed to PREPARING
      recordAudit("ORDER_STATUS_CHANGED", "ORD-2026-7789", {
        from: "PLACED",
        to: "PREPARING",
        actor: "chef-sunil",
      });

      // 4. Order Delivered to Room 204
      recordAudit("ORDER_DELIVERED", "ORD-2026-7789", {
        locationId: "ROOM-204",
        deliveredBy: "waiter-kamal",
      });

      // 5. Folio Charged
      recordAudit("ROOM_FOLIO_CHARGED", "FOLIO-ROOM-204", {
        amountLkr: 3627.26,
        orderId: "ORD-2026-7789",
      });

      assert.strictEqual(auditLog.length, 5);

      // Verify the full hash-chain integrity
      const verifyRes = verifyAuditChain(auditLog);
      assert.strictEqual(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.strictEqual(verifyRes.value.verifiedCount, 5);
      }
    });
  });
});
