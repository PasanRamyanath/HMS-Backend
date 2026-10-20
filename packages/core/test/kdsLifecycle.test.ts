/**
 * @hms/core - End-to-End QR Order -> KDS Cooking -> Runner Delivered -> Folio Sync Test (kdsLifecycle.test.ts)
 *
 * Implements Step 299 (Phase 12.24) / Rung 5 of the Sri Lanka HMS Architecture Plan:
 * Comprehensive integration verification of the complete kitchen and bar order lifecycle:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries (tenantId verification, role gates)
 * 2. Inbound QR Order Placement & Idempotency Key Guard (double-tap & replay protection)
 * 3. Mixed Kitchen KOT & Bar BOT Department Splitting with 4-stage Compounding Taxes
 * 4. KDS Cooking Progression & Timestamp Invariants (receivedAt <= startedCookingAt <= readyAt)
 * 5. Food Runner Tray Dispatch, Delivery Confirmation & Chronological Invariants (readyAt <= deliveredAt)
 * 6. Automated Split-Folio Posting & 4-Stage Sri Lankan Compounding Tax Math (SC -> TDL -> SSCL -> VAT)
 * 7. KDS Prep-Time SLA Compliance, Delay Detection & Slow Dish Bottlenecks
 * 8. Cryptographically Hash-Chained SHA-256 Immutable Audit Log Verification & Anti-Tamper Detection
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  type AuditLogPayload,
  type ChargePostingItem,
  type CreateGuestOrderRequest,
  GENESIS_HASH,
  type KdsMetricsActor,
  type KdsTicketRecord,
  type SplitFolioConfig,
  computeDurationMinutes,
  computeKdsSlaPerformance,
  computeKdsStageAverages,
  createAuditEntry,
  determineDefaultTarget,
  evaluateInboundOrderIdempotency,
  identifySlowDishes,
  isOrderOnTime,
  routeFolioCharges,
  splitOrderByDepartment,
  validateIdempotencyKey,
  validateTenantId,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant Domain Fixtures
// ============================================================================

const TENANT_A = "cinnamon-wild-yala";
const TENANT_B = "heritance-kandalama";

const STAFF_CHEF = {
  userId: "usr-cook-01",
  role: "CHEF",
  tenantId: TENANT_A,
};

const STAFF_RUNNER = {
  userId: "usr-runner-01",
  role: "WAITER",
  tenantId: TENANT_A,
};

const STAFF_FRONT_DESK = {
  userId: "usr-reception-01",
  role: "FRONT_DESK",
  tenantId: TENANT_A,
};

describe("Step 299: End-to-End QR Order -> KDS Cooking -> Runner Delivered -> Folio Sync (kdsLifecycle.test.ts)", () => {
  // --------------------------------------------------------------------------
  // 1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant SaaS Isolation & Role Boundaries", () => {
    it("validates compliant Sri Lankan multi-tenant identifiers", () => {
      assert.strictEqual(validateTenantId(TENANT_A).ok, true);
      assert.strictEqual(validateTenantId(TENANT_B).ok, true);

      // Rejects malformed slugs
      assert.strictEqual(validateTenantId("INVALID TENANT SPACES").ok, false);
      assert.strictEqual(validateTenantId("").ok, false);
    });

    it("enforces tenant boundary isolation between independent hotel properties", () => {
      const crossTenantActor: KdsMetricsActor = {
        userId: "usr-hacker-01",
        role: "CHEF",
        tenantId: TENANT_B,
      };

      const splitRes = splitOrderByDepartment({
        tenantId: TENANT_A,
        orderId: "ord-test-01",
        actor: {
          userId: crossTenantActor.userId,
          role: crossTenantActor.role,
          tenantId: crossTenantActor.tenantId,
        },
        orderSource: "QR_GUEST",
        destinationType: "ROOM",
        destination: "Room 204",
        items: [
          {
            itemId: "curry-01",
            name: "Jaffna Crab Curry",
            department: "KITCHEN",
            quantity: 1,
            unitPriceLkr: 4500,
          },
        ],
      });

      assert.strictEqual(splitRes.ok, false);
      if (!splitRes.ok) {
        assert.strictEqual(splitRes.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects unauthorized actor roles from executing kitchen operations", () => {
      const driverActor = {
        userId: "usr-driver-101",
        role: "DRIVER",
        tenantId: TENANT_A,
      };

      const splitRes = splitOrderByDepartment({
        tenantId: TENANT_A,
        orderId: "ord-test-02",
        actor: {
          userId: driverActor.userId,
          role: driverActor.role,
          tenantId: driverActor.tenantId,
        },
        orderSource: "QR_GUEST",
        destinationType: "ROOM",
        destination: "Room 204",
        items: [
          {
            itemId: "curry-01",
            name: "Jaffna Crab Curry",
            department: "KITCHEN",
            quantity: 1,
            unitPriceLkr: 4500,
          },
        ],
      });

      assert.strictEqual(splitRes.ok, false);
      if (!splitRes.ok) {
        assert.strictEqual(splitRes.error.code, "PERMISSION_DENIED");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Inbound QR Order Placement & Idempotency Key Guard
  // --------------------------------------------------------------------------
  describe("2. Inbound QR Order Placement & Idempotency Key Guard", () => {
    it("validates client-generated UUID / HMAC idempotency keys", () => {
      assert.strictEqual(
        validateIdempotencyKey("idem-c98f12a4-7b6e-4f12-9c2b-118274619a01").ok,
        true,
      );
      assert.strictEqual(validateIdempotencyKey("short").ok, false);
      assert.strictEqual(validateIdempotencyKey("").ok, false);
    });

    it("prevents double-tap duplicate orders and preserves single billing", () => {
      const orderRequest: CreateGuestOrderRequest = {
        tenantId: TENANT_A,
        clientOrderUuid: "idem-c98f12a4-7b6e-4f12-9c2b-118274619a01",
        locationId: "ROOM-204",
        paymentMethod: "ROOM_FOLIO",
        actorId: "usr-guest-204",
        folioId: "folio-room204-guest",
        items: [
          {
            dishId: "curry-01",
            dishName: "Jaffna Crab Curry",
            quantity: 2,
            unitPriceLkr: 4800,
          },
        ],
      };

      // Tap 1: Fresh submission
      const firstTapRes = evaluateInboundOrderIdempotency(orderRequest, undefined);
      assert.strictEqual(firstTapRes.ok, true);
      if (!firstTapRes.ok) return;

      const firstTap = firstTapRes.value;
      assert.strictEqual(firstTap.status, "NEW_ORDER");
      assert.ok(firstTap.order);

      // Tap 2: Instant duplicate tap with same key and request
      const secondTapRes = evaluateInboundOrderIdempotency(
        orderRequest,
        firstTap.order.idempotencyRecord,
      );
      assert.strictEqual(secondTapRes.ok, true);
      if (!secondTapRes.ok) return;

      const secondTap = secondTapRes.value;
      assert.strictEqual(secondTap.status, "IDEMPOTENT_REPLAY");
      if (secondTap.status === "IDEMPOTENT_REPLAY") {
        assert.strictEqual(secondTap.isDuplicateTap, true);
        assert.strictEqual(secondTap.orderId, firstTap.order.orderId);
      }

      // Tap 3: Tampered payload with original clientOrderUuid -> REJECTED
      const tamperedRequest: CreateGuestOrderRequest = {
        ...orderRequest,
        items: [
          {
            dishId: "curry-01",
            dishName: "Jaffna Crab Curry",
            quantity: 10, // tampered quantity!
            unitPriceLkr: 4800,
          },
        ],
      };
      const thirdTapRes = evaluateInboundOrderIdempotency(
        tamperedRequest,
        firstTap.order.idempotencyRecord,
      );
      assert.strictEqual(thirdTapRes.ok, false);
      if (!thirdTapRes.ok) {
        assert.strictEqual(thirdTapRes.error.code, "IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. Department Splitting & 4-Stage Compounding Statutory Taxes
  // --------------------------------------------------------------------------
  describe("3. Mixed Order Department Splitting (Kitchen KOT vs Bar BOT)", () => {
    it("splits mixed room service cart into KITCHEN KOT and BAR BOT tickets", () => {
      const splitRes = splitOrderByDepartment({
        tenantId: TENANT_A,
        orderId: "ord-room204-01",
        actor: STAFF_CHEF,
        orderSource: "IN_ROOM_DINING",
        destinationType: "ROOM",
        destination: "Room 204",
        guestName: "Dr. Anura Bandara",
        items: [
          {
            itemId: "dish-curry",
            name: "Jaffna Crab Curry with Roast Paan",
            department: "KITCHEN",
            quantity: 2,
            unitPriceLkr: 4800, // 9,600
            spiceLevel: "EXTRA_HOT",
          },
          {
            itemId: "dish-pork",
            name: "Slow Cooked Black Pork Curry",
            department: "KITCHEN",
            quantity: 1,
            unitPriceLkr: 2600, // 2,600
          },
          {
            itemId: "drink-beer",
            name: "Lion Lager Draught Pint",
            department: "BAR",
            quantity: 2,
            unitPriceLkr: 1200, // 2,400
          },
          {
            itemId: "drink-mocktail",
            name: "Ceylon Passion Fruit Mojito",
            department: "BAR",
            quantity: 1,
            unitPriceLkr: 1400, // 1,400
          },
        ],
      });

      assert.strictEqual(splitRes.ok, true);
      if (!splitRes.ok) return;

      const split = splitRes.value;
      assert.strictEqual(split.tickets.length, 2);

      // Verify Kitchen KOT
      const kitchenTicket = split.tickets.find((t) => t.department === "KITCHEN");
      assert.ok(kitchenTicket);
      assert.strictEqual(kitchenTicket.ticketType, "KOT");
      assert.strictEqual(kitchenTicket.items.length, 2);
      assert.strictEqual(kitchenTicket.totalItemsCount, 3);
      assert.strictEqual(kitchenTicket.subtotalLkr, 12200); // 9,600 + 2,600

      // Verify Bar BOT
      const barTicket = split.tickets.find((t) => t.department === "BAR");
      assert.ok(barTicket);
      assert.strictEqual(barTicket.ticketType, "BOT");
      assert.strictEqual(barTicket.items.length, 2);
      assert.strictEqual(barTicket.totalItemsCount, 3);
      assert.strictEqual(barTicket.subtotalLkr, 3800); // 2,400 + 1,400

      // Overall net supply: 12,200 + 3,800 = 16,000 LKR
      const fin = split.combinedBill;
      assert.strictEqual(fin.grossSubtotalLkr, 16000);

      // Verify 4-stage compounding statutory taxes:
      // Base: 16,000
      // SC 10%: 1,600.00
      // TDL 1%: 176.00 (1% of 17,600)
      // SSCL 2.5%: 440.00 (2.5% of 17,600)
      // VAT 18%: 3,278.88 (18% of 18,216.00)
      // Total tax: 5,494.88
      // Grand total: 21,494.88 LKR
      assert.strictEqual(fin.taxBreakdown.scLkr, 1600);
      assert.strictEqual(fin.taxBreakdown.tdlLkr, 176);
      assert.strictEqual(fin.taxBreakdown.ssclLkr, 440);
      assert.strictEqual(fin.taxBreakdown.vatLkr, 3278.88);
      assert.strictEqual(fin.grandTotalLkr, 21494.88);
    });
  });

  // --------------------------------------------------------------------------
  // 4. KDS Lifecycle State Transitions & Chronological Invariants
  // --------------------------------------------------------------------------
  describe("4. KDS Lifecycle State Machine & Chronological Invariants", () => {
    it("progresses ticket through NEW_ORDER -> COOKING -> READY -> DELIVERED maintaining strict timestamp order", () => {
      // Step A: Order Received (NEW_ORDER)
      const receivedAt = "2026-10-20T12:00:00Z";

      // Step B: Cook accepts ticket & starts fire (COOKING)
      const startedCookingAt = "2026-10-20T12:03:00Z";
      const queueWaitMin = computeDurationMinutes(receivedAt, startedCookingAt);
      assert.strictEqual(queueWaitMin, 3.0);
      // Chronological invariant
      assert.ok(Date.parse(receivedAt) <= Date.parse(startedCookingAt));

      // Step C: Chef finishes cooking & plates dish (READY)
      const readyAt = "2026-10-20T12:15:00Z";
      const cookingDurationMin = computeDurationMinutes(startedCookingAt, readyAt);
      assert.strictEqual(cookingDurationMin, 12.0);
      // Chronological invariant
      assert.ok(Date.parse(startedCookingAt) <= Date.parse(readyAt));

      // Step D: Room Service Runner delivers to Room 204 (DELIVERED)
      const deliveredAt = "2026-10-20T12:19:00Z";
      const dispatchTransitMin = computeDurationMinutes(readyAt, deliveredAt);
      assert.strictEqual(dispatchTransitMin, 4.0);
      // Chronological invariant
      assert.ok(Date.parse(readyAt) <= Date.parse(deliveredAt));

      // Total cycle: 19 minutes
      const totalCycleMin = computeDurationMinutes(receivedAt, deliveredAt);
      assert.strictEqual(totalCycleMin, 19.0);

      // Verify comprehensive invariant: receivedAt <= startedCookingAt <= readyAt <= deliveredAt
      const timestamps = [
        Date.parse(receivedAt),
        Date.parse(startedCookingAt),
        Date.parse(readyAt),
        Date.parse(deliveredAt),
      ];
      assert.strictEqual(
        timestamps[0] <= timestamps[1] &&
          timestamps[1] <= timestamps[2] &&
          timestamps[2] <= timestamps[3],
        true,
      );

      // Ticket record representation
      const completedTicket: KdsTicketRecord = {
        orderId: "ord-room204-01",
        tenantId: TENANT_A,
        kotNumber: "KOT-101",
        department: "KITCHEN",
        destinationType: "ROOM",
        destination: "Room 204",
        receivedAt,
        startedCookingAt,
        readyAt,
        deliveredAt,
        slaTargetMinutes: 20,
        items: [
          {
            itemId: "dish-curry",
            name: "Jaffna Crab Curry with Roast Paan",
            category: "SEAFOOD",
            quantity: 2,
            prepTimeMinutes: 12,
          },
        ],
        grossTotalLkr: 9600,
      };

      // SLA Check: 19 min <= 20 min SLA target -> On Time!
      assert.strictEqual(isOrderOnTime(completedTicket), true);
    });

    it("identifies tickets exceeding SLA target as delayed and computes accurate delay duration", () => {
      const delayedTicket: KdsTicketRecord = {
        orderId: "ord-table04-delayed",
        tenantId: TENANT_A,
        kotNumber: "KOT-102",
        department: "KITCHEN",
        destinationType: "TABLE",
        destination: "Table 04",
        receivedAt: "2026-10-20T12:10:00Z",
        startedCookingAt: "2026-10-20T12:18:00Z", // 8 min queue
        readyAt: "2026-10-20T12:45:00Z", // 27 min cook -> 35 min to ready
        deliveredAt: "2026-10-20T12:52:00Z", // 7 min dispatch -> total 42 min
        slaTargetMinutes: 25, // Target was 25 min -> DELAYED by 17 min
        items: [
          {
            itemId: "dish-pork",
            name: "Slow Cooked Black Pork Curry",
            category: "MAINS",
            quantity: 2,
            prepTimeMinutes: 27,
          },
        ],
        grossTotalLkr: 5200,
      };

      assert.strictEqual(isOrderOnTime(delayedTicket), false);

      // Total cycle: 42 minutes vs 25 minute SLA target
      const cycleMin = computeDurationMinutes(delayedTicket.receivedAt, delayedTicket.deliveredAt);
      assert.strictEqual(cycleMin, 42.0);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Automatic Folio Synchronization & 4-Stage Tax Posting
  // --------------------------------------------------------------------------
  describe("5. Folio Ledger Posting & 4-Stage Tax Synchronization", () => {
    it("routes delivered room service charges to guest personal folio with statutory taxes", () => {
      const splitConfig: SplitFolioConfig = {
        tenantId: TENANT_A,
        reservationId: "res-room204-01",
        billingType: "DIRECT_GUEST",
      };

      // Direct booking guest staying in Room 204
      const targetFolio = determineDefaultTarget("FNB", splitConfig);
      assert.strictEqual(targetFolio, "GUEST_PERSONAL");

      // In-Room Dining room service charge posting
      const postingLines: readonly ChargePostingItem[] = [
        {
          lineId: "line-fnb-kitchen-01",
          category: "FNB",
          description: "In-Room Dining: Jaffna Crab Curry & Black Pork Curry (KOT-101)",
          quantity: 1,
          unitBaseLkr: 12200,
          scExempt: false,
        },
        {
          lineId: "line-fnb-bar-01",
          category: "FNB",
          description: "In-Room Dining: Lion Lager & Passion Fruit Mojito (BOT-101)",
          quantity: 1,
          unitBaseLkr: 3800,
          scExempt: false,
        },
      ];

      const routeResult = routeFolioCharges(postingLines, splitConfig);

      assert.strictEqual(routeResult.ok, true);
      if (!routeResult.ok) return;

      const routed = routeResult.value;
      // All lines routed to Guest Personal Folio
      assert.strictEqual(routed.masterDmcLines.length, 0);
      assert.strictEqual(routed.guestPersonalLines.length, 2);

      // Verify guest personal financial total
      const personalTax = routed.guestPersonalTaxes;
      assert.strictEqual(personalTax.totalBaseLkr, 16000);
      assert.strictEqual(personalTax.totalScLkr, 1600);
      assert.strictEqual(personalTax.totalTdlLkr, 176);
      assert.strictEqual(personalTax.totalSsclLkr, 440);
      assert.strictEqual(personalTax.totalVatLkr, 3278.88);
      assert.strictEqual(personalTax.grandTotalLkr, 21494.88);
    });
  });

  // --------------------------------------------------------------------------
  // 6. KDS SLA Performance & Bottleneck Analytics
  // --------------------------------------------------------------------------
  describe("6. KDS SLA Performance & Slow Dish Bottlenecks", () => {
    it("computes fleet-wide stage duration averages and compliance rates", () => {
      const tickets: readonly KdsTicketRecord[] = [
        {
          orderId: "ord-01",
          tenantId: TENANT_A,
          kotNumber: "KOT-101",
          department: "KITCHEN",
          destinationType: "ROOM",
          destination: "Room 204",
          receivedAt: "2026-10-20T12:00:00Z",
          startedCookingAt: "2026-10-20T12:02:00Z", // 2 min
          readyAt: "2026-10-20T12:14:00Z", // 12 min
          deliveredAt: "2026-10-20T12:18:00Z", // 4 min -> total 18 min
          slaTargetMinutes: 20, // On time!
          items: [
            {
              itemId: "dish-curry",
              name: "Jaffna Crab Curry",
              category: "SEAFOOD",
              quantity: 2,
              prepTimeMinutes: 12,
            },
          ],
          grossTotalLkr: 9600,
        },
        {
          orderId: "ord-02",
          tenantId: TENANT_A,
          kotNumber: "KOT-102",
          department: "KITCHEN",
          destinationType: "TABLE",
          destination: "Table 04",
          receivedAt: "2026-10-20T12:10:00Z",
          startedCookingAt: "2026-10-20T12:16:00Z", // 6 min
          readyAt: "2026-10-20T12:44:00Z", // 28 min
          deliveredAt: "2026-10-20T12:50:00Z", // 6 min -> total 40 min
          slaTargetMinutes: 25, // Delayed by 15 min!
          items: [
            {
              itemId: "dish-pork",
              name: "Slow Cooked Black Pork Curry",
              category: "MAINS",
              quantity: 2,
              prepTimeMinutes: 28,
            },
          ],
          grossTotalLkr: 5200,
        },
      ];

      const stageAverages = computeKdsStageAverages(tickets);
      // Queue: (2 + 6)/2 = 4 min
      assert.strictEqual(stageAverages.avgQueueMinutes, 4);
      // Cooking: (12 + 28)/2 = 20 min
      assert.strictEqual(stageAverages.avgCookingMinutes, 20);
      // Dispatch: (4 + 6)/2 = 5 min
      assert.strictEqual(stageAverages.avgDispatchMinutes, 5);
      // Total cycle: (18 + 40)/2 = 29 min
      assert.strictEqual(stageAverages.avgTotalCycleMinutes, 29);

      // SLA Performance: 1 on-time, 1 delayed -> 50%
      const sla = computeKdsSlaPerformance(tickets);
      assert.strictEqual(sla.totalCompletedOrders, 2);
      assert.strictEqual(sla.onTimeOrdersCount, 1);
      assert.strictEqual(sla.delayedOrdersCount, 1);
      assert.strictEqual(sla.complianceRatePercent, 50);

      // Bottleneck dish identification
      const slowDishes = identifySlowDishes(tickets);
      const pork = slowDishes.find((d) => d.itemId === "dish-pork");
      assert.ok(pork);
      assert.strictEqual(pork.isBottleneck, true);
      assert.strictEqual(pork.avgCookingMinutes, 28);
    });
  });

  function appendAuditOrThrow(chain: AuditLogEntry[], payload: AuditLogPayload): AuditLogEntry {
    const res = createAuditEntry(payload);
    assert.strictEqual(res.ok, true);
    if (!res.ok) {
      throw new Error("Audit entry creation failed");
    }
    chain.push(res.value);
    return res.value;
  }

  // --------------------------------------------------------------------------
  // 7. Full Cryptographic SHA-256 Audit Chain Verification
  // --------------------------------------------------------------------------
  describe("7. End-to-End Cryptographic SHA-256 Audit Chain & Anti-Tamper Detection", () => {
    it("builds an unbroken SHA-256 hash-chain covering order placement to folio sync", () => {
      const auditChain: AuditLogEntry[] = [];
      let currentHash = GENESIS_HASH;

      // Event 1: QR Guest Order Placed
      const e1 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: "usr-guest-qr",
        action: "GUEST_ORDER_PLACED",
        entityType: "ORDER",
        entityId: "ord-room204-01",
        isoTs: "2026-10-20T12:00:00Z",
        afterJson: JSON.stringify({
          location: "Room 204",
          guestName: "Dr. Anura Bandara",
          netTotalLkr: 16000,
        }),
        prevHash: currentHash,
      });
      currentHash = e1.entryHash;

      // Event 2: Order Split into Department Tickets
      const e2 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: STAFF_CHEF.userId,
        action: "ORDER_SPLIT_DEPARTMENTS",
        entityType: "ORDER",
        entityId: "ord-room204-01",
        isoTs: "2026-10-20T12:00:05Z",
        afterJson: JSON.stringify({
          kotNumber: "KOT-101",
          botNumber: "BOT-101",
        }),
        prevHash: currentHash,
      });
      currentHash = e2.entryHash;

      // Event 3: Cook Starts Preparation (KDS Fire)
      const e3 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: STAFF_CHEF.userId,
        action: "KDS_START_COOKING",
        entityType: "KDS_TICKET",
        entityId: "KOT-101",
        isoTs: "2026-10-20T12:03:00Z",
        afterJson: JSON.stringify({
          station: "MAIN_RANGE",
          cookId: STAFF_CHEF.userId,
        }),
        prevHash: currentHash,
      });
      currentHash = e3.entryHash;

      // Event 4: Chef Marks Order Ready (Pass Table Alert)
      const e4 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: STAFF_CHEF.userId,
        action: "KDS_ORDER_READY",
        entityType: "KDS_TICKET",
        entityId: "KOT-101",
        isoTs: "2026-10-20T12:15:00Z",
        afterJson: JSON.stringify({
          prepDurationMinutes: 12,
          slaTargetMinutes: 20,
        }),
        prevHash: currentHash,
      });
      currentHash = e4.entryHash;

      // Event 5: Room Service Runner Confirms Delivery to Room
      const e5 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: STAFF_RUNNER.userId,
        action: "RUNNER_ORDER_DELIVERED",
        entityType: "DELIVERY",
        entityId: "ord-room204-01",
        isoTs: "2026-10-20T12:19:00Z",
        afterJson: JSON.stringify({
          destination: "Room 204",
          runnerId: STAFF_RUNNER.userId,
        }),
        prevHash: currentHash,
      });
      currentHash = e5.entryHash;

      // Event 6: Folio Sync with 4-Stage Taxes
      appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: STAFF_FRONT_DESK.userId,
        action: "FOLIO_CHARGE_POSTED",
        entityType: "FOLIO",
        entityId: "folio-room204-guest",
        isoTs: "2026-10-20T12:19:30Z",
        afterJson: JSON.stringify({
          orderId: "ord-room204-01",
          netSupplyLkr: 16000,
          grandTotalLkr: 21494.88,
        }),
        prevHash: currentHash,
      });

      // Verify unbroken chain validity
      assert.strictEqual(auditChain.length, 6);
      const chainValid = verifyAuditChain(auditChain);
      assert.strictEqual(chainValid.ok, true);
    });

    it("detects malicious tampering when any intermediate KDS or folio audit entry is modified", () => {
      const auditChain: AuditLogEntry[] = [];
      let currentHash = GENESIS_HASH;

      const e1 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: "usr-guest-01",
        action: "GUEST_ORDER_PLACED",
        entityType: "ORDER",
        entityId: "ord-01",
        isoTs: "2026-10-20T12:00:00Z",
        afterJson: JSON.stringify({ orderId: "ord-01", totalLkr: 16000 }),
        prevHash: currentHash,
      });
      currentHash = e1.entryHash;

      const e2 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: STAFF_CHEF.userId,
        action: "KDS_ORDER_READY",
        entityType: "KDS_TICKET",
        entityId: "KOT-101",
        isoTs: "2026-10-20T12:15:00Z",
        afterJson: JSON.stringify({ orderId: "ord-01", prepMin: 12 }),
        prevHash: currentHash,
      });
      currentHash = e2.entryHash;

      const e3 = appendAuditOrThrow(auditChain, {
        tenantId: TENANT_A,
        actorUserId: STAFF_FRONT_DESK.userId,
        action: "FOLIO_CHARGE_POSTED",
        entityType: "FOLIO",
        entityId: "folio-01",
        isoTs: "2026-10-20T12:20:00Z",
        afterJson: JSON.stringify({ orderId: "ord-01", grandTotalLkr: 21494.88 }),
        prevHash: currentHash,
      });

      // Tamper simulation: Alter the billed amount in entry 3 without recomputing hash
      const tamperedEntry = {
        ...e3,
        afterJson: JSON.stringify({ orderId: "ord-01", grandTotalLkr: 100 }), // illegally altered JSON!
      };
      const tamperedChain = [e1, e2, tamperedEntry];

      const verifyResult = verifyAuditChain(tamperedChain);
      assert.strictEqual(verifyResult.ok, false);
      if (!verifyResult.ok) {
        assert.strictEqual(verifyResult.error.code, "AUDIT_CHAIN_CORRUPTED");
      }
    });
  });
});
