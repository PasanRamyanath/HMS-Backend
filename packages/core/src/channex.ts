import { createHmac, timingSafeEqual } from "node:crypto";
import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

export const DEFAULT_MAX_CHANNEX_SKEW_SECONDS = 300;

export interface ChannexWebhookVerificationInput {
  readonly rawBody: string | Buffer;
  readonly timestampHeader: string | number | undefined;
  readonly signatureHeader: string | undefined;
  readonly secret: string;
  readonly secondarySecret?: string | undefined;
  readonly nowEpoch?: number | undefined;
  readonly maxSkewSeconds?: number | undefined;
}

export interface VerifiedChannexWebhook {
  readonly verified: true;
  readonly timestamp: number;
  readonly rawBody: string;
}

function parseTimestamp(raw: string | number | undefined): Result<number, DomainError> {
  if (raw === undefined || raw === null || raw === "") {
    return domainErr("VALIDATION_FAILED", "Missing Channex timestamp header (x-hmac-timestamp)");
  }

  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return domainErr("VALIDATION_FAILED", "Invalid Channex timestamp header format", {
      timestamp: raw,
    });
  }

  return ok(parsed);
}

function checkTimeSkew(
  timestamp: number,
  nowEpoch: number | undefined,
  maxSkewSeconds: number,
): Result<void, DomainError> {
  const currentEpoch = nowEpoch ?? Math.floor(Date.now() / 1000);
  const skew = Math.abs(currentEpoch - timestamp);

  if (skew > maxSkewSeconds) {
    return domainErr("HMAC_EXPIRED", "Channex webhook timestamp exceeds allowable time skew", {
      timestamp,
      now: currentEpoch,
      skewSeconds: skew,
      maxSkewSeconds,
    });
  }

  return ok(undefined);
}

function parseCandidateSignatures(signatureHeader: string | undefined): string[] {
  if (!signatureHeader) {
    return [];
  }

  return signatureHeader
    .split(",")
    .map((s) => s.trim())
    .map((s) => (s.startsWith("sha256=") ? s.slice(7) : s))
    .filter((s) => s.length > 0);
}

function matchesSignatureConstantTime(calculatedHex: string, candidateHex: string): boolean {
  const calcBuf = Buffer.from(calculatedHex.toLowerCase(), "utf8");
  const candBuf = Buffer.from(candidateHex.toLowerCase(), "utf8");

  if (calcBuf.length !== candBuf.length) {
    return false;
  }

  return timingSafeEqual(calcBuf, candBuf);
}

function verifyAgainstSecret(
  payloadToSign: Buffer,
  secret: string,
  candidateSignatures: readonly string[],
): boolean {
  if (!secret || secret.trim().length === 0) {
    return false;
  }

  const calculatedHex = createHmac("sha256", secret.trim()).update(payloadToSign).digest("hex");

  for (const candidate of candidateSignatures) {
    if (matchesSignatureConstantTime(calculatedHex, candidate)) {
      return true;
    }
  }

  return false;
}

/**
 * Verifies raw-body HMAC-SHA256 signature and timestamp of incoming Channex.io OTA webhooks.
 *
 * Prevents:
 * 1. Replay attacks through 300s timestamp skew window verification.
 * 2. Payload tampering through constant-time HMAC verification over `<timestamp>.<rawBody>`.
 * 3. Zero-downtime key rotation through dual-secret support.
 */
export function verifyChannexWebhook(
  input: ChannexWebhookVerificationInput,
): Result<VerifiedChannexWebhook, DomainError> {
  if (!input.secret || input.secret.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "Channex webhook secret must be a non-empty string");
  }

  const tsRes = parseTimestamp(input.timestampHeader);
  if (!tsRes.ok) {
    return tsRes;
  }
  const timestamp = tsRes.value;

  const maxSkew = input.maxSkewSeconds ?? DEFAULT_MAX_CHANNEX_SKEW_SECONDS;
  const skewRes = checkTimeSkew(timestamp, input.nowEpoch, maxSkew);
  if (!skewRes.ok) {
    return skewRes;
  }

  const candidateSignatures = parseCandidateSignatures(input.signatureHeader);
  if (candidateSignatures.length === 0) {
    return domainErr(
      "INVALID_SIGNATURE",
      "Missing or empty Channex signature header (x-hmac-signature-256)",
    );
  }

  const rawBuffer = Buffer.isBuffer(input.rawBody)
    ? input.rawBody
    : Buffer.from(input.rawBody, "utf8");
  const prefixBuffer = Buffer.from(`${timestamp}.`, "utf8");
  const payloadToSign = Buffer.concat([prefixBuffer, rawBuffer]);

  // Check primary secret
  const validPrimary = verifyAgainstSecret(payloadToSign, input.secret, candidateSignatures);
  if (validPrimary) {
    return ok({
      verified: true,
      timestamp,
      rawBody: rawBuffer.toString("utf8"),
    });
  }

  // Check secondary secret for zero-downtime key rotation
  if (input.secondarySecret && input.secondarySecret.trim().length > 0) {
    const validSecondary = verifyAgainstSecret(
      payloadToSign,
      input.secondarySecret,
      candidateSignatures,
    );
    if (validSecondary) {
      return ok({
        verified: true,
        timestamp,
        rawBody: rawBuffer.toString("utf8"),
      });
    }
  }

  return domainErr(
    "INVALID_SIGNATURE",
    "Channex webhook HMAC-SHA256 signature verification failed",
  );
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for Channex OTA booking webhooks.
 */
export function createChannexWebhookAuditEntry(
  tenantId: string,
  actorUserId: string,
  bookingId: string,
  eventType: string,
  timestamp: number,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    bookingId,
    eventType,
    channexTimestamp: timestamp,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: `CHANNEX_WEBHOOK_${eventType.toUpperCase()}`,
    entityType: "OtaWebhook",
    entityId: bookingId,
    isoTs,
    afterJson,
    prevHash,
  });
}
