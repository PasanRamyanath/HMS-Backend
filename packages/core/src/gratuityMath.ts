/**
 * @hms/core - Sri Lankan Statutory Gratuity Accrual & Payout Estimator.
 *
 * Implements statutory computations governed by:
 * - Payment of Gratuity Act No. 12 of 1983 (and amendments No. 41 of 1990 & No. 62 of 1992)
 * - Sri Lanka Accounting Standard LKAS 19 / IFRS Employee Benefits (Gratuity Liability Provisioning)
 *
 * Statutory Invariants:
 * 1. Eligibility: Applies to employers with 15 or more workmen. A workman who has
 *    completed not less than five (5) continuous years of service is entitled to gratuity
 *    upon termination of service (resignation, retirement, retrenchment, or death).
 * 2. Rate of Payment:
 *    - Monthly-rated employee: 1/2 month's (14 days) basic salary/wage for each completed
 *      year of service: 0.5 * lastMonthlyBasicSalary * completedYearsOfService.
 *    - Daily-rated employee: 14 days' wages for each completed year of service.
 *    - Piece-rated employee: 14 days' average daily wage for each completed year of service.
 * 3. Non-vested tenure (< 5 completed years): Statutory payout upon termination is 0 LKR.
 * 4. Balance Sheet Liability Provision (LKAS 19): The hotel recognizes an ongoing liability
 *    for both vested and unvested employees based on accrued service to date, ensuring
 *    accurate monthly balance sheet provisioning.
 * 5. Forfeiture (Section 13): Permissible only to the extent of actual damage or loss
 *    occasioned to hotel property by reason of theft, fraud, or gross misconduct.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type WageType = "MONTHLY" | "DAILY" | "PIECE_RATE";

export type GratuityTerminationReason =
  | "RESIGNATION"
  | "RETIREMENT"
  | "RETRENCHMENT"
  | "DEATH"
  | "DISMISSAL_WITH_CAUSE"
  | "END_OF_CONTRACT";

/**
 * Direct input for calculating single employee statutory gratuity under Act No. 12 of 1983.
 */
export interface StatutoryGratuityInput {
  readonly employeeId: string;
  readonly completedYearsOfService: number;
  readonly wageType?: WageType | undefined;
  /** Last drawn monthly basic salary in LKR (for monthly-rated employees). */
  readonly lastMonthlyBasicSalary?: number | undefined;
  /** Last drawn daily wage in LKR (for daily-rated employees). */
  readonly dailyWage?: number | undefined;
  /** Permissible deduction under Section 13 for proved loss/damage to hotel property. */
  readonly statutoryForfeitureLkr?: number | undefined;
  /** Custom statutory vesting threshold in years (defaults to 5 years). */
  readonly vestingYearsThreshold?: number | undefined;
}

/**
 * Result of direct statutory gratuity calculation.
 */
export interface StatutoryGratuityCalculation {
  readonly employeeId: string;
  readonly completedYearsOfService: number;
  readonly wageType: WageType;
  readonly isVested: boolean;
  readonly statutoryRatePerYearLkr: number;
  readonly grossGratuityLkr: number;
  readonly forfeitureLkr: number;
  readonly netPayableGratuityLkr: number;
}

/**
 * Employee profile used for detailed balance sheet gratuity accrual & provisioning.
 */
export interface GratuityEmployeeInput {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly department: string; // e.g. "FRONT_DESK", "HOUSEKEEPING", "F_AND_B", "KITCHEN", "MAINTENANCE"
  readonly dateOfJoining: string; // ISO format: "YYYY-MM-DD"
  readonly wageType?: WageType | undefined;
  readonly lastMonthlyBasicSalary: number; // LKR
  readonly dailyWage?: number | undefined; // LKR
  readonly assessmentDate?: string | undefined; // ISO date "YYYY-MM-DD", defaults to report assessmentDate
  readonly completedYearsOfServiceOverride?: number | undefined;
  readonly priorAccruedProvisionLkr?: number | undefined; // Previous cumulative liability in LKR
  readonly statutoryForfeitureLkr?: number | undefined;
  readonly isTerminated?: boolean | undefined;
  readonly terminationReason?: GratuityTerminationReason | undefined;
}

/**
 * Calculated employee gratuity accrual breakdown for balance sheet reporting.
 */
export interface EmployeeGratuityResult {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly department: string;
  readonly dateOfJoining: string;
  readonly assessmentDate: string;
  readonly tenureYears: number; // Decimal years of service (e.g. 5.42)
  readonly completedYears: number; // Integer completed years of service (e.g. 5)
  readonly wageType: WageType;
  readonly isVested: boolean; // completedYears >= 5
  readonly monthlyBasicSalaryLkr: number;
  readonly statutoryRatePerYearLkr: number;
  readonly statutoryEntitlementLkr: number; // 0 if < 5 years, else 0.5 * salary * completedYears
  readonly unvestedAccrualLkr: number; // Accounting provision for employees with < 5 years
  readonly balanceSheetLiabilityLkr: number; // Total recognized provision on hotel balance sheet
  readonly monthlyAccrualExpenseLkr: number; // Incremental provision recognized this cycle
  readonly forfeitureLkr: number;
  readonly payableGratuityLkr: number; // Net payable on termination
}

/**
 * Department-level summary for managerial accounting & department budgeting.
 */
export interface DepartmentGratuityBreakdown {
  readonly department: string;
  readonly headcount: number;
  readonly vestedHeadcount: number;
  readonly unvestedHeadcount: number;
  readonly totalVestedLiabilityLkr: number;
  readonly totalUnvestedLiabilityLkr: number;
  readonly totalLiabilityLkr: number;
  readonly totalMonthlyAccrualExpenseLkr: number;
}

/**
 * Hotel-wide input parameters for balance sheet gratuity valuation.
 */
export interface HotelGratuityProvisionInput {
  readonly tenantId: string;
  readonly hotelName?: string | undefined;
  readonly assessmentDate: string; // ISO format "YYYY-MM-DD"
  readonly actorUserId: string;
  readonly employees: readonly GratuityEmployeeInput[];
  /** Vesting threshold in years. Statutory Sri Lanka standard is 5 years. */
  readonly vestingYearsThreshold?: number | undefined;
  /**
   * Discount / probability haircut factor applied to unvested employee accruals (0.0 to 1.0).
   * 1.0 = full straight-line service accrual (LKAS 19 baseline).
   * 0.0 = only recognize liability once 5 years are completed.
   * Defaults to 1.0.
   */
  readonly unvestedDiscountFactor?: number | undefined;
  readonly prevAuditHash?: string | undefined;
}

/**
 * Master balance sheet report for Sri Lankan hotel statutory gratuity liability.
 */
export interface HotelGratuityProvisionResult {
  readonly tenantId: string;
  readonly hotelName: string;
  readonly assessmentDate: string;
  readonly totalHeadcount: number;
  readonly vestedHeadcount: number;
  readonly unvestedHeadcount: number;
  readonly totalVestedLiabilityLkr: number;
  readonly totalUnvestedLiabilityLkr: number;
  readonly totalLiabilityLkr: number;
  readonly totalMonthlyAccrualExpenseLkr: number;
  readonly departmentBreakdowns: readonly DepartmentGratuityBreakdown[];
  readonly employeeBreakdowns: readonly EmployeeGratuityResult[];
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Service Tenure Helper Functions
// ============================================================================

/**
 * Computes completed full years and exact decimal tenure years between joining and assessment dates.
 */
export function calculateServiceTenure(
  dateOfJoiningIso: string,
  assessmentDateIso: string,
): Result<{ completedYears: number; tenureYears: number; daysOfService: number }, DomainError> {
  const joinDate = new Date(
    dateOfJoiningIso.includes("T") ? dateOfJoiningIso : `${dateOfJoiningIso}T00:00:00Z`,
  );
  const assessDate = new Date(
    assessmentDateIso.includes("T") ? assessmentDateIso : `${assessmentDateIso}T00:00:00Z`,
  );

  if (Number.isNaN(joinDate.getTime())) {
    return domainErr("VALIDATION_FAILED", "Invalid dateOfJoining format", { dateOfJoiningIso });
  }

  if (Number.isNaN(assessDate.getTime())) {
    return domainErr("VALIDATION_FAILED", "Invalid assessmentDate format", { assessmentDateIso });
  }

  if (assessDate.getTime() < joinDate.getTime()) {
    return domainErr("VALIDATION_FAILED", "assessmentDate cannot precede dateOfJoining", {
      dateOfJoiningIso,
      assessmentDateIso,
    });
  }

  // Calculate completed full years
  let years = assessDate.getUTCFullYear() - joinDate.getUTCFullYear();
  const monthDiff = assessDate.getUTCMonth() - joinDate.getUTCMonth();
  const dayDiff = assessDate.getUTCDate() - joinDate.getUTCDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years--;
  }
  const completedYears = Math.max(0, years);

  // Exact days of service
  const diffMs = assessDate.getTime() - joinDate.getTime();
  const daysOfService = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Decimal tenure years (365.25 days per average Gregorian year accounting for leap years)
  const tenureYears = Math.max(
    0,
    Math.round((daysOfService / 365.25 + Number.EPSILON) * 100) / 100,
  );

  return ok({
    completedYears,
    tenureYears,
    daysOfService,
  });
}

// ============================================================================
// Statutory Gratuity Pure Computation
// ============================================================================

function validateStatutoryInput(input: StatutoryGratuityInput): Result<void, DomainError> {
  if (!input.employeeId || input.employeeId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "employeeId cannot be empty");
  }

  if (
    typeof input.completedYearsOfService !== "number" ||
    !Number.isFinite(input.completedYearsOfService) ||
    input.completedYearsOfService < 0
  ) {
    return domainErr("VALIDATION_FAILED", "completedYearsOfService must be a non-negative number", {
      employeeId: input.employeeId,
      completedYearsOfService: input.completedYearsOfService,
    });
  }

  if (input.statutoryForfeitureLkr !== undefined) {
    if (
      typeof input.statutoryForfeitureLkr !== "number" ||
      !Number.isFinite(input.statutoryForfeitureLkr) ||
      input.statutoryForfeitureLkr < 0
    ) {
      return domainErr(
        "VALIDATION_FAILED",
        "statutoryForfeitureLkr must be a non-negative number",
        {
          employeeId: input.employeeId,
          statutoryForfeitureLkr: input.statutoryForfeitureLkr,
        },
      );
    }
  }

  return ok(undefined);
}

function resolveStatutoryAnnualRate(input: StatutoryGratuityInput): Result<number, DomainError> {
  const wageType = input.wageType ?? "MONTHLY";

  if (wageType === "DAILY") {
    const dailyWage = input.dailyWage ?? 0;
    if (typeof dailyWage !== "number" || !Number.isFinite(dailyWage) || dailyWage <= 0) {
      return domainErr(
        "VALIDATION_FAILED",
        "dailyWage must be a positive number for daily-rated employee",
        {
          employeeId: input.employeeId,
          dailyWage,
        },
      );
    }
    // 14 days' wages per year
    return ok(roundLkr(14 * roundLkr(dailyWage)));
  }

  const salary = input.lastMonthlyBasicSalary ?? 0;
  if (typeof salary !== "number" || !Number.isFinite(salary) || salary <= 0) {
    return domainErr("VALIDATION_FAILED", "lastMonthlyBasicSalary must be a positive number", {
      employeeId: input.employeeId,
      lastMonthlyBasicSalary: salary,
    });
  }
  // Half a month's basic salary per completed year
  return ok(roundLkr(0.5 * roundLkr(salary)));
}

/**
 * Pure deterministic calculation of statutory gratuity under Payment of Gratuity Act No. 12 of 1983.
 *
 * Rules:
 * - If completedYearsOfService < vestingYearsThreshold (default 5 years): Gross gratuity = 0 LKR.
 * - If completedYearsOfService >= vestingYearsThreshold:
 *     - Monthly-rated: 0.5 * lastMonthlyBasicSalary * completedYearsOfService
 *     - Daily-rated: 14 * dailyWage * completedYearsOfService
 * - Forfeiture under Section 13 deducted from gross gratuity, not exceeding gross amount.
 */
export function calculateStatutoryGratuity(
  input: StatutoryGratuityInput,
): Result<StatutoryGratuityCalculation, DomainError> {
  const validationRes = validateStatutoryInput(input);
  if (!validationRes.ok) {
    return validationRes;
  }

  const rateRes = resolveStatutoryAnnualRate(input);
  if (!rateRes.ok) {
    return rateRes;
  }

  const statutoryRatePerYearLkr = rateRes.value;
  const completedYears = Math.floor(input.completedYearsOfService);
  const vestingThreshold = input.vestingYearsThreshold ?? 5;
  const isVested = completedYears >= vestingThreshold;

  const grossGratuityLkr = isVested ? roundLkr(statutoryRatePerYearLkr * completedYears) : 0;
  const rawForfeiture = input.statutoryForfeitureLkr ?? 0;
  const forfeitureLkr = roundLkr(Math.min(grossGratuityLkr, Math.max(0, rawForfeiture)));
  const netPayableGratuityLkr = roundLkr(Math.max(0, grossGratuityLkr - forfeitureLkr));

  return ok({
    employeeId: input.employeeId,
    completedYearsOfService: completedYears,
    wageType: input.wageType ?? "MONTHLY",
    isVested,
    statutoryRatePerYearLkr,
    grossGratuityLkr,
    forfeitureLkr,
    netPayableGratuityLkr,
  });
}

// ============================================================================
// Employee Gratuity Accrual for Balance Sheet Provisioning
// ============================================================================

export interface CalculateEmployeeGratuityOptions {
  readonly vestingYearsThreshold?: number | undefined;
  readonly unvestedDiscountFactor?: number | undefined;
  readonly defaultAssessmentDate?: string | undefined;
}

function validateEmployeeInput(emp: GratuityEmployeeInput): Result<void, DomainError> {
  if (!emp.employeeId || emp.employeeId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "employeeId cannot be empty");
  }
  if (!emp.employeeName || emp.employeeName.trim() === "") {
    return domainErr("VALIDATION_FAILED", "employeeName cannot be empty");
  }
  if (!emp.department || emp.department.trim() === "") {
    return domainErr("VALIDATION_FAILED", "department cannot be empty");
  }
  return ok(undefined);
}

function computeUnvestedAccrual(
  isVested: boolean,
  completedYears: number,
  statutoryRatePerYearLkr: number,
  unvestedDiscountFactor: number,
): number {
  if (isVested || completedYears <= 0) {
    return 0;
  }
  return roundLkr(statutoryRatePerYearLkr * completedYears * unvestedDiscountFactor);
}

function resolveEmployeeTenure(
  emp: GratuityEmployeeInput,
  assessmentDate: string,
): Result<{ completedYears: number; tenureYears: number }, DomainError> {
  if (emp.completedYearsOfServiceOverride !== undefined) {
    const override = emp.completedYearsOfServiceOverride;
    if (typeof override !== "number" || !Number.isFinite(override) || override < 0) {
      return domainErr(
        "VALIDATION_FAILED",
        "completedYearsOfServiceOverride must be a non-negative number",
        {
          employeeId: emp.employeeId,
        },
      );
    }
    const completedYears = Math.floor(override);
    return ok({ completedYears, tenureYears: completedYears });
  }

  const tenureRes = calculateServiceTenure(emp.dateOfJoining, assessmentDate);
  if (!tenureRes.ok) {
    return tenureRes;
  }
  return ok({
    completedYears: tenureRes.value.completedYears,
    tenureYears: tenureRes.value.tenureYears,
  });
}

/**
 * Computes individual employee gratuity liability for the hotel's balance sheet under LKAS 19.
 */
export function calculateEmployeeGratuity(
  emp: GratuityEmployeeInput,
  options?: CalculateEmployeeGratuityOptions | undefined,
): Result<EmployeeGratuityResult, DomainError> {
  const validationRes = validateEmployeeInput(emp);
  if (!validationRes.ok) {
    return validationRes;
  }

  const assessmentDate =
    emp.assessmentDate ?? options?.defaultAssessmentDate ?? new Date().toISOString().slice(0, 10);
  const tenureRes = resolveEmployeeTenure(emp, assessmentDate);
  if (!tenureRes.ok) {
    return tenureRes;
  }

  const { completedYears, tenureYears } = tenureRes.value;
  const vestingThreshold = options?.vestingYearsThreshold ?? 5;
  const unvestedDiscountFactor = Math.min(
    1.0,
    Math.max(0.0, options?.unvestedDiscountFactor ?? 1.0),
  );

  const statutoryRes = calculateStatutoryGratuity({
    employeeId: emp.employeeId,
    completedYearsOfService: completedYears,
    wageType: emp.wageType ?? "MONTHLY",
    lastMonthlyBasicSalary: emp.lastMonthlyBasicSalary,
    dailyWage: emp.dailyWage,
    statutoryForfeitureLkr: emp.statutoryForfeitureLkr,
    vestingYearsThreshold: vestingThreshold,
  });

  if (!statutoryRes.ok) {
    return statutoryRes;
  }

  const stat = statutoryRes.value;
  const statutoryEntitlementLkr = stat.grossGratuityLkr;
  const unvestedAccrualLkr = computeUnvestedAccrual(
    stat.isVested,
    completedYears,
    stat.statutoryRatePerYearLkr,
    unvestedDiscountFactor,
  );

  const balanceSheetLiabilityLkr = stat.isVested ? statutoryEntitlementLkr : unvestedAccrualLkr;
  const priorProvision = roundLkr(emp.priorAccruedProvisionLkr ?? 0);
  const monthlyAccrualExpenseLkr = roundLkr(balanceSheetLiabilityLkr - priorProvision);

  return ok({
    employeeId: emp.employeeId,
    employeeName: emp.employeeName,
    department: emp.department,
    dateOfJoining: emp.dateOfJoining,
    assessmentDate,
    tenureYears,
    completedYears,
    wageType: emp.wageType ?? "MONTHLY",
    isVested: stat.isVested,
    monthlyBasicSalaryLkr: roundLkr(emp.lastMonthlyBasicSalary),
    statutoryRatePerYearLkr: stat.statutoryRatePerYearLkr,
    statutoryEntitlementLkr,
    unvestedAccrualLkr,
    balanceSheetLiabilityLkr,
    monthlyAccrualExpenseLkr,
    forfeitureLkr: stat.forfeitureLkr,
    payableGratuityLkr: stat.netPayableGratuityLkr,
  });
}

// ============================================================================
// Master Hotel Gratuity Valuation & Audit Engine
// ============================================================================

interface MutableDepartmentStat {
  headcount: number;
  vestedHeadcount: number;
  unvestedHeadcount: number;
  totalVestedLiabilityLkr: number;
  totalUnvestedLiabilityLkr: number;
  totalLiabilityLkr: number;
  totalMonthlyAccrualExpenseLkr: number;
}

function updateDepartmentStat(stat: MutableDepartmentStat, r: EmployeeGratuityResult): void {
  stat.headcount++;
  if (r.isVested) {
    stat.vestedHeadcount++;
    stat.totalVestedLiabilityLkr = roundLkr(
      stat.totalVestedLiabilityLkr + r.balanceSheetLiabilityLkr,
    );
  } else {
    stat.unvestedHeadcount++;
    stat.totalUnvestedLiabilityLkr = roundLkr(
      stat.totalUnvestedLiabilityLkr + r.balanceSheetLiabilityLkr,
    );
  }
  stat.totalLiabilityLkr = roundLkr(stat.totalLiabilityLkr + r.balanceSheetLiabilityLkr);
  stat.totalMonthlyAccrualExpenseLkr = roundLkr(
    stat.totalMonthlyAccrualExpenseLkr + r.monthlyAccrualExpenseLkr,
  );
}

function validateHotelProvisionInput(
  input: HotelGratuityProvisionInput,
): Result<void, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  if (!input.actorUserId || input.actorUserId.trim() === "") {
    return domainErr(
      "VALIDATION_FAILED",
      "actorUserId is required for gratuity provision audit log",
    );
  }
  if (!input.assessmentDate || input.assessmentDate.trim() === "") {
    return domainErr("VALIDATION_FAILED", "assessmentDate is required");
  }
  if (!Array.isArray(input.employees) || input.employees.length === 0) {
    return domainErr("VALIDATION_FAILED", "employees array cannot be empty");
  }
  return ok(undefined);
}

interface AggregateHotelProvisionData {
  employeeBreakdowns: EmployeeGratuityResult[];
  departmentBreakdowns: DepartmentGratuityBreakdown[];
  totalVestedLiabilityLkr: number;
  totalUnvestedLiabilityLkr: number;
  totalLiabilityLkr: number;
  totalMonthlyAccrualExpenseLkr: number;
  vestedHeadcount: number;
  unvestedHeadcount: number;
}

function aggregateHotelProvisions(
  employees: readonly GratuityEmployeeInput[],
  assessmentDate: string,
  vestingYearsThreshold?: number | undefined,
  unvestedDiscountFactor?: number | undefined,
): Result<AggregateHotelProvisionData, DomainError> {
  const employeeBreakdowns: EmployeeGratuityResult[] = [];
  const deptMap = new Map<string, MutableDepartmentStat>();
  let totalVestedLiabilityLkr = 0;
  let totalUnvestedLiabilityLkr = 0;
  let totalLiabilityLkr = 0;
  let totalMonthlyAccrualExpenseLkr = 0;
  let vestedHeadcount = 0;
  let unvestedHeadcount = 0;

  for (const emp of employees) {
    const empRes = calculateEmployeeGratuity(emp, {
      vestingYearsThreshold: vestingYearsThreshold ?? 5,
      unvestedDiscountFactor: unvestedDiscountFactor ?? 1.0,
      defaultAssessmentDate: assessmentDate,
    });
    if (!empRes.ok) {
      return empRes;
    }

    const r = empRes.value;
    employeeBreakdowns.push(r);

    if (r.isVested) {
      vestedHeadcount++;
      totalVestedLiabilityLkr = roundLkr(totalVestedLiabilityLkr + r.balanceSheetLiabilityLkr);
    } else {
      unvestedHeadcount++;
      totalUnvestedLiabilityLkr = roundLkr(totalUnvestedLiabilityLkr + r.balanceSheetLiabilityLkr);
    }

    totalLiabilityLkr = roundLkr(totalLiabilityLkr + r.balanceSheetLiabilityLkr);
    totalMonthlyAccrualExpenseLkr = roundLkr(
      totalMonthlyAccrualExpenseLkr + r.monthlyAccrualExpenseLkr,
    );

    let dept = deptMap.get(r.department);
    if (!dept) {
      dept = {
        headcount: 0,
        vestedHeadcount: 0,
        unvestedHeadcount: 0,
        totalVestedLiabilityLkr: 0,
        totalUnvestedLiabilityLkr: 0,
        totalLiabilityLkr: 0,
        totalMonthlyAccrualExpenseLkr: 0,
      };
      deptMap.set(r.department, dept);
    }
    updateDepartmentStat(dept, r);
  }

  const departmentBreakdowns: DepartmentGratuityBreakdown[] = Array.from(deptMap.entries())
    .map(([department, stat]) => ({
      department,
      headcount: stat.headcount,
      vestedHeadcount: stat.vestedHeadcount,
      unvestedHeadcount: stat.unvestedHeadcount,
      totalVestedLiabilityLkr: stat.totalVestedLiabilityLkr,
      totalUnvestedLiabilityLkr: stat.totalUnvestedLiabilityLkr,
      totalLiabilityLkr: stat.totalLiabilityLkr,
      totalMonthlyAccrualExpenseLkr: stat.totalMonthlyAccrualExpenseLkr,
    }))
    .sort((a, b) => a.department.localeCompare(b.department));

  return ok({
    employeeBreakdowns,
    departmentBreakdowns,
    totalVestedLiabilityLkr,
    totalUnvestedLiabilityLkr,
    totalLiabilityLkr,
    totalMonthlyAccrualExpenseLkr,
    vestedHeadcount,
    unvestedHeadcount,
  });
}

/**
 * Calculates hotel-wide statutory gratuity liability and generates an ImmutableAuditLog entry.
 */
export function calculateHotelGratuityProvision(
  input: HotelGratuityProvisionInput,
): Result<HotelGratuityProvisionResult, DomainError> {
  const validationRes = validateHotelProvisionInput(input);
  if (!validationRes.ok) {
    return validationRes;
  }

  const aggRes = aggregateHotelProvisions(
    input.employees,
    input.assessmentDate,
    input.vestingYearsThreshold,
    input.unvestedDiscountFactor,
  );
  if (!aggRes.ok) {
    return aggRes;
  }

  const {
    employeeBreakdowns,
    departmentBreakdowns,
    totalVestedLiabilityLkr,
    totalUnvestedLiabilityLkr,
    totalLiabilityLkr,
    totalMonthlyAccrualExpenseLkr,
    vestedHeadcount,
    unvestedHeadcount,
  } = aggRes.value;

  const isoTs = input.assessmentDate.includes("T")
    ? input.assessmentDate
    : `${input.assessmentDate}T00:00:00.000Z`;

  const auditRes = createAuditEntry({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "GRATUITY_PROVISION_COMPUTED",
    entityType: "GratuityProvisionReport",
    entityId: `${input.tenantId}#GRATUITY#${input.assessmentDate}`,
    isoTs,
    afterJson: JSON.stringify({
      assessmentDate: input.assessmentDate,
      totalHeadcount: input.employees.length,
      vestedHeadcount,
      unvestedHeadcount,
      totalVestedLiabilityLkr,
      totalUnvestedLiabilityLkr,
      totalLiabilityLkr,
      totalMonthlyAccrualExpenseLkr,
      departmentCount: departmentBreakdowns.length,
    }),
    prevHash: input.prevAuditHash,
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId: input.tenantId,
    hotelName: input.hotelName ?? "Grand Serendib Hotel & Villa Collection",
    assessmentDate: input.assessmentDate,
    totalHeadcount: input.employees.length,
    vestedHeadcount,
    unvestedHeadcount,
    totalVestedLiabilityLkr,
    totalUnvestedLiabilityLkr,
    totalLiabilityLkr,
    totalMonthlyAccrualExpenseLkr,
    departmentBreakdowns,
    employeeBreakdowns,
    auditEntry: auditRes.value,
  });
}
