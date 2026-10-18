import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { encodeWebXPayCustomFields } from "@hms/core";
import {
  type LambdaFunctionUrlEvent,
  executeWebhooksIngress,
  handler,
} from "../lambdas/webhooksIngress.js";

const TEST_NOW = "2026-10-18T19:00:00.000Z";
const TEST_PAYHERE_SECRET = "test-payhere-secret-abc";
const TEST_WEBXPAY_SECRET = "test-webxpay-secret-xyz";
const TEST_CHANNEX_SECRET = "test-channex-secret-123";
const TEST_SMSGO_SECRET = "test-smsgo-secret-456";

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

describe("Unified Webhook Ingress Lambda (webhooksIngress.ts)", () => {
  describe("PayHere Ingress Route (/webhooks/payhere)", () => {
    it("successfully verifies PayHere payment notification and updates DynamoDB", async () => {
      const { mockClient, sentCommands } = createMockDocClient();

      const merchantId = "MERCHANT_001";
      const orderId = "order-test-101";
      const amount = "12500.00";
      const currency = "LKR";
      const statusCode = "2"; // 2 = PAID

      const hashedSecret = createHash("md5")
        .update(TEST_PAYHERE_SECRET, "utf8")
        .digest("hex")
        .toUpperCase();
      const payloadToHash = `${merchantId}${orderId}${amount}${currency}${statusCode}${hashedSecret}`;
      const md5sig = createHash("md5").update(payloadToHash, "utf8").digest("hex").toUpperCase();

      const bodyObj = {
        merchant_id: merchantId,
        order_id: orderId,
        payment_id: "payhere-tx-999",
        payhere_amount: amount,
        payhere_currency: currency,
        status_code: statusCode,
        md5sig,
        custom_1: "tenant-resort-mirissa",
      };

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/payhere",
        requestContext: {
          http: { method: "POST", path: "/webhooks/payhere" },
        },
        body: JSON.stringify(bodyObj),
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        payHereSecret: TEST_PAYHERE_SECRET,
        nowIsoFn: () => TEST_NOW,
      });

      assert.equal(res.statusCode, 200);
      const parsedBody = JSON.parse(res.body);
      assert.equal(parsedBody.status, "OK");
      assert.equal(parsedBody.orderId, orderId);
      assert.equal(parsedBody.paymentStatus, "PAID");

      // Verify update command was called for payment settlement
      const updateCmd = sentCommands.find((c) => c.type === "UpdateCommand");
      assert.ok(updateCmd, "Expected UpdateCommand for payment settlement");
    });

    it("rejects PayHere webhook with tampered MD5 signature", async () => {
      const { mockClient } = createMockDocClient();

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/payhere",
        requestContext: {
          http: { method: "POST", path: "/webhooks/payhere" },
        },
        body: JSON.stringify({
          merchant_id: "MERCHANT_001",
          order_id: "order-101",
          payment_id: "payhere-tx-999",
          payhere_amount: "12500.00",
          payhere_currency: "LKR",
          status_code: "2",
          md5sig: "FORGED_SIGNATURE_INVALID",
        }),
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        payHereSecret: TEST_PAYHERE_SECRET,
      });

      assert.equal(res.statusCode, 400);
      const parsedBody = JSON.parse(res.body);
      assert.equal(parsedBody.code, "INVALID_SIGNATURE");
    });
  });

  describe("WebXPay Ingress Route (/webhooks/webxpay)", () => {
    it("successfully verifies WebXPay HMAC signature and updates SaaS subscription", async () => {
      const { mockClient, sentCommands } = createMockDocClient();

      const orderId = "WX-ORDER-77";
      const amount = 35000;
      const formattedAmount = "35000.00";
      const status = "SUCCESS";

      const encCustom = encodeWebXPayCustomFields({
        tenantId: "tenant-ella-villas",
        invoiceId: "inv-123",
        subscriptionId: "sub-ella",
      });
      assert.ok(encCustom.ok);
      const customFields = encCustom.value;

      const canonical = `${orderId}|${formattedAmount}|${status}|${customFields}`;
      const signature = createHmac("sha256", TEST_WEBXPAY_SECRET)
        .update(canonical, "utf8")
        .digest("hex");

      const bodyObj = {
        order_id: orderId,
        amount,
        status,
        custom_fields: customFields,
        signature,
        transaction_id: "TX-WX-8899",
      };

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/webxpay",
        requestContext: {
          http: { method: "POST", path: "/webhooks/webxpay" },
        },
        body: JSON.stringify(bodyObj),
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        webXPaySecret: TEST_WEBXPAY_SECRET,
        nowIsoFn: () => TEST_NOW,
      });

      assert.equal(res.statusCode, 200);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.status, "OK");
      assert.equal(parsed.transactionId, "TX-WX-8899");
      assert.equal(parsed.paymentStatus, "PAID");

      // Verify subscription updated to ACTIVE
      const updateCmd = sentCommands.find((c) => c.type === "UpdateCommand") as {
        input: { Key: { SK: string } };
      };
      assert.ok(updateCmd, "Expected subscription update");
      assert.equal(updateCmd.input.Key.SK, "SUBSCRIPTION#sub-ella");
    });

    it("rejects WebXPay callback with invalid signature", async () => {
      const { mockClient } = createMockDocClient();

      const encCustom = encodeWebXPayCustomFields({
        tenantId: "tenant-colombo-city",
        invoiceId: "inv-404",
      });
      assert.ok(encCustom.ok);

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/webxpay",
        requestContext: {
          http: { method: "POST", path: "/webhooks/webxpay" },
        },
        body: JSON.stringify({
          order_id: "WX-01",
          amount: 5000,
          status: "SUCCESS",
          custom_fields: encCustom.value,
          signature: "wrong-signature-123",
        }),
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        webXPaySecret: TEST_WEBXPAY_SECRET,
      });

      assert.equal(res.statusCode, 400);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.code, "INVALID_SIGNATURE");
    });
  });

  describe("Channex Ingress Route (/webhooks/channex)", () => {
    it("successfully verifies Channex OTA booking webhook with timestamped HMAC", async () => {
      const { mockClient, sentCommands } = createMockDocClient();

      const timestamp = Math.floor(new Date(TEST_NOW).getTime() / 1000);
      const payloadObj = {
        event: "booking_new",
        booking: {
          id: "CHANNEX-OTA-1004",
          tenantId: "tenant-kandy-heritage",
          guest_name: "John Doe",
        },
      };
      const rawBody = JSON.stringify(payloadObj);

      const prefixBuffer = Buffer.from(`${timestamp}.`, "utf8");
      const rawBuffer = Buffer.from(rawBody, "utf8");
      const signature = createHmac("sha256", TEST_CHANNEX_SECRET)
        .update(Buffer.concat([prefixBuffer, rawBuffer]))
        .digest("hex");

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/channex",
        requestContext: {
          http: { method: "POST", path: "/webhooks/channex" },
        },
        headers: {
          "x-hmac-signature-256": signature,
          "x-channex-timestamp": timestamp.toString(),
        },
        body: rawBody,
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        channexSecret: TEST_CHANNEX_SECRET,
        nowIsoFn: () => TEST_NOW,
      });

      assert.equal(res.statusCode, 200);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.status, "OK");
      assert.equal(parsed.bookingId, "CHANNEX-OTA-1004");

      const putCmd = sentCommands.find(
        (c) =>
          c.type === "PutCommand" &&
          (c.input as { Item: { SK: string } }).Item.SK.startsWith("OTA#"),
      ) as { input: { Item: { SK: string } } };
      assert.ok(putCmd, "Expected OTA webhook PutCommand");
      assert.equal(putCmd.input.Item.SK, "OTA#CHANNEX-OTA-1004");
    });

    it("rejects Channex webhook when timestamp skew exceeds window", async () => {
      const { mockClient } = createMockDocClient();

      const expiredTimestamp = Math.floor(new Date(TEST_NOW).getTime() / 1000) - 600; // 10 minutes old
      const rawBody = JSON.stringify({ event: "booking_new" });

      const prefixBuffer = Buffer.from(`${expiredTimestamp}.`, "utf8");
      const rawBuffer = Buffer.from(rawBody, "utf8");
      const signature = createHmac("sha256", TEST_CHANNEX_SECRET)
        .update(Buffer.concat([prefixBuffer, rawBuffer]))
        .digest("hex");

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/channex",
        requestContext: {
          http: { method: "POST", path: "/webhooks/channex" },
        },
        headers: {
          "x-hmac-signature-256": signature,
          "x-channex-timestamp": expiredTimestamp.toString(),
        },
        body: rawBody,
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        channexSecret: TEST_CHANNEX_SECRET,
        nowIsoFn: () => TEST_NOW,
      });

      assert.equal(res.statusCode, 400);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.code, "HMAC_EXPIRED");
    });
  });

  describe("SMSGo Ingress Route (/webhooks/smsgo)", () => {
    it("successfully verifies SMS delivery webhook and normalizes Sri Lankan mobile", async () => {
      const { mockClient, sentCommands } = createMockDocClient();

      const payloadObj = {
        message_id: "SMS-GO-9988",
        mobile: "0771234567",
        status: "DELIVERED",
        tenantId: "tenant-galle-fort",
      };
      const rawBody = JSON.stringify(payloadObj);

      const signature = createHmac("sha256", TEST_SMSGO_SECRET)
        .update(rawBody, "utf8")
        .digest("hex");

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/smsgo",
        requestContext: {
          http: { method: "POST", path: "/webhooks/smsgo" },
        },
        headers: {
          "x-smsgo-signature": signature,
        },
        body: rawBody,
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        smsGoSecret: TEST_SMSGO_SECRET,
        nowIsoFn: () => TEST_NOW,
      });

      assert.equal(res.statusCode, 200);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.status, "OK");
      assert.equal(parsed.messageId, "SMS-GO-9988");
      assert.equal(parsed.deliveryStatus, "DELIVERED");

      const updateCmd = sentCommands.find((c) => c.type === "UpdateCommand") as {
        input: { Key: { SK: string }; ExpressionAttributeValues: { ":mob": string } };
      };
      assert.ok(updateCmd, "Expected SMS delivery UpdateCommand");
      assert.equal(updateCmd.input.Key.SK, "SMS#SMS-GO-9988");
      assert.equal(updateCmd.input.ExpressionAttributeValues[":mob"], "94771234567");
    });

    it("rejects SMSGo webhook with missing or invalid signature", async () => {
      const { mockClient } = createMockDocClient();

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/smsgo",
        requestContext: {
          http: { method: "POST", path: "/webhooks/smsgo" },
        },
        headers: {
          "x-smsgo-signature": "BAD_SIGNATURE",
        },
        body: JSON.stringify({ message_id: "123", mobile: "0771234567" }),
      };

      const res = await executeWebhooksIngress(event, {
        docClient: mockClient,
        smsGoSecret: TEST_SMSGO_SECRET,
      });

      assert.equal(res.statusCode, 400);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.code, "INVALID_SIGNATURE");
    });
  });

  describe("HTTP Method & Route Handling", () => {
    it("rejects non-POST HTTP methods with 405 Method Not Allowed", async () => {
      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/payhere",
        requestContext: {
          http: { method: "GET", path: "/webhooks/payhere" },
        },
      };

      const res = await executeWebhooksIngress(event);
      assert.equal(res.statusCode, 405);
    });

    it("returns 404 for unknown webhook endpoints", async () => {
      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/unknown-provider",
        requestContext: {
          http: { method: "POST", path: "/webhooks/unknown-provider" },
        },
        body: "{}",
      };

      const res = await executeWebhooksIngress(event);
      assert.equal(res.statusCode, 404);
    });
  });

  describe("Lambda Handler Entrypoint & Base64 Payload Support", () => {
    it("handles base64-encoded request bodies correctly", async () => {
      const bodyObj = {
        merchant_id: "MERCHANT_001",
        order_id: "order-b64",
        payment_id: "payhere-tx-b64",
        payhere_amount: "1000.00",
        payhere_currency: "LKR",
        status_code: "2",
        md5sig: "FORGED_SIGNATURE",
      };
      const rawBody = JSON.stringify(bodyObj);
      const b64Body = Buffer.from(rawBody, "utf8").toString("base64");

      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/payhere",
        requestContext: {
          http: { method: "POST", path: "/webhooks/payhere" },
        },
        isBase64Encoded: true,
        body: b64Body,
      };

      const res = await executeWebhooksIngress(event, {
        payHereSecret: TEST_PAYHERE_SECRET,
      });
      assert.equal(res.statusCode, 400);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.code, "INVALID_SIGNATURE");
    });

    it("verifies handler entrypoint returns 405 on non-POST event", async () => {
      const event: LambdaFunctionUrlEvent = {
        rawPath: "/webhooks/payhere",
        requestContext: {
          http: { method: "GET", path: "/webhooks/payhere" },
        },
      };

      const res = await handler(event);
      assert.equal(res.statusCode, 405);
    });
  });
});
