/**
 * @hms/core - SLTDA Monthly Statistical & Quarterly TDL Return Compiler (sltdaReports.ts)
 *
 * Implements Step 404 (Phase 17.04) & Step 405 (Phase 17.05) of the Sri Lanka HMS Master Architecture Plan:
 * Deterministic domain engine matching the official Sri Lanka Tourism Development Authority (SLTDA)
 * Research & International Relations Division statutory return formats:
 *
 * 1. SLTDA Monthly Statistical Return (`compileSltdaMonthlyReturn`):
 *    - Aggregates daily night audits over the calendar month (e.g. 2026-10).
 *    - Computes Total Available Room Nights, Occupied Room Nights, Room Occupancy %.
 *    - Computes Total Available Bed Nights, Occupied Bed Nights, Bed Occupancy %.
 *    - Distributes Foreign Tourist Guest Nights by Country of Residence
 *      (United Kingdom, India, Germany, Russia, France, Australia, China, United States, etc.).
 *    - Distributes Sri Lankan Domestic Guest Nights.
 *    - Computes Monthly Financial KPIs: Average Daily Rate (ADR) and RevPAR in LKR.
 *
 * 2. SLTDA Quarterly Tourism Development Levy Statement (`compileTdlQuarterlyReturn`):
 *    - Formatted for Tourism Act No. 38 of 2005 Section 35(1) Gazette compliance.
 *    - Computes Gross Turnover Excluding VAT & Service Charge (up to 10%).
 *    - Calculates 1.0% (standard hotel tier) or 0.5% (small hotel/guesthouse <= LKR 3M turnover).
 *    - Generates Bank of Ceylon (BOC) Corporate Branch A/C `73104820` / GovPay reference slip.
 *
 * 3. Enforces Multi-Tenant SaaS isolation, RBAC role guard, and SaasSubscription entitlements.
 * 4. Generates SHA-256 hash-chained `ImmutableAuditLog` entries for statutory submission audit trails.
 *
 * Zero external runtime npm dependencies (Node 22 standard library only).
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import type { NightAuditCalculationResult } from "./nightAudit.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

/**
 * Staff roles authorized to compile and submit SLTDA statutory returns.
 */
export type SltdaStaffRole =
  | "NIGHT_AUDITOR"
  | "FRONT_DESK_MANAGER"
  | "FINANCE_CONTROLLER"
  | "GENERAL_MANAGER"
  | "SUPER_ADMIN";

export const SLTDA_AUTHORIZED_ROLES: readonly SltdaStaffRole[] = [
  "NIGHT_AUDITOR",
  "FRONT_DESK_MANAGER",
  "FINANCE_CONTROLLER",
  "GENERAL_MANAGER",
  "SUPER_ADMIN",
];

export interface SltdaStaffActor {
  readonly userId: string;
  readonly role: SltdaStaffRole;
  readonly tenantId: string;
}

export interface SltdaSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowsSltdaReporting?: boolean | undefined;
}

/**
 * Country-level foreign guest and room-night statistics for SLTDA monthly return.
 */
export interface SltdaCountryBreakdown {
  readonly countryCode: string;
  readonly countryName: string;
  readonly guestCount: number;
  readonly guestNights: number;
  readonly percentageOfForeignGuestNights: number;
}

/**
 * Official SLTDA Research & International Relations Division Monthly Statistical Return.
 */
export interface SltdaMonthlyReturnResult {
  readonly tenantId: string;
  readonly yearMonth: string; // Format: YYYY-MM
  readonly hotelName: string;
  readonly sltdaRegistrationNumber: string;

  // Capacity & Occupancy
  readonly roomCapacity: number;
  readonly bedCapacity: number;
  readonly daysInMonth: number;
  readonly auditedDaysCount: number;
  readonly totalAvailableRoomNights: number;
  readonly occupiedRoomNights: number;
  readonly roomOccupancyRate: number; // 0.00 to 100.00 %

  readonly totalAvailableBedNights: number;
  readonly occupiedBedNights: number;
  readonly bedOccupancyRate: number; // 0.00 to 100.00 %

  // Guest Demographics
  readonly domesticGuestNights: number;
  readonly foreignGuestNights: number;
  readonly totalGuestNights: number;
  readonly foreignCountryBreakdown: readonly SltdaCountryBreakdown[];

  // Monthly Financial Performance (LKR)
  readonly totalRoomRevenueLkr: number;
  readonly totalFbRevenueLkr: number;
  readonly totalOtherRevenueLkr: number;
  readonly totalGrossRevenueLkr: number;
  readonly averageDailyRateLkr: number; // ADR
  readonly revParLkr: number; // RevPAR

  // Audit Log Entry
  readonly auditLog: AuditLogEntry;
}

export interface SltdaMonthlyReturnInput {
  readonly tenantId: string;
  readonly yearMonth: string; // Format: YYYY-MM
  readonly hotelName: string;
  readonly sltdaRegistrationNumber: string;
  readonly roomCapacity: number;
  readonly bedCapacity?: number | undefined;
  readonly dailyAudits: readonly NightAuditCalculationResult[];
  readonly actor: SltdaStaffActor;
  readonly subscription?: SltdaSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly timestamp?: string | undefined;
}

/**
 * Standard ISO country code to English name mapping for major SLTDA tourist source markets.
 */
export const SLTDA_MAJOR_COUNTRY_NAMES: Readonly<Record<string, string>> = {
  GB: "United Kingdom",
  IN: "India",
  DE: "Germany",
  RU: "Russian Federation",
  FR: "France",
  AU: "Australia",
  CN: "China",
  US: "United States",
  NL: "Netherlands",
  CA: "Canada",
  IT: "Italy",
  CH: "Switzerland",
  PL: "Poland",
  JP: "Japan",
  MV: "Maldives",
  OTHER: "Other Foreign Countries",
};

/**
 * Monthly TDL line breakdown for quarterly statement.
 */
export interface TdlMonthBreakdown {
  readonly monthIndex: 1 | 2 | 3;
  readonly yearMonth: string;
  readonly turnoverBaseLkr: number; // Gross supply excluding VAT & SC
  readonly tdlRatePercent: number;
  readonly tdlPayableLkr: number;
}

/**
 * Official SLTDA Tourism Development Levy (TDL) Quarterly Statement.
 */
export interface TdlQuarterlyReturnResult {
  readonly tenantId: string;
  readonly taxYear: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly quarterLabel: string; // e.g. "Q1 (Jan - Mar 2026)"
  readonly hotelName: string;
  readonly sltdaRegistrationNumber: string;
  readonly tdlRatePercent: number; // 1.0% or 0.5%
  readonly months: readonly TdlMonthBreakdown[];
  readonly quarterlyTurnoverLkr: number;
  readonly quarterlyTdlPayableLkr: number;
  readonly statutoryDueDate: string; // YYYY-MM-DD
  readonly paymentAccount: string;
  readonly paymentReference: string;
  readonly auditLog: AuditLogEntry;
}

export interface TdlQuarterlyReturnOptions {
  readonly tenantId: string;
  readonly taxYear: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly hotelName: string;
  readonly actor: SltdaStaffActor;
  readonly subscription?: SltdaSaasSubscription | undefined;
  readonly bocPaymentAccount?: string | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly timestamp?: string | undefined;
}

// ============================================================================
// Security & Validation Helpers (Cognitive Complexity <= 12)
// ============================================================================

export function validateSltdaActor(
  actor: SltdaStaffActor,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!actor || !actor.userId || actor.userId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Actor userId must not be empty");
  }

  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match operation tenant '${expectedTenantId}'`,
    );
  }

  if (!SLTDA_AUTHORIZED_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized for SLTDA statutory returns`,
      { allowedRoles: SLTDA_AUTHORIZED_ROLES },
    );
  }

  return ok(undefined);
}

export function validateSltdaSubscription(
  sub: SltdaSaasSubscription | undefined,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!sub) return ok(undefined);

  if (sub.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenant '${sub.tenantId}' does not match operation tenant '${expectedTenantId}'`,
    );
  }

  if (!sub.active) {
    return domainErr("SUBSCRIPTION_INACTIVE", "SaaS subscription for this property is inactive", {
      tenantId: expectedTenantId,
    });
  }

  if (sub.allowsSltdaReporting === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "SLTDA statutory returns and TDL calculation engine is not entitled under current plan tier",
      { tier: sub.tier },
    );
  }

  return ok(undefined);
}

const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function getDaysInYearMonth(yearMonth: string): number {
  const parts = yearMonth.split("-");
  const year = Number.parseInt(parts[0] || "2026", 10);
  const month = Number.parseInt(parts[1] || "1", 10);
  return new Date(year, month, 0).getDate();
}

// ============================================================================
// Monthly Return Compilers & Aggregators
// ============================================================================

interface MonthlyFinancialSums {
  occupiedRoomNights: number;
  occupiedBedNights: number;
  domesticGuestNights: number;
  foreignGuestNights: number;
  roomRevenueLkr: number;
  fbRevenueLkr: number;
  otherRevenueLkr: number;
  totalGrossRevenueLkr: number;
  countryMap: Record<string, { guestCount: number; guestNights: number }>;
}

function processSingleDailyAudit(
  audit: NightAuditCalculationResult,
  expectedTenantId: string,
  expectedYearMonth: string,
  sums: MonthlyFinancialSums,
): Result<boolean, DomainError> {
  if (audit.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Daily audit for ${audit.businessDate} belongs to tenant '${audit.tenantId}', expected '${expectedTenantId}'`,
    );
  }

  if (!audit.businessDate.startsWith(expectedYearMonth)) {
    return ok(false);
  }

  sums.occupiedRoomNights += audit.occupiedRooms;
  sums.occupiedBedNights += audit.occupiedBeds;
  sums.domesticGuestNights += audit.localGuestNights;
  sums.foreignGuestNights += audit.foreignGuestNights;
  sums.roomRevenueLkr = roundLkr(sums.roomRevenueLkr + audit.roomRevenueLkr);
  sums.fbRevenueLkr = roundLkr(sums.fbRevenueLkr + audit.fAndBRevenueLkr);
  sums.otherRevenueLkr = roundLkr(sums.otherRevenueLkr + audit.otherRevenueLkr);
  sums.totalGrossRevenueLkr = roundLkr(sums.totalGrossRevenueLkr + audit.totalNetRevenueLkr);

  for (const [code, stat] of Object.entries(audit.nationalityBreakdown)) {
    if (!stat.isDomestic) {
      const existing = sums.countryMap[code] ?? { guestCount: 0, guestNights: 0 };
      sums.countryMap[code] = {
        guestCount: existing.guestCount + stat.guestCount,
        guestNights: existing.guestNights + stat.guestNights,
      };
    }
  }

  return ok(true);
}

function sumDailyAudits(
  dailyAudits: readonly NightAuditCalculationResult[],
  expectedTenantId: string,
  expectedYearMonth: string,
): Result<MonthlyFinancialSums, DomainError> {
  const sums: MonthlyFinancialSums = {
    occupiedRoomNights: 0,
    occupiedBedNights: 0,
    domesticGuestNights: 0,
    foreignGuestNights: 0,
    roomRevenueLkr: 0,
    fbRevenueLkr: 0,
    otherRevenueLkr: 0,
    totalGrossRevenueLkr: 0,
    countryMap: {},
  };

  for (const audit of dailyAudits) {
    const res = processSingleDailyAudit(audit, expectedTenantId, expectedYearMonth, sums);
    if (!res.ok) return res;
  }

  return ok(sums);
}

function buildCountryBreakdown(
  countryMap: Record<string, { guestCount: number; guestNights: number }>,
  totalForeignGuestNights: number,
): readonly SltdaCountryBreakdown[] {
  const result: SltdaCountryBreakdown[] = [];

  for (const [code, stat] of Object.entries(countryMap)) {
    const countryName = SLTDA_MAJOR_COUNTRY_NAMES[code] || `Other (${code})`;
    const pct =
      totalForeignGuestNights > 0
        ? roundLkr((stat.guestNights / totalForeignGuestNights) * 100)
        : 0;

    result.push({
      countryCode: code,
      countryName,
      guestCount: stat.guestCount,
      guestNights: stat.guestNights,
      percentageOfForeignGuestNights: pct,
    });
  }

  return result.sort((a, b) => b.guestNights - a.guestNights);
}

function validateSltdaMonthlyInput(
  input: SltdaMonthlyReturnInput,
): Result<
  { tenantId: string; yearMonth: string; roomCapacity: number; bedCapacity: number },
  DomainError
> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) return tenantRes;
  const tenantId = tenantRes.value;

  if (!input.yearMonth || !YEAR_MONTH_REGEX.test(input.yearMonth.trim())) {
    return domainErr(
      "VALIDATION_FAILED",
      "yearMonth must be a valid string formatted as YYYY-MM (e.g. '2026-10')",
      { yearMonth: input.yearMonth },
    );
  }
  const yearMonth = input.yearMonth.trim();

  const actorRes = validateSltdaActor(input.actor, tenantId);
  if (!actorRes.ok) return actorRes;

  const subRes = validateSltdaSubscription(input.subscription, tenantId);
  if (!subRes.ok) return subRes;

  if (!Number.isInteger(input.roomCapacity) || input.roomCapacity <= 0) {
    return domainErr("VALIDATION_FAILED", "roomCapacity must be a positive integer", {
      roomCapacity: input.roomCapacity,
    });
  }
  const roomCapacity = input.roomCapacity;
  const bedCapacity =
    input.bedCapacity !== undefined && input.bedCapacity > 0
      ? Math.floor(input.bedCapacity)
      : roomCapacity * 2;

  return ok({ tenantId, yearMonth, roomCapacity, bedCapacity });
}

/**
 * Compiles the official SLTDA Research & International Relations Division Monthly Statistical Return.
 *
 * @param input SltdaMonthlyReturnInput configuration and daily audit records
 * @returns Result containing complete SltdaMonthlyReturnResult or DomainError
 */
export function compileSltdaMonthlyReturn(
  input: SltdaMonthlyReturnInput,
): Result<SltdaMonthlyReturnResult, DomainError> {
  const valRes = validateSltdaMonthlyInput(input);
  if (!valRes.ok) return valRes;
  const { tenantId, yearMonth, roomCapacity, bedCapacity } = valRes.value;

  const daysInMonth = getDaysInYearMonth(yearMonth);
  const totalAvailableRoomNights = roomCapacity * daysInMonth;
  const totalAvailableBedNights = bedCapacity * daysInMonth;

  const sumRes = sumDailyAudits(input.dailyAudits, tenantId, yearMonth);
  if (!sumRes.ok) return sumRes;
  const sums = sumRes.value;

  const roomOccupancyRate =
    totalAvailableRoomNights > 0
      ? roundLkr((sums.occupiedRoomNights / totalAvailableRoomNights) * 100)
      : 0;

  const bedOccupancyRate =
    totalAvailableBedNights > 0
      ? roundLkr((sums.occupiedBedNights / totalAvailableBedNights) * 100)
      : 0;

  const averageDailyRateLkr =
    sums.occupiedRoomNights > 0 ? roundLkr(sums.roomRevenueLkr / sums.occupiedRoomNights) : 0;

  const revParLkr =
    totalAvailableRoomNights > 0 ? roundLkr(sums.roomRevenueLkr / totalAvailableRoomNights) : 0;

  const foreignCountryBreakdown = buildCountryBreakdown(sums.countryMap, sums.foreignGuestNights);

  const isoTs = input.timestamp || new Date().toISOString();
  const summaryPayload = {
    tenantId,
    yearMonth,
    sltdaRegistrationNumber: input.sltdaRegistrationNumber,
    roomOccupancyRate,
    bedOccupancyRate,
    totalGuestNights: sums.domesticGuestNights + sums.foreignGuestNights,
    domesticGuestNights: sums.domesticGuestNights,
    foreignGuestNights: sums.foreignGuestNights,
    totalGrossRevenueLkr: sums.totalGrossRevenueLkr,
    averageDailyRateLkr,
    revParLkr,
  };

  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.actor.userId,
    action: "SLTDA_MONTHLY_RETURN_COMPILED",
    entityType: "SltdaMonthlyReturn",
    entityId: `${tenantId}#${yearMonth}`,
    isoTs,
    afterJson: JSON.stringify(summaryPayload),
    prevHash: input.prevAuditHash,
  });

  if (!auditRes.ok) return auditRes;

  return ok({
    tenantId,
    yearMonth,
    hotelName: input.hotelName,
    sltdaRegistrationNumber: input.sltdaRegistrationNumber,
    roomCapacity,
    bedCapacity,
    daysInMonth,
    auditedDaysCount: input.dailyAudits.filter((a) => a.businessDate.startsWith(yearMonth)).length,
    totalAvailableRoomNights,
    occupiedRoomNights: sums.occupiedRoomNights,
    roomOccupancyRate,
    totalAvailableBedNights,
    occupiedBedNights: sums.occupiedBedNights,
    bedOccupancyRate,
    domesticGuestNights: sums.domesticGuestNights,
    foreignGuestNights: sums.foreignGuestNights,
    totalGuestNights: sums.domesticGuestNights + sums.foreignGuestNights,
    foreignCountryBreakdown,
    totalRoomRevenueLkr: sums.roomRevenueLkr,
    totalFbRevenueLkr: sums.fbRevenueLkr,
    totalOtherRevenueLkr: sums.otherRevenueLkr,
    totalGrossRevenueLkr: sums.totalGrossRevenueLkr,
    averageDailyRateLkr,
    revParLkr,
    auditLog: auditRes.value,
  });
}

// ============================================================================
// Quarterly TDL Return Compiler (Step 405)
// ============================================================================

export function getQuarterMonths(year: number, quarter: 1 | 2 | 3 | 4): readonly string[] {
  switch (quarter) {
    case 1:
      return [`${year}-01`, `${year}-02`, `${year}-03`];
    case 2:
      return [`${year}-04`, `${year}-05`, `${year}-06`];
    case 3:
      return [`${year}-07`, `${year}-08`, `${year}-09`];
    case 4:
      return [`${year}-10`, `${year}-11`, `${year}-12`];
  }
}

export function getTdlStatutoryDueDate(year: number, quarter: 1 | 2 | 3 | 4): string {
  switch (quarter) {
    case 1:
      return `${year}-04-15`;
    case 2:
      return `${year}-07-15`;
    case 3:
      return `${year}-10-15`;
    case 4:
      return `${year + 1}-01-15`;
  }
}

function validateTdlActorAndSubscription(
  tenantId: string,
  options?: Partial<TdlQuarterlyReturnOptions> | undefined,
): Result<void, DomainError> {
  if (options?.actor) {
    const actorRes = validateSltdaActor(options.actor, tenantId);
    if (!actorRes.ok) return actorRes;
  }
  if (options?.subscription) {
    const subRes = validateSltdaSubscription(options.subscription, tenantId);
    if (!subRes.ok) return subRes;
  }
  return ok(undefined);
}

function validateTdlInput(
  dailyAudits: readonly NightAuditCalculationResult[],
  sltdaRegNo: string,
  options?: Partial<TdlQuarterlyReturnOptions> | undefined,
): Result<{ tenantId: string; taxYear: number; quarter: 1 | 2 | 3 | 4 }, DomainError> {
  const tenantIdRaw = options?.tenantId || (dailyAudits[0] ? dailyAudits[0].tenantId : "");
  const tenantRes = validateTenantId(tenantIdRaw);
  if (!tenantRes.ok) return tenantRes;
  const tenantId = tenantRes.value;

  if (!sltdaRegNo || sltdaRegNo.trim() === "") {
    return domainErr("VALIDATION_FAILED", "sltdaRegNo must not be empty");
  }

  const taxYear = options?.taxYear || new Date().getFullYear();
  const quarter = options?.quarter || 1;
  if (![1, 2, 3, 4].includes(quarter)) {
    return domainErr("VALIDATION_FAILED", "quarter must be 1, 2, 3, or 4", { quarter });
  }

  const authRes = validateTdlActorAndSubscription(tenantId, options);
  if (!authRes.ok) return authRes;

  return ok({ tenantId, taxYear, quarter: quarter as 1 | 2 | 3 | 4 });
}

function computeQuarterlyTdlSums(
  dailyAudits: readonly NightAuditCalculationResult[],
  tenantId: string,
  quarterMonths: readonly string[],
  rateFraction: number,
  rate: number,
): Result<TdlMonthBreakdown[], DomainError> {
  const monthSums: number[] = [0, 0, 0];

  for (const audit of dailyAudits) {
    if (audit.tenantId !== tenantId) {
      return domainErr(
        "TENANT_MISMATCH",
        `Daily audit belongs to tenant '${audit.tenantId}', expected '${tenantId}'`,
      );
    }

    const ym = audit.businessDate.substring(0, 7);
    const monthIdx = quarterMonths.indexOf(ym);
    if (monthIdx !== -1 && monthIdx < 3) {
      monthSums[monthIdx] = roundLkr((monthSums[monthIdx] || 0) + audit.totalNetRevenueLkr);
    }
  }

  const months: TdlMonthBreakdown[] = quarterMonths.map((ym, idx) => {
    const base = monthSums[idx] || 0;
    const tdl = roundLkr(base * rateFraction);
    return {
      monthIndex: (idx + 1) as 1 | 2 | 3,
      yearMonth: ym,
      turnoverBaseLkr: base,
      tdlRatePercent: rate,
      tdlPayableLkr: tdl,
    };
  });

  return ok(months);
}

/**
 * Compiles the SLTDA Quarterly Tourism Development Levy (TDL) Statement for Bank of Ceylon
 * Corporate Branch A/C 73104820 or GovPay clearance.
 *
 * @param dailyAudits Array of daily NightAuditCalculationResult records
 * @param sltdaRegNo Official SLTDA hotel registration certificate number
 * @param ratePercent TDL levy percentage (typically 1.0%, or 0.5% for small guesthouses)
 * @param options Additional multi-tenant and audit options
 */
export function compileTdlQuarterlyReturn(
  dailyAudits: readonly NightAuditCalculationResult[],
  sltdaRegNo: string,
  ratePercent = 1.0,
  options?: Partial<TdlQuarterlyReturnOptions> | undefined,
): Result<TdlQuarterlyReturnResult, DomainError> {
  const valRes = validateTdlInput(dailyAudits, sltdaRegNo, options);
  if (!valRes.ok) return valRes;
  const { tenantId, taxYear, quarter } = valRes.value;

  const rate = ratePercent > 0 ? ratePercent : 1.0;
  const rateFraction = rate / 100;
  const quarterMonths = getQuarterMonths(taxYear, quarter);

  const monthsRes = computeQuarterlyTdlSums(
    dailyAudits,
    tenantId,
    quarterMonths,
    rateFraction,
    rate,
  );
  if (!monthsRes.ok) return monthsRes;
  const months = monthsRes.value;

  const quarterlyTurnoverLkr = roundLkr(months.reduce((acc, m) => acc + m.turnoverBaseLkr, 0));
  const quarterlyTdlPayableLkr = roundLkr(months.reduce((acc, m) => acc + m.tdlPayableLkr, 0));

  const statutoryDueDate = getTdlStatutoryDueDate(taxYear, quarter);
  const paymentAccount = options?.bocPaymentAccount || "BOC Corporate Branch A/C 73104820";
  const cleanRegNo = sltdaRegNo.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const paymentReference = `TDL-${taxYear}-Q${quarter}-${cleanRegNo}`;

  const isoTs = options?.timestamp || new Date().toISOString();
  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: options?.actor?.userId || "system-sltda-engine",
    action: "SLTDA_TDL_QUARTERLY_RETURN_COMPILED",
    entityType: "TdlQuarterlyReturn",
    entityId: `${tenantId}#${taxYear}#Q${quarter}`,
    isoTs,
    afterJson: JSON.stringify({
      tenantId,
      taxYear,
      quarter,
      sltdaRegNo,
      ratePercent: rate,
      quarterlyTurnoverLkr,
      quarterlyTdlPayableLkr,
      paymentReference,
    }),
    prevHash: options?.prevAuditHash,
  });

  if (!auditRes.ok) return auditRes;

  const quarterLabels: Record<1 | 2 | 3 | 4, string> = {
    1: `Q1 (Jan - Mar ${taxYear})`,
    2: `Q2 (Apr - Jun ${taxYear})`,
    3: `Q3 (Jul - Sep ${taxYear})`,
    4: `Q4 (Oct - Dec ${taxYear})`,
  };

  return ok({
    tenantId,
    taxYear,
    quarter,
    quarterLabel: quarterLabels[quarter],
    hotelName: options?.hotelName || "Hotel Property",
    sltdaRegistrationNumber: sltdaRegNo,
    tdlRatePercent: rate,
    months,
    quarterlyTurnoverLkr,
    quarterlyTdlPayableLkr,
    statutoryDueDate,
    paymentAccount,
    paymentReference,
    auditLog: auditRes.value,
  });
}
