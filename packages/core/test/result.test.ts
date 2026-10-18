import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type DomainErrorCode,
  domainErr,
  err,
  flatMapResult,
  mapResult,
  ok,
  unwrapOr,
} from "../src/result.js";

describe("Result<T, E> Pattern & DomainError Catalog", () => {
  it("creates successful Result with ok()", () => {
    const res = ok({ roomNumber: "101", lkrRate: 25000 });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.roomNumber, "101");
      assert.equal(res.value.lkrRate, 25000);
    }
  });

  it("creates error Result with err()", () => {
    const res = err({ code: "TENANT_MISMATCH", message: "Cross-tenant access forbidden" });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "TENANT_MISMATCH");
    }
  });

  it("constructs structured domain error codes via domainErr()", () => {
    const testCases: Array<{
      code: DomainErrorCode;
      message: string;
      meta?: Record<string, unknown>;
    }> = [
      {
        code: "TENANT_MISMATCH",
        message: "Tenant isolation check failed",
        meta: { requestedTenant: "t-1" },
      },
      {
        code: "QUOTA_EXCEEDED",
        message: "Maximum physical rooms reached for plan",
        meta: { limit: 50 },
      },
      {
        code: "TAX_MISMATCH",
        message: "Tax breakdown does not reconcile to invoice gross",
        meta: { deltaLkr: 0.05 },
      },
      { code: "INVALID_NIC", message: "National Identity Card number failed Sri Lankan checksum" },
      { code: "HMAC_EXPIRED", message: "QR session token has expired after 24h" },
      { code: "ROOM_CONFLICT", message: "Selected room is already locked for these dates" },
    ];

    for (const tc of testCases) {
      const res = domainErr(tc.code, tc.message, tc.meta);
      assert.equal(res.ok, false);
      assert.equal(res.error.code, tc.code);
      assert.equal(res.error.message, tc.message);
      if (tc.meta) {
        assert.deepEqual(res.error.meta, tc.meta);
      }
    }
  });

  it("transforms successful values using mapResult()", () => {
    const res = ok(100);
    const mapped = mapResult(res, (n) => n * 2);
    assert.equal(mapped.ok, true);
    if (mapped.ok) {
      assert.equal(mapped.value, 200);
    }

    const failureRes = domainErr("NOT_FOUND", "Item not found");
    const failedMap = mapResult(failureRes, (n: number) => n * 2);
    assert.equal(failedMap.ok, false);
  });

  it("chains asynchronous/sequential checks using flatMapResult()", () => {
    const parseNumber = (s: string) => {
      const n = Number.parseFloat(s);
      return Number.isNaN(n) ? domainErr("VALIDATION_FAILED", "Not a number") : ok(n);
    };

    const parsed = flatMapResult(ok("45000.50"), parseNumber);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value, 45000.5);
    }

    const invalid = flatMapResult(ok("invalid-amount"), parseNumber);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.error.code, "VALIDATION_FAILED");
    }
  });

  it("extracts values safely using unwrapOr()", () => {
    const success = ok("Resort Ocean Suite");
    assert.equal(unwrapOr(success, "Standard Room"), "Resort Ocean Suite");

    const failed = domainErr("NOT_FOUND", "Room not configured");
    assert.equal(unwrapOr(failed, "Standard Room"), "Standard Room");
  });
});
