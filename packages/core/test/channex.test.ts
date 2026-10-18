import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { createChannexWebhookAuditEntry, verifyChannexWebhook } from "../src/channex.js";

describe("Channex.io Raw-Body HMAC-SHA256 Webhook Verifier (channex.ts)", () => {
  const TEST_SECRET = "channex-webhook-secret-sigiriya-resort-99";
  const TEST_SECONDARY_SECRET = "channex-rotated-new-secret-2026";
  const TEST_PAYLOAD = JSON.stringify({
    event: "booking_created",
    property_id: "prop-sigiriya-001",
    booking: {
      id: "bkg-bookingcom-88712",
      ota: "Booking.com",
      guest: "John Doe",
      total: "125000.00",
      currency: "LKR",
    },
  });

  function computeChannexSig(timestamp: number, rawBody: string, secret: string): string {
    return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  }

  it("verifies valid Channex webhook with exact timestamp and raw body", () => {
    const timestamp = 1792345000;
    const signature = computeChannexSig(timestamp, TEST_PAYLOAD, TEST_SECRET);

    const res = verifyChannexWebhook({
      rawBody: TEST_PAYLOAD,
      timestampHeader: timestamp,
      signatureHeader: signature,
      secret: TEST_SECRET,
      nowEpoch: timestamp + 25, // 25s skew (well under 300s)
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.verified, true);
    assert.equal(res.value.timestamp, timestamp);
    assert.equal(res.value.rawBody, TEST_PAYLOAD);
  });

  it("verifies webhook with Buffer rawBody and sha256= prefix header", () => {
    const timestamp = 1792345000;
    const signature = computeChannexSig(timestamp, TEST_PAYLOAD, TEST_SECRET);

    const res = verifyChannexWebhook({
      rawBody: Buffer.from(TEST_PAYLOAD, "utf8"),
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      secret: TEST_SECRET,
      nowEpoch: timestamp,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.verified, true);
    assert.equal(res.value.timestamp, timestamp);
  });

  it("supports zero-downtime key rotation via secondarySecret", () => {
    const timestamp = 1792345000;
    // Payload signed with secondary (new) secret
    const signature = computeChannexSig(timestamp, TEST_PAYLOAD, TEST_SECONDARY_SECRET);

    const res = verifyChannexWebhook({
      rawBody: TEST_PAYLOAD,
      timestampHeader: timestamp,
      signatureHeader: signature,
      secret: TEST_SECRET, // primary (old) secret doesn't match
      secondarySecret: TEST_SECONDARY_SECRET, // secondary matches
      nowEpoch: timestamp,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.verified, true);
  });

  it("supports comma-separated candidate signatures", () => {
    const timestamp = 1792345000;
    const validSig = computeChannexSig(timestamp, TEST_PAYLOAD, TEST_SECRET);
    const multiSigHeader = `deadbeef0123456789abcdef, ${validSig}, 1234567890abcdef`;

    const res = verifyChannexWebhook({
      rawBody: TEST_PAYLOAD,
      timestampHeader: timestamp,
      signatureHeader: multiSigHeader,
      secret: TEST_SECRET,
      nowEpoch: timestamp,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.verified, true);
  });

  it("rejects replay attacks exceeding 300s time skew with HMAC_EXPIRED", () => {
    const timestamp = 1792345000;
    const signature = computeChannexSig(timestamp, TEST_PAYLOAD, TEST_SECRET);

    // 301 seconds later
    const expiredRes = verifyChannexWebhook({
      rawBody: TEST_PAYLOAD,
      timestampHeader: timestamp,
      signatureHeader: signature,
      secret: TEST_SECRET,
      nowEpoch: timestamp + 301,
    });

    assert.equal(expiredRes.ok, false);
    if (!expiredRes.ok) {
      assert.equal(expiredRes.error.code, "HMAC_EXPIRED");
    }

    // 301 seconds in the future
    const futureRes = verifyChannexWebhook({
      rawBody: TEST_PAYLOAD,
      timestampHeader: timestamp + 301,
      signatureHeader: signature,
      secret: TEST_SECRET,
      nowEpoch: timestamp,
    });

    assert.equal(futureRes.ok, false);
    if (!futureRes.ok) {
      assert.equal(futureRes.error.code, "HMAC_EXPIRED");
    }
  });

  it("rejects tampered payload content via signature mismatch", () => {
    const timestamp = 1792345000;
    const signature = computeChannexSig(timestamp, TEST_PAYLOAD, TEST_SECRET);

    // Attacker modifies booking total
    const tamperedPayload = TEST_PAYLOAD.replace("125000.00", "25000.00");

    const res = verifyChannexWebhook({
      rawBody: tamperedPayload,
      timestampHeader: timestamp,
      signatureHeader: signature,
      secret: TEST_SECRET,
      nowEpoch: timestamp,
    });

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "INVALID_SIGNATURE");
    }
  });

  it("creates cryptographically chained audit log for Channex booking webhook", () => {
    const auditRes = createChannexWebhookAuditEntry(
      "sigiriya-resort",
      "system-channex-webhook-runner",
      "bkg-bookingcom-88712",
      "booking_created",
      1792345000,
      "2026-10-18T16:53:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, "sigiriya-resort");
    assert.equal(audit.action, "CHANNEX_WEBHOOK_BOOKING_CREATED");
    assert.equal(audit.entityType, "OtaWebhook");
    assert.equal(audit.entityId, "bkg-bookingcom-88712");
    assert.equal(audit.entryHash.length, 64);
  });
});
