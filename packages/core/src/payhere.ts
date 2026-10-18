import { createHash } from "node:crypto";
import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

/**
 * Parameters for generating a PayHere Sri Lanka payment checkout hash.
 */
export interface PayHereCheckoutParams {
  readonly merchantId: string;
  readonly orderId: string;
  readonly amount: number;
  readonly currency: string;
  readonly merchantSecret: string;
  readonly tenantId?: string | undefined;
}

/**
 * Computes the PayHere Sri Lanka server-side checkout MD5 hash.
 *
 * Formula:
 * `UPPERCASE(MD5(merchant_id + order_id + amount.toFixed(2) + currency + UPPERCASE(MD5(merchant_secret))))`
 *
 * This hash protects payment amounts and destination accounts from client-side tampering
 * before redirecting to the PayHere payment gateway checkout modal.
 */
export function generatePayHereCheckoutHash(
  params: PayHereCheckoutParams,
): Result<string, DomainError> {
  const merchantId = params.merchantId?.trim();
  const orderId = params.orderId?.trim();
  const merchantSecret = params.merchantSecret?.trim();
  const rawCurrency = params.currency?.trim();
  const amount = params.amount;

  if (!merchantId) {
    return domainErr("VALIDATION_FAILED", "PayHere merchantId is required");
  }

  if (!orderId) {
    return domainErr("VALIDATION_FAILED", "PayHere orderId is required");
  }

  if (!merchantSecret) {
    return domainErr("VALIDATION_FAILED", "PayHere merchantSecret is required");
  }

  if (!rawCurrency || rawCurrency.length !== 3) {
    return domainErr(
      "INVALID_CURRENCY",
      "PayHere currency must be a valid 3-letter ISO code (e.g. 'LKR', 'USD')",
      { currency: params.currency },
    );
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return domainErr("VALIDATION_FAILED", "PayHere payment amount must be a positive number", {
      amount,
    });
  }

  if (params.tenantId !== undefined) {
    const tenantRes = validateTenantId(params.tenantId);
    if (!tenantRes.ok) {
      return tenantRes;
    }
  }

  const currency = rawCurrency.toUpperCase();
  const formattedAmount = amount.toFixed(2);

  // Stage 1: Uppercase MD5 of merchant secret
  const hashedSecret = createHash("md5").update(merchantSecret, "utf8").digest("hex").toUpperCase();

  // Stage 2: Concatenate and hash the full payload
  const payloadToHash = `${merchantId}${orderId}${formattedAmount}${currency}${hashedSecret}`;
  const checkoutHash = createHash("md5").update(payloadToHash, "utf8").digest("hex").toUpperCase();

  return ok(checkoutHash);
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for PayHere checkout hash creation.
 */
export function createPayHereCheckoutAuditEntry(
  tenantId: string,
  actorUserId: string,
  orderId: string,
  amount: number,
  currency: string,
  checkoutHash: string,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    orderId,
    amount: amount.toFixed(2),
    currency: currency.toUpperCase(),
    hashPreview: checkoutHash.slice(0, 8),
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "GENERATE_PAYHERE_CHECKOUT_HASH",
    entityType: "PaymentCheckout",
    entityId: orderId,
    isoTs,
    afterJson,
    prevHash,
  });
}
