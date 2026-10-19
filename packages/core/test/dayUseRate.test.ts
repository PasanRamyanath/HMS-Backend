import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyAuditChain } from "../src/auditChain.js";
import {
  DEFAULT_LATE_CHECKOUT_POLICY,
  calculateDayUseRate,
  calculateLateCheckoutFee,
  parseTimeToMinutes,
} from "../src/dayUseRate.js";
import { calculateForwardTax, calculateReverseTax, roundLkr } from "../src/tax.js";

describe("Late Check-Out & Day-Use Room Rate Calculator (dayUseRate.ts)", () => {
  const validTenant = "heritance-kandalama";
  const frontDeskActor = { actorUserId: "usr-fd-001", role: "FRONT_DESK" };
  const adminActor = { actorUserId: "usr-adm-001", role: "HOTEL_ADMIN" };
  const activeSub = { tenantId: validTenant, active: true, tier: "PRO" };

  describe("1. Time String Parsing (parseTimeToMinutes)", () => {
    it("parses valid 24h times correctly into minutes from midnight", () => {
      const t0 = parseTimeToMinutes("00:00");
      assert.strictEqual(t0.ok, true);
      if (t0.ok) assert.strictEqual(t0.value, 0);

      const t1 = parseTimeToMinutes("11:00");
      assert.strictEqual(t1.ok, true);
      if (t1.ok) assert.strictEqual(t1.value, 660);

      const t2 = parseTimeToMinutes("18:00");
      assert.strictEqual(t2.ok, true);
      if (t2.ok) assert.strictEqual(t2.value, 1080);

      const t3 = parseTimeToMinutes("23:59");
      assert.strictEqual(t3.ok, true);
      if (t3.ok) assert.strictEqual(t3.value, 1439);
    });

    it("rejects invalid time strings", () => {
      assert.strictEqual(parseTimeToMinutes("24:00").ok, false);
      assert.strictEqual(parseTimeToMinutes("12:60").ok, false);
      assert.strictEqual(parseTimeToMinutes("9:00").ok, false);
      assert.strictEqual(parseTimeToMinutes("invalid").ok, false);
      // @ts-expect-error non-string
      assert.strictEqual(parseTimeToMinutes(null).ok, false);
    });
  });

  describe("2. Late Check-Out Fee Calculations (Rung 6: Grace, 50% Half-Day, 100% Full-Night)", () => {
    const baseDailyRateLkr = 25000;

    it("exposes default Sri Lankan late checkout policy parameters", () => {
      assert.strictEqual(DEFAULT_LATE_CHECKOUT_POLICY.standardCheckoutTime, "11:00");
      assert.strictEqual(DEFAULT_LATE_CHECKOUT_POLICY.gracePeriodMinutes, 30);
      assert.strictEqual(DEFAULT_LATE_CHECKOUT_POLICY.halfDayCutoffTime, "18:00");
      assert.strictEqual(DEFAULT_LATE_CHECKOUT_POLICY.halfDayMultiplier, 0.5);
      assert.strictEqual(DEFAULT_LATE_CHECKOUT_POLICY.fullNightMultiplier, 1.0);
    });

    it("applies GRACE_PERIOD (zero fee) for departures within grace window", () => {
      // standard 11:00 + 30 min grace = up to 11:30
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-001",
        roomNumber: "204",
        baseDailyRateLkr,
        actualCheckoutTime: "11:25",
        authorizedBy: frontDeskActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.tier, "GRACE_PERIOD");
        assert.strictEqual(res.value.multiplier, 0);
        assert.strictEqual(res.value.taxableBaseLkr, 0);
        assert.strictEqual(res.value.totalChargeLkr, 0);
        assert.strictEqual(res.value.folioLineDraft.totalLkr, 0);
        assert.strictEqual(res.value.isComplimentary, false);
      }
    });

    it("applies HALF_DAY (50% charge) for departures between grace and 18:00", () => {
      // 14:30 departure -> 50% of 25,000 LKR = 12,500 LKR base
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-002",
        roomNumber: "305",
        baseDailyRateLkr,
        actualCheckoutTime: "14:30",
        authorizedBy: frontDeskActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.tier, "HALF_DAY");
        assert.strictEqual(res.value.multiplier, 0.5);
        assert.strictEqual(res.value.taxableBaseLkr, 12500);

        // Verify standard Sri Lankan 4-stage tax compounding on 12,500 LKR base
        const expectedTax = calculateForwardTax(12500);
        assert.strictEqual(expectedTax.ok, true);
        if (expectedTax.ok) {
          assert.strictEqual(res.value.taxBreakdown.scLkr, expectedTax.value.scLkr);
          assert.strictEqual(res.value.taxBreakdown.tdlLkr, expectedTax.value.tdlLkr);
          assert.strictEqual(res.value.taxBreakdown.ssclLkr, expectedTax.value.ssclLkr);
          assert.strictEqual(res.value.taxBreakdown.vatLkr, expectedTax.value.vatLkr);
          assert.strictEqual(res.value.totalChargeLkr, expectedTax.value.grandTotalLkr);
        }

        assert.strictEqual(res.value.folioLineDraft.code, "LATE_CHECKOUT_FEE");
        assert.ok(res.value.folioLineDraft.description.includes("Half-Day"));
      }
    });

    it("applies HALF_DAY exactly at 18:00 cutoff boundary", () => {
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-003",
        roomNumber: "108",
        baseDailyRateLkr,
        actualCheckoutTime: "18:00",
        authorizedBy: frontDeskActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.tier, "HALF_DAY");
        assert.strictEqual(res.value.multiplier, 0.5);
        assert.strictEqual(res.value.taxableBaseLkr, 12500);
      }
    });

    it("applies FULL_NIGHT (100% charge) for departures past 18:00 (e.g. 18:01)", () => {
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-004",
        roomNumber: "108",
        baseDailyRateLkr,
        actualCheckoutTime: "18:01",
        authorizedBy: frontDeskActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.tier, "FULL_NIGHT");
        assert.strictEqual(res.value.multiplier, 1.0);
        assert.strictEqual(res.value.taxableBaseLkr, 25000);

        const expectedTax = calculateForwardTax(25000);
        assert.strictEqual(expectedTax.ok, true);
        if (expectedTax.ok) {
          assert.strictEqual(res.value.totalChargeLkr, expectedTax.value.grandTotalLkr);
        }
        assert.ok(res.value.folioLineDraft.description.includes("Full-Night"));
      }
    });

    it("waives fee when flagged as COMPLIMENTARY with audit log", () => {
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-005",
        roomNumber: "401",
        baseDailyRateLkr,
        actualCheckoutTime: "16:00",
        isComplimentary: true,
        complimentaryReason: "GM approved loyalty perk for SLTDA VIP delegate",
        authorizedBy: adminActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.tier, "COMPLIMENTARY");
        assert.strictEqual(res.value.multiplier, 0);
        assert.strictEqual(res.value.taxableBaseLkr, 0);
        assert.strictEqual(res.value.totalChargeLkr, 0);
        assert.strictEqual(res.value.isComplimentary, true);
        assert.ok(res.value.folioLineDraft.description.includes("Complimentary"));

        const auditJson = JSON.parse(res.value.auditEntry.afterJson);
        assert.strictEqual(auditJson.isComplimentary, true);
        assert.strictEqual(
          auditJson.complimentaryReason,
          "GM approved loyalty perk for SLTDA VIP delegate",
        );
      }
    });

    it("supports custom LateCheckoutPolicy thresholds", () => {
      const customPolicy = {
        standardCheckoutTime: "12:00",
        gracePeriodMinutes: 60, // grace until 13:00
        halfDayCutoffTime: "19:00",
        halfDayMultiplier: 0.6,
        fullNightMultiplier: 1.0,
      };

      // 12:45 is within 60 min grace
      const graceRes = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-006",
        roomNumber: "502",
        baseDailyRateLkr,
        actualCheckoutTime: "12:45",
        policy: customPolicy,
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(graceRes.ok, true);
      if (graceRes.ok) {
        assert.strictEqual(graceRes.value.tier, "GRACE_PERIOD");
      }

      // 18:30 is before 19:00 cutoff -> 60%
      const halfDayRes = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-006",
        roomNumber: "502",
        baseDailyRateLkr,
        actualCheckoutTime: "18:30",
        policy: customPolicy,
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(halfDayRes.ok, true);
      if (halfDayRes.ok) {
        assert.strictEqual(halfDayRes.value.tier, "HALF_DAY");
        assert.strictEqual(halfDayRes.value.multiplier, 0.6);
        assert.strictEqual(halfDayRes.value.taxableBaseLkr, 15000);
      }
    });

    it("supports TAX_INCLUSIVE reverse tax deduction", () => {
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-007",
        roomNumber: "201",
        baseDailyRateLkr: 30000,
        actualCheckoutTime: "15:00", // half-day gross = 15,000
        pricingModel: "TAX_INCLUSIVE",
        authorizedBy: frontDeskActor,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.pricingModel, "TAX_INCLUSIVE");
        const rev = calculateReverseTax(15000);
        assert.strictEqual(rev.ok, true);
        if (rev.ok) {
          assert.strictEqual(res.value.totalChargeLkr, 15000);
          assert.strictEqual(res.value.taxableBaseLkr, rev.value.baseLkr);
          assert.strictEqual(res.value.taxBreakdown.vatLkr, rev.value.vatLkr);
        }
      }
    });

    it("supports foreign currency USD conversion with locked exchange rate", () => {
      const exchangeRateUsdLkr = 305.5;
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-008",
        roomNumber: "601",
        baseDailyRateLkr: 61100, // ~ 200 USD
        actualCheckoutTime: "17:00",
        currency: "USD",
        exchangeRateUsdLkr,
        residencyTier: "FOREIGN",
        authorizedBy: frontDeskActor,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.currency, "USD");
        assert.strictEqual(res.value.exchangeRateUsdLkr, exchangeRateUsdLkr);
        assert.ok(typeof res.value.foreignAmount === "number");
        const expectedForeign = roundLkr(res.value.totalChargeLkr / exchangeRateUsdLkr);
        assert.strictEqual(res.value.foreignAmount, expectedForeign);
        assert.strictEqual(res.value.folioLineDraft.foreignAmount, expectedForeign);
      }
    });
  });

  describe("3. Transit / Day-Use Room Rate Calculations (Katunayake & Colombo)", () => {
    const overnightRateLkr = 20000;

    it("calculates standard 4-hour transit stay (35% rate)", () => {
      const res = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "101",
        date: "2026-10-25",
        checkInTime: "08:00",
        checkOutTime: "12:00",
        baseOvernightRateLkr: overnightRateLkr,
        packageType: "TRANSIT_4HR",
        authorizedBy: frontDeskActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.durationHours, 4.0);
        assert.strictEqual(res.value.multiplier, 0.35);
        assert.strictEqual(res.value.taxableBaseLkr, 7000);
        assert.strictEqual(res.value.isExtendedPast1800, false);
        assert.strictEqual(res.value.folioLineDraft.code, "DAY_USE_ROOM_CHARGE");
        assert.ok(res.value.folioLineDraft.description.includes("TRANSIT_4HR"));
      }
    });

    it("calculates 8-hour transit stay (50% rate)", () => {
      const res = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "102",
        date: "2026-10-25",
        checkInTime: "09:00",
        checkOutTime: "17:00",
        baseOvernightRateLkr: overnightRateLkr,
        packageType: "TRANSIT_8HR",
        authorizedBy: frontDeskActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.durationHours, 8.0);
        assert.strictEqual(res.value.multiplier, 0.5);
        assert.strictEqual(res.value.taxableBaseLkr, 10000);
        assert.strictEqual(res.value.isExtendedPast1800, false);
      }
    });

    it("automatically escalates to 100% full overnight rate when departure exceeds 18:00", () => {
      // Guest arrived at 10:00, transit flight delayed, departs at 19:30
      const res = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "103",
        date: "2026-10-25",
        checkInTime: "10:00",
        checkOutTime: "19:30",
        baseOvernightRateLkr: overnightRateLkr,
        packageType: "HALF_DAY_DAY_USE",
        authorizedBy: frontDeskActor,
        subscription: activeSub,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.durationHours, 9.5);
        assert.strictEqual(res.value.isExtendedPast1800, true);
        assert.strictEqual(res.value.multiplier, 1.0);
        assert.strictEqual(res.value.taxableBaseLkr, 20000);
        assert.ok(res.value.folioLineDraft.description.includes("Extended past 18:00"));
      }
    });

    it("supports foreign USD locked rate for day use transit", () => {
      const exchangeRate = 300;
      const res = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "105",
        date: "2026-10-25",
        checkInTime: "07:00",
        checkOutTime: "15:00",
        baseOvernightRateLkr: 30000,
        currency: "USD",
        exchangeRateUsdLkr: exchangeRate,
        residencyTier: "FOREIGN",
        authorizedBy: frontDeskActor,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.currency, "USD");
        assert.ok(typeof res.value.foreignAmount === "number");
        assert.strictEqual(
          res.value.foreignAmount,
          roundLkr(res.value.totalChargeLkr / exchangeRate),
        );
      }
    });

    it("rejects when check-out time is earlier than or equal to check-in time", () => {
      const res = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "106",
        date: "2026-10-25",
        checkInTime: "14:00",
        checkOutTime: "12:00",
        baseOvernightRateLkr: overnightRateLkr,
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });
  });

  describe("4. Multi-Tenant Isolation & SaaS Subscription Entitlement Guards", () => {
    it("rejects invalid tenant slug syntax", () => {
      const res = calculateLateCheckoutFee({
        tenantId: "INVALID TENANT!!",
        reservationId: "res-bad",
        roomNumber: "101",
        baseDailyRateLkr: 15000,
        actualCheckoutTime: "14:00",
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });

    it("rejects subscription tenant mismatch", () => {
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-001",
        roomNumber: "101",
        baseDailyRateLkr: 15000,
        actualCheckoutTime: "14:00",
        authorizedBy: frontDeskActor,
        subscription: { tenantId: "other-hotel-slug", active: true },
      });
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects when SaaS subscription is inactive or suspended", () => {
      const res = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "101",
        date: "2026-10-25",
        checkInTime: "08:00",
        checkOutTime: "14:00",
        baseOvernightRateLkr: 15000,
        authorizedBy: frontDeskActor,
        subscription: { tenantId: validTenant, active: false },
      });
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "QUOTA_EXCEEDED");
      }
    });
  });

  describe("5. Role-Based Access Control (RBAC)", () => {
    it("permits authorized roles (SUPER_ADMIN, HOTEL_ADMIN, FRONT_DESK, RESERVATIONIST, CASHIER)", () => {
      const authorizedRoles = [
        "SUPER_ADMIN",
        "HOTEL_ADMIN",
        "HOTEL_OWNER",
        "GENERAL_MANAGER",
        "FRONT_DESK",
        "RESERVATIONIST",
        "CASHIER",
      ];
      for (const role of authorizedRoles) {
        const res = calculateLateCheckoutFee({
          tenantId: validTenant,
          reservationId: `res-${role}`,
          roomNumber: "202",
          baseDailyRateLkr: 10000,
          actualCheckoutTime: "13:00",
          authorizedBy: { actorUserId: `user-${role}`, role },
        });
        assert.strictEqual(res.ok, true, `Expected role ${role} to be authorized`);
      }
    });

    it("rejects unauthorized roles (HOUSEKEEPING, KITCHEN_KDS, WAITER, GUEST)", () => {
      const forbiddenRoles = ["HOUSEKEEPING", "KITCHEN_KDS", "WAITER", "GUEST", "UNKNOWN"];
      for (const role of forbiddenRoles) {
        const res = calculateLateCheckoutFee({
          tenantId: validTenant,
          reservationId: "res-forbidden",
          roomNumber: "202",
          baseDailyRateLkr: 10000,
          actualCheckoutTime: "13:00",
          authorizedBy: { actorUserId: "user-unauth", role },
        });
        assert.strictEqual(res.ok, false, `Expected role ${role} to be rejected`);
        if (!res.ok) {
          assert.strictEqual(res.error.code, "UNAUTHORIZED");
        }
      }
    });
  });

  describe("6. SHA-256 Hash-Chained Immutable Audit Log Generation", () => {
    it("generates a cryptographically valid audit log entry for late check-out", () => {
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-audit-01",
        roomNumber: "301",
        baseDailyRateLkr: 20000,
        actualCheckoutTime: "16:00",
        authorizedBy: frontDeskActor,
        isoTimestamp: "2026-10-25T10:30:00.000Z",
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const audit = res.value.auditEntry;
        assert.strictEqual(audit.tenantId, validTenant);
        assert.strictEqual(audit.actorUserId, frontDeskActor.actorUserId);
        assert.strictEqual(audit.action, "CALCULATE_LATE_CHECKOUT_FEE");
        assert.strictEqual(audit.entityType, "RESERVATION");
        assert.strictEqual(audit.entityId, "res-audit-01");
        assert.strictEqual(audit.entryHash.length, 64);

        const verifyRes = verifyAuditChain([audit]);
        assert.strictEqual(verifyRes.ok, true);
      }
    });

    it("generates a cryptographically valid audit log entry for day-use room rate", () => {
      const res = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "302",
        date: "2026-10-25",
        checkInTime: "09:00",
        checkOutTime: "17:00",
        baseOvernightRateLkr: 20000,
        authorizedBy: frontDeskActor,
        isoTimestamp: "2026-10-25T03:30:00.000Z",
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const audit = res.value.auditEntry;
        assert.strictEqual(audit.tenantId, validTenant);
        assert.strictEqual(audit.action, "CALCULATE_DAY_USE_ROOM_CHARGE");
        assert.strictEqual(audit.entityType, "DAY_USE_ROOM");
        assert.strictEqual(audit.entryHash.length, 64);

        const verifyRes = verifyAuditChain([audit]);
        assert.strictEqual(verifyRes.ok, true);
      }
    });
  });

  describe("7. Input Validation & Edge Cases", () => {
    it("rejects missing reservationId or roomNumber in late checkout", () => {
      const res1 = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "",
        roomNumber: "101",
        baseDailyRateLkr: 10000,
        actualCheckoutTime: "14:00",
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(res1.ok, false);

      const res2 = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-01",
        roomNumber: "",
        baseDailyRateLkr: 10000,
        actualCheckoutTime: "14:00",
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(res2.ok, false);
    });

    it("rejects negative or invalid base daily rate", () => {
      const res = calculateLateCheckoutFee({
        tenantId: validTenant,
        reservationId: "res-01",
        roomNumber: "101",
        baseDailyRateLkr: -500,
        actualCheckoutTime: "14:00",
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(res.ok, false);
    });

    it("rejects invalid date or roomNumber in day-use rate calculation", () => {
      const res1 = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "101",
        date: "",
        checkInTime: "09:00",
        checkOutTime: "15:00",
        baseOvernightRateLkr: 20000,
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(res1.ok, false);

      const res2 = calculateDayUseRate({
        tenantId: validTenant,
        roomNumber: "101",
        date: "2026-10-25",
        checkInTime: "09:00",
        checkOutTime: "15:00",
        baseOvernightRateLkr: 0,
        authorizedBy: frontDeskActor,
      });
      assert.strictEqual(res2.ok, false);
    });
  });
});
