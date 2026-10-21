import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCOUNTING_AUTHORIZED_ROLES,
  type AccountMapping,
  type AccountType,
  type AccountingExportInput,
  type AccountingSaasSubscription,
  type AccountingStaffActor,
  type AccountingStaffRole,
  type DailyAccountingJournal,
  type DailyDepartmentRevenue,
  type DailySettlementCollections,
  type DailyStatutoryTaxes,
  type JournalEntryLine,
  STANDARD_CHART_OF_ACCOUNTS,
  compileDailyAccountingJournal,
  exportGenericJournalCsv,
  exportQuickBooksCsv,
  exportTallyXml,
  exportXeroCsv,
} from "../src/accountingExport.js";
import { calculateForwardTax } from "../src/tax.js";

const TEST_TENANT = "tenant-boutique-sigiriya";

describe("Chart of Accounts & QuickBooks / Xero / Tally Journal Exporter (accountingExport.ts)", () => {
  const validActor: AccountingStaffActor = {
    userId: "user-fc-01",
    role: "FINANCE_CONTROLLER",
    tenantId: TEST_TENANT,
  };

  const validSubscription: AccountingSaasSubscription = {
    tenantId: TEST_TENANT,
    active: true,
    tier: "ENTERPRISE",
    allowsAccountingExport: true,
  };

  it("verifies standard Sri Lankan hotel chart of accounts configuration", () => {
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.CASH_DRAWER.code, "1010");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.BANK_CARD_CLEARING.code, "1020");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.LANKA_QR_CLEARING.code, "1030");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.GUEST_LEDGER.code, "1040");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.CITY_LEDGER.code, "1050");

    assert.equal(STANDARD_CHART_OF_ACCOUNTS.ADVANCE_DEPOSITS.code, "2010");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.SERVICE_CHARGE_POOL.code, "2020");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.TDL_PAYABLE.code, "2030");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.SSCL_PAYABLE.code, "2040");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.VAT_PAYABLE.code, "2050");

    assert.equal(STANDARD_CHART_OF_ACCOUNTS.ROOM_REVENUE.code, "3010");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.FB_REVENUE.code, "3020");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.SPA_REVENUE.code, "3030");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.BANQUET_REVENUE.code, "3040");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.EXCURSION_REVENUE.code, "3050");
    assert.equal(STANDARD_CHART_OF_ACCOUNTS.MISC_REVENUE.code, "3060");

    const mapping: AccountMapping = STANDARD_CHART_OF_ACCOUNTS.ROOM_REVENUE;
    const acctType: AccountType = mapping.type;
    assert.equal(acctType, "REVENUE");
  });

  it("compiles a balanced daily journal matching debits and credits to the exact cent (Rung 3 & Rung 5)", () => {
    const taxRes = calculateForwardTax(100000);
    assert.ok(taxRes.ok);
    const tb = taxRes.value;

    const revenues: DailyDepartmentRevenue = {
      roomBaseLkr: 70000,
      fbBaseLkr: 30000,
      spaBaseLkr: 0,
      banquetBaseLkr: 0,
      excursionBaseLkr: 0,
      miscBaseLkr: 0,
    };

    const taxes: DailyStatutoryTaxes = {
      serviceChargeLkr: tb.scLkr,
      tdlLkr: tb.tdlLkr,
      ssclLkr: tb.ssclLkr,
      vatLkr: tb.vatLkr,
    };

    const settlements: DailySettlementCollections = {
      cashLkr: 34343,
      cardLkr: 50000,
      lankaQrLkr: 30000,
      cityLedgerLkr: 20000,
    };

    const input: AccountingExportInput = {
      tenantId: TEST_TENANT,
      hotelName: "Sigiriya Heritage Villa",
      journalDate: "2026-10-18",
      actor: validActor,
      subscription: validSubscription,
      revenues,
      taxes,
      settlements,
      journalNumber: "JRN-20261018-001",
    };

    const res = compileDailyAccountingJournal(input);
    assert.ok(res.ok);
    const journal: DailyAccountingJournal = res.value;

    assert.equal(journal.isBalanced, true);
    assert.equal(journal.totalDebitsLkr, tb.grandTotalLkr);
    assert.equal(journal.totalCreditsLkr, tb.grandTotalLkr);
    assert.equal(journal.totalDebitsLkr, journal.totalCreditsLkr);
    assert.equal(journal.journalNumber, "JRN-20261018-001");
    assert.equal(journal.tenantId, TEST_TENANT);

    // Verify debit lines
    const debitLines = journal.lines.filter((l) => l.debitLkr > 0);
    assert.equal(debitLines.length, 4); // Cash, Card, LankaQR, City Ledger
    const totalDebits = debitLines.reduce((sum, l) => sum + l.debitLkr, 0);
    assert.equal(Math.round(totalDebits * 100) / 100, tb.grandTotalLkr);

    // Verify credit lines
    const creditLines = journal.lines.filter((l) => l.creditLkr > 0);
    assert.equal(creditLines.length, 6); // Room, FB, SC, TDL, SSCL, VAT
    const totalCredits = creditLines.reduce((sum, l) => sum + l.creditLkr, 0);
    assert.equal(Math.round(totalCredits * 100) / 100, tb.grandTotalLkr);

    // Verify audit log
    assert.equal(journal.auditLog.action, "ACCOUNTING_JOURNAL_EXPORTED");
    assert.equal(journal.auditLog.tenantId, TEST_TENANT);
    assert.equal(journal.auditLog.actorUserId, "user-fc-01");
  });

  it("exports QuickBooks CSV format with required headers and debit/credit columns", () => {
    const lines: readonly JournalEntryLine[] = [
      {
        lineNo: 1,
        accountCode: "1010",
        accountName: "Front Desk Cash Drawer",
        accountType: "ASSET",
        debitLkr: 50000,
        creditLkr: 0,
        department: "FRONT_DESK",
        narration: "Daily Cash Settlements",
      },
      {
        lineNo: 2,
        accountCode: "3010",
        accountName: "Room & Accommodation Revenue",
        accountType: "REVENUE",
        debitLkr: 0,
        creditLkr: 50000,
        department: "ROOMS",
        narration: "Room Revenue Base",
      },
    ];

    const qbCsv = exportQuickBooksCsv("JRN-2026-10-18", "2026-10-18", "Sigiriya Villa", lines);
    assert.ok(qbCsv.includes("*JournalNo,*JournalDate,*AccountName,*AccountCode,*Debit,*Credit"));
    assert.ok(qbCsv.includes("Front Desk Cash Drawer,1010,50000.00,0.00"));
    assert.ok(qbCsv.includes("Room & Accommodation Revenue,3010,0.00,50000.00"));
  });

  it("exports Xero CSV format with signed amounts and BASEXCLUDED tax type", () => {
    const lines: readonly JournalEntryLine[] = [
      {
        lineNo: 1,
        accountCode: "1020",
        accountName: "Bank & Credit Card Clearing",
        accountType: "ASSET",
        debitLkr: 25000,
        creditLkr: 0,
        department: "FRONT_DESK",
        narration: "Card Clearing",
      },
      {
        lineNo: 2,
        accountCode: "3020",
        accountName: "Food & Beverage Revenue",
        accountType: "REVENUE",
        debitLkr: 0,
        creditLkr: 25000,
        department: "FOOD_AND_BEVERAGE",
        narration: "F&B Revenue",
      },
    ];

    const xeroCsv = exportXeroCsv("JRN-002", "2026-10-18", lines);
    assert.ok(xeroCsv.includes("*Narration,*Date,*Description,*AccountCode,*TaxType,*Amount"));
    assert.ok(xeroCsv.includes("1020,BASEXCLUDED,25000.00"));
    assert.ok(xeroCsv.includes("3020,BASEXCLUDED,-25000.00"));
  });

  it("exports Tally ERP 9 / Prime XML voucher format", () => {
    const lines: readonly JournalEntryLine[] = [
      {
        lineNo: 1,
        accountCode: "1030",
        accountName: "LankaQR EMVCo Clearing",
        accountType: "ASSET",
        debitLkr: 10000,
        creditLkr: 0,
        department: "FRONT_DESK",
        narration: "LankaQR Payment",
      },
      {
        lineNo: 2,
        accountCode: "3030",
        accountName: "Ayurveda & Spa Revenue",
        accountType: "REVENUE",
        debitLkr: 0,
        creditLkr: 10000,
        department: "SPA",
        narration: "Spa Revenue",
      },
    ];

    const xml = exportTallyXml("JRN-003", "2026-10-18", "Sigiriya Villa", lines);
    assert.ok(xml.includes("<ENVELOPE>"));
    assert.ok(xml.includes('<VOUCHER VCHTYPE="Journal" ACTION="Create"'));
    assert.ok(xml.includes("<VOUCHERNUMBER>JRN-003</VOUCHERNUMBER>"));
    assert.ok(xml.includes("<LEDGERNAME>LankaQR EMVCo Clearing</LEDGERNAME>"));
    assert.ok(xml.includes("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>"));
    assert.ok(xml.includes("<LEDGERNAME>Ayurveda &amp; Spa Revenue</LEDGERNAME>"));
    assert.ok(xml.includes("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>"));
  });

  it("exports Generic Journal CSV with all breakdown fields", () => {
    const lines: readonly JournalEntryLine[] = [
      {
        lineNo: 1,
        accountCode: "1010",
        accountName: "Cash Drawer",
        accountType: "ASSET",
        debitLkr: 1000,
        creditLkr: 0,
        department: "FRONT_DESK",
        narration: "Cash",
      },
      {
        lineNo: 2,
        accountCode: "3010",
        accountName: "Room",
        accountType: "REVENUE",
        debitLkr: 0,
        creditLkr: 1000,
        department: "ROOMS",
        narration: "Room",
      },
    ];

    const genCsv = exportGenericJournalCsv("JRN-004", "2026-10-18", lines);
    assert.ok(genCsv.includes("JournalDate,JournalNumber,LineNo,AccountCode"));
    assert.ok(
      genCsv.includes("2026-10-18,JRN-004,1,1010,Cash Drawer,ASSET,FRONT_DESK,1000.00,0.00"),
    );
  });

  it("rejects unbalanced daily journal when debits !== credits (Rung 5)", () => {
    const input: AccountingExportInput = {
      tenantId: TEST_TENANT,
      hotelName: "Villa",
      journalDate: "2026-10-18",
      actor: validActor,
      subscription: validSubscription,
      revenues: {
        roomBaseLkr: 50000,
        fbBaseLkr: 0,
      },
      taxes: {
        serviceChargeLkr: 5000,
        tdlLkr: 500,
        ssclLkr: 1250,
        vatLkr: 9000,
      },
      settlements: {
        cashLkr: 50000,
        cardLkr: 0,
        lankaQrLkr: 0,
        cityLedgerLkr: 0,
      },
    };

    const res = compileDailyAccountingJournal(input);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "VALIDATION_FAILED");
      assert.equal(res.error.meta?.subCode, "UNBALANCED_JOURNAL");
      assert.ok(res.error.message.includes("Double-entry imbalance"));
    }
  });

  it("rejects unauthorized staff roles via RolePermissionMatrix RBAC", () => {
    const unauthorizedActor = {
      userId: "user-attendant-01",
      role: "HOUSEKEEPING_ATTENDANT" as AccountingStaffRole,
      tenantId: TEST_TENANT,
    };

    const input: AccountingExportInput = {
      tenantId: TEST_TENANT,
      hotelName: "Villa",
      journalDate: "2026-10-18",
      actor: unauthorizedActor,
      subscription: validSubscription,
      revenues: { roomBaseLkr: 1000, fbBaseLkr: 0 },
      taxes: { serviceChargeLkr: 0, tdlLkr: 0, ssclLkr: 0, vatLkr: 0 },
      settlements: { cashLkr: 1000, cardLkr: 0, lankaQrLkr: 0, cityLedgerLkr: 0 },
    };

    const res = compileDailyAccountingJournal(input);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "PERMISSION_DENIED");
    }

    assert.ok(ACCOUNTING_AUTHORIZED_ROLES.includes("FINANCE_CONTROLLER"));
    assert.ok(ACCOUNTING_AUTHORIZED_ROLES.includes("HOTEL_OWNER"));
    assert.ok(ACCOUNTING_AUTHORIZED_ROLES.includes("GENERAL_MANAGER"));
    assert.ok(ACCOUNTING_AUTHORIZED_ROLES.includes("NIGHT_AUDITOR"));
  });

  it("enforces tenant boundary isolation and subscription entitlement checks", () => {
    const mismatchedActor: AccountingStaffActor = {
      userId: "user-fc-02",
      role: "FINANCE_CONTROLLER",
      tenantId: "tenant-other-hotel",
    };

    const input: AccountingExportInput = {
      tenantId: TEST_TENANT,
      hotelName: "Villa",
      journalDate: "2026-10-18",
      actor: mismatchedActor,
      subscription: validSubscription,
      revenues: { roomBaseLkr: 1000, fbBaseLkr: 0 },
      taxes: { serviceChargeLkr: 0, tdlLkr: 0, ssclLkr: 0, vatLkr: 0 },
      settlements: { cashLkr: 1000, cardLkr: 0, lankaQrLkr: 0, cityLedgerLkr: 0 },
    };

    const resMismatch = compileDailyAccountingJournal(input);
    assert.equal(resMismatch.ok, false);
    if (!resMismatch.ok) {
      assert.equal(resMismatch.error.code, "TENANT_MISMATCH");
    }

    const resInactive = compileDailyAccountingJournal({
      ...input,
      actor: validActor,
      subscription: { ...validSubscription, active: false },
    });
    assert.equal(resInactive.ok, false);
    if (!resInactive.ok) {
      assert.equal(resInactive.error.code, "SUBSCRIPTION_INACTIVE");
    }

    const resNoFeature = compileDailyAccountingJournal({
      ...input,
      actor: validActor,
      subscription: { ...validSubscription, allowsAccountingExport: false },
    });
    assert.equal(resNoFeature.ok, false);
    if (!resNoFeature.ok) {
      assert.equal(resNoFeature.error.code, "PLAN_LIMITATION");
    }

    const resInvalidDate = compileDailyAccountingJournal({
      ...input,
      actor: validActor,
      journalDate: "invalid-date",
    });
    assert.equal(resInvalidDate.ok, false);
    if (!resInvalidDate.ok) {
      assert.equal(resInvalidDate.error.code, "INVALID_DATE_FORMAT");
    }
  });
});
