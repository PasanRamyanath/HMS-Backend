/**
 * @hms/core - Sri Lankan Statutory Credit Note & Tax Invoice Adjustment Engine.
 *
 * Implements Section 20 of the Value Added Tax (VAT) Act No. 14 of 2002 as amended
 * and Inland Revenue Department (IRD) regulations:
 *
 * Statutory Invariants:
 * 1. Locked Tax Invoices are immutable and can NEVER be deleted or mutated.
 * 2. Downward adjustments, rate corrections, disputes, or voids MUST be executed
 *    via sequential Credit Notes (`CN-<year>-<sequenceNumber>`).
 * 3. Proportional 4-stage compounding statutory tax reversal:
 *    reverses exact cent-level SC (10%), TDL (1%), SSCL (2.5%), and VAT (18%).
 * 4. Multi-Tenant SaaS isolation, RBAC role guard, and SaasSubscription entitlement checks.
 * 5. Cryptographic SHA-256 hash-chained ImmutableAuditLog entry for tamper-proof audit trails.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type CreditNoteReason =
  | "BILLING_DISPUTE"
  | "RATE_OVERCHARGE"
  | "SERVICE_REBATE"
  | "POST_CHECKOUT_REVERSAL"
  | "ROOM_CANCELLATION"
  | "FULL_INVOICE_VOID"
  | "COMMERCIAL_DISCOUNT";

export type CreditNoteType = "FULL_VOID" | "PARTIAL_AMOUNT" | "LINE_ITEM_REVERSAL";

export interface CreditNoteLineItem {
  readonly lineId: string;
  readonly originalInvoiceLineId?: string | undefined;
  readonly description: string;
  readonly department: string;
  readonly baseReversedLkr: number;
  readonly scReversedLkr: number;
  readonly tdlReversedLkr: number;
  readonly ssclReversedLkr: number;
  readonly vatReversedLkr: number;
  readonly totalReversedLkr: number;
}

export interface CreditNoteTaxSummary {
  readonly baseLkr: number;
  readonly scLkr: number;
  readonly subtotalAfterScLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatBaseLkr: number;
  readonly vatLkr: number;
  readonly grandTotalLkr: number;
  readonly effectiveTaxRate: number;
  readonly isVatRegistered: boolean;
}

export interface OriginalInvoiceContext {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly invoiceDate: string;
  readonly customerName: string;
  readonly customerTin?: string | undefined;
  readonly customerVatNo?: string | undefined;
  readonly baseAmountLkr: number;
  readonly grandTotalLkr: number;
  readonly scLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatLkr: number;
  readonly cumulativeCreditedBaseLkr: number;
  readonly cumulativeCreditedTotalLkr: number;
  readonly isSettled: boolean;
}

export interface CreditNoteStaffActor {
  readonly actorUserId: string;
  readonly role: string;
  readonly tenantId: string;
}

export interface CreditNoteSaasSubscription {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowsCreditNotes?: boolean | undefined;
}

export interface IssueCreditNoteInput {
  readonly tenantId: string;
  readonly creditNoteType: CreditNoteType;
  readonly originalInvoice: OriginalInvoiceContext;
  readonly reason: CreditNoteReason;
  readonly reasonDescription: string;
  readonly creditedBaseLkr?: number | undefined;
  readonly creditedLines?:
    | ReadonlyArray<{
        readonly lineId: string;
        readonly originalInvoiceLineId?: string | undefined;
        readonly description: string;
        readonly department: string;
        readonly baseAmountLkr: number;
      }>
    | undefined;
  readonly sequenceNumber: number;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
  readonly actor: CreditNoteStaffActor;
  readonly subscription?: CreditNoteSaasSubscription | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface CreditNote {
  readonly tenantId: string;
  readonly creditNoteId: string;
  readonly creditNoteNumber: string;
  readonly originalInvoiceId: string;
  readonly originalInvoiceNumber: string;
  readonly creditNoteType: CreditNoteType;
  readonly reason: CreditNoteReason;
  readonly reasonDescription: string;
  readonly issuedAt: string;
  readonly issuedByUserId: string;
  readonly issuedByRole: string;
  readonly lines: ReadonlyArray<CreditNoteLineItem>;
  readonly taxReversalSummary: CreditNoteTaxSummary;
  readonly remainingInvoiceBalanceLkr: number;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Authorization & Entitlement Constants & Helpers
// ============================================================================

export const AUTHORIZED_CREDIT_NOTE_ROLES: ReadonlyArray<string> = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "FINANCE_CONTROLLER",
  "ACCOUNTANT",
];

export function validateCreditNoteAuthorization(
  actor: CreditNoteStaffActor,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match operation tenant '${expectedTenantId}'`,
      { actorTenantId: actor.tenantId, expectedTenantId },
    );
  }

  if (!AUTHORIZED_CREDIT_NOTE_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized to issue statutory Credit Notes. Requires Manager or Finance approval.`,
      { role: actor.role, authorizedRoles: AUTHORIZED_CREDIT_NOTE_ROLES },
    );
  }

  return ok(undefined);
}

export function validateCreditNoteSubscription(
  sub: CreditNoteSaasSubscription | undefined,
  expectedTenantId: string,
): Result<void, DomainError> {
  if (!sub) {
    return ok(undefined); // Standalone or default allowed
  }

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

  if (sub.allowsCreditNotes === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "Statutory Credit Note generation is not entitled under the current SaaS plan",
      { tier: sub.tier },
    );
  }

  return ok(undefined);
}

// ============================================================================
// Pure Calculation Helpers (Cognitive Complexity <= 12)
// ============================================================================

export function generateCreditNoteNumber(year: number, sequenceNumber: number): string {
  const seqPadded = String(Math.max(1, Math.floor(sequenceNumber))).padStart(5, "0");
  return `CN-${year}-${seqPadded}`;
}

export function calculateProportionalTaxReversal(
  baseToReverseLkr: number,
  config: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
): Result<CreditNoteTaxSummary, DomainError> {
  if (!Number.isFinite(baseToReverseLkr) || baseToReverseLkr <= 0) {
    return domainErr("VALIDATION_FAILED", "Credit base amount must be greater than 0 LKR", {
      baseToReverseLkr,
    });
  }

  const taxResult = calculateForwardTax(baseToReverseLkr, config);
  if (!taxResult.ok) {
    return taxResult;
  }

  const t: TaxBreakdownResult = taxResult.value;
  return ok({
    baseLkr: t.baseLkr,
    scLkr: t.scLkr,
    subtotalAfterScLkr: t.subtotalAfterScLkr,
    tdlLkr: t.tdlLkr,
    ssclLkr: t.ssclLkr,
    vatBaseLkr: t.vatBaseLkr,
    vatLkr: t.vatLkr,
    grandTotalLkr: t.grandTotalLkr,
    effectiveTaxRate: t.effectiveTaxRate,
    isVatRegistered: t.isVatRegistered,
  });
}

function resolveLineItemsBase(
  lines: ReadonlyArray<{ lineId: string; baseAmountLkr: number }> | undefined,
): Result<number, DomainError> {
  if (!lines || lines.length === 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least one line item must be supplied for LINE_ITEM_REVERSAL",
    );
  }
  let lineTotal = 0;
  for (const line of lines) {
    if (!Number.isFinite(line.baseAmountLkr) || line.baseAmountLkr <= 0) {
      return domainErr(
        "VALIDATION_FAILED",
        `Line item '${line.lineId}' has an invalid base amount`,
        { line },
      );
    }
    lineTotal += line.baseAmountLkr;
  }
  return ok(roundLkr(lineTotal));
}

function resolveCreditedBaseAmount(input: IssueCreditNoteInput): Result<number, DomainError> {
  const inv = input.originalInvoice;

  if (input.creditNoteType === "FULL_VOID") {
    const uncreditedBase = roundLkr(inv.baseAmountLkr - inv.cumulativeCreditedBaseLkr);
    if (uncreditedBase <= 0) {
      return domainErr(
        "INVOICE_ALREADY_CREDITED",
        "Original tax invoice has already been fully credited and cannot be voided again",
        { invoiceId: inv.invoiceId, cumulativeCreditedBaseLkr: inv.cumulativeCreditedBaseLkr },
      );
    }
    return ok(uncreditedBase);
  }

  if (input.creditNoteType === "LINE_ITEM_REVERSAL") {
    return resolveLineItemsBase(input.creditedLines);
  }

  // PARTIAL_AMOUNT
  if (!input.creditedBaseLkr || input.creditedBaseLkr <= 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "creditedBaseLkr must be greater than 0 for PARTIAL_AMOUNT credit notes",
    );
  }
  return ok(roundLkr(input.creditedBaseLkr));
}

function buildCreditNoteLines(
  input: IssueCreditNoteInput,
  taxSummary: CreditNoteTaxSummary,
  taxConfig: SriLankaTaxConfig,
): ReadonlyArray<CreditNoteLineItem> {
  if (input.creditNoteType === "LINE_ITEM_REVERSAL" && input.creditedLines) {
    return input.creditedLines.map((line) => {
      const lineTax = calculateProportionalTaxReversal(line.baseAmountLkr, taxConfig);
      const lt = lineTax.ok ? lineTax.value : taxSummary;
      return {
        lineId: line.lineId,
        originalInvoiceLineId: line.originalInvoiceLineId,
        description: line.description,
        department: line.department,
        baseReversedLkr: lt.baseLkr,
        scReversedLkr: lt.scLkr,
        tdlReversedLkr: lt.tdlLkr,
        ssclReversedLkr: lt.ssclLkr,
        vatReversedLkr: lt.vatLkr,
        totalReversedLkr: lt.grandTotalLkr,
      };
    });
  }

  return [
    {
      lineId: `CN-LINE-${input.sequenceNumber}-01`,
      description: input.reasonDescription,
      department: "FRONT_OFFICE",
      baseReversedLkr: taxSummary.baseLkr,
      scReversedLkr: taxSummary.scLkr,
      tdlReversedLkr: taxSummary.tdlLkr,
      ssclReversedLkr: taxSummary.ssclLkr,
      vatReversedLkr: taxSummary.vatLkr,
      totalReversedLkr: taxSummary.grandTotalLkr,
    },
  ];
}

// ============================================================================
// Core Execution Function: issueCreditNote
// ============================================================================

export function issueCreditNote(input: IssueCreditNoteInput): Result<CreditNote, DomainError> {
  // 1. Validate Tenant ID
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const tenantId = tenantRes.value;

  // 2. Validate Role Authorization
  const authRes = validateCreditNoteAuthorization(input.actor, tenantId);
  if (!authRes.ok) {
    return authRes;
  }

  // 3. Validate SaaS Subscription
  const subRes = validateCreditNoteSubscription(input.subscription, tenantId);
  if (!subRes.ok) {
    return subRes;
  }

  // 4. Validate Reason Description
  if (!input.reasonDescription || input.reasonDescription.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "Credit note reason description is mandatory");
  }

  // 5. Resolve Base Amount To Reverse
  const baseRes = resolveCreditedBaseAmount(input);
  if (!baseRes.ok) {
    return baseRes;
  }
  const baseToReverseLkr = baseRes.value;

  // 6. Check Credit Limit Against Original Invoice
  const inv = input.originalInvoice;
  const currentTotalCreditedBase = roundLkr(inv.cumulativeCreditedBaseLkr + baseToReverseLkr);
  if (currentTotalCreditedBase > inv.baseAmountLkr + 0.01) {
    return domainErr(
      "CREDIT_LIMIT_EXCEEDED",
      `Credited base ${currentTotalCreditedBase} LKR exceeds original invoice base amount ${inv.baseAmountLkr} LKR`,
      {
        originalBaseLkr: inv.baseAmountLkr,
        cumulativeCreditedBaseLkr: inv.cumulativeCreditedBaseLkr,
        attemptedBaseLkr: baseToReverseLkr,
      },
    );
  }

  // 7. Calculate Proportional Tax Reversals
  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const taxReversalRes = calculateProportionalTaxReversal(baseToReverseLkr, taxConfig);
  if (!taxReversalRes.ok) {
    return taxReversalRes;
  }
  const taxReversalSummary = taxReversalRes.value;

  // 8. Construct Identifiers
  const now = input.timestamp ?? new Date().toISOString();
  const year = new Date(now).getUTCFullYear();
  const creditNoteNumber = generateCreditNoteNumber(year, input.sequenceNumber);
  const creditNoteId = `CN#${creditNoteNumber}`;

  // 9. Build Line Items
  const lines = buildCreditNoteLines(input, taxReversalSummary, taxConfig);

  // 10. Compute Remaining Invoice Balance
  const totalCreditedSoFar = roundLkr(
    inv.cumulativeCreditedTotalLkr + taxReversalSummary.grandTotalLkr,
  );
  const remainingInvoiceBalanceLkr = roundLkr(Math.max(0, inv.grandTotalLkr - totalCreditedSoFar));

  // 11. Append SHA-256 Hash-Chained Audit Log Record
  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.actor.actorUserId,
    action: "CREDIT_NOTE_ISSUED",
    entityType: "CreditNote",
    entityId: creditNoteId,
    isoTs: now,
    prevHash: input.prevAuditHash,
    afterJson: JSON.stringify({
      creditNoteNumber,
      originalInvoiceId: inv.invoiceId,
      originalInvoiceNumber: inv.invoiceNumber,
      creditNoteType: input.creditNoteType,
      reason: input.reason,
      taxReversalSummary,
      remainingInvoiceBalanceLkr,
    }),
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId,
    creditNoteId,
    creditNoteNumber,
    originalInvoiceId: inv.invoiceId,
    originalInvoiceNumber: inv.invoiceNumber,
    creditNoteType: input.creditNoteType,
    reason: input.reason,
    reasonDescription: input.reasonDescription.trim(),
    issuedAt: now,
    issuedByUserId: input.actor.actorUserId,
    issuedByRole: input.actor.role,
    lines,
    taxReversalSummary,
    remainingInvoiceBalanceLkr,
    auditEntry: auditRes.value,
  });
}
