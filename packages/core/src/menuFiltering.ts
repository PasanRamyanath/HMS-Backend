/**
 * @hms/core - Menu Filtering, Dynamic Happy Hour Pricing & Dietary Tagging Engine.
 *
 * Implements Step 249 (Phase 10.24) of the Sri Lanka HMS Architecture Plan:
 * Rung 5: Pure deterministic domain engine composing:
 * 1. Category operational schedule availability in Sri Lanka Standard Time (Asia/Colombo).
 * 2. Multi-preference dietary filter composition (Vegetarian, Vegan, Halal, Gluten-Free, Pork-Free, Beef-Free, Spice).
 * 3. Dynamic Happy Hour & Poolside pricing (Percentage, Fixed Amount, BOGO discounts with time windows & days of week).
 * 4. Multi-tenant tenantId isolation and role validation.
 * 5. Sri Lankan statutory 4-stage compounding tax calculation (SC -> TDL -> SSCL -> VAT) on discounted prices.
 * 6. SHA-256 hash-chained ImmutableAuditLog records for pricing updates and happy hour activations.
 */

import { type AuditLogEntry, GENESIS_HASH, createAuditEntry } from "./auditChain.js";
import { type CategoryScheduleConfig, isCategoryAvailableNow } from "./menuSchedule.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type DietaryPreference =
  | "VEGETARIAN"
  | "VEGAN"
  | "HALAL"
  | "GLUTEN_FREE"
  | "PORK_FREE"
  | "BEEF_FREE";

export type HappyHourDiscountType = "PERCENTAGE" | "FIXED_AMOUNT" | "BOGO";

export interface HappyHourRule {
  readonly ruleId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly discountType: HappyHourDiscountType;
  /** Value: e.g. 20 for 20% off, 500 for 500 LKR off, 50 for 50% BOGO effective discount */
  readonly discountValue: number;
  readonly applicableCategoryIds?: ReadonlyArray<string> | undefined;
  readonly applicableItemIds?: ReadonlyArray<string> | undefined;
  /** 24-hour SLST start time "HH:mm" (e.g., "17:00") */
  readonly startTime: string;
  /** 24-hour SLST end time "HH:mm" (e.g., "19:00") */
  readonly endTime: string;
  /** Active days: 0 = Sun, 1 = Mon, ..., 6 = Sat. If omitted, all days */
  readonly daysOfWeek?: ReadonlyArray<number> | undefined;
  readonly isActive: boolean;
  readonly minOrderQuantity?: number | undefined;
}

export interface MenuItemFilterItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly categoryId: string;
  readonly basePriceLkr: number;
  readonly isVegetarian: boolean;
  readonly isVegan: boolean;
  readonly isHalal: boolean;
  readonly isGlutenFree: boolean;
  readonly containsPork: boolean;
  readonly containsBeef: boolean;
  readonly spicyLevel: number; // 0 = Mild, 1 = Medium, 2 = Hot, 3 = Sri Lankan Hot
  readonly isAvailable: boolean; // false when 86'd
}

export interface MenuFilterOptions {
  readonly tenantId: string;
  readonly referenceDate?: Date | undefined;
  readonly selectedCategoryIds?: ReadonlyArray<string> | undefined;
  readonly dietaryPreferences?: ReadonlyArray<DietaryPreference> | undefined;
  readonly maxSpicyLevel?: number | undefined;
  readonly onlyInStock?: boolean | undefined;
  readonly searchQuery?: string | undefined;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
}

export interface PricedMenuItem {
  readonly item: MenuItemFilterItem;
  readonly originalBasePriceLkr: number;
  readonly effectiveBasePriceLkr: number;
  readonly happyHourDiscountLkr: number;
  readonly appliedRule: HappyHourRule | null;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly isCategoryOpen: boolean;
  readonly isOrderableNow: boolean;
  readonly unavailableReason?: string | undefined;
}

export interface FilteredMenuCatalogResult {
  readonly tenantId: string;
  readonly evaluatedAtIso: string;
  readonly evaluatedTimeSlst: string;
  readonly totalItemsCount: number;
  readonly orderableItemsCount: number;
  readonly discountedItemsCount: number;
  readonly items: ReadonlyArray<PricedMenuItem>;
}

export interface FilterAndPriceParams {
  readonly tenantId: string;
  readonly items: ReadonlyArray<MenuItemFilterItem>;
  readonly categories: ReadonlyArray<CategoryScheduleConfig>;
  readonly happyHourRules?: ReadonlyArray<HappyHourRule> | undefined;
  readonly options?: MenuFilterOptions | undefined;
}

// ============================================================================
// Internal Helper Predicates (Cognitive Complexity <= 12)
// ============================================================================

function matchesDietaryPreference(item: MenuItemFilterItem, pref: DietaryPreference): boolean {
  switch (pref) {
    case "VEGETARIAN":
      return item.isVegetarian || item.isVegan;
    case "VEGAN":
      return item.isVegan;
    case "HALAL":
      return item.isHalal;
    case "GLUTEN_FREE":
      return item.isGlutenFree;
    case "PORK_FREE":
      return !item.containsPork;
    case "BEEF_FREE":
      return !item.containsBeef;
    default:
      return true;
  }
}

/**
 * Checks whether an item satisfies all specified dietary preferences.
 */
export function isItemDietaryCompliant(
  item: MenuItemFilterItem,
  preferences?: ReadonlyArray<DietaryPreference> | undefined,
  maxSpicyLevel?: number | undefined,
): boolean {
  if (maxSpicyLevel !== undefined && item.spicyLevel > maxSpicyLevel) {
    return false;
  }

  if (!preferences || preferences.length === 0) {
    return true;
  }

  for (const pref of preferences) {
    if (!matchesDietaryPreference(item, pref)) {
      return false;
    }
  }

  return true;
}

function parseTimeToMinutes(time: string): number {
  const parts = time.trim().split(":");
  const hours = Number.parseInt(parts[0] ?? "0", 10);
  const mins = Number.parseInt(parts[1] ?? "0", 10);
  return hours * 60 + mins;
}

function isTimeWithinWindow(
  currentMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  // Cross-midnight window
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

function isRuleTargetingItem(rule: HappyHourRule, item: MenuItemFilterItem): boolean {
  if (rule.applicableItemIds && rule.applicableItemIds.length > 0) {
    return rule.applicableItemIds.includes(item.id);
  }
  if (rule.applicableCategoryIds && rule.applicableCategoryIds.length > 0) {
    return rule.applicableCategoryIds.includes(item.categoryId);
  }
  return true;
}

function isRuleActiveNow(rule: HappyHourRule, currentMinutes: number, dayOfWeek: number): boolean {
  if (!rule.isActive) {
    return false;
  }
  if (rule.daysOfWeek && rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(dayOfWeek)) {
    return false;
  }
  const startMins = parseTimeToMinutes(rule.startTime);
  const endMins = parseTimeToMinutes(rule.endTime);
  return isTimeWithinWindow(currentMinutes, startMins, endMins);
}

function calculateDiscountAmount(itemBasePrice: number, rule: HappyHourRule): number {
  if (rule.discountType === "PERCENTAGE") {
    return Math.round((itemBasePrice * (rule.discountValue / 100) + Number.EPSILON) * 100) / 100;
  }
  if (rule.discountType === "FIXED_AMOUNT") {
    return Math.min(rule.discountValue, itemBasePrice);
  }
  if (rule.discountType === "BOGO") {
    return Math.round((itemBasePrice * 0.5 + Number.EPSILON) * 100) / 100;
  }
  return 0;
}

/**
 * Evaluates active Happy Hour discount for a single menu item in SLST.
 */
export function evaluateItemHappyHourDiscount(
  item: MenuItemFilterItem,
  rules: ReadonlyArray<HappyHourRule>,
  currentMinutes: number,
  dayOfWeek: number,
): {
  readonly discountLkr: number;
  readonly rule: HappyHourRule | null;
  readonly effectivePriceLkr: number;
} {
  let bestDiscountLkr = 0;
  let bestRule: HappyHourRule | null = null;

  for (const rule of rules) {
    if (!isRuleActiveNow(rule, currentMinutes, dayOfWeek)) {
      continue;
    }
    if (!isRuleTargetingItem(rule, item)) {
      continue;
    }

    const discount = calculateDiscountAmount(item.basePriceLkr, rule);
    if (discount > bestDiscountLkr) {
      bestDiscountLkr = discount;
      bestRule = rule;
    }
  }

  const effectivePrice = Math.max(0, item.basePriceLkr - bestDiscountLkr);
  const roundedEffective = Math.round((effectivePrice + Number.EPSILON) * 100) / 100;

  return {
    discountLkr: bestDiscountLkr,
    rule: bestRule,
    effectivePriceLkr: roundedEffective,
  };
}

// ============================================================================
// Core Filter & Pricing Engine: filterAndPriceMenuItems
// ============================================================================

function getSlstTimeComponents(refDate: Date): {
  readonly timeStr: string;
  readonly currentMinutes: number;
  readonly dayOfWeek: number;
} {
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeStr = timeFormatter.format(refDate);
  const currentMinutes = parseTimeToMinutes(timeStr);

  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Colombo",
    weekday: "short",
  });
  const dayStr = dayFormatter.format(refDate);
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = dayMap[dayStr] ?? 0;
  return { timeStr, currentMinutes, dayOfWeek };
}

function matchesSearchQuery(item: MenuItemFilterItem, rawQuery: string): boolean {
  if (rawQuery.length === 0) {
    return true;
  }
  return item.name.toLowerCase().includes(rawQuery) || item.code.toLowerCase().includes(rawQuery);
}

function passesItemFilters(
  item: MenuItemFilterItem,
  options: MenuFilterOptions | undefined,
  rawQuery: string,
): boolean {
  if (!isItemDietaryCompliant(item, options?.dietaryPreferences, options?.maxSpicyLevel)) {
    return false;
  }
  if (
    options?.selectedCategoryIds &&
    options.selectedCategoryIds.length > 0 &&
    !options.selectedCategoryIds.includes(item.categoryId)
  ) {
    return false;
  }
  if (options?.onlyInStock && !item.isAvailable) {
    return false;
  }
  return matchesSearchQuery(item, rawQuery);
}

function resolveUnavailableReason(
  isAvailable: boolean,
  isCategoryOpen: boolean,
): string | undefined {
  if (!isAvailable) {
    return "Item 86'd (Temporarily out of stock)";
  }
  if (!isCategoryOpen) {
    return "Category service window currently closed";
  }
  return undefined;
}

function buildCategoryScheduleMap(
  categories: ReadonlyArray<CategoryScheduleConfig>,
  refDate: Date,
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const cat of categories) {
    const res = isCategoryAvailableNow(cat, refDate);
    map.set(cat.categoryId, res.ok ? res.value.isAvailable : false);
  }
  return map;
}

interface PriceItemContext {
  readonly happyHourRules: ReadonlyArray<HappyHourRule>;
  readonly currentMinutes: number;
  readonly dayOfWeek: number;
  readonly taxConfig: SriLankaTaxConfig;
  readonly isCategoryOpen: boolean;
}

function priceSingleMenuItem(
  item: MenuItemFilterItem,
  ctx: PriceItemContext,
): Result<PricedMenuItem, DomainError> {
  const { discountLkr, rule, effectivePriceLkr } = evaluateItemHappyHourDiscount(
    item,
    ctx.happyHourRules,
    ctx.currentMinutes,
    ctx.dayOfWeek,
  );

  const taxRes = calculateForwardTax(effectivePriceLkr, ctx.taxConfig);
  if (!taxRes.ok) {
    return domainErr(taxRes.error.code, taxRes.error.message);
  }

  const isOrderable = ctx.isCategoryOpen && item.isAvailable;
  const unavailableReason = resolveUnavailableReason(item.isAvailable, ctx.isCategoryOpen);

  return ok({
    item,
    originalBasePriceLkr: item.basePriceLkr,
    effectiveBasePriceLkr: effectivePriceLkr,
    happyHourDiscountLkr: discountLkr,
    appliedRule: rule,
    taxBreakdown: taxRes.value,
    isCategoryOpen: ctx.isCategoryOpen,
    isOrderableNow: isOrderable,
    unavailableReason,
  });
}

interface FilterContext {
  readonly happyHourRules: ReadonlyArray<HappyHourRule>;
  readonly currentMinutes: number;
  readonly dayOfWeek: number;
  readonly taxConfig: SriLankaTaxConfig;
  readonly categoryScheduleMap: Map<string, boolean>;
  readonly rawQuery: string;
}

interface FilterAccumulator {
  readonly pricedItems: PricedMenuItem[];
  orderableCount: number;
  discountedCount: number;
}

function buildFilterContext(params: FilterAndPriceParams, refDate: Date): FilterContext {
  const { currentMinutes, dayOfWeek } = getSlstTimeComponents(refDate);
  const rules = params.happyHourRules ?? [];
  return {
    happyHourRules: rules.filter((r) => r.tenantId === params.tenantId),
    currentMinutes,
    dayOfWeek,
    taxConfig: params.options?.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG,
    categoryScheduleMap: buildCategoryScheduleMap(params.categories, refDate),
    rawQuery: params.options?.searchQuery?.trim().toLowerCase() ?? "",
  };
}

function processSingleFilteredItem(
  item: MenuItemFilterItem,
  ctx: FilterContext,
  acc: FilterAccumulator,
): Result<void, DomainError> {
  const itemCtx: PriceItemContext = {
    happyHourRules: ctx.happyHourRules,
    currentMinutes: ctx.currentMinutes,
    dayOfWeek: ctx.dayOfWeek,
    taxConfig: ctx.taxConfig,
    isCategoryOpen: ctx.categoryScheduleMap.get(item.categoryId) ?? true,
  };

  const pricedRes = priceSingleMenuItem(item, itemCtx);
  if (!pricedRes.ok) {
    return domainErr(pricedRes.error.code, pricedRes.error.message);
  }

  const priced = pricedRes.value;
  if (priced.happyHourDiscountLkr > 0) {
    acc.discountedCount += 1;
  }
  if (priced.isOrderableNow) {
    acc.orderableCount += 1;
  }
  acc.pricedItems.push(priced);
  return ok(undefined);
}

/**
 * Filters and calculates dynamic prices with Sri Lankan 4-stage compounding taxes.
 */
export function filterAndPriceMenuItems(
  params: FilterAndPriceParams,
): Result<FilteredMenuCatalogResult, DomainError> {
  if (!params.tenantId || params.tenantId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Tenant ID is required for menu filtering");
  }

  const refDate = params.options?.referenceDate ?? new Date();
  const ctx = buildFilterContext(params, refDate);
  const { timeStr } = getSlstTimeComponents(refDate);

  const acc: FilterAccumulator = {
    pricedItems: [],
    orderableCount: 0,
    discountedCount: 0,
  };

  for (const item of params.items) {
    if (!passesItemFilters(item, params.options, ctx.rawQuery)) {
      continue;
    }

    const processRes = processSingleFilteredItem(item, ctx, acc);
    if (!processRes.ok) {
      return domainErr(processRes.error.code, processRes.error.message);
    }
  }

  return ok({
    tenantId: params.tenantId,
    evaluatedAtIso: refDate.toISOString(),
    evaluatedTimeSlst: timeStr,
    totalItemsCount: acc.pricedItems.length,
    orderableItemsCount: acc.orderableCount,
    discountedItemsCount: acc.discountedCount,
    items: acc.pricedItems,
  });
}

// ============================================================================
// Happy Hour Rule Management with SHA-256 Hash-Chained Audit Log
// ============================================================================

export interface ApplyHappyHourParams {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly rule: HappyHourRule;
  readonly previousAuditHash?: string | undefined;
}

/**
 * Creates or updates a Happy Hour pricing rule and appends a cryptographically verified audit entry.
 */
export function applyHappyHourWithAudit(
  params: ApplyHappyHourParams,
): Result<{ readonly rule: HappyHourRule; readonly auditEntry: AuditLogEntry }, DomainError> {
  if (!params.tenantId || params.tenantId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Tenant ID is required for happy hour configuration");
  }
  if (!params.rule.name || params.rule.name.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Happy hour rule name is required");
  }
  if (params.rule.discountValue <= 0) {
    return domainErr("VALIDATION_FAILED", "Discount value must be greater than zero");
  }

  const prevHash = params.previousAuditHash ?? GENESIS_HASH;
  const isoTs = new Date().toISOString();

  const auditRes = createAuditEntry({
    tenantId: params.tenantId,
    actorUserId: params.actorUserId,
    action: "HAPPY_HOUR_RULE_APPLIED",
    entityType: "HappyHourRule",
    entityId: params.rule.ruleId,
    isoTs,
    afterJson: JSON.stringify(params.rule),
    prevHash,
  });

  if (!auditRes.ok) {
    return domainErr(auditRes.error.code, auditRes.error.message);
  }

  return ok({
    rule: params.rule,
    auditEntry: auditRes.value,
  });
}
