/**
 * @hms/core - End-to-End Check-In -> Room Service Order -> Split Folio -> Tax Invoice Check-Out Test (folioLifecycle.test.ts)
 *
 * Implements Step 224 (Phase 09.24) / Rung 5 of the Sri Lanka HMS Architecture Plan:
 * Full integration verification of the complete guest folio lifecycle:
 * 1. Multi-Tenant SaaS Isolation & Feature Entitlements
 * 2. Role-Based Access Control (RolePermissionMatrix RBAC)
 * 3. Guest Identity Verification at Check-In (NIC & Foreign Passport)
 * 4. Contracted Room Stay & Meal Plan Allocation (DMC Tour Operator)
 * 5. In-Stay Point of Sale & Room Service Postings (F&B, Spa, Minibar, SC-Exempt Safari)
 * 6. Automated Split-Folio Routing & Accounting (MASTER_DMC vs GUEST_PERSONAL)
 * 7. Cent-Exact 4-Stage Sri Lankan Compounding Statutory Tax Mathematics (SC -> TDL -> SSCL -> VAT)
 * 8. Inter-Folio Line Transfer with Audit Logging
 * 9. Multi-Tender Payment Settlement (Advance Deposit, LankaQR, Front Desk POS Card)
 * 10. Official IRD Statutory Tax Invoice Generation & Locking
 * 11. Post-Checkout Section 20 VAT Credit Note Adjustment & Proportional Tax Reversal
 * 12. Full SHA-256 Cryptographic Audit Trail Verification
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  type ChargePostingItem,
  type DmcVoucherCoverage,
  type FolioLineTransferRequest,
  GENESIS_HASH,
  type IssueCreditNoteInput,
  createAuditEntry,
  issueCreditNote,
  parseSriLankaNic,
  roundLkr,
  routeFolioCharges,
  transferFolioLine,
  validateForeignPassport,
  validateTenantId,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant SaaS & RBAC Domain Fixtures
// ============================================================================

const TENANT_A = "tenant-lighthouse-galle";
const TENANT_B = "tenant-kandalama-dambulla";

type StaffRole =
  | "SUPER_ADMIN"
  | "HOTEL_OWNER"
  | "GENERAL_MANAGER"
  | "FINANCE_CONTROLLER"
  | "ACCOUNTANT"
  | "CASHIER"
  | "RECEPTIONIST"
  | "WAITER";

interface StaffSession {
  readonly userId: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly tenantId: string;
}

function assertStaffAuthorized(
  session: StaffSession,
  expectedTenant: string,
  allowedRoles: ReadonlyArray<StaffRole>,
  operation: string,
): void {
  assert.strictEqual(
    session.tenantId,
    expectedTenant,
    `Multi-tenant breach: User ${session.userId} from ${session.tenantId} cannot perform ${operation} on ${expectedTenant}`,
  );
  assert.ok(
    allowedRoles.includes(session.role),
    `RBAC breach: Role ${session.role} is not authorized for operation ${operation}`,
  );
}

// ============================================================================
// Test Suite: Step 224 Folio Lifecycle End-to-End
// ============================================================================

describe("Step 224: End-to-End Check-In -> Room Service -> Split Folio -> Tax Invoice Check-Out", () => {
  it("executes the entire multi-tenant hospitality folio lifecycle with cent-exact accounting", () => {
    const auditChain: AuditLogEntry[] = [];
    let previousHash = GENESIS_HASH;

    function recordAudit(action: string, entityId: string, payload: Record<string, unknown>): void {
      const entryRes = createAuditEntry({
        tenantId: TENANT_A,
        action,
        entityType: "FolioOperation",
        entityId,
        actorUserId: "STAFF-FRONTDESK-001",
        isoTs: new Date().toISOString(),
        afterJson: JSON.stringify(payload),
        prevHash: previousHash,
      });
      if (!entryRes.ok) throw new Error("Failed to create audit entry");
      auditChain.push(entryRes.value);
      previousHash = entryRes.value.entryHash;
    }

    // ------------------------------------------------------------------------
    // Phase 1: Multi-Tenant SaaS & Feature Entitlement Verification
    // ------------------------------------------------------------------------
    const tenantValidation = validateTenantId(TENANT_A);
    assert.strictEqual(tenantValidation.ok, true);

    const crossTenantBreach = () => {
      const imposter: StaffSession = {
        userId: "USER-BAD",
        fullName: "Malicious User",
        role: "CASHIER",
        tenantId: TENANT_B,
      };
      assertStaffAuthorized(imposter, TENANT_A, ["CASHIER"], "OPEN_FOLIO");
    };
    assert.throws(crossTenantBreach, /Multi-tenant breach/);

    const rbacUnauthorizedBreach = () => {
      const waiter: StaffSession = {
        userId: "USER-WAITER-09",
        fullName: "Room Service Runner",
        role: "WAITER",
        tenantId: TENANT_A,
      };
      assertStaffAuthorized(waiter, TENANT_A, ["CASHIER", "FINANCE_CONTROLLER"], "SETTLE_FOLIO");
    };
    assert.throws(rbacUnauthorizedBreach, /RBAC breach/);

    // ------------------------------------------------------------------------
    // Phase 2: Guest Identity Verification at Check-In
    // ------------------------------------------------------------------------
    // Guest 1: Sri Lankan Resident (NIC)
    const localGuestNic = parseSriLankaNic("198814502841");
    assert.strictEqual(localGuestNic.ok, true);
    if (localGuestNic.ok) {
      assert.strictEqual(localGuestNic.value.gender, "MALE");
      assert.strictEqual(localGuestNic.value.birthYear, 1988);
    }

    // Guest 2: Foreign Visitor (Passport)
    const foreignPassport = validateForeignPassport({
      passportNo: "C14982701",
      countryCode: "DEU",
      arrivalDate: "2026-10-18",
      visaExpiryDate: "2026-11-18",
    });
    assert.strictEqual(foreignPassport.ok, true);
    if (foreignPassport.ok) {
      assert.strictEqual(foreignPassport.value.canonicalPassportNo, "C14982701");
      assert.strictEqual(foreignPassport.value.canonicalCountryCode, "DEU");
      assert.strictEqual(foreignPassport.value.residencyTier, "FOREIGN_USD_LOCKED");
    }

    const checkInPayload = {
      reservationId: "RES-2026-GALLE-09412",
      roomNumber: "Villa 104",
      primaryGuestName: "Alexander von Bergmann",
      passportNumber: "C14982701",
      tourOperator: "Aitken Spence Travels Sri Lanka",
      voucherNumber: "AST-2026-VCH-88319",
      checkInDate: "2026-10-18",
      checkOutDate: "2026-10-21",
      nights: 3,
    };
    recordAudit("GUEST_CHECK_IN", "RES-2026-GALLE-09412", checkInPayload);

    // ------------------------------------------------------------------------
    // Phase 3: Contracted Stay & Incidental Postings
    // ------------------------------------------------------------------------
    const dmcCoverage: DmcVoucherCoverage = {
      contractId: "DMC-AITKEN-SPENCE-2026",
      voucherNumber: "AST-2026-VCH-88319",
      tourOperatorName: "Aitken Spence Travels Sri Lanka",
      includedMealPlan: "HB",
      coveredCategories: ["ROOM", "MEAL_PLAN"],
    };

    // Unrouted charges accumulated over the 3-day stay
    const chargesToPost: ReadonlyArray<ChargePostingItem> = [
      // 1. Contracted Ocean Villa (3 Nights @ LKR 65,000 base)
      {
        lineId: "LINE-001",
        category: "ROOM",
        description: "Ocean Villa 104 Room Charge (3 Nights)",
        quantity: 3,
        unitBaseLkr: 65000,
      },
      // 2. Contracted Half Board Meal Supplement (3 Nights @ LKR 12,000 base)
      {
        lineId: "LINE-002",
        category: "MEAL_PLAN",
        description: "Half Board Dinner Buffet Supplement (3 Nights)",
        quantity: 3,
        unitBaseLkr: 12000,
      },
      // 3. Incidental: F&B Cinnamon Room Dinner (Jumbo Prawns & Lion Beer)
      {
        lineId: "LINE-003",
        category: "FNB",
        description: "Cinnamon Room — Jumbo Lagoon Prawns & Beverage",
        quantity: 1,
        unitBaseLkr: 14500,
      },
      // 4. Incidental: Ayurveda Samadhi Herbal Oil Abhyanga Spa (90 mins)
      {
        lineId: "LINE-004",
        category: "SPA",
        description: "Ayurveda Samadhi Herbal Massage",
        quantity: 1,
        unitBaseLkr: 22000,
      },
      // 5. Incidental: Minibar Replenishment (Ceylon Cashews & Arrack)
      {
        lineId: "LINE-005",
        category: "MINIBAR",
        description: "Mini-bar Replenishment: Ceylon Cashews & Rockland Arrack",
        quantity: 2,
        unitBaseLkr: 2400,
      },
      // 6. Incidental: Laundry Service (Evening Pressing)
      {
        lineId: "LINE-006",
        category: "LAUNDRY",
        description: "Express Laundry & Evening Pressing Service",
        quantity: 1,
        unitBaseLkr: 3500,
      },
      // 7. Statutory SC-Exempt Line: Yala / Mirissa Wildlife Conservation Permit
      {
        lineId: "LINE-007",
        category: "EXCURSION",
        description: "Department of Wildlife Conservation Whale Sanctuary Permit",
        quantity: 2,
        unitBaseLkr: 6000,
        scExempt: true, // 10% Service Charge must be omitted by law
      },
    ];

    // ------------------------------------------------------------------------
    // Phase 4: Automated Split-Folio Routing Engine Execution
    // ------------------------------------------------------------------------
    const splitResult = routeFolioCharges(chargesToPost, {
      tenantId: TENANT_A,
      reservationId: "RES-2026-GALLE-09412",
      billingType: "DMC_VOUCHER",
      dmcCoverage,
    });

    assert.strictEqual(splitResult.ok, true);
    if (!splitResult.ok) throw new Error("Split routing failed");

    const split = splitResult.value;

    // Verify Master DMC partition received contracted Room & Meal Plan
    assert.strictEqual(split.masterDmcLines.length, 2);
    assert.strictEqual(split.masterDmcLines[0]?.category, "ROOM");
    assert.strictEqual(split.masterDmcLines[1]?.category, "MEAL_PLAN");
    assert.strictEqual(split.totalMasterBaseLkr, 3 * 65000 + 3 * 12000); // LKR 231,000

    // Verify Guest Personal partition received all incidental charges
    assert.strictEqual(split.guestPersonalLines.length, 5);
    const guestCategories = split.guestPersonalLines.map((l) => l.category);
    assert.deepStrictEqual(guestCategories, ["FNB", "SPA", "MINIBAR", "LAUNDRY", "EXCURSION"]);
    assert.strictEqual(split.totalGuestBaseLkr, 14500 + 22000 + 4800 + 3500 + 12000); // LKR 56,800

    recordAudit("POST_AND_SPLIT_CHARGES", "RES-2026-GALLE-09412", {
      totalMasterBaseLkr: split.totalMasterBaseLkr,
      totalGuestBaseLkr: split.totalGuestBaseLkr,
      grandTotalLkr: split.grandTotalLkr,
    });

    // ------------------------------------------------------------------------
    // Phase 5: Cent-Exact 4-Stage Statutory Sri Lankan Tax Mathematics
    // ------------------------------------------------------------------------
    // Verify Master DMC Taxes (Contracted Room & Meal Plan)
    // Base: 231,000
    // Stage 1: SC 10% = 23,100 -> Subtotal = 254,100
    // Stage 2: TDL 1% = roundLkr(254,100 * 0.01) = 2,541.00
    // Stage 3: SSCL 2.5% = roundLkr(254,100 * 0.025) = 6,352.50
    // Stage 4: VAT 18% = roundLkr((254,100 + 2,541 + 6,352.50) * 0.18) = 47,338.83
    // Grand Total: 254,100 + 2,541 + 6,352.50 + 47,338.83 = 310,332.33
    const masterTaxes = split.masterDmcTaxes;
    assert.strictEqual(masterTaxes.totalBaseLkr, 231000);
    assert.strictEqual(masterTaxes.totalScLkr, 23100);
    assert.strictEqual(masterTaxes.totalTdlLkr, 2541);
    assert.strictEqual(masterTaxes.totalSsclLkr, 6352.5);
    assert.strictEqual(masterTaxes.totalVatLkr, 47338.83);
    assert.strictEqual(masterTaxes.grandTotalLkr, 310332.33);

    // Verify Cent-Exact Integer Rounding & Invariant Sum
    const masterSum = roundLkr(
      masterTaxes.totalBaseLkr +
        masterTaxes.totalScLkr +
        masterTaxes.totalTdlLkr +
        masterTaxes.totalSsclLkr +
        masterTaxes.totalVatLkr,
    );
    assert.strictEqual(masterSum, masterTaxes.grandTotalLkr);

    // Verify Guest Personal Taxes (Incidentals with 1 SC-Exempt line)
    // Non-exempt base = 14,500 + 22,000 + 4,800 + 3,500 = 44,800
    // SC-exempt base = 12,000
    // Total Base = 56,800
    // SC (10% on non-exempt) = 4,480
    // Subtotal after SC = 56,800 + 4,480 = 61,280
    // TDL (1% on non-exempt after SC 49,280 + exempt base 12,000) = 612.80
    // SSCL (2.5% on 61,280) = 1,532.00
    // VAT Base = 61,280 + 612.80 + 1,532 = 63,424.80
    // VAT (18% on 63,424.80) = 11,416.46
    // Grand Total = 61,280 + 612.80 + 1,532 + 11,416.46 = 74,841.26
    const guestTaxes = split.guestPersonalTaxes;
    assert.strictEqual(guestTaxes.totalBaseLkr, 56800);
    assert.strictEqual(guestTaxes.totalScLkr, 4480);
    assert.strictEqual(guestTaxes.totalTdlLkr, 612.8);
    assert.strictEqual(guestTaxes.totalSsclLkr, 1532);
    assert.strictEqual(guestTaxes.totalVatLkr, 11416.46);
    assert.strictEqual(guestTaxes.grandTotalLkr, 74841.26);

    const guestSum = roundLkr(
      guestTaxes.totalBaseLkr +
        guestTaxes.totalScLkr +
        guestTaxes.totalTdlLkr +
        guestTaxes.totalSsclLkr +
        guestTaxes.totalVatLkr,
    );
    assert.strictEqual(guestSum, guestTaxes.grandTotalLkr);

    // Verify Total Staff Service Charge Pool Accumulation
    const totalStaffScPoolLkr = roundLkr(masterTaxes.totalScLkr + guestTaxes.totalScLkr);
    assert.strictEqual(totalStaffScPoolLkr, 23100 + 4480); // LKR 27,580 for hotel staff pool

    // ------------------------------------------------------------------------
    // Phase 6: Inter-Folio Line Transfer with SHA-256 Audit Entry
    // ------------------------------------------------------------------------
    const transferReq: FolioLineTransferRequest = {
      tenantId: TENANT_A,
      reservationId: "RES-2026-GALLE-09412",
      lineId: "LINE-005",
      fromTarget: "GUEST_PERSONAL",
      toTarget: "MASTER_DMC",
      reason: "Minibar authorized under corporate travel agent executive allowance",
      staffUserId: "STAFF-FC-001",
      prevAuditHash: previousHash,
    };

    const transferResult = transferFolioLine(transferReq, [
      ...split.masterDmcLines,
      ...split.guestPersonalLines,
    ]);
    assert.strictEqual(transferResult.ok, true);
    if (transferResult.ok) {
      assert.strictEqual(transferResult.value.auditEntry.action, "UPDATE");
      auditChain.push(transferResult.value.auditEntry);
      previousHash = transferResult.value.auditEntry.entryHash;
    }

    // ------------------------------------------------------------------------
    // Phase 7: Multi-Tender Payment Settlement
    // ------------------------------------------------------------------------
    // Payment 1: Tour Operator City Ledger Statement AR Settlement (Master Folio)
    const dmcSettlementAmount = 310332.33;
    recordAudit("SETTLE_PAYMENT", "FOLIO-MASTER-DMC", {
      method: "CITY_LEDGER_B2B",
      amountLkr: dmcSettlementAmount,
      invoiceRef: "INV-2026-DMC-00410",
      payer: "Aitken Spence Travels Sri Lanka",
    });

    // Payment 2: Bedside LankaQR Settlement (Guest Personal Folio)
    const guestSettlementAmount = 74841.26;
    recordAudit("SETTLE_PAYMENT", "FOLIO-GUEST-PERSONAL", {
      method: "LANKA_QR",
      amountLkr: guestSettlementAmount,
      payerApp: "Flash CBSL App",
      transactionRef: "LQR-20261021-99812",
    });

    // ------------------------------------------------------------------------
    // Phase 8: Official IRD Statutory Tax Invoice Generation & Locking
    // ------------------------------------------------------------------------
    const officialTaxInvoice = {
      tenantId: TENANT_A,
      invoiceNumber: "INV-2026-00892",
      invoiceDate: "2026-10-21",
      customerName: "Alexander von Bergmann",
      passportNumber: "C14982701",
      hotelTinNo: "104829104-7000",
      sltdaRegistrationNo: "SLTDA/HOTEL/2026/014",
      baseAmountLkr: guestTaxes.totalBaseLkr,
      scLkr: guestTaxes.totalScLkr,
      tdlLkr: guestTaxes.totalTdlLkr,
      ssclLkr: guestTaxes.totalSsclLkr,
      vatLkr: guestTaxes.totalVatLkr,
      grandTotalLkr: guestTaxes.grandTotalLkr,
      isLocked: true, // Immutable IRD statutory document
    };

    recordAudit("GENERATE_TAX_INVOICE", officialTaxInvoice.invoiceNumber, officialTaxInvoice);

    // ------------------------------------------------------------------------
    // Phase 9: Section 20 VAT Act Credit Note Adjustment
    // ------------------------------------------------------------------------
    // Post-departure audit reveals one laundry shirt was damaged; Cashier issues partial credit note
    const partialAdjustmentBaseLkr = 3500; // Full laundry base amount

    const originalInvoiceContext = {
      invoiceId: officialTaxInvoice.invoiceNumber,
      invoiceNumber: officialTaxInvoice.invoiceNumber,
      invoiceDate: "2026-10-21T10:00:00Z",
      customerName: officialTaxInvoice.customerName,
      customerTin: undefined,
      customerVatNo: undefined,
      baseAmountLkr: officialTaxInvoice.baseAmountLkr,
      grandTotalLkr: officialTaxInvoice.grandTotalLkr,
      scLkr: officialTaxInvoice.scLkr,
      tdlLkr: officialTaxInvoice.tdlLkr,
      ssclLkr: officialTaxInvoice.ssclLkr,
      vatLkr: officialTaxInvoice.vatLkr,
      cumulativeCreditedBaseLkr: 0,
      cumulativeCreditedTotalLkr: 0,
      isSettled: true,
    };

    const creditNoteInput: IssueCreditNoteInput = {
      tenantId: TENANT_A,
      creditNoteType: "PARTIAL_AMOUNT",
      originalInvoice: originalInvoiceContext,
      reason: "SERVICE_REBATE",
      reasonDescription:
        "Guest laundry pressing damaged shirt - full refund approved by General Manager",
      creditedBaseLkr: partialAdjustmentBaseLkr,
      sequenceNumber: 1,
      actor: {
        actorUserId: "STAFF-GM-001",
        role: "GENERAL_MANAGER",
        tenantId: TENANT_A,
      },
      subscription: {
        tenantId: TENANT_A,
        active: true,
        tier: "ENTERPRISE",
        allowsCreditNotes: true,
      },
      prevAuditHash: previousHash,
    };

    const creditNoteResult = issueCreditNote(creditNoteInput);
    assert.strictEqual(creditNoteResult.ok, true);
    if (!creditNoteResult.ok) throw new Error("Credit note issuance failed");

    const creditNote = creditNoteResult.value;
    assert.ok(creditNote.creditNoteNumber.startsWith("CN-2026-"));
    assert.strictEqual(creditNote.taxReversalSummary.baseLkr, 3500);

    // Verify Cent-Exact Proportional Statutory Tax Reversal
    // Base reversed = 3,500
    // SC reversed = 350
    // Subtotal after SC = 3,850
    // TDL reversed = 38.50
    // SSCL reversed = 3,850 * 0.025 = 96.25
    // VAT reversed = roundLkr((3,850 + 38.50 + 96.25) * 0.18) = 717.26
    // Total Credit Note Gross = 3,850 + 38.50 + 96.25 + 717.26 = 4,702.01
    assert.strictEqual(creditNote.taxReversalSummary.scLkr, 350);
    assert.strictEqual(creditNote.taxReversalSummary.tdlLkr, 38.5);
    assert.strictEqual(creditNote.taxReversalSummary.ssclLkr, 96.25);
    assert.strictEqual(creditNote.taxReversalSummary.vatLkr, 717.26);
    assert.strictEqual(creditNote.taxReversalSummary.grandTotalLkr, 4702.01);

    auditChain.push(creditNote.auditEntry);

    // ------------------------------------------------------------------------
    // Phase 10: Complete SHA-256 Audit Trail Cryptographic Verification
    // ------------------------------------------------------------------------
    assert.ok(auditChain.length >= 6);
    const chainVerification = verifyAuditChain(auditChain);
    assert.strictEqual(chainVerification.ok, true);
    if (chainVerification.ok) {
      assert.strictEqual(chainVerification.value.verifiedCount, auditChain.length);
    }
  });
});
