import { createHash, timingSafeEqual } from "node:crypto";
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
 * Normalized payment lifecycle status according to PayHere Sri Lanka specifications.
 */
export type PayHerePaymentStatus = "PAID" | "PENDING" | "CANCELLED" | "FAILED" | "CHARGEDBACK";

/**
 * Inbound webhook notification payload received from PayHere `notify_url`.
 * Supports both standard snake_case and camelCase parameters.
 */
export interface PayHereWebhookParams {
  readonly merchant_id?: string | undefined;
  readonly merchantId?: string | undefined;
  readonly order_id?: string | undefined;
  readonly orderId?: string | undefined;
  readonly payhere_amount?: string | number | undefined;
  readonly payhereAmount?: string | number | undefined;
  readonly amount?: string | number | undefined;
  readonly payhere_currency?: string | undefined;
  readonly payhereCurrency?: string | undefined;
  readonly currency?: string | undefined;
  readonly status_code?: string | number | undefined;
  readonly statusCode?: string | number | undefined;
  readonly md5sig?: string | undefined;
  readonly md5Sig?: string | undefined;
  readonly payment_id?: string | undefined;
  readonly paymentId?: string | undefined;
  readonly custom_1?: string | undefined;
  readonly custom1?: string | undefined;
  readonly custom_2?: string | undefined;
  readonly custom2?: string | undefined;
}

export interface VerifiedPayHereWebhook {
  readonly orderId: string;
  readonly paymentId: string | undefined;
  readonly amount: number;
  readonly currency: string;
  readonly status: PayHerePaymentStatus;
  readonly rawStatusCode: number;
  readonly verified: true;
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
 * Maps PayHere integer status codes to structured domain payment statuses.
 */
export function mapPayHereStatusCode(code: number): Result<PayHerePaymentStatus, DomainError> {
  switch (code) {
    case 2:
      return ok("PAID");
    case 0:
      return ok("PENDING");
    case -1:
      return ok("CANCELLED");
    case -2:
      return ok("FAILED");
    case -3:
      return ok("CHARGEDBACK");
    default:
      return domainErr("VALIDATION_FAILED", `Unknown PayHere payment status_code: ${code}`, {
        statusCode: code,
      });
  }
}

interface ExtractedWebhookFields {
  readonly merchantId: string;
  readonly orderId: string;
  readonly formattedAmount: string;
  readonly numericAmount: number;
  readonly currency: string;
  readonly statusCodeStr: string;
  readonly numericStatusCode: number;
  readonly md5sig: string;
  readonly paymentId: string | undefined;
}

function parseAmountField(
  raw: string | number | undefined,
): Result<{ formatted: string; numeric: number }, DomainError> {
  if (raw === undefined || raw === null || raw === "") {
    return domainErr("VALIDATION_FAILED", "Missing PayHere webhook payment amount");
  }
  const numeric = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(numeric) || numeric < 0) {
    return domainErr("VALIDATION_FAILED", "Invalid PayHere webhook payment amount", {
      rawAmount: raw,
    });
  }
  return ok({
    formatted: numeric.toFixed(2),
    numeric,
  });
}

function parseStatusField(raw: string | number): { asStr: string; asNum: number } {
  const asNum = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  return { asStr: String(raw).trim(), asNum };
}

function extractWebhookFields(
  params: PayHereWebhookParams,
): Result<ExtractedWebhookFields, DomainError> {
  const merchantId = (params.merchant_id ?? params.merchantId)?.trim();
  const orderId = (params.order_id ?? params.orderId)?.trim();
  const rawCurrency = (
    params.payhere_currency ??
    params.payhereCurrency ??
    params.currency
  )?.trim();
  const rawStatus = params.status_code ?? params.statusCode;
  const md5sig = (params.md5sig ?? params.md5Sig)?.trim().toUpperCase();
  const paymentId = (params.payment_id ?? params.paymentId)?.trim();

  if (!merchantId || !orderId || !rawCurrency || rawStatus === undefined || !md5sig) {
    return domainErr("VALIDATION_FAILED", "Missing mandatory PayHere webhook parameters");
  }

  const rawAmount = params.payhere_amount ?? params.payhereAmount ?? params.amount;
  const amountRes = parseAmountField(rawAmount);
  if (!amountRes.ok) {
    return amountRes;
  }

  const statusParsed = parseStatusField(rawStatus);

  return ok({
    merchantId,
    orderId,
    formattedAmount: amountRes.value.formatted,
    numericAmount: amountRes.value.numeric,
    currency: rawCurrency.toUpperCase(),
    statusCodeStr: statusParsed.asStr,
    numericStatusCode: statusParsed.asNum,
    md5sig,
    paymentId: paymentId && paymentId.length > 0 ? paymentId : undefined,
  });
}

function verifyMd5SignatureConstantTime(
  calculatedSig: string,
  providedSig: string,
): Result<void, DomainError> {
  const calcBuffer = Buffer.from(calculatedSig, "utf8");
  const provBuffer = Buffer.from(providedSig, "utf8");

  if (calcBuffer.length !== provBuffer.length) {
    return domainErr("INVALID_SIGNATURE", "PayHere webhook signature length mismatch");
  }

  if (!timingSafeEqual(calcBuffer, provBuffer)) {
    return domainErr("INVALID_SIGNATURE", "PayHere webhook MD5 signature mismatch");
  }

  return ok(undefined);
}

/**
 * Verifies PayHere `notify_url` server-to-server webhook callback.
 *
 * Enforces:
 * 1. Constant-time MD5 signature verification:
 *    `UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(MD5(merchantSecret)))) === md5sig`
 * 2. Mapping of `status_code` to verified `PayHerePaymentStatus`
 * 3. Exact numerical extraction of amount and currency
 */
export function verifyPayHereWebhook(
  params: PayHereWebhookParams,
  merchantSecret: string,
): Result<VerifiedPayHereWebhook, DomainError> {
  const cleanSecret = merchantSecret?.trim();
  if (!cleanSecret) {
    return domainErr(
      "VALIDATION_FAILED",
      "PayHere merchantSecret is required for webhook verification",
    );
  }

  const fieldsRes = extractWebhookFields(params);
  if (!fieldsRes.ok) {
    return fieldsRes;
  }
  const fields = fieldsRes.value;

  const statusRes = mapPayHereStatusCode(fields.numericStatusCode);
  if (!statusRes.ok) {
    return statusRes;
  }
  const status = statusRes.value;

  // Stage 1: Uppercase MD5 of secret
  const hashedSecret = createHash("md5").update(cleanSecret, "utf8").digest("hex").toUpperCase();

  // Stage 2: Concatenate with webhook parameters
  const payloadToHash = `${fields.merchantId}${fields.orderId}${fields.formattedAmount}${fields.currency}${fields.statusCodeStr}${hashedSecret}`;
  const calculatedSig = createHash("md5").update(payloadToHash, "utf8").digest("hex").toUpperCase();

  const sigCheck = verifyMd5SignatureConstantTime(calculatedSig, fields.md5sig);
  if (!sigCheck.ok) {
    return sigCheck;
  }

  return ok({
    orderId: fields.orderId,
    paymentId: fields.paymentId,
    amount: fields.numericAmount,
    currency: fields.currency,
    status,
    rawStatusCode: fields.numericStatusCode,
    verified: true,
  });
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

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for PayHere webhook notifications.
 */
export function createPayHereWebhookAuditEntry(
  tenantId: string,
  actorUserId: string,
  orderId: string,
  status: PayHerePaymentStatus,
  amount: number,
  currency: string,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    orderId,
    status,
    amount: amount.toFixed(2),
    currency: currency.toUpperCase(),
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: `PAYHERE_WEBHOOK_${status}`,
    entityType: "PaymentNotification",
    entityId: orderId,
    isoTs,
    afterJson,
    prevHash,
  });
}
