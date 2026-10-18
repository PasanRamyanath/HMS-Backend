import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  type QrSessionPayload,
  createQrSessionTokenAuditEntry,
  signQrSessionToken,
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
