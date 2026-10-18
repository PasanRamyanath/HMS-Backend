/**
 * @hms/core - Multi-Line Guest Folio Tax Aggregator.
 *
 * Implements departmental aggregation across Sri Lankan hotel operations:
 * - ROOM, FNB, SPA, LAUNDRY, MINIBAR, EXCURSION, CORKAGE
 * - Supports Service Charge exempt lines (e.g., third-party safari jeeps, national park permits)
 * - 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT)
 * - Full audit-readiness with immutable SHA-256 audit chaining integration
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { DEFAULT_SRI_LANKA_TAX_CONFIG, type SriLankaTaxConfig, roundLkr } from "./tax.js";

/**
 * Standard Sri Lankan hotel operational departments contributing revenue to guest folios.
 */
export const FOLIO_DEPARTMENTS = [
  "ROOM",
  "FNB",
  "SPA",
  "LAUNDRY",
  "MINIBAR",
  "EXCURSION",
  "CORKAGE",
] as const;

export type FolioDepartment = (typeof FOLIO_DEPARTMENTS)[number];

/**
 * Single posted item on a guest or master folio.
 */
export interface FolioLineItem {
  readonly lineId: string;
  readonly department: FolioDepartment;
  readonly description: string;
  readonly quantity: number;
  readonly unitBaseLkr: number;
  /** When true, 10% Service Charge is omitted (e.g., 3rd-party safari jeep or government park fee). */
  readonly scExempt?: boolean | undefined;
  /** When true, item has been voided/cancelled and is excluded from billable totals. */
  readonly isVoided?: boolean | undefined;
}

/**
 * Detailed 4-stage tax computation for a single folio line item.
 */
export interface FolioLineTaxBreakdown {
  readonly lineId: string;
  readonly department: FolioDepartment;
  readonly description: string;
  readonly quantity: number;
  readonly unitBaseLkr: number;
  readonly scExempt: boolean;
  readonly isVoided: boolean;
  readonly lineBaseLkr: number;
  readonly scLkr: number;
  readonly subtotalAfterScLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatBaseLkr: number;
  readonly vatLkr: number;
  readonly grandTotalLkr: number;
}

/**
 * Summary totals aggregated per department.
 */
export interface DepartmentTaxSummary {
  readonly department: FolioDepartment;
  readonly lineCount: number;
  readonly baseLkr: number;
  readonly scLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatLkr: number;
  readonly grandTotalLkr: number;
}

/**
 * Complete multi-line aggregated folio tax assessment.
 */
export interface AggregatedFolioTaxes {
  readonly tenantId?: string | undefined;
  readonly folioId?: string | undefined;
  readonly totalLines: number;
  readonly activeLines: number;
  readonly voidedLines: number;
  readonly totalBaseLkr: number;
  readonly scEligibleBaseLkr: number;
  readonly scExemptBaseLkr: number;
  readonly totalScLkr: number;
  readonly totalSubtotalAfterScLkr: number;
  readonly totalTdlLkr: number;
  readonly totalSsclLkr: number;
  readonly totalVatBaseLkr: number;
  readonly totalVatLkr: number;
  readonly grandTotalLkr: number;
  readonly lineBreakdowns: readonly FolioLineTaxBreakdown[];
  readonly departmentSummaries: Readonly<Record<FolioDepartment, DepartmentTaxSummary>>;
}

export interface AggregateFolioOptions {
  readonly tenantId?: string | undefined;
  readonly folioId?: string | undefined;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
}

/**
 * Validates a single folio line item input.
 */
function validateLineItem(line: FolioLineItem, index: number): Result<void, DomainError> {
  if (!line.lineId || typeof line.lineId !== "string" || line.lineId.trim() === "") {
    return domainErr(
      "INVALID_FOLIO_LINE",
      `Folio line at index ${index} is missing a valid lineId`,
    );
  }
  if (!FOLIO_DEPARTMENTS.includes(line.department)) {
    return domainErr(
      "INVALID_FOLIO_LINE",
      `Invalid department '${line.department}' at line ${line.lineId}. Must be one of: ${FOLIO_DEPARTMENTS.join(", ")}`,
      { lineId: line.lineId, department: line.department },
    );
  }
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    return domainErr(
      "INVALID_FOLIO_LINE",
      `Quantity at line ${line.lineId} must be a positive finite number`,
      { lineId: line.lineId, quantity: line.quantity },
    );
  }
  if (!Number.isFinite(line.unitBaseLkr) || line.unitBaseLkr < 0) {
    return domainErr(
      "INVALID_FOLIO_LINE",
      `Unit base price at line ${line.lineId} must be a non-negative finite number`,
      { lineId: line.lineId, unitBaseLkr: line.unitBaseLkr },
    );
  }
  return ok(undefined);
}

/**
 * Computes 4-stage compounding taxes for a single line item.
 */
function computeLineBreakdown(
  line: FolioLineItem,
  config: SriLankaTaxConfig,
): FolioLineTaxBreakdown {
  const isVoided = Boolean(line.isVoided);
  const scExempt = Boolean(line.scExempt);

  if (isVoided) {
    return {
      lineId: line.lineId,
      department: line.department,
      description: line.description,
      quantity: line.quantity,
      unitBaseLkr: line.unitBaseLkr,
      scExempt,
      isVoided: true,
      lineBaseLkr: 0,
      scLkr: 0,
      subtotalAfterScLkr: 0,
      tdlLkr: 0,
      ssclLkr: 0,
      vatBaseLkr: 0,
      vatLkr: 0,
      grandTotalLkr: 0,
    };
  }

  const lineBaseLkr = roundLkr(line.quantity * line.unitBaseLkr);
  const scLkr = !scExempt && config.enableSC ? roundLkr(lineBaseLkr * config.scRate) : 0;
  const subtotalAfterScLkr = roundLkr(lineBaseLkr + scLkr);
  const tdlLkr = config.enableTDL ? roundLkr(subtotalAfterScLkr * config.tdlRate) : 0;
  const ssclLkr = config.enableSSCL ? roundLkr(subtotalAfterScLkr * config.ssclRate) : 0;
  const vatBaseLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr);
  const vatLkr = config.enableVAT ? roundLkr(vatBaseLkr * config.vatRate) : 0;
  const grandTotalLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr + vatLkr);

  return {
    lineId: line.lineId,
    department: line.department,
    description: line.description,
    quantity: line.quantity,
    unitBaseLkr: line.unitBaseLkr,
    scExempt,
    isVoided: false,
    lineBaseLkr,
    scLkr,
    subtotalAfterScLkr,
    tdlLkr,
    ssclLkr,
    vatBaseLkr,
    vatLkr,
    grandTotalLkr,
  };
}

/**
 * Builds an empty record initialized for all standard hotel departments.
 */
function createEmptyDepartmentSummaries(): Record<FolioDepartment, DepartmentTaxSummary> {
  const summaries = {} as Record<FolioDepartment, DepartmentTaxSummary>;
  for (const dept of FOLIO_DEPARTMENTS) {
    summaries[dept] = {
      department: dept,
      lineCount: 0,
      baseLkr: 0,
      scLkr: 0,
      tdlLkr: 0,
      ssclLkr: 0,
      vatLkr: 0,
      grandTotalLkr: 0,
    };
  }
  return summaries;
}

/**
 * Accumulates a single line breakdown into departmental summaries.
 */
function updateDepartmentSummary(
  summaries: Record<FolioDepartment, DepartmentTaxSummary>,
  line: FolioLineTaxBreakdown,
): void {
  if (line.isVoided) {
    return;
  }
  const current = summaries[line.department];
  summaries[line.department] = {
    department: line.department,
    lineCount: current.lineCount + 1,
    baseLkr: roundLkr(current.baseLkr + line.lineBaseLkr),
    scLkr: roundLkr(current.scLkr + line.scLkr),
    tdlLkr: roundLkr(current.tdlLkr + line.tdlLkr),
    ssclLkr: roundLkr(current.ssclLkr + line.ssclLkr),
    vatLkr: roundLkr(current.vatLkr + line.vatLkr),
    grandTotalLkr: roundLkr(current.grandTotalLkr + line.grandTotalLkr),
  };
}

interface RunningTotals {
  activeCount: number;
  voidedCount: number;
  totalBaseLkr: number;
  scEligibleBaseLkr: number;
  scExemptBaseLkr: number;
  totalScLkr: number;
  totalSubtotalAfterScLkr: number;
  totalTdlLkr: number;
  totalSsclLkr: number;
  totalVatBaseLkr: number;
  totalVatLkr: number;
  grandTotalLkr: number;
}

function accumulateRunningTotals(totals: RunningTotals, line: FolioLineTaxBreakdown): void {
  if (line.isVoided) {
    totals.voidedCount += 1;
    return;
  }
  totals.activeCount += 1;
  totals.totalBaseLkr = roundLkr(totals.totalBaseLkr + line.lineBaseLkr);
  if (line.scExempt) {
    totals.scExemptBaseLkr = roundLkr(totals.scExemptBaseLkr + line.lineBaseLkr);
  } else {
    totals.scEligibleBaseLkr = roundLkr(totals.scEligibleBaseLkr + line.lineBaseLkr);
  }
  totals.totalScLkr = roundLkr(totals.totalScLkr + line.scLkr);
  totals.totalSubtotalAfterScLkr = roundLkr(
    totals.totalSubtotalAfterScLkr + line.subtotalAfterScLkr,
  );
  totals.totalTdlLkr = roundLkr(totals.totalTdlLkr + line.tdlLkr);
  totals.totalSsclLkr = roundLkr(totals.totalSsclLkr + line.ssclLkr);
  totals.totalVatBaseLkr = roundLkr(totals.totalVatBaseLkr + line.vatBaseLkr);
  totals.totalVatLkr = roundLkr(totals.totalVatLkr + line.vatLkr);
  totals.grandTotalLkr = roundLkr(totals.grandTotalLkr + line.grandTotalLkr);
}

/**
 * Aggregates a list of multi-department folio lines with Sri Lankan statutory taxes.
 *
 * Supports:
 * - Line-by-line 4-stage compounding calculation
 * - Service Charge exemption flags (e.g. safari drivers, excursions)
 * - Voided line handling
 * - Departmental summaries
 * - Strict multi-tenant isolation via optional tenantId validation
 */
export function aggregateFolioTaxes(
  lines: readonly FolioLineItem[],
  options?: AggregateFolioOptions,
): Result<AggregatedFolioTaxes, DomainError> {
  let validatedTenantId: string | undefined;
  if (options?.tenantId !== undefined) {
    const tenantRes = validateTenantId(options.tenantId);
    if (!tenantRes.ok) {
      return tenantRes;
    }
    validatedTenantId = tenantRes.value;
  }

  const config = options?.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const lineBreakdowns: FolioLineTaxBreakdown[] = [];
  const deptSummaries = createEmptyDepartmentSummaries();
  const totals: RunningTotals = {
    activeCount: 0,
    voidedCount: 0,
    totalBaseLkr: 0,
    scEligibleBaseLkr: 0,
    scExemptBaseLkr: 0,
    totalScLkr: 0,
    totalSubtotalAfterScLkr: 0,
    totalTdlLkr: 0,
    totalSsclLkr: 0,
    totalVatBaseLkr: 0,
    totalVatLkr: 0,
    grandTotalLkr: 0,
  };

  for (const [i, line] of lines.entries()) {
    const valRes = validateLineItem(line, i);
    if (!valRes.ok) {
      return valRes;
    }
    const breakdown = computeLineBreakdown(line, config);
    lineBreakdowns.push(breakdown);
    accumulateRunningTotals(totals, breakdown);
    updateDepartmentSummary(deptSummaries, breakdown);
  }

  return ok({
    tenantId: validatedTenantId,
    folioId: options?.folioId,
    totalLines: lines.length,
    activeLines: totals.activeCount,
    voidedLines: totals.voidedCount,
    totalBaseLkr: totals.totalBaseLkr,
    scEligibleBaseLkr: totals.scEligibleBaseLkr,
    scExemptBaseLkr: totals.scExemptBaseLkr,
    totalScLkr: totals.totalScLkr,
    totalSubtotalAfterScLkr: totals.totalSubtotalAfterScLkr,
    totalTdlLkr: totals.totalTdlLkr,
    totalSsclLkr: totals.totalSsclLkr,
    totalVatBaseLkr: totals.totalVatBaseLkr,
    totalVatLkr: totals.totalVatLkr,
    grandTotalLkr: totals.grandTotalLkr,
    lineBreakdowns,
    departmentSummaries: deptSummaries,
  });
}

/**
 * Creates an immutable audit log entry for a folio tax aggregation calculation.
 */
export function createFolioTaxAuditEntry(
  tenantId: string,
  actorUserId: string,
  folioId: string,
  summary: AggregatedFolioTaxes,
  isoTs: string,
  prevHash?: string,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    folioId,
    grandTotalLkr: summary.grandTotalLkr,
    totalBaseLkr: summary.totalBaseLkr,
    totalScLkr: summary.totalScLkr,
    totalTdlLkr: summary.totalTdlLkr,
    totalSsclLkr: summary.totalSsclLkr,
    totalVatLkr: summary.totalVatLkr,
    activeLines: summary.activeLines,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "AGGREGATE_FOLIO_TAXES",
    entityType: "GuestFolio",
    entityId: folioId,
    isoTs,
    afterJson,
    prevHash,
  });
}
