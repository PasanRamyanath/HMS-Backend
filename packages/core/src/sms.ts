import { createHmac, timingSafeEqual } from "node:crypto";
import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

export type SriLankanMobileOperator = "Dialog" | "Mobitel" | "Hutch" | "Airtel";

export type SmsDeliveryStatus = "DELIVERED" | "SENT" | "FAILED" | "QUEUED" | "EXPIRED";

export interface NormalizedSriLankanMobile {
  readonly msisdn: string; // 11 digits without plus: '947XXXXXXXX'
  readonly e164: string; // with plus: '+947XXXXXXXX'
  readonly localFormatted: string; // '07X XXXXXXX'
  readonly operator: SriLankanMobileOperator;
}

const SL_MOBILE_REGEX = /^(?:\+94|0094|94|0)?(7[01245678]\d{7})$/;

/**
 * Normalizes Sri Lankan mobile numbers across Dialog, Mobitel, Hutch, and Airtel.
 * Returns standard 11-digit MSISDN (`947XXXXXXXX`) suitable for SMS gateways.
 */
export function normalizeSriLankanMobile(
  input: unknown,
): Result<NormalizedSriLankanMobile, DomainError> {
  if (typeof input !== "string" || input.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Mobile number must be a non-empty string");
  }

  const cleaned = input.trim().replace(/[\s\-()]/g, "");
  const match = SL_MOBILE_REGEX.exec(cleaned);
  if (!match || !match[1]) {
    return domainErr(
      "VALIDATION_FAILED",
      "Invalid Sri Lankan mobile number. Expected 9 digits starting with 07X or +947X",
      { input },
    );
  }

  const national9 = match[1];
  const msisdn = `94${national9}`;
  const e164 = `+94${national9}`;
  const localFormatted = `0${national9.slice(0, 2)} ${national9.slice(2)}`;

  const prefix = national9.slice(0, 2);
  let operator: SriLankanMobileOperator;
  if (prefix === "74" || prefix === "76" || prefix === "77") {
    operator = "Dialog";
  } else if (prefix === "70" || prefix === "71") {
    operator = "Mobitel";
  } else if (prefix === "72" || prefix === "78") {
    operator = "Hutch";
  } else {
    operator = "Airtel";
  }

  return ok({
    msisdn,
    e164,
    localFormatted,
    operator,
  });
}

export interface SmsGoWebhookParams {
  readonly rawBody: string | Buffer;
  readonly signature: string | undefined;
  readonly secret: string;
}

export interface VerifiedSmsGoReport {
  readonly verified: true;
  readonly messageId: string;
  readonly mobile: string;
  readonly status: SmsDeliveryStatus;
  readonly rawPayload: Record<string, unknown>;
}

/**
 * Maps SMS gateway status string to standard domain delivery status.
 */
export function mapSmsDeliveryStatus(status: unknown): SmsDeliveryStatus {
  const norm = String(status).trim().toUpperCase();
  if (norm === "DELIVERED" || norm === "SUCCESS" || norm === "DELIVRD") {
    return "DELIVERED";
  }
  if (norm === "SENT" || norm === "SUBMITTED") {
    return "SENT";
  }
  if (norm === "QUEUED" || norm === "PENDING") {
    return "QUEUED";
  }
  if (norm === "EXPIRED") {
    return "EXPIRED";
  }
  return "FAILED";
}

function verifyHmacConstantTime(
  payloadBuffer: Buffer,
  signatureHex: string,
  secret: string,
): Result<void, DomainError> {
  const cleanSig = signatureHex.trim().toLowerCase();
  const calculatedHex = createHmac("sha256", secret.trim())
    .update(payloadBuffer)
    .digest("hex")
    .toLowerCase();

  const calcBuf = Buffer.from(calculatedHex, "utf8");
  const provBuf = Buffer.from(cleanSig, "utf8");

  if (calcBuf.length !== provBuf.length) {
    return domainErr("INVALID_SIGNATURE", "SMSGo signature length mismatch");
  }

  if (!timingSafeEqual(calcBuf, provBuf)) {
    return domainErr("INVALID_SIGNATURE", "SMSGo signature HMAC-SHA256 verification failed");
  }

  return ok(undefined);
}

function parseWebhookPayload(rawStr: string): Result<Record<string, unknown>, DomainError> {
  try {
    const parsed = JSON.parse(rawStr) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return domainErr("VALIDATION_FAILED", "SMSGo webhook payload must be a JSON object");
    }
    return ok(parsed as Record<string, unknown>);
  } catch {
    return domainErr("VALIDATION_FAILED", "Failed to parse SMSGo webhook JSON body");
  }
}

/**
 * Verifies SMSGo.lk webhook delivery report using HMAC-SHA256 signature in `X-SMSGo-Signature`.
 */
export function verifySmsGoWebhook(
  params: SmsGoWebhookParams,
): Result<VerifiedSmsGoReport, DomainError> {
  const secret = params.secret?.trim();
  if (!secret) {
    return domainErr("VALIDATION_FAILED", "SMSGo webhook secret is required");
  }

  const signature = params.signature?.trim();
  if (!signature) {
    return domainErr("INVALID_SIGNATURE", "Missing X-SMSGo-Signature header");
  }

  const rawBuffer = Buffer.isBuffer(params.rawBody)
    ? params.rawBody
    : Buffer.from(params.rawBody, "utf8");

  const sigCheck = verifyHmacConstantTime(rawBuffer, signature, secret);
  if (!sigCheck.ok) {
    return sigCheck;
  }

  const payloadRes = parseWebhookPayload(rawBuffer.toString("utf8"));
  if (!payloadRes.ok) {
    return payloadRes;
  }
  const payload = payloadRes.value;

  const messageId = String(payload.message_id ?? payload.messageId ?? payload.id ?? "").trim();
  const rawMobile = String(payload.mobile ?? payload.recipient ?? payload.to ?? "").trim();
  const rawStatus = payload.status ?? payload.delivery_status;

  const normMobileRes = normalizeSriLankanMobile(rawMobile);
  const normalizedMobile = normMobileRes.ok ? normMobileRes.value.msisdn : rawMobile;

  return ok({
    verified: true,
    messageId: messageId.length > 0 ? messageId : "UNKNOWN_MSG",
    mobile: normalizedMobile,
    status: mapSmsDeliveryStatus(rawStatus),
    rawPayload: payload,
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for SMS dispatches and delivery reports.
 */
export function createSmsAuditEntry(
  tenantId: string,
  actorUserId: string,
  mobile: string,
  messageId: string,
  status: SmsDeliveryStatus,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    mobile,
    messageId,
    status,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: `SMS_${status}`,
    entityType: "SmsNotification",
    entityId: messageId,
    isoTs,
    afterJson,
    prevHash,
  });
}
