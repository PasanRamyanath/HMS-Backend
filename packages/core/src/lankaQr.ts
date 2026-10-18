/**
 * @hms/core - LankaQR & EMVCo QR Code Financial Cryptography Engine.
 *
 * Implements Central Bank of Sri Lanka (CBSL) LankaQR & EMVCo Merchant-Presented
 * Mode (MPM) QR standard specifications.
 *
 * EMVCo Tag 63 Checksum Standard:
 * - CRC-16/CCITT-FALSE
 * - Polynomial: 0x1021 (x^16 + x^12 + x^5 + 1)
 * - Initial Value: 0xFFFF
 * - RefIn: false, RefOut: false, XorOut: 0x0000
 * - Output: 4-character uppercase hexadecimal string
 */

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
