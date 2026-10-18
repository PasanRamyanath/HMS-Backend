/**
 * @hms/core - LankaQR & EMVCo QR Code Financial Cryptography Engine.
 *
 * Implements Central Bank of Sri Lanka (CBSL) LankaQR & EMVCo Merchant-Presented
 * Mode (MPM) QR standard specifications:
 * - Pure TLV (Tag-Length-Value) string builder
 * - Tag 00: Payload Format Indicator ("01")
 * - Tag 01: Point of Initiation Method ("11" static, "12" dynamic)
 * - Tag 26: Merchant Account Information (GUI: "COM.LANKAQR", Merchant ID)
 * - Tag 52: Merchant Category Code (MCC, e.g. "7011" Hotels, "5812" Restaurants)
 * - Tag 53: Transaction Currency ("144" for Sri Lankan Rupees)
 * - Tag 54: Transaction Amount (dynamic payment amount with integer-cent precision)
 * - Tag 58: Country Code ("LK")
 * - Tag 59: Merchant Name (up to 25 characters)
 * - Tag 60: Merchant City (up to 15 characters)
 * - Tag 62: Additional Data Field Template (subtag 05: Reference ID / Folio ID)
 * - Tag 63: CRC-16/CCITT-FALSE Checksum (4 uppercase hexadecimal characters)
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

/**
 * Formats a single EMVCo Tag-Length-Value (TLV) block.
 *
 * @param tagId 2-character tag identifier (e.g. "00", "01", "26")
 * @param value String value payload
 * @returns Concatenated TLV string: ID + 2-digit Length + Value
 */
export function formatTlv(tagId: string, value: string): string {
  const lenStr = String(value.length).padStart(2, "0");
  return `${tagId}${lenStr}${value}`;
}

/**
 * Computes the 16-bit CRC-16/CCITT-FALSE checksum over an ASCII/UTF-8 string payload.
 * Returns an uppercase 4-character hexadecimal representation required by EMVCo Tag 63.
 *
 * Standard Check Vector:
 * Input: "123456789" -> Output: "29B1"
 *
 * @param payload Input string payload to compute checksum over
 * @returns 4-character uppercase hexadecimal CRC-16 string
 */
export function crc16CcittFalse(payload: string): string {
  let crc = 0xffff;
  const len = payload.length;

  for (let i = 0; i < len; i++) {
    const charCode = payload.charCodeAt(i) & 0xff;
    crc ^= charCode << 8;

    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return (crc >>> 0).toString(16).toUpperCase().padStart(4, "0");
}

export interface LankaQrPayloadInput {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly merchantCity: string;
  readonly mcc?: string | undefined;
  readonly gui?: string | undefined;
  readonly amountLkr?: number | undefined;
  readonly referenceId?: string | undefined;
  readonly isDynamic?: boolean | undefined;
  readonly tenantId?: string | undefined;
}

export interface GeneratedLankaQr {
  readonly payload: string;
  readonly crc: string;
  readonly isDynamic: boolean;
  readonly amountLkr?: number | undefined;
  readonly referenceId?: string | undefined;
  readonly merchantName: string;
  readonly merchantCity: string;
  readonly tenantId?: string | undefined;
}

const MCC_REGEX = /^\d{4}$/;

function validateMerchantInputs(input: LankaQrPayloadInput): Result<void, DomainError> {
  if (!input.merchantId || typeof input.merchantId !== "string" || input.merchantId.trim() === "") {
    return domainErr("INVALID_LANKA_QR", "merchantId must be a non-empty string");
  }
  if (
    !input.merchantName ||
    typeof input.merchantName !== "string" ||
    input.merchantName.trim() === ""
  ) {
    return domainErr("INVALID_LANKA_QR", "merchantName must be a non-empty string");
  }
  if (
    !input.merchantCity ||
    typeof input.merchantCity !== "string" ||
    input.merchantCity.trim() === ""
  ) {
    return domainErr("INVALID_LANKA_QR", "merchantCity must be a non-empty string");
  }
  const mcc = input.mcc ?? "7011";
  if (!MCC_REGEX.test(mcc)) {
    return domainErr("INVALID_LANKA_QR", "MCC must be 4 numeric digits (e.g. '7011')", { mcc });
  }
  return ok(undefined);
}

function validateAmount(
  amountLkr: number | undefined,
  isDynamic: boolean,
): Result<number | undefined, DomainError> {
  if (isDynamic) {
    if (amountLkr === undefined || !Number.isFinite(amountLkr) || amountLkr <= 0) {
      return domainErr(
        "INVALID_LANKA_QR",
        "Dynamic LankaQR requires a positive finite transaction amount",
        { amountLkr },
      );
    }
    return ok(roundLkr(amountLkr));
  }

  if (amountLkr !== undefined) {
    if (!Number.isFinite(amountLkr) || amountLkr < 0) {
      return domainErr("INVALID_LANKA_QR", "amountLkr must be a non-negative finite number", {
        amountLkr,
      });
    }
    return ok(roundLkr(amountLkr));
  }

  return ok(undefined);
}

/**
 * Generates a fully compliant LankaQR EMVCo Merchant-Presented Mode (MPM) QR payload.
 */
export function buildLankaQrPayload(
  input: LankaQrPayloadInput,
): Result<GeneratedLankaQr, DomainError> {
  const valRes = validateMerchantInputs(input);
  if (!valRes.ok) {
    return valRes;
  }

  let validatedTenantId: string | undefined;
  if (input.tenantId !== undefined) {
    const tenantRes = validateTenantId(input.tenantId);
    if (!tenantRes.ok) {
      return tenantRes;
    }
    validatedTenantId = tenantRes.value;
  }

  const isDynamic = input.isDynamic ?? input.amountLkr !== undefined;
  const amountRes = validateAmount(input.amountLkr, isDynamic);
  if (!amountRes.ok) {
    return amountRes;
  }
  const validatedAmount = amountRes.value;

  const gui = input.gui ?? "COM.LANKAQR";
  const mcc = input.mcc ?? "7011";
  const cleanName = input.merchantName.trim().slice(0, 25);
  const cleanCity = input.merchantCity.trim().slice(0, 15);

  // Tag 00: Payload Format Indicator (Fixed "01")
  let buffer = formatTlv("00", "01");

  // Tag 01: Point of Initiation Method ("12" dynamic, "11" static)
  buffer += formatTlv("01", isDynamic ? "12" : "11");

  // Tag 26: Merchant Account Information template
  const subtag00 = formatTlv("00", gui);
  const subtag01 = formatTlv("01", input.merchantId.trim());
  buffer += formatTlv("26", `${subtag00}${subtag01}`);

  // Tag 52: Merchant Category Code (MCC)
  buffer += formatTlv("52", mcc);

  // Tag 53: Transaction Currency (ISO 4217 numeric "144" for LKR)
  buffer += formatTlv("53", "144");

  // Tag 54: Transaction Amount (if present)
  if (validatedAmount !== undefined) {
    buffer += formatTlv("54", validatedAmount.toFixed(2));
  }

  // Tag 58: Country Code ("LK")
  buffer += formatTlv("58", "LK");

  // Tag 59: Merchant Name
  buffer += formatTlv("59", cleanName);

  // Tag 60: Merchant City
  buffer += formatTlv("60", cleanCity);

  // Tag 62: Additional Data Field Template (subtag 05: Reference ID)
  if (input.referenceId && input.referenceId.trim() !== "") {
    const subtag05 = formatTlv("05", input.referenceId.trim());
    buffer += formatTlv("62", subtag05);
  }

  // Tag 63: Checksum prefix ("6304")
  const prefixForChecksum = `${buffer}6304`;
  const crc = crc16CcittFalse(prefixForChecksum);
  const finalPayload = `${prefixForChecksum}${crc}`;

  return ok({
    payload: finalPayload,
    crc,
    isDynamic,
    amountLkr: validatedAmount,
    referenceId: input.referenceId?.trim(),
    merchantName: cleanName,
    merchantCity: cleanCity,
    tenantId: validatedTenantId,
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for LankaQR code generation.
 */
export function createLankaQrAuditEntry(
  tenantId: string,
  actorUserId: string,
  referenceId: string,
  qr: GeneratedLankaQr,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    referenceId,
    crc: qr.crc,
    isDynamic: qr.isDynamic,
    amountLkr: qr.amountLkr,
    merchantName: qr.merchantName,
    merchantCity: qr.merchantCity,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "GENERATE_LANKA_QR",
    entityType: "PaymentQr",
    entityId: referenceId,
    isoTs,
    afterJson,
    prevHash,
  });
}
