/**
 * @hms/core - Unit Tests for SLTDA Monthly Statistical & Quarterly TDL Returns (sltdaReports.test.ts)
 *
 * Implements Step 406 (Phase 17.06) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Unit test suite for official SLTDA Research & International Relations Division and TDL Gazette returns:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix:
 *    - Rejection of cross-tenant daily audit records
 *    - Rejection of unauthorized staff roles (e.g. WAITER)
 *    - Enforcement of SaasSubscription active state and SLTDA entitlements
 *
 * 2. SLTDA Monthly Statistical Return Compilation (compileSltdaMonthlyReturn):
 *    - Aggregates daily room nights, bed nights, and occupancy %
 *    - Aggregates foreign guest nights by country (UK, India, Germany, etc.) vs domestic
 *    - Calculates monthly ADR and RevPAR in LKR
 *    - Verifies days in month (e.g., 31 for October, 30 for November, 28/29 for February)
 *
 * 3. SLTDA Quarterly Tourism Development Levy (TDL) Statement (compileTdlQuarterlyReturn):
 *    - Tests 1.0% standard hotel rate tier
 *    - Tests 0.5% small-hotel / guesthouse rate tier (turnover <= LKR 3M)
 *    - Generates 3-month breakdown and BOC Corporate Branch A/C 73104820 payment slip reference
 *    - Calculates statutory due date (15th of following month)
 *
 * 4. Cryptographic SHA-256 Hash-Chained Audit Trail Integrity
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAuditEntryHash } from "../src/auditChain.js";
import type { NightAuditCalculationResult } from "../src/nightAudit.js";
import {
  type SltdaMonthlyReturnInput,
  type SltdaSaasSubscription,
  type SltdaStaffActor,
  compileSltdaMonthlyReturn,
  compileTdlQuarterlyReturn,
  getDaysInYearMonth,
  getQuarterMonths,
  getTdlStatutoryDueDate,
} from "../src/sltdaReports.js";

const TEST_TENANT_ID = "cinnamon-grand-cmb";
const TEST_YEAR_MONTH = "2026-10";

const AUTHORIZED_ACTOR: SltdaStaffActor = {
  userId: "user-auditor-01",
  role: "FINANCE_CONTROLLER",
  tenantId: TEST_TENANT_ID,
};

const ACTIVE_SUBSCRIPTION: SltdaSaasSubscription = {
  tenantId: TEST_TENANT_ID,
  active: true,
  tier: "ENTERPRISE",
  allowsSltdaReporting: true,
};

function createMockDailyAudit(
  businessDate: string,
  overrides?: Partial<NightAuditCalculationResult>,
): NightAuditCalculationResult {
  return {
    tenantId: TEST_TENANT_ID,
    businessDate,
    totalAvailableRooms: 100,
    occupiedRooms: 80,
    complimentaryRooms: 2,
    houseUseRooms: 1,
    revenueRooms: 77,
    roomOccupancyRate: 80.0,
    totalAvailableBeds: 200,
    occupiedBeds: 150,
    bedOccupancyRate: 75.0,
    totalGuests: 150,
    totalForeignGuests: 100,
    totalLocalGuests: 50,
    foreignGuestNights: 100,
    localGuestNights: 50,
    totalGuestNights: 150,
    nationalityBreakdown: {
      GB: { countryCode: "GB", guestCount: 50, guestNights: 50, isDomestic: false },
      IN: { countryCode: "IN", guestCount: 30, guestNights: 30, isDomestic: false },
      DE: { countryCode: "DE", guestCount: 20, guestNights: 20, isDomestic: false },
      LK: { countryCode: "LK", guestCount: 50, guestNights: 50, isDomestic: true },
    },
    adrLkr: 50000,
    revParLkr: 40000,
    roomRevenueLkr: 4000000,
    fAndBRevenueLkr: 1500000,
    otherRevenueLkr: 500000,
    totalNetRevenueLkr: 6000000,
    serviceChargePoolLkr: 600000,
    tdlPoolLkr: 66000,
    ssclPoolLkr: 165000,
    vatPoolLkr: 1229580,
    totalTaxAndLevyLkr: 1460580,
    grandTotalRevenueLkr: 8060580,
    auditLog: {
      tenantId: TEST_TENANT_ID,
      actorUserId: "auditor-01",
      action: "NIGHT_AUDIT_EXECUTED",
      entityType: "NightAudit",
      entityId: `${TEST_TENANT_ID}#${businessDate}`,
      isoTs: "2026-10-21T23:59:00.000Z",
      afterJson: "{}",
      prevHash: "0".repeat(64),
      entryHash: "mock-hash",
    },
    ...overrides,
  };
}

describe("Step 404, 405 & 406: SLTDA Monthly Statistical & Quarterly TDL Return Compiler (sltdaReports.ts)", () => {
  describe("1. Pure Date & Period Utilities", () => {
    it("accurately calculates days in month across leap years and standard months", () => {
      assert.strictEqual(getDaysInYearMonth("2026-10"), 31);
      assert.strictEqual(getDaysInYearMonth("2026-11"), 30);
      assert.strictEqual(getDaysInYearMonth("2026-02"), 28);
      assert.strictEqual(getDaysInYearMonth("2024-02"), 29); // Leap year
    });

    it("generates correct quarter month list", () => {
      assert.deepStrictEqual(getQuarterMonths(2026, 1), ["2026-01", "2026-02", "2026-03"]);
      assert.deepStrictEqual(getQuarterMonths(2026, 2), ["2026-04", "2026-05", "2026-06"]);
      assert.deepStrictEqual(getQuarterMonths(2026, 3), ["2026-07", "2026-08", "2026-09"]);
      assert.deepStrictEqual(getQuarterMonths(2026, 4), ["2026-10", "2026-11", "2026-12"]);
    });

    it("generates statutory TDL due date on 15th of month following quarter close", () => {
      assert.strictEqual(getTdlStatutoryDueDate(2026, 1), "2026-04-15");
      assert.strictEqual(getTdlStatutoryDueDate(2026, 2), "2026-07-15");
      assert.strictEqual(getTdlStatutoryDueDate(2026, 3), "2026-10-15");
      assert.strictEqual(getTdlStatutoryDueDate(2026, 4), "2027-01-15");
    });
  });

  describe("2. Security, Tenant Boundary & Entitlements", () => {
    it("rejects unauthorized actor roles with PERMISSION_DENIED", () => {
      const input: SltdaMonthlyReturnInput = {
        tenantId: TEST_TENANT_ID,
        yearMonth: TEST_YEAR_MONTH,
        hotelName: "Cinnamon Grand Colombo",
        sltdaRegistrationNumber: "SLTDA/SQA/HOT/01234",
        roomCapacity: 100,
        dailyAudits: [],
        actor: {
          userId: "user-waiter-01",
          role: "WAITER" as unknown as SltdaStaffActor["role"],
          tenantId: TEST_TENANT_ID,
        },
      };

      const res = compileSltdaMonthlyReturn(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PERMISSION_DENIED");
      }
    });

    it("rejects actor tenant mismatch with TENANT_MISMATCH", () => {
      const input: SltdaMonthlyReturnInput = {
        tenantId: TEST_TENANT_ID,
        yearMonth: TEST_YEAR_MONTH,
        hotelName: "Cinnamon Grand Colombo",
        sltdaRegistrationNumber: "SLTDA/SQA/HOT/01234",
        roomCapacity: 100,
        dailyAudits: [],
        actor: {
          ...AUTHORIZED_ACTOR,
          tenantId: "other-hotel",
        },
      };

      const res = compileSltdaMonthlyReturn(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects cross-tenant daily audit records in monthly return", () => {
      const crossTenantAudit = createMockDailyAudit("2026-10-01", {
        tenantId: "heritance-kandalama",
      });

      const input: SltdaMonthlyReturnInput = {
        tenantId: TEST_TENANT_ID,
        yearMonth: TEST_YEAR_MONTH,
        hotelName: "Cinnamon Grand Colombo",
        sltdaRegistrationNumber: "SLTDA/SQA/HOT/01234",
        roomCapacity: 100,
        dailyAudits: [crossTenantAudit],
        actor: AUTHORIZED_ACTOR,
      };

      const res = compileSltdaMonthlyReturn(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects inactive SaaS subscriptions with SUBSCRIPTION_INACTIVE", () => {
      const input: SltdaMonthlyReturnInput = {
        tenantId: TEST_TENANT_ID,
        yearMonth: TEST_YEAR_MONTH,
        hotelName: "Cinnamon Grand Colombo",
        sltdaRegistrationNumber: "SLTDA/SQA/HOT/01234",
        roomCapacity: 100,
        dailyAudits: [],
        actor: AUTHORIZED_ACTOR,
        subscription: {
          tenantId: TEST_TENANT_ID,
          active: false,
        },
      };

      const res = compileSltdaMonthlyReturn(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "SUBSCRIPTION_INACTIVE");
      }
    });

    it("rejects unentitled plan tiers with PLAN_LIMITATION", () => {
      const input: SltdaMonthlyReturnInput = {
        tenantId: TEST_TENANT_ID,
        yearMonth: TEST_YEAR_MONTH,
        hotelName: "Cinnamon Grand Colombo",
        sltdaRegistrationNumber: "SLTDA/SQA/HOT/01234",
        roomCapacity: 100,
        dailyAudits: [],
        actor: AUTHORIZED_ACTOR,
        subscription: {
          tenantId: TEST_TENANT_ID,
          active: true,
          allowsSltdaReporting: false,
        },
      };

      const res = compileSltdaMonthlyReturn(input);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PLAN_LIMITATION");
      }
    });
  });

  describe("3. compileSltdaMonthlyReturn Full Compilation (Step 404)", () => {
    it("accurately compiles monthly statistical return across 30 audited days", () => {
      const days = Array.from({ length: 30 }, (_, i) => {
        const day = (i + 1).toString().padStart(2, "0");
        return createMockDailyAudit(`2026-10-${day}`);
      });

      const input: SltdaMonthlyReturnInput = {
        tenantId: TEST_TENANT_ID,
        yearMonth: "2026-10",
        hotelName: "Cinnamon Grand Colombo",
        sltdaRegistrationNumber: "SLTDA/SQA/HOT/01234",
        roomCapacity: 100,
        bedCapacity: 200,
        dailyAudits: days,
        actor: AUTHORIZED_ACTOR,
        subscription: ACTIVE_SUBSCRIPTION,
      };

      const res = compileSltdaMonthlyReturn(input);
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val = res.value;
        assert.strictEqual(val.yearMonth, "2026-10");
        assert.strictEqual(val.daysInMonth, 31);
        assert.strictEqual(val.auditedDaysCount, 30);
        assert.strictEqual(val.roomCapacity, 100);
        assert.strictEqual(val.totalAvailableRoomNights, 3100); // 100 * 31
        assert.strictEqual(val.occupiedRoomNights, 2400); // 80 * 30
        assert.strictEqual(val.roomOccupancyRate, 77.42); // 2400 / 3100 * 100 = 77.42%

        assert.strictEqual(val.totalAvailableBedNights, 6200); // 200 * 31
        assert.strictEqual(val.occupiedBedNights, 4500); // 150 * 30
        assert.strictEqual(val.bedOccupancyRate, 72.58); // 4500 / 6200 * 100 = 72.58%

        // Guest nights: 100 foreign * 30 = 3000, 50 domestic * 30 = 1500
        assert.strictEqual(val.foreignGuestNights, 3000);
        assert.strictEqual(val.domesticGuestNights, 1500);
        assert.strictEqual(val.totalGuestNights, 4500);

        // Foreign Country Breakdown
        assert.strictEqual(val.foreignCountryBreakdown.length, 3);
        const uk = val.foreignCountryBreakdown.find((c) => c.countryCode === "GB");
        assert.ok(uk);
        assert.strictEqual(uk?.guestNights, 1500); // 50 * 30
        assert.strictEqual(uk?.percentageOfForeignGuestNights, 50.0); // 1500 / 3000 * 100

        const india = val.foreignCountryBreakdown.find((c) => c.countryCode === "IN");
        assert.ok(india);
        assert.strictEqual(india?.guestNights, 900); // 30 * 30
        assert.strictEqual(india?.percentageOfForeignGuestNights, 30.0); // 900 / 3000 * 100

        const germany = val.foreignCountryBreakdown.find((c) => c.countryCode === "DE");
        assert.ok(germany);
        assert.strictEqual(germany?.guestNights, 600); // 20 * 30
        assert.strictEqual(germany?.percentageOfForeignGuestNights, 20.0);

        // Revenue: Room 4M * 30 = 120M, Net 6M * 30 = 180M
        assert.strictEqual(val.totalRoomRevenueLkr, 120000000);
        assert.strictEqual(val.totalGrossRevenueLkr, 180000000);

        // ADR = 120M / 2400 = 50,000.00
        assert.strictEqual(val.averageDailyRateLkr, 50000);
        // RevPAR = 120M / 3100 = 38,709.68
        assert.strictEqual(val.revParLkr, 38709.68);
      }
    });
  });

  describe("4. compileTdlQuarterlyReturn (Step 405) Standard & Small-Hotel Tiers", () => {
    it("compiles standard 1.0% TDL quarterly statement for full-service resort", () => {
      // 3 months of audits in Q1 (Jan, Feb, Mar)
      const auditsJan = [createMockDailyAudit("2026-01-15", { totalNetRevenueLkr: 50000000 })];
      const auditsFeb = [createMockDailyAudit("2026-02-15", { totalNetRevenueLkr: 45000000 })];
      const auditsMar = [createMockDailyAudit("2026-03-15", { totalNetRevenueLkr: 55000000 })];
      const allAudits = [...auditsJan, ...auditsFeb, ...auditsMar];

      const res = compileTdlQuarterlyReturn(allAudits, "SLTDA/SQA/HOT/01234", 1.0, {
        tenantId: TEST_TENANT_ID,
        taxYear: 2026,
        quarter: 1,
        hotelName: "Cinnamon Grand Colombo",
        actor: AUTHORIZED_ACTOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val = res.value;
        assert.strictEqual(val.quarter, 1);
        assert.strictEqual(val.quarterLabel, "Q1 (Jan - Mar 2026)");
        assert.strictEqual(val.tdlRatePercent, 1.0);
        assert.strictEqual(val.statutoryDueDate, "2026-04-15");
        assert.strictEqual(val.paymentAccount, "BOC Corporate Branch A/C 73104820");
        assert.strictEqual(val.paymentReference, "TDL-2026-Q1-SLTDASQAHOT01234");

        // Months breakdown
        assert.strictEqual(val.months.length, 3);
        assert.strictEqual(val.months[0]?.turnoverBaseLkr, 50000000);
        assert.strictEqual(val.months[0]?.tdlPayableLkr, 500000); // 1.0% of 50M

        assert.strictEqual(val.months[1]?.turnoverBaseLkr, 45000000);
        assert.strictEqual(val.months[1]?.tdlPayableLkr, 450000); // 1.0% of 45M

        assert.strictEqual(val.months[2]?.turnoverBaseLkr, 55000000);
        assert.strictEqual(val.months[2]?.tdlPayableLkr, 550000); // 1.0% of 55M

        // Quarterly totals: 150M turnover -> 1.5M TDL
        assert.strictEqual(val.quarterlyTurnoverLkr, 150000000);
        assert.strictEqual(val.quarterlyTdlPayableLkr, 1500000);
      }
    });

    it("compiles 0.5% small-hotel tier for guesthouse with <= LKR 3M turnover", () => {
      const audits = [
        createMockDailyAudit("2026-04-10", { totalNetRevenueLkr: 800000 }),
        createMockDailyAudit("2026-05-10", { totalNetRevenueLkr: 900000 }),
        createMockDailyAudit("2026-06-10", { totalNetRevenueLkr: 850000 }),
      ];

      const res = compileTdlQuarterlyReturn(audits, "SLTDA/GH/0045", 0.5, {
        tenantId: TEST_TENANT_ID,
        taxYear: 2026,
        quarter: 2,
        hotelName: "Mirissa Bay Rest House",
        actor: AUTHORIZED_ACTOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val = res.value;
        assert.strictEqual(val.quarter, 2);
        assert.strictEqual(val.tdlRatePercent, 0.5);
        assert.strictEqual(val.quarterlyTurnoverLkr, 2550000); // 2.55M (<= 3M threshold)
        // 0.5% of 2,550,000 = 12,750.00
        assert.strictEqual(val.quarterlyTdlPayableLkr, 12750);
        assert.strictEqual(val.statutoryDueDate, "2026-07-15");
        assert.strictEqual(val.paymentReference, "TDL-2026-Q2-SLTDAGH0045");
      }
    });
  });

  describe("5. Cryptographic Audit Chain Verification", () => {
    it("generates an unbroken SHA-256 audit entry verifiable via computeAuditEntryHash", () => {
      const prevHash = "b".repeat(64);
      const res = compileTdlQuarterlyReturn([], "SLTDA/HOT/123", 1.0, {
        tenantId: TEST_TENANT_ID,
        taxYear: 2026,
        quarter: 3,
        prevAuditHash: prevHash,
        timestamp: "2026-10-01T12:00:00.000Z",
        actor: AUTHORIZED_ACTOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const audit = res.value.auditLog;
        assert.strictEqual(audit.tenantId, TEST_TENANT_ID);
        assert.strictEqual(audit.prevHash, prevHash);
        assert.strictEqual(audit.action, "SLTDA_TDL_QUARTERLY_RETURN_COMPILED");

        const expected = computeAuditEntryHash({
          prevHash,
          tenantId: TEST_TENANT_ID,
          actorUserId: AUTHORIZED_ACTOR.userId,
          action: "SLTDA_TDL_QUARTERLY_RETURN_COMPILED",
          entityType: "TdlQuarterlyReturn",
          entityId: `${TEST_TENANT_ID}#2026#Q3`,
          isoTs: "2026-10-01T12:00:00.000Z",
          afterJson: audit.afterJson,
        });

        assert.strictEqual(audit.entryHash, expected);
      }
    });
  });
});
