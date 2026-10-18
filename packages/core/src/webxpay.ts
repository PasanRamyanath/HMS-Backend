import { createHmac, createVerify, timingSafeEqual } from "node:crypto";
import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

export type WebXPayPaymentStatus = "PAID" | "PENDING" | "FAILED" | "CANCELLED";

export interface WebXPayCustomFields {
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly subscriptionId?: string | undefined;
}

export interface WebXPayCallbackParams {
  readonly order_id?: string | undefined;
  readonly orderId?: string | undefined;
  readonly payment_amount?: string | number | undefined;
  readonly paymentAmount?: string | number | undefined;
  readonly amount?: string | number | undefined;
  readonly payment_status?: string | number | undefined;
  readonly paymentStatus?: string | number | undefined;
  readonly status?: string | number | undefined;
  readonly custom_fields?: string | undefined;
  readonly customFields?: string | undefined;
  readonly currency?: string | undefined;
  readonly signature?: string | undefined;
  readonly transaction_id?: string | undefined;
  readonly transactionId?: string | undefined;
}

export interface VerifiedWebXPayPayment {
  readonly tenantId: string;
  readonly orderId: string;
  readonly invoiceId: string;
  readonly subscriptionId?: string | undefined;
  readonly amount: number;
  readonly currency: string;
  readonly status: WebXPayPaymentStatus;
  readonly transactionId: string | undefined;
  readonly verified: true;
}

/**
 * Encodes tenantId and invoice/subscription metadata into WebXPay custom_fields format (base64 pipe-delimited).
 */
export function encodeWebXPayCustomFields(input: WebXPayCustomFields): Result<string, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const invoiceId = input.invoiceId.trim();
  if (invoiceId.length === 0) {
    return domainErr("VALIDATION_FAILED", "invoiceId cannot be empty");
  }

  const raw = [tenantRes.value, invoiceId, input.subscriptionId?.trim() ?? ""].join("|");

  return ok(Buffer.from(raw, "utf8").toString("base64"));
}

function parsePipeDelimitedCustomFields(decoded: string): Result<WebXPayCustomFields, DomainError> {
  const parts = decoded.split("|");
  const rawTenant = parts[0]?.trim();
  const rawInvoice = parts[1]?.trim();
  const rawSub = parts[2]?.trim();

  const tenantRes = validateTenantId(rawTenant);
  if (!tenantRes.ok) {
    return tenantRes;
  }

  if (!rawInvoice) {
    return domainErr("VALIDATION_FAILED", "Missing invoiceId in WebXPay custom_fields");
  }

  return ok({
    tenantId: tenantRes.value,
    invoiceId: rawInvoice,
    subscriptionId: rawSub && rawSub.length > 0 ? rawSub : undefined,
  });
}

function parseJsonCustomFields(decoded: string): Result<WebXPayCustomFields, DomainError> {
  try {
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const tenantRes = validateTenantId(parsed.tenantId);
    if (!tenantRes.ok) {
      return tenantRes;
    }
    const rawInvoice = typeof parsed.invoiceId === "string" ? parsed.invoiceId.trim() : "";
    if (!rawInvoice) {
      return domainErr("VALIDATION_FAILED", "Missing invoiceId in WebXPay custom_fields JSON");
    }

    const rawSub =
      typeof parsed.subscriptionId === "string" ? parsed.subscriptionId.trim() : undefined;
    return ok({
      tenantId: tenantRes.value,
      invoiceId: rawInvoice,
      subscriptionId: rawSub && rawSub.length > 0 ? rawSub : undefined,
    });
  } catch {
    return domainErr("VALIDATION_FAILED", "Unrecognized format in WebXPay custom_fields");
  }
}

/**
 * Decodes and validates WebXPay custom_fields from base64.
 * Supports pipe-delimited format (`tenantId|invoiceId|subscriptionId`) or JSON string format.
 */
export function parseWebXPayCustomFields(
  customFieldsBase64: unknown,
): Result<WebXPayCustomFields, DomainError> {
  if (typeof customFieldsBase64 !== "string" || customFieldsBase64.trim() === "") {
    return domainErr("VALIDATION_FAILED", "WebXPay custom_fields must be a non-empty string");
  }

  let decoded: string;
  try {
    decoded = Buffer.from(customFieldsBase64.trim(), "base64").toString("utf8");
  } catch {
    return domainErr("VALIDATION_FAILED", "Invalid base64 encoding in WebXPay custom_fields");
  }

  if (decoded.includes("|")) {
    return parsePipeDelimitedCustomFields(decoded);
  }

  return parseJsonCustomFields(decoded);
}

/**
 * Maps WebXPay status indicators to standard domain payment statuses.
 */
export function mapWebXPayStatus(status: unknown): WebXPayPaymentStatus {
  const norm = String(status).trim().toUpperCase();
  if (norm === "0" || norm === "SUCCESS" || norm === "PAID") {
    return "PAID";
  }
  if (norm === "PENDING" || norm === "IN_PROGRESS") {
    return "PENDING";
  }
  if (norm === "CANCELLED" || norm === "CANCELED") {
    return "CANCELLED";
  }
  return "FAILED";
}

function verifyRsaSignature(
  payloadString: string,
  signatureHexOrBase64: string,
  publicKeyPem: string,
): Result<boolean, DomainError> {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(payloadString, "utf8");
    const isHex = /^[0-9a-fA-F]+$/.test(signatureHexOrBase64);
    const sigEncoding = isHex ? "hex" : "base64";
    const isValid = verifier.verify(publicKeyPem, signatureHexOrBase64, sigEncoding);
    if (!isValid) {
      return domainErr("INVALID_SIGNATURE", "WebXPay RSA-SHA256 signature verification failed");
    }
    return ok(true);
  } catch (e) {
    return domainErr(
      "INVALID_SIGNATURE",
      "WebXPay RSA verification encountered cryptographic error",
      { error: e instanceof Error ? e.message : String(e) },
    );
  }
}

function verifyHmacSignature(
  payloadString: string,
  providedSignature: string,
  secretKey: string,
): Result<boolean, DomainError> {
  const calculatedHex = createHmac("sha256", secretKey).update(payloadString, "utf8").digest("hex");

  const calcBuf = Buffer.from(calculatedHex.toLowerCase(), "utf8");
  const provBuf = Buffer.from(providedSignature.toLowerCase(), "utf8");

  if (calcBuf.length !== provBuf.length) {
    return domainErr("INVALID_SIGNATURE", "WebXPay HMAC signature length mismatch");
  }

  if (!timingSafeEqual(calcBuf, provBuf)) {
    return domainErr("INVALID_SIGNATURE", "WebXPay HMAC signature mismatch");
  }

  return ok(true);
}

/**
 * Verifies WebXPay signature using either RSA public key PEM or HMAC shared secret.
 */
export function verifyWebXPaySignature(
  payloadString: string,
  signature: string,
  secretOrPublicKey: string,
): Result<boolean, DomainError> {
  const trimmedKey = secretOrPublicKey.trim();
  if (trimmedKey.startsWith("-----BEGIN")) {
    return verifyRsaSignature(payloadString, signature.trim(), trimmedKey);
  }
  return verifyHmacSignature(payloadString, signature.trim(), trimmedKey);
}

interface RawCallbackFields {
  readonly orderId: string;
  readonly numericAmount: number;
  readonly rawStatus: string | number;
  readonly rawCustom: string;
  readonly signature: string;
  readonly currency: string;
  readonly transactionId: string | undefined;
}

function parseCallbackAmount(raw: unknown): Result<number, DomainError> {
  const numeric = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(numeric) || numeric < 0) {
    return domainErr("VALIDATION_FAILED", "Invalid WebXPay payment amount", { rawAmount: raw });
  }
  return ok(numeric);
}

function extractCallbackFields(
  params: WebXPayCallbackParams,
): Result<RawCallbackFields, DomainError> {
  const orderId = (params.order_id ?? params.orderId)?.trim();
  const rawAmount = params.payment_amount ?? params.paymentAmount ?? params.amount;
  const rawStatus = params.payment_status ?? params.paymentStatus ?? params.status;
  const rawCustom = params.custom_fields ?? params.customFields;
  const signature = params.signature?.trim();

  if (!orderId || rawAmount === undefined || rawStatus === undefined || !rawCustom || !signature) {
    return domainErr("VALIDATION_FAILED", "Missing mandatory WebXPay callback parameters");
  }

  const amountRes = parseCallbackAmount(rawAmount);
  if (!amountRes.ok) {
    return amountRes;
  }

  const currency = (params.currency?.trim() || "LKR").toUpperCase();
  const transactionId = (params.transaction_id ?? params.transactionId)?.trim();

  return ok({
    orderId,
    numericAmount: amountRes.value,
    rawStatus,
    rawCustom,
    signature,
    currency,
    transactionId: transactionId && transactionId.length > 0 ? transactionId : undefined,
  });
}

/**
 * Full verification and parameter extraction of an incoming WebXPay callback.
 */
export function verifyWebXPayCallback(
  params: WebXPayCallbackParams,
  secretOrPublicKey: string,
): Result<VerifiedWebXPayPayment, DomainError> {
  const fieldsRes = extractCallbackFields(params);
  if (!fieldsRes.ok) {
    return fieldsRes;
  }
  const fields = fieldsRes.value;

  const customRes = parseWebXPayCustomFields(fields.rawCustom);
  if (!customRes.ok) {
    return customRes;
  }
  const custom = customRes.value;

  const formattedAmount = fields.numericAmount.toFixed(2);
  const statusStr = String(fields.rawStatus).trim();

  // Canonical payload format for WebXPay verification: orderId|amount|status|custom_fields
  const canonicalPayload = `${fields.orderId}|${formattedAmount}|${statusStr}|${fields.rawCustom.trim()}`;

  const sigRes = verifyWebXPaySignature(canonicalPayload, fields.signature, secretOrPublicKey);
  if (!sigRes.ok) {
    return sigRes;
  }

  const status = mapWebXPayStatus(fields.rawStatus);

  return ok({
    tenantId: custom.tenantId,
    orderId: fields.orderId,
    invoiceId: custom.invoiceId,
    subscriptionId: custom.subscriptionId,
    amount: fields.numericAmount,
    currency: fields.currency,
    status,
    transactionId: fields.transactionId,
    verified: true,
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for WebXPay transactions.
 */
export function createWebXPayAuditEntry(
  tenantId: string,
  actorUserId: string,
  invoiceId: string,
  status: WebXPayPaymentStatus,
  amount: number,
  currency: string,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    invoiceId,
    status,
    amount: amount.toFixed(2),
    currency: currency.toUpperCase(),
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: `WEBXPAY_PAYMENT_${status}`,
    entityType: "SubscriptionPayment",
    entityId: invoiceId,
    isoTs,
    afterJson,
    prevHash,
  });
}
