import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyAuditChain } from "../src/auditChain.js";
import {
  type BankSlipsExportInput,
  type EmployeeBankTransferItem,
  type OriginatingAccountProfile,
  SRI_LANKA_BANK_CODES,
  createBankSlipsExportAuditEntry,
  exportBankSlipsCsv,
  padAccountNumber,
  padBankCode,
  padBranchCode,
  resolveBankCode,
  sanitizeBeneficiaryName,
  validateTransferItem,
} from "../src/bankSlipsExport.js";

const DEFAULT_ORIGIN: OriginatingAccountProfile = {
  bankCode: "7056",
  branchCode: "001",
  accountNumber: "8001049281",
  companyName: "Grand Serendib Hotel (Pvt) Ltd",
  particulars: "OCT 2026 SALARY",
};

const SAMPLE_STAFF_TRANSFERS: readonly EmployeeBankTransferItem[] = [
  {
    employeeId: "st-001",
    employeeName: "Kasun Jayasuriya",
    destinationBankCode: "COMMERCIAL",
    destinationBranchCode: "014",
    destinationAccountNumber: "8001429810",
    netPayLkr: 110450.0,
    nicOrPassport: "198824501234",
    referenceNarrative: "SAL-001",
  },
  {
    employeeId: "st-002",
    employeeName: "Dilani Fernando",
    destinationBankCode: "BOC",
    destinationBranchCode: "042",
    destinationAccountNumber: "7310482011",
    netPayLkr: 82500.0,
    nicOrPassport: "199478103456",
    referenceNarrative: "SAL-002",
  },
  {
    employeeId: "st-003",
    employeeName: "Nuwan Gunasekara",
    destinationBankCode: "SAMPATH",
    destinationBranchCode: "105",
    destinationAccountNumber: "002910045612",
    netPayLkr: 228950.0,
    nicOrPassport: "198214209876",
    referenceNarrative: "SAL-003",
  },
];

describe("Step 437 & 438: Commercial Bank SLIPS Bulk Salary Transfer Exporter", () => {
  it("resolves and pads 4-digit bank code, 3-digit branch code, and 12-digit account number (Rung 5)", () => {
    assert.equal(resolveBankCode("Commercial Bank of Ceylon"), SRI_LANKA_BANK_CODES.COMMERCIAL);
    assert.equal(resolveBankCode("COMBANK"), SRI_LANKA_BANK_CODES.COMMERCIAL);
    assert.equal(resolveBankCode("Bank of Ceylon"), SRI_LANKA_BANK_CODES.BOC);
    assert.equal(resolveBankCode("BOC"), SRI_LANKA_BANK_CODES.BOC);
    assert.equal(resolveBankCode("People's Bank"), SRI_LANKA_BANK_CODES.PEOPLES);
    assert.equal(resolveBankCode("PEOPLES"), SRI_LANKA_BANK_CODES.PEOPLES);
    assert.equal(resolveBankCode("Sampath Bank PLC"), SRI_LANKA_BANK_CODES.SAMPATH);
    assert.equal(resolveBankCode("SAMPATH"), SRI_LANKA_BANK_CODES.SAMPATH);
    assert.equal(resolveBankCode("Hatton National Bank"), SRI_LANKA_BANK_CODES.HNB);
    assert.equal(resolveBankCode("HNB"), SRI_LANKA_BANK_CODES.HNB);
    assert.equal(resolveBankCode("7056"), "7056");

    assert.equal(padBankCode("7056"), "7056");
    assert.equal(padBankCode("56"), "0056");
    assert.equal(padBranchCode("1"), "001");
    assert.equal(padBranchCode("42"), "042");
    assert.equal(padAccountNumber("8001049281", 12), "008001049281");
    assert.equal(sanitizeBeneficiaryName("Kasun, Jayasuriya"), "KASUN JAYASURIYA");
  });

  it("validates individual transfer line items and rejects invalid inputs", () => {
    const firstItem = SAMPLE_STAFF_TRANSFERS[0];
    if (!firstItem) {
      assert.fail("Missing firstItem");
    }

    const valid = validateTransferItem(firstItem);
    assert.ok(valid.ok);
    assert.equal(valid.value.destinationBankCode, "7056");
    assert.equal(valid.value.destinationBranchCode, "014");

    const noId = validateTransferItem({ ...firstItem, employeeId: "" });
    assert.ok(!noId.ok);

    const badBank = validateTransferItem({
      ...firstItem,
      destinationBankCode: "INVALID",
    });
    assert.ok(!badBank.ok);

    const zeroPay = validateTransferItem({ ...firstItem, netPayLkr: 0 });
    assert.ok(!zeroPay.ok);
  });

  it("exports standard LankaPay SLIPS format with header record and detail records", () => {
    const input: BankSlipsExportInput = {
      tenantId: "tenant-serendib-colombo",
      billingPeriod: "2026-10",
      paymentDate: "2026-10-31",
      format: "LANKAPAY_SLIPS_STANDARD",
      origin: DEFAULT_ORIGIN,
      transfers: SAMPLE_STAFF_TRANSFERS,
    };

    const res = exportBankSlipsCsv(input);
    assert.ok(res.ok);
    assert.equal(res.value.totalCount, 3);
    assert.equal(res.value.totalAmountLkr, 421900.0);

    const lines = res.value.csvContent.split("\n");
    assert.equal(lines.length, 4); // 1 header + 3 items
    assert.ok(lines[0]?.startsWith("H,7056,001,008001049281"));
    assert.ok(lines[1]?.startsWith("D,7056,014,008001429810"));
  });

  it("exports Commercial Bank PayMaster CSV format", () => {
    const input: BankSlipsExportInput = {
      tenantId: "tenant-serendib-colombo",
      billingPeriod: "2026-10",
      paymentDate: "2026-10-31",
      format: "COMMERCIAL_BANK_PAYMASTER",
      origin: DEFAULT_ORIGIN,
      transfers: SAMPLE_STAFF_TRANSFERS,
    };

    const res = exportBankSlipsCsv(input);
    assert.ok(res.ok);
    assert.ok(res.value.csvContent.includes("Account_Number,Amount_LKR,Beneficiary_Name"));
    assert.ok(res.value.csvContent.includes('008001429810,110450.00,"KASUN JAYASURIYA",7056,014'));
  });

  it("exports Sampath Vishwa, BOC Bulk, People's Bank, and HNB formats", () => {
    const baseInput: BankSlipsExportInput = {
      tenantId: "tenant-serendib-colombo",
      billingPeriod: "2026-10",
      paymentDate: "2026-10-31",
      format: "SAMPATH_CORPORATE_VISHWA",
      origin: DEFAULT_ORIGIN,
      transfers: SAMPLE_STAFF_TRANSFERS,
    };

    const sampath = exportBankSlipsCsv(baseInput);
    assert.ok(sampath.ok);
    assert.ok(sampath.value.csvContent.includes("Beneficiary_Account,Beneficiary_Name"));

    const boc = exportBankSlipsCsv({ ...baseInput, format: "BOC_BULK_SALARY" });
    assert.ok(boc.ok);
    assert.ok(boc.value.csvContent.includes("Bank_Code,Branch_Code,Account_No"));

    const peoples = exportBankSlipsCsv({ ...baseInput, format: "PEOPLES_BANK_SLIPS" });
    assert.ok(peoples.ok);
    assert.ok(peoples.value.csvContent.includes("Destination_Bank,Destination_Branch"));

    const hnb = exportBankSlipsCsv({ ...baseInput, format: "HNB_APPROVE_ONLINE" });
    assert.ok(hnb.ok);
    assert.ok(hnb.value.csvContent.includes("Bank_Code,Branch_Code,Account_Number"));
  });

  it("enforces tenant boundary isolation and verifies cryptographic SHA-256 audit entry chain", () => {
    const badTenant = exportBankSlipsCsv({
      tenantId: "",
      billingPeriod: "2026-10",
      paymentDate: "2026-10-31",
      format: "LANKAPAY_SLIPS_STANDARD",
      origin: DEFAULT_ORIGIN,
      transfers: SAMPLE_STAFF_TRANSFERS,
    });
    assert.ok(!badTenant.ok);
    assert.equal(badTenant.error.code, "VALIDATION_FAILED");

    const auditRes = createBankSlipsExportAuditEntry(
      "tenant-serendib-colombo",
      "user-finance-01",
      "2026-10",
      3,
      421900.0,
      "LANKAPAY_SLIPS_STANDARD",
      "7056-001-8001049281",
      "2026-10-31T18:00:00.000Z",
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    assert.ok(auditRes.ok);
    const entry = auditRes.value;
    assert.equal(entry.action, "EXPORT_BANK_SLIPS");
    assert.equal(entry.entryHash.length, 64);

    const chainRes = verifyAuditChain([entry]);
    assert.ok(chainRes.ok);
    assert.equal(chainRes.value.verifiedCount, 1);
  });
});
