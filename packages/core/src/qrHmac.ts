import { createHmac, timingSafeEqual } from "node:crypto";
import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

/**
 * Compact payload representing a guest room or restaurant table QR session.
 *
 * Fields are intentionally abbreviated for compact QR code densities:
 * - `tid`: Multi-tenant organization slug
 * - `loc`: Room or table location identifier (e.g., 'ROOM-101', 'VILLA-04', 'TABLE-12')
 * - `sty`: Unique stay or order session identifier, rotating on every check-in
 * - `exp`: Expiration timestamp in Unix epoch seconds
 */
export interface QrSessionPayload {
  readonly tid: string;
  readonly loc: string;
  readonly sty: string;
  readonly exp: number;
}

export interface SignQrSessionTokenParams {
  readonly tenantId?: string | undefined;
  readonly tid?: string | undefined;
  readonly location?: string | undefined;
  readonly loc?: string | undefined;
  readonly stayId?: string | undefined;
  readonly sty?: string | undefined;
  readonly exp: number;
  readonly secret: string;
}

/**
 * Generates an HMAC-SHA256 authenticated QR session token.
 *
 * Encodes the payload as:
 * `base64url(json) + '.' + base64url(hmacSha256(encodedPayload, secret))`
 *
 * This guarantees:
 * 1. Guests cannot tamper with room numbers or tenant IDs to place unauthorized folio charges.
 * 2. Rotating `stayId` immediately invalidates previous guest session QR codes upon checkout.
 * 3. Expired tokens are rejected deterministically once `nowEpoch >= exp`.
 */
export function signQrSessionToken(params: SignQrSessionTokenParams): Result<string, DomainError> {
  const rawTenant = (params.tenantId ?? params.tid)?.trim();
  const rawLocation = (params.location ?? params.loc)?.trim();
  const rawStay = (params.stayId ?? params.sty)?.trim();
  const secret = params.secret;
  const exp = params.exp;

  if (!rawLocation) {
    return domainErr(
      "INVALID_QR_SESSION",
      "Room or table location identifier is required for QR session token",
    );
  }

  if (!rawStay) {
    return domainErr(
      "INVALID_QR_SESSION",
      "Stay or session identifier is required for QR session token",
    );
  }

  if (typeof secret !== "string" || secret.trim().length === 0) {
    return domainErr("INVALID_QR_SESSION", "HMAC signing secret must be a non-empty string");
  }

  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) {
    return domainErr(
      "INVALID_QR_SESSION",
      "Expiration must be a positive finite Unix epoch timestamp in seconds",
      { exp },
    );
  }

  const tenantRes = validateTenantId(rawTenant);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const tenantId = tenantRes.value;

  const payload: QrSessionPayload = {
    tid: tenantId,
    loc: rawLocation,
    sty: rawStay,
    exp: Math.floor(exp),
  };

  const payloadJson = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  return ok(`${encodedPayload}.${signature}`);
}

interface ParsedTokenComponents {
  readonly encodedPayload: string;
  readonly signature: string;
}

function parseTokenComponents(token: unknown): Result<ParsedTokenComponents, DomainError> {
  if (typeof token !== "string" || token.trim() === "") {
    return domainErr("INVALID_QR_SESSION", "QR session token must be a non-empty string");
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return domainErr(
      "INVALID_QR_SESSION",
      "Malformed QR session token. Expected format: '<payload>.<signature>'",
    );
  }

  const encodedPayload = parts[0] ?? "";
  const signature = parts[1] ?? "";

  if (encodedPayload.length === 0 || signature.length === 0) {
    return domainErr("INVALID_QR_SESSION", "QR session token components cannot be empty");
  }

  return ok({ encodedPayload, signature });
}

function decodePayload(encoded: string): Result<QrSessionPayload, DomainError> {
  let parsed: unknown;
  try {
    const jsonStr = Buffer.from(encoded, "base64url").toString("utf8");
    parsed = JSON.parse(jsonStr);
  } catch {
    return domainErr("INVALID_QR_SESSION", "Failed to decode QR session payload JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    return domainErr("INVALID_QR_SESSION", "QR session payload must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.tid !== "string" ||
    typeof obj.loc !== "string" ||
    typeof obj.sty !== "string" ||
    typeof obj.exp !== "number" ||
    !Number.isFinite(obj.exp)
  ) {
    return domainErr("INVALID_QR_SESSION", "QR session payload is missing mandatory fields");
  }

  return ok({
    tid: obj.tid,
    loc: obj.loc,
    sty: obj.sty,
    exp: Math.floor(obj.exp),
  });
}

function verifySignatureConstantTime(
  encodedPayload: string,
  signatureStr: string,
  secret: string,
): Result<void, DomainError> {
  const expectedSigBuffer = createHmac("sha256", secret).update(encodedPayload).digest();
  const actualSigBuffer = Buffer.from(signatureStr, "base64url");

  if (actualSigBuffer.length !== expectedSigBuffer.length) {
    return domainErr("INVALID_SIGNATURE", "QR session signature length mismatch");
  }

  if (!timingSafeEqual(actualSigBuffer, expectedSigBuffer)) {
    return domainErr("INVALID_SIGNATURE", "QR session token cryptographic signature mismatch");
  }

  return ok(undefined);
}

/**
 * Verifies a QR session token against the HMAC secret and expiration timestamp.
 * Uses constant-time comparison (crypto.timingSafeEqual) to prevent timing attacks.
 *
 * Enforces:
 * 1. Valid token structure and non-empty components
 * 2. Constant-time cryptographic HMAC-SHA256 signature match
 * 3. Token expiration: `exp > nowEpoch`
 */
export function verifyQrSessionToken(
  token: string,
  secret: string,
  nowEpoch?: number,
): Result<QrSessionPayload, DomainError> {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    return domainErr("INVALID_QR_SESSION", "HMAC verification secret must be a non-empty string");
  }

  const compRes = parseTokenComponents(token);
  if (!compRes.ok) {
    return compRes;
  }
  const { encodedPayload, signature } = compRes.value;

  const sigRes = verifySignatureConstantTime(encodedPayload, signature, secret);
  if (!sigRes.ok) {
    return sigRes;
  }

  const payloadRes = decodePayload(encodedPayload);
  if (!payloadRes.ok) {
    return payloadRes;
  }
  const payload = payloadRes.value;

  const currentEpoch = nowEpoch ?? Math.floor(Date.now() / 1000);
  if (payload.exp <= currentEpoch) {
    return domainErr("HMAC_EXPIRED", "QR session token has expired", {
      exp: payload.exp,
      now: currentEpoch,
    });
  }

  return ok(payload);
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for QR session token issuance.
 */
export function createQrSessionTokenAuditEntry(
  tenantId: string,
  actorUserId: string,
  location: string,
  stayId: string,
  token: string,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const tokenParts = token.split(".");
  const tokenSigPreview = tokenParts[1]?.slice(0, 8) ?? "unknown";

  const afterJson = JSON.stringify({
    location,
    stayId,
    tokenPrefix: tokenParts[0]?.slice(0, 16) ?? "",
    signaturePreview: tokenSigPreview,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "ISSUE_QR_SESSION_TOKEN",
    entityType: "QrSessionToken",
    entityId: `${location}:${stayId}`,
    isoTs,
    afterJson,
    prevHash,
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for QR session token verification.
 */
export function createQrSessionVerificationAuditEntry(
  tenantId: string,
  actorUserId: string,
  location: string,
  stayId: string,
  verified: boolean,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    location,
    stayId,
    verified,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: verified ? "VERIFY_QR_SESSION_TOKEN_SUCCESS" : "VERIFY_QR_SESSION_TOKEN_FAILURE",
    entityType: "QrSessionToken",
    entityId: `${location}:${stayId}`,
    isoTs,
    afterJson,
    prevHash,
  });
}
