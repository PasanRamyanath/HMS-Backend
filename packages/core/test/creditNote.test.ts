import assert from "node:assert";
import { describe, it } from "node:test";
import {
  AUTHORIZED_CREDIT_NOTE_ROLES,
  type CreditNoteLineItem,
  type CreditNoteReason,
  type CreditNoteSaasSubscription,
  type CreditNoteStaffActor,
  type CreditNoteTaxSummary,
  type CreditNoteType,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type IssueCreditNoteInput,
  type OriginalInvoiceContext,
  calculateForwardTax,
  calculateProportionalTaxReversal,
  computeAuditEntryHash,
  generateCreditNoteNumber,
  issueCreditNote,
  validateCreditNoteAuthorization,
  validateCreditNoteSubscription,
} from "../src/index.js";

describe("Step 215 & 216: Credit Note & Sri Lankan Statutory Tax Reversal Engine", () => {
  const mockInvoice: OriginalInvoiceContext = {
    invoiceId: "INV-2026-00410",
    invoiceNumber: "INV-2026-00410",
    invoiceDate: "2026-10-15T12:00:00Z",
    customerName: "Aitken Spence Travels (Pvt) Ltd",
    customerTin: "101928374",
    customerVatNo: "101928374-7000",
    baseAmountLkr: 100000,
    grandTotalLkr: 134343,
    scLkr: 10000,
    tdlLkr: 1100,
    ssclLkr: 2750,
    vatLkr: 20493,
    cumulativeCreditedBaseLkr: 0,
    cumulativeCreditedTotalLkr: 0,
    isSettled: true,
  };

  const mockActor: CreditNoteStaffActor = {
    actorUserId: "USR-FC-01",
    role: "FINANCE_CONTROLLER",
    tenantId: "cinnamon-grand-cmb",
  };

  const mockSubscription: CreditNoteSaasSubscription = {
    tenantId: "cinnamon-grand-cmb",
    active: true,
    tier: "ENTERPRISE",
    allowsCreditNotes: true,
  };

  describe("1. Sequential Number Generator (generateCreditNoteNumber)", () => {
    it("formats sequential credit note reference numbers correctly", () => {
      assert.strictEqual(generateCreditNoteNumber(2026, 1), "CN-2026-00001");
      assert.strictEqual(generateCreditNoteNumber(2026, 42), "CN-2026-00042");
      assert.strictEqual(generateCreditNoteNumber(2026, 99999), "CN-2026-99999");
      assert.strictEqual(generateCreditNoteNumber(2026, -5), "CN-2026-00001");
    });
  });

  describe("2. Proportional 4-Stage Statutory Tax Reversal (calculateProportionalTaxReversal)", () => {
    it("computes exact cent-level reversal of SC (10%), TDL (1%), SSCL (2.5%), and VAT (18%)", () => {
      // 100,000 LKR base reversal:
      // SC = 10,000
      // Subtotal = 110,000
      // TDL = 1,100
      // SSCL = 2,750
      // VAT Base = 113,850
      // VAT (18%) = 20,493.00
      // Total Reversal = 134,343.00
      const res = calculateProportionalTaxReversal(100000, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.ok(res.ok);
      const s = res.value;

      assert.strictEqual(s.baseLkr, 100000);
      assert.strictEqual(s.scLkr, 10000);
      assert.strictEqual(s.subtotalAfterScLkr, 110000);
      assert.strictEqual(s.tdlLkr, 1100);
      assert.strictEqual(s.ssclLkr, 2750);
      assert.strictEqual(s.vatBaseLkr, 113850);
      assert.strictEqual(s.vatLkr, 20493);
      assert.strictEqual(s.grandTotalLkr, 134343);
      assert.strictEqual(s.isVatRegistered, true);
    });

    it("matches forward tax engine calculations perfectly", () => {
      const fwd = calculateForwardTax(45000, DEFAULT_SRI_LANKA_TAX_CONFIG);
      const rev = calculateProportionalTaxReversal(45000, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.ok(fwd.ok && rev.ok);
      assert.strictEqual(rev.value.grandTotalLkr, fwd.value.grandTotalLkr);
      assert.strictEqual(rev.value.vatLkr, fwd.value.vatLkr);
      assert.strictEqual(rev.value.ssclLkr, fwd.value.ssclLkr);
    });

    it("rejects non-positive or non-finite base supply amounts", () => {
      assert.strictEqual(calculateProportionalTaxReversal(0).ok, false);
      assert.strictEqual(calculateProportionalTaxReversal(-500).ok, false);
      assert.strictEqual(calculateProportionalTaxReversal(Number.NaN).ok, false);
    });
  });

  describe("3. Multi-Tenant Isolation & Role Authorization", () => {
    it("allows authorized finance roles to issue credit notes", () => {
      for (const role of AUTHORIZED_CREDIT_NOTE_ROLES) {
        const auth = validateCreditNoteAuthorization(
          { actorUserId: "USR-01", role, tenantId: "cinnamon-grand-cmb" },
          "cinnamon-grand-cmb",
        );
        assert.ok(auth.ok, `Expected role '${role}' to be authorized`);
      }
    });

    it("rejects unauthorized staff roles with PERMISSION_DENIED", () => {
      const unauthorized = ["FRONT_DESK_AGENT", "WAITER", "HOUSEKEEPER", "CHEF", "SECURITY"];
      for (const role of unauthorized) {
        const auth = validateCreditNoteAuthorization(
          { actorUserId: "USR-02", role, tenantId: "cinnamon-grand-cmb" },
          "cinnamon-grand-cmb",
        );
        assert.strictEqual(auth.ok, false);
        if (!auth.ok) {
          assert.strictEqual(auth.error.code, "PERMISSION_DENIED");
        }
      }
    });

    it("rejects actor tenant mismatch with TENANT_MISMATCH", () => {
      const auth = validateCreditNoteAuthorization(
        { actorUserId: "USR-01", role: "FINANCE_CONTROLLER", tenantId: "other-resort" },
        "cinnamon-grand-cmb",
      );
      assert.strictEqual(auth.ok, false);
      if (!auth.ok) {
        assert.strictEqual(auth.error.code, "TENANT_MISMATCH");
      }
    });
  });

  describe("4. SaaS Subscription Entitlements", () => {
    it("allows active subscription with credit note entitlement", () => {
      const sub = validateCreditNoteSubscription(mockSubscription, "cinnamon-grand-cmb");
      assert.ok(sub.ok);
    });

    it("rejects inactive subscription with SUBSCRIPTION_INACTIVE", () => {
      const sub = validateCreditNoteSubscription(
        { ...mockSubscription, active: false },
        "cinnamon-grand-cmb",
      );
      assert.strictEqual(sub.ok, false);
      if (!sub.ok) {
        assert.strictEqual(sub.error.code, "SUBSCRIPTION_INACTIVE");
      }
    });

    it("rejects subscription without credit note feature with PLAN_LIMITATION", () => {
      const sub = validateCreditNoteSubscription(
        { ...mockSubscription, allowsCreditNotes: false },
        "cinnamon-grand-cmb",
      );
      assert.strictEqual(sub.ok, false);
      if (!sub.ok) {
        assert.strictEqual(sub.error.code, "PLAN_LIMITATION");
      }
    });
  });

  describe("5. Full Invoice Void Workflow (creditNoteType = FULL_VOID)", () => {
    it("reverses 100% of the invoice and zeros out remaining balance", () => {
      const input: IssueCreditNoteInput = {
        tenantId: "cinnamon-grand-cmb",
        creditNoteType: "FULL_VOID",
        originalInvoice: mockInvoice,
        reason: "FULL_INVOICE_VOID",
        reasonDescription:
          "Guest disputed complete charge post-checkout due to booking cancellation",
        sequenceNumber: 1,
        actor: mockActor,
        subscription: mockSubscription,
        timestamp: "2026-10-19T14:00:00Z",
      };

      const result = issueCreditNote(input);
      assert.ok(result.ok);
      const cn = result.value;

      assert.strictEqual(cn.creditNoteNumber, "CN-2026-00001");
      assert.strictEqual(cn.originalInvoiceId, "INV-2026-00410");
      assert.strictEqual(cn.creditNoteType, "FULL_VOID");
      assert.strictEqual(cn.reason, "FULL_INVOICE_VOID");
      assert.strictEqual(cn.taxReversalSummary.baseLkr, 100000);
      assert.strictEqual(cn.taxReversalSummary.grandTotalLkr, 134343);
      assert.strictEqual(cn.remainingInvoiceBalanceLkr, 0);

      // Verify Audit Log Entry
      assert.strictEqual(cn.auditEntry.action, "CREDIT_NOTE_ISSUED");
      assert.strictEqual(cn.auditEntry.entityType, "CreditNote");
      assert.strictEqual(cn.auditEntry.entityId, "CN#CN-2026-00001");
    });

    it("rejects full void if invoice is already fully credited", () => {
      const fullyCreditedInvoice: OriginalInvoiceContext = {
        ...mockInvoice,
        cumulativeCreditedBaseLkr: 100000,
        cumulativeCreditedTotalLkr: 134343,
      };

      const input: IssueCreditNoteInput = {
        tenantId: "cinnamon-grand-cmb",
        creditNoteType: "FULL_VOID",
        originalInvoice: fullyCreditedInvoice,
        reason: "FULL_INVOICE_VOID",
        reasonDescription: "Attempt to void again",
        sequenceNumber: 2,
        actor: mockActor,
        subscription: mockSubscription,
      };

      const result = issueCreditNote(input);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error.code, "INVOICE_ALREADY_CREDITED");
      }
    });
  });

  describe("6. Partial Amount Credit Note Workflow (creditNoteType = PARTIAL_AMOUNT)", () => {
    it("computes exact proportional tax reversal for a partial refund", () => {
      // Original base 100,000; refund 20,000 base
      // 20,000 base:
      // SC = 2,000
      // Subtotal = 22,000
      // TDL = 220
      // SSCL = 550
      // VAT Base = 22,770
      // VAT (18%) = 4,098.60
      // Grand Total = 26,868.60
      const input: IssueCreditNoteInput = {
        tenantId: "cinnamon-grand-cmb",
        creditNoteType: "PARTIAL_AMOUNT",
        originalInvoice: mockInvoice,
        reason: "SERVICE_REBATE",
        reasonDescription: "AC maintenance inconvenience rebate of 20,000 LKR base",
        creditedBaseLkr: 20000,
        sequenceNumber: 2,
        actor: mockActor,
        subscription: mockSubscription,
      };

      const result = issueCreditNote(input);
      assert.ok(result.ok);
      const cn = result.value;

      assert.strictEqual(cn.creditNoteNumber, "CN-2026-00002");
      assert.strictEqual(cn.taxReversalSummary.baseLkr, 20000);
      assert.strictEqual(cn.taxReversalSummary.scLkr, 2000);
      assert.strictEqual(cn.taxReversalSummary.tdlLkr, 220);
      assert.strictEqual(cn.taxReversalSummary.ssclLkr, 550);
      assert.strictEqual(cn.taxReversalSummary.vatLkr, 4098.6);
      assert.strictEqual(cn.taxReversalSummary.grandTotalLkr, 26868.6);

      // Remaining invoice balance: 134,343 - 26,868.60 = 107,474.40
      assert.strictEqual(cn.remainingInvoiceBalanceLkr, 107474.4);
    });

    it("rejects credit note if cumulative credit exceeds invoice base", () => {
      const partiallyCreditedInvoice: OriginalInvoiceContext = {
        ...mockInvoice,
        cumulativeCreditedBaseLkr: 85000,
        cumulativeCreditedTotalLkr: 114191.55,
      };

      // Attempt to credit 20,000 base when only 15,000 base remains
      const input: IssueCreditNoteInput = {
        tenantId: "cinnamon-grand-cmb",
        creditNoteType: "PARTIAL_AMOUNT",
        originalInvoice: partiallyCreditedInvoice,
        reason: "COMMERCIAL_DISCOUNT",
        reasonDescription: "Late booking discount",
        creditedBaseLkr: 20000,
        sequenceNumber: 3,
        actor: mockActor,
        subscription: mockSubscription,
      };

      const result = issueCreditNote(input);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error.code, "CREDIT_LIMIT_EXCEEDED");
      }
    });
  });

  describe("7. Line Item Reversal Workflow (creditNoteType = LINE_ITEM_REVERSAL)", () => {
    it("reverses specified line items with individual line tax breakdowns", () => {
      const input: IssueCreditNoteInput = {
        tenantId: "cinnamon-grand-cmb",
        creditNoteType: "LINE_ITEM_REVERSAL",
        originalInvoice: mockInvoice,
        reason: "RATE_OVERCHARGE",
        reasonDescription: "Incorrect minibar and laundry posting reversal",
        creditedLines: [
          {
            lineId: "CN-LINE-MINIBAR",
            originalInvoiceLineId: "INV-LINE-04",
            description: "Premium Champagne Mini-Bar (Overcharged)",
            department: "MINIBAR",
            baseAmountLkr: 15000,
          },
          {
            lineId: "CN-LINE-LAUNDRY",
            originalInvoiceLineId: "INV-LINE-05",
            description: "Express Dry Cleaning (Double Counted)",
            department: "LAUNDRY",
            baseAmountLkr: 5000,
          },
        ],
        sequenceNumber: 4,
        actor: mockActor,
        subscription: mockSubscription,
      };

      const result = issueCreditNote(input);
      assert.ok(result.ok);
      const cn = result.value;

      assert.strictEqual(cn.lines.length, 2);
      assert.strictEqual(cn.taxReversalSummary.baseLkr, 20000); // 15,000 + 5,000
      assert.strictEqual(cn.lines[0]?.department, "MINIBAR");
      assert.strictEqual(cn.lines[0]?.baseReversedLkr, 15000);
      assert.strictEqual(cn.lines[1]?.department, "LAUNDRY");
      assert.strictEqual(cn.lines[1]?.baseReversedLkr, 5000);
    });

    it("rejects empty creditedLines array with VALIDATION_FAILED", () => {
      const input: IssueCreditNoteInput = {
        tenantId: "cinnamon-grand-cmb",
        creditNoteType: "LINE_ITEM_REVERSAL",
        originalInvoice: mockInvoice,
        reason: "BILLING_DISPUTE",
        reasonDescription: "No lines provided",
        creditedLines: [],
        sequenceNumber: 5,
        actor: mockActor,
        subscription: mockSubscription,
      };

      const result = issueCreditNote(input);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error.code, "VALIDATION_FAILED");
      }
    });
  });

  describe("8. Cryptographic Audit Chain Verification", () => {
    it("generates an immutable SHA-256 audit entry verifiable via canonical hash", () => {
      const input: IssueCreditNoteInput = {
        tenantId: "cinnamon-grand-cmb",
        creditNoteType: "FULL_VOID",
        originalInvoice: mockInvoice,
        reason: "FULL_INVOICE_VOID",
        reasonDescription: "Void full invoice for audit test",
        sequenceNumber: 99,
        actor: mockActor,
        subscription: mockSubscription,
        prevAuditHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        timestamp: "2026-10-19T15:30:00Z",
      };

      const result = issueCreditNote(input);
      assert.ok(result.ok);
      const cn = result.value;

      const expectedHash = computeAuditEntryHash({
        prevHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        tenantId: "cinnamon-grand-cmb",
        actorUserId: "USR-FC-01",
        action: "CREDIT_NOTE_ISSUED",
        entityType: "CreditNote",
        entityId: "CN#CN-2026-00099",
        isoTs: "2026-10-19T15:30:00Z",
        afterJson: cn.auditEntry.afterJson,
      });

      assert.strictEqual(cn.auditEntry.entryHash, expectedHash);
      assert.strictEqual(cn.auditEntry.entryHash.length, 64);
    });
  });

  describe("9. Type Definitions & Export Verification", () => {
    it("ensures all CreditNote interfaces and union types compile cleanly", () => {
      const reason: CreditNoteReason = "POST_CHECKOUT_REVERSAL";
      const type: CreditNoteType = "PARTIAL_AMOUNT";
      const line: CreditNoteLineItem = {
        lineId: "L1",
        description: "Rebate",
        department: "SPA",
        baseReversedLkr: 5000,
        scReversedLkr: 500,
        tdlReversedLkr: 55,
        ssclReversedLkr: 137.5,
        vatReversedLkr: 1024.65,
        totalReversedLkr: 6717.15,
      };
      const summary: CreditNoteTaxSummary = {
        baseLkr: 5000,
        scLkr: 500,
        subtotalAfterScLkr: 5500,
        tdlLkr: 55,
        ssclLkr: 137.5,
        vatBaseLkr: 5692.5,
        vatLkr: 1024.65,
        grandTotalLkr: 6717.15,
        effectiveTaxRate: 0.34,
        isVatRegistered: true,
      };

      assert.strictEqual(reason, "POST_CHECKOUT_REVERSAL");
      assert.strictEqual(type, "PARTIAL_AMOUNT");
      assert.ok(line.totalReversedLkr > 0);
      assert.ok(summary.grandTotalLkr > 0);
    });
  });
});
