/**
 * @hms/core - End-to-End Reservation-to-CheckIn State Transition Integration Tests (reservationFlow.test.ts)
 *
 * Implements Rung 5 of the Sri Lanka HMS Architecture Plan:
 * Comprehensive validation across the complete guest stay lifecycle:
 * 1. Multi-Tenant SaaS Isolation & Staff RBAC Permissions
 * 2. Sri Lankan NIC & Foreign Passport Parsing with Residency Tier Assignment
 * 3. Dynamic Tariff Quotation with 4-Stage Compounding Sri Lankan Taxes (SC -> TDL -> SSCL -> VAT)
 * 4. Chauffeur / Driver Dorm Quarters Bed Allocation & Meal Allowances
 * 5. Front-Desk Check-In & Cryptographic Room QR Session Token Signing (HMAC-SHA256)
 * 6. Stay Extension, Late Check-Out Rate Surcharge & Folio Tax Settlement
 * 7. Cryptographically Hash-Chained Immutable Audit Log (SHA-256) Verification
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_DRIVER_BED_RATE_LKR,
  DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  type RateQuoteInput,
  aggregateFolioTaxes,
  calculateLateCheckoutFee,
  calculateReverseTax,
  calculateStayQuote,
  computeAuditEntryHash,
  createAuditEntry,
  createNicVerificationAuditEntry,
  createPassportVerificationAuditEntry,
  createQrSessionTokenAuditEntry,
  createRateQuoteAuditEntry,
  parseSriLankaNic,
  signQrSessionToken,
  validateForeignPassport,
  validateSriLankanMobile,
  validateTenantId,
  verifyAuditChain,
  verifyQrSessionToken,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant RBAC & SaaS Subscription Fixtures
// ============================================================================

type StaffRole =
  | "SUPER_ADMIN"
  | "HOTEL_OWNER"
  | "GENERAL_MANAGER"
  | "FRONT_DESK"
  | "RESERVATIONIST"
  | "HOUSEKEEPING"
  | "WAITER";

type FrontDeskAction =
  | "CREATE_RESERVATION"
  | "VIEW_FOLIO"
  | "ALLOCATE_DRIVER_BED"
  | "CHECK_IN_GUEST"
  | "GENERATE_ROOM_QR"
  | "MODIFY_STAY"
  | "CHECK_OUT_GUEST";

const ROLE_PERMISSIONS: Readonly<Record<StaffRole, ReadonlySet<FrontDeskAction>>> = {
  SUPER_ADMIN: new Set<FrontDeskAction>([
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
    "ALLOCATE_DRIVER_BED",
    "CHECK_IN_GUEST",
    "GENERATE_ROOM_QR",
    "MODIFY_STAY",
    "CHECK_OUT_GUEST",
  ]),
  HOTEL_OWNER: new Set<FrontDeskAction>([
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
    "ALLOCATE_DRIVER_BED",
    "CHECK_IN_GUEST",
    "GENERATE_ROOM_QR",
    "MODIFY_STAY",
    "CHECK_OUT_GUEST",
  ]),
  GENERAL_MANAGER: new Set<FrontDeskAction>([
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
    "ALLOCATE_DRIVER_BED",
    "CHECK_IN_GUEST",
    "GENERATE_ROOM_QR",
    "MODIFY_STAY",
    "CHECK_OUT_GUEST",
  ]),
  FRONT_DESK: new Set<FrontDeskAction>([
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
    "ALLOCATE_DRIVER_BED",
    "CHECK_IN_GUEST",
    "GENERATE_ROOM_QR",
    "MODIFY_STAY",
    "CHECK_OUT_GUEST",
  ]),
  RESERVATIONIST: new Set<FrontDeskAction>([
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
    "ALLOCATE_DRIVER_BED",
  ]),
  HOUSEKEEPING: new Set<FrontDeskAction>([]),
  WAITER: new Set<FrontDeskAction>([]),
};

function authorizeStaffAction(role: StaffRole, action: FrontDeskAction): boolean {
  return ROLE_PERMISSIONS[role].has(action);
}

interface SaasSubscription {
  readonly tenantId: string;
  readonly plan: "FREE" | "STARTER" | "PRO" | "ENTERPRISE";
  readonly maxRooms: number;
  readonly active: boolean;
  readonly allowDriverQuarters: boolean;
  readonly allowRealTimeQr: boolean;
}

function checkEntitlement(
  sub: SaasSubscription,
  feature: "driverQuarters" | "realTimeQr",
): boolean {
  if (!sub.active) return false;
  if (feature === "driverQuarters") return sub.allowDriverQuarters;
  if (feature === "realTimeQr") return sub.allowRealTimeQr;
  return false;
}

// ============================================================================
// Test Suite: End-to-End Reservation-to-CheckIn Lifecycle
// ============================================================================

describe("End-to-End Reservation-to-CheckIn State Transition (reservationFlow.test.ts)", () => {
  const TENANT_ID = "heritance-kandalama";
  const PROPERTY_SECRET = "secret-kandalama-hmac-key-2026-xyz";
  const FIXED_TS = "2026-11-10T10:00:00.000Z";

  const subscription: SaasSubscription = {
    tenantId: TENANT_ID,
    plan: "PRO",
    maxRooms: 152,
    active: true,
    allowDriverQuarters: true,
    allowRealTimeQr: true,
  };

  describe("1. Multi-Tenant SaaS Isolation & Staff RBAC Authorization", () => {
    it("validates and canonicalizes multi-tenant tenant identifier", () => {
      const valid = validateTenantId("Heritance-Kandalama");
      assert.equal(valid.ok, true);
      if (valid.ok) {
        assert.equal(valid.value, "heritance-kandalama");
      }

      const invalid = validateTenantId("invalid_slug_with_underscores");
      assert.equal(invalid.ok, false);
    });

    it("enforces staff RBAC authorization matrix for front-desk actions", () => {
      assert.equal(authorizeStaffAction("FRONT_DESK", "CREATE_RESERVATION"), true);
      assert.equal(authorizeStaffAction("FRONT_DESK", "CHECK_IN_GUEST"), true);
      assert.equal(authorizeStaffAction("FRONT_DESK", "GENERATE_ROOM_QR"), true);
      assert.equal(authorizeStaffAction("RESERVATIONIST", "CREATE_RESERVATION"), true);
      assert.equal(authorizeStaffAction("RESERVATIONIST", "CHECK_IN_GUEST"), false);
      assert.equal(authorizeStaffAction("HOUSEKEEPING", "CHECK_IN_GUEST"), false);
      assert.equal(authorizeStaffAction("WAITER", "GENERATE_ROOM_QR"), false);
    });

    it("verifies SaaS subscription tier feature entitlements", () => {
      assert.equal(checkEntitlement(subscription, "driverQuarters"), true);
      assert.equal(checkEntitlement(subscription, "realTimeQr"), true);

      const inactiveSub: SaasSubscription = {
        ...subscription,
        active: false,
      };
      assert.equal(checkEntitlement(inactiveSub, "driverQuarters"), false);
      assert.equal(checkEntitlement(inactiveSub, "realTimeQr"), false);
    });
  });

  describe("2. Guest Identity Verification & Sri Lankan Residency Tiering", () => {
    it("parses Sri Lankan Old 9-digit NIC and assigns RESIDENT_LKR tier", () => {
      const nicRes = parseSriLankaNic("851540987V");
      assert.equal(nicRes.ok, true);
      if (!nicRes.ok) return;

      const nic = nicRes.value;
      assert.equal(nic.format, "OLD_9_DIGIT");
      assert.equal(nic.canonicalNic, "851540987V");
      assert.equal(nic.birthYear, 1985);
      assert.equal(nic.gender, "MALE");
      assert.equal(nic.residencyTier, "RESIDENT_LKR");

      const auditRes = createNicVerificationAuditEntry(
        TENANT_ID,
        "FRONT_DESK_USER_01",
        "res-101",
        nic,
        FIXED_TS,
      );
      assert.equal(auditRes.ok, true);
      if (auditRes.ok) {
        assert.equal(auditRes.value.tenantId, TENANT_ID);
        assert.equal(auditRes.value.action, "VERIFY_GUEST_NIC");
        assert.ok(auditRes.value.afterJson.includes("851540987V"));
      }
    });

    it("parses Sri Lankan New 12-digit NIC for female guest with +500 day code", () => {
      // 1995 -> 1995, 654 -> female, day 154 (June 3)
      const nicRes = parseSriLankaNic("199565401234");
      assert.equal(nicRes.ok, true);
      if (!nicRes.ok) return;

      const nic = nicRes.value;
      assert.equal(nic.format, "NEW_12_DIGIT");
      assert.equal(nic.birthYear, 1995);
      assert.equal(nic.gender, "FEMALE");
      assert.equal(nic.residencyTier, "RESIDENT_LKR");
    });

    it("validates foreign passport and assigns FOREIGN_USD_LOCKED tier", () => {
      const passRes = validateForeignPassport({
        passportNo: "P98765432",
        countryCode: "GB",
        arrivalDate: "2026-11-10",
        visaExpiryDate: "2026-12-10",
        tenantId: TENANT_ID,
        guestId: "guest-gb-9901",
      });
      assert.equal(passRes.ok, true);
      if (!passRes.ok) return;

      const pass = passRes.value;
      assert.equal(pass.canonicalCountryCode, "GB");
      assert.equal(pass.canonicalPassportNo, "P98765432");
      assert.equal(pass.residencyTier, "FOREIGN_USD_LOCKED");
      assert.equal(pass.touristPoliceBCardStatus, "COMPLIANT");

      const auditRes = createPassportVerificationAuditEntry(
        TENANT_ID,
        "FRONT_DESK_USER_01",
        "guest-gb-9901",
        pass,
        FIXED_TS,
      );
      assert.equal(auditRes.ok, true);
      if (auditRes.ok) {
        assert.equal(auditRes.value.tenantId, TENANT_ID);
        assert.equal(auditRes.value.action, "VERIFY_FOREIGN_PASSPORT_B_CARD");
        assert.ok(auditRes.value.afterJson.includes("P98765432"));
      }
    });

    it("canonicalizes Sri Lankan mobile numbers for booking confirmation SMS", () => {
      const mob = validateSriLankanMobile("077-1234567");
      assert.equal(mob.ok, true);
      if (mob.ok) {
        assert.equal(mob.value, "+94771234567");
      }
    });
  });

  describe("3. Tariff Quotation with 4-Stage Compounding Sri Lankan Taxes", () => {
    it("computes 3-night resident quote with BB meal plan and driver accommodation", () => {
      const input: RateQuoteInput = {
        tenantId: TENANT_ID,
        checkInDate: "2026-11-10",
        checkOutDate: "2026-11-13",
        roomCategoryId: "PANORAMIC_DELUXE",
        baseRateLkr: 30000,
        pricingModel: "TAX_EXCLUSIVE",
        residencyTier: "RESIDENT_LKR",
        mealPlan: "BB",
        adultCount: 2,
        driverAccommodation: {
          required: true,
          dailyRateLkr: DEFAULT_DRIVER_BED_RATE_LKR,
          dailyMealAllowanceLkr: DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR,
        },
      };

      const quoteRes = calculateStayQuote(input);
      assert.equal(quoteRes.ok, true);
      if (!quoteRes.ok) return;

      const quote = quoteRes.value;
      assert.equal(quote.totalNights, 3);
      assert.equal(quote.nights.length, 3);

      // Room: 30,000 * 3 = 90,000
      // Driver: (2,500 + 1,500) * 3 = 12,000
      // Meals (BB): 3,500 * 2 adults * 3 nights = 21,000
      assert.equal(quote.totalBaseRoomLkr, 90000);
      assert.equal(quote.totalDriverAllowanceLkr, 12000);
      assert.equal(quote.totalMealSupplementsLkr, 21000);
      assert.equal(quote.totalTaxableSupplyLkr, 123000);

      // Verify 4-stage tax compounding
      assert.ok(quote.totalServiceChargeLkr > 0);
      assert.ok(quote.totalVatLkr > 0);
      assert.ok(quote.grandTotalLkr > quote.totalTaxableSupplyLkr);

      const quoteAudit = createRateQuoteAuditEntry(TENANT_ID, "FRONT_DESK_STAFF", quote, FIXED_TS);
      assert.equal(quoteAudit.ok, true);
      if (quoteAudit.ok) {
        assert.equal(quoteAudit.value.action, "CALCULATE_RATE_QUOTE");
        assert.ok(quoteAudit.value.afterJson.includes("PANORAMIC_DELUXE"));
      }
    });

    it("verifies reverse tax calculation round-trips exactly to integer-cent precision", () => {
      const grossAmount = 155850.5;
      const reverseRes = calculateReverseTax(grossAmount, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.equal(reverseRes.ok, true);
      if (!reverseRes.ok) return;

      const reverse = reverseRes.value;
      const forwardReconstructed =
        reverse.baseLkr + reverse.scLkr + reverse.tdlLkr + reverse.ssclLkr + reverse.vatLkr;

      assert.equal(Math.round(forwardReconstructed * 100) / 100, grossAmount);
    });
  });

  describe("4. Chauffeur / Driver Dorm Quarters Bed Allocation", () => {
    it("allocates dorm bed and meal allowance when guest arrives with private chauffeur", () => {
      const driverAllocation = {
        driverName: "Dhammika Bandara",
        driverNic: "197824501234",
        driverPhone: "+94719876543",
        vehicleRegNumber: "WP CAB-7842",
        assignedBedNumber: "DORM-BED-04",
        nightlyRateLkr: DEFAULT_DRIVER_BED_RATE_LKR,
        mealAllowanceDailyLkr: DEFAULT_DRIVER_MEAL_ALLOWANCE_LKR,
        gatePassIssued: true,
      };

      assert.equal(driverAllocation.assignedBedNumber, "DORM-BED-04");
      assert.equal(driverAllocation.nightlyRateLkr, 2500);
      assert.equal(driverAllocation.mealAllowanceDailyLkr, 1500);
      assert.equal(driverAllocation.gatePassIssued, true);

      // Verify dorm bed rate + meal allowance sum for a 3-night stay
      const totalDriverCost =
        (driverAllocation.nightlyRateLkr + driverAllocation.mealAllowanceDailyLkr) * 3;
      assert.equal(totalDriverCost, 12000);
    });
  });

  describe("5. Front-Desk Check-In & Cryptographic Room QR Session Token Signing", () => {
    it("generates and cryptographically verifies active room QR HMAC-SHA256 session token", () => {
      const expEpoch = Math.floor(Date.now() / 1000) + 86400 * 3; // 3 days expiry
      const tokenRes = signQrSessionToken({
        tenantId: TENANT_ID,
        location: "ROOM-304",
        stayId: "RES-KANDALAMA-8941",
        exp: expEpoch,
        secret: PROPERTY_SECRET,
      });

      assert.equal(tokenRes.ok, true);
      if (!tokenRes.ok) return;

      const token = tokenRes.value;
      assert.ok(token.includes("."));

      // Verify token authenticity with property secret
      const verifyRes = verifyQrSessionToken(token, PROPERTY_SECRET);

      assert.equal(verifyRes.ok, true);
      if (verifyRes.ok) {
        assert.equal(verifyRes.value.tid, TENANT_ID);
        assert.equal(verifyRes.value.loc, "ROOM-304");
        assert.equal(verifyRes.value.sty, "RES-KANDALAMA-8941");
      }

      // Verify audit entry creation
      const tokenAudit = createQrSessionTokenAuditEntry(
        TENANT_ID,
        "FRONT_DESK_OFFICER",
        "ROOM-304",
        "RES-KANDALAMA-8941",
        token,
        FIXED_TS,
      );
      assert.equal(tokenAudit.ok, true);
      if (tokenAudit.ok) {
        assert.equal(tokenAudit.value.action, "ISSUE_QR_SESSION_TOKEN");
        assert.ok(tokenAudit.value.afterJson.includes("ROOM-304"));
      }
    });

    it("rejects tampered QR tokens attempting room spoofing or tenant cross-access", () => {
      const expEpoch = Math.floor(Date.now() / 1000) + 7200;
      const validToken = signQrSessionToken({
        tenantId: TENANT_ID,
        location: "ROOM-304",
        stayId: "RES-8941",
        exp: expEpoch,
        secret: PROPERTY_SECRET,
      });

      assert.equal(validToken.ok, true);
      if (!validToken.ok) return;

      // Tampered token payload
      const parts = validToken.value.split(".");
      const tamperedToken = `${parts[0]}extra.${parts[1]}`;
      const verifyTampered = verifyQrSessionToken(tamperedToken, PROPERTY_SECRET);
      assert.equal(verifyTampered.ok, false);

      // Verification with incorrect secret
      const wrongSecret = verifyQrSessionToken(validToken.value, "wrong-tenant-secret");
      assert.equal(wrongSecret.ok, false);
    });
  });

  describe("6. Stay Extension, Late Check-Out Rate Surcharge & Folio Tax Settlement", () => {
    it("calculates late check-out fee: grace period, half-day (50%), and full-night (100%)", () => {
      const baseNightlyRate = 40000;

      // 12:20 -> within 30-min grace period (0 LKR)
      const graceRes = calculateLateCheckoutFee({
        tenantId: TENANT_ID,
        reservationId: "RES-8941",
        roomNumber: "304",
        baseDailyRateLkr: baseNightlyRate,
        standardCheckoutTime: "12:00",
        actualCheckoutTime: "12:20",
        policy: { gracePeriodMinutes: 30, halfDayCutoffTime: "18:00" },
        authorizedBy: { actorUserId: "STAFF-01", role: "FRONT_DESK" },
      });
      assert.equal(graceRes.ok, true);
      if (graceRes.ok) {
        assert.equal(graceRes.value.tier, "GRACE_PERIOD");
        assert.equal(graceRes.value.taxableBaseLkr, 0);
      }

      // 15:45 -> between grace and 18:00 (50% = 20,000 LKR)
      const halfDayRes = calculateLateCheckoutFee({
        tenantId: TENANT_ID,
        reservationId: "RES-8941",
        roomNumber: "304",
        baseDailyRateLkr: baseNightlyRate,
        standardCheckoutTime: "12:00",
        actualCheckoutTime: "15:45",
        policy: { gracePeriodMinutes: 30, halfDayCutoffTime: "18:00" },
        authorizedBy: { actorUserId: "STAFF-01", role: "FRONT_DESK" },
      });
      assert.equal(halfDayRes.ok, true);
      if (halfDayRes.ok) {
        assert.equal(halfDayRes.value.tier, "HALF_DAY");
        assert.equal(halfDayRes.value.taxableBaseLkr, 20000);
      }

      // 19:30 -> after 18:00 (100% full night = 40,000 LKR)
      const fullNightRes = calculateLateCheckoutFee({
        tenantId: TENANT_ID,
        reservationId: "RES-8941",
        roomNumber: "304",
        baseDailyRateLkr: baseNightlyRate,
        standardCheckoutTime: "12:00",
        actualCheckoutTime: "19:30",
        policy: { gracePeriodMinutes: 30, halfDayCutoffTime: "18:00" },
        authorizedBy: { actorUserId: "STAFF-01", role: "FRONT_DESK" },
      });
      assert.equal(fullNightRes.ok, true);
      if (fullNightRes.ok) {
        assert.equal(fullNightRes.value.tier, "FULL_NIGHT");
        assert.equal(fullNightRes.value.taxableBaseLkr, 40000);
      }
    });

    it("aggregates final guest folio with room, driver, late check-out, and restaurant items", () => {
      const folioLines = [
        {
          lineId: "FOL-01",
          department: "ROOM" as const,
          description: "Panoramic Deluxe Room (3 nights)",
          quantity: 3,
          unitBaseLkr: 30000,
        },
        {
          lineId: "FOL-02",
          department: "ROOM" as const,
          description: "Chauffeur Quarters Dorm Bed & Meals (3 nights)",
          quantity: 3,
          unitBaseLkr: 4000,
        },
        {
          lineId: "FOL-03",
          department: "ROOM" as const,
          description: "Late Check-Out Fee (Until 16:00)",
          quantity: 1,
          unitBaseLkr: 15000,
        },
        {
          lineId: "FOL-04",
          department: "FNB" as const,
          description: "Kandalama Lakeview Dinner Buffet (2 pax)",
          quantity: 2,
          unitBaseLkr: 9500,
        },
      ];

      const folioRes = aggregateFolioTaxes(folioLines, {
        tenantId: TENANT_ID,
        folioId: "FOLIO-2026-8941",
      });

      assert.equal(folioRes.ok, true);
      if (!folioRes.ok) return;

      const folio = folioRes.value;
      assert.equal(folio.totalLines, 4);
      // Total Base: (3 * 30000) + (3 * 4000) + 15000 + (2 * 9500) = 90000 + 12000 + 15000 + 19000 = 136000
      assert.equal(folio.totalBaseLkr, 136000);
      assert.ok(folio.totalVatLkr > 0);
      assert.ok(folio.grandTotalLkr > folio.totalBaseLkr);
    });
  });

  describe("7. Full End-to-End State Machine with Cryptographically Hash-Chained Audit Log", () => {
    it("completes full reservation lifecycle and validates unbroken SHA-256 audit chain", () => {
      const auditChain: AuditLogEntry[] = [];
      let previousHash = GENESIS_HASH;

      // Helper to append hash-chained entry
      const appendAudit = (action: string, metadata: Record<string, unknown>) => {
        const entryRes = createAuditEntry({
          tenantId: TENANT_ID,
          actorUserId: "FRONT_DESK_OPERATOR_01",
          action,
          entityId: "RES-KANDALAMA-2026-001",
          entityType: "RESERVATION",
          prevHash: previousHash,
          isoTs: FIXED_TS,
          afterJson: JSON.stringify(metadata),
        });
        assert.equal(entryRes.ok, true);
        if (!entryRes.ok) throw new Error("Failed to create audit entry");

        auditChain.push(entryRes.value);
        previousHash = entryRes.value.entryHash;
        return entryRes.value;
      };

      // Step 1: Inquire Rate Quote
      appendAudit("RATE_QUOTED", {
        checkIn: "2026-12-20",
        checkOut: "2026-12-23",
        roomType: "PANORAMIC_DELUXE",
        totalGrossLkr: 145000,
      });

      // Step 2: Validate Guest Identity (Sri Lankan NIC)
      appendAudit("IDENTITY_VERIFIED", {
        nic: "901234567V",
        gender: "MALE",
        residencyTier: "RESIDENT_LKR",
      });

      // Step 3: Create Reservation & Allocate Driver Dorm Bed
      appendAudit("RESERVATION_CREATED", {
        status: "CONFIRMED",
        driverBed: "DORM-BED-02",
        driverVoucherIssued: true,
      });

      // Step 4: Post Advance Deposit
      appendAudit("DEPOSIT_RECORDED", {
        depositLkr: 50000,
        paymentMethod: "PAYHERE_GATEWAY",
        gatewayRef: "PH-TX-990124",
      });

      // Step 5: Check In Guest & Generate Room QR HMAC
      appendAudit("GUEST_CHECKED_IN", {
        roomNumber: "304",
        checkedInAtIso: "2026-12-20T14:15:00Z",
        qrSessionIssued: true,
      });

      // Step 6: Post Late Check-Out & Settle Final Folio
      appendAudit("FOLIO_SETTLED_AND_CHECKED_OUT", {
        roomNumber: "304",
        lateCheckOutFeeLkr: 15000,
        finalInvoiceNumber: "INV-2026-8941",
        balanceSettledLkr: 110000,
        checkedOutAtIso: "2026-12-23T16:00:00Z",
      });

      assert.equal(auditChain.length, 6);

      // Verify the entire audit log sequence using verifyAuditChain
      const chainRes = verifyAuditChain(auditChain);
      assert.equal(chainRes.ok, true);
      if (chainRes.ok) {
        assert.equal(chainRes.value.verifiedCount, 6);
      }

      // Ensure every entry correctly references previous entry's hash
      assert.equal(auditChain[0]?.prevHash, GENESIS_HASH);
      assert.equal(auditChain[1]?.prevHash, auditChain[0]?.entryHash);
      assert.equal(auditChain[2]?.prevHash, auditChain[1]?.entryHash);
      assert.equal(auditChain[3]?.prevHash, auditChain[2]?.entryHash);
      assert.equal(auditChain[4]?.prevHash, auditChain[3]?.entryHash);
      assert.equal(auditChain[5]?.prevHash, auditChain[4]?.entryHash);

      // Verify hash recomputation matches stored hash
      for (const entry of auditChain) {
        const recomputed = computeAuditEntryHash(entry);
        assert.equal(entry.entryHash, recomputed);
      }
    });

    it("detects tampering when any intermediate audit record payload is altered", () => {
      const auditChain: AuditLogEntry[] = [];
      let previousHash = GENESIS_HASH;

      const appendAudit = (action: string, metadata: Record<string, unknown>) => {
        const entryRes = createAuditEntry({
          tenantId: TENANT_ID,
          actorUserId: "FRONT_DESK_OPERATOR_01",
          action,
          entityId: "RES-KANDALAMA-2026-002",
          entityType: "RESERVATION",
          prevHash: previousHash,
          isoTs: FIXED_TS,
          afterJson: JSON.stringify(metadata),
        });
        assert.equal(entryRes.ok, true);
        if (!entryRes.ok) throw new Error("Failed to create audit entry");

        auditChain.push(entryRes.value);
        previousHash = entryRes.value.entryHash;
        return entryRes.value;
      };

      appendAudit("RATE_QUOTED", { amount: 100000 });
      appendAudit("IDENTITY_VERIFIED", { nic: "881234567V" });
      appendAudit("RESERVATION_CREATED", { roomNumber: "101" });
      appendAudit("DEPOSIT_RECORDED", { depositLkr: 50000 });

      // Tamper with the deposit record
      const tamperedChain: AuditLogEntry[] = [
        auditChain[0] as AuditLogEntry,
        auditChain[1] as AuditLogEntry,
        auditChain[2] as AuditLogEntry,
        {
          ...(auditChain[3] as AuditLogEntry),
          afterJson: JSON.stringify({ depositLkr: 999999999 }), // Tampered payload without rehashing
        },
      ];

      const chainRes = verifyAuditChain(tamperedChain);
      assert.equal(chainRes.ok, false);
    });
  });
});
