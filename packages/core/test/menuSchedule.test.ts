/**
 * @hms/core - Unit Tests for Sri Lanka Standard Time Menu Window Evaluation.
 *
 * Implements Step 228 (Phase 10.03) of the Sri Lanka HMS Architecture Plan:
 * Tests normal daytime windows, cross-midnight overnight windows, all-day categories,
 * days of week exclusions, and inactive category handling strictly in Asia/Colombo.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CategoryScheduleConfig,
  getSriLankaCurrentTimeComponents,
  isCategoryAvailableNow,
  isValidTimeString,
  parseMenuTimeToMinutes,
} from "../src/index.js";

describe("Step 227 & 228: Time-of-Day Menu Schedule Evaluator (menuSchedule.ts)", () => {
  describe("1. Time String Validation & Minute Parsing", () => {
    it("validates 24-hour HH:mm time format accurately", () => {
      assert.strictEqual(isValidTimeString("00:00"), true);
      assert.strictEqual(isValidTimeString("06:30"), true);
      assert.strictEqual(isValidTimeString("12:00"), true);
      assert.strictEqual(isValidTimeString("23:59"), true);

      // Rejects invalid strings
      assert.strictEqual(isValidTimeString("24:00"), false);
      assert.strictEqual(isValidTimeString("12:60"), false);
      assert.strictEqual(isValidTimeString("6:30"), false);
      assert.strictEqual(isValidTimeString("invalid"), false);
      assert.strictEqual(isValidTimeString(""), false);
    });

    it("converts HH:mm to minutes from midnight correctly", () => {
      assert.strictEqual(parseMenuTimeToMinutes("00:00"), 0);
      assert.strictEqual(parseMenuTimeToMinutes("01:00"), 60);
      assert.strictEqual(parseMenuTimeToMinutes("06:30"), 390);
      assert.strictEqual(parseMenuTimeToMinutes("12:00"), 720);
      assert.strictEqual(parseMenuTimeToMinutes("18:00"), 1080);
      assert.strictEqual(parseMenuTimeToMinutes("23:59"), 1439);
    });
  });

  describe("2. Sri Lanka Standard Time (Asia/Colombo UTC+05:30) Resolution", () => {
    it("resolves UTC date to exact Sri Lanka time components (+05:30 offset)", () => {
      // 2026-10-18T01:00:00Z -> In UTC+05:30 = 06:30 SLST (Sunday)
      const utcDate = new Date("2026-10-18T01:00:00Z");
      const { minutesFromMidnight, timeString, dayOfWeek } =
        getSriLankaCurrentTimeComponents(utcDate);

      assert.strictEqual(timeString, "06:30");
      assert.strictEqual(minutesFromMidnight, 390);
      assert.strictEqual(dayOfWeek, 0); // Sunday
    });

    it("handles evening UTC converting to next day early morning in SLST", () => {
      // 2026-10-18T20:00:00Z (Sunday evening UTC) -> In UTC+05:30 = 01:30 AM (Monday)
      const utcDate = new Date("2026-10-18T20:00:00Z");
      const { timeString, dayOfWeek } = getSriLankaCurrentTimeComponents(utcDate);

      assert.strictEqual(timeString, "01:30");
      assert.strictEqual(dayOfWeek, 1); // Monday
    });
  });

  describe("3. Normal Daytime Window Evaluation (e.g. Breakfast 06:30–10:30)", () => {
    const breakfastCategory: CategoryScheduleConfig = {
      categoryId: "CAT-BREAKFAST-HOPPERS",
      name: "Sri Lankan Breakfast Hoppers",
      isActive: true,
      availableWindow: {
        startTime: "06:30",
        endTime: "10:30",
      },
    };

    it("returns AVAILABLE when current time is inside the window", () => {
      // 08:00 SLST = 02:30 UTC
      const refDate = new Date("2026-10-18T02:30:00Z");
      const res = isCategoryAvailableNow(breakfastCategory, refDate);

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isAvailable, true);
        assert.strictEqual(res.value.status, "AVAILABLE");
        assert.strictEqual(res.value.currentSlTime, "08:00");
        assert.strictEqual(res.value.minutesUntilClose, 150); // 10:30 - 08:00 = 2h 30m = 150m
      }
    });

    it("returns AVAILABLE at exact boundary edges (06:30 and 10:30)", () => {
      // 06:30 SLST = 01:00 UTC
      const startEdge = new Date("2026-10-18T01:00:00Z");
      const startRes = isCategoryAvailableNow(breakfastCategory, startEdge);
      assert.strictEqual(startRes.ok, true);
      if (startRes.ok) {
        assert.strictEqual(startRes.value.isAvailable, true);
      }

      // 10:30 SLST = 05:00 UTC
      const endEdge = new Date("2026-10-18T05:00:00Z");
      const endRes = isCategoryAvailableNow(breakfastCategory, endEdge);
      assert.strictEqual(endRes.ok, true);
      if (endRes.ok) {
        assert.strictEqual(endRes.value.isAvailable, true);
        assert.strictEqual(endRes.value.minutesUntilClose, 0);
      }
    });

    it("returns CLOSED_WINDOW when outside service hours", () => {
      // 11:00 SLST = 05:30 UTC (After breakfast closes)
      const refDate = new Date("2026-10-18T05:30:00Z");
      const res = isCategoryAvailableNow(breakfastCategory, refDate);

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isAvailable, false);
        assert.strictEqual(res.value.status, "CLOSED_WINDOW");
        assert.strictEqual(res.value.currentSlTime, "11:00");
      }
    });
  });

  describe("4. Cross-Midnight / Overnight Window Evaluation (e.g. Bar 18:00–02:00)", () => {
    const nightBarCategory: CategoryScheduleConfig = {
      categoryId: "CAT-NIGHT-BAR",
      name: "Rockland Lounge & Tapas Bar",
      isActive: true,
      availableWindow: {
        startTime: "18:00",
        endTime: "02:00",
      },
    };

    it("returns AVAILABLE in the evening before midnight (e.g. 21:00 SLST)", () => {
      // 21:00 SLST = 15:30 UTC
      const refDate = new Date("2026-10-18T15:30:00Z");
      const res = isCategoryAvailableNow(nightBarCategory, refDate);

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isAvailable, true);
        assert.strictEqual(res.value.status, "AVAILABLE");
        assert.strictEqual(res.value.currentSlTime, "21:00");
        // Remaining time: 3 hours until midnight + 2 hours after midnight = 5 hours = 300 minutes
        assert.strictEqual(res.value.minutesUntilClose, 300);
      }
    });

    it("returns AVAILABLE in early morning past midnight (e.g. 01:15 SLST)", () => {
      // 01:15 SLST on Monday = 19:45 UTC on Sunday
      const refDate = new Date("2026-10-18T19:45:00Z");
      const res = isCategoryAvailableNow(nightBarCategory, refDate);

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isAvailable, true);
        assert.strictEqual(res.value.status, "AVAILABLE");
        assert.strictEqual(res.value.currentSlTime, "01:15");
        // Remaining time: 02:00 - 01:15 = 45 minutes
        assert.strictEqual(res.value.minutesUntilClose, 45);
      }
    });

    it("returns CLOSED_WINDOW during daytime hours (e.g. 14:00 SLST)", () => {
      // 14:00 SLST = 08:30 UTC
      const refDate = new Date("2026-10-18T08:30:00Z");
      const res = isCategoryAvailableNow(nightBarCategory, refDate);

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isAvailable, false);
        assert.strictEqual(res.value.status, "CLOSED_WINDOW");
        assert.strictEqual(res.value.currentSlTime, "14:00");
      }
    });
  });

  describe("5. All-Day Categories & Inactive Categories", () => {
    it("returns AVAILABLE 24/7 when availableWindow is omitted", () => {
      const allDayAmenities: CategoryScheduleConfig = {
        categoryId: "CAT-AMENITIES",
        name: "Housekeeping Linens & Amenities",
        isActive: true,
      };

      const refDate = new Date("2026-10-18T09:00:00Z"); // 14:30 SLST
      const res = isCategoryAvailableNow(allDayAmenities, refDate);

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isAvailable, true);
        assert.strictEqual(res.value.status, "ALL_DAY");
      }
    });

    it("returns INACTIVE when isActive is set to false", () => {
      const seasonalLobster: CategoryScheduleConfig = {
        categoryId: "CAT-LOBSTER",
        name: "Seasonal Lagoon Lobster",
        isActive: false,
        availableWindow: {
          startTime: "18:00",
          endTime: "22:00",
        },
      };

      const refDate = new Date("2026-10-18T13:30:00Z"); // 19:00 SLST
      const res = isCategoryAvailableNow(seasonalLobster, refDate);

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isAvailable, false);
        assert.strictEqual(res.value.status, "INACTIVE");
      }
    });
  });

  describe("6. Days of Week Scheduling & Validation Errors", () => {
    it("enforces daysOfWeek filtering (e.g. Sunday Brunch only)", () => {
      const sundayBrunch: CategoryScheduleConfig = {
        categoryId: "CAT-SUNDAY-BRUNCH",
        name: "Galle Face Sunday Champagne Brunch",
        isActive: true,
        availableWindow: {
          startTime: "11:00",
          endTime: "16:00",
          daysOfWeek: [0], // Sunday only
        },
      };

      // Sunday 12:00 SLST = 06:30 UTC on 2026-10-18
      const sundayDate = new Date("2026-10-18T06:30:00Z");
      const sunRes = isCategoryAvailableNow(sundayBrunch, sundayDate);
      assert.strictEqual(sunRes.ok, true);
      if (sunRes.ok) {
        assert.strictEqual(sunRes.value.isAvailable, true);
      }

      // Monday 12:00 SLST = 06:30 UTC on 2026-10-19
      const mondayDate = new Date("2026-10-19T06:30:00Z");
      const monRes = isCategoryAvailableNow(sundayBrunch, mondayDate);
      assert.strictEqual(monRes.ok, true);
      if (monRes.ok) {
        assert.strictEqual(monRes.value.isAvailable, false);
        assert.strictEqual(monRes.value.status, "DAY_EXCLUDED");
      }
    });

    it("returns VALIDATION_FAILED when categoryId is blank", () => {
      const invalidConfig: CategoryScheduleConfig = {
        categoryId: "",
        isActive: true,
      };
      const res = isCategoryAvailableNow(invalidConfig);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });

    it("returns VALIDATION_FAILED on invalid time strings", () => {
      const invalidWindow: CategoryScheduleConfig = {
        categoryId: "CAT-BAD",
        isActive: true,
        availableWindow: {
          startTime: "25:00",
          endTime: "10:30",
        },
      };
      const res = isCategoryAvailableNow(invalidWindow);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });
  });
});
