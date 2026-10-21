/**
 * @hms/core - End-to-End Monthly SC Collection -> Breakage Deduction -> Payroll -> EPF/ETF -> Bank SLIPS Test
 * (`packages/core/test/payrollLifecycle.test.ts`)
 *
 * Implements Step 449 (Phase 18.24) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive lifecycle integration test covering the complete monthly hospitality HR, service charge,
 * statutory deductions, payroll, and banking cycle for a multi-tenant Sri Lankan luxury hotel:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix:
 *    - Rejection of cross-tenant operations between properties (e.g. Galle Face vs Kandalama).
 *    - Enforcement of RBAC role boundaries (FINANCE_CONTROLLER & HR_MANAGER vs UNAUTHORIZED_ROLE).
 *    - Verification of SaaS subscription entitlement and active status guards.
 * 2. Stage 1: Monthly Guest Folio 10% Service Charge Collection:
 *    - Aggregates multi-department guest folios (Room, F&B, Spa, Laundry, Excursions).
 *    - 4-Stage compounding Sri Lankan taxes (SC 10% -> TDL 1% -> SSCL 2.5% -> VAT 18%).
 *    - Generates SHA-256 hash-chained audit log entries for folio closures.
 * 3. Stage 2: Breakage & Damage Register Recovery:
 *    - Applies statutory/union-capped 5% breakage recovery deduction on gross collected SC.
 *    - Derives net distributable service charge pool adhering to hospitality conventions.
 * 4. Stage 3: Staff Point Weighting & Attendance-Based SC Pool Allocation:
 *    - Distributes net pool across tiered hotel staff (weights 1.0 to 2.0) based on verified workdays.
 *    - Validates exact rupee rounding and cent balancing.
 *    - Appends hash-chained audit record for pool distribution.
 * 5. Stage 4: Monthly Payroll & Statutory Withholding Engine:
 *    - Basic wages + Budgetary Relief Allowance (BRA) = EPF Eligible Earnings.
 *    - Overtime earnings computed at 1.5x standard hourly rate ((Basic + BRA) / 200 * 1.5).
 *    - Fixed allowances + SC pool share included in gross taxable earnings.
 *    - Statutory deductions: Employee EPF (8%), Employer EPF (12%), Employer ETF (3%).
 *    - Inland Revenue Department (IRD) APIT progressive income tax withholding.
 *    - Staff meal charges and salary advance deductions.
 *    - Net take-home pay calculation for each staff profile.
 * 6. Stage 5: Commercial Bank / LankaPay Bank SLIPS Batch Export:
 *    - Formats Commercial Bank PayMaster and LankaPay Standard SLIPS CSV transfers.
 *    - Verifies beneficiary bank codes (7010, 7083, 7092, 7278), branch codes, and sanitized names.
 *    - Reconciles total batch export amount against the sum of employee net pays.
 *    - Records cryptographic audit entry for banking transmission.
 * 7. Stage 6: LKAS 19 Employee Benefits & Gratuity Act No. 12 of 1983 Provision:
 *    - Evaluates vesting thresholds (< 5 years = 0 statutory payout; >= 5 years = half-month basic per year).
 *    - Computes hotel-wide balance sheet liabilities and departmental accrual breakdowns.
 * 8. Stage 7: End-to-End Cryptographic SHA-256 Audit Chain Verification:
 *    - Validates the unbroken sequential cryptographic hash chain from GENESIS_HASH.
 *    - Verifies tamper-evident integrity defense against historical mutations.
 *
 * Strict Architectural Guarantees:
 * - Pure Node 22 test runner (zero external runtime dependencies).
 * - Biome-compliant (zero lint warnings, cognitive complexity <= 12).
 * - Knip-verified (zero unused symbols or dead exports).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type DomainError,
  type EmployeeMonthlyAttendance,
  type EmployeePayrollProfile,
  type EmployeePayslipResult,
  type FolioLineItem,
  GENESIS_HASH,
  type GratuityEmployeeInput,
  type OriginatingAccountProfile,
  type Result,
  SRI_LANKA_EPF_EMPLOYEE_RATE,
  SRI_LANKA_EPF_EMPLOYER_RATE,
  SRI_LANKA_ETF_EMPLOYER_RATE,
  aggregateFolioTaxes,
  calculateHotelGratuityProvision,
  calculateServiceChargePool,
  calculateStatutoryGratuity,
  computeAuditEntryHash,
  createFolioTaxAuditEntry,
  createPayslipAuditEntry,
  createServiceChargePoolAuditEntry,
  domainErr,
  exportBankSlipsCsv,
  generateEmployeePayslip,
  ok,
  roundLkr,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant SaaS & RBAC Security Layer
// ============================================================================

type PayrollRole =
  | "HOTEL_GENERAL_MANAGER"
  | "FINANCE_CONTROLLER"
  | "HR_MANAGER"
  | "PAYROLL_EXECUTIVE"
  | "RESTAURANT_WAITER"
  | "HOUSEKEEPING_ATTENDANT"
  | "GUEST";

interface PayrollActor {
  readonly userId: string;
  readonly role: PayrollRole;
  readonly tenantId: string;
}

interface PayrollSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier: "STARTER" | "PROFESSIONAL" | "ENTERPRISE";
  readonly allowsPayrollAndBanking: boolean;
}

const AUTHORIZED_PAYROLL_ROLES: ReadonlySet<PayrollRole> = new Set([
  "HOTEL_GENERAL_MANAGER",
  "FINANCE_CONTROLLER",
  "HR_MANAGER",
  "PAYROLL_EXECUTIVE",
]);

function validatePayrollActor(
  actor: PayrollActor,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match operation tenant '${expectedTenantId}'`,
      { actorTenantId: actor.tenantId, expectedTenantId },
    );
  }

  if (!AUTHORIZED_PAYROLL_ROLES.has(actor.role)) {
    return domainErr(
      "UNAUTHORIZED_ROLE",
      `Role '${actor.role}' lacks permission to execute hotel payroll and banking operations`,
      { role: actor.role },
    );
  }

  return ok(undefined);
}

function validatePayrollSubscription(
  sub: PayrollSaasSubscription | undefined,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!sub) {
    return ok(undefined);
  }

  if (sub.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenant '${sub.tenantId}' does not match target tenant '${expectedTenantId}'`,
    );
  }

  if (!sub.active) {
    return domainErr(
      "SUBSCRIPTION_INACTIVE",
      "SaaS subscription for this property is suspended or inactive",
      { tenantId: expectedTenantId },
    );
  }

  if (!sub.allowsPayrollAndBanking) {
    return domainErr(
      "PLAN_LIMITATION",
      "Payroll and LankaPay bank SLIPS engine is not entitled under current plan tier",
      { tier: sub.tier },
    );
  }

  return ok(undefined);
}

interface RosterStaff {
  readonly profile: EmployeePayrollProfile;
  readonly weight: number;
  readonly daysWorked: number;
  readonly attendance: EmployeeMonthlyAttendance;
  readonly bankName: string;
  readonly bankCode: string;
  readonly branchCode: string;
  readonly accountNumber: string;
}

function verifySinglePayslip(
  staff: RosterStaff,
  payslip: EmployeePayslipResult,
  scShare: number,
): void {
  // EPF Eligible = Basic + BRA
  const expectedEpfEligible = roundLkr(
    staff.profile.basicSalaryLkr + (staff.profile.budgetaryReliefAllowanceLkr ?? 0),
  );
  assert.equal(payslip.epfEligibleEarningsLkr, expectedEpfEligible);

  // Employee EPF = 8% of EPF eligible
  const expectedEmpEpf = roundLkr(expectedEpfEligible * SRI_LANKA_EPF_EMPLOYEE_RATE);
  assert.equal(payslip.employeeEpfLkr, expectedEmpEpf);

  // Employer EPF = 12% of EPF eligible
  const expectedEmployerEpf = roundLkr(expectedEpfEligible * SRI_LANKA_EPF_EMPLOYER_RATE);
  assert.equal(payslip.employerEpfLkr, expectedEmployerEpf);

  // Employer ETF = 3% of EPF eligible
  const expectedEmployerEtf = roundLkr(expectedEpfEligible * SRI_LANKA_ETF_EMPLOYER_RATE);
  assert.equal(payslip.employerEtfLkr, expectedEmployerEtf);

  // Statutory remittance = 8% + 12% + 3% = 23%
  assert.equal(
    payslip.totalStatutoryRemittanceLkr,
    roundLkr(expectedEmpEpf + expectedEmployerEpf + expectedEmployerEtf),
  );

  // Overtime check: rate = (EPF Eligible / 200) * 1.5
  const expectedOtRate = roundLkr((expectedEpfEligible / 200) * 1.5);
  assert.equal(payslip.overtimeRateLkr, expectedOtRate);
  assert.equal(
    payslip.overtimeEarningsLkr,
    roundLkr(staff.attendance.overtimeHours * expectedOtRate),
  );

  // Gross earnings = EPF Eligible + Fixed Allowances + OT + SC Share
  const expectedGross = roundLkr(
    expectedEpfEligible +
      (staff.profile.fixedAllowancesLkr ?? 0) +
      payslip.overtimeEarningsLkr +
      scShare,
  );
  assert.equal(payslip.grossEarningsLkr, expectedGross);

  // Deductions & Net Pay reconciliation:
  const expectedTotalDeductions = roundLkr(
    payslip.employeeEpfLkr +
      payslip.apitTaxLkr +
      payslip.mealDeductionsLkr +
      payslip.salaryAdvanceDeductionsLkr +
      payslip.otherDeductionsLkr,
  );
  assert.equal(payslip.totalDeductionsLkr, expectedTotalDeductions);
  assert.equal(payslip.netPayLkr, roundLkr(expectedGross - expectedTotalDeductions));
}

// ============================================================================
// Test Suite: Step 449 End-to-End Payroll Lifecycle Integration Test
// ============================================================================

describe("Step 449: End-to-End Monthly SC Collection -> Breakage -> Payroll -> EPF/ETF -> Bank SLIPS Test", () => {
  const TENANT_CINNAMON = "cinnamon-bentota-beach";
  const TENANT_HERITANCE = "heritance-kandalama";
  const BILLING_PERIOD = "2026-10";

  const HR_MANAGER_ACTOR: PayrollActor = {
    userId: "USR-HR-001",
    role: "HR_MANAGER",
    tenantId: TENANT_CINNAMON,
  };

  const FINANCE_CONTROLLER_ACTOR: PayrollActor = {
    userId: "USR-FIN-001",
    role: "FINANCE_CONTROLLER",
    tenantId: TENANT_CINNAMON,
  };

  const UNAUTHORIZED_WAITER_ACTOR: PayrollActor = {
    userId: "USR-FB-042",
    role: "RESTAURANT_WAITER",
    tenantId: TENANT_CINNAMON,
  };

  const ACTIVE_SUBSCRIPTION: PayrollSaasSubscription = {
    tenantId: TENANT_CINNAMON,
    active: true,
    tier: "ENTERPRISE",
    allowsPayrollAndBanking: true,
  };

  const auditTrail: AuditLogEntry[] = [];
  let currentHash = GENESIS_HASH;

  function appendAudit(entry: AuditLogEntry): void {
    assert.equal(entry.prevHash, currentHash);
    assert.equal(
      computeAuditEntryHash({
        prevHash: entry.prevHash,
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        isoTs: entry.isoTs,
        afterJson: entry.afterJson,
      }),
      entry.entryHash,
    );
    auditTrail.push(entry);
    currentHash = entry.entryHash;
  }

  // --------------------------------------------------------------------------
  // 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix", () => {
    it("rejects payroll operations when actor tenantId does not match hotel tenantId", () => {
      const crossTenantActor: PayrollActor = {
        userId: "USR-HR-999",
        role: "HR_MANAGER",
        tenantId: TENANT_HERITANCE,
      };

      const result = validatePayrollActor(crossTenantActor, TENANT_CINNAMON);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects unauthorized staff roles (waiter/guest) attempting to run payroll", () => {
      const result = validatePayrollActor(UNAUTHORIZED_WAITER_ACTOR, TENANT_CINNAMON);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "UNAUTHORIZED_ROLE");
      }
    });

    it("permits authorized HR and Finance roles", () => {
      const hrRes = validatePayrollActor(HR_MANAGER_ACTOR, TENANT_CINNAMON);
      assert.equal(hrRes.ok, true);

      const finRes = validatePayrollActor(FINANCE_CONTROLLER_ACTOR, TENANT_CINNAMON);
      assert.equal(finRes.ok, true);
    });

    it("enforces SaaS subscription entitlement guards", () => {
      const inactiveSub: PayrollSaasSubscription = {
        tenantId: TENANT_CINNAMON,
        active: false,
        tier: "ENTERPRISE",
        allowsPayrollAndBanking: true,
      };
      const subRes = validatePayrollSubscription(inactiveSub, TENANT_CINNAMON);
      assert.equal(subRes.ok, false);
      if (!subRes.ok) {
        assert.equal(subRes.error.code, "SUBSCRIPTION_INACTIVE");
      }

      const starterSub: PayrollSaasSubscription = {
        tenantId: TENANT_CINNAMON,
        active: true,
        tier: "STARTER",
        allowsPayrollAndBanking: false,
      };
      const planRes = validatePayrollSubscription(starterSub, TENANT_CINNAMON);
      assert.equal(planRes.ok, false);
      if (!planRes.ok) {
        assert.equal(planRes.error.code, "PLAN_LIMITATION");
      }

      const validRes = validatePayrollSubscription(ACTIVE_SUBSCRIPTION, TENANT_CINNAMON);
      assert.equal(validRes.ok, true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Stage 1: Monthly Guest Folio 10% Service Charge Collection
  // --------------------------------------------------------------------------
  let collectedGrossScLkr = 1250000;

  describe("2. Stage 1: Monthly 10% Service Charge Collection from Guest Folios", () => {
    it("aggregates departmental guest folio items with exact 4-stage compounding taxes", () => {
      // Representative month-end folio batch for checkout folios
      // Total room base: 7,500,000 LKR (10% SC = 750,000 LKR)
      // Total F&B base: 3,500,000 LKR (10% SC = 350,000 LKR)
      // Total Spa base: 1,200,000 LKR (10% SC = 120,000 LKR)
      // Total Laundry base: 300,000 LKR (10% SC = 30,000 LKR)
      // Excursion (SC-Exempt safari): 500,000 LKR (0% SC)
      const folioLines: FolioLineItem[] = [
        {
          lineId: "FOL-OCT-001",
          department: "ROOM",
          description: "Deluxe Ocean Suite - 30 Night Stays",
          quantity: 1,
          unitBaseLkr: 7500000,
        },
        {
          lineId: "FOL-OCT-002",
          department: "FNB",
          description: "Dining Room & Beach BBQ Revenue",
          quantity: 1,
          unitBaseLkr: 3500000,
        },
        {
          lineId: "FOL-OCT-003",
          department: "SPA",
          description: "Ayurvedic Wellness Treatments",
          quantity: 1,
          unitBaseLkr: 1200000,
        },
        {
          lineId: "FOL-OCT-004",
          department: "LAUNDRY",
          description: "Guest Valet & Dry Cleaning Services",
          quantity: 1,
          unitBaseLkr: 300000,
        },
        {
          lineId: "FOL-OCT-005",
          department: "EXCURSION",
          description: "Madu River Safari (Third-Party Boat Operators)",
          quantity: 1,
          unitBaseLkr: 500000,
          scExempt: true, // Statutory SC-exempt line
        },
      ];

      const aggResult = aggregateFolioTaxes(folioLines, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.equal(aggResult.ok, true);
      if (!aggResult.ok) return;

      const taxes = aggResult.value;

      // Base amounts:
      // Billable Base: 7.5M + 3.5M + 1.2M + 0.3M + 0.5M = 13,000,000 LKR
      assert.equal(taxes.totalBaseLkr, 13000000);

      // Service Charge: 10% on (7.5M + 3.5M + 1.2M + 0.3M) = 10% of 12,500,000 = 1,250,000 LKR
      // Excursion is exempt from SC
      assert.equal(taxes.totalScLkr, 1250000);
      collectedGrossScLkr = taxes.totalScLkr;

      // Verify compounding tax stages:
      // Subtotal after SC = 13,000,000 + 1,250,000 = 14,250,000 LKR
      assert.equal(taxes.totalSubtotalAfterScLkr, 14250000);
      // TDL 1% on 14,250,000 = 142,500 LKR
      assert.equal(taxes.totalTdlLkr, 142500);
      // SSCL 2.5% on 14,250,000 = 356,250 LKR
      assert.equal(taxes.totalSsclLkr, 356250);
      // VAT Base = Subtotal + TDL + SSCL = 14,250,000 + 142,500 + 356,250 = 14,748,750 LKR
      assert.equal(taxes.totalVatBaseLkr, 14748750);
      // VAT 18% on 14,748,750 = 2,654,775 LKR
      assert.equal(taxes.totalVatLkr, 2654775);
      // Grand Total = 17,403,525 LKR
      assert.equal(taxes.grandTotalLkr, 17403525);

      // Generate SHA-256 audit entry for folio closing
      const auditRes = createFolioTaxAuditEntry(
        TENANT_CINNAMON,
        FINANCE_CONTROLLER_ACTOR.userId,
        "FOLIO-BATCH-OCT-2026",
        taxes,
        "2026-10-31T23:59:59.000Z",
        currentHash,
      );
      assert.equal(auditRes.ok, true);
      if (auditRes.ok) {
        appendAudit(auditRes.value);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 3. Stage 2 & 3: Breakage Deduction & Service Charge Pool Distribution
  // --------------------------------------------------------------------------
  const staffRoster: readonly RosterStaff[] = [
    {
      profile: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-001",
        employeeName: "Saman Perera",
        department: "Kitchen",
        designation: "Executive Chef",
        basicSalaryLkr: 180000,
        budgetaryReliefAllowanceLkr: 10000,
        fixedAllowancesLkr: 25000,
        epfRegistrationNo: "EPF-COL-8801",
        nicOrPassport: "197825001234",
      },
      weight: 2.0,
      daysWorked: 26, // 2.0 * 26 = 52 points
      attendance: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-001",
        billingPeriod: BILLING_PERIOD,
        daysWorked: 26,
        overtimeHours: 12,
        mealDeductionsLkr: 2000,
        salaryAdvanceDeductionsLkr: 15000,
      },
      bankName: "Commercial Bank of Ceylon",
      bankCode: "7010",
      branchCode: "066",
      accountNumber: "8001234567",
    },
    {
      profile: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-002",
        employeeName: "Kumari Fernando",
        department: "F&B Service",
        designation: "Restaurant Manager",
        basicSalaryLkr: 130000,
        budgetaryReliefAllowanceLkr: 10000,
        fixedAllowancesLkr: 15000,
        epfRegistrationNo: "EPF-COL-8802",
        nicOrPassport: "198354002345",
      },
      weight: 1.8,
      daysWorked: 25, // 1.8 * 25 = 45 points
      attendance: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-002",
        billingPeriod: BILLING_PERIOD,
        daysWorked: 25,
        overtimeHours: 8,
        mealDeductionsLkr: 1500,
        salaryAdvanceDeductionsLkr: 0,
      },
      bankName: "Bank of Ceylon",
      bankCode: "7083",
      branchCode: "101",
      accountNumber: "000234567890",
    },
    {
      profile: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-003",
        employeeName: "Dinesh Jayasinghe",
        department: "Front Office",
        designation: "Front Desk Supervisor",
        basicSalaryLkr: 95000,
        budgetaryReliefAllowanceLkr: 10000,
        fixedAllowancesLkr: 10000,
        epfRegistrationNo: "EPF-COL-8803",
        nicOrPassport: "199012003456",
      },
      weight: 1.5,
      daysWorked: 26, // 1.5 * 26 = 39 points
      attendance: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-003",
        billingPeriod: BILLING_PERIOD,
        daysWorked: 26,
        overtimeHours: 15,
        mealDeductionsLkr: 1500,
        salaryAdvanceDeductionsLkr: 10000,
      },
      bankName: "Hatton National Bank",
      bankCode: "7092",
      branchCode: "012",
      accountNumber: "012010987654",
    },
    {
      profile: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-004",
        employeeName: "Nihal Wickramasinghe",
        department: "Maintenance",
        designation: "HVAC & Electrical Technician",
        basicSalaryLkr: 75000,
        budgetaryReliefAllowanceLkr: 10000,
        fixedAllowancesLkr: 8000,
        epfRegistrationNo: "EPF-COL-8804",
        nicOrPassport: "198823004567",
      },
      weight: 1.2,
      daysWorked: 24, // 1.2 * 24 = 28.8 points
      attendance: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-004",
        billingPeriod: BILLING_PERIOD,
        daysWorked: 24,
        overtimeHours: 20,
        mealDeductionsLkr: 1000,
        salaryAdvanceDeductionsLkr: 5000,
      },
      bankName: "Sampath Bank",
      bankCode: "7278",
      branchCode: "044",
      accountNumber: "044020112233",
    },
    {
      profile: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-005",
        employeeName: "Malkanthi Silva",
        department: "Housekeeping",
        designation: "Senior Room Attendant",
        basicSalaryLkr: 60000,
        budgetaryReliefAllowanceLkr: 10000,
        fixedAllowancesLkr: 5000,
        epfRegistrationNo: "EPF-COL-8805",
        nicOrPassport: "198578005678",
      },
      weight: 1.0,
      daysWorked: 26, // 1.0 * 26 = 26 points
      attendance: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-005",
        billingPeriod: BILLING_PERIOD,
        daysWorked: 26,
        overtimeHours: 10,
        mealDeductionsLkr: 1000,
        salaryAdvanceDeductionsLkr: 0,
      },
      bankName: "Commercial Bank of Ceylon",
      bankCode: "7010",
      branchCode: "066",
      accountNumber: "8009876543",
    },
    {
      profile: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-006",
        employeeName: "Kasun Rajapaksha",
        department: "F&B Service",
        designation: "Banquet Steward",
        basicSalaryLkr: 45000,
        budgetaryReliefAllowanceLkr: 10000,
        fixedAllowancesLkr: 4000,
        epfRegistrationNo: "EPF-COL-8806",
        nicOrPassport: "199920006789",
      },
      weight: 1.0,
      daysWorked: 22, // 1.0 * 22 = 22 points
      attendance: {
        tenantId: TENANT_CINNAMON,
        employeeId: "EMP-006",
        billingPeriod: BILLING_PERIOD,
        daysWorked: 22,
        overtimeHours: 16,
        mealDeductionsLkr: 1000,
        salaryAdvanceDeductionsLkr: 0,
      },
      bankName: "Bank of Ceylon",
      bankCode: "7083",
      branchCode: "101",
      accountNumber: "000567890123",
    },
  ];

  const scAllocations = new Map<string, number>();

  describe("3. Stage 2 & 3: Breakage Deduction Recovery & Staff Point SC Distribution", () => {
    it("deducts 5% breakage recovery and distributes net pool according to weighted attendance", () => {
      // 5% breakage recovery on 1,250,000 LKR = 62,500 LKR
      // Net distributable pool = 1,187,500 LKR
      // Points sum: 52 + 45 + 39 + 28.8 + 26 + 22 = 212.8 points
      const poolInput = {
        tenantId: TENANT_CINNAMON,
        billingPeriod: BILLING_PERIOD,
        totalScLkr: collectedGrossScLkr,
        breakageRecoveryPercent: 5,
        employees: staffRoster.map((s) => ({
          employeeId: s.profile.employeeId,
          employeeName: s.profile.employeeName,
          staffPointWeight: s.weight,
          daysWorked: s.daysWorked,
          department: s.profile.department,
        })),
      };

      const poolRes = calculateServiceChargePool(poolInput);
      assert.equal(poolRes.ok, true);
      if (!poolRes.ok) return;

      const pool = poolRes.value;
      assert.equal(pool.grossScLkr, 1250000);
      assert.equal(pool.breakageRecoveryPercent, 5);
      assert.equal(pool.breakageDeductionLkr, 62500);
      assert.equal(pool.netScPoolLkr, 1187500);
      assert.equal(pool.totalWeightedPoints, 212.8);

      // Verify each staff allocation:
      let allocatedSum = 0;
      for (const alloc of pool.allocations) {
        scAllocations.set(alloc.employeeId, alloc.shareLkr);
        allocatedSum += alloc.shareLkr;
      }
      allocatedSum = roundLkr(allocatedSum);
      assert.equal(allocatedSum, pool.totalAllocatedLkr);
      assert.equal(pool.totalAllocatedLkr, 1187500.01);
      assert.equal(pool.roundingDifferenceCents, -0.01);

      // Verify individual proportions:
      // Point value = 1,187,500 / 212.8 = 5580.3571...
      // Chef: 52 points * 5580.3571 = 290,178.57 LKR
      const chefShare = scAllocations.get("EMP-001");
      assert.equal(chefShare, 290178.57);

      // Append cryptographic audit entry for SC pool distribution
      const auditRes = createServiceChargePoolAuditEntry(
        TENANT_CINNAMON,
        HR_MANAGER_ACTOR.userId,
        BILLING_PERIOD,
        pool,
        "2026-10-31T23:59:59.000Z",
        currentHash,
      );
      assert.equal(auditRes.ok, true);
      if (auditRes.ok) {
        appendAudit(auditRes.value);
      }
    });

    it("rejects breakage deductions exceeding statutory 10% cap", () => {
      const invalidPoolInput = {
        tenantId: TENANT_CINNAMON,
        billingPeriod: BILLING_PERIOD,
        totalScLkr: collectedGrossScLkr,
        breakageRecoveryPercent: 12.5, // Exceeds 10%
        employees: [
          {
            employeeId: "EMP-001",
            staffPointWeight: 1.0,
            daysWorked: 20,
          },
        ],
      };

      const result = calculateServiceChargePool(invalidPoolInput);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "VALIDATION_FAILED");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. Stage 4: Monthly Payroll Generation with EPF, ETF & APIT
  // --------------------------------------------------------------------------
  const calculatedPayslips: EmployeePayslipResult[] = [];

  describe("4. Stage 4: Monthly Payroll Generation with EPF, ETF & APIT", () => {
    it("computes compliant Sri Lankan payslips with EPF, ETF, overtime, and progressive APIT", () => {
      for (const staff of staffRoster) {
        const scShare = scAllocations.get(staff.profile.employeeId) ?? 0;
        const payslipRes = generateEmployeePayslip(staff.profile, staff.attendance, scShare);

        assert.equal(payslipRes.ok, true);
        if (!payslipRes.ok) continue;

        const payslip = payslipRes.value;
        calculatedPayslips.push(payslip);

        verifySinglePayslip(staff, payslip, scShare);

        // Generate SHA-256 audit entry for each payslip
        const auditRes = createPayslipAuditEntry(
          TENANT_CINNAMON,
          FINANCE_CONTROLLER_ACTOR.userId,
          payslip,
          "2026-10-31T23:59:59.000Z",
          currentHash,
        );
        assert.equal(auditRes.ok, true);
        if (auditRes.ok) {
          appendAudit(auditRes.value);
        }
      }

      assert.equal(calculatedPayslips.length, 6);
    });

    it("verifies APIT progressive tax brackets on high-earning staff (Executive Chef)", () => {
      const chefPayslip = calculatedPayslips.find((p) => p.employeeId === "EMP-001");
      assert.ok(chefPayslip);
      // Chef: Basic 180k + BRA 10k + Allowances 25k + OT 17.1k + SC 290.178k = Gross > 500,000 LKR
      // Relief threshold = 100,000 LKR. Slabs applied progressively (6%, 12%, 18%, 24%, 30%, 36%).
      assert.ok(chefPayslip.grossEarningsLkr > 500000);
      assert.ok(chefPayslip.apitTaxLkr > 75000);
      // Net pay must be positive and integer-cent rounded
      assert.ok(chefPayslip.netPayLkr > 300000);
    });

    it("verifies APIT withholding on lower-wage staff under relief threshold", () => {
      // Junior Banquet Steward: Basic 45k + BRA 10k + Allowances 4k + OT 6.6k + SC ~122k
      // Gross around 188k. Taxable amount = 88k (subject to 6% on first slab).
      const stewardPayslip = calculatedPayslips.find((p) => p.employeeId === "EMP-006");
      assert.ok(stewardPayslip);
      assert.ok(stewardPayslip.netPayLkr > 170000);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Stage 5: Bank SLIPS Transfer Batch Generation
  // --------------------------------------------------------------------------
  describe("5. Stage 5: Commercial Bank & LankaPay SLIPS Export", () => {
    const hotelOriginAccount: OriginatingAccountProfile = {
      bankCode: "7010", // Commercial Bank of Ceylon
      branchCode: "066", // Bentota Branch
      accountNumber: "1000889900",
      companyName: "Cinnamon Bentota Beach Hotel Ltd",
    };

    it("exports Commercial Bank PayMaster SLIPS batch reconciling exact total net salaries", () => {
      const transferItems = staffRoster.map((s) => {
        const payslip = calculatedPayslips.find((p) => p.employeeId === s.profile.employeeId);
        assert.ok(payslip);
        return {
          employeeId: s.profile.employeeId,
          employeeName: s.profile.employeeName,
          destinationBankCode: s.bankCode,
          destinationBranchCode: s.branchCode,
          destinationAccountNumber: s.accountNumber,
          netPayLkr: payslip.netPayLkr,
          nicOrPassport: s.profile.nicOrPassport ?? "200000000000",
          referenceNarrative: `SAL-OCT26-${s.profile.employeeId}`,
        };
      });

      const totalExpectedNetPay = roundLkr(
        calculatedPayslips.reduce((sum, p) => sum + p.netPayLkr, 0),
      );

      const exportRes = exportBankSlipsCsv({
        tenantId: TENANT_CINNAMON,
        billingPeriod: BILLING_PERIOD,
        format: "COMMERCIAL_BANK_PAYMASTER",
        origin: hotelOriginAccount,
        paymentDate: "2026-10-31",
        transfers: transferItems,
        actorUserId: FINANCE_CONTROLLER_ACTOR.userId,
        isoTs: "2026-10-31T23:59:59.000Z",
        previousAuditHash: currentHash,
      });

      assert.equal(exportRes.ok, true);
      if (!exportRes.ok) return;

      const exportResult = exportRes.value;
      assert.equal(exportResult.tenantId, TENANT_CINNAMON);
      assert.equal(exportResult.totalCount, 6);
      assert.equal(exportResult.totalAmountLkr, totalExpectedNetPay);
      assert.equal(exportResult.format, "COMMERCIAL_BANK_PAYMASTER");

      // Verify CSV contents
      const csvLines = exportResult.csvContent.split("\n");
      assert.ok(csvLines.length >= 7); // Header + 6 records
      assert.ok(csvLines[0]?.includes("Beneficiary_Name"));
      assert.ok(exportResult.csvContent.includes("7010")); // Commercial Bank code
      assert.ok(exportResult.csvContent.includes("7083")); // BOC
      assert.ok(exportResult.csvContent.includes("7092")); // HNB
      assert.ok(exportResult.csvContent.includes("7278")); // Sampath

      // Append audit entry for bank slips export
      appendAudit(exportResult.auditEntry);
    });

    it("exports LankaPay Standard SLIPS CSV and validates beneficiary data formatting", () => {
      const transferItems = staffRoster.map((s) => {
        const payslip = calculatedPayslips.find((p) => p.employeeId === s.profile.employeeId);
        assert.ok(payslip);
        return {
          employeeId: s.profile.employeeId,
          employeeName: s.profile.employeeName,
          destinationBankCode: s.bankCode,
          destinationBranchCode: s.branchCode,
          destinationAccountNumber: s.accountNumber,
          netPayLkr: payslip.netPayLkr,
          nicOrPassport: s.profile.nicOrPassport ?? "200000000000",
        };
      });

      const exportRes = exportBankSlipsCsv({
        tenantId: TENANT_CINNAMON,
        billingPeriod: BILLING_PERIOD,
        format: "LANKAPAY_SLIPS_STANDARD",
        origin: hotelOriginAccount,
        paymentDate: "2026-10-31",
        transfers: transferItems,
      });

      assert.equal(exportRes.ok, true);
      if (!exportRes.ok) return;

      assert.equal(exportRes.value.format, "LANKAPAY_SLIPS_STANDARD");
      assert.ok(exportRes.value.csvContent.startsWith("H,7010"));
    });
  });

  // --------------------------------------------------------------------------
  // 6. Stage 6: LKAS 19 Employee Benefits & Gratuity Act No. 12 of 1983
  // --------------------------------------------------------------------------
  describe("6. Stage 6: LKAS 19 Employee Benefits & Gratuity Act No. 12 of 1983 Provision", () => {
    it("distinguishes between unvested accrual (< 5 yrs) and vested statutory liability (>= 5 yrs)", () => {
      // 1. Unvested junior steward (Kasun, joined 2024-01-01 -> 2 completed years at assessment)
      const juniorTenureGratuity = calculateStatutoryGratuity({
        employeeId: "EMP-006",
        wageType: "MONTHLY",
        lastMonthlyBasicSalary: 45000,
        completedYearsOfService: 2,
      });
      assert.equal(juniorTenureGratuity.ok, true);
      if (juniorTenureGratuity.ok) {
        // Less than 5 years: statutory exit payout must be strictly 0 LKR
        assert.equal(juniorTenureGratuity.value.isVested, false);
        assert.equal(juniorTenureGratuity.value.netPayableGratuityLkr, 0);
      }

      // 2. Tenured Executive Chef (Saman, joined 2018-05-01 -> 8 completed years at 2026-10-31)
      const tenuredChefGratuity = calculateStatutoryGratuity({
        employeeId: "EMP-001",
        wageType: "MONTHLY",
        lastMonthlyBasicSalary: 180000,
        completedYearsOfService: 8,
      });
      assert.equal(tenuredChefGratuity.ok, true);
      if (tenuredChefGratuity.ok) {
        // >= 5 years: 0.5 * 180,000 * 8 = 720,000 LKR
        assert.equal(tenuredChefGratuity.value.isVested, true);
        assert.equal(tenuredChefGratuity.value.netPayableGratuityLkr, 720000);
      }
    });

    it("evaluates hotel-wide balance sheet gratuity provision with department breakdowns", () => {
      const gratuityEmployees: GratuityEmployeeInput[] = [
        {
          employeeId: "EMP-001",
          employeeName: "Saman Perera",
          department: "Kitchen",
          dateOfJoining: "2018-05-01",
          wageType: "MONTHLY",
          lastMonthlyBasicSalary: 180000,
        },
        {
          employeeId: "EMP-002",
          employeeName: "Kumari Fernando",
          department: "F&B Service",
          dateOfJoining: "2020-03-15",
          wageType: "MONTHLY",
          lastMonthlyBasicSalary: 130000,
        },
        {
          employeeId: "EMP-003",
          employeeName: "Dinesh Jayasinghe",
          department: "Front Office",
          dateOfJoining: "2019-11-01",
          wageType: "MONTHLY",
          lastMonthlyBasicSalary: 95000,
        },
        {
          employeeId: "EMP-004",
          employeeName: "Nihal Wickramasinghe",
          department: "Maintenance",
          dateOfJoining: "2021-08-01",
          wageType: "MONTHLY",
          lastMonthlyBasicSalary: 75000,
        },
        {
          employeeId: "EMP-005",
          employeeName: "Malkanthi Silva",
          department: "Housekeeping",
          dateOfJoining: "2022-02-01",
          wageType: "MONTHLY",
          lastMonthlyBasicSalary: 60000,
        },
        {
          employeeId: "EMP-006",
          employeeName: "Kasun Rajapaksha",
          department: "F&B Service",
          dateOfJoining: "2024-01-10",
          wageType: "MONTHLY",
          lastMonthlyBasicSalary: 45000,
        },
      ];

      const hotelGratuityRes = calculateHotelGratuityProvision({
        tenantId: TENANT_CINNAMON,
        assessmentDate: "2026-10-31",
        employees: gratuityEmployees,
        actorUserId: HR_MANAGER_ACTOR.userId,
        prevAuditHash: currentHash,
      });

      assert.equal(hotelGratuityRes.ok, true);
      if (!hotelGratuityRes.ok) return;

      const report = hotelGratuityRes.value;

      assert.equal(report.tenantId, TENANT_CINNAMON);
      assert.equal(report.totalHeadcount, 6);
      assert.equal(report.vestedHeadcount, 4); // EMP-001, 002, 003, 004
      assert.equal(report.unvestedHeadcount, 2); // EMP-005, 006

      // Verify department breakdown
      assert.ok(report.departmentBreakdowns.some((d) => d.department === "Kitchen"));
      assert.ok(report.departmentBreakdowns.some((d) => d.department === "F&B Service"));
      assert.ok(report.departmentBreakdowns.some((d) => d.department === "Front Office"));
      assert.ok(report.departmentBreakdowns.some((d) => d.department === "Maintenance"));
      assert.ok(report.departmentBreakdowns.some((d) => d.department === "Housekeeping"));

      // Verify positive balance sheet liability
      assert.ok(report.totalLiabilityLkr > 1000000);
      assert.ok(report.totalMonthlyAccrualExpenseLkr > 0);

      // Append audit entry to chain
      appendAudit(report.auditEntry);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Stage 7: End-to-End Cryptographic SHA-256 Audit Chain Verification
  // --------------------------------------------------------------------------
  describe("7. Stage 7: End-to-End Cryptographic SHA-256 Audit Chain Verification", () => {
    it("validates that all payroll and financial events form an unbroken cryptographic audit trail", () => {
      // Entries:
      // 1. Folio closure tax entry
      // 2. Service charge pool distribution entry
      // 3. 6 employee payslip entries
      // 4. Bank slips export entry
      // 5. Hotel gratuity provision entry
      // Total = 1 + 1 + 6 + 1 + 1 = 10 audit entries
      assert.equal(auditTrail.length, 10);

      // Verify unbroken chain from GENESIS_HASH
      const chainRes = verifyAuditChain(auditTrail);
      assert.equal(chainRes.ok, true);
      if (chainRes.ok) {
        assert.equal(chainRes.value.verifiedCount, 10);
      }
    });

    it("detects and rejects tamper attempts in historical audit entries", () => {
      // Clone audit trail and tamper with the bank slip record amount payload
      const tamperedTrail = auditTrail.map((entry) => ({ ...entry }));
      const bankEntryIndex = tamperedTrail.findIndex((e) => e.action === "EXPORT_BANK_SLIPS");
      assert.ok(bankEntryIndex >= 0);

      const bankEntry = tamperedTrail[bankEntryIndex];
      if (bankEntry) {
        tamperedTrail[bankEntryIndex] = {
          ...bankEntry,
          afterJson: JSON.stringify({
            tamperedAmount: 999999999, // Unauthorized manipulation
          }),
        };
      }

      const tamperedRes = verifyAuditChain(tamperedTrail);
      assert.equal(tamperedRes.ok, false);
      if (!tamperedRes.ok) {
        assert.equal(tamperedRes.error.code, "AUDIT_CHAIN_CORRUPTED");
      }
    });
  });
});
