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
  | "INVALID_NIC"
  | "HMAC_EXPIRED"
  | "ROOM_CONFLICT"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "AUDIT_CHAIN_CORRUPTED";

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
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
