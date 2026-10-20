/**
 * Unit Tests for Step 284 & Step 285: Mixed Kitchen KOT + Bar BOT Order Splitting (orderSplitter.ts)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENESIS_HASH, verifyAuditChain } from "../src/auditChain.js";
import {
  type OrderSubscriptionContext,
  type SplitOrderActor,
  type SplitOrderInput,
  type SplitOrderItemInput,
  splitOrderByDepartment,
} from "../src/orderSplitter.js";

describe("Step 284 & Step 285: Split-Order Department Splitter (orderSplitter.ts)", () => {
  const defaultActor: SplitOrderActor = {
    userId: "usr-waiter-01",
    role: "WAITER",
    tenantId: "galle-fort-villa",
  };

  const sampleFoodItem: SplitOrderItemInput = {
    itemId: "dish-01",
    name: "Jaffna Lagoon Crab Curry",
    nameSi: "යාපනය කලපු කකුළු කරිය",
    nameTa: "யாழ்ப்பாணம் நண்டு கறி",
    department: "KITCHEN",
    quantity: 2,
    unitPriceLkr: 4800,
    spiceLevel: "Extra Spicy",
    specialInstructions: "Clay pot serving",
  };

  const sampleDrinkItem: SplitOrderItemInput = {
    itemId: "drink-01",
    name: "Lion Lager Draught Pint",
    nameSi: "ලයින් ලැගර් ඩ්‍රාෆ්ට්",
    nameTa: "லயன் பியர்",
    department: "BAR",
    quantity: 2,
    unitPriceLkr: 1200,
    modifiers: ["Cold Glass"],
  };

  const sampleDessertItem: SplitOrderItemInput = {
    itemId: "dessert-01",
    name: "Traditional Watalappan Cup",
    nameSi: "කිතුල් වටලප්පන්",
    nameTa: "வட்டலாப்பம்",
    department: "DESSERT_STATION",
    quantity: 3,
    unitPriceLkr: 950,
  };

  // --------------------------------------------------------------------------
  // 1. Multi-Tenant Isolation & Role-Based Access Control (RBAC)
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant Isolation & Actor RBAC", () => {
    it("rejects invalid or malformed tenant identifiers", () => {
      const input: SplitOrderInput = {
        tenantId: "INVALID TENANT!!",
        orderId: "ord-101",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [sampleFoodItem],
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    });

    it("rejects tenant mismatch between actor and order", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-102",
        actor: {
          userId: "usr-99",
          role: "WAITER",
          tenantId: "kandy-hills-resort", // Mismatched tenant
        },
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [sampleFoodItem],
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "TENANT_MISMATCH");
    });

    it("rejects unauthorized staff roles from creating/splitting orders", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-103",
        actor: {
          userId: "usr-gardener",
          role: "GARDENER", // Unauthorized role
          tenantId: "galle-fort-villa",
        },
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [sampleFoodItem],
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "PERMISSION_DENIED");
    });

    it("allows authorized roles including WAITER, BARTENDER, CHEF, GUEST, and GUEST_QR", () => {
      const roles = ["WAITER", "BARTENDER", "CHEF", "FRONT_DESK", "GUEST", "GUEST_QR"];
      for (const role of roles) {
        const input: SplitOrderInput = {
          tenantId: "galle-fort-villa",
          orderId: `ord-${role}`,
          actor: {
            userId: `usr-${role}`,
            role,
            tenantId: "galle-fort-villa",
          },
          orderSource: role.startsWith("GUEST") ? "QR_GUEST" : "WAITER_POS",
          destinationType: "TABLE",
          destination: "Table 02",
          items: [sampleFoodItem],
        };

        const result = splitOrderByDepartment(input);
        assert.strictEqual(result.ok, true, `Role ${role} should be authorized`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. SaaS Subscription Entitlement Checks
  // --------------------------------------------------------------------------
  describe("2. SaaS Subscription Entitlements", () => {
    it("rejects order when subscription tenant does not match", () => {
      const sub: OrderSubscriptionContext = {
        tenantId: "other-property",
        active: true,
      };

      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-sub-01",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [sampleFoodItem],
        subscription: sub,
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "TENANT_MISMATCH");
    });

    it("rejects order when hotel SaaS subscription is suspended/inactive", () => {
      const sub: OrderSubscriptionContext = {
        tenantId: "galle-fort-villa",
        active: false,
      };

      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-sub-02",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [sampleFoodItem],
        subscription: sub,
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "SUBSCRIPTION_INACTIVE");
    });

    it("rejects order when subscription tier disables KDS/BOT module", () => {
      const sub: OrderSubscriptionContext = {
        tenantId: "galle-fort-villa",
        active: true,
        tier: "STARTER_ROOMS_ONLY",
        allowKdsBot: false,
      };

      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-sub-03",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [sampleFoodItem],
        subscription: sub,
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "PLAN_LIMITATION");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Item Validation & Guard Rails
  // --------------------------------------------------------------------------
  describe("3. Order Item Validation", () => {
    it("rejects empty items list", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-empty",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [],
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "INVALID_ORDER_ITEMS");
    });

    it("rejects non-positive quantities or non-finite prices", () => {
      const badQtyItem: SplitOrderItemInput = {
        ...sampleFoodItem,
        quantity: 0,
      };

      const input1: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-bad-qty",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [badQtyItem],
      };

      const res1 = splitOrderByDepartment(input1);
      assert.strictEqual(res1.ok, false);
      assert.strictEqual(res1.error.code, "INVALID_ORDER_ITEMS");

      const badPriceItem: SplitOrderItemInput = {
        ...sampleFoodItem,
        unitPriceLkr: -500,
      };

      const input2: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-bad-price",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 04",
        items: [badPriceItem],
      };

      const res2 = splitOrderByDepartment(input2);
      assert.strictEqual(res2.ok, false);
      assert.strictEqual(res2.error.code, "INVALID_ORDER_ITEMS");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Mixed Cart Splitting (KITCHEN KOT + BAR BOT)
  // --------------------------------------------------------------------------
  describe("4. Mixed Cart Splitting into Linked KOT and BOT", () => {
    it("splits mixed cart (`2x Crab Curry + 2x Lion Beer`) into 1 KOT and 1 BOT while posting 1 bill", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-mixed-901",
        actor: defaultActor,
        orderSource: "QR_GUEST",
        destinationType: "TABLE",
        destination: "Table 08",
        items: [sampleFoodItem, sampleDrinkItem],
        cbslUsdRate: 310,
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, true);

      const split = result.value;
      assert.strictEqual(split.masterOrderId, "ord-mixed-901");
      assert.strictEqual(split.destination, "Table 08");
      assert.strictEqual(split.tickets.length, 2);

      // Ticket 1: KOT Kitchen
      const kotTicket = split.tickets.find((t) => t.ticketType === "KOT");
      assert.ok(kotTicket);
      assert.strictEqual(kotTicket.department, "KITCHEN");
      assert.strictEqual(kotTicket.masterOrderId, "ord-mixed-901");
      assert.strictEqual(kotTicket.slaTargetMinutes, 20);
      assert.strictEqual(kotTicket.items.length, 1);
      assert.strictEqual(kotTicket.items[0]?.name, "Jaffna Lagoon Crab Curry");
      assert.strictEqual(kotTicket.items[0]?.quantity, 2);
      assert.strictEqual(kotTicket.subtotalLkr, 9600); // 4800 * 2

      // Ticket 2: BOT Bar
      const botTicket = split.tickets.find((t) => t.ticketType === "BOT");
      assert.ok(botTicket);
      assert.strictEqual(botTicket.department, "BAR");
      assert.strictEqual(botTicket.masterOrderId, "ord-mixed-901");
      assert.strictEqual(botTicket.slaTargetMinutes, 10);
      assert.strictEqual(botTicket.items.length, 1);
      assert.strictEqual(botTicket.items[0]?.name, "Lion Lager Draught Pint");
      assert.strictEqual(botTicket.items[0]?.quantity, 2);
      assert.strictEqual(botTicket.subtotalLkr, 2400); // 1200 * 2

      // Single Combined Bill
      assert.strictEqual(split.combinedBill.grossSubtotalLkr, 12000); // 9600 + 2400
      assert.strictEqual(split.combinedBill.departmentSubtotals.KITCHEN, 9600);
      assert.strictEqual(split.combinedBill.departmentSubtotals.BAR, 2400);
      assert.strictEqual(split.combinedBill.departmentSubtotals.DESSERT_STATION, 0);

      // Statutory 4-Stage Taxes:
      // Base = 12,000 LKR
      // SC 10% = 1,200 LKR -> Subtotal after SC = 13,200 LKR
      // TDL 1% = 132 LKR
      // SSCL 2.5% = 330 LKR
      // VAT Base = 13,200 + 132 + 330 = 13,662 LKR
      // VAT 18% = 13,662 * 0.18 = 2,459.16 LKR
      // Grand Total = 13,662 + 2,459.16 = 16,121.16 LKR
      assert.strictEqual(split.combinedBill.taxBreakdown.scLkr, 1200);
      assert.strictEqual(split.combinedBill.taxBreakdown.tdlLkr, 132);
      assert.strictEqual(split.combinedBill.taxBreakdown.ssclLkr, 330);
      assert.strictEqual(split.combinedBill.taxBreakdown.vatLkr, 2459.16);
      assert.strictEqual(split.combinedBill.grandTotalLkr, 16121.16);
      assert.strictEqual(split.combinedBill.approxUsd, 52); // 16,121.16 / 310 = 52.00
    });

    it("generates single KOT ticket when cart contains only kitchen food", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-food-only",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TABLE",
        destination: "Table 01",
        items: [sampleFoodItem],
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.value.tickets.length, 1);
      assert.strictEqual(result.value.tickets[0]?.ticketType, "KOT");
      assert.strictEqual(result.value.tickets[0]?.department, "KITCHEN");
    });

    it("generates single BOT ticket when cart contains only bar drinks", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-drinks-only",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "CABANA",
        destination: "Cabana 02",
        items: [sampleDrinkItem],
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.value.tickets.length, 1);
      assert.strictEqual(result.value.tickets[0]?.ticketType, "BOT");
      assert.strictEqual(result.value.tickets[0]?.department, "BAR");
    });

    it("supports 3-way split across Kitchen, Bar, and Dessert station", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-3way-split",
        actor: defaultActor,
        orderSource: "IN_ROOM_DINING",
        destinationType: "ROOM",
        destination: "Room 204",
        items: [sampleFoodItem, sampleDrinkItem, sampleDessertItem],
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.value.tickets.length, 3);

      const depts = result.value.tickets.map((t) => t.department);
      assert.ok(depts.includes("KITCHEN"));
      assert.ok(depts.includes("BAR"));
      assert.ok(depts.includes("DESSERT_STATION"));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Statutory Tax Rules & Service Charge Waiver on Takeaway
  // --------------------------------------------------------------------------
  describe("5. Statutory Tax Rules & Takeaway SC Exemption", () => {
    it("waives 10% Service Charge when destinationType is TAKEAWAY", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-takeaway-01",
        actor: defaultActor,
        orderSource: "WAITER_POS",
        destinationType: "TAKEAWAY",
        destination: "Walk-In Counter",
        items: [sampleFoodItem], // 9,600 LKR
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, true);

      // Takeaway: SC = 0
      assert.strictEqual(result.value.combinedBill.taxBreakdown.scLkr, 0);
      assert.strictEqual(result.value.combinedBill.taxBreakdown.subtotalAfterScLkr, 9600);

      // TDL 1% = 96 LKR
      assert.strictEqual(result.value.combinedBill.taxBreakdown.tdlLkr, 96);
      // SSCL 2.5% = 240 LKR
      assert.strictEqual(result.value.combinedBill.taxBreakdown.ssclLkr, 240);
      // VAT Base = 9600 + 96 + 240 = 9936 LKR
      // VAT 18% = 1788.48 LKR
      assert.strictEqual(result.value.combinedBill.taxBreakdown.vatLkr, 1788.48);
      // Grand Total = 9936 + 1788.48 = 11,724.48 LKR
      assert.strictEqual(result.value.combinedBill.grandTotalLkr, 11724.48);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Cryptographic SHA-256 Hash-Chained Audit Log Verification
  // --------------------------------------------------------------------------
  describe("6. Cryptographic Hash-Chained Audit Trail", () => {
    it("appends valid SHA-256 audit log entry and passes audit chain verification", () => {
      const input: SplitOrderInput = {
        tenantId: "galle-fort-villa",
        orderId: "ord-audit-99",
        actor: defaultActor,
        orderSource: "QR_GUEST",
        destinationType: "TABLE",
        destination: "Table 05",
        items: [sampleFoodItem, sampleDrinkItem],
        prevAuditHash: GENESIS_HASH,
        isoTimestamp: "2026-10-20T12:00:00.000Z",
      };

      const result = splitOrderByDepartment(input);
      assert.strictEqual(result.ok, true);

      const auditLog = result.value.auditLog;
      assert.strictEqual(auditLog.tenantId, "galle-fort-villa");
      assert.strictEqual(auditLog.actorUserId, "usr-waiter-01");
      assert.strictEqual(auditLog.action, "ORDER_SPLIT_DISPATCHED");
      assert.strictEqual(auditLog.entityType, "MasterOrder");
      assert.strictEqual(auditLog.entityId, "ord-audit-99");
      assert.strictEqual(auditLog.prevHash, GENESIS_HASH);
      assert.strictEqual(auditLog.entryHash.length, 64);

      // Verify audit chain
      const verifyRes = verifyAuditChain([auditLog]);
      assert.strictEqual(verifyRes.ok, true);
      assert.strictEqual(verifyRes.value.verifiedCount, 1);
    });
  });
});
