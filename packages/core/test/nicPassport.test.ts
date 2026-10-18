import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createNicVerificationAuditEntry,
  createPassportVerificationAuditEntry,
  parseSriLankaNic,
  validateForeignPassport,
} from "../src/nicPassport.js";

describe("Sri Lankan NIC Parser (parseSriLankaNic)", () => {
  describe("Old 9-digit + V/X Format", () => {
    it("parses 1990s male voter NIC (e.g., 921541234V)", () => {
      // 92 -> 1992
      // 154 -> Male (<= 500)
      // Day 154:
      // Jan: 31, Feb: 29, Mar: 31, Apr: 30, May: 31
      // 31 + 29 + 31 + 30 = 121 days before May
      // 154 - 121 = 33 -> May has 31 days -> 154 - 152 = 2 (June 2)
      // June 2, 1992
      const result = parseSriLankaNic("921541234v");
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const nic = result.value;
      assert.equal(nic.format, "OLD_9_DIGIT");
      assert.equal(nic.canonicalNic, "921541234V");
      assert.equal(nic.birthYear, 1992);
      assert.equal(nic.gender, "MALE");
      assert.equal(nic.dayOfYear, 154);
      assert.equal(nic.birthMonth, 6);
      assert.equal(nic.birthDay, 2);
      assert.equal(nic.dateOfBirthIso, "1992-06-02");
      assert.equal(nic.isVoterEligible, true);
      assert.equal(nic.residencyTier, "RESIDENT_LKR");
    });

    it("parses female non-voter NIC (e.g., 856540987X with +500 day code)", () => {
      // 85 -> 1985
      // 654 -> Female (> 500), dayOfYear = 654 - 500 = 154
      // June 2, 1985
      // 'X' -> isVoterEligible = false
      const result = parseSriLankaNic("856540987x");
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const nic = result.value;
      assert.equal(nic.format, "OLD_9_DIGIT");
      assert.equal(nic.canonicalNic, "856540987X");
      assert.equal(nic.birthYear, 1985);
      assert.equal(nic.gender, "FEMALE");
      assert.equal(nic.dayOfYear, 154);
      assert.equal(nic.birthMonth, 6);
      assert.equal(nic.birthDay, 2);
      assert.equal(nic.dateOfBirthIso, "1985-06-02");
      assert.equal(nic.isVoterEligible, false);
      assert.equal(nic.residencyTier, "RESIDENT_LKR");
    });

    it("correctly calculates leap year birthday (Feb 29 -> day 60)", () => {
      // Day 60: Jan (31) + Feb (29) = 60 -> Feb 29
      const result = parseSriLankaNic("960601234V");
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const nic = result.value;
      assert.equal(nic.birthMonth, 2);
      assert.equal(nic.birthDay, 29);
      assert.equal(nic.dateOfBirthIso, "1996-02-29");
    });

    it("parses early calendar boundaries (Jan 1, Feb 1, Mar 1)", () => {
      // Day 001 -> Jan 1
      const jan1 = parseSriLankaNic("900011234V");
      assert.equal(jan1.ok, true);
      if (jan1.ok) {
        assert.equal(jan1.value.dateOfBirthIso, "1990-01-01");
      }

      // Day 032 -> Feb 1
      const feb1 = parseSriLankaNic("900321234V");
      assert.equal(feb1.ok, true);
      if (feb1.ok) {
        assert.equal(feb1.value.dateOfBirthIso, "1990-02-01");
      }

      // Day 061 -> Mar 1
      const mar1 = parseSriLankaNic("900611234V");
      assert.equal(mar1.ok, true);
      if (mar1.ok) {
        assert.equal(mar1.value.dateOfBirthIso, "1990-03-01");
      }
    });

    it("parses year-end calendar boundaries (Dec 31 male & female)", () => {
      // Day 366 -> Dec 31
      const dec31 = parseSriLankaNic("903661234V");
      assert.equal(dec31.ok, true);
      if (dec31.ok) {
        assert.equal(dec31.value.dateOfBirthIso, "1990-12-31");
      }

      // Female Day 866 (366 + 500) -> Dec 31
      const femaleDec31 = parseSriLankaNic("908661234V");
      assert.equal(femaleDec31.ok, true);
      if (femaleDec31.ok) {
        assert.equal(femaleDec31.value.gender, "FEMALE");
        assert.equal(femaleDec31.value.dateOfBirthIso, "1990-12-31");
      }
    });
  });

  describe("Modern 12-digit Format", () => {
    it("parses 2000s male 12-digit NIC (e.g., 200015401234)", () => {
      const result = parseSriLankaNic("200015401234");
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const nic = result.value;
      assert.equal(nic.format, "NEW_12_DIGIT");
      assert.equal(nic.canonicalNic, "200015401234");
      assert.equal(nic.birthYear, 2000);
      assert.equal(nic.gender, "MALE");
      assert.equal(nic.dayOfYear, 154);
      assert.equal(nic.birthMonth, 6);
      assert.equal(nic.birthDay, 2);
      assert.equal(nic.dateOfBirthIso, "2000-06-02");
      assert.equal(nic.isVoterEligible, true);
      assert.equal(nic.residencyTier, "RESIDENT_LKR");
    });

    it("parses 2000s female 12-digit NIC with +500 offset", () => {
      // 200155401234 -> 2001, dayCode 554 -> female, day 54
      // Jan (31) + Feb (23) = 54 -> Feb 23, 2001
      const result = parseSriLankaNic("200155401234");
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const nic = result.value;
      assert.equal(nic.birthYear, 2001);
      assert.equal(nic.gender, "FEMALE");
      assert.equal(nic.dayOfYear, 54);
      assert.equal(nic.birthMonth, 2);
      assert.equal(nic.birthDay, 23);
      assert.equal(nic.dateOfBirthIso, "2001-02-23");
    });

    it("parses modern 12-digit boundaries (Jan 1 and Dec 31)", () => {
      const jan1 = parseSriLankaNic("199500101234");
      assert.equal(jan1.ok, true);
      if (jan1.ok) {
        assert.equal(jan1.value.dateOfBirthIso, "1995-01-01");
      }

      const dec31 = parseSriLankaNic("200586601234");
      assert.equal(dec31.ok, true);
      if (dec31.ok) {
        assert.equal(dec31.value.gender, "FEMALE");
        assert.equal(dec31.value.dateOfBirthIso, "2005-12-31");
      }
    });
  });

  describe("Validation & Errors", () => {
    it("rejects invalid format strings", () => {
      const invalid = ["123", "921541234A", "20001540123", "ABC123456V", ""];
      for (const val of invalid) {
        const res = parseSriLankaNic(val);
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.error.code, "INVALID_NIC");
        }
      }
    });

    it("rejects invalid day of year code exceeding 366 (or > 866 for female)", () => {
      // Day 000 (invalid)
      const res0 = parseSriLankaNic("920001234V");
      assert.equal(res0.ok, false);

      // Day 500 (female day 0, invalid)
      const res500 = parseSriLankaNic("925001234V");
      assert.equal(res500.ok, false);

      // Day 367 (exceeds 366)
      const res367 = parseSriLankaNic("923671234V");
      assert.equal(res367.ok, false);

      // Day 867 (female exceeds 366)
      const res867 = parseSriLankaNic("928671234V");
      assert.equal(res867.ok, false);

      // 929991234V -> dayCode 999 -> 999 - 500 = 499 > 366 -> INVALID
      const res = parseSriLankaNic("929991234V");
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "INVALID_NIC");
      }
    });
  });

  describe("Audit Log Generation", () => {
    it("creates tamper-proof SHA-256 audit entry for NIC verification", () => {
      const parsedRes = parseSriLankaNic("921541234V");
      assert.equal(parsedRes.ok, true);
      if (!parsedRes.ok) return;

      const auditRes = createNicVerificationAuditEntry(
        "heritance-kandalama",
        "actor-frontdesk-01",
        "GUEST-5501",
        parsedRes.value,
        "2026-10-18T15:00:00.000Z",
      );

      assert.equal(auditRes.ok, true);
      if (!auditRes.ok) return;

      assert.equal(auditRes.value.tenantId, "heritance-kandalama");
      assert.equal(auditRes.value.action, "VERIFY_GUEST_NIC");
      assert.equal(auditRes.value.entityType, "Guest");
      assert.equal(auditRes.value.entryHash.length, 64);
    });
  });

  describe("Foreign Passport & Tourist Police B-Card Validator (validateForeignPassport)", () => {
    it("validates standard foreign tourist passport with FOREIGN_USD_LOCKED tier", () => {
      const result = validateForeignPassport({
        passportNo: "GB12345678",
        countryCode: "GBR",
        arrivalDate: "2026-10-18",
        visaExpiryDate: "2026-11-18",
        tenantId: "jetwing-lighthouse",
        guestId: "GUEST-UK-01",
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      const p = result.value;
      assert.equal(p.canonicalPassportNo, "GB12345678");
      assert.equal(p.canonicalCountryCode, "GBR");
      assert.equal(p.isVisaValid, true);
      assert.equal(p.hasResidentVisa, false);
      assert.equal(p.residencyTier, "FOREIGN_USD_LOCKED");
      assert.equal(p.touristPoliceBCardStatus, "COMPLIANT");
      assert.equal(p.tenantId, "jetwing-lighthouse");
      assert.equal(p.guestId, "GUEST-UK-01");
    });

    it("allocates RESIDENT_LKR tier when guest holds resident visa", () => {
      const result = validateForeignPassport({
        passportNo: "US98765432",
        countryCode: "USA",
        arrivalDate: "2026-01-15",
        visaExpiryDate: "2027-01-15",
        hasResidentVisa: true,
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.hasResidentVisa, true);
      assert.equal(result.value.residencyTier, "RESIDENT_LKR");
      assert.equal(result.value.touristPoliceBCardStatus, "COMPLIANT");
    });

    it("flags expired tourist visa for Tourist Police B-Card reporting", () => {
      const result = validateForeignPassport({
        passportNo: "FR99887766",
        countryCode: "FRA",
        arrivalDate: "2026-10-18",
        visaExpiryDate: "2026-10-10", // expired prior to arrival
        hasResidentVisa: false,
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.isVisaValid, false);
      assert.equal(result.value.touristPoliceBCardStatus, "FLAGGED_VISA_EXPIRED");
    });

    it("rejects invalid passport format or invalid country code", () => {
      const invalidPassport = validateForeignPassport({
        passportNo: "AB", // too short
        countryCode: "USA",
        arrivalDate: "2026-10-18",
        visaExpiryDate: "2026-11-18",
      });
      assert.equal(invalidPassport.ok, false);
      if (!invalidPassport.ok) {
        assert.equal(invalidPassport.error.code, "INVALID_PASSPORT");
      }

      const invalidCountry = validateForeignPassport({
        passportNo: "GB12345678",
        countryCode: "UNITED_STATES", // too long for ISO code
        arrivalDate: "2026-10-18",
        visaExpiryDate: "2026-11-18",
      });
      assert.equal(invalidCountry.ok, false);
      if (!invalidCountry.ok) {
        assert.equal(invalidCountry.error.code, "INVALID_PASSPORT");
      }
    });

    it("creates tamper-proof SHA-256 audit entry for foreign passport verification", () => {
      const pRes = validateForeignPassport({
        passportNo: "DE12345678",
        countryCode: "DEU",
        arrivalDate: "2026-10-18",
        visaExpiryDate: "2026-11-18",
      });
      assert.equal(pRes.ok, true);
      if (!pRes.ok) return;

      const auditRes = createPassportVerificationAuditEntry(
        "cape-weligama",
        "actor-frontdesk-02",
        "GUEST-DE-99",
        pRes.value,
        "2026-10-18T16:00:00.000Z",
      );

      assert.equal(auditRes.ok, true);
      if (!auditRes.ok) return;

      assert.equal(auditRes.value.tenantId, "cape-weligama");
      assert.equal(auditRes.value.action, "VERIFY_FOREIGN_PASSPORT_B_CARD");
      assert.equal(auditRes.value.entryHash.length, 64);
    });
  });
});
