import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateIrdTin,
  validateIrdVatRegNo,
  validateSltdaRegNo,
  validateSriLankanMobile,
  validateSriLankanNic,
  validateTenantId,
} from "../src/config.js";

describe("Tenant & Sri Lankan Statutory Identity Validators", () => {
  describe("validateTenantId", () => {
    it("accepts valid lowercase slug identifiers", () => {
      const res = validateTenantId("cinnamon-grand-cmb");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value, "cinnamon-grand-cmb");
      }
    });

    it("normalizes uppercase and trims whitespace", () => {
      const res = validateTenantId("  HILTON-COLOMBO-01  ");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value, "hilton-colombo-01");
      }
    });

    it("rejects invalid slugs, special characters, and empty strings", () => {
      assert.equal(validateTenantId("").ok, false);
      assert.equal(validateTenantId("ab").ok, false); // too short
      assert.equal(validateTenantId("hotel_with_underscore").ok, false);
      assert.equal(validateTenantId("-hotel-leading-dash").ok, false);
    });
  });

  describe("validateSriLankanMobile", () => {
    it("accepts and canonicalizes Dialog numbers", () => {
      const res1 = validateSriLankanMobile("077 123 4567");
      assert.equal(res1.ok, true);
      if (res1.ok) {
        assert.equal(res1.value, "+94771234567");
      }

      const res2 = validateSriLankanMobile("+94-76-9876543");
      assert.equal(res2.ok, true);
      if (res2.ok) {
        assert.equal(res2.value, "+94769876543");
      }
    });

    it("accepts and canonicalizes Mobitel, Hutch, and Airtel numbers", () => {
      assert.equal(validateSriLankanMobile("0712345678").ok, true); // Mobitel
      assert.equal(validateSriLankanMobile("0782345678").ok, true); // Hutch
      assert.equal(validateSriLankanMobile("0752345678").ok, true); // Airtel
    });

    it("rejects invalid numbers, landlines, and non-Sri Lankan prefixes", () => {
      assert.equal(validateSriLankanMobile("0112345678").ok, false); // Colombo landline
      assert.equal(validateSriLankanMobile("+14155552671").ok, false); // US number
      assert.equal(validateSriLankanMobile("07712345").ok, false); // Short number
      assert.equal(validateSriLankanMobile("").ok, false);
    });
  });

  describe("validateSriLankanNic", () => {
    it("validates old 9-digit + V/X NIC formats", () => {
      const resV = validateSriLankanNic("901234567v");
      assert.equal(resV.ok, true);
      if (resV.ok) {
        assert.equal(resV.value, "901234567V");
      }

      const resX = validateSriLankanNic("851234567X");
      assert.equal(resX.ok, true);
      if (resX.ok) {
        assert.equal(resX.value, "851234567X");
      }
    });

    it("validates modern 12-digit NIC formats", () => {
      const res = validateSriLankanNic("199012345678");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value, "199012345678");
      }
    });

    it("rejects invalid NIC numbers", () => {
      assert.equal(validateSriLankanNic("12345678").ok, false);
      assert.equal(validateSriLankanNic("901234567Z").ok, false);
      assert.equal(validateSriLankanNic("").ok, false);
    });
  });

  describe("validateSltdaRegNo", () => {
    it("validates standard SLTDA license identifiers", () => {
      const res = validateSltdaRegNo("SLTDA/SQA/HOTEL/00123");
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value, "SLTDA/SQA/HOTEL/00123");
      }
    });

    it("rejects invalid SLTDA formats", () => {
      assert.equal(validateSltdaRegNo("INVALID/HOTEL/01").ok, false);
      assert.equal(validateSltdaRegNo("").ok, false);
    });
  });

  describe("validateIrdTin & validateIrdVatRegNo", () => {
    it("validates 9 and 10 digit IRD TIN numbers", () => {
      assert.equal(validateIrdTin("123456789").ok, true);
      assert.equal(validateIrdTin("1234567890").ok, true);
      assert.equal(validateIrdTin("12345").ok, false);
      assert.equal(validateIrdTin("123456789A").ok, false);
    });

    it("validates IRD VAT registration numbers", () => {
      assert.equal(validateIrdVatRegNo("123456789").ok, true);
      assert.equal(validateIrdVatRegNo("123456789-7000").ok, true);
      assert.equal(validateIrdVatRegNo("123456789-8000").ok, false);
      assert.equal(validateIrdVatRegNo("").ok, false);
    });
  });
});
