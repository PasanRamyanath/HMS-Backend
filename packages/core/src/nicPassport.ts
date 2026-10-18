/**
 * @hms/core - Sri Lankan National Identity Card (NIC) & Foreign Passport Engine.
 *
 * Implements:
 * 1. Sri Lankan Old (9-digit + V/X) and New (12-digit) NIC parsing
 * 2. Birth year, birth month/day, gender, voter eligibility extraction
 * 3. Automatic residencyTier = 'RESIDENT_LKR' allocation
 * 4. SHA-256 hash-chained immutable audit log generation
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

export type SriLankanGender = "MALE" | "FEMALE";
export type ResidencyTier = "RESIDENT_LKR" | "FOREIGN_USD_LOCKED";

export interface ParsedSriLankanNic {
  readonly rawNic: string;
  readonly canonicalNic: string;
  readonly format: "OLD_9_DIGIT" | "NEW_12_DIGIT";
  readonly birthYear: number;
  readonly birthMonth: number;
  readonly birthDay: number;
  readonly dateOfBirthIso: string;
  readonly gender: SriLankanGender;
  readonly dayOfYear: number;
  readonly isVoterEligible: boolean;
  readonly residencyTier: ResidencyTier;
}

const OLD_NIC_REGEX = /^(\d{2})(\d{3})(\d{4})([vVxX])$/;
const NEW_NIC_REGEX = /^(\d{4})(\d{3})(\d{5})$/;

// Sri Lankan DRP 366-day calendar table (February treated with 29 days)
const DAYS_PER_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Converts Sri Lankan NIC day-of-year (1-366) to month (1-12) and day (1-31).
 */
function dayOfYearToMonthDay(dayOfYear: number): { month: number; day: number } {
  let remainingDays = dayOfYear;
  for (let m = 0; m < DAYS_PER_MONTH.length; m++) {
    const daysInMonth = DAYS_PER_MONTH[m] ?? 31;
    if (remainingDays <= daysInMonth) {
      return { month: m + 1, day: remainingDays };
    }
    remainingDays -= daysInMonth;
  }
  return { month: 12, day: 31 };
}

/**
 * Derives gender and normalized day-of-year from 3-digit day code.
 * Day code > 500 denotes female; 500 is subtracted to get actual day of year.
 */
function extractGenderAndDayOfYear(
  dayCode: number,
): Result<{ gender: SriLankanGender; dayOfYear: number }, DomainError> {
  const isFemale = dayCode > 500;
  const dayOfYear = isFemale ? dayCode - 500 : dayCode;

  if (dayOfYear < 1 || dayOfYear > 366) {
    return domainErr("INVALID_NIC", `Invalid day-of-year code ${dayCode}. Must resolve to 1-366`, {
      dayCode,
      dayOfYear,
    });
  }

  return ok({
    gender: isFemale ? "FEMALE" : "MALE",
    dayOfYear,
  });
}

/**
 * Formats date of birth into standard ISO format: YYYY-MM-DD.
 */
function formatDobIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Parses old 9-digit + V/X Sri Lankan NIC format.
 */
function parseOldNic(trimmed: string): Result<ParsedSriLankanNic, DomainError> {
  const match = OLD_NIC_REGEX.exec(trimmed);
  if (!match || !match[1] || !match[2] || !match[4]) {
    return domainErr("INVALID_NIC", "Invalid old NIC format", { nic: trimmed });
  }

  const birthYear = 1900 + Number.parseInt(match[1], 10);
  const dayCode = Number.parseInt(match[2], 10);
  const voterChar = match[4].toUpperCase();
  const isVoterEligible = voterChar === "V";

  const genderRes = extractGenderAndDayOfYear(dayCode);
  if (!genderRes.ok) {
    return genderRes;
  }

  const { gender, dayOfYear } = genderRes.value;
  const { month, day } = dayOfYearToMonthDay(dayOfYear);
  const dateOfBirthIso = formatDobIso(birthYear, month, day);

  return ok({
    rawNic: trimmed,
    canonicalNic: trimmed.toUpperCase(),
    format: "OLD_9_DIGIT",
    birthYear,
    birthMonth: month,
    birthDay: day,
    dateOfBirthIso,
    gender,
    dayOfYear,
    isVoterEligible,
    residencyTier: "RESIDENT_LKR",
  });
}

/**
 * Parses modern 12-digit Sri Lankan NIC format.
 */
function parseNewNic(trimmed: string): Result<ParsedSriLankanNic, DomainError> {
  const match = NEW_NIC_REGEX.exec(trimmed);
  if (!match || !match[1] || !match[2]) {
    return domainErr("INVALID_NIC", "Invalid new 12-digit NIC format", { nic: trimmed });
  }

  const birthYear = Number.parseInt(match[1], 10);
  const dayCode = Number.parseInt(match[2], 10);

  const genderRes = extractGenderAndDayOfYear(dayCode);
  if (!genderRes.ok) {
    return genderRes;
  }

  const { gender, dayOfYear } = genderRes.value;
  const { month, day } = dayOfYearToMonthDay(dayOfYear);
  const dateOfBirthIso = formatDobIso(birthYear, month, day);

  return ok({
    rawNic: trimmed,
    canonicalNic: trimmed,
    format: "NEW_12_DIGIT",
    birthYear,
    birthMonth: month,
    birthDay: day,
    dateOfBirthIso,
    gender,
    dayOfYear,
    isVoterEligible: true,
    residencyTier: "RESIDENT_LKR",
  });
}

/**
 * Parses and validates a Sri Lankan National Identity Card (NIC).
 *
 * Supports:
 * - Old 10-char format: 9 numeric digits + V or X (e.g. "921541234V")
 * - New 12-digit format: 12 numeric digits (e.g. "199215401234")
 * - Extracts 4-digit birth year, birth month, birth day, and ISO date of birth
 * - Derives gender: dayOfYear > 500 => FEMALE (subtracts 500)
 * - Identifies voter eligibility (V = eligible, X = not eligible)
 * - Sets residencyTier to 'RESIDENT_LKR' for domestic tariff eligibility
 */
export function parseSriLankaNic(nic: unknown): Result<ParsedSriLankanNic, DomainError> {
  if (typeof nic !== "string" || nic.trim() === "") {
    return domainErr("INVALID_NIC", "NIC number must be a non-empty string");
  }

  const trimmed = nic.trim();

  if (OLD_NIC_REGEX.test(trimmed)) {
    return parseOldNic(trimmed);
  }

  if (NEW_NIC_REGEX.test(trimmed)) {
    return parseNewNic(trimmed);
  }

  return domainErr(
    "INVALID_NIC",
    "Invalid Sri Lankan NIC format. Must be 9 digits followed by V/X or modern 12 digits",
    { nic: trimmed },
  );
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for NIC verification.
 */
export function createNicVerificationAuditEntry(
  tenantId: string,
  actorUserId: string,
  guestId: string,
  parsedNic: ParsedSriLankanNic,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    guestId,
    canonicalNic: parsedNic.canonicalNic,
    format: parsedNic.format,
    birthYear: parsedNic.birthYear,
    gender: parsedNic.gender,
    residencyTier: parsedNic.residencyTier,
    dateOfBirthIso: parsedNic.dateOfBirthIso,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "VERIFY_GUEST_NIC",
    entityType: "Guest",
    entityId: guestId,
    isoTs,
    afterJson,
    prevHash,
  });
}
