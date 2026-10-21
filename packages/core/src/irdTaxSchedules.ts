/**
 * @hms/core - IRD Monthly VAT (18%) & Quarterly SSCL (2.5%) Output Schedule Compiler
 * (`packages/core/src/irdTaxSchedules.ts`)
 *
 * Implements Step 409 (Phase 17.09) of the Sri Lanka HMS Master Architecture Plan:
 * Deterministic domain engine matching the official Inland Revenue Department (IRD)
 * RAMIS (Revenue Administration Management Information System) statutory tax schedules:
 *
 * 1. Monthly Output VAT Schedule (`compileMonthlyOutputVatSchedule`):
 *    - Governed by Value Added Tax Act No. 14 of 2002 as amended (18% standard rate).
 *    - Segregates invoice-by-invoice supplies into:
 *      * B2B Corporate Output VAT Schedule (Travel Agents, DMCs, Corporate accounts with verified Buyer TIN / VAT No).
 *      * B2C Tourist Output VAT Schedule (Individual walk-in guests, direct OTA bookings).
 *      * Zero-rated / Exempt Supplies (foreign diplomatic missions or statutory exemptions).
 *    - Aggregates Taxable Base, VAT Base, and Output VAT Payable in integer-cent LKR.
 *
 * 2. Quarterly SSCL Schedule (`compileQuarterlySsclSchedule`):
 *    - Governed by Social Security Contribution Levy (SSCL) Act No. 25 of 2022 (2.5% rate).
 *    - Compiles month-by-month liable hotel turnover and calculates SSCL payable per month of the quarter.
 *    - Computes statutory monthly remittance due dates (20th of the following month) and quarterly return deadline.
 *
 * 3. Enforces Multi-Tenant SaaS isolation, RBAC role guard, and SaasSubscription entitlements.
 * 4. Generates SHA-256 hash-chained `ImmutableAuditLog` entries for statutory IRD RAMIS compliance.
 *
 * Zero external runtime npm dependencies (Node 22 standard library only).
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type IrdStaffRole = "FINANCE_CONTROLLER" | "GENERAL_MANAGER" | "SUPER_ADMIN";

export const IRD_AUTHORIZED_ROLES: readonly IrdStaffRole[] = [
  "FINANCE_CONTROLLER",
  "GENERAL_MANAGER",
  "SUPER_ADMIN",
];

export interface IrdStaffActor {
  readonly userId: string;
  readonly role: IrdStaffRole;
  readonly tenantId: string;
}

export interface IrdSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowsIrdReporting?: boolean | undefined;
}

export interface IrdInvoiceRecord {
  readonly invoiceNo: string; // Sequentially numbered RAMIS tax invoice (e.g. TAXINV-2026-10-001)
  readonly invoiceDate: string; // YYYY-MM-DD
  readonly folioId: string;
  readonly isB2b: boolean;
  readonly buyerName: string;
  readonly buyerTin?: string | undefined;
  readonly buyerVatNo?: string | undefined;
  readonly isVatExempt?: boolean | undefined;
  readonly baseSupplyLkr: number;
  readonly serviceChargeLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatBaseLkr: number;
  readonly vatLkr: number;
  readonly grandTotalLkr: number;
}

export interface IrdMonthlyVatScheduleResult {
  readonly tenantId: string;
  readonly yearMonth: string; // Format: YYYY-MM
  readonly hotelName: string;
  readonly hotelTin: string;
  readonly hotelVatNo: string;
  readonly vatRatePercent: number; // 18.0%

  // Totals
  readonly totalTaxableSupplyLkr: number;
  readonly totalVatBaseLkr: number;
  readonly totalOutputVatLkr: number;
  readonly totalGrandLkr: number;

  // B2B Segment
  readonly b2bInvoicesCount: number;
  readonly b2bTaxableSupplyLkr: number;
  readonly b2bOutputVatLkr: number;
  readonly b2bSchedule: readonly IrdInvoiceRecord[];

  // B2C Segment
  readonly b2cInvoicesCount: number;
  readonly b2cTaxableSupplyLkr: number;
  readonly b2cOutputVatLkr: number;
  readonly b2cSchedule: readonly IrdInvoiceRecord[];

  // Exempt Segment
  readonly exemptInvoicesCount: number;
  readonly exemptSupplyLkr: number;

  // Statutory Filing Due Date (20th of the following month per IRD RAMIS guidelines)
  readonly statutoryFilingDueDate: string;

  // Audit Entry
  readonly auditLog: AuditLogEntry;
}

export interface IrdMonthlyVatScheduleInput {
  readonly tenantId: string;
  readonly yearMonth: string; // Format: YYYY-MM
  readonly hotelName: string;
  readonly hotelTin: string;
  readonly hotelVatNo: string;
  readonly invoices: readonly IrdInvoiceRecord[];
  readonly actor: IrdStaffActor;
  readonly subscription?: IrdSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface IrdMonthlySsclBreakdown {
  readonly monthIndex: 1 | 2 | 3;
  readonly yearMonth: string;
  readonly liableTurnoverLkr: number;
  readonly ssclRatePercent: number; // 2.5%
  readonly ssclPayableLkr: number;
  readonly remittanceDueDate: string; // 20th of the following month
}

export interface IrdQuarterlySsclScheduleResult {
  readonly tenantId: string;
  readonly taxYear: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly quarterLabel: string;
  readonly hotelName: string;
  readonly hotelTin: string;
  readonly hotelSsclNo: string;
  readonly ssclRatePercent: number; // 2.5%
  readonly months: readonly IrdMonthlySsclBreakdown[];
  readonly quarterlyTurnoverLkr: number;
  readonly quarterlySsclPayableLkr: number;
  readonly statutoryReturnDueDate: string; // End of the month following quarter close
  readonly auditLog: AuditLogEntry;
}

export interface IrdQuarterlySsclScheduleInput {
  readonly tenantId: string;
  readonly taxYear: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly hotelName: string;
  readonly hotelTin: string;
  readonly hotelSsclNo: string;
  readonly monthlyTurnovers: readonly {
    readonly monthIndex: 1 | 2 | 3;
    readonly yearMonth: string;
    readonly liableTurnoverLkr: number;
  }[];
  readonly actor: IrdStaffActor;
  readonly subscription?: IrdSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly timestamp?: string | undefined;
}

// ============================================================================
// Security & Validation Helpers (Cognitive Complexity <= 12)
// ============================================================================

function validateIrdActor(
  actor: IrdStaffActor,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!actor || !actor.userId || actor.userId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Actor userId must not be empty");
  }

  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant (${actor.tenantId}) does not match request tenant (${expectedTenantId})`,
    );
  }

  if (!IRD_AUTHORIZED_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role ${actor.role} is not authorized for IRD statutory tax schedule generation`,
    );
  }

  return ok(undefined);
}

function validateIrdSubscription(
  subscription: IrdSaasSubscription | undefined,
  tenantId: string,
): Result<void, DomainError> {
  if (!subscription) {
    return ok(undefined);
  }

  if (subscription.tenantId !== tenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenant (${subscription.tenantId}) does not match request tenant (${tenantId})`,
    );
  }

  if (!subscription.active) {
    return domainErr(
      "SUBSCRIPTION_INACTIVE",
      "SaaS subscription is inactive or suspended; IRD tax schedule generation blocked",
    );
  }

  if (subscription.allowsIrdReporting === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "Current subscription plan tier does not permit automated IRD RAMIS tax return compilation",
    );
  }

  return ok(undefined);
}

function validateYearMonthFormat(yearMonth: string): Result<void, DomainError> {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(yearMonth);
  if (!match) {
    return domainErr(
      "INVALID_DATE_FORMAT",
      `Period '${yearMonth}' is not in valid YYYY-MM format (expected YYYY-MM)`,
    );
  }
  return ok(undefined);
}

// ============================================================================
// Date Calculation Helpers (Cognitive Complexity <= 12)
// ============================================================================

export function computeIrdVatDueDate(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  let year = Number(yearStr);
  let nextMonth = Number(monthStr) + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    year += 1;
  }
  const nextMonthStr = String(nextMonth).padStart(2, "0");
  return `${year}-${nextMonthStr}-20`;
}

export function computeSsclReturnDueDate(taxYear: number, quarter: 1 | 2 | 3 | 4): string {
  switch (quarter) {
    case 1:
      return `${taxYear}-04-30`;
    case 2:
      return `${taxYear}-07-31`;
    case 3:
      return `${taxYear}-10-31`;
    case 4:
      return `${taxYear + 1}-01-31`;
  }
}

// ============================================================================
// Monthly VAT Schedule Accumulator Helper
// ============================================================================

interface VatAccumulator {
  totalTaxableSupplyLkr: number;
  totalVatBaseLkr: number;
  totalOutputVatLkr: number;
  totalGrandLkr: number;
  b2bTaxableSupplyLkr: number;
  b2bOutputVatLkr: number;
  b2cTaxableSupplyLkr: number;
  b2cOutputVatLkr: number;
  exemptSupplyLkr: number;
  b2bList: IrdInvoiceRecord[];
  b2cList: IrdInvoiceRecord[];
  exemptCount: number;
}

function createEmptyVatAccumulator(): VatAccumulator {
  return {
    totalTaxableSupplyLkr: 0,
    totalVatBaseLkr: 0,
    totalOutputVatLkr: 0,
    totalGrandLkr: 0,
    b2bTaxableSupplyLkr: 0,
    b2bOutputVatLkr: 0,
    b2cTaxableSupplyLkr: 0,
    b2cOutputVatLkr: 0,
    exemptSupplyLkr: 0,
    b2bList: [],
    b2cList: [],
    exemptCount: 0,
  };
}

function processInvoiceRecord(inv: IrdInvoiceRecord, acc: VatAccumulator): void {
  acc.totalTaxableSupplyLkr = roundLkr(acc.totalTaxableSupplyLkr + inv.baseSupplyLkr);
  acc.totalVatBaseLkr = roundLkr(acc.totalVatBaseLkr + inv.vatBaseLkr);
  acc.totalOutputVatLkr = roundLkr(acc.totalOutputVatLkr + inv.vatLkr);
  acc.totalGrandLkr = roundLkr(acc.totalGrandLkr + inv.grandTotalLkr);

  if (inv.isVatExempt) {
    acc.exemptCount += 1;
    acc.exemptSupplyLkr = roundLkr(acc.exemptSupplyLkr + inv.baseSupplyLkr);
  } else if (inv.isB2b) {
    acc.b2bList.push(inv);
    acc.b2bTaxableSupplyLkr = roundLkr(acc.b2bTaxableSupplyLkr + inv.baseSupplyLkr);
    acc.b2bOutputVatLkr = roundLkr(acc.b2bOutputVatLkr + inv.vatLkr);
  } else {
    acc.b2cList.push(inv);
    acc.b2cTaxableSupplyLkr = roundLkr(acc.b2cTaxableSupplyLkr + inv.baseSupplyLkr);
    acc.b2cOutputVatLkr = roundLkr(acc.b2cOutputVatLkr + inv.vatLkr);
  }
}

// ============================================================================
// Core Compiler: compileMonthlyOutputVatSchedule
// ============================================================================

export function compileMonthlyOutputVatSchedule(
  input: IrdMonthlyVatScheduleInput,
): Result<IrdMonthlyVatScheduleResult, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) return tenantRes;

  const ymRes = validateYearMonthFormat(input.yearMonth);
  if (!ymRes.ok) return ymRes;

  const actorRes = validateIrdActor(input.actor, input.tenantId);
  if (!actorRes.ok) return actorRes;

  const subRes = validateIrdSubscription(input.subscription, input.tenantId);
  if (!subRes.ok) return subRes;

  const acc = createEmptyVatAccumulator();
  for (const inv of input.invoices) {
    processInvoiceRecord(inv, acc);
  }

  const statutoryFilingDueDate = computeIrdVatDueDate(input.yearMonth);
  const isoTs = input.timestamp ?? new Date().toISOString();

  const auditRes = createAuditEntry({
    tenantId: input.tenantId,
    actorUserId: input.actor.userId,
    action: "COMPILE_IRD_MONTHLY_VAT_SCHEDULE",
    entityType: "IrdTaxSchedule",
    entityId: `VAT#${input.yearMonth}#${input.tenantId}`,
    afterJson: JSON.stringify({
      yearMonth: input.yearMonth,
      hotelTin: input.hotelTin,
      hotelVatNo: input.hotelVatNo,
      totalOutputVatLkr: acc.totalOutputVatLkr,
      invoicesCount: input.invoices.length,
      statutoryFilingDueDate,
    }),
    prevHash: input.prevAuditHash,
    isoTs,
  });

  if (!auditRes.ok) return auditRes;

  return ok({
    tenantId: input.tenantId,
    yearMonth: input.yearMonth,
    hotelName: input.hotelName,
    hotelTin: input.hotelTin,
    hotelVatNo: input.hotelVatNo,
    vatRatePercent: 18.0,
    totalTaxableSupplyLkr: acc.totalTaxableSupplyLkr,
    totalVatBaseLkr: acc.totalVatBaseLkr,
    totalOutputVatLkr: acc.totalOutputVatLkr,
    totalGrandLkr: acc.totalGrandLkr,
    b2bInvoicesCount: acc.b2bList.length,
    b2bTaxableSupplyLkr: acc.b2bTaxableSupplyLkr,
    b2bOutputVatLkr: acc.b2bOutputVatLkr,
    b2bSchedule: acc.b2bList,
    b2cInvoicesCount: acc.b2cList.length,
    b2cTaxableSupplyLkr: acc.b2cTaxableSupplyLkr,
    b2cOutputVatLkr: acc.b2cOutputVatLkr,
    b2cSchedule: acc.b2cList,
    exemptInvoicesCount: acc.exemptCount,
    exemptSupplyLkr: acc.exemptSupplyLkr,
    statutoryFilingDueDate,
    auditLog: auditRes.value,
  });
}

// ============================================================================
// Core Compiler: compileQuarterlySsclSchedule
// ============================================================================

export function compileQuarterlySsclSchedule(
  input: IrdQuarterlySsclScheduleInput,
): Result<IrdQuarterlySsclScheduleResult, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) return tenantRes;

  if (input.quarter < 1 || input.quarter > 4) {
    return domainErr(
      "VALIDATION_FAILED",
      `Invalid quarter ${input.quarter}; expected 1, 2, 3, or 4`,
    );
  }

  const actorRes = validateIrdActor(input.actor, input.tenantId);
  if (!actorRes.ok) return actorRes;

  const subRes = validateIrdSubscription(input.subscription, input.tenantId);
  if (!subRes.ok) return subRes;

  const ssclRatePercent = 2.5;
  let quarterlyTurnoverLkr = 0;
  let quarterlySsclPayableLkr = 0;

  const months: IrdMonthlySsclBreakdown[] = [];

  for (const item of input.monthlyTurnovers) {
    const monthSsclPayable = roundLkr(item.liableTurnoverLkr * (ssclRatePercent / 100));
    quarterlyTurnoverLkr = roundLkr(quarterlyTurnoverLkr + item.liableTurnoverLkr);
    quarterlySsclPayableLkr = roundLkr(quarterlySsclPayableLkr + monthSsclPayable);

    months.push({
      monthIndex: item.monthIndex,
      yearMonth: item.yearMonth,
      liableTurnoverLkr: item.liableTurnoverLkr,
      ssclRatePercent,
      ssclPayableLkr: monthSsclPayable,
      remittanceDueDate: computeIrdVatDueDate(item.yearMonth),
    });
  }

  const statutoryReturnDueDate = computeSsclReturnDueDate(input.taxYear, input.quarter);
  const quarterLabel = `Q${input.quarter} (${input.taxYear})`;
  const isoTs = input.timestamp ?? new Date().toISOString();

  const auditRes = createAuditEntry({
    tenantId: input.tenantId,
    actorUserId: input.actor.userId,
    action: "COMPILE_IRD_QUARTERLY_SSCL_SCHEDULE",
    entityType: "IrdTaxSchedule",
    entityId: `SSCL#${input.taxYear}#Q${input.quarter}#${input.tenantId}`,
    afterJson: JSON.stringify({
      taxYear: input.taxYear,
      quarter: input.quarter,
      hotelTin: input.hotelTin,
      hotelSsclNo: input.hotelSsclNo,
      quarterlyTurnoverLkr,
      quarterlySsclPayableLkr,
      statutoryReturnDueDate,
    }),
    prevHash: input.prevAuditHash,
    isoTs,
  });

  if (!auditRes.ok) return auditRes;

  return ok({
    tenantId: input.tenantId,
    taxYear: input.taxYear,
    quarter: input.quarter,
    quarterLabel,
    hotelName: input.hotelName,
    hotelTin: input.hotelTin,
    hotelSsclNo: input.hotelSsclNo,
    ssclRatePercent,
    months,
    quarterlyTurnoverLkr,
    quarterlySsclPayableLkr,
    statutoryReturnDueDate,
    auditLog: auditRes.value,
  });
}
