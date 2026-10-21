import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type AccountingStaffRole =
  | "FINANCE_CONTROLLER"
  | "GENERAL_MANAGER"
  | "HOTEL_OWNER"
  | "NIGHT_AUDITOR"
  | "CHIEF_ACCOUNTANT"
  | "SUPER_ADMIN";

export const ACCOUNTING_AUTHORIZED_ROLES: readonly AccountingStaffRole[] = [
  "FINANCE_CONTROLLER",
  "GENERAL_MANAGER",
  "HOTEL_OWNER",
  "NIGHT_AUDITOR",
  "CHIEF_ACCOUNTANT",
  "SUPER_ADMIN",
];

export interface AccountingStaffActor {
  readonly userId: string;
  readonly role: AccountingStaffRole;
  readonly tenantId: string;
}

export interface AccountingSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowsAccountingExport?: boolean | undefined;
}

export interface AccountMapping {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly defaultClassification: "DEBIT" | "CREDIT";
}

export const STANDARD_CHART_OF_ACCOUNTS = {
  // Assets / Settlements (Debit balance)
  CASH_DRAWER: {
    code: "1010",
    name: "Front Desk Cash Drawer",
    type: "ASSET" as AccountType,
    defaultClassification: "DEBIT" as const,
  },
  BANK_CARD_CLEARING: {
    code: "1020",
    name: "Bank & Credit Card Clearing",
    type: "ASSET" as AccountType,
    defaultClassification: "DEBIT" as const,
  },
  LANKA_QR_CLEARING: {
    code: "1030",
    name: "LankaQR EMVCo Clearing",
    type: "ASSET" as AccountType,
    defaultClassification: "DEBIT" as const,
  },
  GUEST_LEDGER: {
    code: "1040",
    name: "Guest Ledger (In-House Receivables)",
    type: "ASSET" as AccountType,
    defaultClassification: "DEBIT" as const,
  },
  CITY_LEDGER: {
    code: "1050",
    name: "City Ledger (Corporate & DMC Receivables)",
    type: "ASSET" as AccountType,
    defaultClassification: "DEBIT" as const,
  },

  // Liabilities & Statutory Taxes (Credit balance)
  ADVANCE_DEPOSITS: {
    code: "2010",
    name: "Advance Guest Deposits",
    type: "LIABILITY" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  SERVICE_CHARGE_POOL: {
    code: "2020",
    name: "10% Staff Service Charge Pool",
    type: "LIABILITY" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  TDL_PAYABLE: {
    code: "2030",
    name: "1% SLTDA Tourism Development Levy Payable",
    type: "LIABILITY" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  SSCL_PAYABLE: {
    code: "2040",
    name: "2.5% IRD Social Security Contribution Levy Payable",
    type: "LIABILITY" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  VAT_PAYABLE: {
    code: "2050",
    name: "18% IRD Value Added Tax Output Payable",
    type: "LIABILITY" as AccountType,
    defaultClassification: "CREDIT" as const,
  },

  // Departmental Revenues (Credit balance)
  ROOM_REVENUE: {
    code: "3010",
    name: "Room & Accommodation Revenue",
    type: "REVENUE" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  FB_REVENUE: {
    code: "3020",
    name: "Food & Beverage Revenue",
    type: "REVENUE" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  SPA_REVENUE: {
    code: "3030",
    name: "Ayurveda & Spa Revenue",
    type: "REVENUE" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  BANQUET_REVENUE: {
    code: "3040",
    name: "Banquet & Event Hall Revenue",
    type: "REVENUE" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  EXCURSION_REVENUE: {
    code: "3050",
    name: "Excursion & Transfer Revenue",
    type: "REVENUE" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
  MISC_REVENUE: {
    code: "3060",
    name: "Miscellaneous & Minibar Revenue",
    type: "REVENUE" as AccountType,
    defaultClassification: "CREDIT" as const,
  },
} as const satisfies Record<string, AccountMapping>;

export interface DailyDepartmentRevenue {
  readonly roomBaseLkr: number;
  readonly fbBaseLkr: number;
  readonly spaBaseLkr?: number | undefined;
  readonly banquetBaseLkr?: number | undefined;
  readonly excursionBaseLkr?: number | undefined;
  readonly miscBaseLkr?: number | undefined;
}

export interface DailyStatutoryTaxes {
  readonly serviceChargeLkr: number; // 10% Staff Pool
  readonly tdlLkr: number; // 1% SLTDA Levy
  readonly ssclLkr: number; // 2.5% IRD SSCL
  readonly vatLkr: number; // 18% IRD Output VAT
}

export interface DailySettlementCollections {
  readonly cashLkr: number;
  readonly cardLkr: number;
  readonly lankaQrLkr: number;
  readonly cityLedgerLkr: number;
  readonly appliedDepositsLkr?: number | undefined;
}

export interface AccountingExportInput {
  readonly tenantId: string;
  readonly hotelName: string;
  readonly journalDate: string; // YYYY-MM-DD
  readonly actor: AccountingStaffActor;
  readonly subscription: AccountingSaasSubscription;
  readonly revenues: DailyDepartmentRevenue;
  readonly taxes: DailyStatutoryTaxes;
  readonly settlements: DailySettlementCollections;
  readonly journalNumber?: string | undefined;
  readonly prevAuditHash?: string | undefined;
}

export interface JournalEntryLine {
  readonly lineNo: number;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly debitLkr: number;
  readonly creditLkr: number;
  readonly department: string;
  readonly narration: string;
}

export interface DailyAccountingJournal {
  readonly tenantId: string;
  readonly hotelName: string;
  readonly journalDate: string;
  readonly journalNumber: string;
  readonly isBalanced: true;
  readonly totalDebitsLkr: number;
  readonly totalCreditsLkr: number;
  readonly lines: readonly JournalEntryLine[];
  readonly quickBooksCsv: string;
  readonly xeroCsv: string;
  readonly tallyXml: string;
  readonly genericCsv: string;
  readonly auditLog: AuditLogEntry;
}

// ============================================================================
// Formatting Helpers for Target Accounting Systems
// ============================================================================

function escapeCsvField(val: string | number): string {
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeXml(val: string | number): string {
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatQbRow(
  journalNumber: string,
  journalDate: string,
  hotelName: string,
  line: JournalEntryLine,
): string {
  const debitStr = line.debitLkr > 0 ? line.debitLkr.toFixed(2) : "0.00";
  const creditStr = line.creditLkr > 0 ? line.creditLkr.toFixed(2) : "0.00";
  return [
    escapeCsvField(journalNumber),
    escapeCsvField(journalDate),
    escapeCsvField(line.accountName),
    escapeCsvField(line.accountCode),
    debitStr,
    creditStr,
    escapeCsvField(line.narration),
    escapeCsvField(hotelName),
  ].join(",");
}

export function exportQuickBooksCsv(
  journalNumber: string,
  journalDate: string,
  hotelName: string,
  lines: readonly JournalEntryLine[],
): string {
  const headers = [
    "*JournalNo",
    "*JournalDate",
    "*AccountName",
    "*AccountCode",
    "*Debit",
    "*Credit",
    "*Description",
    "*Name",
  ].join(",");

  const rows = lines.map((l) => formatQbRow(journalNumber, journalDate, hotelName, l));
  return [headers, ...rows].join("\n");
}

function formatXeroRow(journalNumber: string, journalDate: string, line: JournalEntryLine): string {
  // In Xero manual journals, positive amount is debit, negative amount is credit
  const amount = line.debitLkr > 0 ? line.debitLkr.toFixed(2) : (-line.creditLkr).toFixed(2);
  return [
    escapeCsvField(`Night Audit Journal ${journalNumber}`),
    escapeCsvField(journalDate),
    escapeCsvField(line.narration),
    escapeCsvField(line.accountCode),
    "BASEXCLUDED",
    amount,
  ].join(",");
}

export function exportXeroCsv(
  journalNumber: string,
  journalDate: string,
  lines: readonly JournalEntryLine[],
): string {
  const headers = [
    "*Narration",
    "*Date",
    "*Description",
    "*AccountCode",
    "*TaxType",
    "*Amount",
  ].join(",");
  const rows = lines.map((l) => formatXeroRow(journalNumber, journalDate, l));
  return [headers, ...rows].join("\n");
}

function formatTallyLedgerEntry(line: JournalEntryLine): string {
  const isDebit = line.debitLkr > 0;
  const isDeemedPositive = isDebit ? "Yes" : "No";
  const amount = isDebit ? (-line.debitLkr).toFixed(2) : line.creditLkr.toFixed(2);

  return [
    "      <ALLLEDGERENTRIES.LIST>",
    `        <LEDGERNAME>${escapeXml(line.accountName)}</LEDGERNAME>`,
    `        <ISDEEMEDPOSITIVE>${isDeemedPositive}</ISDEEMEDPOSITIVE>`,
    `        <AMOUNT>${amount}</AMOUNT>`,
    `        <NARRATION>${escapeXml(line.narration)}</NARRATION>`,
    "      </ALLLEDGERENTRIES.LIST>",
  ].join("\n");
}

export function exportTallyXml(
  journalNumber: string,
  journalDate: string,
  hotelName: string,
  lines: readonly JournalEntryLine[],
): string {
  const tallyDate = journalDate.replace(/-/g, ""); // YYYYMMDD
  const entriesXml = lines.map((l) => formatTallyLedgerEntry(l)).join("\n");

  return [
    "<ENVELOPE>",
    "  <HEADER>",
    "    <TALLYREQUEST>Import Data</TALLYREQUEST>",
    "  </HEADER>",
    "  <BODY>",
    "    <IMPORTDATA>",
    "      <REQUESTDESC>",
    "        <REPORTNAME>Vouchers</REPORTNAME>",
    "      </REQUESTDESC>",
    "      <REQUESTDATA>",
    '        <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `          <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `            <DATE>${tallyDate}</DATE>`,
    "            <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>",
    `            <VOUCHERNUMBER>${escapeXml(journalNumber)}</VOUCHERNUMBER>`,
    `            <NARRATION>${escapeXml(`Night Audit Daily Journal - ${hotelName}`)}</NARRATION>`,
    entriesXml,
    "          </VOUCHER>",
    "        </TALLYMESSAGE>",
    "      </REQUESTDATA>",
    "    </IMPORTDATA>",
    "  </BODY>",
    "</ENVELOPE>",
  ].join("\n");
}

function formatGenericCsvRow(
  journalNumber: string,
  journalDate: string,
  line: JournalEntryLine,
): string {
  return [
    escapeCsvField(journalDate),
    escapeCsvField(journalNumber),
    line.lineNo,
    escapeCsvField(line.accountCode),
    escapeCsvField(line.accountName),
    escapeCsvField(line.accountType),
    escapeCsvField(line.department),
    line.debitLkr.toFixed(2),
    line.creditLkr.toFixed(2),
    escapeCsvField(line.narration),
  ].join(",");
}

export function exportGenericJournalCsv(
  journalNumber: string,
  journalDate: string,
  lines: readonly JournalEntryLine[],
): string {
  const headers = [
    "JournalDate",
    "JournalNumber",
    "LineNo",
    "AccountCode",
    "AccountName",
    "AccountType",
    "Department",
    "DebitLkr",
    "CreditLkr",
    "Narration",
  ].join(",");

  const rows = lines.map((l) => formatGenericCsvRow(journalNumber, journalDate, l));
  return [headers, ...rows].join("\n");
}

// ============================================================================
// Core Journal Compiler Function
// ============================================================================

function buildDebitLines(
  settlements: DailySettlementCollections,
  hotelName: string,
  journalDate: string,
): JournalEntryLine[] {
  const debitDefs: Array<{
    mapping: AccountMapping;
    amount: number;
    department: string;
    desc: string;
  }> = [
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.CASH_DRAWER,
      amount: settlements.cashLkr,
      department: "FRONT_DESK",
      desc: "Daily Cash Collections",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.BANK_CARD_CLEARING,
      amount: settlements.cardLkr,
      department: "FRONT_DESK",
      desc: "Credit / Debit Card Settlements",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.LANKA_QR_CLEARING,
      amount: settlements.lankaQrLkr,
      department: "FRONT_DESK",
      desc: "LankaQR EMVCo Settlements",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.CITY_LEDGER,
      amount: settlements.cityLedgerLkr,
      department: "FRONT_DESK",
      desc: "City Ledger / DMC Direct Billing",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.ADVANCE_DEPOSITS,
      amount: settlements.appliedDepositsLkr ?? 0,
      department: "FRONT_DESK",
      desc: "Advance Deposits Realized on Folios",
    },
  ];

  const lines: JournalEntryLine[] = [];
  let lineIdx = 1;

  for (const def of debitDefs) {
    const rounded = roundLkr(def.amount);
    if (rounded > 0) {
      lines.push({
        lineNo: lineIdx++,
        accountCode: def.mapping.code,
        accountName: def.mapping.name,
        accountType: def.mapping.type,
        debitLkr: rounded,
        creditLkr: 0,
        department: def.department,
        narration: `${def.desc} - ${hotelName} (${journalDate})`,
      });
    }
  }

  return lines;
}

function buildCreditLines(
  revenues: DailyDepartmentRevenue,
  taxes: DailyStatutoryTaxes,
  hotelName: string,
  journalDate: string,
  startLineNo: number,
): JournalEntryLine[] {
  const creditDefs: Array<{
    mapping: AccountMapping;
    amount: number;
    department: string;
    desc: string;
  }> = [
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.ROOM_REVENUE,
      amount: revenues.roomBaseLkr,
      department: "ROOMS",
      desc: "Room Revenue (Base)",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.FB_REVENUE,
      amount: revenues.fbBaseLkr,
      department: "FOOD_AND_BEVERAGE",
      desc: "Food & Beverage Revenue (Base)",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.SPA_REVENUE,
      amount: revenues.spaBaseLkr ?? 0,
      department: "SPA",
      desc: "Spa & Ayurveda Revenue (Base)",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.BANQUET_REVENUE,
      amount: revenues.banquetBaseLkr ?? 0,
      department: "BANQUETS",
      desc: "Banquet & Hall Revenue (Base)",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.EXCURSION_REVENUE,
      amount: revenues.excursionBaseLkr ?? 0,
      department: "EXCURSIONS",
      desc: "Excursions & Transfers Revenue (Base)",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.MISC_REVENUE,
      amount: revenues.miscBaseLkr ?? 0,
      department: "MISCELLANEOUS",
      desc: "Minibar & Miscellaneous Revenue",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.SERVICE_CHARGE_POOL,
      amount: taxes.serviceChargeLkr,
      department: "STATUTORY_LIABILITY",
      desc: "10% Staff Service Charge Pool",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.TDL_PAYABLE,
      amount: taxes.tdlLkr,
      department: "STATUTORY_LIABILITY",
      desc: "1% SLTDA Tourism Development Levy",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.SSCL_PAYABLE,
      amount: taxes.ssclLkr,
      department: "STATUTORY_LIABILITY",
      desc: "2.5% IRD Social Security Contribution Levy",
    },
    {
      mapping: STANDARD_CHART_OF_ACCOUNTS.VAT_PAYABLE,
      amount: taxes.vatLkr,
      department: "STATUTORY_LIABILITY",
      desc: "18% IRD Output VAT Payable",
    },
  ];

  const lines: JournalEntryLine[] = [];
  let lineIdx = startLineNo;

  for (const def of creditDefs) {
    const rounded = roundLkr(def.amount);
    if (rounded > 0) {
      lines.push({
        lineNo: lineIdx++,
        accountCode: def.mapping.code,
        accountName: def.mapping.name,
        accountType: def.mapping.type,
        debitLkr: 0,
        creditLkr: rounded,
        department: def.department,
        narration: `${def.desc} - ${hotelName} (${journalDate})`,
      });
    }
  }

  return lines;
}

/**
 * Compiles a balanced double-entry daily accounting journal and exports to
 * QuickBooks, Xero, Tally XML, and generic CSV.
 * Enforces:
 * - Multi-tenant tenantId isolation
 * - RolePermissionMatrix RBAC authorization
 * - SaasSubscription entitlement checks
 * - Strict double-entry balance: sum(Debits) === sum(Credits) to the exact cent
 * - Tamper-evident SHA-256 hash-chained ImmutableAuditLog generation
 */
export function compileDailyAccountingJournal(
  input: AccountingExportInput,
): Result<DailyAccountingJournal, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const tenantId = tenantRes.value;

  // 1. RBAC Check
  if (!ACCOUNTING_AUTHORIZED_ROLES.includes(input.actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Staff role '${input.actor.role}' is not authorized to export accounting journals.`,
      { role: input.actor.role, authorizedRoles: ACCOUNTING_AUTHORIZED_ROLES },
    );
  }

  if (input.actor.tenantId !== tenantId) {
    return domainErr("TENANT_MISMATCH", "Actor tenantId does not match input tenantId", {
      actorTenant: input.actor.tenantId,
      targetTenant: tenantId,
    });
  }

  // 2. SaaS Subscription Check
  if (!input.subscription.active || input.subscription.tenantId !== tenantId) {
    return domainErr(
      "SUBSCRIPTION_INACTIVE",
      "SaaS subscription is inactive or mismatched for accounting export.",
      { subscription: input.subscription },
    );
  }

  if (input.subscription.allowsAccountingExport === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "SaaS subscription tier does not include external accounting journal export.",
      { tier: input.subscription.tier },
    );
  }

  // 3. Date Validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.journalDate)) {
    return domainErr("INVALID_DATE_FORMAT", "journalDate must be in YYYY-MM-DD format", {
      journalDate: input.journalDate,
    });
  }

  // 4. Build Debits and Credits
  const debitLines = buildDebitLines(input.settlements, input.hotelName, input.journalDate);
  const creditLines = buildCreditLines(
    input.revenues,
    input.taxes,
    input.hotelName,
    input.journalDate,
    debitLines.length + 1,
  );

  const lines = [...debitLines, ...creditLines];

  // 5. Compute sums with integer cent rounding
  const totalDebitsLkr = roundLkr(debitLines.reduce((acc, l) => acc + l.debitLkr, 0));
  const totalCreditsLkr = roundLkr(creditLines.reduce((acc, l) => acc + l.creditLkr, 0));

  // 6. Rung 5: Assert sum(debits) === sum(credits) to the exact cent
  const diff = roundLkr(Math.abs(totalDebitsLkr - totalCreditsLkr));
  if (diff > 0.001) {
    return domainErr(
      "VALIDATION_FAILED",
      `Double-entry imbalance: total debits (LKR ${totalDebitsLkr.toFixed(2)}) do not match total credits (LKR ${totalCreditsLkr.toFixed(2)}). Imbalance: LKR ${diff.toFixed(2)}`,
      {
        subCode: "UNBALANCED_JOURNAL",
        totalDebitsLkr,
        totalCreditsLkr,
        diff,
      },
    );
  }

  const journalNumber = input.journalNumber ?? `JRN-${input.journalDate}`;

  // 7. Generate Format Exports
  const quickBooksCsv = exportQuickBooksCsv(
    journalNumber,
    input.journalDate,
    input.hotelName,
    lines,
  );
  const xeroCsv = exportXeroCsv(journalNumber, input.journalDate, lines);
  const tallyXml = exportTallyXml(journalNumber, input.journalDate, input.hotelName, lines);
  const genericCsv = exportGenericJournalCsv(journalNumber, input.journalDate, lines);

  // 8. Generate SHA-256 Hash-Chained Audit Log
  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.actor.userId,
    action: "ACCOUNTING_JOURNAL_EXPORTED",
    entityType: "DailyAccountingJournal",
    entityId: journalNumber,
    isoTs: new Date().toISOString(),
    afterJson: JSON.stringify({
      journalDate: input.journalDate,
      journalNumber,
      totalDebitsLkr,
      totalCreditsLkr,
      linesCount: lines.length,
      formatsExported: ["QuickBooks", "Xero", "Tally", "GenericCsv"],
    }),
    prevHash: input.prevAuditHash,
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId,
    hotelName: input.hotelName,
    journalDate: input.journalDate,
    journalNumber,
    isBalanced: true,
    totalDebitsLkr,
    totalCreditsLkr,
    lines,
    quickBooksCsv,
    xeroCsv,
    tallyXml,
    genericCsv,
    auditLog: auditRes.value,
  });
}
