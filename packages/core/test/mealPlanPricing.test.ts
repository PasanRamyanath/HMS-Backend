import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type MealPlanPricingParams,
  type OrderItemPricingInput,
  type ReservationGuestContext,
  applyMealPlanEntitlements,
  getCurrentSlstTime24,
  isItemEligibleUnderPlan,
  isPlanEligibleForSlot,
  resolveCurrentMealSlot,
} from "../src/mealPlanPricing.js";

describe("Step 233 & 234: Meal-Plan Order Line Pricing Resolver & Entitlement Engine (mealPlanPricing.ts)", () => {
  const hopperBreakfast: OrderItemPricingInput = {
    itemId: "ITEM-HOPPER-FEAST",
    name: "Egg Hopper Feast",
    quantity: 1,
    unitBasePriceLkr: 1850,
    isFreeUnderBb: true,
    isFreeUnderHb: true,
    isFreeUnderFb: true,
    isFreeUnderAi: true,
    allowedMealSlots: ["BREAKFAST"],
    surchargeLkr: 0,
  };

  const riceCurryDinner: OrderItemPricingInput = {
    itemId: "ITEM-RICE-CURRY",
    name: "Authentic Southern Rice & 5 Curries",
    quantity: 1,
    unitBasePriceLkr: 2600,
    isFreeUnderBb: false,
    isFreeUnderHb: true,
    isFreeUnderFb: true,
    isFreeUnderAi: true,
    allowedMealSlots: ["LUNCH", "DINNER"],
    surchargeLkr: 0,
  };

  const watalappanDessert: OrderItemPricingInput = {
    itemId: "ITEM-WATALAPPAN",
    name: "Cardamom Spiced Jaggery Watalappan",
    quantity: 1,
    unitBasePriceLkr: 850,
    isFreeUnderBb: false,
    isFreeUnderHb: false,
    isFreeUnderFb: false,
    isFreeUnderAi: true,
    allowedMealSlots: ["LUNCH", "DINNER"],
    surchargeLkr: 0,
  };

  const lagoonCrabPremium: OrderItemPricingInput = {
    itemId: "ITEM-LAGOON-CRAB",
    name: "Chili Garlic Lagoon Crab",
    quantity: 1,
    unitBasePriceLkr: 6800,
    isFreeUnderBb: false,
    isFreeUnderHb: false,
    isFreeUnderFb: false,
    isFreeUnderAi: false,
    allowedMealSlots: ["DINNER"],
    surchargeLkr: 3500, // Specialty AI supplement upgrade
  };

  const lionBeerBar: OrderItemPricingInput = {
    itemId: "ITEM-LION-BEER",
    name: "Lion Lager Beer Pint",
    quantity: 1,
    unitBasePriceLkr: 1100,
    isFreeUnderBb: false,
    isFreeUnderHb: false,
    isFreeUnderFb: false,
    isFreeUnderAi: true,
    allowedMealSlots: ["ALL_DAY"],
    surchargeLkr: 0,
  };

  describe("1. Time & Slot Resolvers", () => {
    it("returns formatted 24h SLST time string", () => {
      const time = getCurrentSlstTime24();
      assert.match(time, /^([01]\d|2[0-3]):[0-5]\d$/);
    });

    it("maps 24h times to standard Sri Lankan meal windows", () => {
      assert.strictEqual(resolveCurrentMealSlot("07:00"), "BREAKFAST");
      assert.strictEqual(resolveCurrentMealSlot("10:30"), "BREAKFAST");
      assert.strictEqual(resolveCurrentMealSlot("11:00"), "ALL_DAY");
      assert.strictEqual(resolveCurrentMealSlot("13:00"), "LUNCH");
      assert.strictEqual(resolveCurrentMealSlot("16:30"), "AFTERNOON_TEA");
      assert.strictEqual(resolveCurrentMealSlot("20:00"), "DINNER");
      assert.strictEqual(resolveCurrentMealSlot("23:15"), "ALL_DAY");
    });

    it("evaluates plan eligibility per meal slot", () => {
      assert.strictEqual(isPlanEligibleForSlot("RO", "BREAKFAST"), false);
      assert.strictEqual(isPlanEligibleForSlot("BB", "BREAKFAST"), true);
      assert.strictEqual(isPlanEligibleForSlot("BB", "DINNER"), false);

      assert.strictEqual(isPlanEligibleForSlot("HB", "BREAKFAST"), true);
      assert.strictEqual(isPlanEligibleForSlot("HB", "LUNCH"), false);
      assert.strictEqual(isPlanEligibleForSlot("HB", "DINNER"), true);

      assert.strictEqual(isPlanEligibleForSlot("FB", "LUNCH"), true);
      assert.strictEqual(isPlanEligibleForSlot("FB", "AFTERNOON_TEA"), false);

      assert.strictEqual(isPlanEligibleForSlot("AI", "AFTERNOON_TEA"), true);
      assert.strictEqual(isPlanEligibleForSlot("AI", "ALL_DAY"), true);
    });

    it("evaluates item eligibility per meal plan", () => {
      assert.strictEqual(isItemEligibleUnderPlan(hopperBreakfast, "BB"), true);
      assert.strictEqual(isItemEligibleUnderPlan(riceCurryDinner, "BB"), false);
      assert.strictEqual(isItemEligibleUnderPlan(riceCurryDinner, "HB"), true);
      assert.strictEqual(isItemEligibleUnderPlan(watalappanDessert, "HB"), false);
      assert.strictEqual(isItemEligibleUnderPlan(watalappanDessert, "AI"), true);
    });
  });

  describe("2. Rung 6 Core Entitlement Allocation & Rung 5 Verification", () => {
    it("satisfies Rung 5: 2-adult HB room ordering 2 included dinners + 1 paid extra dessert", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-HB-204",
        tenantId: "TENANT-CEYLON-HERITAGE",
        roomNumber: "204",
        mealPlan: "HB",
        adultsCount: 2,
        childrenCount: 0,
        ordersAlreadyFulfilledInCurrentWindow: 0,
      };

      const params: MealPlanPricingParams = {
        tenantId: "TENANT-CEYLON-HERITAGE",
        reservation: res,
        currentSlTime: "20:00", // DINNER window
        orderItems: [
          { ...riceCurryDinner, quantity: 2 }, // 2 included dinner sets
          { ...watalappanDessert, quantity: 1 }, // 1 extra dessert
        ],
      };

      const result = applyMealPlanEntitlements(params);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const pricing = result.value;
      assert.strictEqual(pricing.evaluatedSlot, "DINNER");
      assert.strictEqual(pricing.totalHeadcountAllowance, 2);
      assert.strictEqual(pricing.allowanceGrantedThisOrder, 2);
      assert.strictEqual(pricing.allowanceRemainingAfterOrder, 0);

      // Line 1: 2 included dinners -> 100% complimentary (LKR 0.00 base, 0 tax)
      const dinnerLine = pricing.lines[0];
      assert.ok(dinnerLine);
      assert.strictEqual(dinnerLine.complimentaryQuantity, 2);
      assert.strictEqual(dinnerLine.billedQuantity, 0);
      assert.strictEqual(dinnerLine.lineBaseLkr, 0);
      assert.strictEqual(dinnerLine.taxBreakdown.grandTotalLkr, 0);
      assert.strictEqual(dinnerLine.isComplimentary, true);
      assert.strictEqual(dinnerLine.savingsLkr, 5200); // 2 * 2600

      // Line 2: 1 dessert -> billed at standard menu rate (LKR 850 + compounding tax)
      const dessertLine = pricing.lines[1];
      assert.ok(dessertLine);
      assert.strictEqual(dessertLine.complimentaryQuantity, 0);
      assert.strictEqual(dessertLine.billedQuantity, 1);
      assert.strictEqual(dessertLine.lineBaseLkr, 850);
      assert.ok(dessertLine.taxBreakdown.grandTotalLkr > 850);
      assert.strictEqual(dessertLine.isComplimentary, false);
      assert.strictEqual(dessertLine.savingsLkr, 0);

      // Order Totals
      assert.strictEqual(pricing.orderSubtotalBaseLkr, 850);
      assert.strictEqual(pricing.totalSavingsUnderMealPlanLkr, 5200);
      assert.ok(pricing.orderGrandTotalLkr > 850);

      // Audit Record
      assert.strictEqual(pricing.auditRecord.action, "MEAL_PLAN_ENTITLEMENT_RESOLVED");
      assert.strictEqual(pricing.auditRecord.actor, "RES#RES-HB-204#ROOM#204");
    });

    it("prevents abuse beyond room headcount when ordering more sets than registered guests", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-BB-101",
        tenantId: "TENANT-GALLE-FORT",
        roomNumber: "101",
        mealPlan: "BB",
        adultsCount: 2,
        childrenCount: 1, // 3 headcount
        ordersAlreadyFulfilledInCurrentWindow: 0,
      };

      const params: MealPlanPricingParams = {
        tenantId: "TENANT-GALLE-FORT",
        reservation: res,
        currentSlTime: "08:30", // BREAKFAST window
        orderItems: [
          { ...hopperBreakfast, quantity: 5 }, // Orders 5, but allowance is only 3
        ],
      };

      const result = applyMealPlanEntitlements(params);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const pricing = result.value;
      assert.strictEqual(pricing.totalHeadcountAllowance, 3);
      assert.strictEqual(pricing.allowanceGrantedThisOrder, 3);
      assert.strictEqual(pricing.allowanceRemainingAfterOrder, 0);

      const line = pricing.lines[0];
      assert.ok(line);
      assert.strictEqual(line.complimentaryQuantity, 3);
      assert.strictEqual(line.billedQuantity, 2); // 2 sets billed!
      assert.strictEqual(line.lineBaseLkr, 3700); // 2 * 1850
      assert.strictEqual(line.savingsLkr, 5550); // 3 * 1850 saved!
    });

    it("respects meals already fulfilled earlier in the current meal window", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-FB-305",
        tenantId: "TENANT-KANDY-ROYAL",
        roomNumber: "305",
        mealPlan: "FB",
        adultsCount: 2,
        childrenCount: 0, // 2 pax
        ordersAlreadyFulfilledInCurrentWindow: 1, // 1 already taken
      };

      const params: MealPlanPricingParams = {
        tenantId: "TENANT-KANDY-ROYAL",
        reservation: res,
        currentSlTime: "13:30", // LUNCH window
        orderItems: [{ ...riceCurryDinner, quantity: 2 }],
      };

      const result = applyMealPlanEntitlements(params);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const pricing = result.value;
      assert.strictEqual(pricing.allowanceAlreadyConsumed, 1);
      assert.strictEqual(pricing.allowanceGrantedThisOrder, 1); // Only 1 remaining
      assert.strictEqual(pricing.allowanceRemainingAfterOrder, 0);

      const line = pricing.lines[0];
      assert.ok(line);
      assert.strictEqual(line.complimentaryQuantity, 1);
      assert.strictEqual(line.billedQuantity, 1);
      assert.strictEqual(line.lineBaseLkr, 2600);
    });

    it("handles All Inclusive specialty upgrade supplements and bar items", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-AI-999",
        tenantId: "TENANT-BENTOTA-RESORT",
        roomNumber: "999",
        mealPlan: "AI",
        adultsCount: 2,
        childrenCount: 0,
      };

      const params: MealPlanPricingParams = {
        tenantId: "TENANT-BENTOTA-RESORT",
        reservation: res,
        currentSlTime: "20:00", // DINNER window
        orderItems: [
          { ...lagoonCrabPremium, quantity: 1 }, // LKR 3,500 supplement
          { ...lionBeerBar, quantity: 2 }, // Free under AI all-day
        ],
      };

      const result = applyMealPlanEntitlements(params);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const pricing = result.value;
      // Crab: complimentary base, LKR 3,500 supplement upgrade
      const crabLine = pricing.lines[0];
      assert.ok(crabLine);
      assert.strictEqual(crabLine.isSupplement, true);
      assert.strictEqual(crabLine.lineBaseLkr, 3500);
      assert.strictEqual(crabLine.savingsLkr, 3300); // 6800 - 3500

      // Beer: 100% free under AI
      const beerLine = pricing.lines[1];
      assert.ok(beerLine);
      assert.strictEqual(beerLine.isComplimentary, true);
      assert.strictEqual(beerLine.lineBaseLkr, 0);
      assert.strictEqual(beerLine.savingsLkr, 2200); // 2 * 1100
    });

    it("bills full price when guest is Room Only (RO) or ordering outside active window", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-RO-501",
        tenantId: "TENANT-MIRISSA-INN",
        roomNumber: "501",
        mealPlan: "RO",
        adultsCount: 2,
        childrenCount: 0,
      };

      const params: MealPlanPricingParams = {
        tenantId: "TENANT-MIRISSA-INN",
        reservation: res,
        currentSlTime: "08:00",
        orderItems: [{ ...hopperBreakfast, quantity: 2 }],
      };

      const result = applyMealPlanEntitlements(params);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const pricing = result.value;
      assert.strictEqual(pricing.allowanceGrantedThisOrder, 0);
      assert.strictEqual(pricing.orderSubtotalBaseLkr, 3700); // 2 * 1850
      assert.strictEqual(pricing.totalSavingsUnderMealPlanLkr, 0);
    });

    it("bills dish modifiers correctly even when base dish is complimentary", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-HB-202",
        tenantId: "TENANT-COLOMBO-HOTEL",
        roomNumber: "202",
        mealPlan: "HB",
        adultsCount: 1,
        childrenCount: 0,
      };

      const params: MealPlanPricingParams = {
        tenantId: "TENANT-COLOMBO-HOTEL",
        reservation: res,
        currentSlTime: "20:00",
        orderItems: [
          {
            ...riceCurryDinner,
            quantity: 1,
            modifiersPriceLkr: 250, // +Egg Hopper modifier
          },
        ],
      };

      const result = applyMealPlanEntitlements(params);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const pricing = result.value;
      const line = pricing.lines[0];
      assert.ok(line);
      assert.strictEqual(line.complimentaryQuantity, 1);
      assert.strictEqual(line.lineBaseLkr, 250); // Only modifier charged
      assert.strictEqual(line.savingsLkr, 2600); // 2600 base saved
    });
  });

  describe("3. Multi-Tenant Validation & Error Guarding", () => {
    it("rejects tenant ID mismatch between params and reservation", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-1",
        tenantId: "TENANT-A",
        roomNumber: "101",
        mealPlan: "BB",
        adultsCount: 2,
        childrenCount: 0,
      };

      const result = applyMealPlanEntitlements({
        tenantId: "TENANT-B",
        reservation: res,
        orderItems: [hopperBreakfast],
      });

      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "TENANT_MISMATCH");
    });

    it("rejects empty order items list", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-1",
        tenantId: "TENANT-A",
        roomNumber: "101",
        mealPlan: "BB",
        adultsCount: 2,
        childrenCount: 0,
      };

      const result = applyMealPlanEntitlements({
        tenantId: "TENANT-A",
        reservation: res,
        orderItems: [],
      });

      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "INVALID_ORDER_ITEMS");
    });

    it("rejects 0 total headcount reservation", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-1",
        tenantId: "TENANT-A",
        roomNumber: "101",
        mealPlan: "BB",
        adultsCount: 0,
        childrenCount: 0,
      };

      const result = applyMealPlanEntitlements({
        tenantId: "TENANT-A",
        reservation: res,
        orderItems: [hopperBreakfast],
      });

      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "INVALID_RESERVATION");
    });

    it("rejects non-positive integer item quantities", () => {
      const res: ReservationGuestContext = {
        reservationId: "RES-1",
        tenantId: "TENANT-A",
        roomNumber: "101",
        mealPlan: "BB",
        adultsCount: 2,
        childrenCount: 0,
      };

      const result = applyMealPlanEntitlements({
        tenantId: "TENANT-A",
        reservation: res,
        orderItems: [{ ...hopperBreakfast, quantity: 0 }],
      });

      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "INVALID_ORDER_ITEMS");
    });
  });
});
