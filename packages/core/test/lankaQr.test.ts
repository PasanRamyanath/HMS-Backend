import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc16CcittFalse } from "../src/lankaQr.js";

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
