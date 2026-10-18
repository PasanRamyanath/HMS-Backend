import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { signQrSessionToken } from "@hms/core";
import {
  AUTHORIZED_TTL_SECONDS,
  type AppSyncAuthorizerEvent,
  type AppSyncAuthorizerResult,
  extractRawToken,
  handler,
} from "../lambdas/qrAuthorizer.js";

describe("AppSync Custom Lambda Authorizer for Zero-Login Guest QR Access (qrAuthorizer.ts)", () => {
  const TEST_SECRET = "test-sri-lanka-resort-qr-secret-key-32b";
  const TEST_TENANT = "tenant-ella-cloud-resort";
  const TEST_LOCATION = "ROOM-204";
  const TEST_STAY = "stay-sl-2026-9812";
  const originalEnvSecret = process.env.QR_HMAC_SECRET;

  beforeEach(() => {
    process.env.QR_HMAC_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.QR_HMAC_SECRET = originalEnvSecret;
    } else {
      Reflect.deleteProperty(process.env, "QR_HMAC_SECRET");
    }
  });

  it("extracts raw tokens handling various formats and Bearer prefixes", () => {
    assert.equal(extractRawToken("raw-token-123"), "raw-token-123");
    assert.equal(extractRawToken("Bearer token-abc"), "token-abc");
    assert.equal(extractRawToken("bearer token-xyz"), "token-xyz");
    assert.equal(extractRawToken("  Bearer   spaced-token  "), "spaced-token");
    assert.equal(extractRawToken(undefined), "");
    assert.equal(extractRawToken(null), "");
    assert.equal(extractRawToken(""), "");
  });

  it("authorizes a valid guest room QR session token and returns full resolver context", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const signRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp,
      secret: TEST_SECRET,
    });
    assert.ok(signRes.ok, "Expected signing to succeed");

    const event: AppSyncAuthorizerEvent = {
      authorizationToken: signRes.value,
      requestContext: {
        apiId: "test-appsync-api-id",
        operationName: "GetRoomServiceMenu",
      },
    };

    const result: AppSyncAuthorizerResult = await handler(event);

    assert.equal(result.isAuthorized, true);
    assert.equal(result.ttlOverride, AUTHORIZED_TTL_SECONDS);
    assert.ok(result.resolverContext);
    assert.equal(result.resolverContext?.tenantId, TEST_TENANT);
    assert.equal(result.resolverContext?.locationId, TEST_LOCATION);
    assert.equal(result.resolverContext?.stayId, TEST_STAY);
    assert.equal(result.resolverContext?.exp, exp);
    assert.equal(result.resolverContext?.role, "GUEST_QR");
  });

  it("authorizes a valid token prefixed with 'Bearer ' header syntax", async () => {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const signRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: "TABLE-08",
      stayId: "order-sess-4401",
      exp,
      secret: TEST_SECRET,
    });
    assert.ok(signRes.ok);

    const event: AppSyncAuthorizerEvent = {
      authorizationToken: `Bearer ${signRes.value}`,
    };

    const result = await handler(event);

    assert.equal(result.isAuthorized, true);
    assert.equal(result.resolverContext?.locationId, "TABLE-08");
    assert.equal(result.resolverContext?.stayId, "order-sess-4401");
  });

  it("denies access when authorizationToken is empty or missing", async () => {
    const emptyEvent: AppSyncAuthorizerEvent = {
      authorizationToken: "",
    };
    const missingEvent: AppSyncAuthorizerEvent = {};

    const res1 = await handler(emptyEvent);
    const res2 = await handler(missingEvent);

    assert.equal(res1.isAuthorized, false);
    assert.equal(res1.ttlOverride, 0);
    assert.equal(res2.isAuthorized, false);
    assert.equal(res2.ttlOverride, 0);
  });

  it("denies access when QR_HMAC_SECRET environment variable is missing", async () => {
    Reflect.deleteProperty(process.env, "QR_HMAC_SECRET");

    const exp = Math.floor(Date.now() / 1000) + 3600;
    const signRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp,
      secret: TEST_SECRET,
    });
    assert.ok(signRes.ok);

    const result = await handler({ authorizationToken: signRes.value });

    assert.equal(result.isAuthorized, false);
    assert.equal(result.ttlOverride, 0);
  });

  it("denies access for expired tokens", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const signRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: pastExp,
      secret: TEST_SECRET,
    });
    assert.ok(signRes.ok);

    const result = await handler({ authorizationToken: signRes.value });

    assert.equal(result.isAuthorized, false);
    assert.equal(result.ttlOverride, 0);
  });

  it("denies access for tampered or forged payloads", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const signRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp,
      secret: TEST_SECRET,
    });
    assert.ok(signRes.ok);

    const parts = signRes.value.split(".");
    // Tamper with payload portion
    const forgedToken = `forgedPayload.${parts[1]}`;

    const result = await handler({ authorizationToken: forgedToken });

    assert.equal(result.isAuthorized, false);
    assert.equal(result.ttlOverride, 0);
  });

  it("denies access for tokens signed with different secret key", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const signRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp,
      secret: "completely-different-wrong-secret-key-32b",
    });
    assert.ok(signRes.ok);

    const result = await handler({ authorizationToken: signRes.value });

    assert.equal(result.isAuthorized, false);
    assert.equal(result.ttlOverride, 0);
  });

  it("denies access for malformed token strings without separator", async () => {
    const result = await handler({ authorizationToken: "invalidTokenWithoutDotSeparator" });

    assert.equal(result.isAuthorized, false);
    assert.equal(result.ttlOverride, 0);
  });

  it("denies access when QR_HMAC_SECRET is only whitespace", async () => {
    process.env.QR_HMAC_SECRET = "   ";

    const exp = Math.floor(Date.now() / 1000) + 3600;
    const signRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp,
      secret: TEST_SECRET,
    });
    assert.ok(signRes.ok);

    const result = await handler({ authorizationToken: signRes.value });

    assert.equal(result.isAuthorized, false);
    assert.equal(result.ttlOverride, 0);
  });
});
