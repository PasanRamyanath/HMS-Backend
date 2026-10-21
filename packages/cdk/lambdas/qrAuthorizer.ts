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
 * Configuration options for the QR authorizer rate limiter.
 */
export interface RateLimitConfig {
  readonly maxRequestsPerWindow: number;
  readonly windowDurationMs: number;
}

/**
 * Default rate limit parameters:
 * Max 60 requests per 60 seconds per room token session (1 req/sec average burst limit).
 * Protects AppSync and downstream resolvers against DDoS / runaway infinite client loops.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRequestsPerWindow: 60,
  windowDurationMs: 60_000,
};

/**
 * In-memory Token Bucket tracking state per room token session.
 */
interface RateLimitBucket {
  tokens: number;
  lastRefillMs: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

/**
 * Resets the in-memory rate limiter state.
 * Useful for automated unit testing and container resets.
 */
export function resetRateLimiter(): void {
  rateLimitBuckets.clear();
}

/**
 * Parses and returns the active rate limit configuration,
 * honoring environment overrides (QR_RATE_LIMIT_BURST, QR_RATE_LIMIT_WINDOW_MS).
 */
export function getRateLimitConfig(): RateLimitConfig {
  const envBurst = process.env.QR_RATE_LIMIT_BURST;
  const envWindow = process.env.QR_RATE_LIMIT_WINDOW_MS;

  const maxRequestsPerWindow =
    envBurst && !Number.isNaN(Number(envBurst)) && Number(envBurst) > 0
      ? Number.parseInt(envBurst, 10)
      : DEFAULT_RATE_LIMIT_CONFIG.maxRequestsPerWindow;

  const windowDurationMs =
    envWindow && !Number.isNaN(Number(envWindow)) && Number(envWindow) > 0
      ? Number.parseInt(envWindow, 10)
      : DEFAULT_RATE_LIMIT_CONFIG.windowDurationMs;

  return {
    maxRequestsPerWindow,
    windowDurationMs,
  };
}

/**
 * Prunes stale rate limit buckets to prevent memory accumulation in warm Lambda containers.
 */
export function pruneStaleRateLimitBuckets(
  now: number = Date.now(),
  maxIdleMs: number = DEFAULT_RATE_LIMIT_CONFIG.windowDurationMs * 2,
): number {
  let prunedCount = 0;
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (now - bucket.lastRefillMs > maxIdleMs) {
      rateLimitBuckets.delete(key);
      prunedCount += 1;
    }
  }
  return prunedCount;
}

/**
 * Evaluates whether a room token session key has exceeded the allowed burst rate.
 * Uses a token bucket algorithm to support smooth bursts with consistent replenishment.
 *
 * @param key Unique session key (`${tenantId}#${locationId}#${stayId}`)
 * @param now Current timestamp in milliseconds (defaults to Date.now())
 * @param config Optional rate limit configuration
 * @returns true if rate limit exceeded (request should be rejected); false if allowed.
 */
export function checkRateLimitExceeded(
  key: string,
  now: number = Date.now(),
  config: RateLimitConfig = getRateLimitConfig(),
): boolean {
  const { maxRequestsPerWindow, windowDurationMs } = config;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket) {
    rateLimitBuckets.set(key, {
      tokens: maxRequestsPerWindow - 1,
      lastRefillMs: now,
    });
    if (rateLimitBuckets.size > 500) {
      pruneStaleRateLimitBuckets(now, windowDurationMs * 2);
    }
    return false;
  }

  const elapsedMs = Math.max(0, now - bucket.lastRefillMs);
  const refillRate = maxRequestsPerWindow / windowDurationMs;
  const refilledTokens = Math.min(maxRequestsPerWindow, bucket.tokens + elapsedMs * refillRate);

  if (refilledTokens >= 1) {
    bucket.tokens = refilledTokens - 1;
    bucket.lastRefillMs = now;
    return false;
  }

  bucket.tokens = refilledTokens;
  bucket.lastRefillMs = now;
  return true;
}

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
 * - Validates strict multi-tenant isolation (`tenantId`)
 * - Enforces burst rate-limiting per room token session to protect AppSync free-tier quota
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

  // Strict tenant isolation guard
  if (!payload.tid || payload.tid.trim().length === 0) {
    return {
      isAuthorized: false,
      ttlOverride: 0,
    };
  }

  // Rate-limit check per room token session (tenantId + locationId + stayId)
  const roomSessionKey = `${payload.tid}#${payload.loc}#${payload.sty}`;
  if (checkRateLimitExceeded(roomSessionKey)) {
    return {
      isAuthorized: false,
      ttlOverride: 0,
      deniedFields: ["*"],
    };
  }

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
