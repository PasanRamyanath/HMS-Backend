import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDualCurrencyTaxBreakdown,
  convertForeignToLkrBase,
  createCurrencyLockAuditEntry,
  formatForeignCurrency,
  isSupportedForeignCurrency,
  lockExchangeRate,
} from "../src/currencyLock.js";
import { createTaxPreset } from "../src/tax.js";

describe("Foreign Currency (USD/EUR/GBP) to LKR Invoice Lock Converter", () => {
  it("identifies supported foreign currencies correctly", () => {
    assert.equal(isSupportedForeignCurrency("USD"), true);
    assert.equal(isSupportedForeignCurrency("EUR"), true);
    assert.equal(isSupportedForeignCurrency("GBP"), true);
    assert.equal(isSupportedForeignCurrency("JPY"), false);
    assert.equal(isSupportedForeignCurrency("LKR"), false);
  });

  it("formats foreign currencies with standard international notation", () => {
    assert.equal(formatForeignCurrency(250, "USD"), "USD 250.00");
    assert.equal(formatForeignCurrency(180.5, "EUR"), "EUR 180.50");
    assert.equal(formatForeignCurrency(99.99, "GBP"), "GBP 99.99");
  });

  describe("convertForeignToLkrBase", () => {
    it("converts USD to LKR base accurately", () => {
      // 250 USD @ 305.50 = 76,375.00 LKR
      const result = convertForeignToLkrBase(250, 305.5);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value, 76375);
      }
    });

    it("converts EUR to LKR base accurately", () => {
      // 180 EUR @ 332.25 = 59,805.00 LKR
      const result = convertForeignToLkrBase(180, 332.25);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value, 59805);
      }
    });

    it("converts GBP to LKR base accurately", () => {
      // 120 GBP @ 395.10 = 47,412.00 LKR
      const result = convertForeignToLkrBase(120, 395.1);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value, 47412);
      }
    });

    it("rejects negative foreign amount", () => {
      const result = convertForeignToLkrBase(-100, 305.5);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "INVALID_TAX_BASE");
      }
    });

    it("rejects zero or negative exchange rate", () => {
      const zeroRate = convertForeignToLkrBase(100, 0);
      assert.equal(zeroRate.ok, false);
      if (!zeroRate.ok) {
        assert.equal(zeroRate.error.code, "INVALID_EXCHANGE_RATE");
      }

      const negativeRate = convertForeignToLkrBase(100, -305.5);
      assert.equal(negativeRate.ok, false);
      if (!negativeRate.ok) {
        assert.equal(negativeRate.error.code, "INVALID_EXCHANGE_RATE");
      }
    });
  });

  describe("lockExchangeRate", () => {
    it("locks check-in exchange rate with dual-currency display strings", () => {
      const result = lockExchangeRate({
        tenantId: "cinnamon-grand-colombo",
        reservationId: "RES-9872",
        foreignCurrency: "USD",
        foreignAmount: 250,
        lockedExchangeRateLkr: 305.5,
        rateSource: "CBSL_INDICATIVE",
        lockedAtIso: "2026-10-18T14:30:00.000Z",
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      const conv = result.value;
      assert.equal(conv.tenantId, "cinnamon-grand-colombo");
      assert.equal(conv.reservationId, "RES-9872");
      assert.equal(conv.foreignCurrency, "USD");
      assert.equal(conv.foreignAmount, 250);
      assert.equal(conv.lockedExchangeRateLkr, 305.5);
      assert.equal(conv.baseLkr, 76375);
      assert.equal(conv.formattedForeign, "USD 250.00");
      assert.equal(conv.formattedLkr, "LKR 76,375.00");
      assert.equal(conv.displaySummary, "USD 250.00 @ 305.50 -> LKR 76,375.00");
    });

    it("rejects invalid tenant identifier slug", () => {
      const result = lockExchangeRate({
        tenantId: "INVALID!!",
        foreignCurrency: "USD",
        foreignAmount: 100,
        lockedExchangeRateLkr: 300,
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "VALIDATION_FAILED");
      }
    });
  });

  describe("computeDualCurrencyTaxBreakdown", () => {
    it("computes 4-stage taxes on converted LKR supply base with dual-currency breakdown", () => {
      const result = computeDualCurrencyTaxBreakdown(250, {
        foreignCurrency: "USD",
        lockedExchangeRateLkr: 300, // 250 * 300 = 75,000 LKR base
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      const breakdown = result.value;
      // 75,000 LKR base matches the official IRD benchmark:
      // Base: 75,000
      // SC (10%): 7,500
      // Subtotal A: 82,500
      // TDL (1%): 825
      // SSCL (2.5%): 2,062.50
      // VAT Base: 85,387.50
      // VAT (18%): 15,369.75
      // Grand Total: 100,757.25 LKR
      assert.equal(breakdown.baseLkr, 75000);
      assert.equal(breakdown.scLkr, 7500);
      assert.equal(breakdown.tdlLkr, 825);
      assert.equal(breakdown.ssclLkr, 2062.5);
      assert.equal(breakdown.vatLkr, 15369.75);
      assert.equal(breakdown.grandTotalLkr, 100757.25);

      // Foreign grand total: 100,757.25 / 300 = 335.86 USD
      assert.equal(breakdown.foreignGrandTotal, 335.86);
      assert.equal(breakdown.formattedForeignGrandTotal, "USD 335.86");
      assert.equal(breakdown.formattedLkrGrandTotal, "LKR 100,757.25");
      assert.match(
        breakdown.guestDualCurrencyNotice,
        /Statutory tax invoice issued in Sri Lankan Rupees/,
      );
      assert.match(breakdown.guestDualCurrencyNotice, /1 USD = 300\.00 LKR/);
    });

    it("supports custom tax presets (e.g. BOUTIQUE_NON_VAT)", () => {
      const nonVatPreset = createTaxPreset("BOUTIQUE_NON_VAT");
      const result = computeDualCurrencyTaxBreakdown(100, {
        foreignCurrency: "EUR",
        lockedExchangeRateLkr: 320, // 32,000 LKR base
        taxConfig: nonVatPreset,
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.vatLkr, 0);
      assert.equal(result.value.baseLkr, 32000);
    });
  });

  describe("createCurrencyLockAuditEntry", () => {
    it("creates a cryptographically chained SHA-256 audit entry for currency lock", () => {
      const convRes = lockExchangeRate({
        tenantId: "anantara-peace-haven",
        reservationId: "RES-4001",
        foreignCurrency: "GBP",
        foreignAmount: 500,
        lockedExchangeRateLkr: 390,
      });

      assert.equal(convRes.ok, true);
      if (!convRes.ok) return;

      const auditRes = createCurrencyLockAuditEntry(
        "anantara-peace-haven",
        "actor-receptionist-01",
        "RES-4001",
        convRes.value,
        "2026-10-18T12:00:00.000Z",
      );

      assert.equal(auditRes.ok, true);
      if (!auditRes.ok) return;

      const audit = auditRes.value;
      assert.equal(audit.tenantId, "anantara-peace-haven");
      assert.equal(audit.action, "LOCK_RESERVATION_EXCHANGE_RATE");
      assert.equal(audit.entityType, "Reservation");
      assert.equal(audit.entityId, "RES-4001");
      assert.equal(audit.entryHash.length, 64);
    });
  });
});
