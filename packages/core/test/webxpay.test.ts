import assert from "node:assert/strict";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  createWebXPayAuditEntry,
  encodeWebXPayCustomFields,
  mapWebXPayStatus,
  parseWebXPayCustomFields,
  verifyWebXPayCallback,
} from "../src/webxpay.js";

describe("WebXPay Subscription & Payment Callback Verifier (webxpay.ts)", () => {
  const TEST_TENANT = "amanwella-tangalle";
  const TEST_INVOICE = "INV-2026-SAAS-04";
  const TEST_SUB = "SUB-TIER-ENTERPRISE-01";
  const TEST_SECRET = "webxpay-secret-key-amanwella-2026";

  it("encodes and parses custom_fields with tenantId isolation", () => {
    const encodedRes = encodeWebXPayCustomFields({
      tenantId: TEST_TENANT,
      invoiceId: TEST_INVOICE,
      subscriptionId: TEST_SUB,
    });

    assert.equal(encodedRes.ok, true);
    if (!encodedRes.ok) return;

    const parsedRes = parseWebXPayCustomFields(encodedRes.value);
    assert.equal(parsedRes.ok, true);
    if (!parsedRes.ok) return;

    assert.equal(parsedRes.value.tenantId, TEST_TENANT);
    assert.equal(parsedRes.value.invoiceId, TEST_INVOICE);
    assert.equal(parsedRes.value.subscriptionId, TEST_SUB);
  });

  it("supports JSON encoded custom_fields fallback", () => {
    const jsonStr = JSON.stringify({
      tenantId: "cinnamon-bentota-beach",
      invoiceId: "INV-BENTOTA-90",
    });
    const base64Json = Buffer.from(jsonStr, "utf8").toString("base64");

    const parsedRes = parseWebXPayCustomFields(base64Json);
    assert.equal(parsedRes.ok, true);
    if (!parsedRes.ok) return;

    assert.equal(parsedRes.value.tenantId, "cinnamon-bentota-beach");
    assert.equal(parsedRes.value.invoiceId, "INV-BENTOTA-90");
    assert.equal(parsedRes.value.subscriptionId, undefined);
  });

  it("rejects invalid tenantId in custom_fields", () => {
    const invalidBase64 = Buffer.from("INVALID TENANT SPACES|INV-01", "utf8").toString("base64");
    const parsedRes = parseWebXPayCustomFields(invalidBase64);
    assert.equal(parsedRes.ok, false);
    if (!parsedRes.ok) {
      assert.equal(parsedRes.error.code, "VALIDATION_FAILED");
    }
  });

  it("maps payment statuses accurately", () => {
    assert.equal(mapWebXPayStatus("0"), "PAID");
    assert.equal(mapWebXPayStatus("SUCCESS"), "PAID");
    assert.equal(mapWebXPayStatus("PENDING"), "PENDING");
    assert.equal(mapWebXPayStatus("CANCELLED"), "CANCELLED");
    assert.equal(mapWebXPayStatus("ANY_FAILURE"), "FAILED");
  });

  it("verifies WebXPay callback using HMAC-SHA256 signature", () => {
    const customFieldsRes = encodeWebXPayCustomFields({
      tenantId: TEST_TENANT,
      invoiceId: TEST_INVOICE,
      subscriptionId: TEST_SUB,
    });
    assert.equal(customFieldsRes.ok, true);
    if (!customFieldsRes.ok) return;

    const customFields = customFieldsRes.value;
    const orderId = "WX-ORDER-7701";
    const amount = 45000;
    const status = "0";

    const canonicalPayload = `${orderId}|${amount.toFixed(2)}|${status}|${customFields}`;
    const signature = createHmac("sha256", TEST_SECRET)
      .update(canonicalPayload, "utf8")
      .digest("hex");

    const verifyRes = verifyWebXPayCallback(
      {
        orderId,
        paymentAmount: amount,
        paymentStatus: status,
        customFields,
        signature,
        currency: "LKR",
        transactionId: "TXN-WX-998811",
      },
      TEST_SECRET,
    );

    assert.equal(verifyRes.ok, true);
    if (!verifyRes.ok) return;

    assert.equal(verifyRes.value.verified, true);
    assert.equal(verifyRes.value.tenantId, TEST_TENANT);
    assert.equal(verifyRes.value.invoiceId, TEST_INVOICE);
    assert.equal(verifyRes.value.subscriptionId, TEST_SUB);
    assert.equal(verifyRes.value.amount, 45000);
    assert.equal(verifyRes.value.currency, "LKR");
    assert.equal(verifyRes.value.status, "PAID");
    assert.equal(verifyRes.value.transactionId, "TXN-WX-998811");
  });

  it("rejects tampered amount via HMAC signature mismatch", () => {
    const customFieldsRes = encodeWebXPayCustomFields({
      tenantId: TEST_TENANT,
      invoiceId: TEST_INVOICE,
    });
    assert.equal(customFieldsRes.ok, true);
    if (!customFieldsRes.ok) return;

    const customFields = customFieldsRes.value;
    const orderId = "WX-ORDER-7701";
    const canonicalPayload = `${orderId}|45000.00|0|${customFields}`;
    const signature = createHmac("sha256", TEST_SECRET)
      .update(canonicalPayload, "utf8")
      .digest("hex");

    // Tampered: report amount as 500.00 instead of 45000.00
    const verifyRes = verifyWebXPayCallback(
      {
        orderId,
        paymentAmount: 500,
        paymentStatus: "0",
        customFields,
        signature,
      },
      TEST_SECRET,
    );

    assert.equal(verifyRes.ok, false);
    if (!verifyRes.ok) {
      assert.equal(verifyRes.error.code, "INVALID_SIGNATURE");
    }
  });

  it("verifies WebXPay callback using RSA-SHA256 public key verification", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const customFieldsRes = encodeWebXPayCustomFields({
      tenantId: TEST_TENANT,
      invoiceId: TEST_INVOICE,
    });
    assert.equal(customFieldsRes.ok, true);
    if (!customFieldsRes.ok) return;

    const customFields = customFieldsRes.value;
    const orderId = "WX-RSA-ORDER-123";
    const amount = 120000;
    const status = "0";

    const canonicalPayload = `${orderId}|${amount.toFixed(2)}|${status}|${customFields}`;
    const signer = createSign("RSA-SHA256");
    signer.update(canonicalPayload, "utf8");
    const rsaSignatureHex = signer.sign(privateKey, "hex");

    const verifyRes = verifyWebXPayCallback(
      {
        orderId,
        paymentAmount: amount,
        paymentStatus: status,
        customFields,
        signature: rsaSignatureHex,
      },
      publicKey,
    );

    assert.equal(verifyRes.ok, true);
    if (!verifyRes.ok) return;

    assert.equal(verifyRes.value.status, "PAID");
    assert.equal(verifyRes.value.invoiceId, TEST_INVOICE);
  });

  it("creates cryptographically chained audit log for WebXPay payment callbacks", () => {
    const auditRes = createWebXPayAuditEntry(
      TEST_TENANT,
      "system-webxpay-gateway-webhook",
      TEST_INVOICE,
      "PAID",
      45000,
      "LKR",
      "2026-10-18T16:50:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, TEST_TENANT);
    assert.equal(audit.action, "WEBXPAY_PAYMENT_PAID");
    assert.equal(audit.entityType, "SubscriptionPayment");
    assert.equal(audit.entityId, TEST_INVOICE);
    assert.equal(audit.entryHash.length, 64);
  });
});
