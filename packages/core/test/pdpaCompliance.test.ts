import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENESIS_HASH } from "../src/auditChain.js";
import {
  type GuestPiiRecord,
  type PdpaAnonymizationRequest,
  type StayFolioTaxRecord,
  anonymizeGuestPii,
  exportTenantPdpaArchive,
  validatePdpaAuthorization,
  verifyStatutoryTaxPreservation,
} from "../src/pdpaCompliance.js";

describe("Step 460 & 461 (Phase 19.10 & 19.11): Sri Lanka PDPA No. 9 of 2022 Guest PII Anonymization (pdpaCompliance.ts)", () => {
  const tenantId = "tenant-galle-boutique";

  const sampleGuest: GuestPiiRecord = {
    guestId: "guest-lka-9842",
    tenantId,
    fullName: "Kamal Wickramasinghe",
    nicOrPassport: "198812304567",
    phone: "+94771234567",
    email: "kamal.w@example.lk",
    signatureUrl: "https://s3.ap-south-1.amazonaws.com/hms-media/signatures/guest-9842.webp",
    nationalityIso: "LKA",
    isSriLankanResident: true,
    emergencyContactPhone: "+94719876543",
    dietaryNotes: "Strict Vegetarian, No Garlic",
    roomNumber: "Ocean Suite 104",
  };

  const foreignGuest: GuestPiiRecord = {
    guestId: "guest-uk-5011",
    tenantId,
    fullName: "Arthur Pendelton",
    nicOrPassport: "GBR948271049",
    phone: "+447911123456",
    email: "arthur.p@example.co.uk",
    signatureUrl: "https://s3.ap-south-1.amazonaws.com/hms-media/signatures/guest-5011.webp",
    nationalityIso: "GBR",
    isSriLankanResident: false,
    emergencyContactPhone: "+447911999888",
    roomNumber: "Heritage Villa 02",
  };

  const sampleFolios: ReadonlyArray<StayFolioTaxRecord> = [
    {
      folioId: "folio-2026-1049",
      guestId: "guest-lka-9842",
      tenantId,
      checkInDate: "2026-10-10",
      checkOutDate: "2026-10-13",
      nationalityIso: "LKA",
      isSriLankanResident: true,
      baseRoomChargeLkr: 60000,
      foodAndBeverageLkr: 18500,
      serviceChargeLkr: 7850, // 10%
      tdlLkr: 863.5, // 1%
      ssclLkr: 2177.84, // 2.5%
      vatLkr: 16072.44, // 18%
      totalPaidLkr: 105463.78,
    },
    {
      folioId: "folio-2026-1050",
      guestId: "guest-uk-5011",
      tenantId,
      checkInDate: "2026-10-12",
      checkOutDate: "2026-10-16",
      nationalityIso: "GBR",
      isSriLankanResident: false,
      baseRoomChargeLkr: 120000,
      foodAndBeverageLkr: 32000,
      serviceChargeLkr: 15200,
      tdlLkr: 1672,
      ssclLkr: 4216.8,
      vatLkr: 31120.34,
      totalPaidLkr: 204209.14,
    },
  ];

  const validErasureRequest: PdpaAnonymizationRequest = {
    requestId: "req-pdpa-2026-001",
    tenantId,
    guestId: "guest-lka-9842",
    requestedByUserId: "user-gm-01",
    actorRole: "GENERAL_MANAGER",
    requestDateIso: "2026-10-21T10:00:00.000Z",
    legalBasis: "RIGHT_TO_ERASURE",
    notes: "Guest formally invoked Section 14 Right to Erasure via email.",
  };

  describe("1. Guest PII Redaction & Field Scrubbing", () => {
    it("scrubs fullName, nicOrPassport, phone, email, and signatureUrl", () => {
      const res = anonymizeGuestPii(sampleGuest, validErasureRequest, sampleFolios);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const { anonymizedRecord } = res.value;
        assert.strictEqual(anonymizedRecord.fullName, "[REDACTED - PDPA NO. 9 OF 2022]");
        assert.strictEqual(anonymizedRecord.nicOrPassport, "[REDACTED]");
        assert.strictEqual(anonymizedRecord.phone, "[REDACTED]");
        assert.strictEqual(anonymizedRecord.email, "[REDACTED]");
        assert.strictEqual(anonymizedRecord.signatureUrl, "");
        assert.strictEqual(anonymizedRecord.isAnonymized, true);
        assert.strictEqual(anonymizedRecord.legalBasis, "RIGHT_TO_ERASURE");
      }
    });

    it("leaves original guestId intact to preserve relational integrity without PII", () => {
      const res = anonymizeGuestPii(sampleGuest, validErasureRequest, sampleFolios);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.anonymizedRecord.guestId, sampleGuest.guestId);
      }
    });
  });

  describe("2. Statutory SLTDA & IRD Record Preservation Invariants", () => {
    it("preserves nationalityIso (LKA/GBR) for mandatory SLTDA Tourism Act statistics", () => {
      const res = anonymizeGuestPii(sampleGuest, validErasureRequest, sampleFolios);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.anonymizedRecord.nationalityIso, "LKA");
      }

      const foreignReq: PdpaAnonymizationRequest = {
        ...validErasureRequest,
        guestId: foreignGuest.guestId,
      };
      const foreignRes = anonymizeGuestPii(foreignGuest, foreignReq, sampleFolios);
      assert.strictEqual(foreignRes.ok, true);
      if (foreignRes.ok) {
        assert.strictEqual(foreignRes.value.anonymizedRecord.nationalityIso, "GBR");
      }
    });

    it("preserves isSriLankanResident boolean for Inland Revenue Department tax audits", () => {
      const res = anonymizeGuestPii(sampleGuest, validErasureRequest, sampleFolios);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.anonymizedRecord.isSriLankanResident, true);
      }

      const foreignReq: PdpaAnonymizationRequest = {
        ...validErasureRequest,
        guestId: foreignGuest.guestId,
      };
      const foreignRes = anonymizeGuestPii(foreignGuest, foreignReq, sampleFolios);
      assert.strictEqual(foreignRes.ok, true);
      if (foreignRes.ok) {
        assert.strictEqual(foreignRes.value.anonymizedRecord.isSriLankanResident, false);
      }
    });

    it("preserves associated stay folios and calculates exact preserved statutory taxes", () => {
      const res = anonymizeGuestPii(sampleGuest, validErasureRequest, sampleFolios);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.preservedFolioCount, 1);
        // SC (7850) + TDL (863.5) + SSCL (2177.84) + VAT (16072.44) = 26963.78 LKR
        assert.strictEqual(res.value.preservedTotalTaxLkr, 26963.78);
      }
    });

    it("verifyStatutoryTaxPreservation verifies financial records were not altered", () => {
      const check = verifyStatutoryTaxPreservation(sampleFolios, sampleFolios);
      assert.strictEqual(check.ok, true);
    });

    it("verifyStatutoryTaxPreservation rejects altered tax records", () => {
      const firstFolio = sampleFolios[0];
      assert.ok(firstFolio);
      const tamperedFolios = [
        {
          ...firstFolio,
          vatLkr: 0, // Maliciously zeroed out VAT
        },
      ];
      const check = verifyStatutoryTaxPreservation(sampleFolios, tamperedFolios);
      assert.strictEqual(check.ok, false);
    });
  });

  describe("3. Security, RBAC & Multi-Tenant Isolation", () => {
    it("permits authorized roles: HOTEL_OWNER, GENERAL_MANAGER, COMPLIANCE_OFFICER, SUPER_ADMIN", () => {
      for (const role of ["HOTEL_OWNER", "GENERAL_MANAGER", "COMPLIANCE_OFFICER", "SUPER_ADMIN"]) {
        assert.strictEqual(validatePdpaAuthorization(role).ok, true);
      }
    });

    it("rejects unauthorized staff roles: WAITER, CASHIER, HOUSEKEEPING_RUNNER", () => {
      for (const role of ["WAITER", "CASHIER", "HOUSEKEEPING_RUNNER", "GUEST"]) {
        const res = validatePdpaAuthorization(role);
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
          assert.strictEqual(res.error.code, "PERMISSION_DENIED");
        }
      }
    });

    it("rejects PDPA operations when tenant subscription is inactive", () => {
      const res = validatePdpaAuthorization("GENERAL_MANAGER", false);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "SUBSCRIPTION_INACTIVE");
      }
    });

    it("rejects tenant mismatch (cross-tenant leakage attempt)", () => {
      const rogueRequest: PdpaAnonymizationRequest = {
        ...validErasureRequest,
        tenantId: "tenant-rival-hotel", // Tenant mismatch!
      };

      const res = anonymizeGuestPii(sampleGuest, rogueRequest, sampleFolios);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects guestId mismatch between target and request", () => {
      const mismatchedReq: PdpaAnonymizationRequest = {
        ...validErasureRequest,
        guestId: "guest-other-id",
      };

      const res = anonymizeGuestPii(sampleGuest, mismatchedReq, sampleFolios);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PDPA_REQUEST_INVALID");
      }
    });
  });

  describe("4. Cryptographically Hash-Chained Immutable Audit Trail", () => {
    it("generates deterministic 64-char SHA-256 entryHash documenting erasure action", () => {
      const res = anonymizeGuestPii(sampleGuest, validErasureRequest, sampleFolios);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const { auditEntry } = res.value;
        assert.strictEqual(auditEntry.action, "PDPA_GUEST_ERASURE");
        assert.strictEqual(auditEntry.entityType, "GUEST_PII");
        assert.strictEqual(auditEntry.entityId, sampleGuest.guestId);
        assert.strictEqual(auditEntry.prevHash, GENESIS_HASH);
        assert.strictEqual(auditEntry.entryHash.length, 64);
        assert.match(auditEntry.entryHash, /^[0-9a-f]{64}$/);
      }
    });
  });

  describe("5. Full Tenant PDPA Archive Export", () => {
    it("exports tenant archive with scrubbed guest directory and full statutory stay folios", () => {
      const exportRes = exportTenantPdpaArchive({
        tenantId,
        actorUserId: "user-gm-01",
        actorRole: "GENERAL_MANAGER",
        guests: [sampleGuest, foreignGuest],
        folios: sampleFolios,
        exportTimestampIso: "2026-10-21T10:30:00.000Z",
      });

      assert.strictEqual(exportRes.ok, true);
      if (exportRes.ok) {
        const archive = exportRes.value;
        assert.strictEqual(archive.tenantId, tenantId);
        assert.strictEqual(archive.anonymizedGuests.length, 2);
        assert.strictEqual(archive.preservedStatutoryFolios.length, 2);

        // Verify each exported guest has PII redacted
        for (const g of archive.anonymizedGuests) {
          assert.strictEqual(g.fullName, "[REDACTED - PDPA NO. 9 OF 2022]");
          assert.strictEqual(g.nicOrPassport, "[REDACTED]");
          assert.strictEqual(g.phone, "[REDACTED]");
          assert.strictEqual(g.email, "[REDACTED]");
        }

        // Verify audit entry is chained
        assert.strictEqual(archive.auditEntry.action, "PDPA_TENANT_EXPORT");
        assert.strictEqual(archive.auditEntry.entryHash.length, 64);
      }
    });

    it("rejects tenant archive export if cross-tenant folios or guests are injected", () => {
      const foreignTenantGuest: GuestPiiRecord = {
        ...sampleGuest,
        guestId: "guest-other-01",
        tenantId: "tenant-other-hotel",
      };

      const res = exportTenantPdpaArchive({
        tenantId,
        actorUserId: "user-gm-01",
        actorRole: "GENERAL_MANAGER",
        guests: [sampleGuest, foreignTenantGuest],
        folios: sampleFolios,
        exportTimestampIso: "2026-10-21T10:30:00.000Z",
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });
  });
});
