import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import { roundLkr } from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

/**
 * Standard Sri Lankan Commercial Banks Directory with official 4-digit LankaClear / CBSL codes.
 */
export const SRI_LANKA_BANK_CODES = {
  BOC: "7010", // Bank of Ceylon
  PEOPLES: "7135", // People's Bank
  COMMERCIAL: "7056", // Commercial Bank of Ceylon PLC
  SAMPATH: "7278", // Sampath Bank PLC
  HNB: "7083", // Hatton National Bank PLC
  NTB: "7162", // Nations Trust Bank PLC
  SEYLAN: "7287", // Seylan Bank PLC
  NDB: "7205", // National Development Bank PLC
  DFCC: "7311", // DFCC Bank PLC
  UNION: "7384", // Union Bank of Colombo PLC
  AMANA: "7463", // Amana Bank PLC
  PABC: "7108", // Pan Asia Banking Corporation PLC
  STANDARD_CHARTERED: "7047", // Standard Chartered Bank
  HSBC: "7074", // HSBC Sri Lanka
  CARGILLS: "7719", // Cargills Bank PLC
  NSB: "7472", // National Savings Bank
  SDB: "7302", // Sanasa Development Bank
  SMIB: "7214", // State Mortgage & Investment Bank
} as const;

export type SriLankaBankKey = keyof typeof SRI_LANKA_BANK_CODES;

/**
 * Supported electronic bank salary & service charge transfer file formats.
 */
export type BankSlipsTransferFormat =
  | "LANKAPAY_SLIPS_STANDARD"
  | "COMMERCIAL_BANK_PAYMASTER"
  | "SAMPATH_CORPORATE_VISHWA"
  | "BOC_BULK_SALARY"
  | "PEOPLES_BANK_SLIPS"
  | "HNB_APPROVE_ONLINE";

/**
 * Hotel originating bank account profile for outgoing payroll & service charge disbursements.
 */
export interface OriginatingAccountProfile {
  readonly bankCode: string; // 4 digits e.g. "7056"
  readonly branchCode: string; // 3 digits e.g. "001"
  readonly accountNumber: string; // Hotel settlement bank account
  readonly companyName: string; // Hotel entity name (max 30 chars)
  readonly particulars?: string | undefined; // e.g. "OCT 2026 SALARY"
}

/**
 * Individual employee bank disbursement line item.
 */
export interface EmployeeBankTransferItem {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly destinationBankCode: string; // 4 digits (e.g. "7056" or bank name)
  readonly destinationBranchCode: string; // 3 digits (e.g. "001")
  readonly destinationAccountNumber: string; // 6 to 16 digits
  readonly netPayLkr: number; // Disbursed amount in Sri Lankan Rupees (> 0)
  readonly nicOrPassport: string; // Employee National Identity Card or Passport
  readonly referenceNarrative?: string | undefined; // Optional reference e.g. "OCT-PAYROLL"
}

/**
 * Input parameters for bulk bank transfer export.
 */
export interface BankSlipsExportInput {
  readonly tenantId: string;
  readonly billingPeriod: string; // e.g. "2026-10"
  readonly paymentDate: string; // YYYY-MM-DD
  readonly format: BankSlipsTransferFormat;
  readonly origin: OriginatingAccountProfile;
  readonly transfers: readonly EmployeeBankTransferItem[];
  readonly actorUserId?: string | undefined;
  readonly isoTs?: string | undefined;
  readonly previousAuditHash?: string | undefined;
}

/**
 * Generated bulk bank transfer result containing formatted CSV and cryptographically chained audit log.
 */
export interface BankSlipsExportResult {
  readonly tenantId: string;
  readonly billingPeriod: string;
  readonly paymentDate: string;
  readonly format: BankSlipsTransferFormat;
  readonly totalCount: number;
  readonly totalAmountLkr: number;
  readonly originatingAccount: string;
  readonly csvContent: string;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Sanitization & Padding Helpers (Rung 5)
// ============================================================================

const BANK_ALIAS_PATTERNS: readonly [readonly string[], string][] = [
  [["COMMERCIAL", "COMBANK"], SRI_LANKA_BANK_CODES.COMMERCIAL],
  [["CEYLON", "BOC"], SRI_LANKA_BANK_CODES.BOC],
  [["PEOPLE", "PEOPLES"], SRI_LANKA_BANK_CODES.PEOPLES],
  [["SAMPATH"], SRI_LANKA_BANK_CODES.SAMPATH],
  [["HATTON", "HNB"], SRI_LANKA_BANK_CODES.HNB],
  [["NATIONS", "NTB"], SRI_LANKA_BANK_CODES.NTB],
  [["SEYLAN"], SRI_LANKA_BANK_CODES.SEYLAN],
  [["NDB", "NATIONAL DEVELOPMENT"], SRI_LANKA_BANK_CODES.NDB],
  [["DFCC"], SRI_LANKA_BANK_CODES.DFCC],
  [["UNION"], SRI_LANKA_BANK_CODES.UNION],
  [["AMANA"], SRI_LANKA_BANK_CODES.AMANA],
  [["PAN ASIA", "PABC"], SRI_LANKA_BANK_CODES.PABC],
  [["STANDARD CHARTERED", "SCB"], SRI_LANKA_BANK_CODES.STANDARD_CHARTERED],
  [["HSBC"], SRI_LANKA_BANK_CODES.HSBC],
  [["CARGILLS"], SRI_LANKA_BANK_CODES.CARGILLS],
  [["SAVINGS", "NSB"], SRI_LANKA_BANK_CODES.NSB],
];

/**
 * Resolves a 4-digit bank code from either a direct numeric code or known bank alias.
 */
export function resolveBankCode(bankInput: string): string | undefined {
  const trimmed = bankInput.trim().toUpperCase();

  if (/^\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  for (const [aliases, code] of BANK_ALIAS_PATTERNS) {
    if (aliases.some((alias) => trimmed.includes(alias) || trimmed === alias)) {
      return code;
    }
  }

  return undefined;
}

/**
 * Left-pads or validates a 4-digit bank code.
 */
export function padBankCode(code: string | number): string {
  const str = String(code).trim();
  const digits = str.replace(/\D/g, "");
  return digits.padStart(4, "0").slice(-4);
}

/**
 * Left-pads a 3-digit branch code (e.g. "1" -> "001", "42" -> "042").
 */
export function padBranchCode(code: string | number): string {
  const str = String(code).trim();
  const digits = str.replace(/\D/g, "");
  return digits.padStart(3, "0").slice(-3);
}

/**
 * Cleans non-alphanumeric characters and pads account number to required fixed width.
 */
export function padAccountNumber(accountNumber: string, targetLength = 12): string {
  const cleaned = accountNumber.trim().replace(/[^a-zA-Z0-9]/g, "");
  if (cleaned.length >= targetLength) {
    return cleaned;
  }
  return cleaned.padStart(targetLength, "0");
}

/**
 * Sanitizes beneficiary name to standard bank transfer uppercase ASCII without commas or quotes.
 */
export function sanitizeBeneficiaryName(name: string, maxLength = 30): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/["',;]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, maxLength)
    .trim();
}

// ============================================================================
// Validation Functions
// ============================================================================

function validateBasicTransferIdentifiers(
  item: EmployeeBankTransferItem,
): Result<void, DomainError> {
  if (!item.employeeId || item.employeeId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Employee ID cannot be empty");
  }

  if (!item.employeeName || item.employeeName.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Employee Name cannot be empty", {
      employeeId: item.employeeId,
    });
  }

  return ok(undefined);
}

function validateBankAndBranch(
  item: EmployeeBankTransferItem,
): Result<{ bankCode: string; branchCode: string }, DomainError> {
  const bankCode =
    resolveBankCode(item.destinationBankCode) || padBankCode(item.destinationBankCode);
  if (!/^\d{4}$/.test(bankCode) || bankCode === "0000") {
    return domainErr("VALIDATION_FAILED", "Invalid 4-digit destination bank code", {
      employeeId: item.employeeId,
      destinationBankCode: item.destinationBankCode,
    });
  }

  const branchCode = padBranchCode(item.destinationBranchCode);
  if (!/^\d{3}$/.test(branchCode)) {
    return domainErr("VALIDATION_FAILED", "Invalid 3-digit destination branch code", {
      employeeId: item.employeeId,
      destinationBranchCode: item.destinationBranchCode,
    });
  }

  return ok({ bankCode, branchCode });
}

function validateAmountAndAccount(item: EmployeeBankTransferItem): Result<string, DomainError> {
  const cleanedAcc = item.destinationAccountNumber.replace(/[^a-zA-Z0-9]/g, "");
  if (cleanedAcc.length < 6 || cleanedAcc.length > 20) {
    return domainErr(
      "VALIDATION_FAILED",
      "Destination account number must be between 6 and 20 alphanumeric characters",
      { employeeId: item.employeeId, destinationAccountNumber: item.destinationAccountNumber },
    );
  }

  if (
    typeof item.netPayLkr !== "number" ||
    !Number.isFinite(item.netPayLkr) ||
    item.netPayLkr <= 0
  ) {
    return domainErr("VALIDATION_FAILED", "Net disbursement amount must be a positive number", {
      employeeId: item.employeeId,
      netPayLkr: item.netPayLkr,
    });
  }

  if (!item.nicOrPassport || item.nicOrPassport.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Employee NIC or Passport number cannot be empty", {
      employeeId: item.employeeId,
    });
  }

  return ok(cleanedAcc);
}

export function validateTransferItem(
  item: EmployeeBankTransferItem,
): Result<EmployeeBankTransferItem, DomainError> {
  const idRes = validateBasicTransferIdentifiers(item);
  if (!idRes.ok) {
    return idRes;
  }

  const bankRes = validateBankAndBranch(item);
  if (!bankRes.ok) {
    return bankRes;
  }

  const accRes = validateAmountAndAccount(item);
  if (!accRes.ok) {
    return accRes;
  }

  return ok({
    ...item,
    destinationBankCode: bankRes.value.bankCode,
    destinationBranchCode: bankRes.value.branchCode,
    destinationAccountNumber: accRes.value,
    netPayLkr: roundLkr(item.netPayLkr),
  });
}

function validateOriginAccount(origin: OriginatingAccountProfile): Result<void, DomainError> {
  const originBank = padBankCode(origin.bankCode);
  if (!/^\d{4}$/.test(originBank) || originBank === "0000") {
    return domainErr("VALIDATION_FAILED", "Invalid 4-digit originating bank code", {
      bankCode: origin.bankCode,
    });
  }

  const originBranch = padBranchCode(origin.branchCode);
  if (!/^\d{3}$/.test(originBranch)) {
    return domainErr("VALIDATION_FAILED", "Invalid 3-digit originating branch code", {
      branchCode: origin.branchCode,
    });
  }

  if (!origin.accountNumber || origin.accountNumber.trim().length < 6) {
    return domainErr("VALIDATION_FAILED", "Originating bank account number is required", {
      accountNumber: origin.accountNumber,
    });
  }

  return ok(undefined);
}

function validateExportInput(
  input: BankSlipsExportInput,
): Result<readonly EmployeeBankTransferItem[], DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }

  if (!input.billingPeriod || input.billingPeriod.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Billing period is required (e.g. '2026-10')");
  }

  if (!input.paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) {
    return domainErr("VALIDATION_FAILED", "Valid payment date is required in YYYY-MM-DD format", {
      paymentDate: input.paymentDate,
    });
  }

  const originRes = validateOriginAccount(input.origin);
  if (!originRes.ok) {
    return originRes;
  }

  if (!Array.isArray(input.transfers) || input.transfers.length === 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least one employee transfer item is required for bank export",
    );
  }

  const validatedItems: EmployeeBankTransferItem[] = [];
  for (const item of input.transfers) {
    const itemRes = validateTransferItem(item);
    if (!itemRes.ok) {
      return itemRes;
    }
    validatedItems.push(itemRes.value);
  }

  return ok(validatedItems);
}

// ============================================================================
// Bank Specific CSV Formatters
// ============================================================================

/**
 * Standard LankaPay SLIPS / LankaClear bulk salary clearing format.
 */
function formatLankaPaySlipsStandard(
  origin: OriginatingAccountProfile,
  items: readonly EmployeeBankTransferItem[],
  paymentDate: string,
  totalAmountLkr: number,
  billingPeriod: string,
): string {
  const lines: string[] = [];
  const yyyymmdd = paymentDate.replace(/-/g, "");
  const totalCents = Math.round(totalAmountLkr * 100);

  // Header Record: H,OriginBank,OriginBranch,OriginAccount,CompanyName,ValueDate,TotalRecords,TotalCents
  const companyName = sanitizeBeneficiaryName(origin.companyName, 30);
  const originAcc = padAccountNumber(origin.accountNumber, 12);
  lines.push(
    `H,${padBankCode(origin.bankCode)},${padBranchCode(origin.branchCode)},${originAcc},"${companyName}",${yyyymmdd},${items.length},${totalCents}`,
  );

  // Detail Records: D,DestBank,DestBranch,DestAccount,BeneficiaryName,AmountCents,TxCode,NIC,Particulars,Reference
  const defaultParticulars = origin.particulars
    ? sanitizeBeneficiaryName(origin.particulars, 15)
    : `SAL ${billingPeriod}`;

  for (const item of items) {
    const benName = sanitizeBeneficiaryName(item.employeeName, 30);
    const destAcc = padAccountNumber(item.destinationAccountNumber, 12);
    const amountCents = Math.round(item.netPayLkr * 100);
    const ref = item.referenceNarrative
      ? sanitizeBeneficiaryName(item.referenceNarrative, 15)
      : item.employeeId;

    lines.push(
      `D,${item.destinationBankCode},${item.destinationBranchCode},${destAcc},"${benName}",${amountCents},23,"${item.nicOrPassport}","${defaultParticulars}","${ref}"`,
    );
  }

  return lines.join("\n");
}

/**
 * Commercial Bank of Ceylon PayMaster bulk payment CSV format.
 */
function formatComBankPayMaster(
  items: readonly EmployeeBankTransferItem[],
  billingPeriod: string,
  particulars?: string,
): string {
  const lines: string[] = [];
  lines.push(
    "Account_Number,Amount_LKR,Beneficiary_Name,Bank_Code,Branch_Code,Reference_No,Particulars",
  );

  const defaultPart = particulars
    ? sanitizeBeneficiaryName(particulars, 20)
    : `SALARY ${billingPeriod}`;

  for (const item of items) {
    const benName = sanitizeBeneficiaryName(item.employeeName, 30);
    const accNo = padAccountNumber(item.destinationAccountNumber, 12);
    const ref = item.referenceNarrative
      ? sanitizeBeneficiaryName(item.referenceNarrative, 15)
      : item.employeeId;

    lines.push(
      `${accNo},${item.netPayLkr.toFixed(2)},"${benName}",${item.destinationBankCode},${item.destinationBranchCode},"${ref}","${defaultPart}"`,
    );
  }

  return lines.join("\n");
}

/**
 * Sampath Bank Corporate Vishwa SLIPS CSV format.
 */
function formatSampathCorporateVishwa(
  items: readonly EmployeeBankTransferItem[],
  billingPeriod: string,
): string {
  const lines: string[] = [];
  lines.push("Beneficiary_Account,Beneficiary_Name,Bank_Code,Branch_Code,Amount,Remarks,NIC");

  for (const item of items) {
    const benName = sanitizeBeneficiaryName(item.employeeName, 30);
    const accNo = padAccountNumber(item.destinationAccountNumber, 12);
    lines.push(
      `${accNo},"${benName}",${item.destinationBankCode},${item.destinationBranchCode},${item.netPayLkr.toFixed(2)},"SALARY ${billingPeriod}","${item.nicOrPassport}"`,
    );
  }

  return lines.join("\n");
}

/**
 * Bank of Ceylon Corporate Bulk Salary transfer CSV format.
 */
function formatBocBulkSalary(
  items: readonly EmployeeBankTransferItem[],
  billingPeriod: string,
): string {
  const lines: string[] = [];
  lines.push("Bank_Code,Branch_Code,Account_No,Amount_LKR,Name,NIC,Particulars");

  for (const item of items) {
    const benName = sanitizeBeneficiaryName(item.employeeName, 30);
    const accNo = padAccountNumber(item.destinationAccountNumber, 12);
    lines.push(
      `${item.destinationBankCode},${item.destinationBranchCode},${accNo},${item.netPayLkr.toFixed(2)},"${benName}","${item.nicOrPassport}","SALARY ${billingPeriod}"`,
    );
  }

  return lines.join("\n");
}

/**
 * People's Bank Electronic Salary Clearing CSV format.
 */
function formatPeoplesBankSlips(
  items: readonly EmployeeBankTransferItem[],
  billingPeriod: string,
): string {
  const lines: string[] = [];
  lines.push(
    "Destination_Bank,Destination_Branch,Account_Number,Amount,Beneficiary_Name,Narration,NIC",
  );

  for (const item of items) {
    const benName = sanitizeBeneficiaryName(item.employeeName, 30);
    const accNo = padAccountNumber(item.destinationAccountNumber, 12);
    lines.push(
      `${item.destinationBankCode},${item.destinationBranchCode},${accNo},${item.netPayLkr.toFixed(2)},"${benName}","SALARY ${billingPeriod}","${item.nicOrPassport}"`,
    );
  }

  return lines.join("\n");
}

/**
 * Hatton National Bank (HNB) ApproveOnline bulk payment CSV format.
 */
function formatHnbApproveOnline(
  items: readonly EmployeeBankTransferItem[],
  billingPeriod: string,
): string {
  const lines: string[] = [];
  lines.push(
    "Bank_Code,Branch_Code,Account_Number,Amount,Beneficiary_Name,Payment_Details,Reference",
  );

  for (const item of items) {
    const benName = sanitizeBeneficiaryName(item.employeeName, 30);
    const accNo = padAccountNumber(item.destinationAccountNumber, 12);
    const ref = item.referenceNarrative
      ? sanitizeBeneficiaryName(item.referenceNarrative, 15)
      : item.employeeId;
    lines.push(
      `${item.destinationBankCode},${item.destinationBranchCode},${accNo},${item.netPayLkr.toFixed(2)},"${benName}","SALARY ${billingPeriod}","${ref}"`,
    );
  }

  return lines.join("\n");
}

/**
 * Dispatches CSV formatting based on the selected format type.
 */
function formatCsvContent(
  format: BankSlipsTransferFormat,
  origin: OriginatingAccountProfile,
  items: readonly EmployeeBankTransferItem[],
  paymentDate: string,
  totalAmountLkr: number,
  billingPeriod: string,
): string {
  switch (format) {
    case "COMMERCIAL_BANK_PAYMASTER":
      return formatComBankPayMaster(items, billingPeriod, origin.particulars);
    case "SAMPATH_CORPORATE_VISHWA":
      return formatSampathCorporateVishwa(items, billingPeriod);
    case "BOC_BULK_SALARY":
      return formatBocBulkSalary(items, billingPeriod);
    case "PEOPLES_BANK_SLIPS":
      return formatPeoplesBankSlips(items, billingPeriod);
    case "HNB_APPROVE_ONLINE":
      return formatHnbApproveOnline(items, billingPeriod);
    default:
      return formatLankaPaySlipsStandard(origin, items, paymentDate, totalAmountLkr, billingPeriod);
  }
}

// ============================================================================
// Primary Export Function & Audit Trail
// ============================================================================

/**
 * Creates cryptographically chained SHA-256 audit log entry for bulk bank salary export.
 */
export function createBankSlipsExportAuditEntry(
  tenantId: string,
  actorUserId: string,
  billingPeriod: string,
  totalCount: number,
  totalAmountLkr: number,
  format: BankSlipsTransferFormat,
  originatingAccount: string,
  isoTs = new Date().toISOString(),
  previousAuditHash?: string | undefined,
): Result<AuditLogEntry, DomainError> {
  const afterJson = JSON.stringify({
    billingPeriod,
    totalCount,
    totalAmountLkr,
    format,
    originatingAccount,
  });

  return createAuditEntry({
    tenantId,
    actorUserId,
    action: "EXPORT_BANK_SLIPS",
    entityType: "BankSlipsExport",
    entityId: `${billingPeriod}-${format}`,
    isoTs,
    afterJson,
    prevHash: previousAuditHash,
  });
}

/**
 * Generates Sri Lankan Commercial Bank Salary & Service Charge SLIPS Bulk Transfer CSV.
 *
 * Implements Step 437 (Phase 18.12) / Rung 3 & Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * - Formats employee bank code, branch code, account number, and net pay LKR into standard
 *   LankaPay SLIPS / CEFTS bulk salary CSV.
 * - Supports Commercial Bank PayMaster, Sampath Vishwa, BOC Bulk Salary, People's Bank, and HNB.
 * - Enforces 4-digit bank code, 3-digit branch code, and 12-digit account number padding.
 * - Validates tenant isolation, positive amounts, and generates SHA-256 chained immutable audit log.
 */
export function exportBankSlipsCsv(
  input: BankSlipsExportInput,
): Result<BankSlipsExportResult, DomainError> {
  const validatedRes = validateExportInput(input);
  if (!validatedRes.ok) {
    return validatedRes;
  }

  const validatedItems = validatedRes.value;
  let totalAmountLkr = 0;
  for (const item of validatedItems) {
    totalAmountLkr += item.netPayLkr;
  }
  totalAmountLkr = roundLkr(totalAmountLkr);

  const csvContent = formatCsvContent(
    input.format,
    input.origin,
    validatedItems,
    input.paymentDate,
    totalAmountLkr,
    input.billingPeriod,
  );

  const originatingAccount = `${padBankCode(input.origin.bankCode)}-${padBranchCode(input.origin.branchCode)}-${input.origin.accountNumber}`;

  const auditRes = createBankSlipsExportAuditEntry(
    input.tenantId,
    input.actorUserId ?? "system-finance-exporter",
    input.billingPeriod,
    validatedItems.length,
    totalAmountLkr,
    input.format,
    originatingAccount,
    input.isoTs ?? new Date().toISOString(),
    input.previousAuditHash,
  );
  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId: input.tenantId,
    billingPeriod: input.billingPeriod,
    paymentDate: input.paymentDate,
    format: input.format,
    totalCount: validatedItems.length,
    totalAmountLkr,
    originatingAccount,
    csvContent,
    auditEntry: auditRes.value,
  });
}
