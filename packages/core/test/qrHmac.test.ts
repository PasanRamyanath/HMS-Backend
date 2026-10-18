import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  type QrSessionPayload,
  createQrSessionTokenAuditEntry,
  createQrSessionVerificationAuditEntry,
  signQrSessionToken,
  verifyQrSessionToken,
} from "../src/qrHmac.js";

describe("Room & Table QR HMAC-SHA256 Session Token Signer (signQrSessionToken)", () => {
  const TEST_SECRET = "super-secret-hmac-key-for-bentota-beach-hotel";
  const TEST_TENANT = "bentota-beach-hotel";
  const TEST_LOCATION = "ROOM-302";
  const TEST_STAY = "STAY-2026-9901";
  const TEST_EXP = 1792345600; // future unix epoch

  it("successfully generates a base64url-encoded HMAC-SHA256 token", () => {
    const tokenRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    assert.equal(tokenRes.ok, true);
    if (!tokenRes.ok) return;

    const token = tokenRes.value;
    const parts = token.split(".");
    assert.equal(parts.length, 2);

    const [encodedPayload, signature] = parts;
    assert.ok(encodedPayload && encodedPayload.length > 0);
    assert.ok(signature && signature.length > 0);

    // Verify payload decodes to expected JSON structure
    const decodedJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(decodedJson) as QrSessionPayload;

    assert.equal(payload.tid, TEST_TENANT);
    assert.equal(payload.loc, TEST_LOCATION);
    assert.equal(payload.sty, TEST_STAY);
    assert.equal(payload.exp, TEST_EXP);

    // Verify signature matches independent HMAC computation
    const expectedSig = createHmac("sha256", TEST_SECRET)
      .update(encodedPayload)
      .digest("base64url");
    assert.equal(signature, expectedSig);
  });

  it("supports compact property aliases (tid, loc, sty)", () => {
    const tokenRes = signQrSessionToken({
      tid: "cinnamon-grand-cmb",
      loc: "TABLE-POOL-05",
      sty: "ORDER-SESSION-8841",
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    assert.equal(tokenRes.ok, true);
    if (!tokenRes.ok) return;

    const token = tokenRes.value;
    const [encodedPayload] = token.split(".");
    assert.ok(encodedPayload);

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as QrSessionPayload;

    assert.equal(payload.tid, "cinnamon-grand-cmb");
    assert.equal(payload.loc, "TABLE-POOL-05");
    assert.equal(payload.sty, "ORDER-SESSION-8841");
    assert.equal(payload.exp, TEST_EXP);
  });

  it("produces distinct signatures when secret or stayId rotates", () => {
    const token1 = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: "STAY-GUEST-A",
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    const token2 = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: "STAY-GUEST-B",
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    const token3 = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: "STAY-GUEST-A",
      exp: TEST_EXP,
      secret: "rotated-secret-key-different-secret-99",
    });

    assert.equal(token1.ok, true);
    assert.equal(token2.ok, true);
    assert.equal(token3.ok, true);
    if (!token1.ok || !token2.ok || !token3.ok) return;

    assert.notEqual(token1.value, token2.value);
    assert.notEqual(token1.value, token3.value);
  });

  it("rejects invalid inputs with descriptive domain error codes", () => {
    // Missing location
    const missingLoc = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: "",
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });
    assert.equal(missingLoc.ok, false);
    if (!missingLoc.ok) {
      assert.equal(missingLoc.error.code, "INVALID_QR_SESSION");
    }

    // Missing stayId
    const missingStay = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: "",
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });
    assert.equal(missingStay.ok, false);
    if (!missingStay.ok) {
      assert.equal(missingStay.error.code, "INVALID_QR_SESSION");
    }

    // Empty secret
    const missingSecret = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: "",
    });
    assert.equal(missingSecret.ok, false);
    if (!missingSecret.ok) {
      assert.equal(missingSecret.error.code, "INVALID_QR_SESSION");
    }

    // Non-positive expiration
    const invalidExp = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: -1,
      secret: TEST_SECRET,
    });
    assert.equal(invalidExp.ok, false);
    if (!invalidExp.ok) {
      assert.equal(invalidExp.error.code, "INVALID_QR_SESSION");
    }

    // Invalid tenantId format
    const invalidTenant = signQrSessionToken({
      tenantId: "INVALID TENANT WITH SPACES",
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });
    assert.equal(invalidTenant.ok, false);
    if (!invalidTenant.ok) {
      assert.equal(invalidTenant.error.code, "VALIDATION_FAILED");
    }
  });

  it("creates cryptographically chained audit log for QR session issuance", () => {
    const tokenRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    assert.equal(tokenRes.ok, true);
    if (!tokenRes.ok) return;

    const auditRes = createQrSessionTokenAuditEntry(
      TEST_TENANT,
      "actor-frontdesk-mgr",
      TEST_LOCATION,
      TEST_STAY,
      tokenRes.value,
      "2026-10-18T16:40:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, TEST_TENANT);
    assert.equal(audit.action, "ISSUE_QR_SESSION_TOKEN");
    assert.equal(audit.entityType, "QrSessionToken");
    assert.equal(audit.entityId, `${TEST_LOCATION}:${TEST_STAY}`);
    assert.equal(audit.entryHash.length, 64);
  });
});

describe("Constant-Time QR Session Token Verifier (verifyQrSessionToken)", () => {
  const TEST_SECRET = "super-secret-hmac-key-for-bentota-beach-hotel";
  const TEST_TENANT = "bentota-beach-hotel";
  const TEST_LOCATION = "ROOM-302";
  const TEST_STAY = "STAY-2026-9901";
  const TEST_EXP = 1792345600;

  it("verifies a valid QR session token and returns decoded payload", () => {
    const tokenRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    assert.equal(tokenRes.ok, true);
    if (!tokenRes.ok) return;

    const verifyRes = verifyQrSessionToken(
      tokenRes.value,
      TEST_SECRET,
      TEST_EXP - 100, // nowEpoch is before expiration
    );

    assert.equal(verifyRes.ok, true);
    if (!verifyRes.ok) return;

    assert.equal(verifyRes.value.tid, TEST_TENANT);
    assert.equal(verifyRes.value.loc, TEST_LOCATION);
    assert.equal(verifyRes.value.sty, TEST_STAY);
    assert.equal(verifyRes.value.exp, TEST_EXP);
  });

  it("rejects forged or modified payloads via cryptographic signature mismatch", () => {
    const tokenRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: "ROOM-302",
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    assert.equal(tokenRes.ok, true);
    if (!tokenRes.ok) return;

    const parts = tokenRes.value.split(".");
    // Forge payload to pretend order is from presidential suite
    const forgedPayloadJson = JSON.stringify({
      tid: TEST_TENANT,
      loc: "SUITE-900-PRESIDENTIAL",
      sty: TEST_STAY,
      exp: TEST_EXP,
    });
    const forgedEncoded = Buffer.from(forgedPayloadJson, "utf8").toString("base64url");
    const forgedToken = `${forgedEncoded}.${parts[1]}`;

    const verifyRes = verifyQrSessionToken(forgedToken, TEST_SECRET, TEST_EXP - 100);
    assert.equal(verifyRes.ok, false);
    if (!verifyRes.ok) {
      assert.equal(verifyRes.error.code, "INVALID_SIGNATURE");
    }
  });

  it("rejects token verified with wrong HMAC secret", () => {
    const tokenRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    assert.equal(tokenRes.ok, true);
    if (!tokenRes.ok) return;

    const verifyRes = verifyQrSessionToken(
      tokenRes.value,
      "wrong-secret-key-attacker",
      TEST_EXP - 100,
    );
    assert.equal(verifyRes.ok, false);
    if (!verifyRes.ok) {
      assert.equal(verifyRes.error.code, "INVALID_SIGNATURE");
    }
  });

  it("rejects expired QR session tokens at and past expiration epoch", () => {
    const tokenRes = signQrSessionToken({
      tenantId: TEST_TENANT,
      location: TEST_LOCATION,
      stayId: TEST_STAY,
      exp: TEST_EXP,
      secret: TEST_SECRET,
    });

    assert.equal(tokenRes.ok, true);
    if (!tokenRes.ok) return;

    // Boundary: exactly at expiration (nowEpoch === exp)
    const exactExpRes = verifyQrSessionToken(tokenRes.value, TEST_SECRET, TEST_EXP);
    assert.equal(exactExpRes.ok, false);
    if (!exactExpRes.ok) {
      assert.equal(exactExpRes.error.code, "HMAC_EXPIRED");
    }

    // Past expiration (nowEpoch > exp)
    const pastExpRes = verifyQrSessionToken(tokenRes.value, TEST_SECRET, TEST_EXP + 1);
    assert.equal(pastExpRes.ok, false);
    if (!pastExpRes.ok) {
      assert.equal(pastExpRes.error.code, "HMAC_EXPIRED");
    }

    // Prior to expiration (nowEpoch < exp) is valid
    const validExpRes = verifyQrSessionToken(tokenRes.value, TEST_SECRET, TEST_EXP - 1);
    assert.equal(validExpRes.ok, true);
  });

  it("rejects malformed token strings and missing secrets", () => {
    // Missing secret
    const noSecret = verifyQrSessionToken("token", "");
    assert.equal(noSecret.ok, false);

    // Missing dot delimiter
    const noDot = verifyQrSessionToken("eyJhbGciOiJIUzI1NiJ9", TEST_SECRET);
    assert.equal(noDot.ok, false);

    // Empty components
    const emptyParts = verifyQrSessionToken(".signature", TEST_SECRET);
    assert.equal(emptyParts.ok, false);

    // Truncated signature buffer
    const truncatedSig = verifyQrSessionToken("eyJ0aWQiOiJ0ZXN0In0.AQID", TEST_SECRET);
    assert.equal(truncatedSig.ok, false);
  });

  it("creates cryptographically chained audit log for session token verification", () => {
    const successRes = createQrSessionVerificationAuditEntry(
      TEST_TENANT,
      "actor-pos-terminal-01",
      TEST_LOCATION,
      TEST_STAY,
      true,
      "2026-10-18T16:42:00.000Z",
    );

    assert.equal(successRes.ok, true);
    if (!successRes.ok) return;

    const audit = successRes.value;
    assert.equal(audit.action, "VERIFY_QR_SESSION_TOKEN_SUCCESS");
    assert.equal(audit.entityType, "QrSessionToken");
    assert.equal(audit.entityId, `${TEST_LOCATION}:${TEST_STAY}`);
    assert.equal(audit.entryHash.length, 64);

    const failureRes = createQrSessionVerificationAuditEntry(
      TEST_TENANT,
      "actor-pos-terminal-01",
      TEST_LOCATION,
      TEST_STAY,
      false,
      "2026-10-18T16:42:05.000Z",
      audit.entryHash,
    );

    assert.equal(failureRes.ok, true);
    if (!failureRes.ok) return;
    assert.equal(failureRes.value.action, "VERIFY_QR_SESSION_TOKEN_FAILURE");
    assert.equal(failureRes.value.prevHash, audit.entryHash);
  });
});
