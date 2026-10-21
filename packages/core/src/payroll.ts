import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

/**
 * Individual staff member input for monthly service charge pool distribution.
 */
export interface EmployeeServiceChargeInput {
  readonly employeeId: string;
  readonly employeeName?: string | undefined;
  readonly staffPointWeight: number; // e.g. 1.0 (junior), 1.5 (supervisor), 2.0 (head chef)
  readonly daysWorked: number; // attended workdays in the month (e.g. 26)
  readonly department?: string | undefined;
}

/**
 * Input configuration and staff roster for hotel service charge calculation.
 */
export interface ServiceChargePoolInput {
  readonly tenantId: string;
  readonly billingPeriod: string; // e.g. '2026-09'
  readonly totalScLkr: number; // Gross 10% SC collected from guest folios in the month
  readonly breakageRecoveryPercent?: number | undefined; // 0% to 10% (statutory / union capped)
  readonly employees: readonly EmployeeServiceChargeInput[];
}

/**
 * Detailed service charge allocation for an individual staff member.
 */
export interface EmployeeServiceChargeAllocation {
  readonly employeeId: string;
  readonly employeeName?: string | undefined;
  readonly department?: string | undefined;
  readonly staffPointWeight: number;
  readonly daysWorked: number;
  readonly weightedPoints: number; // staffPointWeight * daysWorked
  readonly shareLkr: number; // Final rounded share allocated in Sri Lankan Rupees
  readonly sharePercent: number; // Percentage of the net pool allocated
}

/**
 * Comprehensive monthly hotel service charge pool distribution breakdown.
 */
export interface ServiceChargePoolResult {
  readonly tenantId: string;
  readonly billingPeriod: string;
  readonly grossScLkr: number;
  readonly breakageRecoveryPercent: number;
  readonly breakageDeductionLkr: number;
  readonly netScPoolLkr: number;
  readonly totalWeightedPoints: number;
  readonly pointValueLkr: number;
  readonly allocations: readonly EmployeeServiceChargeAllocation[];
  readonly totalAllocatedLkr: number;
  readonly roundingDifferenceCents: number;
}

function validateEmployeeInput(emp: EmployeeServiceChargeInput): Result<void, DomainError> {
  if (!emp.employeeId || emp.employeeId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Employee ID cannot be empty");
  }

  if (
    typeof emp.staffPointWeight !== "number" ||
    !Number.isFinite(emp.staffPointWeight) ||
    emp.staffPointWeight <= 0
  ) {
    return domainErr("VALIDATION_FAILED", "Staff point weight must be a positive number", {
      employeeId: emp.employeeId,
      staffPointWeight: emp.staffPointWeight,
    });
  }

  if (
    typeof emp.daysWorked !== "number" ||
    !Number.isFinite(emp.daysWorked) ||
    emp.daysWorked < 0
  ) {
    return domainErr("VALIDATION_FAILED", "Days worked must be a non-negative number", {
      employeeId: emp.employeeId,
      daysWorked: emp.daysWorked,
    });
  }

  return ok(undefined);
}

function validateTotalSc(amount: number): Result<void, DomainError> {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return domainErr("VALIDATION_FAILED", "Total collected service charge must be non-negative", {
      totalScLkr: amount,
    });
  }
  return ok(undefined);
}

function validateBreakageRecovery(percent: number | undefined): Result<void, DomainError> {
  if (percent === undefined) {
    return ok(undefined);
  }
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 10) {
    return domainErr(
      "VALIDATION_FAILED",
      "Breakage recovery deduction must be between 0% and 10% (Sri Lankan hospitality standard)",
      { breakageRecoveryPercent: percent },
    );
  }
  return ok(undefined);
}

function validatePoolInput(input: ServiceChargePoolInput): Result<string, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }

  if (!input.billingPeriod || input.billingPeriod.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Billing period is required (e.g. '2026-09')");
  }

  const scRes = validateTotalSc(input.totalScLkr);
  if (!scRes.ok) {
    return scRes;
  }

  const breakageRes = validateBreakageRecovery(input.breakageRecoveryPercent);
  if (!breakageRes.ok) {
    return breakageRes;
  }

  if (!Array.isArray(input.employees) || input.employees.length === 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least one employee must be provided for service charge distribution",
    );
  }

  for (const emp of input.employees) {
    const empRes = validateEmployeeInput(emp);
    if (!empRes.ok) {
      return empRes;
    }
  }

  return ok(tenantRes.value);
}

/**
 * Calculates monthly Sri Lankan hotel 10% Service Charge pool distribution:
 *
 * 1. Computes gross SC collected from guest room and F&B folios.
 * 2. Deducts breakage recovery percentage (0% to 10% max).
 * 3. Allocates net pool to employees proportionally by weighted points:
 *    `weightedPoints = staffPointWeight * daysWorked`
 *    `pointValue = netScPool / totalWeightedPoints`
 *    `shareLkr = roundLkr(weightedPoints * pointValue)`
 */
export function calculateServiceChargePool(
  input: ServiceChargePoolInput,
): Result<ServiceChargePoolResult, DomainError> {
  const valRes = validatePoolInput(input);
  if (!valRes.ok) {
    return valRes;
  }
  const tenantId = valRes.value;

  const grossScLkr = roundLkr(input.totalScLkr);
  const breakagePercent = input.breakageRecoveryPercent ?? 0;
  const breakageDeductionLkr = roundLkr(grossScLkr * (breakagePercent / 100));
  const netScPoolLkr = roundLkr(grossScLkr - breakageDeductionLkr);

  // Compute total weighted points
  let totalWeightedPoints = 0;
  for (const emp of input.employees) {
    totalWeightedPoints += emp.staffPointWeight * emp.daysWorked;
  }

  const pointValueLkr = totalWeightedPoints > 0 ? netScPoolLkr / totalWeightedPoints : 0;

  // Allocate to each employee
  let totalAllocatedLkr = 0;
  const allocations: EmployeeServiceChargeAllocation[] = [];

  for (const emp of input.employees) {
    const weightedPoints = emp.staffPointWeight * emp.daysWorked;
    const shareLkr = totalWeightedPoints > 0 ? roundLkr(weightedPoints * pointValueLkr) : 0;
    const sharePercent = netScPoolLkr > 0 ? roundLkr((shareLkr / netScPoolLkr) * 100) : 0;

    totalAllocatedLkr = roundLkr(totalAllocatedLkr + shareLkr);

    allocations.push({
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      department: emp.department,
      staffPointWeight: emp.staffPointWeight,
      daysWorked: emp.daysWorked,
      weightedPoints: roundLkr(weightedPoints),
      shareLkr,
      sharePercent,
    });
  }

  const roundingDifferenceCents = roundLkr(netScPoolLkr - totalAllocatedLkr);

  return ok({
    tenantId,
    billingPeriod: input.billingPeriod.trim(),
    grossScLkr,
    breakageRecoveryPercent: breakagePercent,
    breakageDeductionLkr,
    netScPoolLkr,
    totalWeightedPoints: roundLkr(totalWeightedPoints),
    pointValueLkr: roundLkr(pointValueLkr),
    allocations,
    totalAllocatedLkr,
    roundingDifferenceCents,
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for Service Charge pool distributions.
 */
export function createServiceChargePoolAuditEntry(
  tenantId: string,
  actorUserId: string,
  billingPeriod: string,
  pool: ServiceChargePoolResult,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    billingPeriod,
    grossScLkr: pool.grossScLkr,
    netScPoolLkr: pool.netScPoolLkr,
    breakageDeductionLkr: pool.breakageDeductionLkr,
    totalAllocatedLkr: pool.totalAllocatedLkr,
    headcount: pool.allocations.length,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "CALCULATE_SERVICE_CHARGE_POOL",
    entityType: "ServiceChargePool",
    entityId: billingPeriod,
    isoTs,
    afterJson,
    prevHash,
  });
}

export const SRI_LANKA_EPF_EMPLOYEE_RATE = 0.08;
export const SRI_LANKA_EPF_EMPLOYER_RATE = 0.12;
export const SRI_LANKA_ETF_EMPLOYER_RATE = 0.03;

export interface SriLankaEpfEtfInput {
  readonly basicSalaryLkr: number;
  readonly budgetaryReliefAllowanceLkr?: number | undefined;
  readonly netServiceChargeShareLkr?: number | undefined;
  readonly tenantId?: string | undefined;
  readonly employeeId?: string | undefined;
}

export interface SriLankaEpfEtfResult {
  readonly basicSalaryLkr: number;
  readonly budgetaryReliefAllowanceLkr: number;
  readonly netServiceChargeShareLkr: number;
  readonly epfEligibleEarningsLkr: number;
  readonly employeeEpfLkr: number;
  readonly employerEpfLkr: number;
  readonly totalEpfRemittanceLkr: number;
  readonly employerEtfLkr: number;
  readonly totalStatutoryContributionLkr: number;
  readonly grossEarningsLkr: number;
  readonly netTakeHomePayLkr: number;
  readonly tenantId?: string | undefined;
  readonly employeeId?: string | undefined;
}

function validateEpfInput(input: SriLankaEpfEtfInput): Result<void, DomainError> {
  if (
    typeof input.basicSalaryLkr !== "number" ||
    !Number.isFinite(input.basicSalaryLkr) ||
    input.basicSalaryLkr < 0
  ) {
    return domainErr("VALIDATION_FAILED", "Basic salary must be a non-negative number", {
      basicSalaryLkr: input.basicSalaryLkr,
    });
  }

  if (input.budgetaryReliefAllowanceLkr !== undefined) {
    if (
      typeof input.budgetaryReliefAllowanceLkr !== "number" ||
      !Number.isFinite(input.budgetaryReliefAllowanceLkr) ||
      input.budgetaryReliefAllowanceLkr < 0
    ) {
      return domainErr(
        "VALIDATION_FAILED",
        "Budgetary relief allowance must be a non-negative number",
        { budgetaryReliefAllowanceLkr: input.budgetaryReliefAllowanceLkr },
      );
    }
  }

  if (input.netServiceChargeShareLkr !== undefined) {
    if (
      typeof input.netServiceChargeShareLkr !== "number" ||
      !Number.isFinite(input.netServiceChargeShareLkr) ||
      input.netServiceChargeShareLkr < 0
    ) {
      return domainErr(
        "VALIDATION_FAILED",
        "Net service charge share must be a non-negative number",
        { netServiceChargeShareLkr: input.netServiceChargeShareLkr },
      );
    }
  }

  return ok(undefined);
}

/**
 * Computes statutory Sri Lankan EPF (8% Employee / 12% Employer) and ETF (3% Employer) deductions.
 *
 * Governed by:
 * - Employees' Provident Fund Act No. 15 of 1958
 * - Employees' Trust Fund Act No. 46 of 1980
 * - Budgetary Relief Allowance of Workers Acts (2005 & 2016)
 *
 * Note: Under standard Sri Lankan hospitality labor law, Service Charge is a variable pool distribution
 * and is not included in base earnings for EPF/ETF calculation, but contributes to gross take-home pay.
 */
export function calculateSriLankaEpfEtf(
  input: SriLankaEpfEtfInput,
): Result<SriLankaEpfEtfResult, DomainError> {
  const valRes = validateEpfInput(input);
  if (!valRes.ok) {
    return valRes;
  }

  let validatedTenantId: string | undefined;
  if (input.tenantId !== undefined) {
    const tenantRes = validateTenantId(input.tenantId);
    if (!tenantRes.ok) {
      return tenantRes;
    }
    validatedTenantId = tenantRes.value;
  }

  const basicSalaryLkr = roundLkr(input.basicSalaryLkr);
  const braLkr = roundLkr(input.budgetaryReliefAllowanceLkr ?? 0);
  const scShareLkr = roundLkr(input.netServiceChargeShareLkr ?? 0);

  const epfEligibleEarningsLkr = roundLkr(basicSalaryLkr + braLkr);
  const employeeEpfLkr = roundLkr(epfEligibleEarningsLkr * SRI_LANKA_EPF_EMPLOYEE_RATE);
  const employerEpfLkr = roundLkr(epfEligibleEarningsLkr * SRI_LANKA_EPF_EMPLOYER_RATE);
  const totalEpfRemittanceLkr = roundLkr(employeeEpfLkr + employerEpfLkr);
  const employerEtfLkr = roundLkr(epfEligibleEarningsLkr * SRI_LANKA_ETF_EMPLOYER_RATE);
  const totalStatutoryContributionLkr = roundLkr(totalEpfRemittanceLkr + employerEtfLkr);

  const grossEarningsLkr = roundLkr(epfEligibleEarningsLkr + scShareLkr);
  const netTakeHomePayLkr = roundLkr(grossEarningsLkr - employeeEpfLkr);

  return ok({
    basicSalaryLkr,
    budgetaryReliefAllowanceLkr: braLkr,
    netServiceChargeShareLkr: scShareLkr,
    epfEligibleEarningsLkr,
    employeeEpfLkr,
    employerEpfLkr,
    totalEpfRemittanceLkr,
    employerEtfLkr,
    totalStatutoryContributionLkr,
    grossEarningsLkr,
    netTakeHomePayLkr,
    tenantId: validatedTenantId,
    employeeId: input.employeeId?.trim(),
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for employee EPF/ETF statutory calculations.
 */
export function createEpfEtfAuditEntry(
  tenantId: string,
  actorUserId: string,
  employeeId: string,
  billingPeriod: string,
  epfEtf: SriLankaEpfEtfResult,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    employeeId,
    billingPeriod,
    epfEligibleEarningsLkr: epfEtf.epfEligibleEarningsLkr,
    employeeEpfLkr: epfEtf.employeeEpfLkr,
    employerEpfLkr: epfEtf.employerEpfLkr,
    employerEtfLkr: epfEtf.employerEtfLkr,
    netTakeHomePayLkr: epfEtf.netTakeHomePayLkr,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "CALCULATE_SRI_LANKA_EPF_ETF",
    entityType: "PayrollPayslip",
    entityId: `${billingPeriod}:${employeeId}`,
    isoTs,
    afterJson,
    prevHash,
  });
}

/**
 * Statutory Sri Lankan APIT (Advance Personal Income Tax) Progressive Tax Slabs.
 * Under Inland Revenue Act No. 24 of 2017 as amended by Act No. 45 of 2022.
 */
export interface SriLankaApitSlab {
  readonly slabWidthLkr: number;
  readonly ratePercent: number;
}

/**
 * Standard IRD personal tax-free relief threshold: LKR 100,000 per month (LKR 1,200,000/annum).
 */
export const DEFAULT_SRI_LANKA_APIT_RELIEF_THRESHOLD_LKR = 100000;

/**
 * Progressive monthly slabs: each slab spans LKR 500,000 / 12 = LKR 41,666.67 per month.
 * Rates: 6%, 12%, 18%, 24%, 30%, and top marginal rate of 36%.
 */
export const DEFAULT_SRI_LANKA_APIT_SLABS: readonly SriLankaApitSlab[] = [
  { slabWidthLkr: 41666.67, ratePercent: 6 },
  { slabWidthLkr: 41666.67, ratePercent: 12 },
  { slabWidthLkr: 41666.67, ratePercent: 18 },
  { slabWidthLkr: 41666.67, ratePercent: 24 },
  { slabWidthLkr: 41666.67, ratePercent: 30 },
  { slabWidthLkr: Number.POSITIVE_INFINITY, ratePercent: 36 },
];

/**
 * Itemized breakdown per taxable bracket.
 */
export interface SriLankaApitSlabBreakdown {
  readonly slabIndex: number;
  readonly slabWidthLkr: number;
  readonly ratePercent: number;
  readonly taxableAmountInSlabLkr: number;
  readonly taxAmountLkr: number;
}

/**
 * Input configuration for calculating monthly APIT withholding.
 */
export interface SriLankaApitInput {
  readonly monthlyGrossTaxableLkr: number;
  readonly reliefThresholdLkr?: number | undefined;
  readonly slabs?: readonly SriLankaApitSlab[] | undefined;
  readonly tenantId?: string | undefined;
  readonly employeeId?: string | undefined;
}

/**
 * Computed APIT result with slab breakdowns and effective tax rate.
 */
export interface SriLankaApitResult {
  readonly monthlyGrossTaxableLkr: number;
  readonly reliefThresholdLkr: number;
  readonly taxableRemunerationLkr: number;
  readonly slabBreakdowns: readonly SriLankaApitSlabBreakdown[];
  readonly totalApitLkr: number;
  readonly effectiveTaxRatePercent: number;
  readonly tenantId?: string | undefined;
  readonly employeeId?: string | undefined;
}

function validateGrossAndRelief(
  grossLkr: number,
  reliefThresholdLkr: number,
): Result<void, DomainError> {
  if (typeof grossLkr !== "number" || !Number.isFinite(grossLkr) || grossLkr < 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "Monthly gross taxable remuneration must be a non-negative number",
      { monthlyGrossTaxableLkr: grossLkr },
    );
  }

  if (
    typeof reliefThresholdLkr !== "number" ||
    !Number.isFinite(reliefThresholdLkr) ||
    reliefThresholdLkr < 0
  ) {
    return domainErr("VALIDATION_FAILED", "Relief threshold must be a non-negative number", {
      reliefThresholdLkr,
    });
  }

  return ok(undefined);
}

function validateSingleSlab(slab: SriLankaApitSlab, index: number): Result<void, DomainError> {
  const isWidthValid =
    typeof slab?.slabWidthLkr === "number" &&
    (Number.isFinite(slab.slabWidthLkr) || slab.slabWidthLkr === Number.POSITIVE_INFINITY) &&
    slab.slabWidthLkr > 0;

  if (!isWidthValid) {
    return domainErr("VALIDATION_FAILED", `Tax slab ${index + 1} width must be a positive number`, {
      slabIndex: index,
      slabWidthLkr: slab?.slabWidthLkr,
    });
  }

  const isRateValid =
    typeof slab.ratePercent === "number" &&
    Number.isFinite(slab.ratePercent) &&
    slab.ratePercent >= 0 &&
    slab.ratePercent <= 100;

  if (!isRateValid) {
    return domainErr(
      "VALIDATION_FAILED",
      `Tax slab ${index + 1} rate must be between 0% and 100%`,
      { slabIndex: index, ratePercent: slab.ratePercent },
    );
  }

  return ok(undefined);
}

function validateApitSlabs(slabs: readonly SriLankaApitSlab[]): Result<void, DomainError> {
  if (!Array.isArray(slabs) || slabs.length === 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least one tax slab must be provided for APIT calculation",
    );
  }

  for (let i = 0; i < slabs.length; i++) {
    const res = validateSingleSlab(slabs[i] as SriLankaApitSlab, i);
    if (!res.ok) {
      return res;
    }
  }

  return ok(undefined);
}

interface ResolvedApitParams {
  readonly grossLkr: number;
  readonly reliefLkr: number;
  readonly slabs: readonly SriLankaApitSlab[];
  readonly tenantId?: string | undefined;
  readonly employeeId?: string | undefined;
}

function resolveApitParams(
  inputOrGrossLkr: number | SriLankaApitInput,
  customSlabs?: readonly SriLankaApitSlab[],
  reliefThresholdLkr?: number,
  options?: { tenantId?: string; employeeId?: string },
): ResolvedApitParams {
  if (typeof inputOrGrossLkr === "object" && inputOrGrossLkr !== null) {
    return {
      grossLkr: inputOrGrossLkr.monthlyGrossTaxableLkr,
      reliefLkr: inputOrGrossLkr.reliefThresholdLkr ?? DEFAULT_SRI_LANKA_APIT_RELIEF_THRESHOLD_LKR,
      slabs: inputOrGrossLkr.slabs ?? customSlabs ?? DEFAULT_SRI_LANKA_APIT_SLABS,
      tenantId: inputOrGrossLkr.tenantId ?? options?.tenantId,
      employeeId: inputOrGrossLkr.employeeId ?? options?.employeeId,
    };
  }

  return {
    grossLkr: inputOrGrossLkr,
    reliefLkr: reliefThresholdLkr ?? DEFAULT_SRI_LANKA_APIT_RELIEF_THRESHOLD_LKR,
    slabs: customSlabs ?? DEFAULT_SRI_LANKA_APIT_SLABS,
    tenantId: options?.tenantId,
    employeeId: options?.employeeId,
  };
}

function computeSlabTaxes(
  taxableRemunerationLkr: number,
  slabs: readonly SriLankaApitSlab[],
): { totalApitLkr: number; slabBreakdowns: readonly SriLankaApitSlabBreakdown[] } {
  let remainingTaxableLkr = taxableRemunerationLkr;
  let totalApitLkr = 0;
  const slabBreakdowns: SriLankaApitSlabBreakdown[] = [];

  for (let i = 0; i < slabs.length; i++) {
    if (remainingTaxableLkr <= 0) {
      break;
    }

    const slab = slabs[i];
    const slabWidth = slab?.slabWidthLkr ?? Number.POSITIVE_INFINITY;
    const ratePercent = slab?.ratePercent ?? 0;
    const taxableAmountInSlabLkr = roundLkr(Math.min(remainingTaxableLkr, slabWidth));
    const taxAmountLkr = roundLkr(taxableAmountInSlabLkr * (ratePercent / 100));

    totalApitLkr = roundLkr(totalApitLkr + taxAmountLkr);
    remainingTaxableLkr = roundLkr(remainingTaxableLkr - taxableAmountInSlabLkr);

    slabBreakdowns.push({
      slabIndex: i + 1,
      slabWidthLkr: slabWidth,
      ratePercent,
      taxableAmountInSlabLkr,
      taxAmountLkr,
    });
  }

  return { totalApitLkr, slabBreakdowns };
}

/**
 * Calculates monthly Sri Lankan APIT (Advance Personal Income Tax) withholding:
 *
 * 1. Deducts statutory monthly tax relief (default: LKR 100,000).
 * 2. If gross <= relief threshold, taxable remuneration is 0 and APIT is 0.
 * 3. Applies progressive tax slabs to remuneration exceeding relief threshold.
 * 4. Sums tax across all applicable slabs, rounding each to integer cents.
 *
 * Accepts either:
 * - `calculateSriLankaApit(input: SriLankaApitInput)`
 * - `calculateSriLankaApit(monthlyGrossTaxableLkr: number, slabs?: readonly SriLankaApitSlab[], reliefThresholdLkr?: number, options?: { tenantId?: string; employeeId?: string })`
 */
export function calculateSriLankaApit(
  inputOrGrossLkr: number | SriLankaApitInput,
  customSlabs?: readonly SriLankaApitSlab[],
  reliefThresholdLkr?: number,
  options?: { tenantId?: string; employeeId?: string },
): Result<SriLankaApitResult, DomainError> {
  const params = resolveApitParams(inputOrGrossLkr, customSlabs, reliefThresholdLkr, options);

  const numRes = validateGrossAndRelief(params.grossLkr, params.reliefLkr);
  if (!numRes.ok) {
    return numRes;
  }

  const slabRes = validateApitSlabs(params.slabs);
  if (!slabRes.ok) {
    return slabRes;
  }

  let validatedTenantId: string | undefined;
  if (params.tenantId !== undefined) {
    const tenantRes = validateTenantId(params.tenantId);
    if (!tenantRes.ok) {
      return tenantRes;
    }
    validatedTenantId = tenantRes.value;
  }

  const roundedGrossLkr = roundLkr(params.grossLkr);
  const roundedReliefLkr = roundLkr(params.reliefLkr);

  if (roundedGrossLkr <= roundedReliefLkr) {
    return ok({
      monthlyGrossTaxableLkr: roundedGrossLkr,
      reliefThresholdLkr: roundedReliefLkr,
      taxableRemunerationLkr: 0,
      slabBreakdowns: [],
      totalApitLkr: 0,
      effectiveTaxRatePercent: 0,
      tenantId: validatedTenantId,
      employeeId: params.employeeId?.trim(),
    });
  }

  const taxableRemunerationLkr = roundLkr(roundedGrossLkr - roundedReliefLkr);
  const { totalApitLkr, slabBreakdowns } = computeSlabTaxes(taxableRemunerationLkr, params.slabs);
  const effectiveTaxRatePercent =
    roundedGrossLkr > 0 ? roundLkr((totalApitLkr / roundedGrossLkr) * 100) : 0;

  return ok({
    monthlyGrossTaxableLkr: roundedGrossLkr,
    reliefThresholdLkr: roundedReliefLkr,
    taxableRemunerationLkr,
    slabBreakdowns,
    totalApitLkr,
    effectiveTaxRatePercent,
    tenantId: validatedTenantId,
    employeeId: params.employeeId?.trim(),
  });
}

/**
 * Creates an immutable SHA-256 hash-chained audit log entry for employee APIT withholding calculations.
 */
export function createApitAuditEntry(
  tenantId: string,
  actorUserId: string,
  employeeId: string,
  billingPeriod: string,
  apit: SriLankaApitResult,
  isoTs: string,
  prevHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    employeeId,
    billingPeriod,
    monthlyGrossTaxableLkr: apit.monthlyGrossTaxableLkr,
    reliefThresholdLkr: apit.reliefThresholdLkr,
    taxableRemunerationLkr: apit.taxableRemunerationLkr,
    totalApitLkr: apit.totalApitLkr,
    effectiveTaxRatePercent: apit.effectiveTaxRatePercent,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "CALCULATE_SRI_LANKA_APIT",
    entityType: "PayrollPayslip",
    entityId: `${billingPeriod}:${employeeId}:APIT`,
    isoTs,
    afterJson,
    prevHash,
  });
}
