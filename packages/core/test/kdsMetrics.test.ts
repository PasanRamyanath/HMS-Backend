/**
 * Unit Tests for Step 295 & Step 296: KDS Prep-Time SLA Metrics & Bottleneck Analytics (kdsMetrics.ts)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENESIS_HASH, verifyAuditChain } from "../src/auditChain.js";
import {
  type KdsMetricsActor,
  type KdsMetricsSubscription,
  type KdsTicketRecord,
  analyzeHourlyBottlenecks,
  computeDurationMinutes,
  computeKdsSlaPerformance,
  computeKdsStageAverages,
  generateKdsPerformanceReport,
  identifySlowDishes,
  isOrderOnTime,
} from "../src/kdsMetrics.js";

describe("Step 295 & Step 296: KDS Prep-Time SLA & Bottleneck Analytics Helper (kdsMetrics.ts)", () => {
  const defaultActor: KdsMetricsActor = {
    userId: "usr-chef-01",
    role: "HEAD_CHEF",
    tenantId: "cinnamon-wild-yala",
  };

  const sampleTickets: readonly KdsTicketRecord[] = [
    {
      orderId: "ord-01",
      tenantId: "cinnamon-wild-yala",
      kotNumber: "KOT-101",
      department: "KITCHEN",
      destinationType: "TABLE",
      destination: "Table 12",
      receivedAt: "2026-10-20T12:00:00Z",
      startedCookingAt: "2026-10-20T12:03:00Z", // 3 min queue
      readyAt: "2026-10-20T12:15:00Z", // 12 min cooking
      deliveredAt: "2026-10-20T12:18:00Z", // 3 min dispatch -> total 18 min
      slaTargetMinutes: 20, // On time! (18 <= 20)
      items: [
        {
          itemId: "dish-01",
          name: "Jaffna Crab Curry",
          category: "SEAFOOD",
          quantity: 1,
          prepTimeMinutes: 12,
        },
      ],
      grossTotalLkr: 4800,
    },
    {
      orderId: "ord-02",
      tenantId: "cinnamon-wild-yala",
      kotNumber: "KOT-102",
      department: "KITCHEN",
      destinationType: "TABLE",
      destination: "Table 04",
      receivedAt: "2026-10-20T12:10:00Z",
      startedCookingAt: "2026-10-20T12:15:00Z", // 5 min queue
      readyAt: "2026-10-20T12:35:00Z", // 20 min cooking
      deliveredAt: "2026-10-20T12:40:00Z", // 5 min dispatch -> total 30 min
      slaTargetMinutes: 20, // Delayed! (30 > 20, delay 10 min)
      items: [
        {
          itemId: "dish-02",
          name: "Slow Cooked Black Pork Curry",
          category: "MAINS",
          quantity: 2,
          prepTimeMinutes: 20,
        },
      ],
      grossTotalLkr: 5200,
    },
    {
      orderId: "ord-03",
      tenantId: "cinnamon-wild-yala",
      kotNumber: "KOT-103",
      department: "BAR",
      destinationType: "TABLE",
      destination: "Table 04",
      receivedAt: "2026-10-20T12:10:00Z",
      startedCookingAt: "2026-10-20T12:11:00Z", // 1 min queue
      readyAt: "2026-10-20T12:14:00Z", // 3 min prep
      deliveredAt: "2026-10-20T12:16:00Z", // 2 min dispatch -> total 6 min
      slaTargetMinutes: 10, // On time! (6 <= 10)
      items: [
        {
          itemId: "drink-01",
          name: "Lion Lager Draught Pint",
          category: "BEVERAGES",
          quantity: 2,
          prepTimeMinutes: 3,
        },
      ],
      grossTotalLkr: 2400,
    },
    {
      orderId: "ord-04",
      tenantId: "cinnamon-wild-yala",
      kotNumber: "KOT-104",
      department: "KITCHEN",
      destinationType: "ROOM",
      destination: "Room 204",
      receivedAt: "2026-10-20T12:20:00Z",
      startedCookingAt: "2026-10-20T12:25:00Z",
      readyAt: "2026-10-20T12:55:00Z",
      deliveredAt: "2026-10-20T13:05:00Z", // total 45 min
      slaTargetMinutes: 25, // Delayed by 20 min!
      items: [
        {
          itemId: "dish-02",
          name: "Slow Cooked Black Pork Curry",
          category: "MAINS",
          quantity: 1,
          prepTimeMinutes: 30,
        },
      ],
      grossTotalLkr: 2600,
    },
    {
      orderId: "ord-05",
      tenantId: "cinnamon-wild-yala",
      kotNumber: "KOT-105",
      department: "KITCHEN",
      destinationType: "CABANA",
      destination: "Cabana 02",
      receivedAt: "2026-10-20T13:00:00Z",
      cancelledAt: "2026-10-20T13:05:00Z", // Cancelled ticket
      slaTargetMinutes: 20,
      items: [
        {
          itemId: "dish-01",
          name: "Jaffna Crab Curry",
          category: "SEAFOOD",
          quantity: 1,
        },
      ],
      grossTotalLkr: 4800,
    },
  ];

  // --------------------------------------------------------------------------
  // 1. Duration & Single Order SLA Evaluation
  // --------------------------------------------------------------------------
  describe("1. Duration & Order SLA Classification", () => {
    it("computes accurate decimal minutes between ISO timestamps", () => {
      const dur = computeDurationMinutes("2026-10-20T10:00:00Z", "2026-10-20T10:15:30Z");
      assert.strictEqual(dur, 15.5);
    });

    it("returns null when timestamps are missing, malformed, or inverted", () => {
      assert.strictEqual(computeDurationMinutes(undefined, "2026-10-20T10:00:00Z"), null);
      assert.strictEqual(computeDurationMinutes("2026-10-20T10:00:00Z", undefined), null);
      assert.strictEqual(computeDurationMinutes("invalid-iso", "2026-10-20T10:00:00Z"), null);
      // Inverted: end < start
      assert.strictEqual(
        computeDurationMinutes("2026-10-20T10:30:00Z", "2026-10-20T10:15:00Z"),
        null,
      );
    });

    it("classifies completed orders as on-time or delayed correctly", () => {
      const t0 = sampleTickets[0];
      const t1 = sampleTickets[1];
      const t2 = sampleTickets[2];
      const t3 = sampleTickets[3];
      const t4 = sampleTickets[4];
      assert.ok(t0 && t1 && t2 && t3 && t4);
      assert.strictEqual(isOrderOnTime(t0), true); // 18m <= 20m target
      assert.strictEqual(isOrderOnTime(t1), false); // 30m > 20m target
      assert.strictEqual(isOrderOnTime(t2), true); // 6m <= 10m target
      assert.strictEqual(isOrderOnTime(t3), false); // 45m > 25m target
      // Cancelled order returns null
      assert.strictEqual(isOrderOnTime(t4), null);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Stage Duration Averages & Overall SLA Compliance
  // --------------------------------------------------------------------------
  describe("2. Lifecycle Stage Averages & SLA Compliance", () => {
    it("computes averages across queue, cooking, dispatch, and total cycle stages", () => {
      const averages = computeKdsStageAverages(sampleTickets);

      // Queue: ord-01 (3), ord-02 (5), ord-03 (1), ord-04 (5) -> (3+5+1+5)/4 = 3.5 min
      assert.strictEqual(averages.avgQueueMinutes, 3.5);

      // Cooking: ord-01 (12), ord-02 (20), ord-03 (3), ord-04 (30) -> (12+20+3+30)/4 = 16.25 min
      assert.strictEqual(averages.avgCookingMinutes, 16.25);

      // Dispatch: ord-01 (3), ord-02 (5), ord-03 (2), ord-04 (10) -> (3+5+2+10)/4 = 5 min
      assert.strictEqual(averages.avgDispatchMinutes, 5);

      // Total Cycle: ord-01 (18), ord-02 (30), ord-03 (6), ord-04 (45) -> (18+30+6+45)/4 = 24.75 min
      assert.strictEqual(averages.avgTotalCycleMinutes, 24.75);
      assert.strictEqual(averages.sampleCount, 4);
    });

    it("computes overall SLA compliance rate and identifies longest delay", () => {
      const sla = computeKdsSlaPerformance(sampleTickets);

      assert.strictEqual(sla.totalCompletedOrders, 4);
      assert.strictEqual(sla.onTimeOrdersCount, 2);
      assert.strictEqual(sla.delayedOrdersCount, 2);
      // 2 / 4 = 50%
      assert.strictEqual(sla.complianceRatePercent, 50);

      // Delays at readyAt: ord-02 (25 - 20 = 5 min), ord-04 (35 - 25 = 10 min) -> average delay = (5 + 10) / 2 = 7.5 min
      assert.strictEqual(sla.avgDelayMinutes, 7.5);
      assert.strictEqual(sla.longestDelayMinutes, 10);
      assert.strictEqual(sla.longestDelayedKotNumber, "KOT-104");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Slow Dish Detection & Peak Bottleneck Hours
  // --------------------------------------------------------------------------
  describe("3. Slow Dish Detection & Bottleneck Analytics", () => {
    it("surfaces slow-cooking dishes and flags bottlenecks", () => {
      const slowDishes = identifySlowDishes(sampleTickets);
      assert.ok(slowDishes.length >= 2);

      // dish-02 (Black Pork Curry): ord-02 (2 qty, 20 min) + ord-04 (1 qty, 30 min)
      // avg = (40 + 30) / 3 = 23.33 min
      const pork = slowDishes.find((d) => d.itemId === "dish-02");
      assert.ok(pork);
      assert.strictEqual(pork?.name, "Slow Cooked Black Pork Curry");
      assert.strictEqual(pork?.orderFrequency, 3);
      assert.strictEqual(pork?.isBottleneck, true);

      // Drink should have very low cooking minutes
      const drink = slowDishes.find((d) => d.itemId === "drink-01");
      assert.ok(drink);
      assert.strictEqual(drink?.isBottleneck, false);
    });

    it("identifies hourly order distribution and peak bottleneck hours", () => {
      const hourly = analyzeHourlyBottlenecks(sampleTickets);
      assert.strictEqual(hourly.length, 24);

      // Hour 12 has 4 tickets (ord-01, ord-02, ord-03, ord-04) with 2 delays (50% delay rate)
      const h12 = hourly.find((h) => h.hour === 12);
      assert.ok(h12);
      assert.strictEqual(h12?.ordersCount, 4);
      assert.strictEqual(h12?.delayedCount, 2);
      assert.strictEqual(h12?.delayRatePercent, 50);
      assert.strictEqual(h12?.isPeakBottleneck, true);

      // Hour 3 should have 0 orders
      const h03 = hourly.find((h) => h.hour === 3);
      assert.ok(h03);
      assert.strictEqual(h03?.ordersCount, 0);
      assert.strictEqual(h03?.isPeakBottleneck, false);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Multi-Tenant Isolation & Actor RBAC
  // --------------------------------------------------------------------------
  describe("4. Multi-Tenant Isolation & Actor RBAC", () => {
    it("rejects invalid tenant identifier slug", () => {
      const res = generateKdsPerformanceReport({
        tenantId: "INVALID TENANT WITH SPACES",
        actor: defaultActor,
        tickets: sampleTickets,
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error.code, "VALIDATION_FAILED");
    });

    it("rejects actor from different tenant", () => {
      const res = generateKdsPerformanceReport({
        tenantId: "cinnamon-wild-yala",
        actor: {
          userId: "usr-02",
          role: "HEAD_CHEF",
          tenantId: "heritance-kandalama",
        },
        tickets: sampleTickets,
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error.code, "TENANT_MISMATCH");
    });

    it("rejects unauthorized actor roles (e.g. GUEST or DRIVER)", () => {
      const res = generateKdsPerformanceReport({
        tenantId: "cinnamon-wild-yala",
        actor: {
          userId: "usr-guest",
          role: "GUEST",
          tenantId: "cinnamon-wild-yala",
        },
        tickets: sampleTickets,
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error.code, "PERMISSION_DENIED");
    });

    it("rejects inactive SaaS subscriptions", () => {
      const sub: KdsMetricsSubscription = {
        tenantId: "cinnamon-wild-yala",
        tier: "BASIC",
        active: false,
      };

      const res = generateKdsPerformanceReport({
        tenantId: "cinnamon-wild-yala",
        actor: defaultActor,
        subscription: sub,
        tickets: sampleTickets,
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error.code, "SUBSCRIPTION_INACTIVE");
    });

    it("rejects subscription without KDS analytics feature enabled", () => {
      const sub: KdsMetricsSubscription = {
        tenantId: "cinnamon-wild-yala",
        tier: "STARTER",
        active: true,
        allowKdsAnalytics: false,
      };

      const res = generateKdsPerformanceReport({
        tenantId: "cinnamon-wild-yala",
        actor: defaultActor,
        subscription: sub,
        tickets: sampleTickets,
      });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error.code, "PLAN_LIMITATION");
    });
  });

  // --------------------------------------------------------------------------
  // 5. End-to-End Report Generation & SHA-256 Audit Chaining
  // --------------------------------------------------------------------------
  describe("5. End-to-End Report Generation & Audit Chaining", () => {
    it("generates complete KDS performance report and appends valid SHA-256 audit entry", () => {
      const res = generateKdsPerformanceReport({
        tenantId: "cinnamon-wild-yala",
        actor: defaultActor,
        tickets: sampleTickets,
        prevAuditHash: GENESIS_HASH,
      });

      assert.strictEqual(res.ok, true);
      const report = res.value;

      assert.strictEqual(report.tenantId, "cinnamon-wild-yala");
      assert.strictEqual(report.totalTicketsProcessed, 5);
      assert.strictEqual(report.departmentBreakdown.KITCHEN, 4);
      assert.strictEqual(report.departmentBreakdown.BAR, 1);
      assert.strictEqual(report.slaPerformance.totalCompletedOrders, 4);
      assert.strictEqual(report.slaPerformance.complianceRatePercent, 50);

      // Verify audit entry
      assert.strictEqual(report.auditEntry.action, "GENERATE_KDS_PERFORMANCE_REPORT");
      assert.strictEqual(report.auditEntry.prevHash, GENESIS_HASH);
      assert.ok(report.auditEntry.entryHash.length === 64);

      // Verify chain integrity
      const chainValid = verifyAuditChain([report.auditEntry], GENESIS_HASH);
      assert.strictEqual(chainValid.ok, true);
    });
  });
});
