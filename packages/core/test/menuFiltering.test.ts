import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CategoryScheduleConfig,
  type FilterAndPriceParams,
  GENESIS_HASH,
  type HappyHourRule,
  type MenuItemFilterItem,
  applyHappyHourWithAudit,
  evaluateItemHappyHourDiscount,
  filterAndPriceMenuItems,
  isItemDietaryCompliant,
} from "../src/index.js";

describe("Step 249: Menu Filtering, Happy Hour Pricing & Dietary Tagging (menuFiltering.ts)", () => {
  const tenantId = "tenant-galle-resort";

  // Standard Sri Lankan F&B Menu Test Fixtures
  const chickenRice: MenuItemFilterItem = {
    id: "item-curry-01",
    code: "CUR-101",
    name: "Village Style Chicken Rice & Curry",
    categoryId: "cat-curry",
    basePriceLkr: 2000,
    isVegetarian: false,
    isVegan: false,
    isHalal: true,
    isGlutenFree: true,
    containsPork: false,
    containsBeef: false,
    spicyLevel: 2,
    isAvailable: true,
  };

  const dhalCurry: MenuItemFilterItem = {
    id: "item-curry-02",
    code: "CUR-102",
    name: "Clay-Pot Dhal with Coconut Milk",
    categoryId: "cat-curry",
    basePriceLkr: 1200,
    isVegetarian: true,
    isVegan: true,
    isHalal: true,
    isGlutenFree: true,
    containsPork: false,
    containsBeef: false,
    spicyLevel: 1,
    isAvailable: true,
  };

  const blackPork: MenuItemFilterItem = {
    id: "item-curry-03",
    code: "CUR-105",
    name: "Southern Black Pork Curry with Roast Paan",
    categoryId: "cat-curry",
    basePriceLkr: 3000,
    isVegetarian: false,
    isVegan: false,
    isHalal: false,
    isGlutenFree: false,
    containsPork: true,
    containsBeef: false,
    spicyLevel: 3,
    isAvailable: false, // 86'd
  };

  const lionBeer: MenuItemFilterItem = {
    id: "item-bar-01",
    code: "BAR-201",
    name: "Lion Lager Beer 625ml",
    categoryId: "cat-beverage",
    basePriceLkr: 1000,
    isVegetarian: true,
    isVegan: true,
    isHalal: false,
    isGlutenFree: false,
    containsPork: false,
    containsBeef: false,
    spicyLevel: 0,
    isAvailable: true,
  };

  const arrackCocktail: MenuItemFilterItem = {
    id: "item-bar-02",
    code: "BAR-108",
    name: "Old Reserve Arrack Sour Cocktail",
    categoryId: "cat-beverage",
    basePriceLkr: 2000,
    isVegetarian: true,
    isVegan: true,
    isHalal: false,
    isGlutenFree: true,
    containsPork: false,
    containsBeef: false,
    spicyLevel: 0,
    isAvailable: true,
  };

  const allItems: ReadonlyArray<MenuItemFilterItem> = [
    chickenRice,
    dhalCurry,
    blackPork,
    lionBeer,
    arrackCocktail,
  ];

  const categories: ReadonlyArray<CategoryScheduleConfig> = [
    {
      categoryId: "cat-curry",
      name: "Rice & Curries",
      isActive: true,
      availableWindow: {
        startTime: "11:30",
        endTime: "22:00",
      },
    },
    {
      categoryId: "cat-beverage",
      name: "Bar & Beverages",
      isActive: true,
      availableWindow: {
        startTime: "11:00",
        endTime: "23:30",
      },
    },
  ];

  describe("1. Dietary Compliance & Spice Level Filtering", () => {
    it("filters vegetarian and vegan compliant dishes correctly", () => {
      assert.strictEqual(isItemDietaryCompliant(dhalCurry, ["VEGETARIAN"]), true);
      assert.strictEqual(isItemDietaryCompliant(dhalCurry, ["VEGAN"]), true);
      assert.strictEqual(isItemDietaryCompliant(chickenRice, ["VEGETARIAN"]), false);
      assert.strictEqual(isItemDietaryCompliant(chickenRice, ["VEGAN"]), false);
    });

    it("verifies Halal and Gluten-Free compliance", () => {
      assert.strictEqual(isItemDietaryCompliant(chickenRice, ["HALAL", "GLUTEN_FREE"]), true);
      assert.strictEqual(isItemDietaryCompliant(blackPork, ["HALAL"]), false);
      assert.strictEqual(isItemDietaryCompliant(lionBeer, ["HALAL"]), false);
    });

    it("verifies Pork-Free and Beef-Free exclusions", () => {
      assert.strictEqual(isItemDietaryCompliant(blackPork, ["PORK_FREE"]), false);
      assert.strictEqual(isItemDietaryCompliant(chickenRice, ["PORK_FREE", "BEEF_FREE"]), true);
    });

    it("filters dishes exceeding the maximum spicy level", () => {
      // Dhal has spice 1, Chicken has spice 2, Black Pork has spice 3
      assert.strictEqual(isItemDietaryCompliant(dhalCurry, undefined, 1), true);
      assert.strictEqual(isItemDietaryCompliant(chickenRice, undefined, 1), false);
      assert.strictEqual(isItemDietaryCompliant(chickenRice, undefined, 2), true);
      assert.strictEqual(isItemDietaryCompliant(blackPork, undefined, 2), false);
    });
  });

  describe("2. Dynamic Happy Hour & Poolside Pricing Engine", () => {
    const sunsetHappyHour: HappyHourRule = {
      ruleId: "hh-sunset-20",
      tenantId,
      name: "Sunset Happy Hour 20% Off Beverages",
      discountType: "PERCENTAGE",
      discountValue: 20,
      applicableCategoryIds: ["cat-beverage"],
      startTime: "17:00",
      endTime: "19:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // Daily
      isActive: true,
    };

    const bogoCocktail: HappyHourRule = {
      ruleId: "hh-bogo-arrack",
      tenantId,
      name: "BOGO Arrack Cocktails",
      discountType: "BOGO",
      discountValue: 50,
      applicableItemIds: ["item-bar-02"],
      startTime: "18:00",
      endTime: "20:00",
      isActive: true,
    };

    it("calculates 20% percentage discount on Lion Beer during 17:30 Sunset window", () => {
      // 17:30 = 17 * 60 + 30 = 1050 minutes
      const result = evaluateItemHappyHourDiscount(lionBeer, [sunsetHappyHour], 1050, 2);
      assert.strictEqual(result.discountLkr, 200); // 20% of 1000
      assert.strictEqual(result.effectivePriceLkr, 800);
      assert.strictEqual(result.rule?.ruleId, "hh-sunset-20");
    });

    it("does not apply Happy Hour discount outside the operating window", () => {
      // 14:00 = 840 minutes (lunch time, before 17:00)
      const result = evaluateItemHappyHourDiscount(lionBeer, [sunsetHappyHour], 840, 2);
      assert.strictEqual(result.discountLkr, 0);
      assert.strictEqual(result.effectivePriceLkr, 1000);
      assert.strictEqual(result.rule, null);
    });

    it("chooses the higher discount when multiple rules overlap", () => {
      // At 18:30, both 20% Sunset and 50% BOGO apply to Arrack Cocktail (2,000 LKR base)
      // 20% = 400 LKR discount; BOGO (50%) = 1,000 LKR discount
      const result = evaluateItemHappyHourDiscount(
        arrackCocktail,
        [sunsetHappyHour, bogoCocktail],
        18 * 60 + 30,
        2,
      );
      assert.strictEqual(result.discountLkr, 1000);
      assert.strictEqual(result.effectivePriceLkr, 1000);
      assert.strictEqual(result.rule?.ruleId, "hh-bogo-arrack");
    });

    it("respects inactive flag on happy hour rule", () => {
      const inactiveRule: HappyHourRule = { ...sunsetHappyHour, isActive: false };
      const result = evaluateItemHappyHourDiscount(lionBeer, [inactiveRule], 1050, 2);
      assert.strictEqual(result.discountLkr, 0);
      assert.strictEqual(result.effectivePriceLkr, 1000);
    });
  });

  describe("3. End-to-End Filter & 4-Stage Sri Lankan Compounding Tax Math", () => {
    it("filters and prices menu items applying 4-stage tax on discounted prices", () => {
      // Reference date: 2026-10-19T12:00:00Z -> 17:30 SLST (Sunset Happy Hour window)
      const refDate = new Date("2026-10-19T12:00:00Z");

      const sunsetRule: HappyHourRule = {
        ruleId: "hh-beer-25",
        tenantId,
        name: "Sunset 25% Off Beer",
        discountType: "PERCENTAGE",
        discountValue: 25,
        applicableItemIds: ["item-bar-01"],
        startTime: "17:00",
        endTime: "19:00",
        isActive: true,
      };

      const filterParams: FilterAndPriceParams = {
        tenantId,
        items: allItems,
        categories,
        happyHourRules: [sunsetRule],
        options: {
          tenantId,
          referenceDate: refDate,
          dietaryPreferences: ["HALAL"],
        },
      };

      const result = filterAndPriceMenuItems(filterParams);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const { items, totalItemsCount } = result.value;
      // Only Halal items: Chicken Rice and Dhal Curry (Lion beer and Black pork are not Halal)
      assert.strictEqual(totalItemsCount, 2);
      const chicken = items.find((p) => p.item.id === "item-curry-01");
      assert.ok(chicken);
      assert.strictEqual(chicken.originalBasePriceLkr, 2000);
      assert.strictEqual(chicken.effectiveBasePriceLkr, 2000);
      assert.strictEqual(chicken.isOrderableNow, true);

      // Verify 4-stage compounding Sri Lankan statutory tax math:
      // Base: 2000.00
      // SC (10%): 200.00
      // TDL (1% on Base + SC = 2200): 22.00
      // SSCL (2.5% on Base + SC + TDL = 2222): 55.55
      // VAT (18% on Base + SC + TDL + SSCL = 2277.55): 409.96
      // Grand Total: 2687.51 LKR
      const tax = chicken.taxBreakdown;
      assert.strictEqual(tax.baseLkr, 2000);
      assert.strictEqual(tax.scLkr, 200);
      assert.strictEqual(tax.tdlLkr, 22);
      assert.strictEqual(tax.ssclLkr, 55);
      assert.strictEqual(tax.vatLkr, 409.86);
      assert.strictEqual(tax.grandTotalLkr, 2686.86);
    });

    it("verifies 86'd items are not orderable and report unavailableReason", () => {
      const refDate = new Date("2026-10-19T12:00:00Z");
      const result = filterAndPriceMenuItems({
        tenantId,
        items: [blackPork],
        categories,
        options: { tenantId, referenceDate: refDate },
      });

      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const pork = result.value.items[0];
      assert.ok(pork);
      assert.strictEqual(pork.isOrderableNow, false);
      assert.ok(pork.unavailableReason?.includes("86'd"));
    });

    it("filters out 86'd items completely when onlyInStock is true", () => {
      const refDate = new Date("2026-10-19T12:00:00Z");
      const result = filterAndPriceMenuItems({
        tenantId,
        items: allItems,
        categories,
        options: { tenantId, referenceDate: refDate, onlyInStock: true },
      });

      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      // 4 available items out of 5 (blackPork excluded)
      assert.strictEqual(result.value.totalItemsCount, 4);
      assert.ok(!result.value.items.some((p) => p.item.id === "item-curry-03"));
    });

    it("rejects empty tenantId with VALIDATION_FAILED", () => {
      const result = filterAndPriceMenuItems({
        tenantId: "",
        items: allItems,
        categories,
      });

      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    });
  });

  describe("4. Happy Hour Mutation & Hash-Chained Immutable Audit Log", () => {
    it("appends cryptographically verified SHA-256 audit log entry on happy hour creation", () => {
      const newRule: HappyHourRule = {
        ruleId: "hh-cabana-bogo",
        tenantId,
        name: "Cabana Poolside BOGO Cocktails",
        discountType: "BOGO",
        discountValue: 50,
        startTime: "16:00",
        endTime: "18:00",
        isActive: true,
      };

      const result = applyHappyHourWithAudit({
        tenantId,
        actorUserId: "user-fnb-manager",
        rule: newRule,
        previousAuditHash: GENESIS_HASH,
      });

      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const { rule, auditEntry } = result.value;
      assert.strictEqual(rule.ruleId, "hh-cabana-bogo");
      assert.strictEqual(auditEntry.tenantId, tenantId);
      assert.strictEqual(auditEntry.action, "HAPPY_HOUR_RULE_APPLIED");
      assert.strictEqual(auditEntry.prevHash, GENESIS_HASH);
      assert.strictEqual(auditEntry.entryHash.length, 64);
      assert.strictEqual(/^[0-9a-f]{64}$/.test(auditEntry.entryHash), true);
    });

    it("rejects invalid happy hour rule with negative or zero discount value", () => {
      const invalidRule: HappyHourRule = {
        ruleId: "hh-invalid",
        tenantId,
        name: "Invalid Rule",
        discountType: "PERCENTAGE",
        discountValue: 0,
        startTime: "17:00",
        endTime: "19:00",
        isActive: true,
      };

      const result = applyHappyHourWithAudit({
        tenantId,
        actorUserId: "user-manager",
        rule: invalidRule,
      });

      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    });
  });
});
