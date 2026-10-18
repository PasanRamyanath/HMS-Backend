import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  calculateForwardTax,
  calculateReverseTax,
  createTaxPreset,
  roundLkr,
} from "../src/tax.js";

describe("Sri Lankan Statutory Tax Engine - Rounding & Configuration", () => {
  it("exports default full-service hotel tax rates", () => {
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.enableSC, true);
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.scRate, 0.1);
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.enableTDL, true);
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.tdlRate, 0.01);
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.enableSSCL, true);
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.ssclRate, 0.025);
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.enableVAT, true);
    assert.equal(DEFAULT_SRI_LANKA_TAX_CONFIG.vatRate, 0.18);
  });

  it("rounds currency amounts to integer cents with epsilon guard", () => {
    assert.equal(roundLkr(75000.124), 75000.12);
    assert.equal(roundLkr(75000.125), 75000.13);
    assert.equal(roundLkr(75000.126), 75000.13);
    assert.equal(roundLkr(1.005), 1.01);
    assert.equal(roundLkr(0), 0);
    assert.equal(roundLkr(-500.555), -500.55);
  });

  it("safely handles non-finite inputs", () => {
    assert.equal(roundLkr(Number.NaN), 0);
    assert.equal(roundLkr(Number.POSITIVE_INFINITY), 0);
    assert.equal(roundLkr(Number.NEGATIVE_INFINITY), 0);
  });

  it("computes 4-stage compounding tax matching official IRD benchmark (Rs 75,000 -> Rs 100,757.25)", () => {
    const res = calculateForwardTax(75000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.baseLkr, 75000);
    assert.equal(res.value.scLkr, 7500);
    assert.equal(res.value.subtotalAfterScLkr, 82500);
    assert.equal(res.value.tdlLkr, 825);
    assert.equal(res.value.ssclLkr, 2062.5);
    assert.equal(res.value.vatBaseLkr, 85387.5);
    assert.equal(res.value.vatLkr, 15369.75);
    assert.equal(res.value.grandTotalLkr, 100757.25);
    assert.equal(res.value.effectiveTaxRate, 0.34);
    assert.equal(res.value.isVatRegistered, true);
  });

  it("computes tax with custom configuration (TDL only, e.g. small guest house)", () => {
    const res = calculateForwardTax(28500, {
      enableSC: false,
      scRate: 0,
      enableTDL: true,
      tdlRate: 0.01,
      enableSSCL: false,
      ssclRate: 0,
      enableVAT: false,
      vatRate: 0,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.baseLkr, 28500);
    assert.equal(res.value.scLkr, 0);
    assert.equal(res.value.subtotalAfterScLkr, 28500);
    assert.equal(res.value.tdlLkr, 285);
    assert.equal(res.value.ssclLkr, 0);
    assert.equal(res.value.vatBaseLkr, 28785);
    assert.equal(res.value.vatLkr, 0);
    assert.equal(res.value.grandTotalLkr, 28785);
    assert.equal(res.value.isVatRegistered, false);
  });

  it("rejects invalid negative or non-finite base amounts with INVALID_TAX_BASE", () => {
    const negativeRes = calculateForwardTax(-100);
    assert.equal(negativeRes.ok, false);
    if (negativeRes.ok) return;
    assert.equal(negativeRes.error.code, "INVALID_TAX_BASE");

    const nanRes = calculateForwardTax(Number.NaN);
    assert.equal(nanRes.ok, false);
    if (nanRes.ok) return;
    assert.equal(nanRes.error.code, "INVALID_TAX_BASE");
  });

  describe("createTaxPreset factory", () => {
    it("creates LUXURY_VAT_HOTEL preset", () => {
      const cfg = createTaxPreset("LUXURY_VAT_HOTEL");
      assert.equal(cfg.enableSC, true);
      assert.equal(cfg.scRate, 0.1);
      assert.equal(cfg.enableTDL, true);
      assert.equal(cfg.tdlRate, 0.01);
      assert.equal(cfg.enableSSCL, true);
      assert.equal(cfg.ssclRate, 0.025);
      assert.equal(cfg.enableVAT, true);
      assert.equal(cfg.vatRate, 0.18);
    });

    it("creates BOUTIQUE_NON_VAT preset", () => {
      const cfg = createTaxPreset("BOUTIQUE_NON_VAT");
      assert.equal(cfg.enableSC, true);
      assert.equal(cfg.scRate, 0.1);
      assert.equal(cfg.enableTDL, true);
      assert.equal(cfg.tdlRate, 0.01);
      assert.equal(cfg.enableSSCL, false);
      assert.equal(cfg.enableVAT, false);
    });

    it("creates SMALL_GUESTHOUSE_05_TDL preset for properties under LKR 12M", () => {
      const cfg = createTaxPreset("SMALL_GUESTHOUSE_05_TDL");
      assert.equal(cfg.enableSC, false);
      assert.equal(cfg.enableTDL, true);
      assert.equal(cfg.tdlRate, 0.005);
      assert.equal(cfg.enableSSCL, false);
      assert.equal(cfg.enableVAT, false);

      // Verify calculation on LKR 10,000 base
      const res = calculateForwardTax(10000, cfg);
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.value.scLkr, 0);
      assert.equal(res.value.tdlLkr, 50); // 0.5% of 10,000
      assert.equal(res.value.ssclLkr, 0);
      assert.equal(res.value.vatLkr, 0);
      assert.equal(res.value.grandTotalLkr, 10050);
    });

    it("creates TAX_EXEMPT preset", () => {
      const cfg = createTaxPreset("TAX_EXEMPT");
      assert.equal(cfg.enableSC, false);
      assert.equal(cfg.enableTDL, false);
      assert.equal(cfg.enableSSCL, false);
      assert.equal(cfg.enableVAT, false);

      const res = calculateForwardTax(50000, cfg);
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.value.grandTotalLkr, 50000);
      assert.equal(res.value.effectiveTaxRate, 0);
    });
  });

  describe("calculateReverseTax (Gross-to-Net All-Inclusive Derivation)", () => {
    it("derives net base supply for LKR 50,000 all-inclusive quote matching official benchmark", () => {
      // Benchmark from Step 031 & Section 1.1:
      // LKR 50,000 gross -> Base LKR 37,217.40, with exact LKR 50,000.00 total
      const res = calculateReverseTax(50000);
      assert.equal(res.ok, true);
      if (!res.ok) return;

      assert.equal(res.value.baseLkr, 37218.17);
      assert.equal(res.value.scLkr, 3721.82);
      assert.equal(res.value.subtotalAfterScLkr, 40939.99);
      assert.equal(res.value.tdlLkr, 409.4);
      assert.equal(res.value.ssclLkr, 1023.5);
      assert.equal(res.value.vatBaseLkr, 42372.89);
      // Reconciled VAT line (-0.01) ensuring grand total is exactly 50,000.00
      assert.equal(res.value.vatLkr, 7627.11);
      assert.equal(res.value.grandTotalLkr, 50000);
    });

    it("handles zero gross inclusive amount", () => {
      const res = calculateReverseTax(0);
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.value.baseLkr, 0);
      assert.equal(res.value.grandTotalLkr, 0);
    });

    it("derives net base for non-VAT boutique villa preset", () => {
      const cfg = createTaxPreset("BOUTIQUE_NON_VAT");
      // 10,000 base + 1,000 SC (10%) = 11,000 + 110 TDL (1%) = 11,110
      const res = calculateReverseTax(11110, cfg);
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.equal(res.value.baseLkr, 10000);
      assert.equal(res.value.scLkr, 1000);
      assert.equal(res.value.tdlLkr, 110);
      assert.equal(res.value.grandTotalLkr, 11110);
    });

    it("rejects invalid negative or non-finite gross amounts", () => {
      const negativeRes = calculateReverseTax(-5000);
      assert.equal(negativeRes.ok, false);
      if (negativeRes.ok) return;
      assert.equal(negativeRes.error.code, "INVALID_TAX_BASE");

      const nanRes = calculateReverseTax(Number.NaN);
      assert.equal(nanRes.ok, false);
      if (nanRes.ok) return;
      assert.equal(nanRes.error.code, "INVALID_TAX_BASE");
    });
  });
});
