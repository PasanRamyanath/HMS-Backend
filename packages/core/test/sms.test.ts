import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  createSmsAuditEntry,
  mapSmsDeliveryStatus,
  normalizeSriLankanMobile,
  verifySmsGoWebhook,
} from "../src/sms.js";

describe("SMSGo.lk Webhook Signature Verifier & Phone Normalizer (sms.ts)", () => {
  const TEST_SECRET = "smsgo-api-secret-key-kandy-hills-2026";

  describe("Sri Lankan Mobile Number Normalizer", () => {
    it("normalizes Dialog mobile numbers across prefix formats", () => {
      // 077
      const res077 = normalizeSriLankanMobile("0771234567");
      assert.equal(res077.ok, true);
      if (res077.ok) {
        assert.equal(res077.value.msisdn, "94771234567");
        assert.equal(res077.value.e164, "+94771234567");
        assert.equal(res077.value.localFormatted, "077 1234567");
        assert.equal(res077.value.operator, "Dialog");
      }

      // +9476 with spaces
      const res076 = normalizeSriLankanMobile("+94 76 9876543");
      assert.equal(res076.ok, true);
      if (res076.ok) {
        assert.equal(res076.value.msisdn, "94769876543");
        assert.equal(res076.value.operator, "Dialog");
      }

      // 074
      const res074 = normalizeSriLankanMobile("074-1122334");
      assert.equal(res074.ok, true);
      if (res074.ok) {
        assert.equal(res074.value.msisdn, "94741122334");
        assert.equal(res074.value.operator, "Dialog");
      }
    });

    it("normalizes Mobitel mobile numbers (071, 070)", () => {
      const res071 = normalizeSriLankanMobile("0719988776");
      assert.equal(res071.ok, true);
      if (res071.ok) {
        assert.equal(res071.value.msisdn, "94719988776");
        assert.equal(res071.value.operator, "Mobitel");
      }

      const res070 = normalizeSriLankanMobile("94701234567");
      assert.equal(res070.ok, true);
      if (res070.ok) {
        assert.equal(res070.value.msisdn, "94701234567");
        assert.equal(res070.value.operator, "Mobitel");
      }
    });

    it("normalizes Hutch mobile numbers (078, 072)", () => {
      const res078 = normalizeSriLankanMobile("0094781234567");
      assert.equal(res078.ok, true);
      if (res078.ok) {
        assert.equal(res078.value.msisdn, "94781234567");
        assert.equal(res078.value.operator, "Hutch");
      }

      const res072 = normalizeSriLankanMobile("0724455667");
      assert.equal(res072.ok, true);
      if (res072.ok) {
        assert.equal(res072.value.msisdn, "94724455667");
        assert.equal(res072.value.operator, "Hutch");
      }
    });

    it("normalizes Airtel mobile numbers (075)", () => {
      const res075 = normalizeSriLankanMobile("0755566778");
      assert.equal(res075.ok, true);
      if (res075.ok) {
        assert.equal(res075.value.msisdn, "94755566778");
        assert.equal(res075.value.operator, "Airtel");
      }
    });

    it("rejects non-mobile landlines and invalid prefixes", () => {
      // Colombo landline
      assert.equal(normalizeSriLankanMobile("0112345678").ok, false);
      // Kandy landline
      assert.equal(normalizeSriLankanMobile("0812345678").ok, false);
      // Invalid mobile prefix (073 doesn't exist)
      assert.equal(normalizeSriLankanMobile("0731234567").ok, false);
      // Too short
      assert.equal(normalizeSriLankanMobile("077123").ok, false);
      // Empty
      assert.equal(normalizeSriLankanMobile("").ok, false);
    });
  });

  describe("SMSGo Webhook Signature Verification", () => {
    const rawPayload = JSON.stringify({
      message_id: "sms-msg-990142",
      mobile: "0771234567",
      status: "DELIVERED",
      delivered_at: "2026-10-18T16:55:00.000Z",
    });

    function computeSig(payload: string, secret: string): string {
      return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    }

    it("verifies authentic delivery webhook with normalized mobile", () => {
      const signature = computeSig(rawPayload, TEST_SECRET);
      const res = verifySmsGoWebhook({
        rawBody: rawPayload,
        signature,
        secret: TEST_SECRET,
      });

      assert.equal(res.ok, true);
      if (!res.ok) return;

      assert.equal(res.value.verified, true);
      assert.equal(res.value.messageId, "sms-msg-990142");
      assert.equal(res.value.mobile, "94771234567");
      assert.equal(res.value.status, "DELIVERED");
    });

    it("maps standard delivery statuses", () => {
      assert.equal(mapSmsDeliveryStatus("DELIVERED"), "DELIVERED");
      assert.equal(mapSmsDeliveryStatus("SENT"), "SENT");
      assert.equal(mapSmsDeliveryStatus("QUEUED"), "QUEUED");
      assert.equal(mapSmsDeliveryStatus("EXPIRED"), "EXPIRED");
      assert.equal(mapSmsDeliveryStatus("FAILED"), "FAILED");
    });

    it("rejects tampered delivery webhook body", () => {
      const signature = computeSig(rawPayload, TEST_SECRET);
      const tampered = rawPayload.replace("DELIVERED", "FAILED");

      const res = verifySmsGoWebhook({
        rawBody: tampered,
        signature,
        secret: TEST_SECRET,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "INVALID_SIGNATURE");
      }
    });

    it("rejects webhook verified with wrong secret", () => {
      const signature = computeSig(rawPayload, TEST_SECRET);

      const res = verifySmsGoWebhook({
        rawBody: rawPayload,
        signature,
        secret: "wrong-secret-key-attacker",
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "INVALID_SIGNATURE");
      }
    });

    it("creates cryptographically chained audit log for SMS delivery", () => {
      const auditRes = createSmsAuditEntry(
        "grand-hotel-nuwara-eliya",
        "system-smsgo-dispatcher",
        "94771234567",
        "sms-msg-990142",
        "DELIVERED",
        "2026-10-18T16:55:00.000Z",
      );

      assert.equal(auditRes.ok, true);
      if (!auditRes.ok) return;

      const audit = auditRes.value;
      assert.equal(audit.tenantId, "grand-hotel-nuwara-eliya");
      assert.equal(audit.action, "SMS_DELIVERED");
      assert.equal(audit.entityType, "SmsNotification");
      assert.equal(audit.entityId, "sms-msg-990142");
      assert.equal(audit.entryHash.length, 64);
    });
  });
});
