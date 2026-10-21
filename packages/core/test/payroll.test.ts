import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SRI_LANKA_APIT_RELIEF_THRESHOLD_LKR,
  type EmployeePayslipResult,
  calculateServiceChargePool,
  calculateSriLankaApit,
  calculateSriLankaEpfEtf,
  createApitAuditEntry,
  createEpfEtfAuditEntry,
  createPayslipAuditEntry,
  createServiceChargePoolAuditEntry,
  generateEmployeePayslip,
} from "../src/payroll.js";

describe("Sri Lankan 10% Service Charge Pool & Breakage Deduction Engine (payroll.ts)", () => {
  const TEST_TENANT = "cinnamon-grand-colombo";
  const TEST_PERIOD = "2026-09";

  it("calculates exact proportional SC distribution with 5% breakage deduction", () => {
    const poolRes = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: 1000000, // 1 Million LKR
      breakageRecoveryPercent: 5, // 5% breakage deduction
      employees: [
        {
          employeeId: "EMP-001",
          employeeName: "Chef Sunimal",
          department: "Kitchen",
          staffPointWeight: 2.0,
          daysWorked: 25, // 50 points
        },
        {
          employeeId: "EMP-002",
          employeeName: "Captain Kamal",
          department: "F&B Service",
          staffPointWeight: 1.5,
          daysWorked: 20, // 30 points
        },
        {
          employeeId: "EMP-003",
          employeeName: "Steward Nimal",
          department: "F&B Service",
          staffPointWeight: 1.0,
          daysWorked: 20, // 20 points
        },
      ],
    });

    assert.equal(poolRes.ok, true);
    if (!poolRes.ok) return;

    const pool = poolRes.value;
    assert.equal(pool.grossScLkr, 1000000);
    assert.equal(pool.breakageRecoveryPercent, 5);
    assert.equal(pool.breakageDeductionLkr, 50000); // 5% of 1M
    assert.equal(pool.netScPoolLkr, 950000); // 950,000 LKR net
    assert.equal(pool.totalWeightedPoints, 100);
    assert.equal(pool.pointValueLkr, 9500);

    assert.equal(pool.allocations.length, 3);
    const emp1 = pool.allocations[0];
    const emp2 = pool.allocations[1];
    const emp3 = pool.allocations[2];

    assert.equal(emp1?.shareLkr, 475000); // 50 * 9500 = 475,000
    assert.equal(emp1?.sharePercent, 50);

    assert.equal(emp2?.shareLkr, 285000); // 30 * 9500 = 285,000
    assert.equal(emp2?.sharePercent, 30);

    assert.equal(emp3?.shareLkr, 190000); // 20 * 9500 = 190,000
    assert.equal(emp3?.sharePercent, 20);

    assert.equal(pool.totalAllocatedLkr, 950000);
    assert.equal(pool.roundingDifferenceCents, 0);
  });

  it("handles 0% breakage recovery without deduction", () => {
    const poolRes = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: 500000,
      breakageRecoveryPercent: 0,
      employees: [
        {
          employeeId: "EMP-101",
          staffPointWeight: 1.0,
          daysWorked: 20,
        },
        {
          employeeId: "EMP-102",
          staffPointWeight: 1.0,
          daysWorked: 20,
        },
      ],
    });

    assert.equal(poolRes.ok, true);
    if (!poolRes.ok) return;

    assert.equal(poolRes.value.breakageDeductionLkr, 0);
    assert.equal(poolRes.value.netScPoolLkr, 500000);
    assert.equal(poolRes.value.allocations[0]?.shareLkr, 250000);
    assert.equal(poolRes.value.allocations[1]?.shareLkr, 250000);
  });

  it("handles employee with 0 days worked (on leave / suspended)", () => {
    const poolRes = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: 100000,
      employees: [
        {
          employeeId: "EMP-201",
          staffPointWeight: 1.0,
          daysWorked: 20,
        },
        {
          employeeId: "EMP-202",
          staffPointWeight: 1.5,
          daysWorked: 0, // Unpaid leave
        },
      ],
    });

    assert.equal(poolRes.ok, true);
    if (!poolRes.ok) return;

    assert.equal(poolRes.value.allocations[0]?.shareLkr, 100000);
    assert.equal(poolRes.value.allocations[1]?.shareLkr, 0);
    assert.equal(poolRes.value.allocations[1]?.sharePercent, 0);
  });

  it("rejects breakage recovery exceeding 10% statutory limit", () => {
    const poolRes = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: 100000,
      breakageRecoveryPercent: 15, // Illegal > 10%
      employees: [
        {
          employeeId: "EMP-001",
          staffPointWeight: 1.0,
          daysWorked: 20,
        },
      ],
    });

    assert.equal(poolRes.ok, false);
    if (!poolRes.ok) {
      assert.equal(poolRes.error.code, "VALIDATION_FAILED");
    }
  });

  it("rejects invalid negative days worked or invalid point weights", () => {
    const negDays = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: 100000,
      employees: [
        {
          employeeId: "EMP-001",
          staffPointWeight: 1.0,
          daysWorked: -5,
        },
      ],
    });
    assert.equal(negDays.ok, false);

    const zeroWeight = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: 100000,
      employees: [
        {
          employeeId: "EMP-001",
          staffPointWeight: 0,
          daysWorked: 20,
        },
      ],
    });
    assert.equal(zeroWeight.ok, false);
  });

  it("creates cryptographically chained audit log for Service Charge pool calculation", () => {
    const poolRes = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: 750000,
      breakageRecoveryPercent: 2.5,
      employees: [
        {
          employeeId: "EMP-301",
          staffPointWeight: 1.0,
          daysWorked: 22,
        },
      ],
    });

    assert.equal(poolRes.ok, true);
    if (!poolRes.ok) return;

    const auditRes = createServiceChargePoolAuditEntry(
      TEST_TENANT,
      "actor-hr-payroll-mgr",
      TEST_PERIOD,
      poolRes.value,
      "2026-10-18T16:58:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, TEST_TENANT);
    assert.equal(audit.action, "CALCULATE_SERVICE_CHARGE_POOL");
    assert.equal(audit.entityType, "ServiceChargePool");
    assert.equal(audit.entityId, TEST_PERIOD);
    assert.equal(audit.entryHash.length, 64);
  });
});

describe("Sri Lankan Statutory EPF (8%/12%) & ETF (3%) Calculator (calculateSriLankaEpfEtf)", () => {
  it("computes exact statutory EPF and ETF for standard hospitality salary package", () => {
    const res = calculateSriLankaEpfEtf({
      basicSalaryLkr: 65000,
      budgetaryReliefAllowanceLkr: 3500,
      netServiceChargeShareLkr: 45000,
      tenantId: "cinnamon-grand-colombo",
      employeeId: "EMP-HOTEL-771",
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const data = res.value;
    assert.equal(data.basicSalaryLkr, 65000);
    assert.equal(data.budgetaryReliefAllowanceLkr, 3500);
    assert.equal(data.netServiceChargeShareLkr, 45000);
    assert.equal(data.epfEligibleEarningsLkr, 68500); // 65,000 + 3,500

    // 8% employee deduction
    assert.equal(data.employeeEpfLkr, 5480); // 68,500 * 0.08

    // 12% employer contribution
    assert.equal(data.employerEpfLkr, 8220); // 68,500 * 0.12

    // 20% total EPF remittance
    assert.equal(data.totalEpfRemittanceLkr, 13700); // 5,480 + 8,220

    // 3% employer ETF contribution
    assert.equal(data.employerEtfLkr, 2055); // 68,500 * 0.03

    // 23% total statutory contribution
    assert.equal(data.totalStatutoryContributionLkr, 15755); // 13,700 + 2,055

    // Gross earnings (including variable SC share)
    assert.equal(data.grossEarningsLkr, 113500); // 68,500 + 45,000

    // Net take-home pay
    assert.equal(data.netTakeHomePayLkr, 108020); // 113,500 - 5,480
    assert.equal(data.tenantId, "cinnamon-grand-colombo");
    assert.equal(data.employeeId, "EMP-HOTEL-771");
  });

  it("handles basic salary only without allowances or service charge", () => {
    const res = calculateSriLankaEpfEtf({
      basicSalaryLkr: 40000,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const data = res.value;
    assert.equal(data.epfEligibleEarningsLkr, 40000);
    assert.equal(data.employeeEpfLkr, 3200); // 40,000 * 0.08
    assert.equal(data.employerEpfLkr, 4800); // 40,000 * 0.12
    assert.equal(data.employerEtfLkr, 1200); // 40,000 * 0.03
    assert.equal(data.netTakeHomePayLkr, 36800); // 40,000 - 3,200
  });

  it("rounds cents with exact half-up on fractional rupee values", () => {
    const res = calculateSriLankaEpfEtf({
      basicSalaryLkr: 55450.75,
      budgetaryReliefAllowanceLkr: 1250.5,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const data = res.value;
    // 55450.75 + 1250.50 = 56701.25
    assert.equal(data.epfEligibleEarningsLkr, 56701.25);
    // 56701.25 * 0.08 = 4536.10
    assert.equal(data.employeeEpfLkr, 4536.1);
    // 56701.25 * 0.12 = 6804.15
    assert.equal(data.employerEpfLkr, 6804.15);
    // 56701.25 * 0.03 = 1701.0375 -> 1701.04
    assert.equal(data.employerEtfLkr, 1701.04);
  });

  it("rejects negative salary values with validation error", () => {
    const res = calculateSriLankaEpfEtf({
      basicSalaryLkr: -5000,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "VALIDATION_FAILED");
    }
  });

  it("creates cryptographically chained audit log for EPF/ETF payslip calculation", () => {
    const res = calculateSriLankaEpfEtf({
      basicSalaryLkr: 65000,
      budgetaryReliefAllowanceLkr: 3500,
      netServiceChargeShareLkr: 45000,
      tenantId: "cinnamon-grand-colombo",
      employeeId: "EMP-HOTEL-771",
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const auditRes = createEpfEtfAuditEntry(
      "cinnamon-grand-colombo",
      "actor-hr-payroll-mgr",
      "EMP-HOTEL-771",
      "2026-09",
      res.value,
      "2026-10-18T17:00:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, "cinnamon-grand-colombo");
    assert.equal(audit.action, "CALCULATE_SRI_LANKA_EPF_ETF");
    assert.equal(audit.entityType, "PayrollPayslip");
    assert.equal(audit.entityId, "2026-09:EMP-HOTEL-771");
    assert.equal(audit.entryHash.length, 64);
  });
});

describe("Sri Lankan APIT (Advance Personal Income Tax) Progressive Tax Calculator (calculateSriLankaApit)", () => {
  const TEST_TENANT = "cinnamon-grand-colombo";

  it("returns zero APIT when remuneration is below statutory relief threshold (LKR 100,000)", () => {
    const res = calculateSriLankaApit({
      monthlyGrossTaxableLkr: 85000,
      tenantId: TEST_TENANT,
      employeeId: "EMP-HOTEL-101",
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.monthlyGrossTaxableLkr, 85000);
    assert.equal(res.value.reliefThresholdLkr, DEFAULT_SRI_LANKA_APIT_RELIEF_THRESHOLD_LKR);
    assert.equal(res.value.taxableRemunerationLkr, 0);
    assert.equal(res.value.totalApitLkr, 0);
    assert.equal(res.value.effectiveTaxRatePercent, 0);
    assert.equal(res.value.slabBreakdowns.length, 0);
  });

  it("returns zero APIT when remuneration exactly equals relief threshold", () => {
    const res = calculateSriLankaApit(100000);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.taxableRemunerationLkr, 0);
    assert.equal(res.value.totalApitLkr, 0);
  });

  it("calculates single first-slab 6% withholding accurately", () => {
    // 125,000 gross -> 25,000 taxable above 100,000 -> 25,000 * 0.06 = 1,500 LKR
    const res = calculateSriLankaApit({
      monthlyGrossTaxableLkr: 125000,
      tenantId: TEST_TENANT,
      employeeId: "EMP-HOTEL-102",
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const data = res.value;
    assert.equal(data.taxableRemunerationLkr, 25000);
    assert.equal(data.totalApitLkr, 1500);
    assert.equal(data.effectiveTaxRatePercent, 1.2); // (1500 / 125000) * 100
    assert.equal(data.slabBreakdowns.length, 1);
    assert.equal(data.slabBreakdowns[0]?.slabIndex, 1);
    assert.equal(data.slabBreakdowns[0]?.ratePercent, 6);
    assert.equal(data.slabBreakdowns[0]?.taxableAmountInSlabLkr, 25000);
    assert.equal(data.slabBreakdowns[0]?.taxAmountLkr, 1500);
  });

  it("calculates multi-slab progressive withholding across multiple brackets", () => {
    // 200,000 gross -> 100,000 taxable
    // Slab 1: 41,666.67 @ 6% = 2,500.00
    // Slab 2: 41,666.67 @ 12% = 5,000.00
    // Slab 3: 16,666.66 @ 18% = 3,000.00 (roundLkr)
    // Total APIT: 2500.00 + 5000.00 + 3000.00 = 10,500.00 LKR
    const res = calculateSriLankaApit(200000);

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const data = res.value;
    assert.equal(data.taxableRemunerationLkr, 100000);
    assert.equal(data.slabBreakdowns.length, 3);
    assert.equal(data.slabBreakdowns[0]?.ratePercent, 6);
    assert.equal(data.slabBreakdowns[0]?.taxAmountLkr, 2500);
    assert.equal(data.slabBreakdowns[1]?.ratePercent, 12);
    assert.equal(data.slabBreakdowns[1]?.taxAmountLkr, 5000);
    assert.equal(data.slabBreakdowns[2]?.ratePercent, 18);
    assert.equal(data.slabBreakdowns[2]?.taxAmountLkr, 3000);
    assert.equal(data.totalApitLkr, 10500);
    assert.equal(data.effectiveTaxRatePercent, 5.25);
  });

  it("computes executive remuneration reaching top 36% marginal rate bracket", () => {
    // 500,000 gross -> 400,000 taxable
    // Slab 1: 41,666.67 @ 6% = 2,500.00
    // Slab 2: 41,666.67 @ 12% = 5,000.00
    // Slab 3: 41,666.67 @ 18% = 7,500.00
    // Slab 4: 41,666.67 @ 24% = 10,000.00
    // Slab 5: 41,666.67 @ 30% = 12,500.00
    // Slab 6: 191,666.65 @ 36% = 68,999.99
    // Total APIT: 2,500 + 5,000 + 7,500 + 10,000 + 12,500 + 68,999.99 = 106,499.99 LKR
    const res = calculateSriLankaApit(500000);

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const data = res.value;
    assert.equal(data.taxableRemunerationLkr, 400000);
    assert.equal(data.slabBreakdowns.length, 6);
    assert.equal(data.slabBreakdowns[5]?.ratePercent, 36);
    assert.equal(data.slabBreakdowns[5]?.taxAmountLkr, 68999.99);
    assert.equal(data.totalApitLkr, 106499.99);
    assert.equal(data.effectiveTaxRatePercent, 21.3);
  });

  it("supports custom tax slabs and customized relief thresholds", () => {
    const customSlabs = [
      { slabWidthLkr: 50000, ratePercent: 5 },
      { slabWidthLkr: 50000, ratePercent: 10 },
      { slabWidthLkr: Number.POSITIVE_INFINITY, ratePercent: 20 },
    ];

    const res = calculateSriLankaApit({
      monthlyGrossTaxableLkr: 180000,
      reliefThresholdLkr: 50000, // custom 50k relief
      slabs: customSlabs,
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    // 180k - 50k = 130k taxable
    // Slab 1: 50k @ 5% = 2,500
    // Slab 2: 50k @ 10% = 5,000
    // Slab 3: 30k @ 20% = 6,000
    // Total APIT: 13,500
    assert.equal(res.value.taxableRemunerationLkr, 130000);
    assert.equal(res.value.totalApitLkr, 13500);
  });

  it("rejects negative gross earnings or negative relief thresholds", () => {
    const negGross = calculateSriLankaApit(-10000);
    assert.equal(negGross.ok, false);
    if (!negGross.ok) {
      assert.equal(negGross.error.code, "VALIDATION_FAILED");
    }

    const negRelief = calculateSriLankaApit({
      monthlyGrossTaxableLkr: 100000,
      reliefThresholdLkr: -5000,
    });
    assert.equal(negRelief.ok, false);
    if (!negRelief.ok) {
      assert.equal(negRelief.error.code, "VALIDATION_FAILED");
    }
  });

  it("creates cryptographically valid SHA-256 audit log entry for APIT calculation", () => {
    const apitRes = calculateSriLankaApit({
      monthlyGrossTaxableLkr: 180000,
      tenantId: TEST_TENANT,
      employeeId: "EMP-GM-001",
    });

    assert.equal(apitRes.ok, true);
    if (!apitRes.ok) return;

    const auditRes = createApitAuditEntry(
      TEST_TENANT,
      "actor-finance-controller",
      "EMP-GM-001",
      "2026-10",
      apitRes.value,
      "2026-10-21T06:45:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, TEST_TENANT);
    assert.equal(audit.action, "CALCULATE_SRI_LANKA_APIT");
    assert.equal(audit.entityType, "PayrollPayslip");
    assert.equal(audit.entityId, "2026-10:EMP-GM-001:APIT");
    assert.equal(audit.entryHash.length, 64);
  });
});

describe("Complete Monthly Hotel Payslip Generator (generateEmployeePayslip)", () => {
  const TEST_TENANT = "cinnamon-grand-colombo";

  it("generates full payslip combining Basic + BRA + OT (1.5x) + SC share - 8% EPF - Meals - APIT", () => {
    // Basic: 60,000, BRA: 4,000 -> EPF Eligible: 64,000
    // Hourly rate = 64,000 / 200 = 320 LKR
    // OT rate = 320 * 1.5 = 480 LKR
    // OT hours = 10 -> OT earnings = 4,800 LKR
    // Fixed allowance = 5,000 LKR
    // Service Charge share = 35,000 LKR
    // Gross Earnings = 64,000 + 5,000 + 4,800 + 35,000 = 108,800 LKR
    // Employee EPF (8%) = 64,000 * 0.08 = 5,120 LKR
    // APIT: Gross 108,800 -> 8,800 taxable @ 6% = 528 LKR
    // Meal deduction = 2,500 LKR
    // Salary advance = 5,000 LKR
    // Other deduction = 1,000 LKR
    // Total Deductions = 5,120 + 528 + 2,500 + 5,000 + 1,000 = 14,148 LKR
    // Net Pay = 108,800 - 14,148 = 94,652 LKR
    // Employer EPF (12%) = 64,000 * 0.12 = 7,680 LKR
    // Employer ETF (3%) = 64,000 * 0.03 = 1,920 LKR
    // Total Statutory Remittance = 5,120 + 7,680 + 1,920 = 14,720 LKR
    // Total Employer Cost = 108,800 + 7,680 + 1,920 = 118,400 LKR
    const res = generateEmployeePayslip(
      {
        tenantId: TEST_TENANT,
        employeeId: "EMP-HOTEL-550",
        employeeName: "Saman Jayawardena",
        department: "Food & Beverage",
        designation: "Senior Steward",
        epfRegistrationNo: "EPF/10928/550",
        nicOrPassport: "199012345678",
        basicSalaryLkr: 60000,
        budgetaryReliefAllowanceLkr: 4000,
        fixedAllowancesLkr: 5000,
      },
      {
        billingPeriod: "2026-10",
        daysWorked: 26,
        overtimeHours: 10,
        mealDeductionsLkr: 2500,
        salaryAdvanceDeductionsLkr: 5000,
        otherDeductionsLkr: 1000,
      },
      35000, // Net SC Share
    );

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const slip = res.value;
    assert.equal(slip.tenantId, TEST_TENANT);
    assert.equal(slip.employeeId, "EMP-HOTEL-550");
    assert.equal(slip.employeeName, "Saman Jayawardena");
    assert.equal(slip.department, "Food & Beverage");
    assert.equal(slip.billingPeriod, "2026-10");

    assert.equal(slip.basicSalaryLkr, 60000);
    assert.equal(slip.budgetaryReliefAllowanceLkr, 4000);
    assert.equal(slip.epfEligibleEarningsLkr, 64000);
    assert.equal(slip.fixedAllowancesLkr, 5000);
    assert.equal(slip.overtimeHours, 10);
    assert.equal(slip.overtimeRateLkr, 480);
    assert.equal(slip.overtimeEarningsLkr, 4800);
    assert.equal(slip.netServiceChargeShareLkr, 35000);
    assert.equal(slip.grossEarningsLkr, 108800);

    assert.equal(slip.employeeEpfRatePercent, 8);
    assert.equal(slip.employeeEpfLkr, 5120);
    assert.equal(slip.apitTaxLkr, 528);
    assert.equal(slip.mealDeductionsLkr, 2500);
    assert.equal(slip.salaryAdvanceDeductionsLkr, 5000);
    assert.equal(slip.otherDeductionsLkr, 1000);
    assert.equal(slip.totalDeductionsLkr, 14148);

    assert.equal(slip.netPayLkr, 94652);

    assert.equal(slip.employerEpfRatePercent, 12);
    assert.equal(slip.employerEpfLkr, 7680);
    assert.equal(slip.employerEtfRatePercent, 3);
    assert.equal(slip.employerEtfLkr, 1920);
    assert.equal(slip.totalStatutoryRemittanceLkr, 14720);
    assert.equal(slip.totalEmployerCostLkr, 118400);
  });

  it("handles custom hourly overtime rate override", () => {
    const res = generateEmployeePayslip(
      {
        tenantId: TEST_TENANT,
        employeeId: "EMP-HOTEL-551",
        employeeName: "Rohan Perera",
        basicSalaryLkr: 50000,
      },
      {
        billingPeriod: "2026-10",
        daysWorked: 25,
        overtimeHours: 8,
        overtimeHourlyRateLkr: 600, // Custom contract rate override
      },
    );

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.overtimeRateLkr, 600);
    assert.equal(res.value.overtimeEarningsLkr, 4800); // 8 * 600
    assert.equal(res.value.grossEarningsLkr, 54800); // 50,000 + 4,800
  });

  it("rejects invalid input with missing employee ID or negative salary", () => {
    const invalidId = generateEmployeePayslip(
      {
        tenantId: TEST_TENANT,
        employeeId: "",
        employeeName: "Nameless",
        basicSalaryLkr: 40000,
      },
      {
        billingPeriod: "2026-10",
        daysWorked: 26,
      },
    );
    assert.equal(invalidId.ok, false);

    const negSalary = generateEmployeePayslip(
      {
        tenantId: TEST_TENANT,
        employeeId: "EMP-001",
        employeeName: "Name",
        basicSalaryLkr: -25000,
      },
      {
        billingPeriod: "2026-10",
        daysWorked: 26,
      },
    );
    assert.equal(negSalary.ok, false);
  });

  it("creates cryptographically chained audit log for payslip generation", () => {
    const res = generateEmployeePayslip(
      {
        tenantId: TEST_TENANT,
        employeeId: "EMP-AUDIT-99",
        employeeName: "Anura Silva",
        basicSalaryLkr: 75000,
      },
      {
        billingPeriod: "2026-10",
        daysWorked: 26,
      },
      25000,
    );

    assert.equal(res.ok, true);
    if (!res.ok) return;

    const auditRes = createPayslipAuditEntry(
      TEST_TENANT,
      "actor-hr-officer",
      res.value,
      "2026-10-21T07:00:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, TEST_TENANT);
    assert.equal(audit.action, "GENERATE_EMPLOYEE_PAYSLIP");
    assert.equal(audit.entityType, "PayrollPayslip");
    assert.equal(audit.entityId, "2026-10:EMP-AUDIT-99");
    assert.equal(audit.entryHash.length, 64);
  });
});

describe("Step 428: 10-Staff Service Charge Pool, Breakage Deduction, EPF/ETF & APIT Integration Tests", () => {
  const TEST_TENANT = "cinnamon-grand-colombo";
  const TEST_PERIOD = "2026-10";

  it("verifies 10-staff hotel SC pool distribution reconciles to exact rupee with breakage deduction", () => {
    // 10 staff across 5 hotel departments
    const staffRoster = [
      {
        employeeId: "EMP-01",
        employeeName: "Gamini Silva",
        department: "Management",
        staffPointWeight: 2.5,
        daysWorked: 26,
      },
      {
        employeeId: "EMP-02",
        employeeName: "Rohan Fernando",
        department: "Kitchen",
        staffPointWeight: 2.0,
        daysWorked: 26,
      },
      {
        employeeId: "EMP-03",
        employeeName: "Kamal Perera",
        department: "Kitchen",
        staffPointWeight: 1.5,
        daysWorked: 25,
      },
      {
        employeeId: "EMP-04",
        employeeName: "Nimal Jayasinghe",
        department: "F&B Service",
        staffPointWeight: 1.5,
        daysWorked: 24,
      },
      {
        employeeId: "EMP-05",
        employeeName: "Sunil Wickrama",
        department: "F&B Service",
        staffPointWeight: 1.0,
        daysWorked: 26,
      },
      {
        employeeId: "EMP-06",
        employeeName: "Priyantha Bandara",
        department: "Front Office",
        staffPointWeight: 1.25,
        daysWorked: 26,
      },
      {
        employeeId: "EMP-07",
        employeeName: "Kasun Dissanayake",
        department: "Front Office",
        staffPointWeight: 1.0,
        daysWorked: 22,
      },
      {
        employeeId: "EMP-08",
        employeeName: "Chathura Kumara",
        department: "Housekeeping",
        staffPointWeight: 1.0,
        daysWorked: 26,
      },
      {
        employeeId: "EMP-09",
        employeeName: "Ruwan Senaratne",
        department: "Housekeeping",
        staffPointWeight: 1.0,
        daysWorked: 20,
      },
      {
        employeeId: "EMP-10",
        employeeName: "Dinesh Gunawardena",
        department: "Maintenance",
        staffPointWeight: 1.25,
        daysWorked: 0,
      }, // Unpaid medical leave
    ];

    const grossScLkr = 2500000; // 2.5 Million LKR SC collected
    const breakagePercent = 4.0; // 4% breakage recovery (within statutory 10% cap)

    const poolRes = calculateServiceChargePool({
      tenantId: TEST_TENANT,
      billingPeriod: TEST_PERIOD,
      totalScLkr: grossScLkr,
      breakageRecoveryPercent: breakagePercent,
      employees: staffRoster,
    });

    assert.equal(poolRes.ok, true);
    if (!poolRes.ok) return;

    const pool = poolRes.value;
    assert.equal(pool.grossScLkr, 2500000);
    assert.equal(pool.breakageRecoveryPercent, 4.0);
    assert.equal(pool.breakageDeductionLkr, 100000); // 4% of 2.5M
    assert.equal(pool.netScPoolLkr, 2400000); // 2.4 Million net pool
    assert.equal(pool.allocations.length, 10);

    // Exact rupee reconciliation: total allocated + rounding difference === netScPoolLkr
    const sumAllocated = pool.allocations.reduce((acc, a) => acc + a.shareLkr, 0);
    assert.equal(Math.round(sumAllocated + pool.roundingDifferenceCents), pool.netScPoolLkr);
    assert.equal(pool.totalAllocatedLkr, sumAllocated);

    // Staff with 0 days worked receives exactly 0 LKR
    const emp10 = pool.allocations.find((a) => a.employeeId === "EMP-10");
    assert.equal(emp10?.shareLkr, 0);
    assert.equal(emp10?.sharePercent, 0);

    // Staff with highest weighted points receives highest share
    const emp01 = pool.allocations.find((a) => a.employeeId === "EMP-01"); // 2.5 * 26 = 65 points
    const emp05 = pool.allocations.find((a) => a.employeeId === "EMP-05"); // 1.0 * 26 = 26 points
    assert.ok(emp01 && emp05);
    assert.ok(emp01.shareLkr > emp05.shareLkr);
  });

  interface StaffBatchProfile {
    readonly employeeId: string;
    readonly name: string;
    readonly basic: number;
    readonly bra: number;
    readonly otHours: number;
    readonly scShare: number;
    readonly meals: number;
    readonly advance: number;
  }

  function verifyStaffPayslipStatutory(p: EmployeePayslipResult, s: StaffBatchProfile): void {
    const epfEligible = s.basic + s.bra;
    assert.equal(p.epfEligibleEarningsLkr, epfEligible);
    assert.equal(p.employeeEpfLkr, Math.round(epfEligible * 0.08 * 100) / 100);
    assert.equal(p.employerEpfLkr, Math.round(epfEligible * 0.12 * 100) / 100);
    assert.equal(p.employerEtfLkr, Math.round(epfEligible * 0.03 * 100) / 100);
    assert.equal(
      p.totalStatutoryRemittanceLkr,
      p.employeeEpfLkr + p.employerEpfLkr + p.employerEtfLkr,
    );
    assert.equal(p.netPayLkr, Math.round((p.grossEarningsLkr - p.totalDeductionsLkr) * 100) / 100);
    assert.equal(
      p.totalEmployerCostLkr,
      Math.round((p.grossEarningsLkr + p.employerEpfLkr + p.employerEtfLkr) * 100) / 100,
    );
    if (p.grossEarningsLkr > 100000) {
      assert.ok(
        p.apitTaxLkr > 0,
        `Staff ${s.name} with gross ${p.grossEarningsLkr} should have APIT withheld`,
      );
    } else {
      assert.equal(
        p.apitTaxLkr,
        0,
        `Staff ${s.name} with gross ${p.grossEarningsLkr} should have 0 APIT`,
      );
    }
  }

  it("executes full monthly payroll batch for 10 staff with EPF, ETF, Overtime & progressive APIT", () => {
    // 10 hotel staff profiles
    const staffProfiles: readonly StaffBatchProfile[] = [
      {
        employeeId: "EMP-01",
        name: "Gamini Silva",
        basic: 150000,
        bra: 5000,
        otHours: 0,
        scShare: 420000,
        meals: 0,
        advance: 0,
      },
      {
        employeeId: "EMP-02",
        name: "Rohan Fernando",
        basic: 110000,
        bra: 4000,
        otHours: 15,
        scShare: 336000,
        meals: 2500,
        advance: 0,
      },
      {
        employeeId: "EMP-03",
        name: "Kamal Perera",
        basic: 75000,
        bra: 3500,
        otHours: 20,
        scShare: 242000,
        meals: 2500,
        advance: 5000,
      },
      {
        employeeId: "EMP-04",
        name: "Nimal Jayasinghe",
        basic: 65000,
        bra: 3500,
        otHours: 12,
        scShare: 232000,
        meals: 2500,
        advance: 0,
      },
      {
        employeeId: "EMP-05",
        name: "Sunil Wickrama",
        basic: 45000,
        bra: 3500,
        otHours: 10,
        scShare: 168000,
        meals: 2000,
        advance: 2500,
      },
      {
        employeeId: "EMP-06",
        name: "Priyantha Bandara",
        basic: 60000,
        bra: 3500,
        otHours: 0,
        scShare: 210000,
        meals: 2000,
        advance: 0,
      },
      {
        employeeId: "EMP-07",
        name: "Kasun Dissanayake",
        basic: 45000,
        bra: 3500,
        otHours: 8,
        scShare: 142000,
        meals: 2000,
        advance: 0,
      },
      {
        employeeId: "EMP-08",
        name: "Chathura Kumara",
        basic: 42000,
        bra: 3500,
        otHours: 14,
        scShare: 168000,
        meals: 2000,
        advance: 3000,
      },
      {
        employeeId: "EMP-09",
        name: "Ruwan Senaratne",
        basic: 40000,
        bra: 3500,
        otHours: 6,
        scShare: 129000,
        meals: 2000,
        advance: 0,
      },
      {
        employeeId: "EMP-10",
        name: "Dinesh Gunawardena",
        basic: 55000,
        bra: 3500,
        otHours: 0,
        scShare: 0,
        meals: 0,
        advance: 0,
      },
    ];

    let totalPayrollGrossLkr = 0;
    let totalEmployeeEpfLkr = 0;
    let totalEmployerEpfLkr = 0;
    let totalEmployerEtfLkr = 0;
    let totalApitWithheldLkr = 0;
    let totalNetTakeHomeLkr = 0;
    let totalEmployerCostLkr = 0;

    let prevAuditHash: string | undefined;

    for (const s of staffProfiles) {
      const payslipRes = generateEmployeePayslip(
        {
          tenantId: TEST_TENANT,
          employeeId: s.employeeId,
          employeeName: s.name,
          basicSalaryLkr: s.basic,
          budgetaryReliefAllowanceLkr: s.bra,
        },
        {
          billingPeriod: TEST_PERIOD,
          daysWorked: 26,
          overtimeHours: s.otHours,
          mealDeductionsLkr: s.meals,
          salaryAdvanceDeductionsLkr: s.advance,
        },
        s.scShare,
      );

      assert.equal(payslipRes.ok, true);
      if (!payslipRes.ok) return;

      const p = payslipRes.value;
      verifyStaffPayslipStatutory(p, s);

      // Chain audit log
      const auditRes = createPayslipAuditEntry(
        TEST_TENANT,
        "actor-payroll-officer",
        p,
        "2026-10-21T07:15:00.000Z",
        prevAuditHash,
      );
      assert.equal(auditRes.ok, true);
      if (auditRes.ok) {
        assert.equal(auditRes.value.entryHash.length, 64);
        if (prevAuditHash) {
          assert.equal(auditRes.value.prevHash, prevAuditHash);
        }
        prevAuditHash = auditRes.value.entryHash;
      }

      // Aggregate totals
      totalPayrollGrossLkr += p.grossEarningsLkr;
      totalEmployeeEpfLkr += p.employeeEpfLkr;
      totalEmployerEpfLkr += p.employerEpfLkr;
      totalEmployerEtfLkr += p.employerEtfLkr;
      totalApitWithheldLkr += p.apitTaxLkr;
      totalNetTakeHomeLkr += p.netPayLkr;
      totalEmployerCostLkr += p.totalEmployerCostLkr;
    }

    // Verify aggregate company payroll equation
    assert.equal(
      Math.round(totalEmployerCostLkr * 100) / 100,
      Math.round((totalPayrollGrossLkr + totalEmployerEpfLkr + totalEmployerEtfLkr) * 100) / 100,
    );

    assert.ok(totalPayrollGrossLkr > 2000000);
    assert.ok(totalEmployeeEpfLkr > 50000);
    assert.ok(totalEmployerEpfLkr > 75000);
    assert.ok(totalEmployerEtfLkr > 18000);
    assert.ok(totalApitWithheldLkr > 100000);
    assert.ok(totalNetTakeHomeLkr > 1800000);
  });
});
