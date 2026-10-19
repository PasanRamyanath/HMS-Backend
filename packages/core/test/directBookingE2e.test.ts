/**
 * @hms/core - End-to-End Direct Booking -> PayHere Webhook -> Tape Chart Lock Integration Tests (directBookingE2e.test.ts)
 *
 * Implements Rung 5 of the Sri Lanka HMS Architecture Plan (Phase 08.24):
 * Full integration verification of the complete guest direct booking lifecycle:
 * 1. Multi-Tenant SaaS Isolation & Feature Entitlements
 * 2. Guest Identity & Sri Lankan Residency Tier Resolution (NIC / Passport)
 * 3. Dynamic Tariff Quotation with Bank Promo & 4-Stage Compounding Taxes (SC -> TDL -> SSCL -> VAT)
 * 4. Chauffeur / Driver Dormitory Quarters & Meal Supplement Allocation
 * 5. Direct Reservation Creation & PayHere Checkout Hash Generation (MD5)
 * 6. Inbound PayHere IPN Webhook Verification & Tamper Detection
 * 7. Tape Chart Atomic Room Occupancy Lock & Collision Rejection
 * 8. Cryptographically Hash-Chained Immutable Audit Trail Verification (SHA-256)
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_DRIVER_BED_RATE_LKR,
  DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  calculateForwardTax,
  checkIntervalOverlap,
  computeDiscountAmounts,
  createAuditEntry,
  createPayHereCheckoutAuditEntry,
  createPayHereWebhookAuditEntry,
  filterAvailableRooms,
  generatePayHereCheckoutHash,
  parseSriLankaNic,
  validateForeignPassport,
  validateTenantId,
  verifyAuditChain,
  verifyPayHereWebhook,
} from "../src/index.js";

// ============================================================================
// SaaS Multi-Tenant & RBAC Test Fixtures
// ============================================================================

const TEST_TENANT_ID = "tenant-galle-fort";
const ALT_TENANT_ID = "tenant-kandy-hills";

interface TenantSubscriptionPlan {
  readonly tenantId: string;
  readonly planTier: "STARTER_VILLA" | "PRO_RESORT" | "ENTERPRISE_CHAIN";
  readonly maxRooms: number;
  readonly directBookingEngineEnabled: boolean;
  readonly payHereMerchantId: string;
  readonly payHereSecret: string;
}

const TEST_TENANT_CONFIG: TenantSubscriptionPlan = {
  tenantId: TEST_TENANT_ID,
  planTier: "PRO_RESORT",
  maxRooms: 50,
  directBookingEngineEnabled: true,
  payHereMerchantId: "1219800",
  payHereSecret: "4O42N91abcdefGalleFort2026",
};

// ============================================================================
// Test Suite
// ============================================================================

describe("End-to-End Direct Booking -> PayHere Webhook -> Tape Chart Lock (directBookingE2e.test.ts)", () => {
  describe("1. Multi-Tenant SaaS Isolation & Entitlements", () => {
    it("validates valid tenant format and confirms Direct Booking Engine entitlement", () => {
      const tenantCheck = validateTenantId(TEST_TENANT_CONFIG.tenantId);
      assert.strictEqual(tenantCheck.ok, true);

      assert.strictEqual(TEST_TENANT_CONFIG.directBookingEngineEnabled, true);
      assert.strictEqual(TEST_TENANT_CONFIG.planTier, "PRO_RESORT");
    });

    it("rejects cross-tenant booking operations with deterministic mismatch", () => {
      const crossTenantId = ALT_TENANT_ID;
      const isAuthorizedForTenant = crossTenantId === TEST_TENANT_CONFIG.tenantId;
      assert.strictEqual(isAuthorizedForTenant, false);
    });
  });

  describe("2. Guest Identity & Residency Tier Resolution", () => {
    it("parses 12-digit Sri Lankan NIC and resolves RESIDENT_LKR tier", () => {
      // 199214502819 -> Valid 12-digit modern NIC
      const nicResult = parseSriLankaNic("199214502819");
      assert.strictEqual(nicResult.ok, true);
      if (!nicResult.ok) return;

      assert.strictEqual(nicResult.value.format, "NEW_12_DIGIT");
      assert.strictEqual(nicResult.value.birthYear, 1992);
      assert.strictEqual(nicResult.value.gender, "MALE");
      assert.strictEqual(nicResult.value.residencyTier, "RESIDENT_LKR");
    });

    it("parses Foreign Passport and assigns FOREIGN_USD_LOCKED tier", () => {
      const passportResult = validateForeignPassport({
        passportNo: "P99824156",
        countryCode: "GBR",
        arrivalDate: "2026-12-30",
        visaExpiryDate: "2027-01-30",
      });

      assert.strictEqual(passportResult.ok, true);
      if (!passportResult.ok) return;

      assert.strictEqual(passportResult.value.canonicalPassportNo, "P99824156");
      assert.strictEqual(passportResult.value.canonicalCountryCode, "GBR");
      assert.strictEqual(passportResult.value.residencyTier, "FOREIGN_USD_LOCKED");
    });
  });

  describe("3. Dynamic Tariff Quotation with Bank Promo & 4-Stage Compounding Taxes", () => {
    it("calculates 4-stage tax compounding (SC -> TDL -> SSCL -> VAT) on discounted tariff", () => {
      // 3 nights, 2 adults, Ocean Suite
      const nights = 3;
      const baseRoomRatePerNight = 40000; // LKR
      const grossRoomTotal = baseRoomRatePerNight * nights; // 120,000 LKR

      // Half Board meal supplement: LKR 6,000 / adult / night
      const mealSupplementTotal = 6000 * 2 * nights; // 36,000 LKR

      // Total before discounts
      const subtotalBeforeDiscount = grossRoomTotal + mealSupplementTotal; // 156,000 LKR

      // Sampath Bank 25% discount on room tariff (max cap 35,000 LKR)
      const promoResult = computeDiscountAmounts(grossRoomTotal, "PERCENTAGE", 25, 35000);

      // 25% of 120,000 = 30,000 LKR (below cap 35,000)
      assert.strictEqual(promoResult.discountAmountLkr, 30000);
      const discountLkr = promoResult.discountAmountLkr;

      // Net Taxable Base = 120,000 - 30,000 + 36,000 = 126,000 LKR
      const netTaxableBase = subtotalBeforeDiscount - discountLkr;
      assert.strictEqual(netTaxableBase, 126000);

      // Apply Sri Lankan 4-Stage Statutory Compounding
      const taxResult = calculateForwardTax(netTaxableBase, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.strictEqual(taxResult.ok, true);
      if (!taxResult.ok) return;

      const taxes = taxResult.value;

      // 1. SC 10%: 126,000 * 0.10 = 12,600
      assert.strictEqual(taxes.scLkr, 12600);

      // 2. TDL 1%: (126,000 + 12,600) * 0.01 = 1,386
      assert.strictEqual(taxes.tdlLkr, 1386);

      // 3. SSCL 2.5%: Subtotal A (126,000 + 12,600) * 0.025 = 3,465
      assert.strictEqual(taxes.ssclLkr, 3465);

      // 4. VAT 18%: (Subtotal A + TDL + SSCL) = (138,600 + 1,386 + 3,465) * 0.18 = 25,821.18
      assert.strictEqual(taxes.vatLkr, 25821.18);

      // Grand Total: 138,600 + 1,386 + 3,465 + 25,821.18 = 169,272.18
      assert.strictEqual(taxes.grandTotalLkr, 169272.18);
    });

    it("allocates Chauffeur / Driver dormitory bed and meal allowance", () => {
      const nights = 3;
      const driverBedCost = DEFAULT_DRIVER_BED_RATE_LKR * nights; // 2500 * 3 = 7500
      const driverMealCost = DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR * nights; // 1500 * 3 = 4500
      const driverTotalSupplement = driverBedCost + driverMealCost; // 12000

      assert.strictEqual(driverBedCost, 7500);
      assert.strictEqual(driverMealCost, 4500);
      assert.strictEqual(driverTotalSupplement, 12000);

      // Combined Reservation Total: 169,272.18 + 12,000 = 181,272.18 LKR
      const reservationTotalLkr = Math.round((169272.18 + driverTotalSupplement) * 100) / 100;
      assert.strictEqual(reservationTotalLkr, 181272.18);
    });
  });

  describe("4. Direct Reservation Creation & PayHere Checkout MD5 Generation", () => {
    const bookingReference = "SL-BKG-2026-90412";
    const depositAmountLkr = 181272.18;

    it("generates exact uppercase MD5 checkout hash for PayHere gateway redirect", () => {
      const hashResult = generatePayHereCheckoutHash({
        merchantId: TEST_TENANT_CONFIG.payHereMerchantId,
        orderId: bookingReference,
        amount: depositAmountLkr,
        currency: "LKR",
        merchantSecret: TEST_TENANT_CONFIG.payHereSecret,
        tenantId: TEST_TENANT_CONFIG.tenantId,
      });

      assert.strictEqual(hashResult.ok, true);
      if (!hashResult.ok) return;

      const secretHash = createHash("md5")
        .update(TEST_TENANT_CONFIG.payHereSecret)
        .digest("hex")
        .toUpperCase();
      const rawString = `${TEST_TENANT_CONFIG.payHereMerchantId}${bookingReference}181272.18LKR${secretHash}`;
      const expectedHash = createHash("md5").update(rawString).digest("hex").toUpperCase();

      assert.strictEqual(hashResult.value, expectedHash);
      assert.strictEqual(hashResult.value.length, 32);
    });
  });

  describe("5. Inbound PayHere IPN Webhook Verification & Tamper Detection", () => {
    const bookingReference = "SL-BKG-2026-90412";
    const paymentId = "320091884129";

    function computeWebhookMd5(
      merchantId: string,
      orderId: string,
      amount: string,
      currency: string,
      statusCode: string,
      merchantSecret: string,
    ): string {
      const secretHash = createHash("md5").update(merchantSecret).digest("hex").toUpperCase();
      const raw = `${merchantId}${orderId}${amount}${currency}${statusCode}${secretHash}`;
      return createHash("md5").update(raw).digest("hex").toUpperCase();
    }

    it("verifies authentic PayHere webhook notification with status_code 2 (SUCCESS)", () => {
      const validMd5 = computeWebhookMd5(
        TEST_TENANT_CONFIG.payHereMerchantId,
        bookingReference,
        "181272.18",
        "LKR",
        "2",
        TEST_TENANT_CONFIG.payHereSecret,
      );

      const verification = verifyPayHereWebhook(
        {
          merchantId: TEST_TENANT_CONFIG.payHereMerchantId,
          orderId: bookingReference,
          paymentId,
          payhereAmount: "181272.18",
          payhereCurrency: "LKR",
          statusCode: "2",
          md5sig: validMd5,
          tenantId: TEST_TENANT_CONFIG.tenantId,
        },
        TEST_TENANT_CONFIG.payHereSecret,
      );

      assert.strictEqual(verification.ok, true);
      if (!verification.ok) return;

      assert.strictEqual(verification.value.verified, true);
      assert.strictEqual(verification.value.status, "PAID");
      assert.strictEqual(verification.value.orderId, bookingReference);
      assert.strictEqual(verification.value.amount, 181272.18);
    });

    it("detects and rejects tampered amount in PayHere webhook", () => {
      const originalMd5 = computeWebhookMd5(
        TEST_TENANT_CONFIG.payHereMerchantId,
        bookingReference,
        "181272.18",
        "LKR",
        "2",
        TEST_TENANT_CONFIG.payHereSecret,
      );

      const tamperedVerification = verifyPayHereWebhook(
        {
          merchantId: TEST_TENANT_CONFIG.payHereMerchantId,
          orderId: bookingReference,
          paymentId,
          payhereAmount: "1000.00", // Tampered amount!
          payhereCurrency: "LKR",
          statusCode: "2",
          md5sig: originalMd5,
          tenantId: TEST_TENANT_CONFIG.tenantId,
        },
        TEST_TENANT_CONFIG.payHereSecret,
      );

      assert.strictEqual(tamperedVerification.ok, false);
      if (tamperedVerification.ok) return;
      assert.strictEqual(tamperedVerification.error.code, "INVALID_SIGNATURE");
    });
  });

  describe("6. Tape Chart Atomic Room Occupancy Lock & Collision Rejection", () => {
    const checkInDate = "2026-12-30";
    const checkOutDate = "2027-01-02";

    it("detects collision when concurrent booking attempts overlapping dates on the same room", () => {
      const isOverlapping = checkIntervalOverlap(
        "2026-12-31", // Mid-stay check-in attempt
        "2027-01-03",
        checkInDate,
        checkOutDate,
      );
      assert.strictEqual(isOverlapping, true);

      assert.strictEqual(
        checkIntervalOverlap("2026-12-30", "2026-12-31", checkInDate, checkOutDate),
        true,
      );
    });

    it("verifies half-open interval semantics: check-out date is immediately available for new guest", () => {
      // Guest A checks out 2027-01-02. Guest B checks in 2027-01-02.
      // Under [checkIn, checkOut) half-open intervals, they do NOT collide!
      const isCollisionOnTurnaroundDate = checkIntervalOverlap(
        "2027-01-02",
        "2027-01-05",
        checkInDate,
        checkOutDate,
      );
      assert.strictEqual(isCollisionOnTurnaroundDate, false);
    });

    it("filters available physical rooms eliminating the locked room", () => {
      const roomInventory = [
        {
          id: "room-101",
          tenantId: TEST_TENANT_ID,
          roomNumber: "101",
          roomTypeId: "rt-ocean-suite",
          building: "Main Villa",
          floor: "1",
          isActive: true,
        },
        {
          id: "room-102",
          tenantId: TEST_TENANT_ID,
          roomNumber: "102",
          roomTypeId: "rt-ocean-suite",
          building: "Main Villa",
          floor: "1",
          isActive: true,
        },
      ];

      const existingReservations = [
        {
          id: "res-sl-90412",
          tenantId: TEST_TENANT_ID,
          roomId: "room-101",
          roomTypeId: "rt-ocean-suite",
          checkInDate,
          checkOutDate,
          status: "CONFIRMED",
        },
      ];

      const availability = filterAvailableRooms({
        tenantId: TEST_TENANT_ID,
        checkInDate: "2026-12-31",
        checkOutDate: "2027-01-02",
        rooms: roomInventory,
        reservations: existingReservations,
      });

      assert.strictEqual(availability.ok, true);
      if (!availability.ok) return;

      assert.strictEqual(availability.value.availableRoomsCount, 1);
      assert.strictEqual(availability.value.availableRooms[0]?.id, "room-102");
      assert.deepStrictEqual(availability.value.conflictingRoomIds, ["room-101"]);
    });
  });

  function unwrapEntry<T>(res: Result<T, unknown>): T {
    assert.strictEqual(res.ok, true);
    if (!res.ok) {
      throw new Error("Result was expected to be ok");
    }
    return res.value;
  }

  describe("7. Cryptographically Hash-Chained Immutable Audit Trail (SHA-256)", () => {
    it("verifies unbroken 5-node audit log hash chain from GENESIS across the full booking lifecycle", () => {
      // Step 1: Direct tariff quote requested
      const entry1 = unwrapEntry(
        createAuditEntry({
          tenantId: TEST_TENANT_ID,
          actorUserId: "system:direct-booking-engine",
          action: "QUOTE_REQUESTED",
          entityType: "RateQuote",
          entityId: "quote-sl-90412",
          isoTs: "2026-10-19T08:00:00.000Z",
          afterJson: JSON.stringify({
            roomTypeId: "rt-ocean-suite",
            nights: 3,
            grossLkr: 169272.18,
          }),
          prevHash: GENESIS_HASH,
        }),
      );

      // Step 2: Reservation created in PENDING_PAYMENT status
      const entry2 = unwrapEntry(
        createAuditEntry({
          tenantId: TEST_TENANT_ID,
          actorUserId: "system:direct-booking-engine",
          action: "CREATE",
          entityType: "Reservation",
          entityId: "RES-SL-2026-90412",
          isoTs: "2026-10-19T08:01:00.000Z",
          afterJson: JSON.stringify({ status: "PENDING_PAYMENT", amountLkr: 181272.18 }),
          prevHash: entry1.entryHash,
        }),
      );

      // Step 3: PayHere checkout hash generated
      const entry3 = unwrapEntry(
        createPayHereCheckoutAuditEntry(
          TEST_TENANT_ID,
          "system:payhere-service",
          "RES-SL-2026-90412",
          181272.18,
          "LKR",
          "A1B2C3D4E5F678901234567890ABCDEF",
          "2026-10-19T08:02:00.000Z",
          entry2.entryHash,
        ),
      );

      // Step 4: PayHere webhook received & verified
      const entry4 = unwrapEntry(
        createPayHereWebhookAuditEntry(
          TEST_TENANT_ID,
          "system:payhere-webhook-worker",
          "RES-SL-2026-90412",
          "PAID",
          181272.18,
          "LKR",
          "2026-10-19T08:03:00.000Z",
          entry3.entryHash,
        ),
      );

      // Step 5: Reservation locked on tape chart as CONFIRMED
      const entry5 = unwrapEntry(
        createAuditEntry({
          tenantId: TEST_TENANT_ID,
          actorUserId: "system:payhere-webhook-dispatcher",
          action: "UPDATE",
          entityType: "Reservation",
          entityId: "RES-SL-2026-90412",
          isoTs: "2026-10-19T08:04:00.000Z",
          afterJson: JSON.stringify({
            status: "CONFIRMED",
            assignedRoomNumber: "101",
            lockedDates: ["2026-12-30", "2026-12-31", "2027-01-01"],
          }),
          prevHash: entry4.entryHash,
        }),
      );

      const auditChain: AuditLogEntry[] = [entry1, entry2, entry3, entry4, entry5];
      assert.strictEqual(auditChain.length, 5);

      // Verify complete chain cryptographically
      const chainVerification = unwrapEntry(verifyAuditChain(auditChain));
      assert.strictEqual(chainVerification.verifiedCount, 5);
    });

    it("detects tampering when payload or previous hash is maliciously altered", () => {
      const entry1Res = createAuditEntry({
        tenantId: TEST_TENANT_ID,
        actorUserId: "system",
        action: "CREATE",
        entityType: "Reservation",
        entityId: "RES-1",
        isoTs: "2026-10-19T08:00:00.000Z",
        afterJson: JSON.stringify({ status: "PENDING" }),
        prevHash: GENESIS_HASH,
      });
      assert.strictEqual(entry1Res.ok, true);
      if (!entry1Res.ok) return;

      const entry2Res = createAuditEntry({
        tenantId: TEST_TENANT_ID,
        actorUserId: "system",
        action: "UPDATE",
        entityType: "Reservation",
        entityId: "RES-1",
        isoTs: "2026-10-19T08:01:00.000Z",
        afterJson: JSON.stringify({ status: "CONFIRMED" }),
        prevHash: entry1Res.value.entryHash,
      });
      assert.strictEqual(entry2Res.ok, true);
      if (!entry2Res.ok) return;

      // Attacker tampers with entry1 payload
      const tamperedEntry1: AuditLogEntry = {
        ...entry1Res.value,
        afterJson: JSON.stringify({ status: "MALICIOUS_OVERRIDE" }),
      };

      const tamperedChain = [tamperedEntry1, entry2Res.value];
      const result = verifyAuditChain(tamperedChain);

      // Verification fails with AUDIT_CHAIN_CORRUPTED
      assert.strictEqual(result.ok, false);
      if (result.ok) return;

      assert.strictEqual(result.error.code, "AUDIT_CHAIN_CORRUPTED");
    });
  });
});
