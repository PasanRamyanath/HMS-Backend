import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateServiceChargePool,
  calculateSriLankaEpfEtf,
  createEpfEtfAuditEntry,
  createServiceChargePoolAuditEntry,
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
