/**
 * @hms/core - Unit Tests for IRD Output VAT (18%) & Quarterly SSCL (2.5%) Compilers
 * (`packages/core/test/irdTaxSchedules.test.ts`)
 *
 * Implements Step 410 (Phase 17.10) of the Sri Lanka HMS Master Architecture Plan:
 * Validates deterministic aggregation, B2B/B2C schedule segregation, 4-stage tax compliance,
 * statutory due date calculation, multi-tenant RBAC enforcement, and SHA-256 audit chaining.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAuditEntryHash } from "../src/auditChain.js";
import {
  type IrdInvoiceRecord,
  type IrdMonthlyVatScheduleInput,
  type IrdQuarterlySsclScheduleInput,
  type IrdSaasSubscription,
  type IrdStaffActor,
  compileMonthlyOutputVatSchedule,
  compileQuarterlySsclSchedule,
  computeIrdVatDueDate,
  computeSsclReturnDueDate,
} from "../src/irdTaxSchedules.js";

const VALID_ACTOR: IrdStaffActor = {
  userId: "user-fc-01",
  role: "FINANCE_CONTROLLER",
  tenantId: "cinnamon-grand-cmb",
};

const VALID_SUBSCRIPTION: IrdSaasSubscription = {
  tenantId: "cinnamon-grand-cmb",
  active: true,
  tier: "PRO_RESORT",
  allowsIrdReporting: true,
};

describe("Step 409 & 410: IRD Monthly Output VAT (18%) & Quarterly SSCL (2.5%) Tax Compilers", () => {
  describe("1. Pure Date & Statutory Deadline Calculations", () => {
    it("computes 20th of following month as VAT filing deadline", () => {
      assert.equal(computeIrdVatDueDate("2026-01"), "2026-02-20");
      assert.equal(computeIrdVatDueDate("2026-09"), "2026-10-20");
      assert.equal(computeIrdVatDueDate("2026-12"), "2027-01-20"); // Year rollover
    });

    it("computes end of month following quarter close for SSCL return deadline", () => {
      assert.equal(computeSsclReturnDueDate(2026, 1), "2026-04-30");
      assert.equal(computeSsclReturnDueDate(2026, 2), "2026-07-31");
      assert.equal(computeSsclReturnDueDate(2026, 3), "2026-10-31");
      assert.equal(computeSsclReturnDueDate(2026, 4), "2027-01-31");
    });
  });

  describe("2. Security, RBAC & Multi-Tenant Isolation", () => {
    it("rejects unauthorized staff roles with PERMISSION_DENIED", () => {
      const unauthorizedActor: IrdStaffActor = {
        userId: "user-hk-01",
        role: "HOUSEKEEPING" as unknown as IrdStaffActor["role"],
        tenantId: "cinnamon-grand-cmb",
      };

      const input: IrdMonthlyVatScheduleInput = {
        tenantId: "cinnamon-grand-cmb",
        yearMonth: "2026-10",
        hotelName: "Cinnamon Grand",
        hotelTin: "104820192",
        hotelVatNo: "104820192-7000",
        invoices: [],
        actor: unauthorizedActor,
      };

      const result = compileMonthlyOutputVatSchedule(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "PERMISSION_DENIED");
      }
    });

    it("rejects actor tenant mismatch with TENANT_MISMATCH", () => {
      const mismatchedActor: IrdStaffActor = {
        userId: "user-fc-01",
        role: "FINANCE_CONTROLLER",
        tenantId: "other-resort-galle",
      };

      const input: IrdMonthlyVatScheduleInput = {
        tenantId: "cinnamon-grand-cmb",
        yearMonth: "2026-10",
        hotelName: "Cinnamon Grand",
        hotelTin: "104820192",
        hotelVatNo: "104820192-7000",
        invoices: [],
        actor: mismatchedActor,
      };

      const result = compileMonthlyOutputVatSchedule(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects inactive SaaS subscriptions with SUBSCRIPTION_INACTIVE", () => {
      const inactiveSub: IrdSaasSubscription = {
        tenantId: "cinnamon-grand-cmb",
        active: false,
      };

      const input: IrdMonthlyVatScheduleInput = {
        tenantId: "cinnamon-grand-cmb",
        yearMonth: "2026-10",
        hotelName: "Cinnamon Grand",
        hotelTin: "104820192",
        hotelVatNo: "104820192-7000",
        invoices: [],
        actor: VALID_ACTOR,
        subscription: inactiveSub,
      };

      const result = compileMonthlyOutputVatSchedule(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "SUBSCRIPTION_INACTIVE");
      }
    });

    it("rejects malformed yearMonth with INVALID_DATE_FORMAT", () => {
      const input: IrdMonthlyVatScheduleInput = {
        tenantId: "cinnamon-grand-cmb",
        yearMonth: "2026-13", // Invalid month
        hotelName: "Cinnamon Grand",
        hotelTin: "104820192",
        hotelVatNo: "104820192-7000",
        invoices: [],
        actor: VALID_ACTOR,
      };

      const result = compileMonthlyOutputVatSchedule(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "INVALID_DATE_FORMAT");
      }
    });
  });

  describe("3. Monthly Output VAT Schedule (compileMonthlyOutputVatSchedule)", () => {
    it("segregates B2B corporate, B2C tourist, and exempt supplies with accurate 18% VAT math", () => {
      const sampleInvoices: readonly IrdInvoiceRecord[] = [
        // B2B Corporate Invoice 1 (Jetwing Holidays DMC)
        {
          invoiceNo: "TAXINV-2026-10-001",
          invoiceDate: "2026-10-05",
          folioId: "FOLIO-DMC-01",
          isB2b: true,
          buyerName: "Jetwing Holidays (Pvt) Ltd",
          buyerTin: "101928374",
          buyerVatNo: "101928374-7000",
          baseSupplyLkr: 200000,
          serviceChargeLkr: 20000,
          tdlLkr: 2200,
          ssclLkr: 5500,
          vatBaseLkr: 227700,
          vatLkr: 40986, // 18% of 227,700
          grandTotalLkr: 268686,
        },
        // B2B Corporate Invoice 2 (Aitken Spence Travels)
        {
          invoiceNo: "TAXINV-2026-10-002",
          invoiceDate: "2026-10-12",
          folioId: "FOLIO-DMC-02",
          isB2b: true,
          buyerName: "Aitken Spence Travels Ltd",
          buyerTin: "208192847",
          buyerVatNo: "208192847-7000",
          baseSupplyLkr: 300000,
          serviceChargeLkr: 30000,
          tdlLkr: 3300,
          ssclLkr: 8250,
          vatBaseLkr: 341550,
          vatLkr: 61479, // 18% of 341,550
          grandTotalLkr: 403029,
        },
        // B2C Individual Tourist 1 (Walk-in direct guest)
        {
          invoiceNo: "TAXINV-2026-10-003",
          invoiceDate: "2026-10-15",
          folioId: "FOLIO-GST-01",
          isB2b: false,
          buyerName: "John Smith (UK)",
          baseSupplyLkr: 50000,
          serviceChargeLkr: 5000,
          tdlLkr: 550,
          ssclLkr: 1375,
          vatBaseLkr: 56925,
          vatLkr: 10246.5,
          grandTotalLkr: 67171.5,
        },
        // Exempt Supply (Diplomatic mission)
        {
          invoiceNo: "TAXINV-2026-10-004",
          invoiceDate: "2026-10-20",
          folioId: "FOLIO-DIP-01",
          isB2b: true,
          buyerName: "Embassy of France",
          isVatExempt: true,
          baseSupplyLkr: 80000,
          serviceChargeLkr: 8000,
          tdlLkr: 880,
          ssclLkr: 0,
          vatBaseLkr: 0,
          vatLkr: 0,
          grandTotalLkr: 88880,
        },
      ];

      const input: IrdMonthlyVatScheduleInput = {
        tenantId: "cinnamon-grand-cmb",
        yearMonth: "2026-10",
        hotelName: "Cinnamon Grand Colombo",
        hotelTin: "104820192",
        hotelVatNo: "104820192-7000",
        invoices: sampleInvoices,
        actor: VALID_ACTOR,
        subscription: VALID_SUBSCRIPTION,
        prevAuditHash: "0000000000000000000000000000000000000000000000000000000000000000",
      };

      const result = compileMonthlyOutputVatSchedule(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const schedule = result.value;
      assert.equal(schedule.tenantId, "cinnamon-grand-cmb");
      assert.equal(schedule.yearMonth, "2026-10");
      assert.equal(schedule.vatRatePercent, 18.0);
      assert.equal(schedule.statutoryFilingDueDate, "2026-11-20");

      // Verify B2B Schedule
      assert.equal(schedule.b2bInvoicesCount, 2);
      assert.equal(schedule.b2bTaxableSupplyLkr, 500000); // 200,000 + 300,000
      assert.equal(schedule.b2bOutputVatLkr, 102465); // 40,986 + 61,479

      // Verify B2C Schedule
      assert.equal(schedule.b2cInvoicesCount, 1);
      assert.equal(schedule.b2cTaxableSupplyLkr, 50000);
      assert.equal(schedule.b2cOutputVatLkr, 10246.5);

      // Verify Exempt
      assert.equal(schedule.exemptInvoicesCount, 1);
      assert.equal(schedule.exemptSupplyLkr, 80000);

      // Verify Combined Totals
      assert.equal(schedule.totalTaxableSupplyLkr, 630000); // 500k + 50k + 80k
      assert.equal(schedule.totalOutputVatLkr, 112711.5); // 102,465 + 10,246.5
    });
  });

  describe("4. Quarterly SSCL Schedule (compileQuarterlySsclSchedule)", () => {
    it("accurately compiles 2.5% SSCL monthly breakdown and quarterly summary", () => {
      const input: IrdQuarterlySsclScheduleInput = {
        tenantId: "cinnamon-grand-cmb",
        taxYear: 2026,
        quarter: 1,
        hotelName: "Cinnamon Grand Colombo",
        hotelTin: "104820192",
        hotelSsclNo: "104820192-9000",
        monthlyTurnovers: [
          { monthIndex: 1, yearMonth: "2026-01", liableTurnoverLkr: 60000000 },
          { monthIndex: 2, yearMonth: "2026-02", liableTurnoverLkr: 50000000 },
          { monthIndex: 3, yearMonth: "2026-03", liableTurnoverLkr: 55000000 },
        ],
        actor: VALID_ACTOR,
        subscription: VALID_SUBSCRIPTION,
      };

      const result = compileQuarterlySsclSchedule(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const sscl = result.value;
      assert.equal(sscl.tenantId, "cinnamon-grand-cmb");
      assert.equal(sscl.taxYear, 2026);
      assert.equal(sscl.quarter, 1);
      assert.equal(sscl.quarterLabel, "Q1 (2026)");
      assert.equal(sscl.ssclRatePercent, 2.5);
      assert.equal(sscl.statutoryReturnDueDate, "2026-04-30");

      // Monthly SSCL (2.5%):
      // Month 1: 60,000,000 * 2.5% = 1,500,000 (Due: 2026-02-20)
      // Month 2: 50,000,000 * 2.5% = 1,250,000 (Due: 2026-03-20)
      // Month 3: 55,000,000 * 2.5% = 1,375,000 (Due: 2026-04-20)
      assert.equal(sscl.months.length, 3);
      assert.equal(sscl.months[0]?.ssclPayableLkr, 1500000);
      assert.equal(sscl.months[0]?.remittanceDueDate, "2026-02-20");
      assert.equal(sscl.months[1]?.ssclPayableLkr, 1250000);
      assert.equal(sscl.months[1]?.remittanceDueDate, "2026-03-20");
      assert.equal(sscl.months[2]?.ssclPayableLkr, 1375000);
      assert.equal(sscl.months[2]?.remittanceDueDate, "2026-04-20");

      // Quarterly totals
      assert.equal(sscl.quarterlyTurnoverLkr, 165000000);
      assert.equal(sscl.quarterlySsclPayableLkr, 4125000); // 1,500k + 1,250k + 1,375k
    });
  });

  describe("5. Cryptographic Audit Chain Verification", () => {
    it("generates an unbroken SHA-256 audit entry verifiable via computeAuditEntryHash", () => {
      const input: IrdMonthlyVatScheduleInput = {
        tenantId: "cinnamon-grand-cmb",
        yearMonth: "2026-10",
        hotelName: "Cinnamon Grand",
        hotelTin: "104820192",
        hotelVatNo: "104820192-7000",
        invoices: [],
        actor: VALID_ACTOR,
        prevAuditHash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        timestamp: "2026-11-01T10:00:00.000Z",
      };

      const result = compileMonthlyOutputVatSchedule(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const log = result.value.auditLog;
      const expectedHash = computeAuditEntryHash({
        prevHash: log.prevHash,
        tenantId: log.tenantId,
        actorUserId: log.actorUserId,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        isoTs: log.isoTs,
        afterJson: log.afterJson,
      });

      assert.equal(log.entryHash, expectedHash);
      assert.equal(
        log.prevHash,
        "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
      );
    });
  });
});
