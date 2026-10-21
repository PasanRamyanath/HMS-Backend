/**
 * @hms/core - Unit Tests for Pure Night Audit Aggregation Engine (nightAudit.test.ts)
 *
 * Implements Step 402 (Phase 17.02) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive unit test suite for statutory 23:59 SLST night audit calculations:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix:
 *    - Rejection of cross-tenant reservations, folio lines, and actors
 *    - Rejection of unauthorized roles (e.g., HOUSEKEEPING_RUNNER, WAITER)
 *    - Enforcement of SaasSubscription active state and plan tier entitlements
 *
 * 2. Room & Bed Occupancy Mathematics & Ratios:
 *    - Paid occupied rooms, complimentary rooms, and house-use rooms
 *    - Calculation of Room Occupancy % and Bed Occupancy %
 *    - Edge cases: 0 available rooms, 0 occupied rooms (no divide-by-zero)
 *
 * 3. SLTDA Guest Classification & Nationality Splitting:
 *    - Domestic Sri Lankan guest nights (LK, SRI_LANKAN_CITIZEN, RESIDENT_VISA)
 *    - Foreign tourist guest nights by country (UK, India, Germany, France, etc.)
 *    - Multi-occupancy room distribution (adults + children)
 *
 * 4. Revenue & 4-Stage Compounding Sri Lankan Tax Pools:
 *    - Category splits: Room, F&B, Spa, Excursion, Laundry
 *    - 10% Service Charge Pool for staff welfare
 *    - 1% Tourism Development Levy (TDL) for SLTDA remittance
 *    - 2.5% Social Security Contribution Levy (SSCL) for IRD
 *    - 18% Value Added Tax (VAT) for IRD
 *    - Tax-exempt and diplomatic exemptions
 *
 * 5. Hospitality Performance KPIs:
 *    - Average Daily Rate (ADR)
 *    - Revenue Per Available Room (RevPAR)
 *
 * 6. Cryptographic SHA-256 Hash-Chained Audit Trail Integrity:
 *    - Verification of audit log hash generation and payload authenticity
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENESIS_HASH, computeAuditEntryHash } from "../src/auditChain.js";
import {
  type InHouseReservationRecord,
  type NightAuditActor,
  type NightAuditFolioLineInput,
  type NightAuditSaasSubscription,
  isSriLankanDomestic,
  runNightAuditCalculation,
} from "../src/nightAudit.js";

const TEST_TENANT_ID = "cinnamon-grand-cmb";
const TEST_BUSINESS_DATE = "2026-10-21";

const AUTHORIZED_AUDITOR: NightAuditActor = {
  userId: "user-night-auditor-01",
  role: "NIGHT_AUDITOR",
  tenantId: TEST_TENANT_ID,
};

const ACTIVE_SUBSCRIPTION: NightAuditSaasSubscription = {
  tenantId: TEST_TENANT_ID,
  active: true,
  tier: "ENTERPRISE",
  allowsNightAudit: true,
};

describe("Step 401 & 402: Pure Night Audit Aggregation Engine (nightAudit.ts)", () => {
  describe("1. Multi-Tenant SaaS Isolation & RBAC Role Permission Matrix", () => {
    it("rejects invalid or empty tenantId with VALIDATION_FAILED", () => {
      const res = runNightAuditCalculation({
        tenantId: "",
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 50,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });

    it("rejects invalid business date format with VALIDATION_FAILED", () => {
      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: "21-10-2026", // Invalid format (needs YYYY-MM-DD)
        totalAvailableRooms: 50,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });

    it("rejects unauthorized actor roles with PERMISSION_DENIED", () => {
      const unauthorizedActor = {
        userId: "user-waiter-01",
        role: "WAITER" as unknown as NightAuditActor["role"],
        tenantId: TEST_TENANT_ID,
      };

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 50,
        reservations: [],
        actor: unauthorizedActor,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PERMISSION_DENIED");
      }
    });

    it("rejects actor tenant mismatch with TENANT_MISMATCH", () => {
      const crossTenantActor: NightAuditActor = {
        userId: "user-auditor-other",
        role: "NIGHT_AUDITOR",
        tenantId: "heritance-kandalama",
      };

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 50,
        reservations: [],
        actor: crossTenantActor,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects cross-tenant reservation records with TENANT_MISMATCH", () => {
      const crossTenantReservation: InHouseReservationRecord = {
        reservationId: "res-cross-01",
        tenantId: "jetwing-blue-negombo",
        roomNumber: "101",
        roomTypeId: "DELUXE_OCEAN",
        nationalityCountryCode: "GB",
        residencyTier: "FOREIGN_TOURIST",
        adultsCount: 2,
        childrenCount: 0,
        roomRateLkr: 45000,
      };

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 50,
        reservations: [crossTenantReservation],
        actor: AUTHORIZED_AUDITOR,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects cross-tenant folio line items with TENANT_MISMATCH", () => {
      const crossTenantFolioLine: NightAuditFolioLineInput = {
        folioLineId: "line-cross-01",
        tenantId: "jetwing-blue-negombo",
        category: "FOOD_AND_BEVERAGE",
        baseLkr: 12000,
      };

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 50,
        reservations: [],
        folioLines: [crossTenantFolioLine],
        actor: AUTHORIZED_AUDITOR,
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects inactive SaaS subscriptions with SUBSCRIPTION_INACTIVE", () => {
      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 50,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
        subscription: {
          tenantId: TEST_TENANT_ID,
          active: false,
        },
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "SUBSCRIPTION_INACTIVE");
      }
    });

    it("rejects unentitled plan tiers with PLAN_LIMITATION", () => {
      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 50,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
        subscription: {
          tenantId: TEST_TENANT_ID,
          active: true,
          allowsNightAudit: false,
        },
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PLAN_LIMITATION");
      }
    });
  });

  describe("2. Domestic vs Foreign Guest Helper (isSriLankanDomestic)", () => {
    it("accurately classifies Sri Lankan citizens and residents", () => {
      assert.strictEqual(isSriLankanDomestic("LK", "FOREIGN_TOURIST"), true);
      assert.strictEqual(isSriLankanDomestic("lk", "FOREIGN"), true);
      assert.strictEqual(isSriLankanDomestic("GB", "SRI_LANKAN_CITIZEN"), true);
      assert.strictEqual(isSriLankanDomestic("IN", "RESIDENT_VISA"), true);
      assert.strictEqual(isSriLankanDomestic("DE", "LOCAL"), true);
    });

    it("accurately classifies foreign non-resident tourists", () => {
      assert.strictEqual(isSriLankanDomestic("GB", "FOREIGN_TOURIST"), false);
      assert.strictEqual(isSriLankanDomestic("IN", "FOREIGN"), false);
      assert.strictEqual(isSriLankanDomestic("DE", undefined), false);
      assert.strictEqual(isSriLankanDomestic(undefined, "FOREIGN_TOURIST"), false);
    });
  });

  describe("3. Edge Cases: 0 Available Rooms, 0 Occupied Rooms (Rung 5)", () => {
    it("handles 0 available rooms cleanly without divide-by-zero (occupancy=0%, RevPAR=0)", () => {
      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 0,
        totalAvailableBeds: 0,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.totalAvailableRooms, 0);
        assert.strictEqual(res.value.occupiedRooms, 0);
        assert.strictEqual(res.value.roomOccupancyRate, 0);
        assert.strictEqual(res.value.bedOccupancyRate, 0);
        assert.strictEqual(res.value.adrLkr, 0);
        assert.strictEqual(res.value.revParLkr, 0);
        assert.strictEqual(res.value.totalNetRevenueLkr, 0);
      }
    });

    it("handles 0 occupied rooms when rooms are available (occupancy=0%, ADR=0, RevPAR=0)", () => {
      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 100,
        totalAvailableBeds: 200,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.totalAvailableRooms, 100);
        assert.strictEqual(res.value.occupiedRooms, 0);
        assert.strictEqual(res.value.roomOccupancyRate, 0);
        assert.strictEqual(res.value.occupiedBeds, 0);
        assert.strictEqual(res.value.bedOccupancyRate, 0);
        assert.strictEqual(res.value.adrLkr, 0);
        assert.strictEqual(res.value.revParLkr, 0);
        assert.strictEqual(res.value.totalGuests, 0);
      }
    });

    it("handles only complimentary & house-use rooms (revenueRooms=0, ADR=0)", () => {
      const reservations: InHouseReservationRecord[] = [
        {
          reservationId: "res-comp-01",
          tenantId: TEST_TENANT_ID,
          roomNumber: "101",
          roomTypeId: "SUPERIOR",
          nationalityCountryCode: "GB",
          residencyTier: "FOREIGN_TOURIST",
          adultsCount: 2,
          childrenCount: 0,
          isComplimentary: true,
        },
        {
          reservationId: "res-house-01",
          tenantId: TEST_TENANT_ID,
          roomNumber: "102",
          roomTypeId: "SUPERIOR",
          nationalityCountryCode: "LK",
          residencyTier: "SRI_LANKAN_CITIZEN",
          adultsCount: 1,
          childrenCount: 0,
          isHouseUse: true,
        },
      ];

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 10,
        totalAvailableBeds: 20,
        reservations,
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.occupiedRooms, 2);
        assert.strictEqual(res.value.complimentaryRooms, 1);
        assert.strictEqual(res.value.houseUseRooms, 1);
        assert.strictEqual(res.value.revenueRooms, 0);
        assert.strictEqual(res.value.roomOccupancyRate, 20.0);
        assert.strictEqual(res.value.roomRevenueLkr, 0);
        assert.strictEqual(res.value.adrLkr, 0);
        assert.strictEqual(res.value.revParLkr, 0);
      }
    });
  });

  describe("4. Multi-Occupancy Foreign & Local Guest-Night Splitting", () => {
    it("accurately splits guest nights across British, Indian, German, and Sri Lankan guests", () => {
      const reservations: InHouseReservationRecord[] = [
        // UK family: 2 adults, 2 children = 4 foreign guest nights
        {
          reservationId: "res-uk-01",
          tenantId: TEST_TENANT_ID,
          roomNumber: "201",
          roomTypeId: "FAMILY_SUITE",
          nationalityCountryCode: "GB",
          residencyTier: "FOREIGN_TOURIST",
          adultsCount: 2,
          childrenCount: 2,
          roomRateLkr: 60000,
        },
        // Indian couple: 2 adults = 2 foreign guest nights
        {
          reservationId: "res-in-01",
          tenantId: TEST_TENANT_ID,
          roomNumber: "202",
          roomTypeId: "DELUXE",
          nationalityCountryCode: "IN",
          residencyTier: "FOREIGN_TOURIST",
          adultsCount: 2,
          childrenCount: 0,
          roomRateLkr: 40000,
        },
        // German solo traveler: 1 adult = 1 foreign guest night
        {
          reservationId: "res-de-01",
          tenantId: TEST_TENANT_ID,
          roomNumber: "203",
          roomTypeId: "STANDARD",
          nationalityCountryCode: "DE",
          residencyTier: "FOREIGN_TOURIST",
          adultsCount: 1,
          childrenCount: 0,
          roomRateLkr: 30000,
        },
        // Sri Lankan family: 2 adults, 1 child = 3 local guest nights
        {
          reservationId: "res-lk-01",
          tenantId: TEST_TENANT_ID,
          roomNumber: "204",
          roomTypeId: "FAMILY_DELUXE",
          nationalityCountryCode: "LK",
          residencyTier: "SRI_LANKAN_CITIZEN",
          adultsCount: 2,
          childrenCount: 1,
          roomRateLkr: 35000,
        },
      ];

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 10,
        totalAvailableBeds: 25,
        reservations,
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val = res.value;
        assert.strictEqual(val.occupiedRooms, 4);
        assert.strictEqual(val.roomOccupancyRate, 40.0);

        // Foreign guests: 4 (UK) + 2 (IN) + 1 (DE) = 7
        assert.strictEqual(val.totalForeignGuests, 7);
        assert.strictEqual(val.foreignGuestNights, 7);

        // Local guests: 3 (LK) = 3
        assert.strictEqual(val.totalLocalGuests, 3);
        assert.strictEqual(val.localGuestNights, 3);

        // Total: 10
        assert.strictEqual(val.totalGuests, 10);
        assert.strictEqual(val.totalGuestNights, 10);
        assert.strictEqual(val.occupiedBeds, 10);
        assert.strictEqual(val.bedOccupancyRate, 40.0); // 10 / 25 * 100 = 40.0%

        // Nationality breakdown
        assert.strictEqual(val.nationalityBreakdown.GB.guestCount, 4);
        assert.strictEqual(val.nationalityBreakdown.GB.isDomestic, false);

        assert.strictEqual(val.nationalityBreakdown.IN.guestCount, 2);
        assert.strictEqual(val.nationalityBreakdown.IN.isDomestic, false);

        assert.strictEqual(val.nationalityBreakdown.DE.guestCount, 1);
        assert.strictEqual(val.nationalityBreakdown.DE.isDomestic, false);

        assert.strictEqual(val.nationalityBreakdown.LK.guestCount, 3);
        assert.strictEqual(val.nationalityBreakdown.LK.isDomestic, true);

        // Room Revenue: 60,000 + 40,000 + 30,000 + 35,000 = 165,000
        assert.strictEqual(val.roomRevenueLkr, 165000);
        // ADR: 165,000 / 4 = 41,250.00
        assert.strictEqual(val.adrLkr, 41250);
        // RevPAR: 165,000 / 10 = 16,500.00
        assert.strictEqual(val.revParLkr, 16500);
      }
    });
  });

  describe("5. 4-Stage Compounding Statutory Tax Pools & Folio Aggregation", () => {
    it("aggregates folio lines across Room, F&B, and Spa with exact compounding math", () => {
      // Base: Room 100,000 + F&B 50,000 + Spa 25,000 = 175,000
      const folioLines: NightAuditFolioLineInput[] = [
        {
          folioLineId: "line-room-01",
          tenantId: TEST_TENANT_ID,
          category: "ROOM",
          baseLkr: 100000,
        },
        {
          folioLineId: "line-fb-01",
          tenantId: TEST_TENANT_ID,
          category: "FOOD_AND_BEVERAGE",
          baseLkr: 50000,
        },
        {
          folioLineId: "line-spa-01",
          tenantId: TEST_TENANT_ID,
          category: "SPA",
          baseLkr: 25000,
        },
      ];

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 20,
        reservations: [
          {
            reservationId: "res-01",
            tenantId: TEST_TENANT_ID,
            roomNumber: "101",
            roomTypeId: "DELUXE",
            nationalityCountryCode: "GB",
            residencyTier: "FOREIGN_TOURIST",
            adultsCount: 2,
            childrenCount: 0,
          },
        ],
        folioLines,
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val = res.value;
        assert.strictEqual(val.roomRevenueLkr, 100000);
        assert.strictEqual(val.fAndBRevenueLkr, 50000);
        assert.strictEqual(val.otherRevenueLkr, 25000);
        assert.strictEqual(val.totalNetRevenueLkr, 175000);

        // Verification of 4-stage tax pools for total base 175,000:
        // SC (10%) = 17,500.00
        // Subtotal A = 192,500.00
        // TDL (1%) = 1,925.00
        // SSCL (2.5%) = 4,812.50
        // VAT Base = 192,500 + 1,925 + 4,812.50 = 199,237.50
        // VAT (18%) = 35,862.75
        // Total Tax & Levy = 1,925 + 4,812.50 + 35,862.75 = 42,600.25
        // Grand Total = 175,000 + 17,500 + 42,600.25 = 235,100.25
        assert.strictEqual(val.serviceChargePoolLkr, 17500);
        assert.strictEqual(val.tdlPoolLkr, 1925);
        assert.strictEqual(val.ssclPoolLkr, 4812.5);
        assert.strictEqual(val.vatPoolLkr, 35862.75);
        assert.strictEqual(val.totalTaxAndLevyLkr, 42600.25);
        assert.strictEqual(val.grandTotalRevenueLkr, 235100.25);
      }
    });

    it("handles zero-tax exemptions correctly (taxExempt = true)", () => {
      const folioLines: NightAuditFolioLineInput[] = [
        {
          folioLineId: "line-exempt-01",
          tenantId: TEST_TENANT_ID,
          category: "ROOM",
          baseLkr: 80000,
          taxExempt: true,
        },
      ];

      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 10,
        reservations: [
          {
            reservationId: "res-embassy-01",
            tenantId: TEST_TENANT_ID,
            roomNumber: "PH-1",
            roomTypeId: "PRESIDENTIAL",
            nationalityCountryCode: "US",
            residencyTier: "FOREIGN_TOURIST",
            adultsCount: 1,
            childrenCount: 0,
            isTaxExempt: true,
          },
        ],
        folioLines,
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val = res.value;
        assert.strictEqual(val.roomRevenueLkr, 80000);
        assert.strictEqual(val.serviceChargePoolLkr, 0);
        assert.strictEqual(val.tdlPoolLkr, 0);
        assert.strictEqual(val.ssclPoolLkr, 0);
        assert.strictEqual(val.vatPoolLkr, 0);
        assert.strictEqual(val.totalTaxAndLevyLkr, 0);
        assert.strictEqual(val.grandTotalRevenueLkr, 80000);
      }
    });
  });

  describe("6. Cryptographic SHA-256 Hash-Chained Audit Trail Integrity", () => {
    it("generates a cryptographically valid ImmutableAuditLog entry anchored to prevHash", () => {
      const prevHash = "a".repeat(64);
      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 20,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
        prevAuditHash: prevHash,
        timestamp: "2026-10-21T23:59:00.000Z",
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const audit = res.value.auditLog;
        assert.strictEqual(audit.tenantId, TEST_TENANT_ID);
        assert.strictEqual(audit.actorUserId, AUTHORIZED_AUDITOR.userId);
        assert.strictEqual(audit.action, "NIGHT_AUDIT_EXECUTED");
        assert.strictEqual(audit.entityType, "NightAudit");
        assert.strictEqual(audit.entityId, `${TEST_TENANT_ID}#${TEST_BUSINESS_DATE}`);
        assert.strictEqual(audit.prevHash, prevHash);

        const expectedHash = computeAuditEntryHash({
          prevHash,
          tenantId: TEST_TENANT_ID,
          actorUserId: AUTHORIZED_AUDITOR.userId,
          action: "NIGHT_AUDIT_EXECUTED",
          entityType: "NightAudit",
          entityId: `${TEST_TENANT_ID}#${TEST_BUSINESS_DATE}`,
          isoTs: "2026-10-21T23:59:00.000Z",
          afterJson: audit.afterJson,
        });

        assert.strictEqual(audit.entryHash, expectedHash);
      }
    });

    it("defaults prevHash to GENESIS_HASH when omitted", () => {
      const res = runNightAuditCalculation({
        tenantId: TEST_TENANT_ID,
        businessDate: TEST_BUSINESS_DATE,
        totalAvailableRooms: 20,
        reservations: [],
        actor: AUTHORIZED_AUDITOR,
        subscription: ACTIVE_SUBSCRIPTION,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.auditLog.prevHash, GENESIS_HASH);
      }
    });
  });
});
