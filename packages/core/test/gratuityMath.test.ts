import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyAuditChain } from "../src/auditChain.js";
import {
  type GratuityEmployeeInput,
  type HotelGratuityProvisionInput,
  calculateEmployeeGratuity,
  calculateHotelGratuityProvision,
  calculateServiceTenure,
  calculateStatutoryGratuity,
} from "../src/gratuityMath.js";

describe("Step 444 & 445: Sri Lankan Statutory Gratuity Accrual (Payment of Gratuity Act No. 12 of 1983)", () => {
  describe("calculateStatutoryGratuity - Pure Act No. 12 of 1983 Rule Engine", () => {
    it("returns 0 LKR statutory gratuity for employee with less than 5 completed years of service", () => {
      // 0, 1, 2, 3, 4 completed years
      for (const years of [0, 1, 2, 3, 4, 4.9]) {
        const res = calculateStatutoryGratuity({
          employeeId: "emp-001",
          completedYearsOfService: years,
          lastMonthlyBasicSalary: 120000,
        });

        assert.equal(res.ok, true);
        if (res.ok) {
          assert.equal(res.value.isVested, false);
          assert.equal(res.value.grossGratuityLkr, 0);
          assert.equal(res.value.netPayableGratuityLkr, 0);
          assert.equal(res.value.forfeitureLkr, 0);
          assert.equal(res.value.statutoryRatePerYearLkr, 60000); // 0.5 * 120,000
        }
      }
    });

    it("calculates exact statutory gratuity (0.5 * basicSalary * years) for employee with exactly 5 years", () => {
      // 5 years at 100,000 basic: 0.5 * 100,000 * 5 = 250,000 LKR
      const res = calculateStatutoryGratuity({
        employeeId: "emp-002",
        completedYearsOfService: 5,
        lastMonthlyBasicSalary: 100000,
      });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.isVested, true);
        assert.equal(res.value.completedYearsOfService, 5);
        assert.equal(res.value.statutoryRatePerYearLkr, 50000);
        assert.equal(res.value.grossGratuityLkr, 250000);
        assert.equal(res.value.netPayableGratuityLkr, 250000);
      }
    });

    it("calculates exact statutory gratuity for tenured employees (> 5 years)", () => {
      // 12 years at 150,000 basic: 0.5 * 150,000 * 12 = 900,000 LKR
      const res = calculateStatutoryGratuity({
        employeeId: "emp-003",
        completedYearsOfService: 12,
        lastMonthlyBasicSalary: 150000,
      });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.isVested, true);
        assert.equal(res.value.completedYearsOfService, 12);
        assert.equal(res.value.statutoryRatePerYearLkr, 75000);
        assert.equal(res.value.grossGratuityLkr, 900000);
        assert.equal(res.value.netPayableGratuityLkr, 900000);
      }
    });

    it("calculates statutory gratuity for daily-rated workmen (14 days wage per completed year)", () => {
      // 7 years, 3,500 LKR daily wage: 14 * 3,500 = 49,000 per year * 7 = 343,000 LKR
      const res = calculateStatutoryGratuity({
        employeeId: "emp-daily-01",
        completedYearsOfService: 7,
        wageType: "DAILY",
        dailyWage: 3500,
      });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.isVested, true);
        assert.equal(res.value.statutoryRatePerYearLkr, 49000);
        assert.equal(res.value.grossGratuityLkr, 343000);
        assert.equal(res.value.netPayableGratuityLkr, 343000);
      }
    });

    it("deducts Section 13 forfeiture up to gross gratuity amount", () => {
      // 10 years at 80,000 basic: 0.5 * 80,000 * 10 = 400,000 LKR
      // Property damage forfeiture = 75,000 LKR -> Net payable = 325,000 LKR
      const res = calculateStatutoryGratuity({
        employeeId: "emp-004",
        completedYearsOfService: 10,
        lastMonthlyBasicSalary: 80000,
        statutoryForfeitureLkr: 75000,
      });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.grossGratuityLkr, 400000);
        assert.equal(res.value.forfeitureLkr, 75000);
        assert.equal(res.value.netPayableGratuityLkr, 325000);
      }

      // Forfeiture exceeding gross gratuity is capped at gross gratuity (cannot be negative payout)
      const resCapped = calculateStatutoryGratuity({
        employeeId: "emp-005",
        completedYearsOfService: 5,
        lastMonthlyBasicSalary: 50000, // gross 125,000
        statutoryForfeitureLkr: 200000,
      });

      assert.equal(resCapped.ok, true);
      if (resCapped.ok) {
        assert.equal(resCapped.value.grossGratuityLkr, 125000);
        assert.equal(resCapped.value.forfeitureLkr, 125000);
        assert.equal(resCapped.value.netPayableGratuityLkr, 0);
      }
    });

    it("rejects invalid inputs with domainErr", () => {
      // Empty employeeId
      assert.equal(
        calculateStatutoryGratuity({
          employeeId: "",
          completedYearsOfService: 5,
          lastMonthlyBasicSalary: 100000,
        }).ok,
        false,
      );

      // Negative completed years
      assert.equal(
        calculateStatutoryGratuity({
          employeeId: "emp-006",
          completedYearsOfService: -1,
          lastMonthlyBasicSalary: 100000,
        }).ok,
        false,
      );

      // Non-positive monthly basic salary
      assert.equal(
        calculateStatutoryGratuity({
          employeeId: "emp-007",
          completedYearsOfService: 5,
          lastMonthlyBasicSalary: 0,
        }).ok,
        false,
      );

      // Negative forfeiture
      assert.equal(
        calculateStatutoryGratuity({
          employeeId: "emp-008",
          completedYearsOfService: 5,
          lastMonthlyBasicSalary: 100000,
          statutoryForfeitureLkr: -500,
        }).ok,
        false,
      );
    });
  });

  describe("calculateServiceTenure - Tenure & Completed Years Engine", () => {
    it("computes accurate completed full years across calendar dates", () => {
      // Joined 2020-03-15, Assessed 2025-03-14 (1 day shy of 5 full years) -> 4 years
      const resBefore = calculateServiceTenure("2020-03-15", "2025-03-14");
      assert.equal(resBefore.ok, true);
      if (resBefore.ok) {
        assert.equal(resBefore.value.completedYears, 4);
      }

      // Joined 2020-03-15, Assessed 2025-03-15 (exactly 5 full years) -> 5 years
      const resExact = calculateServiceTenure("2020-03-15", "2025-03-15");
      assert.equal(resExact.ok, true);
      if (resExact.ok) {
        assert.equal(resExact.value.completedYears, 5);
      }

      // Joined 2020-03-15, Assessed 2026-10-31 -> 6 years
      const resAfter = calculateServiceTenure("2020-03-15", "2026-10-31");
      assert.equal(resAfter.ok, true);
      if (resAfter.ok) {
        assert.equal(resAfter.value.completedYears, 6);
        assert.ok(resAfter.value.tenureYears > 6.5);
      }
    });

    it("fails when assessment date precedes joining date", () => {
      const res = calculateServiceTenure("2025-01-01", "2024-01-01");
      assert.equal(res.ok, false);
    });
  });

  describe("calculateEmployeeGratuity - LKAS 19 Balance Sheet Accruals", () => {
    it("calculates vested balance sheet liability and incremental monthly accrual", () => {
      const emp: GratuityEmployeeInput = {
        employeeId: "st-vested-01",
        employeeName: "Sunil Wickramasinghe",
        department: "FRONT_DESK",
        dateOfJoining: "2018-05-01",
        assessmentDate: "2026-05-01", // 8 completed years
        lastMonthlyBasicSalary: 120000,
        priorAccruedProvisionLkr: 450000, // previously accrued 7.5 years
      };

      const res = calculateEmployeeGratuity(emp);
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.isVested, true);
        assert.equal(res.value.completedYears, 8);
        assert.equal(res.value.statutoryRatePerYearLkr, 60000);
        // 8 * 60,000 = 480,000
        assert.equal(res.value.balanceSheetLiabilityLkr, 480000);
        assert.equal(res.value.statutoryEntitlementLkr, 480000);
        // Monthly accrual expense: 480,000 - 450,000 = 30,000
        assert.equal(res.value.monthlyAccrualExpenseLkr, 30000);
        assert.equal(res.value.payableGratuityLkr, 480000);
      }
    });

    it("calculates unvested balance sheet accrual provision for employees under 5 years", () => {
      const emp: GratuityEmployeeInput = {
        employeeId: "st-unvested-01",
        employeeName: "Anoma Perera",
        department: "HOUSEKEEPING",
        dateOfJoining: "2023-01-15",
        assessmentDate: "2026-01-15", // 3 completed years (< 5 years)
        lastMonthlyBasicSalary: 80000,
        priorAccruedProvisionLkr: 80000, // previously accrued 2 years
      };

      const res = calculateEmployeeGratuity(emp, { unvestedDiscountFactor: 1.0 });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.isVested, false);
        assert.equal(res.value.completedYears, 3);
        assert.equal(res.value.statutoryEntitlementLkr, 0); // Legal entitlement on resignation is 0
        // Accounting provision: 0.5 * 80,000 * 3 = 120,000
        assert.equal(res.value.unvestedAccrualLkr, 120000);
        assert.equal(res.value.balanceSheetLiabilityLkr, 120000);
        // Incremental expense: 120,000 - 80,000 = 40,000
        assert.equal(res.value.monthlyAccrualExpenseLkr, 40000);
        assert.equal(res.value.payableGratuityLkr, 0);
      }
    });

    it("honors completedYearsOfServiceOverride when provided", () => {
      const emp: GratuityEmployeeInput = {
        employeeId: "st-override-01",
        employeeName: "Nimal Sirisena",
        department: "MAINTENANCE",
        dateOfJoining: "2020-01-01",
        completedYearsOfServiceOverride: 6,
        lastMonthlyBasicSalary: 90000,
      };

      const res = calculateEmployeeGratuity(emp);
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.isVested, true);
        assert.equal(res.value.completedYears, 6);
        assert.equal(res.value.statutoryEntitlementLkr, 270000); // 0.5 * 90,000 * 6
      }
    });
  });

  describe("calculateHotelGratuityProvision - Master Hotel Valuation & Audit Chain", () => {
    const SAMPLE_HOTEL_STAFF: readonly GratuityEmployeeInput[] = [
      {
        employeeId: "emp-101",
        employeeName: "Kamal De Silva",
        department: "FRONT_DESK",
        dateOfJoining: "2018-02-01", // 8 completed years (vested)
        lastMonthlyBasicSalary: 150000,
        priorAccruedProvisionLkr: 550000,
      },
      {
        employeeId: "emp-102",
        employeeName: "Chathuri Alwis",
        department: "FRONT_DESK",
        dateOfJoining: "2024-06-01", // 2 completed years (unvested)
        lastMonthlyBasicSalary: 85000,
        priorAccruedProvisionLkr: 42500,
      },
      {
        employeeId: "emp-103",
        employeeName: "Roshan Gamage",
        department: "KITCHEN",
        dateOfJoining: "2019-10-15", // 7 completed years (vested)
        lastMonthlyBasicSalary: 200000,
        priorAccruedProvisionLkr: 600000,
      },
      {
        employeeId: "emp-104",
        employeeName: "Malkanthi Bandara",
        department: "HOUSEKEEPING",
        dateOfJoining: "2022-03-01", // 4 completed years (unvested)
        lastMonthlyBasicSalary: 75000,
        priorAccruedProvisionLkr: 112500,
      },
    ];

    it("aggregates hotel-wide liabilities, department breakdowns, and generates SHA-256 audit entry", () => {
      const input: HotelGratuityProvisionInput = {
        tenantId: "hotel-serendib-01",
        hotelName: "Grand Serendib Hotel & Resort",
        assessmentDate: "2026-10-31",
        actorUserId: "usr-hr-director-001",
        employees: SAMPLE_HOTEL_STAFF,
      };

      const res = calculateHotelGratuityProvision(input);
      assert.equal(res.ok, true);
      if (res.ok) {
        const report = res.value;
        assert.equal(report.tenantId, "hotel-serendib-01");
        assert.equal(report.totalHeadcount, 4);
        assert.equal(report.vestedHeadcount, 2);
        assert.equal(report.unvestedHeadcount, 2);

        // emp-101: 8 yrs * (0.5 * 150,000) = 600,000
        // emp-103: 7 yrs * (0.5 * 200,000) = 700,000
        // Total vested = 1,300,000 LKR
        assert.equal(report.totalVestedLiabilityLkr, 1300000);

        // emp-102: 2 yrs * (0.5 * 85,000) = 85,000
        // emp-104: 4 yrs * (0.5 * 75,000) = 150,000
        // Total unvested = 235,000 LKR
        assert.equal(report.totalUnvestedLiabilityLkr, 235000);

        // Total liability = 1,300,000 + 235,000 = 1,535,000 LKR
        assert.equal(report.totalLiabilityLkr, 1535000);

        // Prior provision = 550,000 + 42,500 + 600,000 + 112,500 = 1,305,000 LKR
        // Incremental monthly accrual expense = 1,535,000 - 1,305,000 = 230,000 LKR
        assert.equal(report.totalMonthlyAccrualExpenseLkr, 230000);

        // Verify department breakdown
        assert.equal(report.departmentBreakdowns.length, 3); // FRONT_DESK, HOUSEKEEPING, KITCHEN
        const frontDesk = report.departmentBreakdowns.find((d) => d.department === "FRONT_DESK");
        assert.ok(frontDesk);
        assert.equal(frontDesk.headcount, 2);
        assert.equal(frontDesk.vestedHeadcount, 1);
        assert.equal(frontDesk.unvestedHeadcount, 1);
        assert.equal(frontDesk.totalLiabilityLkr, 685000); // 600,000 + 85,000

        // Verify SHA-256 Audit Log Entry
        const audit = report.auditEntry;
        assert.equal(audit.tenantId, "hotel-serendib-01");
        assert.equal(audit.action, "GRATUITY_PROVISION_COMPUTED");
        assert.equal(audit.entityType, "GratuityProvisionReport");
        assert.equal(audit.entityId, "hotel-serendib-01#GRATUITY#2026-10-31");
        assert.equal(typeof audit.entryHash, "string");
        assert.equal(audit.entryHash.length, 64); // SHA-256 hex string

        // Verify audit chain
        const chainRes = verifyAuditChain([audit]);
        assert.equal(chainRes.ok, true);
        if (chainRes.ok) {
          assert.equal(chainRes.value.verifiedCount, 1);
        }
      }
    });

    it("rejects invalid tenantId", () => {
      const res = calculateHotelGratuityProvision({
        tenantId: "INVALID TENANT WITH SPACES",
        assessmentDate: "2026-10-31",
        actorUserId: "usr-hr-01",
        employees: SAMPLE_HOTEL_STAFF,
      });

      assert.equal(res.ok, false);
    });

    it("rejects empty employees array", () => {
      const res = calculateHotelGratuityProvision({
        tenantId: "hotel-serendib-01",
        assessmentDate: "2026-10-31",
        actorUserId: "usr-hr-01",
        employees: [],
      });

      assert.equal(res.ok, false);
    });
  });
});
