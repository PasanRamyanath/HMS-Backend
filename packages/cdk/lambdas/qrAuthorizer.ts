import {
  type DomainError,
  type QrSessionPayload,
  type Result,
  verifyQrSessionToken,
} from "@hms/core";

/**
 * AWS AppSync Lambda Custom Authorizer event payload.
 */
export interface AppSyncAuthorizerEvent {
  readonly authorizationToken?: string;
  readonly requestContext?: {
    readonly apiId?: string;
    readonly accountId?: string;
    readonly queryString?: string;
    readonly operationName?: string;
    readonly variables?: Record<string, unknown>;
  };
}

/**
 * AWS AppSync Lambda Custom Authorizer response structure.
 */
export interface AppSyncAuthorizerResult {
  readonly isAuthorized: boolean;
  readonly resolverContext?: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly stayId: string;
    readonly exp: number;
    readonly role: string;
  };
  readonly deniedFields?: string[];
  readonly ttlOverride?: number;
}

/**
 * 5-minute cache TTL (in seconds) for authorized QR sessions.
 * Caching valid sessions in AppSync edge caches reduces Lambda invocations by ~95%.
 */
export const AUTHORIZED_TTL_SECONDS = 300;

/**
 * Extracts the raw HMAC session token from an authorization header,
 * safely handling optional 'Bearer ' prefix and extraneous whitespace.
 */
export function extractRawToken(authHeader: unknown): string {
  if (typeof authHeader !== "string") {
    return "";
  }
  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

/**
 * AppSync Custom Lambda Authorizer for zero-login contactless guest QR access.
 *
 * Verifies room/table HMAC tokens generated during guest check-in:
 * - Checks cryptographic HMAC-SHA256 signature in constant time
 * - Confirms token has not expired
 * - Injects verified tenantId, locationId, and stayId into resolverContext
 * - Applies 300-second authorizer TTL caching for authorized sessions
 *
 * @param event AppSync authorizer event containing authorizationToken
 * @returns AppSyncAuthorizerResult with authorization status and resolver context
 */
export async function handler(event: AppSyncAuthorizerEvent): Promise<AppSyncAuthorizerResult> {
  const rawToken = extractRawToken(event?.authorizationToken);
  const secret = process.env.QR_HMAC_SECRET;

  if (!rawToken || !secret || secret.trim().length === 0) {
    return {
      isAuthorized: false,
      ttlOverride: 0,
    };
  }

  const verificationRes: Result<QrSessionPayload, DomainError> = verifyQrSessionToken(
    rawToken,
    secret,
  );

  if (!verificationRes.ok) {
    return {
      isAuthorized: false,
      ttlOverride: 0,
    };
  }

  const payload = verificationRes.value;

  return {
    isAuthorized: true,
    resolverContext: {
      tenantId: payload.tid,
      locationId: payload.loc,
      stayId: payload.sty,
      exp: payload.exp,
      role: "GUEST_QR",
    },
    ttlOverride: AUTHORIZED_TTL_SECONDS,
  };
}
