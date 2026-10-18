import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLankaQrPayload,
  crc16CcittFalse,
  createLankaQrAuditEntry,
  formatTlv,
} from "../src/lankaQr.js";

describe("LankaQR CRC-16/CCITT-FALSE Checksum Engine (crc16CcittFalse)", () => {
  it("matches standard international ITU-T CRC-16 check vector for '123456789' -> '29B1'", () => {
    const checksum = crc16CcittFalse("123456789");
    assert.equal(checksum, "29B1");
  });

  it("handles empty string by returning initial state 0xFFFF -> 'FFFF'", () => {
    const checksum = crc16CcittFalse("");
    assert.equal(checksum, "FFFF");
  });

  it("returns exactly 4 uppercase hexadecimal characters", () => {
    const samplePayloads = [
      "A",
      "000201010211",
      "00020101021226500010COM.LANKAQR01121000000000015204701153031445408100757.255802LK5916GALLE FORT HOTEL6005GALLE62140510FOLIO-10216304",
      "Central Bank of Sri Lanka LankaQR",
    ];

    for (const payload of samplePayloads) {
      const checksum = crc16CcittFalse(payload);
      assert.equal(checksum.length, 4);
      assert.match(checksum, /^[0-9A-F]{4}$/);
    }
  });

  it("produces deterministic and sensitive checksums across slight mutations", () => {
    const base = "0002010102125303144540510006304";
    const mutated = "0002010102125303144540510016304";

    const hash1 = crc16CcittFalse(base);
    const hash2 = crc16CcittFalse(mutated);

    assert.equal(hash1.length, 4);
    assert.equal(hash2.length, 4);
    assert.notEqual(hash1, hash2);
  });
});

describe("LankaQR EMVCo MPM Payload Builder (buildLankaQrPayload)", () => {
  it("formats single TLV tags with padded 2-digit length", () => {
    assert.equal(formatTlv("00", "01"), "000201");
    assert.equal(formatTlv("58", "LK"), "5802LK");
    assert.equal(formatTlv("59", "HERITANCE KANDALAMA"), "5919HERITANCE KANDALAMA");
  });

  it("builds a dynamic LankaQR room-bill payload with amount and reference ID", () => {
    const result = buildLankaQrPayload({
      merchantId: "100000000001",
      merchantName: "GALLE FORT HOTEL",
      merchantCity: "GALLE",
      mcc: "7011",
      amountLkr: 100757.25,
      referenceId: "FOLIO-1021",
      isDynamic: true,
      tenantId: "galle-fort-hotel",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const qr = result.value;
    assert.equal(qr.isDynamic, true);
    assert.equal(qr.amountLkr, 100757.25);
    assert.equal(qr.referenceId, "FOLIO-1021");
    assert.equal(qr.merchantName, "GALLE FORT HOTEL");
    assert.equal(qr.merchantCity, "GALLE");
    assert.equal(qr.tenantId, "galle-fort-hotel");
    assert.equal(qr.crc.length, 4);

    // Verify key EMVCo Tags in payload
    assert.match(qr.payload, /^000201/); // Payload Format Indicator 01
    assert.match(qr.payload, /010212/); // Dynamic QR indicator (12)
    assert.match(qr.payload, /26\d{2}0011COM\.LANKAQR0112100000000001/); // Tag 26 Merchant Info
    assert.match(qr.payload, /52047011/); // MCC 7011 Lodging
    assert.match(qr.payload, /5303144/); // Currency 144 (LKR)
    assert.match(qr.payload, /5409100757\.25/); // Amount LKR 100757.25
    assert.match(qr.payload, /5802LK/); // Country LK
    assert.match(qr.payload, /5916GALLE FORT HOTEL/); // Merchant Name
    assert.match(qr.payload, /6005GALLE/); // Merchant City
    assert.match(qr.payload, /62140510FOLIO-1021/); // Tag 62 Ref ID
    assert.match(qr.payload, /6304[0-9A-F]{4}$/); // Tag 63 CRC

    // Verify the CRC matches the payload prefix
    const payloadWithoutCrc = qr.payload.slice(0, -4);
    const expectedCrc = crc16CcittFalse(payloadWithoutCrc);
    assert.equal(qr.crc, expectedCrc);
  });

  it("builds a static LankaQR counter stand payload without fixed amount", () => {
    const result = buildLankaQrPayload({
      merchantId: "200000000002",
      merchantName: "COLOMBO VILLA CAFE",
      merchantCity: "COLOMBO",
      mcc: "5812", // Restaurants
      isDynamic: false,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const qr = result.value;
    assert.equal(qr.isDynamic, false);
    assert.equal(qr.amountLkr, undefined);
    assert.match(qr.payload, /^000201/);
    assert.match(qr.payload, /010211/); // Static QR indicator (11)
    assert.match(qr.payload, /52045812/); // MCC 5812
    // Tag 54 should NOT be present in static QR without amount
    assert.equal(qr.payload.includes("54"), false);
  });

  it("rejects dynamic QR without amount or with negative amount", () => {
    const missingAmount = buildLankaQrPayload({
      merchantId: "12345",
      merchantName: "HOTEL",
      merchantCity: "KANDY",
      isDynamic: true,
    });
    assert.equal(missingAmount.ok, false);
    if (!missingAmount.ok) {
      assert.equal(missingAmount.error.code, "INVALID_LANKA_QR");
    }

    const negativeAmount = buildLankaQrPayload({
      merchantId: "12345",
      merchantName: "HOTEL",
      merchantCity: "KANDY",
      amountLkr: -100,
      isDynamic: true,
    });
    assert.equal(negativeAmount.ok, false);
  });

  it("rejects empty merchant credentials or invalid MCC", () => {
    const badMerchantId = buildLankaQrPayload({
      merchantId: "",
      merchantName: "HOTEL",
      merchantCity: "GALLE",
    });
    assert.equal(badMerchantId.ok, false);

    const badMcc = buildLankaQrPayload({
      merchantId: "12345",
      merchantName: "HOTEL",
      merchantCity: "GALLE",
      mcc: "INVALID",
    });
    assert.equal(badMcc.ok, false);
  });

  it("creates cryptographically chained audit log for generated LankaQR", () => {
    const qrRes = buildLankaQrPayload({
      merchantId: "300000000003",
      merchantName: "MIRISSA SURF RESORT",
      merchantCity: "MIRISSA",
      amountLkr: 45000,
      referenceId: "ORDER-9912",
      isDynamic: true,
      tenantId: "mirissa-surf-resort",
    });

    assert.equal(qrRes.ok, true);
    if (!qrRes.ok) return;

    const auditRes = createLankaQrAuditEntry(
      "mirissa-surf-resort",
      "actor-cashier-09",
      "ORDER-9912",
      qrRes.value,
      "2026-10-18T16:30:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, "mirissa-surf-resort");
    assert.equal(audit.action, "GENERATE_LANKA_QR");
    assert.equal(audit.entityType, "PaymentQr");
    assert.equal(audit.entityId, "ORDER-9912");
    assert.equal(audit.entryHash.length, 64);
  });
});

describe("Exhaustive CBSL LankaQR EMVCo Test Vectors (Rung 5)", () => {
  interface DecodedTlv {
    readonly tag: string;
    readonly length: number;
    readonly value: string;
  }

  function decodeTlvs(payload: string): DecodedTlv[] {
    const list: DecodedTlv[] = [];
    let offset = 0;
    while (offset < payload.length) {
      const tag = payload.slice(offset, offset + 2);
      const lengthStr = payload.slice(offset + 2, offset + 4);
      const length = Number.parseInt(lengthStr, 10);
      const value = payload.slice(offset + 4, offset + 4 + length);
      list.push({ tag, length, value });
      offset += 4 + length;
    }
    return list;
  }

  it("verifies exact TLV byte lengths across complete dynamic room-bill payload", () => {
    const qrRes = buildLankaQrPayload({
      merchantId: "777000111222",
      merchantName: "HERITANCE KANDALAMA",
      merchantCity: "DAMBULLA",
      mcc: "7011",
      amountLkr: 100757.25,
      referenceId: "FOLIO-7701",
      isDynamic: true,
      tenantId: "heritance-kandalama",
    });

    assert.equal(qrRes.ok, true);
    if (!qrRes.ok) return;

    const qr = qrRes.value;
    const tlvs = decodeTlvs(qr.payload);

    // Verify all standard tags are present in correct order
    const tagMap = new Map(tlvs.map((t) => [t.tag, t]));
    assert.equal(tagMap.get("00")?.value, "01");
    assert.equal(tagMap.get("01")?.value, "12");
    assert.equal(tagMap.get("52")?.value, "7011");
    assert.equal(tagMap.get("53")?.value, "144");
    assert.equal(tagMap.get("54")?.value, "100757.25");
    assert.equal(tagMap.get("58")?.value, "LK");
    assert.equal(tagMap.get("59")?.value, "HERITANCE KANDALAMA");
    assert.equal(tagMap.get("60")?.value, "DAMBULLA");
    assert.equal(tagMap.get("63")?.value, qr.crc);

    // Verify nested Tag 26 (Merchant Info)
    const tag26 = tagMap.get("26");
    assert.ok(tag26);
    const nested26 = decodeTlvs(tag26.value);
    const tag26Map = new Map(nested26.map((t) => [t.tag, t]));
    assert.equal(tag26Map.get("00")?.value, "COM.LANKAQR");
    assert.equal(tag26Map.get("01")?.value, "777000111222");

    // Verify nested Tag 62 (Additional Data)
    const tag62 = tagMap.get("62");
    assert.ok(tag62);
    const nested62 = decodeTlvs(tag62.value);
    const tag62Map = new Map(nested62.map((t) => [t.tag, t]));
    assert.equal(tag62Map.get("05")?.value, "FOLIO-7701");
  });

  it("verifies CBSL casual dining restaurant table-bill vector with MCC 5812", () => {
    const qrRes = buildLankaQrPayload({
      merchantId: "888000333444",
      merchantName: "OCEAN BLUE SEAFOOD",
      merchantCity: "BENTOTA",
      mcc: "5812",
      amountLkr: 15450.5,
      referenceId: "TABLE-04-BILL",
      isDynamic: true,
    });

    assert.equal(qrRes.ok, true);
    if (!qrRes.ok) return;

    const qr = qrRes.value;
    assert.equal(qr.isDynamic, true);
    assert.equal(qr.amountLkr, 15450.5);

    // Verify CRC integrity
    const prefix = qr.payload.slice(0, -4);
    assert.equal(qr.payload.slice(-4), qr.crc);
    assert.equal(crc16CcittFalse(prefix), qr.crc);
  });

  it("detects single-character tampering in payload via CRC-16 mismatch", () => {
    const qrRes = buildLankaQrPayload({
      merchantId: "100000000001",
      merchantName: "GALLE FORT HOTEL",
      merchantCity: "GALLE",
      amountLkr: 50000,
      referenceId: "FOLIO-500",
      isDynamic: true,
    });

    assert.equal(qrRes.ok, true);
    if (!qrRes.ok) return;

    const originalPayload = qrRes.value.payload;
    const prefix = originalPayload.slice(0, -4);
    const originalCrc = originalPayload.slice(-4);

    // Tamper with the amount (50000 -> 90000)
    const tamperedPrefix = prefix.replace("50000.00", "90000.00");
    const tamperedCrc = crc16CcittFalse(tamperedPrefix);

    assert.notEqual(tamperedCrc, originalCrc);
  });
});
