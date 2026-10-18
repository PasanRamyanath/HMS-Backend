/**
 * @hms/core - Shared Sri Lankan Hospitality Currency & Asia/Colombo Date Formatters.
 *
 * Implements high-precision integer-cent rounding, Sri Lankan Rupee (LKR) & USD
 * tabular currency formatting, and Asia/Colombo (UTC+05:30) statutory date representations.
 * Employs native ECMAScript Intl APIs with strictly zero external NPM dependencies.
 */

export const SRI_LANKA_TIMEZONE = "Asia/Colombo";
export const SRI_LANKA_LOCALE = "en-LK";

import { roundLkr } from "./tax.js";

export { roundLkr };

const lkrFormatter = new Intl.NumberFormat(SRI_LANKA_LOCALE, {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a numeric amount as Sri Lankan Rupees (e.g. "LKR 45,000.00").
 * Converts non-breaking whitespace to standard space for Apple HIG tabular-nums alignment.
 */
export function formatLkr(amount: number): string {
  const rounded = roundLkr(amount);
  return lkrFormatter.format(rounded).replace(/\u00a0/g, " ");
}

/**
 * Formats a numeric amount as US Dollars (e.g. "USD 150.00").
 * Converts non-breaking whitespace to standard space for Apple HIG tabular-nums alignment.
 */
export function formatUsd(amount: number): string {
  const rounded = roundLkr(amount);
  return usdFormatter.format(rounded).replace(/\u00a0/g, " ");
}

const slDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SRI_LANKA_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const slDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SRI_LANKA_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function toDate(input: string | Date | number): Date {
  if (input instanceof Date) {
    return input;
  }
  return new Date(input);
}

/**
 * Formats an ISO string, timestamp, or Date into Asia/Colombo medium date (e.g. "18 Oct 2026").
 */
export function formatSlDate(input: string | Date | number): string {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) {
    return "Invalid Date";
  }
  return slDateFormatter.format(date);
}

/**
 * Formats an ISO string, timestamp, or Date into Asia/Colombo medium date and 24h time (e.g. "18 Oct 2026, 18:00:00").
 */
export function formatSlDateTime(input: string | Date | number): string {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) {
    return "Invalid Date";
  }
  return slDateTimeFormatter.format(date);
}

/**
 * Returns ISO date format YYYY-MM-DD evaluated strictly in the Asia/Colombo timezone.
 */
export function formatSlIsoDate(input: string | Date | number): string {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) {
    return "Invalid Date";
  }
  // Intl format to parts in Asia/Colombo
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SRI_LANKA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";

  return `${year}-${month}-${day}`;
}
