/**
 * @hms/core - Guest Order Submission Idempotency Guard (orderIdempotency.ts)
 *
 * Deterministic clientOrderUuid idempotency key guard preventing duplicate orders
 * on network jitter or double-taps over slow 3G/Wi-Fi in Sri Lankan resort regions
 * (e.g. Yala Safari camps, Ella highlands, Mirissa coastline).
 *
 * Enforces:
 * 1. Multi-tenant tenantId isolation.
 * 2. Deterministic clientOrderUuid validation (UUID v4 or cryptographic nonce).
 * 3. 4-Stage compounding Sri Lankan statutory hospitality taxes (SC -> TDL -> SSCL -> VAT).
 * 4. DynamoDB ConditionExpression: attribute_not_exists(PK) generation.
 * 5. Cryptographically chained ImmutableAuditLog SHA-256 payload generation.
 * 6. Explicit Result<T, DomainError> with zero external npm dependencies.
 */

import { createHash } from "node:crypto";
import { type AuditLogEntry, GENESIS_HASH, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type OrderPaymentMethod = "ROOM_FOLIO" | "LANKA_QR" | "PAYHERE" | "CASH";

export type IdempotencyRecordStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface GuestOrderItemInput {
  readonly dishId: string;
  readonly dishName: string;
  readonly unitPriceLkr: number;
  readonly quantity: number;
  readonly portion?: string | undefined;
  readonly spiceLevel?: string | undefined;
  readonly specialNotes?: string | undefined;
  readonly modifiersTotalLkr?: number | undefined;
  readonly isMealPlanCovered?: boolean | undefined;
}

export interface CreateGuestOrderRequest {
  readonly tenantId: string;
  readonly clientOrderUuid: string;
  readonly locationId: string;
  readonly items: ReadonlyArray<GuestOrderItemInput>;
  readonly paymentMethod: OrderPaymentMethod;
  readonly actorId: string;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
  readonly folioId?: string | undefined;
  readonly notes?: string | undefined;
}

export interface IdempotencyRecord {
  readonly pk: string;
  readonly sk: string;
  readonly tenantId: string;
  readonly clientOrderUuid: string;
  readonly orderId: string;
  readonly locationId: string;
  readonly status: IdempotencyRecordStatus;
  readonly requestHash: string;
  readonly grandTotalLkr: number;
  readonly createdAt: string;
  readonly expiresAtTtl: number;
}

export interface DynamoDbIdempotencyCondition {
  readonly conditionExpression: string;
  readonly keyExpression: {
    readonly PK: string;
    readonly SK: string;
  };
}

export interface ValidatedGuestOrderResult {
  readonly orderId: string;
  readonly clientOrderUuid: string;
  readonly tenantId: string;
  readonly locationId: string;
  readonly paymentMethod: OrderPaymentMethod;
  readonly subtotalBaseLkr: number;
  readonly mealPlanDeductionLkr: number;
  readonly netTaxableSupplyLkr: number;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly grandTotalLkr: number;
  readonly idempotencyRecord: IdempotencyRecord;
  readonly dynamoDbCondition: DynamoDbIdempotencyCondition;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Validation & Canonical Hash Helpers
// ============================================================================

/**
 * Validates a clientOrderUuid idempotency key.
 * Must be a non-empty string between 8 and 128 characters containing valid safe characters.
 */
export function validateIdempotencyKey(key: string): Result<string, DomainError> {
  if (!key || typeof key !== "string") {
    return domainErr("INVALID_IDEMPOTENCY_KEY", "clientOrderUuid is required and must be a string");
  }

  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    return domainErr(
      "INVALID_IDEMPOTENCY_KEY",
      `clientOrderUuid length must be between 8 and 128 characters (received ${trimmed.length})`,
      { clientOrderUuid: trimmed },
    );
  }

  // Safe characters: alphanumeric, hyphen, underscore
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return domainErr(
      "INVALID_IDEMPOTENCY_KEY",
      "clientOrderUuid contains invalid characters; only alphanumeric, hyphens, and underscores are permitted",
      { clientOrderUuid: trimmed },
    );
  }

  return ok(trimmed);
}

/**
 * Computes deterministic SHA-256 canonical hash of order items and request parameters.
 * Sorts items by dishId to guarantee consistency regardless of client serialization order.
 */
export function computeOrderRequestHash(request: CreateGuestOrderRequest): string {
  const sortedItems = [...request.items]
    .sort((a, b) => a.dishId.localeCompare(b.dishId))
    .map((item) => ({
      dishId: item.dishId,
      qty: item.quantity,
      price: roundLkr(item.unitPriceLkr),
      mods: roundLkr(item.modifiersTotalLkr ?? 0),
      covered: Boolean(item.isMealPlanCovered),
      notes: item.specialNotes ?? "",
    }));

  const canonicalString = [
    request.tenantId,
    request.clientOrderUuid,
    request.locationId,
    request.paymentMethod,
    request.folioId ?? "NO_FOLIO",
    JSON.stringify(sortedItems),
  ].join("|");

  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/**
 * Builds DynamoDB condition and primary key structure for atomic idempotency locking.
 * Table single-table design convention:
 * PK: TENANT#<tenantId>#IDEMPOTENCY#<clientOrderUuid>
 * SK: RECORD
 */
export function buildDynamoDbIdempotencyCondition(
  tenantId: string,
  clientOrderUuid: string,
): DynamoDbIdempotencyCondition {
  return {
    conditionExpression: "attribute_not_exists(PK)",
    keyExpression: {
      PK: `TENANT#${tenantId}#IDEMPOTENCY#${clientOrderUuid}`,
      SK: "RECORD",
    },
  };
}

/**
 * Builds the complete IdempotencyRecord with TTL for DynamoDB storage.
 */
export function buildIdempotencyRecord(
  request: CreateGuestOrderRequest,
  orderId: string,
  grandTotalLkr: number,
  ttlSeconds = 86400, // 24 hours TTL
): IdempotencyRecord {
  const now = new Date();
  const expiresAtTtl = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const condition = buildDynamoDbIdempotencyCondition(request.tenantId, request.clientOrderUuid);

  return {
    pk: condition.keyExpression.PK,
    sk: condition.keyExpression.SK,
    tenantId: request.tenantId,
    clientOrderUuid: request.clientOrderUuid,
    orderId,
    locationId: request.locationId,
    status: "COMPLETED",
    requestHash: computeOrderRequestHash(request),
    grandTotalLkr,
    createdAt: now.toISOString(),
    expiresAtTtl,
  };
}

// ============================================================================
// Core Idempotent Order Processor
// ============================================================================

export interface OrderLineTotals {
  readonly subtotalBaseLkr: number;
  readonly mealPlanDeductionLkr: number;
  readonly netTaxableSupplyLkr: number;
}

export function validateOrderRequestBasics(
  request: CreateGuestOrderRequest,
): Result<string, DomainError> {
  if (!request.tenantId || request.tenantId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "tenantId is required for guest order");
  }

  const keyValidation = validateIdempotencyKey(request.clientOrderUuid);
  if (!keyValidation.ok) {
    return keyValidation;
  }

  if (!request.locationId || request.locationId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "locationId is required for guest order");
  }

  if (!request.items || request.items.length === 0) {
    return domainErr("INVALID_ORDER_ITEMS", "Order must contain at least one dish item");
  }

  return keyValidation;
}

export function computeOrderLineTotals(
  items: ReadonlyArray<GuestOrderItemInput>,
): Result<OrderLineTotals, DomainError> {
  let subtotalBaseLkr = 0;
  let mealPlanDeductionLkr = 0;

  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return domainErr(
        "INVALID_ORDER_ITEMS",
        `Item quantity must be a positive integer: ${item.dishId}`,
      );
    }
    if (!Number.isFinite(item.unitPriceLkr) || item.unitPriceLkr < 0) {
      return domainErr(
        "INVALID_ORDER_ITEMS",
        `Item unit price must be non-negative: ${item.dishId}`,
      );
    }

    const itemBase = roundLkr((item.unitPriceLkr + (item.modifiersTotalLkr ?? 0)) * item.quantity);
    subtotalBaseLkr = roundLkr(subtotalBaseLkr + itemBase);

    if (item.isMealPlanCovered) {
      const coveredAmount = roundLkr(item.unitPriceLkr * item.quantity);
      mealPlanDeductionLkr = roundLkr(mealPlanDeductionLkr + coveredAmount);
    }
  }

  const netTaxableSupplyLkr = Math.max(0, roundLkr(subtotalBaseLkr - mealPlanDeductionLkr));

  return ok({
    subtotalBaseLkr,
    mealPlanDeductionLkr,
    netTaxableSupplyLkr,
  });
}

// ============================================================================
// Core Idempotent Order Processor
// ============================================================================

/**
 * Validates, taxes, and generates idempotency & audit records for a guest order.
 *
 * @param request Inbound order request containing clientOrderUuid
 * @param prevAuditHash Hash of the previous audit entry in the hash chain (defaults to GENESIS_HASH)
 * @returns Result with ValidatedGuestOrderResult or DomainError
 */
export function processGuestOrderIdempotency(
  request: CreateGuestOrderRequest,
  prevAuditHash = GENESIS_HASH,
): Result<ValidatedGuestOrderResult, DomainError> {
  const basicsResult = validateOrderRequestBasics(request);
  if (!basicsResult.ok) {
    return basicsResult;
  }
  const clientOrderUuid = basicsResult.value;

  const totalsResult = computeOrderLineTotals(request.items);
  if (!totalsResult.ok) {
    return totalsResult;
  }
  const { subtotalBaseLkr, mealPlanDeductionLkr, netTaxableSupplyLkr } = totalsResult.value;

  const taxConfig = request.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const taxResult = calculateForwardTax(netTaxableSupplyLkr, taxConfig);
  if (!taxResult.ok) {
    return taxResult;
  }
  const taxBreakdown = taxResult.value;
  const grandTotalLkr = taxBreakdown.grandTotalLkr;

  const cleanId = clientOrderUuid.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const orderId = `ORD-${cleanId.substring(0, 10)}`;

  const idempotencyRecord = buildIdempotencyRecord(request, orderId, grandTotalLkr);
  const dynamoDbCondition = buildDynamoDbIdempotencyCondition(request.tenantId, clientOrderUuid);

  const auditResult = createAuditEntry({
    tenantId: request.tenantId,
    actorUserId: request.actorId || "guest-qr-runner",
    action: "GUEST_ORDER_SUBMITTED",
    entityType: "ORDER",
    entityId: orderId,
    isoTs: idempotencyRecord.createdAt,
    prevHash: prevAuditHash,
    afterJson: JSON.stringify({
      orderId,
      clientOrderUuid,
      locationId: request.locationId,
      paymentMethod: request.paymentMethod,
      grandTotalLkr,
      itemsCount: request.items.length,
    }),
  });

  if (!auditResult.ok) {
    return auditResult;
  }

  return ok({
    orderId,
    clientOrderUuid,
    tenantId: request.tenantId,
    locationId: request.locationId,
    paymentMethod: request.paymentMethod,
    subtotalBaseLkr,
    mealPlanDeductionLkr,
    netTaxableSupplyLkr,
    taxBreakdown,
    grandTotalLkr,
    idempotencyRecord,
    dynamoDbCondition,
    auditEntry: auditResult.value,
  });
}
