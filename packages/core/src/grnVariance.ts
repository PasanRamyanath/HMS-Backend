/**
 * Goods Received Note (GRN) Price-Spike & Short-Delivery Variance Detector
 * (`grnVariance.ts`)
 *
 * Implements Step 381 (Phase 16.06):
 * - Rung 6: Pure comparator flagging quantity short-deliveries and unit-price inflation >10%
 * - Verifies delivered quantities vs PO ordered quantities
 * - Detects price spikes (>10% above agreed PO unit cost or last historical cost)
 * - Computes Sri Lankan statutory integer-cent rounding (roundLkr) and VAT breakdown
 * - Validates tenant isolation, RBAC permissions, and SaasSubscription entitlements
 * - Emits SHA-256 hash-chained ImmutableAuditLog records on verified variances
 * - Zero external dependencies (pure TypeScript domain engine)
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

// ============================================================================
// Constants & Configuration
// ============================================================================

export const DEFAULT_PRICE_SPIKE_THRESHOLD_PERCENT = 10;

export const AUTHORIZED_RECEIVING_ROLES = [
  "INVENTORY_CLERK",
  "STORE_KEEPER",
  "HEAD_CHEF",
  "SOUS_CHEF",
  "BAR_MANAGER",
  "FINANCE_CONTROLLER",
  "ACCOUNTANT",
  "GENERAL_MANAGER",
  "HOTEL_ADMIN",
  "SUPER_ADMIN",
] as const;

export const AUTHORIZED_OVERRIDE_ROLES = [
  "FINANCE_CONTROLLER",
  "GENERAL_MANAGER",
  "HOTEL_ADMIN",
  "SUPER_ADMIN",
] as const;

// ============================================================================
// Types & Domain Models
// ============================================================================

export type GrnStaffRole = (typeof AUTHORIZED_RECEIVING_ROLES)[number] | string;

export interface GrnStaffActor {
  readonly userId: string;
  readonly role: GrnStaffRole;
  readonly name?: string | undefined;
  readonly tenantId: string;
}

export interface GrnSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowsProcurement?: boolean | undefined;
}

export type GrnItemRejectionReason =
  | "NONE"
  | "DAMAGED"
  | "EXPIRY_NEAR"
  | "SUBSTANDARD_QUALITY"
  | "WRONG_ITEM"
  | "EXCESS_QUANTITY";

export type GrnVarianceFlag =
  | "EXACT_MATCH"
  | "SHORT_DELIVERY"
  | "OVER_DELIVERY"
  | "PRICE_SPIKE_DETECTED"
  | "PRICE_SAVING"
  | "QUALITY_REJECTION"
  | "UNORDERED_ITEM";

export type GrnOverallVerdict =
  | "APPROVED_MATCH"
  | "SHORT_DELIVERY_CONFIRMED"
  | "REQUIRES_MANAGER_OVERRIDE"
  | "MANAGER_APPROVED_OVERRIDE"
  | "DISPUTED_DELIVERY";

export interface GrnPoLineItem {
  readonly stockItemId: string;
  readonly sku: string;
  readonly name: string;
  readonly category?: string | undefined;
  readonly unitOfMeasure: string;
  readonly orderedQty: number;
  readonly agreedUnitCostLkr: number;
  readonly lastPurchaseCostLkr?: number | undefined;
  readonly vatRatePercent?: number | undefined;
}

export interface GrnReceivedLineItem {
  readonly stockItemId: string;
  readonly sku: string;
  readonly deliveredQty: number;
  readonly acceptedQty: number;
  readonly rejectedQty?: number | undefined;
  readonly rejectionReason?: GrnItemRejectionReason | undefined;
  readonly invoiceUnitCostLkr: number;
  readonly vatRatePercent?: number | undefined;
  readonly batchNumber?: string | undefined;
  readonly expiryIso?: string | undefined;
  readonly storageLocation?: string | undefined;
}

export interface GrnLineVarianceDetail {
  readonly stockItemId: string;
  readonly sku: string;
  readonly name: string;
  readonly unitOfMeasure: string;
  readonly orderedQty: number;
  readonly deliveredQty: number;
  readonly acceptedQty: number;
  readonly rejectedQty: number;
  readonly rejectionReason: GrnItemRejectionReason;
  readonly quantityVariance: number;
  readonly quantityVariancePercent: number;
  readonly agreedUnitCostLkr: number;
  readonly invoiceUnitCostLkr: number;
  readonly unitCostVarianceLkr: number;
  readonly unitCostVariancePercent: number;
  readonly isPriceSpike: boolean;
  readonly isShortDelivery: boolean;
  readonly isOverDelivery: boolean;
  readonly flags: readonly GrnVarianceFlag[];
  readonly orderedSubtotalLkr: number;
  readonly orderedVatLkr: number;
  readonly orderedTotalLkr: number;
  readonly acceptedSubtotalLkr: number;
  readonly acceptedVatLkr: number;
  readonly acceptedTotalLkr: number;
  readonly costVarianceLkr: number;
}

export interface GrnVarianceSummary {
  readonly totalOrderedQty: number;
  readonly totalDeliveredQty: number;
  readonly totalAcceptedQty: number;
  readonly totalRejectedQty: number;
  readonly totalOrderedCostLkr: number;
  readonly totalDeliveredCostLkr: number;
  readonly totalAcceptedCostLkr: number;
  readonly totalCostVarianceLkr: number;
  readonly shortDeliveryCount: number;
  readonly overDeliveryCount: number;
  readonly priceSpikeCount: number;
  readonly rejectedItemCount: number;
  readonly hasPriceSpikes: boolean;
  readonly hasShortDeliveries: boolean;
  readonly hasRejections: boolean;
  readonly requiresManagerApproval: boolean;
  readonly verdict: GrnOverallVerdict;
}

export interface GrnManagerOverrideInput {
  readonly approvedByUserId: string;
  readonly approvalRole: GrnStaffRole;
  readonly reason: string;
}

export interface DetectGrnVarianceInput {
  readonly tenantId: string;
  readonly grnNumber: string;
  readonly poNumber?: string | undefined;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierInvoiceNumber: string;
  readonly orderedItems: readonly GrnPoLineItem[];
  readonly deliveredItems: readonly GrnReceivedLineItem[];
  readonly spikeThresholdPercent?: number | undefined;
  readonly managerOverride?: GrnManagerOverrideInput | undefined;
  readonly actor: GrnStaffActor;
  readonly subscription?: GrnSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly timestampIso?: string | undefined;
}

export interface DetectGrnVarianceOutput {
  readonly tenantId: string;
  readonly grnNumber: string;
  readonly poNumber?: string | undefined;
  readonly summary: GrnVarianceSummary;
  readonly lineVariances: readonly GrnLineVarianceDetail[];
  readonly auditEntry?: AuditLogEntry | undefined;
  readonly timestampIso: string;
}

// ============================================================================
// Pure Validation & Helper Functions
// ============================================================================

export function validateGrnVarianceActor(
  actor: GrnStaffActor,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!actor || !actor.userId || actor.userId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Valid actor userId is required for GRN inspection");
  }

  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match operation tenant '${expectedTenantId}'`,
      { actorTenantId: actor.tenantId, expectedTenantId },
    );
  }

  const isAuthorized = (AUTHORIZED_RECEIVING_ROLES as readonly string[]).includes(actor.role);
  if (!isAuthorized) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized to receive store inventory or inspect GRN deliveries`,
      { role: actor.role, authorizedRoles: AUTHORIZED_RECEIVING_ROLES },
    );
  }

  return ok(undefined);
}

export function validateGrnSubscription(
  sub: GrnSaasSubscription | undefined,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!sub) {
    return ok(undefined);
  }

  if (sub.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenant '${sub.tenantId}' does not match operation tenant '${expectedTenantId}'`,
      { subTenantId: sub.tenantId, expectedTenantId },
    );
  }

  if (!sub.active) {
    return domainErr("SUBSCRIPTION_INACTIVE", "SaaS subscription for this property is inactive", {
      tenantId: expectedTenantId,
    });
  }

  if (sub.allowsProcurement === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "Store inventory and GRN variance detection are not entitled under current SaaS plan tier",
      { tier: sub.tier },
    );
  }

  return ok(undefined);
}

/**
 * Calculates price variance and determines whether a price spike alert is triggered.
 */
export function isPriceSpike(
  invoiceUnitCostLkr: number,
  baselineCostLkr: number,
  thresholdPercent = DEFAULT_PRICE_SPIKE_THRESHOLD_PERCENT,
): { isSpike: boolean; variancePercent: number; varianceLkr: number } {
  if (baselineCostLkr <= 0 || invoiceUnitCostLkr <= 0) {
    return { isSpike: false, variancePercent: 0, varianceLkr: 0 };
  }

  const varianceLkr = roundLkr(invoiceUnitCostLkr - baselineCostLkr);
  const rawPercent = ((invoiceUnitCostLkr - baselineCostLkr) / baselineCostLkr) * 100;
  const variancePercent = Math.round(rawPercent * 100) / 100;

  const isSpike = variancePercent > thresholdPercent;
  return { isSpike, variancePercent, varianceLkr };
}

function classifyLineFlags(
  hasOrdered: boolean,
  isExactMatch: boolean,
  isShortDelivery: boolean,
  isOverDelivery: boolean,
  isSpike: boolean,
  isSaving: boolean,
  hasRejected: boolean,
): readonly GrnVarianceFlag[] {
  const flags: GrnVarianceFlag[] = [];
  if (!hasOrdered) {
    flags.push("UNORDERED_ITEM");
  } else if (isExactMatch) {
    flags.push("EXACT_MATCH");
  }
  if (isShortDelivery) flags.push("SHORT_DELIVERY");
  if (isOverDelivery) flags.push("OVER_DELIVERY");
  if (isSpike) flags.push("PRICE_SPIKE_DETECTED");
  if (isSaving) flags.push("PRICE_SAVING");
  if (hasRejected) flags.push("QUALITY_REJECTION");
  return flags;
}

function calculateFinancialTotals(
  orderedQty: number,
  agreedCost: number,
  acceptedQty: number,
  invoiceCost: number,
  vatRate: number,
) {
  const orderedSubtotalLkr = roundLkr(orderedQty * agreedCost);
  const orderedVatLkr = roundLkr((orderedSubtotalLkr * vatRate) / 100);
  const orderedTotalLkr = roundLkr(orderedSubtotalLkr + orderedVatLkr);

  const acceptedSubtotalLkr = roundLkr(acceptedQty * invoiceCost);
  const acceptedVatLkr = roundLkr((acceptedSubtotalLkr * vatRate) / 100);
  const acceptedTotalLkr = roundLkr(acceptedSubtotalLkr + acceptedVatLkr);

  const costVarianceLkr = roundLkr(acceptedTotalLkr - orderedTotalLkr);

  return {
    orderedSubtotalLkr,
    orderedVatLkr,
    orderedTotalLkr,
    acceptedSubtotalLkr,
    acceptedVatLkr,
    acceptedTotalLkr,
    costVarianceLkr,
  };
}

function extractLineQuantities(ordered: GrnPoLineItem | undefined, delivered: GrnReceivedLineItem) {
  const orderedQty = ordered ? ordered.orderedQty : 0;
  const deliveredQty = Math.max(0, delivered.deliveredQty);
  const acceptedQty = Math.max(0, delivered.acceptedQty);
  const defaultRejected = deliveredQty - acceptedQty;
  const rawRejected = delivered.rejectedQty !== undefined ? delivered.rejectedQty : defaultRejected;
  const rejectedQty = Math.max(0, rawRejected);
  const defaultReason: GrnItemRejectionReason = rejectedQty > 0 ? "DAMAGED" : "NONE";
  const rejectionReason = delivered.rejectionReason ?? defaultReason;

  const quantityVariance = Math.round((acceptedQty - orderedQty) * 100) / 100;
  const quantityVariancePercent =
    orderedQty > 0 ? Math.round(((acceptedQty - orderedQty) / orderedQty) * 10000) / 100 : 0;
  const isShortDelivery = orderedQty > 0 && acceptedQty < orderedQty;
  const isOverDelivery = orderedQty > 0 && acceptedQty > orderedQty;

  return {
    orderedQty,
    deliveredQty,
    acceptedQty,
    rejectedQty,
    rejectionReason,
    quantityVariance,
    quantityVariancePercent,
    isShortDelivery,
    isOverDelivery,
  };
}

function resolveAgreedAndBaselineCost(
  ordered: GrnPoLineItem | undefined,
  delivered: GrnReceivedLineItem,
) {
  const agreedCost = ordered ? ordered.agreedUnitCostLkr : delivered.invoiceUnitCostLkr;
  const fallback = ordered?.lastPurchaseCostLkr ?? 0;
  const baselineCost = agreedCost > 0 ? agreedCost : fallback;
  const vatRate = delivered.vatRatePercent ?? ordered?.vatRatePercent ?? 0;
  return { agreedCost, baselineCost, vatRate };
}

/**
 * Evaluates delivery quantity and financial variance for a single line item.
 */
export function calculateLineItemVariance(
  ordered: GrnPoLineItem | undefined,
  delivered: GrnReceivedLineItem,
  thresholdPercent = DEFAULT_PRICE_SPIKE_THRESHOLD_PERCENT,
): GrnLineVarianceDetail {
  const q = extractLineQuantities(ordered, delivered);
  const c = resolveAgreedAndBaselineCost(ordered, delivered);

  const { isSpike, variancePercent, varianceLkr } = isPriceSpike(
    delivered.invoiceUnitCostLkr,
    c.baselineCost,
    thresholdPercent,
  );

  const financials = calculateFinancialTotals(
    q.orderedQty,
    c.agreedCost,
    q.acceptedQty,
    delivered.invoiceUnitCostLkr,
    c.vatRate,
  );

  const isExact =
    Boolean(ordered) && q.acceptedQty === q.orderedQty && varianceLkr === 0 && q.rejectedQty === 0;

  const flags = classifyLineFlags(
    Boolean(ordered),
    isExact,
    q.isShortDelivery,
    q.isOverDelivery,
    isSpike,
    varianceLkr < 0,
    q.rejectedQty > 0,
  );

  return {
    stockItemId: delivered.stockItemId,
    sku: delivered.sku,
    name: ordered?.name ?? delivered.sku,
    unitOfMeasure: ordered?.unitOfMeasure ?? "pcs",
    orderedQty: q.orderedQty,
    deliveredQty: q.deliveredQty,
    acceptedQty: q.acceptedQty,
    rejectedQty: q.rejectedQty,
    rejectionReason: q.rejectionReason,
    quantityVariance: q.quantityVariance,
    quantityVariancePercent: q.quantityVariancePercent,
    agreedUnitCostLkr: c.agreedCost,
    invoiceUnitCostLkr: delivered.invoiceUnitCostLkr,
    unitCostVarianceLkr: varianceLkr,
    unitCostVariancePercent: variancePercent,
    isPriceSpike: isSpike,
    isShortDelivery: q.isShortDelivery,
    isOverDelivery: q.isOverDelivery,
    flags,
    ...financials,
  };
}

/**
 * Determines overall GRN verdict and approval requirements.
 */
function determineOverallVerdict(
  priceSpikeCount: number,
  shortDeliveryCount: number,
  rejectedCount: number,
  hasManagerOverride: boolean,
): GrnOverallVerdict {
  if (priceSpikeCount > 0) {
    return hasManagerOverride ? "MANAGER_APPROVED_OVERRIDE" : "REQUIRES_MANAGER_OVERRIDE";
  }
  if (rejectedCount > 0) {
    return "DISPUTED_DELIVERY";
  }
  if (shortDeliveryCount > 0) {
    return "SHORT_DELIVERY_CONFIRMED";
  }
  return "APPROVED_MATCH";
}

function validateBasicInputs(input: DetectGrnVarianceInput): Result<void, DomainError> {
  if (!input.tenantId || input.tenantId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "tenantId is required for GRN variance detection");
  }
  if (!input.grnNumber || input.grnNumber.trim() === "") {
    return domainErr("VALIDATION_FAILED", "grnNumber is required for GRN variance detection");
  }
  if (!input.deliveredItems || input.deliveredItems.length === 0) {
    return domainErr("VALIDATION_FAILED", "deliveredItems list cannot be empty");
  }
  return ok(undefined);
}

function checkManagerOverride(
  priceSpikeCount: number,
  override?: GrnManagerOverrideInput,
): boolean {
  if (priceSpikeCount === 0 || !override) return false;
  const isRoleOk = (AUTHORIZED_OVERRIDE_ROLES as readonly string[]).includes(override.approvalRole);
  return isRoleOk && override.reason.trim().length > 0;
}

interface AggregatedVarianceData {
  readonly lineVariances: readonly GrnLineVarianceDetail[];
  readonly totalOrderedQty: number;
  readonly totalDeliveredQty: number;
  readonly totalAcceptedQty: number;
  readonly totalRejectedQty: number;
  readonly totalOrderedCostLkr: number;
  readonly totalDeliveredCostLkr: number;
  readonly totalAcceptedCostLkr: number;
  readonly shortDeliveryCount: number;
  readonly overDeliveryCount: number;
  readonly priceSpikeCount: number;
  readonly rejectedItemCount: number;
}

function aggregateLines(
  deliveredItems: readonly GrnReceivedLineItem[],
  orderedItems: readonly GrnPoLineItem[],
  threshold: number,
): AggregatedVarianceData {
  const poMap = new Map<string, GrnPoLineItem>();
  for (const item of orderedItems) {
    poMap.set(item.stockItemId, item);
    poMap.set(item.sku, item);
  }

  const lineVariances: GrnLineVarianceDetail[] = [];
  let totalOrderedQty = 0;
  let totalDeliveredQty = 0;
  let totalAcceptedQty = 0;
  let totalRejectedQty = 0;
  let totalOrderedCostLkr = 0;
  let totalDeliveredCostLkr = 0;
  let totalAcceptedCostLkr = 0;
  let shortDeliveryCount = 0;
  let overDeliveryCount = 0;
  let priceSpikeCount = 0;
  let rejectedItemCount = 0;

  for (const delivered of deliveredItems) {
    const matched = poMap.get(delivered.stockItemId) ?? poMap.get(delivered.sku);
    const detail = calculateLineItemVariance(matched, delivered, threshold);
    lineVariances.push(detail);

    totalOrderedQty += detail.orderedQty;
    totalDeliveredQty += detail.deliveredQty;
    totalAcceptedQty += detail.acceptedQty;
    totalRejectedQty += detail.rejectedQty;
    totalOrderedCostLkr += detail.orderedTotalLkr;
    totalDeliveredCostLkr += roundLkr(detail.deliveredQty * delivered.invoiceUnitCostLkr);
    totalAcceptedCostLkr += detail.acceptedTotalLkr;

    if (detail.isShortDelivery) shortDeliveryCount++;
    if (detail.isOverDelivery) overDeliveryCount++;
    if (detail.isPriceSpike) priceSpikeCount++;
    if (detail.rejectedQty > 0) rejectedItemCount++;
  }

  return {
    lineVariances,
    totalOrderedQty,
    totalDeliveredQty,
    totalAcceptedQty,
    totalRejectedQty,
    totalOrderedCostLkr,
    totalDeliveredCostLkr,
    totalAcceptedCostLkr,
    shortDeliveryCount,
    overDeliveryCount,
    priceSpikeCount,
    rejectedItemCount,
  };
}

function createVarianceAudit(
  input: DetectGrnVarianceInput,
  summary: GrnVarianceSummary,
  timestampIso: string,
): AuditLogEntry | undefined {
  const hasVariance =
    summary.priceSpikeCount > 0 || summary.shortDeliveryCount > 0 || summary.rejectedItemCount > 0;
  if (!hasVariance) return undefined;

  const res = createAuditEntry({
    tenantId: input.tenantId,
    actorUserId: input.actor.userId,
    action: "GRN_VARIANCE_INSPECTED",
    entityType: "GOODS_RECEIVED_NOTE",
    entityId: input.grnNumber,
    isoTs: timestampIso,
    prevHash: input.prevAuditHash,
    afterJson: JSON.stringify({
      grnNumber: input.grnNumber,
      poNumber: input.poNumber,
      verdict: summary.verdict,
      priceSpikeCount: summary.priceSpikeCount,
      shortDeliveryCount: summary.shortDeliveryCount,
      rejectedItemCount: summary.rejectedItemCount,
      totalCostVarianceLkr: summary.totalCostVarianceLkr,
      managerOverride: input.managerOverride,
    }),
  });

  return res.ok ? res.value : undefined;
}

// ============================================================================
// Main Domain Function: detectGrnVariance
// ============================================================================

/**
 * Pure domain comparator for Goods Received Notes (GRN).
 *
 * Evaluates delivered items against PO purchase orders, detects short deliveries,
 * flags unit price inflation >10%, checks manager override authorization, and
 * creates audit log entries.
 */
export function detectGrnVariance(
  input: DetectGrnVarianceInput,
): Result<DetectGrnVarianceOutput, DomainError> {
  const basicRes = validateBasicInputs(input);
  if (!basicRes.ok) return basicRes;

  const actorRes = validateGrnVarianceActor(input.actor, input.tenantId);
  if (!actorRes.ok) return actorRes;

  const subRes = validateGrnSubscription(input.subscription, input.tenantId);
  if (!subRes.ok) return subRes;

  const threshold = input.spikeThresholdPercent ?? DEFAULT_PRICE_SPIKE_THRESHOLD_PERCENT;
  const agg = aggregateLines(input.deliveredItems, input.orderedItems, threshold);

  const hasOverride = checkManagerOverride(agg.priceSpikeCount, input.managerOverride);
  const verdict = determineOverallVerdict(
    agg.priceSpikeCount,
    agg.shortDeliveryCount,
    agg.rejectedItemCount,
    hasOverride,
  );

  const summary: GrnVarianceSummary = {
    totalOrderedQty: Math.round(agg.totalOrderedQty * 100) / 100,
    totalDeliveredQty: Math.round(agg.totalDeliveredQty * 100) / 100,
    totalAcceptedQty: Math.round(agg.totalAcceptedQty * 100) / 100,
    totalRejectedQty: Math.round(agg.totalRejectedQty * 100) / 100,
    totalOrderedCostLkr: roundLkr(agg.totalOrderedCostLkr),
    totalDeliveredCostLkr: roundLkr(agg.totalDeliveredCostLkr),
    totalAcceptedCostLkr: roundLkr(agg.totalAcceptedCostLkr),
    totalCostVarianceLkr: roundLkr(agg.totalAcceptedCostLkr - agg.totalOrderedCostLkr),
    shortDeliveryCount: agg.shortDeliveryCount,
    overDeliveryCount: agg.overDeliveryCount,
    priceSpikeCount: agg.priceSpikeCount,
    rejectedItemCount: agg.rejectedItemCount,
    hasPriceSpikes: agg.priceSpikeCount > 0,
    hasShortDeliveries: agg.shortDeliveryCount > 0,
    hasRejections: agg.rejectedItemCount > 0,
    requiresManagerApproval: agg.priceSpikeCount > 0 && !hasOverride,
    verdict,
  };

  const timestampIso = input.timestampIso ?? new Date().toISOString();
  const auditEntry = createVarianceAudit(input, summary, timestampIso);

  return ok({
    tenantId: input.tenantId,
    grnNumber: input.grnNumber,
    poNumber: input.poNumber,
    summary,
    lineVariances: agg.lineVariances,
    auditEntry,
    timestampIso,
  });
}
