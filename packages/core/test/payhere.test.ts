import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { createPayHereCheckoutAuditEntry, generatePayHereCheckoutHash } from "../src/payhere.js";

describe("PayHere Checkout Hash Generator (generatePayHereCheckoutHash)", () => {
  const TEST_MERCHANT_ID = "1211149";
  const TEST_ORDER_ID = "ORDER-2026-001";
  const TEST_AMOUNT = 15450.5;
  const TEST_CURRENCY = "LKR";
  const TEST_SECRET = "4O42N91abcdef0123456789";

  it("computes uppercase MD5 hash exactly matching PayHere documentation specification", () => {
    const res = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: TEST_AMOUNT,
      currency: TEST_CURRENCY,
      merchantSecret: TEST_SECRET,
      tenantId: "heritance-ahungalla",
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    // Independent manual calculation
    const hashedSecret = createHash("md5").update(TEST_SECRET, "utf8").digest("hex").toUpperCase();
    const formattedAmount = TEST_AMOUNT.toFixed(2);
    const combined = `${TEST_MERCHANT_ID}${TEST_ORDER_ID}${formattedAmount}${TEST_CURRENCY}${hashedSecret}`;
    const expectedHash = createHash("md5").update(combined, "utf8").digest("hex").toUpperCase();

    assert.equal(res.value, expectedHash);
    assert.equal(res.value, res.value.toUpperCase());
    assert.equal(res.value.length, 32);
  });

  it("handles integer rupee amounts with .00 decimal formatting", () => {
    const res = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: "ORDER-ROOM-100",
      amount: 50000,
      currency: "lkr", // tests lowercase normalization
      merchantSecret: TEST_SECRET,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const hashedSecret = createHash("md5").update(TEST_SECRET).digest("hex").toUpperCase();
    const expected = createHash("md5")
      .update(`${TEST_MERCHANT_ID}ORDER-ROOM-10050000.00LKR${hashedSecret}`)
      .digest("hex")
      .toUpperCase();

    assert.equal(res.value, expected);
  });

  it("produces distinct hashes when amount, orderId or secret changes", () => {
    const base = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: 1000,
      currency: "LKR",
      merchantSecret: TEST_SECRET,
    });

    const diffAmount = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: 1000.01,
      currency: "LKR",
      merchantSecret: TEST_SECRET,
    });

    const diffSecret = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: 1000,
      currency: "LKR",
      merchantSecret: "different-secret",
    });

    assert.equal(base.ok, true);
    assert.equal(diffAmount.ok, true);
    assert.equal(diffSecret.ok, true);
    if (!base.ok || !diffAmount.ok || !diffSecret.ok) return;

    assert.notEqual(base.value, diffAmount.value);
    assert.notEqual(base.value, diffSecret.value);
  });

  it("rejects invalid inputs with descriptive validation errors", () => {
    // Missing merchantId
    const noMerchant = generatePayHereCheckoutHash({
      merchantId: "",
      orderId: TEST_ORDER_ID,
      amount: TEST_AMOUNT,
      currency: "LKR",
      merchantSecret: TEST_SECRET,
    });
    assert.equal(noMerchant.ok, false);

    // Missing orderId
    const noOrder = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: "",
      amount: TEST_AMOUNT,
      currency: "LKR",
      merchantSecret: TEST_SECRET,
    });
    assert.equal(noOrder.ok, false);

    // Non-positive amount
    const zeroAmount = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: 0,
      currency: "LKR",
      merchantSecret: TEST_SECRET,
    });
    assert.equal(zeroAmount.ok, false);

    // Invalid currency
    const badCurrency = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: TEST_AMOUNT,
      currency: "TOOLONG",
      merchantSecret: TEST_SECRET,
    });
    assert.equal(badCurrency.ok, false);

    // Invalid tenantId
    const badTenant = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: TEST_AMOUNT,
      currency: "LKR",
      merchantSecret: TEST_SECRET,
      tenantId: "INVALID TENANT WITH SPACES",
    });
    assert.equal(badTenant.ok, false);
  });

  it("creates cryptographically chained audit log for PayHere checkout generation", () => {
    const res = generatePayHereCheckoutHash({
      merchantId: TEST_MERCHANT_ID,
      orderId: TEST_ORDER_ID,
      amount: TEST_AMOUNT,
      currency: "LKR",
      merchantSecret: TEST_SECRET,
      tenantId: "heritance-ahungalla",
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const auditRes = createPayHereCheckoutAuditEntry(
      "heritance-ahungalla",
      "actor-cashier-02",
      TEST_ORDER_ID,
      TEST_AMOUNT,
      "LKR",
      res.value,
      "2026-10-18T16:45:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, "heritance-ahungalla");
    assert.equal(audit.action, "GENERATE_PAYHERE_CHECKOUT_HASH");
    assert.equal(audit.entityType, "PaymentCheckout");
    assert.equal(audit.entityId, TEST_ORDER_ID);
    assert.equal(audit.entryHash.length, 64);
  });
});
