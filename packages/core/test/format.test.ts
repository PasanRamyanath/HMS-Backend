import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SRI_LANKA_TIMEZONE,
  formatLkr,
  formatSlDate,
  formatSlDateTime,
  formatSlIsoDate,
  formatUsd,
  roundLkr,
} from "../src/format.js";

describe("Sri Lankan Currency & Asia/Colombo Date Helpers", () => {
  it("rounds currency amounts to integer cents with epsilon guard", () => {
    assert.equal(roundLkr(45000.124), 45000.12);
    assert.equal(roundLkr(45000.126), 45000.13);
    assert.equal(roundLkr(1.005), 1.01);
    assert.equal(roundLkr(Number.NaN), 0);
  });

  it("formats LKR currency amounts with tabular spacing", () => {
    assert.equal(formatLkr(45000), "LKR 45,000.00");
    assert.equal(formatLkr(0), "LKR 0.00");
    assert.equal(formatLkr(1234567.89), "LKR 1,234,567.89");
  });

  it("formats USD currency amounts with tabular spacing", () => {
    assert.equal(formatUsd(150), "USD 150.00");
    assert.equal(formatUsd(2450.5), "USD 2,450.50");
  });

  it("formats dates in Asia/Colombo timezone", () => {
    // 2026-10-18T20:00:00Z is 2026-10-19 01:30 in Asia/Colombo (UTC+5:30)
    const utcMidnight = "2026-10-18T20:00:00Z";
    assert.equal(formatSlDate(utcMidnight), "19 Oct 2026");
    assert.equal(formatSlIsoDate(utcMidnight), "2026-10-19");
  });

  it("formats date and 24h time in Asia/Colombo timezone", () => {
    const timestamp = "2026-10-18T12:30:00Z";
    // 12:30 UTC + 5:30 = 18:00 Colombo
    const formatted = formatSlDateTime(timestamp);
    assert.match(formatted, /18 Oct 2026/);
    assert.match(formatted, /18:00:00/);
  });

  it("gracefully handles invalid date inputs", () => {
    assert.equal(formatSlDate("invalid-date-string"), "Invalid Date");
    assert.equal(formatSlDateTime("invalid-date-string"), "Invalid Date");
    assert.equal(formatSlIsoDate("invalid-date-string"), "Invalid Date");
  });

  it("exports correct constant for Sri Lanka timezone", () => {
    assert.equal(SRI_LANKA_TIMEZONE, "Asia/Colombo");
  });
});
