import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateServiceChargePool, createServiceChargePoolAuditEntry } from "../src/payroll.js";

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
