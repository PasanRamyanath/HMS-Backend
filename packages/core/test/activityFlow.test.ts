/**
 * @hms/core - End-to-End Excursion Booking, Packed Breakfast Trigger & Split Folio Posting (activityFlow.test.ts)
 *
 * Implements Step 374 (Phase 15.24) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Validates the complete resort activity & excursion guest lifecycle:
 *
 * 1. Multi-Tenant SaaS Isolation & Staff RBAC Permissions:
 *    - Strict tenant boundary checking across resorts (Yala vs Ella).
 *    - RBAC authorization matrix across EXCURSION_OFFICER, CONCIERGE, FRONT_DESK vs unauthorized roles.
 *    - SaaS feature entitlement check for resort activities & wellness module.
 * 2. Resource Conflict Detection (Rung 6 & Rung 5 Scheduler):
 *    - 4x4 Safari Jeep & Naturalist Guide interval scheduling with turnaround buffers.
 *    - Rejection of overlapping slots and buffer collisions.
 *    - Successful non-overlapping afternoon slot scheduling.
 * 3. Early Morning Departure Intelligence -> Kitchen Packed Breakfast Trigger:
 *    - Identifies departures before 07:30 AM (e.g., Yala Safari at 05:30 AM).
 *    - Meal-plan aware KDS routing: complimentary ($0) for BB/HB/FB/AI vs charged for RO.
 *    - Honors guest dietary specifications (Sri Lankan vs Continental).
 * 4. Pass-Through vs Taxable Hotel Markup Split Folio Posting:
 *    - Separates non-taxable agency pass-through (DWC Wildlife permits + Jeep hire) from hotel markup.
 *    - Prevents ~34.34% statutory tax overpayment on government wildlife fees.
 *    - Applies 4-stage compounding statutory taxes (SC -> TDL -> SSCL -> VAT) strictly to hotel markup.
 *    - Sub-folio routing to GUEST_PERSONAL or MASTER_DMC.
 * 5. Cryptographic SHA-256 Hash-Chained Immutable Audit Trail:
 *    - Multi-step state mutation audit chaining from slot reservation to folio posting.
 *    - Strict verification of chain integrity via verifyAuditChain.
 *
 * Strictly zero console noise, zero external npm dependencies.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type ExcursionActor,
  type ExcursionSplitInput,
  GENESIS_HASH,
  type PassThroughCostItem,
  type ResourceActor,
  type ResourceSlot,
  aggregateVendorPayables,
  buildFolioLineItems,
  calculateForwardTax,
  checkResourceSlotConflict,
  computeAuditEntryHash,
  computeExcursionFinancialSplit,
  createAuditEntry,
  createFolioPartitionKey,
  determineDefaultTarget,
  isAuthorizedExcursionRole,
  isPlanEligibleForSlot,
  roundLkr,
  scheduleDualResourceSlots,
  scheduleResourceSlot,
  validateTenantId,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant RBAC & SaaS Subscription Fixtures
// ============================================================================

const TENANT_YALA = "TENANT-YALA-LUXURY-RESORT";
const TENANT_ELLA = "TENANT-ELLA-TEA-VILLAS";

const validExcursionActor: ExcursionActor = {
  userId: "USR-EXCURSION-01",
  role: "EXCURSION_OFFICER",
  tenantId: TENANT_YALA,
};

const validResourceActor: ResourceActor = {
  userId: "USR-CONCIERGE-02",
  role: "CONCIERGE",
  tenantId: TENANT_YALA,
};

interface SaasSubscription {
  readonly tenantId: string;
  readonly planTier: "BOUTIQUE_VILLA" | "RESORT_ENTERPRISE";
  readonly enabledModules: readonly string[];
  readonly status: "ACTIVE" | "SUSPENDED";
}

function checkActivityEntitlement(sub: SaasSubscription): boolean {
  return sub.status === "ACTIVE" && sub.enabledModules.includes("ACTIVITIES_AND_SPA");
}

// ============================================================================
// Packed Breakfast Box Helper (Early Morning Safari Departure Trigger)
// ============================================================================

interface PackedBreakfastTriggerResult {
  readonly isEarlyMorningDeparture: boolean;
  readonly departureTime: string;
  readonly guestCount: number;
  readonly mealPlan: "RO" | "BB" | "HB" | "FB" | "AI";
  readonly isComplimentary: boolean;
  readonly unitPriceLkr: number;
  readonly totalChargeLkr: number;
  readonly kdsTicketNotes: string;
}

function evaluateEarlyMorningPackedBreakfast(
  departureIso: string,
  guestCount: number,
  mealPlan: "RO" | "BB" | "HB" | "FB" | "AI",
  dietaryPreference: "SRI_LANKAN_ROTI" | "CONTINENTAL_BAKERY",
): PackedBreakfastTriggerResult {
  const departureDate = new Date(departureIso);
  const departureHour = departureDate.getUTCHours();
  const departureMinute = departureDate.getUTCMinutes();
  const departureTimeStr = `${String(departureHour).padStart(2, "0")}:${String(
    departureMinute,
  ).padStart(2, "0")}`;

  // Early morning departure is strictly before 07:30 AM
  const totalMinutes = departureHour * 60 + departureMinute;
  const isEarly = totalMinutes < 7 * 60 + 30;

  const isIncluded = isPlanEligibleForSlot(mealPlan, "BREAKFAST");
  const unitPrice = isIncluded ? 0 : 2500;
  const totalCharge = roundLkr(unitPrice * Math.max(1, guestCount));

  const boxLabel =
    dietaryPreference === "SRI_LANKAN_ROTI"
      ? "Sri Lankan Pol Roti Box (Lunu Miris, Boiled Farm Egg, Fresh Banana)"
      : "Continental Bakery Box (Croissants, Jam, Butter, Boiled Egg, Apple)";

  const notes = `KDS PACKED BREAKFAST: ${guestCount}x ${boxLabel} for early safari departure at ${departureTimeStr} UTC. Status: ${
    isIncluded ? "COMPLIMENTARY_INCLUDED" : `CHARGEABLE_LKR_${totalCharge}`
  }`;

  return {
    isEarlyMorningDeparture: isEarly,
    departureTime: departureTimeStr,
    guestCount,
    mealPlan,
    isComplimentary: isIncluded,
    unitPriceLkr: unitPrice,
    totalChargeLkr: totalCharge,
    kdsTicketNotes: notes,
  };
}

// ============================================================================
// Audit Chain Step Builder (Cognitive Complexity <= 8)
// ============================================================================

function appendAuditStep(
  chain: AuditLogEntry[],
  prevHash: string,
  action: string,
  entityType: string,
  entityId: string,
  isoTs: string,
  payload: Record<string, unknown>,
): string {
  const res = createAuditEntry({
    tenantId: TENANT_YALA,
    actorUserId: validResourceActor.userId,
    action,
    entityType,
    entityId,
    isoTs,
    afterJson: JSON.stringify(payload),
    prevHash,
  });

  if (!res.ok) {
    throw new Error(`Failed to create audit entry: ${res.error.message}`);
  }

  chain.push(res.value);
  return res.value.entryHash;
}

// ============================================================================
// Test Suite: Step 374 (activityFlow.test.ts)
// ============================================================================

describe("Step 374: End-to-End Excursion Booking, Packed Breakfast Trigger & Split Folio Posting", () => {
  describe("1. Multi-Tenant SaaS Isolation & Staff RBAC Permissions", () => {
    it("validates strict tenant boundary and rejects cross-tenant scheduling", () => {
      assert.equal(validateTenantId(TENANT_YALA).ok, true);
      assert.equal(validateTenantId(TENANT_ELLA).ok, true);
      assert.equal(validateTenantId("").ok, false);

      // Attempting to schedule a slot under mismatched tenant
      const crossTenantResult = scheduleResourceSlot(
        validResourceActor, // Actor belonging to Yala
        {
          tenantId: TENANT_ELLA, // Slot requested for Ella
          resourceCategory: "SAFARI_VEHICLE",
          resourceId: "JEEP-01",
          bookingRef: "EXC-CROSS-001",
          startIso: "2026-06-15T05:30:00Z",
          endIso: "2026-06-15T10:30:00Z",
        },
        [],
        "SLOT-CROSS-01",
        "2026-06-15T04:00:00Z",
      );

      assert.equal(crossTenantResult.ok, false);
      if (!crossTenantResult.ok) {
        assert.equal(crossTenantResult.error.code, "TENANT_MISMATCH");
      }
    });

    it("enforces RolePermissionMatrix RBAC across authorized & unauthorized staff", () => {
      assert.equal(isAuthorizedExcursionRole("SUPER_ADMIN"), true);
      assert.equal(isAuthorizedExcursionRole("HOTEL_ADMIN"), true);
      assert.equal(isAuthorizedExcursionRole("EXCURSION_OFFICER"), true);
      assert.equal(isAuthorizedExcursionRole("CONCIERGE"), true);
      assert.equal(isAuthorizedExcursionRole("FRONT_DESK"), true);

      // Unauthorized operational roles
      assert.equal(isAuthorizedExcursionRole("HOUSEKEEPING_ATTENDANT"), false);
      assert.equal(isAuthorizedExcursionRole("MAINTENANCE_TECH"), false);
      assert.equal(isAuthorizedExcursionRole("GUEST"), false);
    });

    it("verifies multi-tenant SaaS subscription feature entitlements", () => {
      const activeResortSub: SaasSubscription = {
        tenantId: TENANT_YALA,
        planTier: "RESORT_ENTERPRISE",
        enabledModules: ["CORE_PMS", "RESTAURANT_POS", "ACTIVITIES_AND_SPA"],
        status: "ACTIVE",
      };

      const boutiqueSubNoActivities: SaasSubscription = {
        tenantId: TENANT_ELLA,
        planTier: "BOUTIQUE_VILLA",
        enabledModules: ["CORE_PMS"],
        status: "ACTIVE",
      };

      assert.equal(checkActivityEntitlement(activeResortSub), true);
      assert.equal(checkActivityEntitlement(boutiqueSubNoActivities), false);
    });
  });

  describe("2. Resource Interval Conflict Checking (Rung 6 & Rung 5 Scheduler)", () => {
    it("successfully books a dual-resource slot (Safari Jeep + Naturalist Guide)", () => {
      const existingSlots: readonly ResourceSlot[] = [];

      const bookingRes = scheduleDualResourceSlots(
        validResourceActor,
        {
          tenantId: TENANT_YALA,
          primaryCategory: "SAFARI_VEHICLE",
          primaryResourceId: "JEEP-YALA-09",
          primaryResourceName: "Palatupana 4x4 Land Cruiser #09",
          secondaryCategory: "EXCURSION_GUIDE",
          secondaryResourceId: "GUIDE-ANURA",
          secondaryResourceName: "Anura Wickramasinghe (Senior Naturalist)",
          bookingRef: "BK-YALA-001",
          guestName: "Lord Julian Alistair",
          guestRoomNumber: "VILLA-04",
          serviceName: "Yala National Park Leopard Dawn Safari (Block 1)",
          startIso: "2026-06-15T05:30:00Z",
          endIso: "2026-06-15T11:00:00Z",
          primaryBufferMinutes: 30, // Vehicle inspection and wash buffer
          priceLkr: 45000,
        },
        existingSlots,
        "SLOT-DUAL-01",
        "SLOT-DUAL-02",
        "2026-06-15T04:00:00Z",
        DEFAULT_SRI_LANKA_TAX_CONFIG,
        GENESIS_HASH,
      );

      assert.equal(bookingRes.ok, true);
      if (bookingRes.ok) {
        assert.equal(bookingRes.value.primarySlot.resourceId, "JEEP-YALA-09");
        assert.equal(bookingRes.value.secondarySlot.resourceId, "GUIDE-ANURA");
        assert.equal(bookingRes.value.primarySlot.status, "CONFIRMED");
        assert.equal(bookingRes.value.primarySlot.turnaroundBufferMinutes, 30);
        assert.ok(bookingRes.value.auditEntry.entryHash.length > 0);
      }
    });

    it("detects and rejects overlapping conflict on the same vehicle", () => {
      const confirmedMorningSlot: ResourceSlot = {
        slotId: "SLOT-01",
        tenantId: TENANT_YALA,
        resourceCategory: "SAFARI_VEHICLE",
        resourceId: "JEEP-YALA-09",
        resourceName: "Palatupana 4x4 Land Cruiser #09",
        bookingRef: "BK-YALA-001",
        startIso: "2026-06-15T05:30:00Z",
        endIso: "2026-06-15T11:00:00Z",
        turnaroundBufferMinutes: 30,
        status: "CONFIRMED",
      };

      // Conflicting candidate: starts during the morning game drive
      const conflictCheck = checkResourceSlotConflict(
        {
          tenantId: TENANT_YALA,
          resourceCategory: "SAFARI_VEHICLE",
          resourceId: "JEEP-YALA-09",
          bookingRef: "BK-YALA-CONFLICT",
          startIso: "2026-06-15T08:00:00Z",
          endIso: "2026-06-15T12:00:00Z",
        },
        [confirmedMorningSlot],
      );

      assert.equal(conflictCheck.ok, true);
      if (conflictCheck.ok) {
        assert.equal(conflictCheck.value.hasConflict, true);
        assert.equal(conflictCheck.value.conflicts.length, 1);
        const overlap = conflictCheck.value.conflicts[0]?.overlapMinutes ?? 0;
        assert.ok(overlap > 0);
      }

      // Conflict within the 30-minute turnaround buffer (11:00 - 11:30)
      const bufferConflictCheck = checkResourceSlotConflict(
        {
          tenantId: TENANT_YALA,
          resourceCategory: "SAFARI_VEHICLE",
          resourceId: "JEEP-YALA-09",
          bookingRef: "BK-YALA-BUFFER-COLLISION",
          startIso: "2026-06-15T11:15:00Z",
          endIso: "2026-06-15T15:00:00Z",
        },
        [confirmedMorningSlot],
      );

      assert.equal(bufferConflictCheck.ok, true);
      if (bufferConflictCheck.ok) {
        assert.equal(bufferConflictCheck.value.hasConflict, true);
      }

      // Valid afternoon slot after turnaround buffer (starts 14:00)
      const afternoonCheck = checkResourceSlotConflict(
        {
          tenantId: TENANT_YALA,
          resourceCategory: "SAFARI_VEHICLE",
          resourceId: "JEEP-YALA-09",
          bookingRef: "BK-YALA-AFTERNOON",
          startIso: "2026-06-15T14:00:00Z",
          endIso: "2026-06-15T18:30:00Z",
        },
        [confirmedMorningSlot],
      );

      assert.equal(afternoonCheck.ok, true);
      if (afternoonCheck.ok) {
        assert.equal(afternoonCheck.value.hasConflict, false);
      }
    });
  });

  describe("3. Early Morning Departure Intelligence -> Kitchen Packed Breakfast Trigger", () => {
    it("automatically triggers complimentary packed breakfast for Bed & Breakfast (BB) guest", () => {
      const departureIso = "2026-06-15T05:30:00Z"; // 05:30 AM (before 07:30 AM)
      const guestPax = 2;
      const mealPlan = "BB";

      const trigger = evaluateEarlyMorningPackedBreakfast(
        departureIso,
        guestPax,
        mealPlan,
        "SRI_LANKAN_ROTI",
      );

      assert.equal(trigger.isEarlyMorningDeparture, true);
      assert.equal(trigger.isComplimentary, true);
      assert.equal(trigger.unitPriceLkr, 0);
      assert.equal(trigger.totalChargeLkr, 0);
      assert.ok(trigger.kdsTicketNotes.includes("COMPLIMENTARY_INCLUDED"));
      assert.ok(trigger.kdsTicketNotes.includes("Pol Roti Box"));
    });

    it("triggers chargeable packed breakfast box for Room Only (RO) guest", () => {
      const departureIso = "2026-06-15T05:30:00Z";
      const guestPax = 3;
      const mealPlan = "RO";

      const trigger = evaluateEarlyMorningPackedBreakfast(
        departureIso,
        guestPax,
        mealPlan,
        "CONTINENTAL_BAKERY",
      );

      assert.equal(trigger.isEarlyMorningDeparture, true);
      assert.equal(trigger.isComplimentary, false);
      assert.equal(trigger.unitPriceLkr, 2500);
      assert.equal(trigger.totalChargeLkr, 7500); // 3 * 2500
      assert.ok(trigger.kdsTicketNotes.includes("CHARGEABLE_LKR_7500"));
      assert.ok(trigger.kdsTicketNotes.includes("Continental Bakery Box"));
    });

    it("does not trigger early packed breakfast for late morning departures (09:00 AM)", () => {
      const departureIso = "2026-06-15T09:00:00Z"; // 09:00 AM (after 07:30 AM)
      const trigger = evaluateEarlyMorningPackedBreakfast(departureIso, 2, "BB", "SRI_LANKAN_ROTI");

      assert.equal(trigger.isEarlyMorningDeparture, false);
    });
  });

  describe("4. Pass-Through vs Taxable Hotel Markup Split Folio Posting", () => {
    const samplePassThroughItems: readonly PassThroughCostItem[] = [
      {
        type: "GOVERNMENT_WILDLIFE_PERMIT",
        description: "DWC Yala National Park Block 1 Entrance Tickets (2 Foreign Adults)",
        amountLkr: 16000,
        recipientVendorName: "Department of Wildlife Conservation (DWC)",
        recipientVendorVatNumber: "V-DWC-00192",
      },
      {
        type: "THIRD_PARTY_VEHICLE_HIRE",
        description: "Palatupana Safari 4x4 Land Cruiser Hire & Fuel",
        amountLkr: 20000,
        recipientVendorName: "Ruhunu Safari Jeep Association",
      },
    ];

    it("computes accurate financial split and isolates statutory taxes strictly to hotel markup", () => {
      const splitInput: ExcursionSplitInput = {
        tenantId: TENANT_YALA,
        actor: validExcursionActor,
        bookingId: "BK-YALA-001",
        reservationId: "RES-YALA-042",
        roomNumber: "VILLA-04",
        guestName: "Lord Julian Alistair",
        category: "SAFARI",
        description: "Yala National Park Leopard Dawn Safari",
        passThroughItems: samplePassThroughItems, // Total 36,000 pass-through
        hotelMarkupLkr: 9000,
      };

      const splitRes = computeExcursionFinancialSplit(splitInput);

      assert.equal(splitRes.ok, true);
      if (splitRes.ok) {
        const split = splitRes.value;
        // Total Pass-Through: 16,000 + 20,000 = 36,000
        assert.equal(split.totalPassThroughLkr, 36000);
        // Hotel Gross Markup: 9,000
        assert.equal(split.hotelTaxableBaseLkr, 9000);

        // Statutory 4-Stage Taxes on Hotel Markup (9,000):
        // 10% Service Charge = 900
        assert.equal(split.taxBreakdown.scLkr, 900);
        // Total hotel taxes: SC + TDL + SSCL + VAT
        const hotelTaxesLkr = roundLkr(
          split.taxBreakdown.grandTotalLkr - split.taxBreakdown.baseLkr,
        );
        assert.ok(hotelTaxesLkr > 0);
        // Hotel Total Bill = 9,000 + taxes
        assert.equal(split.totalHotelBillLkr, split.taxBreakdown.grandTotalLkr);
        // Grand Total Billed to Guest Folio = 36,000 (Pass-Through) + Total Hotel Bill
        assert.equal(split.grandTotalGuestPayableLkr, roundLkr(36000 + split.totalHotelBillLkr));
      }
    });

    it("verifies prevention of 34.34% tax overpayment on government wildlife permits", () => {
      // If hotel naively applied taxes to the whole 45,000:
      const naiveTaxRes = calculateForwardTax(45000, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.equal(naiveTaxRes.ok, true);

      // Compliant split: taxes applied only on 9,000 hotel markup:
      const compliantSplitRes = computeExcursionFinancialSplit({
        tenantId: TENANT_YALA,
        actor: validExcursionActor,
        bookingId: "BK-YALA-001",
        reservationId: "RES-YALA-042",
        roomNumber: "VILLA-04",
        guestName: "Lord Julian Alistair",
        category: "SAFARI",
        description: "Yala National Park Leopard Dawn Safari",
        passThroughItems: samplePassThroughItems,
        hotelMarkupLkr: 9000,
      });

      assert.equal(compliantSplitRes.ok, true);
      if (naiveTaxRes.ok && compliantSplitRes.ok) {
        const naiveTaxes = roundLkr(naiveTaxRes.value.grandTotalLkr - naiveTaxRes.value.baseLkr);
        const compliantTaxes = roundLkr(
          compliantSplitRes.value.taxBreakdown.grandTotalLkr -
            compliantSplitRes.value.taxBreakdown.baseLkr,
        );

        // Taxes saved for guest on government fees
        const taxSavings = roundLkr(naiveTaxes - compliantTaxes);
        assert.ok(
          taxSavings > 10000,
          "Should save over LKR 10,000 in unfair tax loading on DWC permits",
        );
        assert.equal(compliantSplitRes.value.unbundledTaxSavingsLkr, taxSavings);
      }
    });

    it("builds discrete folio line items and aggregates vendor payables", () => {
      const folioLines = buildFolioLineItems("BK-YALA-001", samplePassThroughItems, 9000, "SAFARI");

      assert.equal(folioLines.length, 3); // 2 disbursements + 1 hotel markup line
      assert.equal(folioLines[0]?.isTaxable, false);
      assert.equal(folioLines[0]?.isServiceChargeExempt, true);
      assert.equal(folioLines[1]?.isTaxable, false);
      assert.equal(folioLines[2]?.isTaxable, true);
      assert.equal(folioLines[2]?.amountLkr, 9000);

      const payables = aggregateVendorPayables(samplePassThroughItems);
      assert.equal(payables.length, 2);
      assert.equal(payables[0]?.vendorName, "Department of Wildlife Conservation (DWC)");
      assert.equal(payables[0]?.totalPayableLkr, 16000);
      assert.equal(payables[0]?.isVatRegistered, true);
      assert.equal(payables[1]?.vendorName, "Ruhunu Safari Jeep Association");
      assert.equal(payables[1]?.totalPayableLkr, 20000);
    });

    it("routes sub-folio lines to GUEST_PERSONAL or MASTER_DMC according to voucher rules", () => {
      // 1. Direct Guest Booking -> Incidentals & Excursions route to GUEST_PERSONAL
      const directTarget = determineDefaultTarget("EXCURSION", {
        tenantId: TENANT_YALA,
        reservationId: "RES-001",
        billingType: "DIRECT_GUEST",
      });
      assert.equal(directTarget, "GUEST_PERSONAL");
      assert.equal(
        createFolioPartitionKey("RES-001", directTarget),
        "FOLIO#RES-001#GUEST_PERSONAL",
      );

      // 2. DMC / Tour Operator Voucher covering EXCURSION -> routes to MASTER_DMC
      const dmcTarget = determineDefaultTarget("EXCURSION", {
        tenantId: TENANT_YALA,
        reservationId: "RES-002",
        billingType: "DMC_VOUCHER",
        dmcCoverage: {
          contractId: "DMC-KUONI-01",
          voucherNumber: "VOUCHER-9876",
          tourOperatorName: "Kuoni Travel UK",
          includedMealPlan: "HB",
          coveredCategories: ["ROOM", "MEAL_PLAN", "EXCURSION"],
        },
      });
      assert.equal(dmcTarget, "MASTER_DMC");
      assert.equal(createFolioPartitionKey("RES-002", dmcTarget), "FOLIO#RES-002#MASTER_DMC");
    });
  });

  describe("5. Cryptographic SHA-256 Hash-Chained Immutable Audit Trail", () => {
    it("creates a tamper-evident audit log sequence covering the complete excursion lifecycle", () => {
      const auditChain: AuditLogEntry[] = [];
      let hash = GENESIS_HASH;

      // 1. Excursion Slot Scheduled
      hash = appendAuditStep(
        auditChain,
        hash,
        "SCHEDULE_RESOURCE_SLOT",
        "ResourceSlot",
        "SLOT-YALA-001",
        "2026-06-15T04:00:00Z",
        { slotId: "SLOT-YALA-001", status: "CONFIRMED" },
      );

      // 2. Packed Breakfast KDS Ticket Dispatched
      hash = appendAuditStep(
        auditChain,
        hash,
        "DISPATCH_PACKED_BREAKFAST_KDS",
        "KitchenOrder",
        "KDS-BREAKFAST-042",
        "2026-06-15T04:05:00Z",
        { kdsOrderId: "KDS-BREAKFAST-042", isComplimentary: true },
      );

      // 3. Excursion Split Folio Posted
      hash = appendAuditStep(
        auditChain,
        hash,
        "POST_EXCURSION_SPLIT_FOLIO",
        "FolioLineItem",
        "FOLIO-YALA-LINE-01",
        "2026-06-15T04:10:00Z",
        { totalPassThroughLkr: 36000, hotelMarkupLkr: 9000 },
      );

      // 4. Vendor Payables Accrued
      appendAuditStep(
        auditChain,
        hash,
        "ACCRUE_VENDOR_PAYABLES",
        "VendorLedger",
        "VEND-ACC-001",
        "2026-06-15T04:15:00Z",
        { dwcPermitLkr: 16000, jeepAssociationLkr: 20000 },
      );

      assert.equal(auditChain.length, 4);

      // Verify each individual entry's cryptographic hash
      for (const entry of auditChain) {
        assert.equal(computeAuditEntryHash(entry), entry.entryHash);
      }

      // Verify entire audit chain
      const verifyRes = verifyAuditChain(auditChain);
      assert.equal(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.equal(verifyRes.value.verifiedCount, 4);
      }
    });
  });
});
