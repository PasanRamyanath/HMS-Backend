/**
 * @hms/core - Excursion Vendor Commission & Pass-Through Split Unit Tests
 * (HMS-Backend/packages/core/test/excursionSplit.test.ts)
 *
 * Verifies Steps 357 & 358 (Phase 15.07 - 15.08) / Rung 5 & 6:
 * - Legally compliant agency pass-through vs principal hotel accounting.
 * - Yala Safari Jeep + DWC park ticket split folio posting.
 * - Prevents ~34.34% tax overpayment on government wildlife ticket disbursements.
 * - 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT) on hotel markup only.
 * - Multi-tenant isolation, RBAC role guard, and SHA-256 hash-chained audit logging.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXCURSION_AUTHORIZED_ROLES,
  type ExcursionActor,
  type ExcursionCategory,
  type ExcursionFolioLineItem,
  type ExcursionSplitInput,
  type PassThroughCostItem,
  type PassThroughType,
  type VendorPayableSummary,
  aggregateVendorPayables,
  buildFolioLineItems,
  computeExcursionFinancialSplit,
  isAuthorizedExcursionRole,
  validateActor,
  validateExcursionSplitInput,
  validatePassThroughCostItem,
} from "../src/excursionSplit.js";
import { roundLkr } from "../src/tax.js";

describe("Steps 357-358: Excursion Vendor Commission & Pass-Through Split (excursionSplit.ts)", () => {
  const validActor: ExcursionActor = {
    userId: "USR-EXCURSION-01",
    role: "EXCURSION_OFFICER",
    tenantId: "TENANT-YALA-RESORT",
  };

  const samplePassThroughItems: readonly PassThroughCostItem[] = [
    {
      type: "GOVERNMENT_WILDLIFE_PERMIT",
      description: "Department of Wildlife Conservation (DWC) Yala Block 1 Entrance",
      amountLkr: 15000,
      recipientVendorName: "Department of Wildlife Conservation",
      recipientVendorVatNumber: "V-DWC-00192",
    },
    {
      type: "THIRD_PARTY_VEHICLE_HIRE",
      description: "Yala 4x4 Safari Jeep Hire (Palatupana Fleet #09)",
      amountLkr: 25000,
      recipientVendorName: "Ruhunu Safari Jeep Association",
    },
  ];

  describe("1. Currency Rounding & Role Authorization", () => {
    it("safely rounds amounts to two decimal places", () => {
      assert.equal(roundLkr(5000.126), 5000.13);
      assert.equal(roundLkr(5000.124), 5000.12);
      assert.equal(roundLkr(0), 0);
      assert.equal(roundLkr(Number.NaN), 0);
      assert.equal(roundLkr(Number.POSITIVE_INFINITY), 0);
    });

    it("authorizes valid operational and managerial roles", () => {
      assert.equal(isAuthorizedExcursionRole("SUPER_ADMIN"), true);
      assert.equal(isAuthorizedExcursionRole("HOTEL_ADMIN"), true);
      assert.equal(isAuthorizedExcursionRole("FRONT_DESK"), true);
      assert.equal(isAuthorizedExcursionRole("CONCIERGE"), true);
      assert.equal(isAuthorizedExcursionRole("EXCURSION_OFFICER"), true);
      assert.equal(isAuthorizedExcursionRole("excursion_officer"), true);
    });

    it("rejects unauthorized roles from managing financial excursion splits", () => {
      assert.equal(isAuthorizedExcursionRole("HOUSEKEEPING_RUNNER"), false);
      assert.equal(isAuthorizedExcursionRole("KITCHEN_STEWARD"), false);
      assert.equal(isAuthorizedExcursionRole("GUEST"), false);
      assert.equal(isAuthorizedExcursionRole("SPA_THERAPIST"), false);
    });

    it("exports authorized roles array", () => {
      assert.ok(EXCURSION_AUTHORIZED_ROLES.length >= 6);
    });
  });

  describe("2. Multi-Tenant Boundary & Input Validation", () => {
    it("rejects request when tenantId is missing or empty", () => {
      const input: ExcursionSplitInput = {
        tenantId: "",
        actor: validActor,
        bookingId: "BKG-001",
        reservationId: "RES-001",
        roomNumber: "Villa 5",
        guestName: "Lord Mountbatten",
        category: "WILDLIFE_SAFARI",
        description: "Yala Morning Safari",
        passThroughItems: samplePassThroughItems,
        hotelMarkupLkr: 15000,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "VALIDATION_FAILED");
      }
    });

    it("rejects tenant mismatch between actor and target tenant", () => {
      const input: ExcursionSplitInput = {
        tenantId: "TENANT-OTHER-HOTEL",
        actor: validActor, // TENANT-YALA-RESORT
        bookingId: "BKG-001",
        reservationId: "RES-001",
        roomNumber: "Villa 5",
        guestName: "Lord Mountbatten",
        category: "WILDLIFE_SAFARI",
        description: "Yala Morning Safari",
        passThroughItems: samplePassThroughItems,
        hotelMarkupLkr: 15000,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects unauthorized role attempting to compute excursion splits", () => {
      const unauthorizedActor: ExcursionActor = {
        userId: "USR-HK-01",
        role: "HOUSEKEEPING_RUNNER",
        tenantId: "TENANT-YALA-RESORT",
      };

      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: unauthorizedActor,
        bookingId: "BKG-001",
        reservationId: "RES-001",
        roomNumber: "Villa 5",
        guestName: "Lord Mountbatten",
        category: "WILDLIFE_SAFARI",
        description: "Yala Morning Safari",
        passThroughItems: samplePassThroughItems,
        hotelMarkupLkr: 15000,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "PERMISSION_DENIED");
      }
    });

    it("rejects negative hotel markup", () => {
      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: validActor,
        bookingId: "BKG-001",
        reservationId: "RES-001",
        roomNumber: "Villa 5",
        guestName: "Lord Mountbatten",
        category: "WILDLIFE_SAFARI",
        description: "Yala Morning Safari",
        passThroughItems: samplePassThroughItems,
        hotelMarkupLkr: -500,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "INVALID_TAX_BASE");
      }
    });

    it("rejects negative pass-through cost item", () => {
      const invalidPassThrough: readonly PassThroughCostItem[] = [
        {
          type: "GOVERNMENT_WILDLIFE_PERMIT",
          description: "DWC Permit",
          amountLkr: -1000,
          recipientVendorName: "DWC",
        },
      ];

      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: validActor,
        bookingId: "BKG-001",
        reservationId: "RES-001",
        roomNumber: "Villa 5",
        guestName: "Lord Mountbatten",
        category: "WILDLIFE_SAFARI",
        description: "Yala Morning Safari",
        passThroughItems: invalidPassThrough,
        hotelMarkupLkr: 15000,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "INVALID_TAX_BASE");
      }
    });

    it("rejects pass-through item with empty vendor name", () => {
      const invalidVendor: readonly PassThroughCostItem[] = [
        {
          type: "GOVERNMENT_WILDLIFE_PERMIT",
          description: "DWC Permit",
          amountLkr: 15000,
          recipientVendorName: "  ",
        },
      ];

      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: validActor,
        bookingId: "BKG-001",
        reservationId: "RES-001",
        roomNumber: "Villa 5",
        guestName: "Lord Mountbatten",
        category: "WILDLIFE_SAFARI",
        description: "Yala Morning Safari",
        passThroughItems: invalidVendor,
        hotelMarkupLkr: 15000,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "VALIDATION_FAILED");
      }
    });

    it("passes validation with well-formed input", () => {
      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: validActor,
        bookingId: "BKG-001",
        reservationId: "RES-001",
        roomNumber: "Villa 5",
        guestName: "Lord Mountbatten",
        category: "WILDLIFE_SAFARI",
        description: "Yala Morning Safari",
        passThroughItems: samplePassThroughItems,
        hotelMarkupLkr: 15000,
      };

      const valid = validateExcursionSplitInput(input);
      assert.equal(valid.ok, true);

      const actorCheck = validateActor(validActor, "TENANT-YALA-RESORT");
      assert.equal(actorCheck.ok, true);

      const itemCheck = validatePassThroughCostItem(
        samplePassThroughItems[0] as PassThroughCostItem,
      );
      assert.equal(itemCheck.ok, true);
    });
  });

  describe("3. Yala Safari Jeep + DWC Ticket Split Calculation (Step 358 Core)", () => {
    it("accurately computes 4-stage tax on hotel markup and protects DWC permit pass-through", () => {
      // Scenario:
      // DWC Yala Park Permit: 15,000 LKR (Pass-through, 0% SC, non-taxable)
      // Safari Jeep Hire: 25,000 LKR (Pass-through, 0% SC, non-taxable)
      // Hotel Handling Commission: 15,000 LKR (Taxable subject to 4-stage compounding)
      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: validActor,
        bookingId: "BKG-YALA-7701",
        reservationId: "RES-9901",
        roomNumber: "Luxury Tented Suite 03",
        guestName: "Sir David Attenborough",
        category: "WILDLIFE_SAFARI",
        description: "Yala National Park Block 1 Full Day Leopard Expedition",
        passThroughItems: samplePassThroughItems,
        hotelMarkupLkr: 15000,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const split = result.value;

      // 1. Pass-through total: 15,000 + 25,000 = 40,000 LKR
      assert.equal(split.totalPassThroughLkr, 40000);
      assert.equal(split.hotelTaxableBaseLkr, 15000);

      // 2. 4-Stage Taxes on 15,000 LKR Hotel Markup:
      // SC (10%) = 1,500 LKR
      assert.equal(split.taxBreakdown.scLkr, 1500);

      // Base + SC = 16,500
      // TDL (1%) = 16,500 * 0.01 = 165 LKR
      assert.equal(split.taxBreakdown.tdlLkr, 165);

      // SSCL (2.5%) = 16,500 * 0.025 = 412.50 LKR
      assert.equal(split.taxBreakdown.ssclLkr, 412.5);

      // VAT Base = 16,500 + 165 + 412.50 = 17,077.50 LKR
      // VAT (18%) = 17,077.50 * 0.18 = 3,073.95 LKR
      assert.equal(split.taxBreakdown.vatLkr, 3073.95);

      // Total Hotel Bill = 15,000 + 1,500 + 165 + 412.50 + 3,073.95 = 20,151.45 LKR
      assert.equal(split.totalHotelBillLkr, 20151.45);

      // Grand Total Guest Payable = 20,151.45 + 40,000 = 60,151.45 LKR
      assert.equal(split.grandTotalGuestPayableLkr, 60151.45);

      // 3. Tax Savings:
      // If hotel blindly taxed 55,000 LKR (40,000 + 15,000):
      // SC 10% = 5,500
      // TDL 1% = 60,500 * 0.01 = 605
      // SSCL 2.5% = 60,500 * 0.025 = 1,512.50
      // VAT 18% = 62,617.50 * 0.18 = 11,271.15
      // Bundled tax = 18,888.65 LKR
      // Actual hotel tax = 5,151.45 LKR
      // Savings = 18,888.65 - 5,151.45 = 13,737.20 LKR!
      assert.ok(split.unbundledTaxSavingsLkr > 13000);

      // 4. Vendor Payables:
      assert.equal(split.netVendorPayables.length, 2);
      const dwc = split.netVendorPayables.find(
        (v) => v.vendorName === "Department of Wildlife Conservation",
      );
      assert.ok(dwc);
      assert.equal(dwc?.totalPayableLkr, 15000);
      assert.equal(dwc?.isVatRegistered, true);

      const jeep = split.netVendorPayables.find(
        (v) => v.vendorName === "Ruhunu Safari Jeep Association",
      );
      assert.ok(jeep);
      assert.equal(jeep?.totalPayableLkr, 25000);
      assert.equal(jeep?.isVatRegistered, false);

      // 5. Folio Line Items:
      assert.equal(split.folioLineItems.length, 3);
      const passLines = split.folioLineItems.filter(
        (l) => l.category === "PASS_THROUGH_DISBURSEMENT",
      );
      assert.equal(passLines.length, 2);
      assert.ok(passLines.every((l) => l.isServiceChargeExempt === true && l.isTaxable === false));

      const commLine = split.folioLineItems.find((l) => l.category === "HOTEL_TOUR_COMMISSION");
      assert.ok(commLine);
      assert.equal(commLine?.amountLkr, 15000);
      assert.equal(commLine?.isServiceChargeExempt, false);
      assert.equal(commLine?.isTaxable, true);

      // 6. Audit Log Entry:
      assert.ok(split.auditEntry);
      assert.equal(split.auditEntry.action, "EXCURSION_SPLIT_POSTED");
      assert.equal(split.auditEntry.entityType, "ExcursionBooking");
      assert.equal(split.auditEntry.entityId, "BKG-YALA-7701");
      assert.ok(split.auditEntry.entryHash);
      assert.ok(split.auditEntry.prevHash);
    });

    it("aggregates multiple pass-through expenses for the same vendor", () => {
      const multipleItems: readonly PassThroughCostItem[] = [
        {
          type: "GOVERNMENT_WILDLIFE_PERMIT",
          description: "DWC Adult Entrance x 2",
          amountLkr: 20000,
          recipientVendorName: "Department of Wildlife Conservation",
          recipientVendorVatNumber: "V-DWC-001",
        },
        {
          type: "GOVERNMENT_WILDLIFE_PERMIT",
          description: "DWC Vehicle Entry Fee",
          amountLkr: 2500,
          recipientVendorName: "Department of Wildlife Conservation",
          recipientVendorVatNumber: "V-DWC-001",
        },
        {
          type: "GOVERNMENT_WILDLIFE_PERMIT",
          description: "DWC Wildlife Tracker Service Charge",
          amountLkr: 3000,
          recipientVendorName: "Department of Wildlife Conservation",
          recipientVendorVatNumber: "V-DWC-001",
        },
      ];

      const aggregated = aggregateVendorPayables(multipleItems);
      assert.equal(aggregated.length, 1);
      assert.equal(aggregated[0]?.vendorName, "Department of Wildlife Conservation");
      assert.equal(aggregated[0]?.totalPayableLkr, 25500); // 20000 + 2500 + 3000
    });

    it("handles zero pass-through (hotel-owned excursion vehicle)", () => {
      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: validActor,
        bookingId: "BKG-HOTEL-OWNED-01",
        reservationId: "RES-9902",
        roomNumber: "Villa 10",
        guestName: "Lady Sarah",
        category: "TEA_ESTATE_TRAIL",
        description: "Hotel Resort Land Cruiser Tea Tour",
        passThroughItems: [],
        hotelMarkupLkr: 30000,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.totalPassThroughLkr, 0);
      assert.equal(result.value.hotelTaxableBaseLkr, 30000);
      assert.equal(result.value.netVendorPayables.length, 0);
      assert.equal(result.value.folioLineItems.length, 1);
      assert.equal(result.value.unbundledTaxSavingsLkr, 0);
    });

    it("handles zero markup pass-through only booking", () => {
      const input: ExcursionSplitInput = {
        tenantId: "TENANT-YALA-RESORT",
        actor: validActor,
        bookingId: "BKG-CONCIERGE-ASSIST",
        reservationId: "RES-9903",
        roomNumber: "Villa 01",
        guestName: "Mr. Arthur Dent",
        category: "CULTURAL_HERITAGE",
        description: "Sigiriya Heritage Pass-Through Only",
        passThroughItems: [
          {
            type: "SLTDA_HERITAGE_TICKET",
            description: "Sigiriya Central Cultural Fund Ticket",
            amountLkr: 18000,
            recipientVendorName: "Central Cultural Fund",
          },
        ],
        hotelMarkupLkr: 0,
      };

      const result = computeExcursionFinancialSplit(input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.totalPassThroughLkr, 18000);
      assert.equal(result.value.hotelTaxableBaseLkr, 0);
      assert.equal(result.value.totalHotelBillLkr, 0);
      assert.equal(result.value.grandTotalGuestPayableLkr, 18000);
      assert.equal(result.value.folioLineItems.length, 1);
    });
  });

  describe("4. Type Contracts & Model Verification", () => {
    it("ensures all exported interfaces and types are constructible", () => {
      const dummyCategory: ExcursionCategory = "WHALE_WATCHING";
      assert.equal(dummyCategory, "WHALE_WATCHING");

      const dummyPassType: PassThroughType = "THIRD_PARTY_BOAT_HIRE";
      assert.equal(dummyPassType, "THIRD_PARTY_BOAT_HIRE");

      const dummyVendor: VendorPayableSummary = {
        vendorName: "Mirissa Whales Charter",
        passThroughType: "THIRD_PARTY_BOAT_HIRE",
        totalPayableLkr: 45000,
        isVatRegistered: false,
      };
      assert.equal(dummyVendor.vendorName, "Mirissa Whales Charter");

      const dummyLine: ExcursionFolioLineItem = {
        lineId: "LINE-1",
        description: "Permit",
        category: "PASS_THROUGH_DISBURSEMENT",
        amountLkr: 10000,
        isServiceChargeExempt: true,
        isTaxable: false,
      };
      assert.equal(dummyLine.lineId, "LINE-1");

      const lines = buildFolioLineItems("BKG-01", samplePassThroughItems, 10000, "WILDLIFE_SAFARI");
      assert.equal(lines.length, 3);
    });
  });
});
