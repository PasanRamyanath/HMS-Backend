import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SRI_LANKA_TAX_CONFIG, calculateForwardTax, roundLkr } from "../src/tax.js";

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
});
