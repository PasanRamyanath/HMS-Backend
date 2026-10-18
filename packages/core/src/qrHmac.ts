import { createHmac } from "node:crypto";
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
 * 3. Expired tokens are rejected deterministically once `nowEpoch > exp`.
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
