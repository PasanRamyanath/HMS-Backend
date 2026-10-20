/**
 * @hms/core - Spa Herbal Oil & Consumables BOM Deduction Helper (spaConsumables.ts)
 *
 * Implements Step 364 (Phase 15.14) & Step 365 (Phase 15.15) of the Sri Lanka HMS Master Architecture Plan:
 * Deterministic domain engine for deducting Ayurveda spa consumables and herbal medicated oils:
 *
 * 1. Depletes therapy Recipe Bills of Materials (BOMs) on treatment completion (e.g. Mahanarayana Oil,
 *    Pinda Oil, King Coconut Oil, Triphala Decoction, Herbal Kizhi Poultices).
 * 2. Reuses FIFO inventory depletion engine (`deductFifoBatches`) to track exact acquisition costs.
 * 3. Enforces multi-tenant SaaS isolation (`tenantId`) and RolePermissionMatrix RBAC
 *    (Ayurveda Doctor, Spa Manager, Senior Therapist, General Manager).
 * 4. Produces remaining inventory stock levels, low-stock reorder warnings, and COGS in LKR.
 * 5. Appends SHA-256 hash-chained `ImmutableAuditLog` records for every deduction transaction.
 * 6. Zero external runtime npm dependencies, cognitive complexity <= 12 per function.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import {
  type BatchDeductionAllocation,
  type InventoryBatch,
  deductFifoBatches,
} from "./inventoryMath.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type SpaStaffRole =
  | "AYURVEDA_DOCTOR"
  | "SPA_MANAGER"
  | "SENIOR_THERAPIST"
  | "THERAPIST"
  | "GENERAL_MANAGER"
  | "SUPER_ADMIN";

export const SPA_CONSUMABLES_AUTHORIZED_ROLES: readonly SpaStaffRole[] = [
  "AYURVEDA_DOCTOR",
  "SPA_MANAGER",
  "SENIOR_THERAPIST",
  "THERAPIST",
  "GENERAL_MANAGER",
  "SUPER_ADMIN",
];

export interface SpaConsumablesActor {
  readonly userId: string;
  readonly role: SpaStaffRole;
  readonly tenantId: string;
}

export type SpaConsumableCategory =
  | "HERBAL_OIL"
  | "HERBAL_POULTICE"
  | "MEDICATED_DECOCTION"
  | "AYURVEDIC_PASTE"
  | "LINEN_DISPOSABLE"
  | "WELLNESS_CONSUMABLE";

export interface SpaConsumableItemStock {
  readonly itemId: string;
  readonly name: string;
  readonly category: SpaConsumableCategory;
  readonly unitOfMeasure: string;
  readonly reorderThreshold: number;
  readonly batches: readonly InventoryBatch[];
}

export interface SpaTherapyBomLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly category: SpaConsumableCategory;
  readonly quantityRequired: number;
  readonly unitOfMeasure: string;
}

export interface SpaTherapyBom {
  readonly therapyCode: string;
  readonly therapyName: string;
  readonly standardDurationMinutes: number;
  readonly bomLines: readonly SpaTherapyBomLine[];
}

export interface SpaDeductionRequest {
  readonly tenantId: string;
  readonly actor: SpaConsumablesActor;
  readonly therapySessionId: string;
  readonly therapyCode: string;
  readonly customBomLines?: readonly SpaTherapyBomLine[] | undefined;
  readonly sessionMultiplier?: number | undefined;
  readonly inventory: readonly SpaConsumableItemStock[];
  readonly previousAuditHash?: string | undefined;
  readonly timestampIso?: string | undefined;
}

export interface SpaConsumableLineAllocation {
  readonly itemId: string;
  readonly itemName: string;
  readonly category: SpaConsumableCategory;
  readonly quantityDeducted: number;
  readonly unitOfMeasure: string;
  readonly lineCogsLkr: number;
  readonly exhaustedBatchIds: readonly string[];
  readonly remainingQty: number;
  readonly isLowStock: boolean;
  readonly batchAllocations: readonly BatchDeductionAllocation[];
}

export interface SpaConsumablesDeductionResult {
  readonly tenantId: string;
  readonly therapySessionId: string;
  readonly therapyCode: string;
  readonly therapyName: string;
  readonly deductionLines: readonly SpaConsumableLineAllocation[];
  readonly totalCogsLkr: number;
  readonly updatedInventory: readonly SpaConsumableItemStock[];
  readonly lowStockAlerts: readonly string[];
  readonly auditLog: AuditLogEntry;
}

// ============================================================================
// Standard Sri Lankan Ayurveda Therapy BOM Presets
// ============================================================================

export const AYURVEDA_BOM_PRESETS: Readonly<Record<string, SpaTherapyBom>> = {
  SHIRODHARA: {
    therapyCode: "SHIRODHARA",
    therapyName: "Authentic Shirodhara Medicated Oil Pouring",
    standardDurationMinutes: 60,
    bomLines: [
      {
        itemId: "OIL-MAHANARAYANA-ML",
        itemName: "Mahanarayana Medicated Herbal Oil",
        category: "HERBAL_OIL",
        quantityRequired: 400,
        unitOfMeasure: "ml",
      },
      {
        itemId: "OIL-KING-COCONUT-ML",
        itemName: "Organic Virgin King Coconut Base Oil",
        category: "HERBAL_OIL",
        quantityRequired: 100,
        unitOfMeasure: "ml",
      },
      {
        itemId: "LINEN-GAUZE-BAND",
        itemName: "Sterile Cotton Forehead Gauze Band",
        category: "LINEN_DISPOSABLE",
        quantityRequired: 1,
        unitOfMeasure: "unit",
      },
    ],
  },
  ABHYANGA: {
    therapyCode: "ABHYANGA",
    therapyName: "Full Body Synchronized Abhyanga Herbal Massage",
    standardDurationMinutes: 60,
    bomLines: [
      {
        itemId: "OIL-MAHANARAYANA-ML",
        itemName: "Mahanarayana Medicated Herbal Oil",
        category: "HERBAL_OIL",
        quantityRequired: 150,
        unitOfMeasure: "ml",
      },
      {
        itemId: "OIL-PINDA-ML",
        itemName: "Pinda Thailaya Cooling Herbal Oil",
        category: "HERBAL_OIL",
        quantityRequired: 50,
        unitOfMeasure: "ml",
      },
    ],
  },
  PINDA_SWEDA: {
    therapyCode: "PINDA_SWEDA",
    therapyName: "Navarakizhi / Herbal Leaf Poultice Bolus Therapy",
    standardDurationMinutes: 75,
    bomLines: [
      {
        itemId: "POULTICE-HERBAL-KIZHI",
        itemName: "Pre-made Medicated Herbal Leaf Kizhi Poultices",
        category: "HERBAL_POULTICE",
        quantityRequired: 4,
        unitOfMeasure: "packet",
      },
      {
        itemId: "OIL-PINDA-ML",
        itemName: "Pinda Thailaya Cooling Herbal Oil",
        category: "HERBAL_OIL",
        quantityRequired: 100,
        unitOfMeasure: "ml",
      },
    ],
  },
  SWEDANA: {
    therapyCode: "SWEDANA",
    therapyName: "Ayurvedic Kohomba & Pavatta Herbal Steam Bath",
    standardDurationMinutes: 30,
    bomLines: [
      {
        itemId: "DECOCTION-TRIPHALA-ML",
        itemName: "Triphala Kwatha Concentrated Decoction",
        category: "MEDICATED_DECOCTION",
        quantityRequired: 250,
        unitOfMeasure: "ml",
      },
      {
        itemId: "POULTICE-HERBAL-LEAVES",
        itemName: "Neem & Tamarind Herbal Steam Leaf Pack",
        category: "HERBAL_POULTICE",
        quantityRequired: 2,
        unitOfMeasure: "packet",
      },
    ],
  },
  MUKHA_LEPA: {
    therapyCode: "MUKHA_LEPA",
    therapyName: "Sandalwood & Venivel Herbal Beauty Facial",
    standardDurationMinutes: 45,
    bomLines: [
      {
        itemId: "PASTE-SANDALWOOD-VENIVEL-G",
        itemName: "Pure Sandalwood & Venivel Cleansing Herbal Paste",
        category: "AYURVEDIC_PASTE",
        quantityRequired: 50,
        unitOfMeasure: "g",
      },
      {
        itemId: "WATER-ROSE-HERBAL-ML",
        itemName: "Organic Distilled Rose & Vetiver Tonic",
        category: "WELLNESS_CONSUMABLE",
        quantityRequired: 30,
        unitOfMeasure: "ml",
      },
    ],
  },
  NASYA: {
    therapyCode: "NASYA",
    therapyName: "Anu Thailaya Medicated Nasal Cleansing",
    standardDurationMinutes: 30,
    bomLines: [
      {
        itemId: "OIL-ANU-THAILAYA-ML",
        itemName: "Anu Thailaya Tridosha Balance Nasal Oil",
        category: "HERBAL_OIL",
        quantityRequired: 15,
        unitOfMeasure: "ml",
      },
    ],
  },
};

// ============================================================================
// Internal Validation & Pure Deduction Helpers (Cognitive Complexity <= 12)
// ============================================================================

function validateSpaActor(
  actor: SpaConsumablesActor,
  requestTenantId: string,
): Result<void, DomainError> {
  if (!actor || !actor.userId || !actor.tenantId) {
    return domainErr("UNAUTHORIZED", "Valid spa staff actor with userId and tenantId is required");
  }

  if (actor.tenantId !== requestTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match spa request tenant '${requestTenantId}'`,
      { actorTenant: actor.tenantId, requestTenant: requestTenantId },
    );
  }

  if (!SPA_CONSUMABLES_AUTHORIZED_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized to deduct spa consumables`,
      { role: actor.role, allowedRoles: SPA_CONSUMABLES_AUTHORIZED_ROLES },
    );
  }

  return ok(undefined);
}

function resolveTherapyBom(
  therapyCode: string,
  customBomLines?: readonly SpaTherapyBomLine[] | undefined,
): Result<{ therapyName: string; lines: readonly SpaTherapyBomLine[] }, DomainError> {
  if (customBomLines && customBomLines.length > 0) {
    return ok({
      therapyName: `Custom Protocol (${therapyCode})`,
      lines: customBomLines,
    });
  }

  const preset = AYURVEDA_BOM_PRESETS[therapyCode];
  if (!preset) {
    return domainErr(
      "NOT_FOUND",
      `Ayurveda therapy BOM preset not found for code '${therapyCode}'`,
      { therapyCode, availablePresets: Object.keys(AYURVEDA_BOM_PRESETS) },
    );
  }

  return ok({
    therapyName: preset.therapyName,
    lines: preset.bomLines,
  });
}

function validateMultiplier(multiplier?: number | undefined): Result<number, DomainError> {
  if (multiplier === undefined) {
    return ok(1.0);
  }

  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return domainErr(
      "VALIDATION_FAILED",
      `Session multiplier must be a positive number, received: ${multiplier}`,
      { multiplier },
    );
  }

  return ok(multiplier);
}

interface DeductionStepOutcome {
  readonly allocation: SpaConsumableLineAllocation;
  readonly updatedStock: SpaConsumableItemStock;
}

function processSingleConsumableLine(
  line: SpaTherapyBomLine,
  multiplier: number,
  stockMap: Map<string, SpaConsumableItemStock>,
): Result<DeductionStepOutcome, DomainError> {
  const stockItem = stockMap.get(line.itemId);
  if (!stockItem) {
    return domainErr(
      "NOT_FOUND",
      `Consumable item '${line.itemId}' (${line.itemName}) is not available in spa inventory`,
      { itemId: line.itemId, itemName: line.itemName },
    );
  }

  const requiredQty = roundLkr(line.quantityRequired * multiplier);
  const fifoResult = deductFifoBatches(stockItem.batches, requiredQty, {
    reorderThreshold: stockItem.reorderThreshold,
  });

  if (!fifoResult.ok) {
    return fifoResult;
  }

  const deduction = fifoResult.value;
  const isLowStock = deduction.remainingTotalQty <= stockItem.reorderThreshold;

  const allocation: SpaConsumableLineAllocation = {
    itemId: stockItem.itemId,
    itemName: stockItem.name,
    category: stockItem.category,
    quantityDeducted: deduction.totalDeductedQty,
    unitOfMeasure: line.unitOfMeasure,
    lineCogsLkr: deduction.totalCogsLkr,
    exhaustedBatchIds: deduction.exhaustedBatchIds,
    remainingQty: deduction.remainingTotalQty,
    isLowStock,
    batchAllocations: deduction.allocations,
  };

  const updatedStock: SpaConsumableItemStock = {
    ...stockItem,
    batches: deduction.updatedBatches,
  };

  return ok({ allocation, updatedStock });
}

function buildDeductionAuditPayload(
  result: Omit<SpaConsumablesDeductionResult, "auditLog">,
  actorUserId: string,
  previousAuditHash?: string | undefined,
  timestampIso?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const isoTs = timestampIso ?? new Date().toISOString();
  const summary = {
    therapySessionId: result.therapySessionId,
    therapyCode: result.therapyCode,
    totalCogsLkr: result.totalCogsLkr,
    deductedItemsCount: result.deductionLines.length,
    lowStockAlertsCount: result.lowStockAlerts.length,
  };

  return createAuditEntry({
    tenantId: result.tenantId,
    actorUserId,
    action: "SPA_CONSUMABLES_DEDUCTED",
    entityType: "SPA_THERAPY_SESSION",
    entityId: result.therapySessionId,
    isoTs,
    afterJson: JSON.stringify(summary),
    prevHash: previousAuditHash,
  });
}

// ============================================================================
// Public Domain API
// ============================================================================

/**
 * Deducts Ayurveda spa consumables and medicated herbal oils using FIFO batch reduction.
 *
 * Enforces:
 * - Multi-tenant isolation (`tenantId`)
 * - RBAC authorization (`SpaStaffRole`)
 * - FIFO batch consumption with exact LKR Cost of Goods Sold (COGS)
 * - Low-stock alerts against per-item reorder thresholds
 * - SHA-256 hash-chained `ImmutableAuditLog` entry generation
 */
export function deductSpaConsumables(
  request: SpaDeductionRequest,
): Result<SpaConsumablesDeductionResult, DomainError> {
  const actorRes = validateSpaActor(request.actor, request.tenantId);
  if (!actorRes.ok) {
    return actorRes;
  }

  if (!request.therapySessionId || request.therapySessionId.trim().length === 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "Therapy session ID is required to deduct spa consumables",
    );
  }

  const bomRes = resolveTherapyBom(request.therapyCode, request.customBomLines);
  if (!bomRes.ok) {
    return bomRes;
  }

  const multRes = validateMultiplier(request.sessionMultiplier);
  if (!multRes.ok) {
    return multRes;
  }
  const multiplier = multRes.value;

  const stockMap = new Map<string, SpaConsumableItemStock>();
  for (const item of request.inventory) {
    stockMap.set(item.itemId, item);
  }

  const deductionLines: SpaConsumableLineAllocation[] = [];
  const lowStockAlerts: string[] = [];
  let totalCogsLkr = 0;

  for (const line of bomRes.value.lines) {
    const outcomeRes = processSingleConsumableLine(line, multiplier, stockMap);
    if (!outcomeRes.ok) {
      return outcomeRes;
    }

    const { allocation, updatedStock } = outcomeRes.value;
    deductionLines.push(allocation);
    stockMap.set(updatedStock.itemId, updatedStock);

    totalCogsLkr = roundLkr(totalCogsLkr + allocation.lineCogsLkr);

    if (allocation.isLowStock) {
      lowStockAlerts.push(
        `Low stock warning: ${allocation.itemName} remaining: ${allocation.remainingQty} ${allocation.unitOfMeasure}`,
      );
    }
  }

  const updatedInventory = Array.from(stockMap.values());
  const preResult = {
    tenantId: request.tenantId,
    therapySessionId: request.therapySessionId,
    therapyCode: request.therapyCode,
    therapyName: bomRes.value.therapyName,
    deductionLines,
    totalCogsLkr,
    updatedInventory,
    lowStockAlerts,
  };

  const auditRes = buildDeductionAuditPayload(
    preResult,
    request.actor.userId,
    request.previousAuditHash,
    request.timestampIso,
  );
  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    ...preResult,
    auditLog: auditRes.value,
  });
}
