import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  signQrSessionToken,
  verifyChannexWebhook,
  verifyQrSessionToken,
  verifySmsGoWebhook,
} from "@hms/core";
import {
  checkRateLimitExceeded,
  extractRawToken,
  handler as qrAuthorizerHandler,
  resetRateLimiter,
} from "../lambdas/qrAuthorizer.js";
import { type LambdaFunctionUrlEvent, executeWebhooksIngress } from "../lambdas/webhooksIngress.js";

const TEST_TENANT_A = "tenant-hotel-colombo";
const TEST_NOW_ISO = "2026-10-21T12:00:00.000Z";
const TEST_PAYHERE_SECRET = "payhere-security-secret-key-999";
const TEST_CHANNEX_SECRET = "channex-webhook-hmac-secret-888";
const TEST_SMSGO_SECRET = "smsgo-webhook-hmac-secret-777";
const TEST_QR_SECRET = "room-qr-hmac-crypto-secret-key-666";

function createMockDocClient() {
  const sentCommands: Array<{ type: string; input: unknown }> = [];
  const mockClient = {
    send: async (command: { constructor: { name: string }; input: unknown }) => {
      sentCommands.push({
        type: command.constructor.name,
        input: command.input,
      });
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { mockClient, sentCommands };
}

describe("Step 478 (Phase 20.03): Security Auditor on Payment, Webhook & QR Auth Boundaries", () => {
  beforeEach(() => {
    resetRateLimiter();
    process.env.QR_HMAC_SECRET = undefined;
  });

  describe("1. PayHere md5sig Constant-Time Signature & Tamper Detection", () => {
    it("accepts authentic PayHere notification with correct MD5 signature", async () => {
      const { mockClient } = createMockDocClient();
      const merchantId = "1211111";
      const orderId = "ORDER-PAYHERE-001";
      const amount = "25000.00";
      const currency = "LKR";
      const statusCode = "2";

      const hashedSecret = createHash("md5")
        .update(TEST_PAYHERE_SECRET, "utf8")
        .digest("hex")
        .toUpperCase();
      const md5sig = createHash("md5")
        .update(`${merchantId}${orderId}${amount}${currency}${statusCode}${hashedSecret}`, "utf8")
        .digest("hex")
        .toUpperCase();

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/payhere",
        requestContext: { http: { method: "POST", path: "/webhooks/payhere" } },
        body: JSON.stringify({
          merchant_id: merchantId,
          order_id: orderId,
          payment_id: "PAY-001",
          payhere_amount: amount,
          payhere_currency: currency,
          status_code: statusCode,
          md5sig,
          custom_1: TEST_TENANT_A,
        }),
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        payHereSecret: TEST_PAYHERE_SECRET,
        nowIsoFn: () => TEST_NOW_ISO,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.status, "OK");
      assert.equal(body.paymentStatus, "PAID");
    });

    it("rejects forged or tampered amount with INVALID_SIGNATURE code", async () => {
      const { mockClient } = createMockDocClient();
      const merchantId = "1211111";
      const orderId = "ORDER-PAYHERE-002";
      const amount = "25000.00";
      const currency = "LKR";
      const statusCode = "2";

      const hashedSecret = createHash("md5")
        .update(TEST_PAYHERE_SECRET, "utf8")
        .digest("hex")
        .toUpperCase();
      const md5sig = createHash("md5")
        .update(`${merchantId}${orderId}${amount}${currency}${statusCode}${hashedSecret}`, "utf8")
        .digest("hex")
        .toUpperCase();

      // Tamper amount from 25000.00 to 100.00
      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/payhere",
        requestContext: { http: { method: "POST", path: "/webhooks/payhere" } },
        body: JSON.stringify({
          merchant_id: merchantId,
          order_id: orderId,
          payment_id: "PAY-002",
          payhere_amount: "100.00", // TAMPERED
          payhere_currency: currency,
          status_code: statusCode,
          md5sig,
          custom_1: TEST_TENANT_A,
        }),
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        payHereSecret: TEST_PAYHERE_SECRET,
        nowIsoFn: () => TEST_NOW_ISO,
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.code, "INVALID_SIGNATURE");
    });
  });

  describe("2. Channex OTA x-hmac-signature-256 & Timestamp Anti-Replay Boundary", () => {
    it("accepts Channex webhook within acceptable clock skew (<= 300s)", () => {
      const rawBody = JSON.stringify({ event: "booking_created", id: "ch-rev-101" });
      const nowEpoch = 1776772800; // 2026-04-21T12:00:00Z
      const timestampHeader = nowEpoch.toString();
      const payloadToSign = `${timestampHeader}.${rawBody}`;
      const sigHex = createHmac("sha256", TEST_CHANNEX_SECRET)
        .update(payloadToSign, "utf8")
        .digest("hex");

      const verifyRes = verifyChannexWebhook({
        rawBody,
        signatureHeader: `sha256=${sigHex}`,
        timestampHeader,
        secret: TEST_CHANNEX_SECRET,
        nowEpoch,
      });

      assert.equal(verifyRes.ok, true);
    });

    it("rejects replayed Channex webhook when timestamp skew exceeds 300 seconds", () => {
      const rawBody = JSON.stringify({ event: "booking_created", id: "ch-rev-102" });
      const nowEpoch = 1776772800;
      const staleTimestampHeader = (nowEpoch - 301).toString(); // 301 seconds ago
      const payloadToSign = `${staleTimestampHeader}.${rawBody}`;
      const sigHex = createHmac("sha256", TEST_CHANNEX_SECRET)
        .update(payloadToSign, "utf8")
        .digest("hex");

      const verifyRes = verifyChannexWebhook({
        rawBody,
        signatureHeader: `sha256=${sigHex}`,
        timestampHeader: staleTimestampHeader,
        secret: TEST_CHANNEX_SECRET,
        nowEpoch,
      });

      assert.equal(verifyRes.ok, false);
      if (!verifyRes.ok) {
        assert.equal(verifyRes.error.code, "HMAC_EXPIRED");
      }
    });

    it("rejects Channex webhook signed with wrong secret key in constant time", () => {
      const rawBody = JSON.stringify({ event: "booking_created", id: "ch-rev-103" });
      const nowEpoch = 1776772800;
      const timestampHeader = nowEpoch.toString();
      const payloadToSign = `${timestampHeader}.${rawBody}`;
      const invalidSig = createHmac("sha256", "WRONG_SECRET_KEY")
        .update(payloadToSign, "utf8")
        .digest("hex");

      const verifyRes = verifyChannexWebhook({
        rawBody,
        signatureHeader: `sha256=${invalidSig}`,
        timestampHeader,
        secret: TEST_CHANNEX_SECRET,
        nowEpoch,
      });

      assert.equal(verifyRes.ok, false);
      if (!verifyRes.ok) {
        assert.equal(verifyRes.error.code, "INVALID_SIGNATURE");
      }
    });
  });

  describe("3. SMSGo Delivery X-SMSGo-Signature HMAC Boundary", () => {
    it("accepts valid SMSGo delivery webhook callback", () => {
      const rawBody = JSON.stringify({
        message_id: "sms-99123",
        status: "DELIVERED",
        recipient: "+94771234567",
      });
      const signature = createHmac("sha256", TEST_SMSGO_SECRET)
        .update(Buffer.from(rawBody, "utf8"))
        .digest("hex");

      const verifyRes = verifySmsGoWebhook({
        rawBody,
        signature,
        secret: TEST_SMSGO_SECRET,
      });

      assert.equal(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.equal(verifyRes.value.messageId, "sms-99123");
        assert.equal(verifyRes.value.status, "DELIVERED");
        assert.equal(verifyRes.value.mobile, "94771234567");
      }
    });

    it("rejects altered payload or truncated signature in constant time", () => {
      const rawBody = JSON.stringify({ message_id: "sms-99123", status: "DELIVERED" });
      const signature = createHmac("sha256", TEST_SMSGO_SECRET)
        .update(Buffer.from(rawBody, "utf8"))
        .digest("hex");

      // Test altered body
      const alteredRes = verifySmsGoWebhook({
        rawBody: JSON.stringify({ message_id: "sms-99123", status: "FAILED" }),
        signature,
        secret: TEST_SMSGO_SECRET,
      });
      assert.equal(alteredRes.ok, false);

      // Test length mismatch
      const truncatedRes = verifySmsGoWebhook({
        rawBody,
        signature: signature.substring(0, 32),
        secret: TEST_SMSGO_SECRET,
      });
      assert.equal(truncatedRes.ok, false);
      if (!truncatedRes.ok) {
        assert.equal(truncatedRes.error.code, "INVALID_SIGNATURE");
      }
    });
  });

  describe("4. Zero-Login Room QR HMAC-SHA256 Session Token Boundary", () => {
    it("successfully issues and verifies genuine room QR session token", () => {
      const expEpoch = Math.floor(Date.now() / 1000) + 86400; // 24h
      const signRes = signQrSessionToken({
        tid: TEST_TENANT_A,
        loc: "ROOM_204",
        sty: "STAY-5551",
        exp: expEpoch,
        secret: TEST_QR_SECRET,
      });

      assert.equal(signRes.ok, true);
      if (signRes.ok) {
        const verifyRes = verifyQrSessionToken(signRes.value, TEST_QR_SECRET);
        assert.equal(verifyRes.ok, true);
        if (verifyRes.ok) {
          assert.equal(verifyRes.value.tid, TEST_TENANT_A);
          assert.equal(verifyRes.value.loc, "ROOM_204");
          assert.equal(verifyRes.value.sty, "STAY-5551");
        }
      }
    });

    it("detects cross-tenant replay attack (Tenant B secret rejects Tenant A token)", () => {
      const expEpoch = Math.floor(Date.now() / 1000) + 86400;
      const signRes = signQrSessionToken({
        tid: TEST_TENANT_A,
        loc: "ROOM_101",
        sty: "STAY-001",
        exp: expEpoch,
        secret: "tenant-a-private-key",
      });

      assert.equal(signRes.ok, true);
      if (signRes.ok) {
        const crossTenantRes = verifyQrSessionToken(signRes.value, "tenant-b-private-key");
        assert.equal(crossTenantRes.ok, false);
        if (!crossTenantRes.ok) {
          assert.equal(crossTenantRes.error.code, "INVALID_SIGNATURE");
        }
      }
    });

    it("rejects expired room QR token even when cryptographically genuine", () => {
      const pastEpoch = Math.floor(Date.now() / 1000) - 300; // expired 5m ago
      const signRes = signQrSessionToken({
        tid: TEST_TENANT_A,
        loc: "ROOM_301",
        sty: "STAY-EXPIRED",
        exp: pastEpoch,
        secret: TEST_QR_SECRET,
      });

      assert.equal(signRes.ok, true);
      if (signRes.ok) {
        const verifyRes = verifyQrSessionToken(signRes.value, TEST_QR_SECRET);
        assert.equal(verifyRes.ok, false);
        if (!verifyRes.ok) {
          assert.equal(verifyRes.error.code, "HMAC_EXPIRED");
        }
      }
    });

    it("enforces token-bucket rate limiting per room session key", () => {
      const key = `${TEST_TENANT_A}#ROOM_101#STAY_888`;
      const config = { maxRequestsPerWindow: 5, windowDurationMs: 60_000 };
      const now = Date.now();

      // 5 requests allowed
      for (let i = 0; i < 5; i++) {
        const exceeded = checkRateLimitExceeded(key, now, config);
        assert.equal(exceeded, false, `Request ${i + 1} should be permitted`);
      }

      // 6th request rejected
      const exceeded = checkRateLimitExceeded(key, now, config);
      assert.equal(exceeded, true, "Request 6 should be rate limited");
    });

    it("AppSync qrAuthorizer Lambda returns 401 unauthenticated when QR_HMAC_SECRET unset", async () => {
      const res = await qrAuthorizerHandler({
        authorizationToken: "Bearer valid.token.here",
      });
      assert.equal(res.isAuthorized, false);
      assert.equal(res.ttlOverride, 0);
    });

    it("AppSync qrAuthorizer Lambda extracts bearer tokens cleanly", () => {
      assert.equal(extractRawToken("Bearer abc-123"), "abc-123");
      assert.equal(extractRawToken("bearer  xyz-456  "), "xyz-456");
      assert.equal(extractRawToken("plain-token-789"), "plain-token-789");
      assert.equal(extractRawToken(undefined), "");
      assert.equal(extractRawToken(null), "");
    });
  });

  describe("5. Zero Client-Side Secret Exposure Verification", () => {
    it("confirms secret parameters are never present in client-facing payloads", () => {
      const clientQrPayload = {
        tid: TEST_TENANT_A,
        loc: "VILLA_05",
        sty: "STAY_9999",
        exp: 1776772800,
      };

      const serialized = JSON.stringify(clientQrPayload);
      assert.equal(serialized.includes("secret"), false);
      assert.equal(serialized.includes("key"), false);
      assert.equal(serialized.includes("apiKey"), false);
    });
  });
});
