/**
 * @hms/core - Banquet Kitchen Bulk Ingredient Requisition Generator (banquetBomAggregator.ts)
 *
 * Implements Step 340 (Phase 14.15) / Rung 6 of the Sri Lanka HMS Master Architecture Plan:
 * Deterministic domain calculator for Sri Lankan resort banquets, hotel wedding catering, and MICE functions:
 *
 * 1. Multiplies Guaranteed Pax + Kitchen Buffer Pax (e.g. 250 pax + 10% buffer = 275 pax)
 *    by selected banquet menu Recipe Bills of Materials (BOMs).
 * 2. Aggregates multi-dish overlapping ingredients (e.g. Basmati Rice, Ghee, Cashews, Chicken,
 *    Prawns, Coconut Milk, Spices) into a single consolidated Store Requisition.
 * 3. Incorporates Table Bite Platter BOMs (Hot Butter Cuttlefish, Devilled Chicken, Cashew Fry).
 * 4. Compares total required quantities against current inventory stock snapshots to identify
 *    procurement shortages 72 hours before the wedding.
 * 5. Multi-Tenant SaaS isolation, RBAC role guard, and SHA-256 hash-chained ImmutableAuditLog output.
 * 6. Zero external runtime npm dependencies, cognitive complexity <= 12 per function.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type IngredientCategory =
  | "MEAT"
  | "SEAFOOD"
  | "GRAIN"
  | "VEGETABLE"
  | "SPICE_CONDIMENT"
  | "DAIRY"
  | "OIL_FAT"
  | "BEVERAGE"
  | "OTHER";

export interface RecipeIngredientLine {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly category: IngredientCategory;
  readonly qtyPerPortion: number;
  readonly unitOfMeasure: string;
  readonly estimatedUnitCostLkr: number;
}

export interface RecipeDishBom {
  readonly dishId: string;
  readonly dishName: string;
  readonly portionMultiplier?: number | undefined; // default 1.0
  readonly ingredients: readonly RecipeIngredientLine[];
}

export interface BanquetBitePlatterBom {
  readonly itemId: string;
  readonly name: string;
  readonly plattersCount: number;
  readonly ingredients: readonly RecipeIngredientLine[];
}

export interface StockSnapshot {
  readonly ingredientId: string;
  readonly availableQty: number;
  readonly unitOfMeasure: string;
}

export interface RequisitionLineItem {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly category: IngredientCategory;
  readonly totalRequiredQty: number;
  readonly unitOfMeasure: string;
  readonly currentStockQty: number;
  readonly shortageQty: number;
  readonly isShortage: boolean;
  readonly estimatedUnitCostLkr: number;
  readonly estimatedProcurementCostLkr: number;
  readonly totalTheoreticalCostLkr: number;
}

export interface BanquetRequisitionInput {
  readonly tenantId: string;
  readonly eventId: string;
  readonly functionNumber: string;
  readonly eventName: string;
  readonly eventDate: string;
  readonly guaranteedPax: number;
  readonly bufferPax: number;
  readonly selectedDishes: readonly RecipeDishBom[];
  readonly selectedBites?: readonly BanquetBitePlatterBom[] | undefined;
  readonly stockSnapshots?: readonly StockSnapshot[] | undefined;
  readonly prevAuditHash?: string | undefined;
}

export interface BanquetKitchenActor {
  readonly userId: string;
  readonly role: string;
  readonly tenantId: string;
}

export interface BanquetRequisitionResult {
  readonly requisitionId: string;
  readonly tenantId: string;
  readonly eventId: string;
  readonly functionNumber: string;
  readonly eventName: string;
  readonly eventDate: string;
  readonly prepPaxCount: number;
  readonly items: readonly RequisitionLineItem[];
  readonly totalDistinctIngredients: number;
  readonly shortageItemsCount: number;
  readonly totalEstimatedProcurementCostLkr: number;
  readonly totalTheoreticalRawCostLkr: number;
  readonly rawCostPerGuaranteedPaxLkr: number;
  readonly generatedAtIso: string;
  readonly auditEntry: AuditLogEntry;
}

export const BANQUET_KITCHEN_AUTHORIZED_ROLES: readonly string[] = [
  "EXECUTIVE_CHEF",
  "HEAD_CHEF",
  "SOUS_CHEF",
  "CHEF_DE_PARTIE",
  "STOREKEEPER",
  "FOOD_AND_BEVERAGE_MANAGER",
  "BANQUET_OPERATIONS_MANAGER",
  "GENERAL_MANAGER",
  "ADMIN",
];

// ============================================================================
// Internal Aggregation Helpers (Complexity <= 12)
// ============================================================================

interface MutableIngredientAccumulator {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly category: IngredientCategory;
  readonly unitOfMeasure: string;
  readonly estimatedUnitCostLkr: number;
  totalRequiredQty: number;
}

function accumulateDishes(
  accumulatorMap: Map<string, MutableIngredientAccumulator>,
  dishes: readonly RecipeDishBom[],
  prepPax: number,
): void {
  for (const dish of dishes) {
    const mult =
      dish.portionMultiplier && dish.portionMultiplier > 0 ? dish.portionMultiplier : 1.0;
    const dishPax = prepPax * mult;

    for (const ing of dish.ingredients) {
      const required = ing.qtyPerPortion * dishPax;
      const existing = accumulatorMap.get(ing.ingredientId);

      if (existing) {
        existing.totalRequiredQty += required;
      } else {
        accumulatorMap.set(ing.ingredientId, {
          ingredientId: ing.ingredientId,
          ingredientName: ing.ingredientName,
          category: ing.category,
          unitOfMeasure: ing.unitOfMeasure,
          estimatedUnitCostLkr: ing.estimatedUnitCostLkr,
          totalRequiredQty: required,
        });
      }
    }
  }
}

function accumulateBites(
  accumulatorMap: Map<string, MutableIngredientAccumulator>,
  bites: readonly BanquetBitePlatterBom[],
): void {
  for (const bite of bites) {
    const platters = Math.max(0, bite.plattersCount);
    if (platters === 0) continue;

    for (const ing of bite.ingredients) {
      const required = ing.qtyPerPortion * platters;
      const existing = accumulatorMap.get(ing.ingredientId);

      if (existing) {
        existing.totalRequiredQty += required;
      } else {
        accumulatorMap.set(ing.ingredientId, {
          ingredientId: ing.ingredientId,
          ingredientName: ing.ingredientName,
          category: ing.category,
          unitOfMeasure: ing.unitOfMeasure,
          estimatedUnitCostLkr: ing.estimatedUnitCostLkr,
          totalRequiredQty: required,
        });
      }
    }
  }
}

function buildRequisitionLine(
  acc: MutableIngredientAccumulator,
  stockMap: Map<string, number>,
): RequisitionLineItem {
  const roundedRequired = Math.round((acc.totalRequiredQty + Number.EPSILON) * 1000) / 1000;
  const currentStock = stockMap.get(acc.ingredientId) ?? 0;
  const shortage = Math.max(0, roundedRequired - currentStock);
  const roundedShortage = Math.round((shortage + Number.EPSILON) * 1000) / 1000;
  const isShortage = roundedShortage > 0;

  const estimatedProcurementCost = roundLkr(roundedShortage * acc.estimatedUnitCostLkr);
  const totalTheoreticalCost = roundLkr(roundedRequired * acc.estimatedUnitCostLkr);

  return {
    ingredientId: acc.ingredientId,
    ingredientName: acc.ingredientName,
    category: acc.category,
    totalRequiredQty: roundedRequired,
    unitOfMeasure: acc.unitOfMeasure,
    currentStockQty: currentStock,
    shortageQty: roundedShortage,
    isShortage,
    estimatedUnitCostLkr: acc.estimatedUnitCostLkr,
    estimatedProcurementCostLkr: estimatedProcurementCost,
    totalTheoreticalCostLkr: totalTheoreticalCost,
  };
}

function validateRequisitionInput(
  actor: BanquetKitchenActor,
  input: BanquetRequisitionInput,
): Result<void, DomainError> {
  if (!BANQUET_KITCHEN_AUTHORIZED_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized to generate banquet kitchen requisitions`,
      { actorRole: actor.role },
    );
  }

  if (actor.tenantId !== input.tenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match requisition tenant '${input.tenantId}'`,
      { actorTenantId: actor.tenantId, inputTenantId: input.tenantId },
    );
  }

  if (!Number.isFinite(input.guaranteedPax) || input.guaranteedPax <= 0) {
    return domainErr(
      "VALIDATION_FAILED",
      `Guaranteed pax must be a positive integer, received: ${input.guaranteedPax}`,
      { guaranteedPax: input.guaranteedPax },
    );
  }

  const hasDishes = Array.isArray(input.selectedDishes) && input.selectedDishes.length > 0;
  const hasBites = Array.isArray(input.selectedBites) && input.selectedBites.length > 0;

  if (!hasDishes && !hasBites) {
    return domainErr(
      "INVALID_ORDER_ITEMS",
      "Cannot generate kitchen requisition without selected menu dishes or bite platters",
      { dishesCount: input.selectedDishes?.length ?? 0 },
    );
  }

  return ok(undefined);
}

interface CompiledRequisitionSummary {
  readonly items: readonly RequisitionLineItem[];
  readonly totalEstimatedProcurementCostLkr: number;
  readonly totalTheoreticalRawCostLkr: number;
  readonly shortageItemsCount: number;
}

function compileRequisitionLines(
  accumulatorMap: Map<string, MutableIngredientAccumulator>,
  stockMap: Map<string, number>,
): CompiledRequisitionSummary {
  const items: RequisitionLineItem[] = [];
  let totalEstimatedProcurementCostLkr = 0;
  let totalTheoreticalRawCostLkr = 0;
  let shortageItemsCount = 0;

  for (const acc of accumulatorMap.values()) {
    const line = buildRequisitionLine(acc, stockMap);
    items.push(line);

    totalEstimatedProcurementCostLkr += line.estimatedProcurementCostLkr;
    totalTheoreticalRawCostLkr += line.totalTheoreticalCostLkr;

    if (line.isShortage) {
      shortageItemsCount += 1;
    }
  }

  items.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.ingredientName.localeCompare(b.ingredientName);
  });

  return {
    items,
    totalEstimatedProcurementCostLkr: roundLkr(totalEstimatedProcurementCostLkr),
    totalTheoreticalRawCostLkr: roundLkr(totalTheoreticalRawCostLkr),
    shortageItemsCount,
  };
}

// ============================================================================
// Core Calculation & Requisition Engine
// ============================================================================

export function generateBanquetKitchenRequisition(
  actor: BanquetKitchenActor,
  input: BanquetRequisitionInput,
): Result<BanquetRequisitionResult, DomainError> {
  const validationRes = validateRequisitionInput(actor, input);
  if (!validationRes.ok) {
    return validationRes;
  }

  const safeBuffer = Math.max(0, input.bufferPax || 0);
  const prepPaxCount = input.guaranteedPax + safeBuffer;

  const stockMap = new Map<string, number>();
  if (input.stockSnapshots) {
    for (const stock of input.stockSnapshots) {
      stockMap.set(stock.ingredientId, Math.max(0, stock.availableQty));
    }
  }

  const accumulatorMap = new Map<string, MutableIngredientAccumulator>();
  if (input.selectedDishes && input.selectedDishes.length > 0) {
    accumulateDishes(accumulatorMap, input.selectedDishes, prepPaxCount);
  }
  if (input.selectedBites && input.selectedBites.length > 0) {
    accumulateBites(accumulatorMap, input.selectedBites);
  }

  const compiled = compileRequisitionLines(accumulatorMap, stockMap);
  const rawCostPerGuaranteedPaxLkr = roundLkr(
    compiled.totalTheoreticalRawCostLkr / input.guaranteedPax,
  );

  const timestampIso = new Date().toISOString();
  const requisitionId = `REQ-BNQ-${input.eventDate.replace(/-/g, "").slice(0, 8)}-${input.functionNumber}`;

  const auditRes = createAuditEntry({
    tenantId: input.tenantId,
    actorUserId: actor.userId,
    action: "GENERATE_BANQUET_KITCHEN_REQUISITION",
    entityType: "BanquetKitchenRequisition",
    entityId: requisitionId,
    isoTs: timestampIso,
    prevHash: input.prevAuditHash,
    afterJson: JSON.stringify({
      requisitionId,
      eventId: input.eventId,
      functionNumber: input.functionNumber,
      prepPaxCount,
      distinctIngredientsCount: compiled.items.length,
      shortageItemsCount: compiled.shortageItemsCount,
      totalEstimatedProcurementCostLkr: compiled.totalEstimatedProcurementCostLkr,
      rawCostPerGuaranteedPaxLkr,
    }),
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    requisitionId,
    tenantId: input.tenantId,
    eventId: input.eventId,
    functionNumber: input.functionNumber,
    eventName: input.eventName,
    eventDate: input.eventDate,
    prepPaxCount,
    items: compiled.items,
    totalDistinctIngredients: compiled.items.length,
    shortageItemsCount: compiled.shortageItemsCount,
    totalEstimatedProcurementCostLkr: compiled.totalEstimatedProcurementCostLkr,
    totalTheoreticalRawCostLkr: compiled.totalTheoreticalRawCostLkr,
    rawCostPerGuaranteedPaxLkr,
    generatedAtIso: timestampIso,
    auditEntry: auditRes.value,
  });
}
