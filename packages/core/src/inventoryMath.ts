import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

/**
 * Single inventory batch representing received stock with unit acquisition cost.
 */
export interface InventoryBatch {
  readonly batchId: string;
  readonly receivedAtIso: string;
  readonly initialQty: number;
  readonly remainingQty: number;
  readonly unitCostLkr: number;
  readonly expiryIso?: string | undefined;
}

/**
 * Breakdown of deduction from an individual batch during FIFO queue reduction.
 */
export interface BatchDeductionAllocation {
  readonly batchId: string;
  readonly deductedQty: number;
  readonly unitCostLkr: number;
  readonly costLkr: number;
}

/**
 * Result of a FIFO inventory batch deduction operation.
 */
export interface FifoDeductionResult {
  readonly updatedBatches: readonly InventoryBatch[];
  readonly exhaustedBatchIds: readonly string[];
  readonly allocations: readonly BatchDeductionAllocation[];
  readonly totalDeductedQty: number;
  readonly totalCogsLkr: number;
  readonly remainingTotalQty: number;
  readonly isLowStock: boolean;
}

export interface DeductFifoOptions {
  readonly reorderThreshold?: number | undefined;
}

/**
 * Line item in a Kitchen Order Ticket (KOT) or bar cocktail recipe Bill of Materials (BOM).
 */
export interface RecipeBomLine {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly quantityRequired: number;
  readonly unitOfMeasure: string;
}

/**
 * Current inventory stock snapshot for a single ingredient across its active batches.
 */
export interface IngredientStockSummary {
  readonly ingredientId: string;
  readonly ingredientName?: string | undefined;
  readonly availableQty: number;
  readonly reorderThreshold: number;
  readonly batches: readonly InventoryBatch[];
}

/**
 * Evaluated cost breakdown for an ingredient line in a prepared recipe.
 */
export interface RecipeCostingLine {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly quantityRequired: number;
  readonly unitOfMeasure: string;
  readonly lineCostLkr: number;
  readonly isLowStock: boolean;
}

/**
 * Comprehensive recipe food/beverage costing and COGS analysis.
 */
export interface RecipeFoodCostResult {
  readonly recipeId: string;
  readonly recipeName: string;
  readonly portions: number;
  readonly totalCostLkr: number;
  readonly costPerPortionLkr: number;
  readonly lines: readonly RecipeCostingLine[];
  readonly hasLowStockAlert: boolean;
}

function validateDeductInputs(
  batches: readonly InventoryBatch[],
  requiredQty: number,
): Result<void, DomainError> {
  if (typeof requiredQty !== "number" || !Number.isFinite(requiredQty) || requiredQty <= 0) {
    return domainErr("VALIDATION_FAILED", "Required deduction quantity must be a positive number", {
      requiredQty,
    });
  }

  if (!Array.isArray(batches) || batches.length === 0) {
    return domainErr("VALIDATION_FAILED", "Inventory batches array cannot be empty");
  }

  return ok(undefined);
}

/**
 * Performs pure First-In First-Out (FIFO) queue depletion over inventory batches.
 *
 * Algorithm:
 * 1. Sorts batches chronologically by `receivedAtIso` (oldest batches depleted first).
 * 2. Depletes active batches sequentially until `requiredQty` is fulfilled.
 * 3. Accumulates exact Cost of Goods Sold (COGS) in Sri Lankan Rupees.
 * 4. Flags low-stock alerts if remaining inventory falls at or below `reorderThreshold`.
 */
export function deductFifoBatches(
  batches: readonly InventoryBatch[],
  requiredQty: number,
  options?: DeductFifoOptions,
): Result<FifoDeductionResult, DomainError> {
  const valRes = validateDeductInputs(batches, requiredQty);
  if (!valRes.ok) {
    return valRes;
  }

  // Sort chronologically ascending (FIFO: oldest first)
  const sortedBatches = [...batches].sort(
    (a, b) => new Date(a.receivedAtIso).getTime() - new Date(b.receivedAtIso).getTime(),
  );

  let totalAvailable = 0;
  for (const b of sortedBatches) {
    totalAvailable += Math.max(0, b.remainingQty);
  }

  if (totalAvailable < requiredQty) {
    return domainErr(
      "VALIDATION_FAILED",
      "Insufficient inventory stock to fulfill FIFO deduction",
      {
        totalAvailable,
        requiredQty,
        shortfall: roundLkr(requiredQty - totalAvailable),
      },
    );
  }

  let remainingNeeded = requiredQty;
  let totalCogsLkr = 0;
  const allocations: BatchDeductionAllocation[] = [];
  const updatedBatches: InventoryBatch[] = [];
  const exhaustedBatchIds: string[] = [];

  for (const batch of sortedBatches) {
    if (batch.remainingQty <= 0) {
      updatedBatches.push(batch);
      exhaustedBatchIds.push(batch.batchId);
      continue;
    }

    if (remainingNeeded <= 0) {
      updatedBatches.push(batch);
      continue;
    }

    const deductAmount = Math.min(batch.remainingQty, remainingNeeded);
    const newRemaining = roundLkr(batch.remainingQty - deductAmount);
    const lineCost = roundLkr(deductAmount * batch.unitCostLkr);

    totalCogsLkr = roundLkr(totalCogsLkr + lineCost);
    remainingNeeded = roundLkr(remainingNeeded - deductAmount);

    allocations.push({
      batchId: batch.batchId,
      deductedQty: deductAmount,
      unitCostLkr: batch.unitCostLkr,
      costLkr: lineCost,
    });

    const updated: InventoryBatch = {
      ...batch,
      remainingQty: newRemaining,
    };
    updatedBatches.push(updated);

    if (newRemaining === 0) {
      exhaustedBatchIds.push(batch.batchId);
    }
  }

  const remainingTotalQty = roundLkr(totalAvailable - requiredQty);
  const reorderThreshold = options?.reorderThreshold ?? 0;
  const isLowStock = remainingTotalQty <= reorderThreshold;

  return ok({
    updatedBatches,
    exhaustedBatchIds,
    allocations,
    totalDeductedQty: requiredQty,
    totalCogsLkr,
    remainingTotalQty,
    isLowStock,
  });
}

/**
 * Calculates recipe food/beverage Cost of Goods Sold (COGS) based on Bill of Materials (BOM)
 * and current weighted batch costs from active inventory.
 */
export function calculateRecipeFoodCost(
  recipeId: string,
  recipeName: string,
  portions: number,
  bomLines: readonly RecipeBomLine[],
  stockMap: Readonly<Record<string, IngredientStockSummary>>,
): Result<RecipeFoodCostResult, DomainError> {
  if (typeof portions !== "number" || !Number.isFinite(portions) || portions <= 0) {
    return domainErr("VALIDATION_FAILED", "Recipe portions must be a positive number", {
      portions,
    });
  }

  if (!Array.isArray(bomLines) || bomLines.length === 0) {
    return domainErr("VALIDATION_FAILED", "Recipe BOM lines cannot be empty");
  }

  let totalCostLkr = 0;
  let hasLowStockAlert = false;
  const lines: RecipeCostingLine[] = [];

  for (const line of bomLines) {
    const totalRequiredForBatch = roundLkr(line.quantityRequired * portions);
    const stock = stockMap[line.ingredientId];

    if (!stock) {
      return domainErr(
        "VALIDATION_FAILED",
        `Missing stock summary for ingredient ${line.ingredientName}`,
        {
          ingredientId: line.ingredientId,
        },
      );
    }

    const deductionRes = deductFifoBatches(stock.batches, totalRequiredForBatch, {
      reorderThreshold: stock.reorderThreshold,
    });

    if (!deductionRes.ok) {
      return deductionRes;
    }

    const lineCost = deductionRes.value.totalCogsLkr;
    totalCostLkr = roundLkr(totalCostLkr + lineCost);

    if (deductionRes.value.isLowStock) {
      hasLowStockAlert = true;
    }

    lines.push({
      ingredientId: line.ingredientId,
      ingredientName: line.ingredientName,
      quantityRequired: totalRequiredForBatch,
      unitOfMeasure: line.unitOfMeasure,
      lineCostLkr: lineCost,
      isLowStock: deductionRes.value.isLowStock,
    });
  }

  const costPerPortionLkr = roundLkr(totalCostLkr / portions);

  return ok({
    recipeId,
    recipeName,
    portions,
    totalCostLkr,
    costPerPortionLkr,
    lines,
    hasLowStockAlert,
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for FIFO inventory stock deductions.
 */
export function createInventoryDeductionAuditEntry(
  tenantId: string,
  actorUserId: string,
  itemId: string,
  deduction: FifoDeductionResult,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    itemId,
    totalDeductedQty: deduction.totalDeductedQty,
    totalCogsLkr: deduction.totalCogsLkr,
    remainingTotalQty: deduction.remainingTotalQty,
    isLowStock: deduction.isLowStock,
    exhaustedBatches: deduction.exhaustedBatchIds,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "FIFO_INVENTORY_DEDUCTION",
    entityType: "InventoryItem",
    entityId: itemId,
    isoTs,
    afterJson,
    prevHash,
  });
}
