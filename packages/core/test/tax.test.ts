import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SRI_LANKA_TAX_CONFIG, roundLkr } from "../src/tax.js";

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
});
