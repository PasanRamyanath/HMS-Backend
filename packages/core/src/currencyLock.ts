/**
 * @hms/core - Foreign Currency (USD/EUR/GBP) to LKR Invoice Lock Converter.
 *
 * Implements Central Bank of Sri Lanka (CBSL) check-in exchange rate locking:
 * - Foreign-quoted room rates (USD, EUR, GBP) locked into LKR taxable base at check-in
 * - Prevents exchange rate volatility disputes during billing/checkout
 * - Provides statutory LKR 4-stage tax computations with dual-currency guest copy summaries
 * - Generates cryptographically verifiable SHA-256 audit log records for locked rates
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { formatLkr } from "./format.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

/**
 * Standard foreign currencies commonly accepted and quoted by Sri Lankan hotels and DMCs.
 */
export const SUPPORTED_FOREIGN_CURRENCIES = ["USD", "EUR", "GBP"] as const;

export type ForeignCurrency = (typeof SUPPORTED_FOREIGN_CURRENCIES)[number];

/**
 * Validates whether a given currency code is an accepted foreign currency.
 */
export function isSupportedForeignCurrency(code: string): code is ForeignCurrency {
  return (SUPPORTED_FOREIGN_CURRENCIES as readonly string[]).includes(code);
}

/**
 * Formats a foreign currency value using standard international currency representation.
 */
export function formatForeignCurrency(amount: number, currency: ForeignCurrency): string {
  const rounded = roundLkr(amount);
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(rounded).replace(/\u00a0/g, " ");
}

export interface CurrencyLockInput {
  readonly foreignCurrency: ForeignCurrency;
  readonly foreignAmount: number;
  readonly lockedExchangeRateLkr: number;
  readonly tenantId?: string | undefined;
  readonly reservationId?: string | undefined;
  readonly rateSource?: string | undefined;
  readonly lockedAtIso?: string | undefined;
}

export interface LockedCurrencyConversion {
  readonly tenantId?: string | undefined;
  readonly reservationId?: string | undefined;
  readonly foreignCurrency: ForeignCurrency;
  readonly foreignAmount: number;
  readonly lockedExchangeRateLkr: number;
  readonly rateSource: string;
  readonly lockedAtIso: string;
  readonly baseLkr: number;
  readonly displaySummary: string;
  readonly formattedForeign: string;
  readonly formattedLkr: string;
}

export interface DualCurrencyBreakdownOptions {
  readonly foreignCurrency: ForeignCurrency;
  readonly lockedExchangeRateLkr: number;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
}

export interface DualCurrencyTaxBreakdown {
  readonly foreignCurrency: ForeignCurrency;
  readonly lockedExchangeRateLkr: number;
  readonly foreignBase: number;
  readonly baseLkr: number;
  readonly scLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatLkr: number;
  readonly grandTotalLkr: number;
  readonly foreignGrandTotal: number;
  readonly formattedForeignGrandTotal: string;
  readonly formattedLkrGrandTotal: string;
  readonly guestDualCurrencyNotice: string;
}

/**
 * Converts a foreign currency amount into locked LKR supply base with validation.
 */
export function convertForeignToLkrBase(
  foreignAmount: number,
  lockedExchangeRateLkr: number,
): Result<number, DomainError> {
  if (!Number.isFinite(foreignAmount) || foreignAmount < 0) {
    return domainErr(
      "INVALID_TAX_BASE",
      "Foreign currency amount must be a non-negative finite number",
      { foreignAmount },
    );
  }
  if (!Number.isFinite(lockedExchangeRateLkr) || lockedExchangeRateLkr <= 0) {
    return domainErr(
      "INVALID_EXCHANGE_RATE",
      "Locked exchange rate must be a positive finite number greater than zero",
      { lockedExchangeRateLkr },
    );
  }

  const baseLkr = roundLkr(foreignAmount * lockedExchangeRateLkr);
  return ok(baseLkr);
}

/**
 * Locks the check-in exchange rate for a guest reservation, producing statutory LKR base
 * and dual-currency display strings.
 */
export function lockExchangeRate(
  input: CurrencyLockInput,
): Result<LockedCurrencyConversion, DomainError> {
  if (!isSupportedForeignCurrency(input.foreignCurrency)) {
    return domainErr(
      "INVALID_CURRENCY",
      `Unsupported foreign currency '${input.foreignCurrency}'. Supported currencies: ${SUPPORTED_FOREIGN_CURRENCIES.join(", ")}`,
      { foreignCurrency: input.foreignCurrency },
    );
  }

  let validatedTenantId: string | undefined;
  if (input.tenantId !== undefined) {
    const tenantRes = validateTenantId(input.tenantId);
    if (!tenantRes.ok) {
      return tenantRes;
    }
    validatedTenantId = tenantRes.value;
  }

  const baseRes = convertForeignToLkrBase(input.foreignAmount, input.lockedExchangeRateLkr);
  if (!baseRes.ok) {
    return baseRes;
  }
  const baseLkr = baseRes.value;

  const rateSource = input.rateSource ?? "CBSL_INDICATIVE";
  const lockedAtIso = input.lockedAtIso ?? new Date().toISOString();
  const formattedForeign = formatForeignCurrency(input.foreignAmount, input.foreignCurrency);
  const formattedLkr = formatLkr(baseLkr);
  const displaySummary = `${formattedForeign} @ ${input.lockedExchangeRateLkr.toFixed(2)} -> ${formattedLkr}`;

  return ok({
    tenantId: validatedTenantId,
    reservationId: input.reservationId,
    foreignCurrency: input.foreignCurrency,
    foreignAmount: roundLkr(input.foreignAmount),
    lockedExchangeRateLkr: roundLkr(input.lockedExchangeRateLkr),
    rateSource,
    lockedAtIso,
    baseLkr,
    displaySummary,
    formattedForeign,
    formattedLkr,
  });
}

/**
 * Computes 4-stage compounding statutory taxes in LKR from a foreign-quoted rate,
 * providing both statutory LKR figures and dual-currency guest copy amounts.
 */
export function computeDualCurrencyTaxBreakdown(
  foreignAmount: number,
  options: DualCurrencyBreakdownOptions,
): Result<DualCurrencyTaxBreakdown, DomainError> {
  if (!isSupportedForeignCurrency(options.foreignCurrency)) {
    return domainErr(
      "INVALID_CURRENCY",
      `Unsupported foreign currency '${options.foreignCurrency}'. Supported currencies: ${SUPPORTED_FOREIGN_CURRENCIES.join(", ")}`,
      { foreignCurrency: options.foreignCurrency },
    );
  }

  const baseRes = convertForeignToLkrBase(foreignAmount, options.lockedExchangeRateLkr);
  if (!baseRes.ok) {
    return baseRes;
  }
  const baseLkr = baseRes.value;

  const taxConfig = options.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const taxRes = calculateForwardTax(baseLkr, taxConfig);
  if (!taxRes.ok) {
    return taxRes;
  }
  const tax = taxRes.value;

  const foreignGrandTotal = roundLkr(tax.grandTotalLkr / options.lockedExchangeRateLkr);
  const formattedForeignGrandTotal = formatForeignCurrency(
    foreignGrandTotal,
    options.foreignCurrency,
  );
  const formattedLkrGrandTotal = formatLkr(tax.grandTotalLkr);

  const guestDualCurrencyNotice = `Statutory tax invoice issued in Sri Lankan Rupees (LKR) at locked check-in rate: 1 ${options.foreignCurrency} = ${options.lockedExchangeRateLkr.toFixed(2)} LKR. Indicative foreign total: ${formattedForeignGrandTotal}.`;

  return ok({
    foreignCurrency: options.foreignCurrency,
    lockedExchangeRateLkr: options.lockedExchangeRateLkr,
    foreignBase: roundLkr(foreignAmount),
    baseLkr: tax.baseLkr,
    scLkr: tax.scLkr,
    tdlLkr: tax.tdlLkr,
    ssclLkr: tax.ssclLkr,
    vatLkr: tax.vatLkr,
    grandTotalLkr: tax.grandTotalLkr,
    foreignGrandTotal,
    formattedForeignGrandTotal,
    formattedLkrGrandTotal,
    guestDualCurrencyNotice,
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry when an exchange rate is locked.
 */
export function createCurrencyLockAuditEntry(
  tenantId: string,
  actorUserId: string,
  reservationId: string,
  conversion: LockedCurrencyConversion,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    reservationId,
    foreignCurrency: conversion.foreignCurrency,
    foreignAmount: conversion.foreignAmount,
    lockedExchangeRateLkr: conversion.lockedExchangeRateLkr,
    baseLkr: conversion.baseLkr,
    rateSource: conversion.rateSource,
    lockedAtIso: conversion.lockedAtIso,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "LOCK_RESERVATION_EXCHANGE_RATE",
    entityType: "Reservation",
    entityId: reservationId,
    isoTs,
    afterJson,
    prevHash,
  });
}
