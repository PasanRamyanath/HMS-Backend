import { type DomainError, type Result, domainErr, ok } from "./result.js";

/**
 * @hms/core - Runtime Tenant & Sri Lankan Statutory Identity Validators.
 *
 * Provides deterministic runtime validation and normalization for:
 * - Tenant identifiers (multi-tenant subdomain / slug isolation)
 * - Sri Lankan mobile telephone numbers (+947XXXXXXXX canonical E.164)
 * - National Identity Card numbers (Old 9V/X and New 12-digit formats)
 * - SLTDA (Sri Lanka Tourism Development Authority) hotel registration numbers
 * - IRD (Inland Revenue Department) Taxpayer Identification Numbers (TIN)
 * - IRD Value Added Tax (VAT) registration numbers
 */

const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * Validates and normalizes multi-tenant tenant identifier slug.
 * Allowed: lowercase alphanumeric characters and hyphens, 3 to 64 characters long.
 */
export function validateTenantId(tenantId: unknown): Result<string, DomainError> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Tenant ID must be a non-empty string");
  }
  const normalized = tenantId.trim().toLowerCase();
  if (!TENANT_ID_REGEX.test(normalized)) {
    return domainErr(
      "VALIDATION_FAILED",
      "Tenant ID must be 3-64 lowercase alphanumeric characters or hyphens (e.g. 'cinnamon-grand-cmb')",
      { tenantId: normalized },
    );
  }
  return ok(normalized);
}

// Sri Lankan Mobile Operators: Dialog (74, 76, 77), Mobitel (70, 71), Hutch (72, 78), Airtel (75)
const SL_MOBILE_REGEX = /^(?:\+94|0094|0)?(7[01245678]\d{7})$/;

/**
 * Validates and canonicalizes Sri Lankan mobile numbers across Dialog, Mobitel, Hutch, and Airtel.
 * Returns normalized E.164 string format: `+947XXXXXXXX`.
 */
export function validateSriLankanMobile(mobile: unknown): Result<string, DomainError> {
  if (typeof mobile !== "string" || mobile.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Mobile number must be a non-empty string");
  }
  // Strip whitespace, hyphens, and parentheses
  const cleaned = mobile.trim().replace(/[\s\-()]/g, "");
  const match = SL_MOBILE_REGEX.exec(cleaned);
  if (!match || !match[1]) {
    return domainErr(
      "VALIDATION_FAILED",
      "Invalid Sri Lankan mobile number. Expected 9 digits starting with 07X or +947X",
      { input: mobile },
    );
  }
  return ok(`+94${match[1]}`);
}

const OLD_NIC_REGEX = /^(\d{9})([vVxX])$/;
const NEW_NIC_REGEX = /^\d{12}$/;

/**
 * Validates Sri Lankan National Identity Card (NIC).
 * Supports both Old format (9 digits + V/X) and New format (12 numeric digits).
 */
export function validateSriLankanNic(nic: unknown): Result<string, DomainError> {
  if (typeof nic !== "string" || nic.trim() === "") {
    return domainErr("INVALID_NIC", "NIC number must be a non-empty string");
  }
  const trimmed = nic.trim().toUpperCase();

  const oldMatch = OLD_NIC_REGEX.exec(trimmed);
  if (oldMatch) {
    return ok(trimmed);
  }

  if (NEW_NIC_REGEX.test(trimmed)) {
    return ok(trimmed);
  }

  return domainErr(
    "INVALID_NIC",
    "Invalid Sri Lankan NIC. Must be 9 digits followed by V/X or modern 12 digits",
    { nic: trimmed },
  );
}

const SLTDA_REG_REGEX = /^SLTDA\/(?:SQA\/)?[A-Z0-9_\-\/]{3,30}$/i;

/**
 * Validates Sri Lanka Tourism Development Authority (SLTDA) registration license number.
 * Example: `SLTDA/SQA/HOTEL/00123` or `SLTDA/PRO/987`.
 */
export function validateSltdaRegNo(regNo: unknown): Result<string, DomainError> {
  if (typeof regNo !== "string" || regNo.trim() === "") {
    return domainErr("VALIDATION_FAILED", "SLTDA registration number must be a non-empty string");
  }
  const trimmed = regNo.trim().toUpperCase();
  if (!SLTDA_REG_REGEX.test(trimmed)) {
    return domainErr(
      "VALIDATION_FAILED",
      "Invalid SLTDA registration number format (e.g. 'SLTDA/SQA/HOTEL/00123')",
      { regNo: trimmed },
    );
  }
  return ok(trimmed);
}

const IRD_TIN_REGEX = /^\d{9,10}$/;

/**
 * Validates Inland Revenue Department (IRD) Taxpayer Identification Number (TIN).
 * Expected: 9 or 10 numeric digits.
 */
export function validateIrdTin(tin: unknown): Result<string, DomainError> {
  if (typeof tin !== "string" || tin.trim() === "") {
    return domainErr(
      "VALIDATION_FAILED",
      "IRD TIN must be a non-empty string of 9 or 10 numeric digits",
    );
  }
  const trimmed = tin.trim();
  if (!IRD_TIN_REGEX.test(trimmed)) {
    return domainErr("VALIDATION_FAILED", "Invalid IRD TIN. Must be 9 or 10 digits", {
      tin: trimmed,
    });
  }
  return ok(trimmed);
}

const IRD_VAT_REGEX = /^\d{9}(?:-7000)?$/;

/**
 * Validates Inland Revenue Department (IRD) VAT registration number.
 * Format: 9 digits with optional branch suffix `-7000`.
 */
export function validateIrdVatRegNo(vatNo: unknown): Result<string, DomainError> {
  if (typeof vatNo !== "string" || vatNo.trim() === "") {
    return domainErr("VALIDATION_FAILED", "IRD VAT number must be a non-empty string");
  }
  const trimmed = vatNo.trim();
  if (!IRD_VAT_REGEX.test(trimmed)) {
    return domainErr(
      "VALIDATION_FAILED",
      "Invalid IRD VAT number format. Must be 9 digits (e.g. '123456789' or '123456789-7000')",
      { vatNo: trimmed },
    );
  }
  return ok(trimmed);
}
