/**
 * @hms/core - Explicit Result<T, E> Pattern & Structured Domain Error Catalog.
 *
 * Eliminates unhandled exceptions, console.error statements, and ambiguous returns.
 * Every domain failure returns a strongly typed Result with an actionable error code.
 */

export type DomainErrorCode =
  | "TENANT_MISMATCH"
  | "QUOTA_EXCEEDED"
  | "TAX_MISMATCH"
  | "INVALID_TAX_BASE"
  | "INVALID_FOLIO_LINE"
  | "INVALID_EXCHANGE_RATE"
  | "INVALID_CURRENCY"
  | "INVALID_NIC"
  | "INVALID_PASSPORT"
  | "INVALID_LANKA_QR"
  | "HMAC_EXPIRED"
  | "INVALID_SIGNATURE"
  | "INVALID_QR_SESSION"
  | "ROOM_CONFLICT"
  | "RESOURCE_CONFLICT"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "AUDIT_CHAIN_CORRUPTED"
  | "TRANSACTION_FAILED"
  | "INVALID_ORDER_ITEMS"
  | "INVALID_RESERVATION"
  | "RESERVATION_NOT_ACTIVE"
  | "DATE_OVERLAP"
  | "DRIVER_BED_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "SUBSCRIPTION_INACTIVE"
  | "PLAN_LIMITATION"
  | "INVALID_DATE_FORMAT"
  | "INVALID_RATE"
  | "PROMO_EXPIRED"
  | "INVALID_PROMO_CODE"
  | "INVALID_BIN"
  | "MEAL_PLAN_INELIGIBLE"
  | "BLACKOUT_DATE_CONFLICT"
  | "MIN_NIGHTS_NOT_MET"
  | "PROMO_QUOTA_EXCEEDED"
  | "CREDIT_LIMIT_EXCEEDED"
  | "INVOICE_ALREADY_CREDITED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "IDEMPOTENCY_PREVIOUS_FAILURE"
  | "NETWORK_ERROR"
  | "CONFIG_ERROR"
  | "CHANNEX_SYNC_FAILED"
  | "RESERVATION_ALREADY_CANCELLED"
  | "INVALID_STATE"
  | "DATABASE_ERROR";

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly details?: unknown;
}

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Creates a successful Result wrapping a value.
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Creates an error Result wrapping an error value.
 */
export function err<E = DomainError>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Convenience constructor for structured DomainError Results.
 */
export function domainErr(
  code: DomainErrorCode,
  message: string,
  meta?: Record<string, unknown>,
): Result<never, DomainError> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(meta !== undefined ? { meta } : {}),
    },
  };
}

/**
 * Maps a successful Result value to a new value through a transform function.
 */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (val: T) => U): Result<U, E> {
  if (result.ok) {
    return { ok: true, value: fn(result.value) };
  }
  return result;
}

/**
 * Chains a function returning another Result onto a successful Result.
 */
export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  fn: (val: T) => Result<U, E>,
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

/**
 * Unwraps the value of a Result or returns a fallback value if failed.
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
