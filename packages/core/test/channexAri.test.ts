/**
 * @hms/core - Channex ARI Payload Builder Unit Tests (channexAri.test.ts).
 *
 * Validates Rung 6 of the Sri Lanka HMS Architecture Plan:
 * 1. Net availability calculation (totalPhysicalRooms - bookedRooms - outOfOrderRooms)
 * 2. Channex /api/v1/availability payload generation and date validation
 * 3. Channex /api/v1/restrictions payload generation with 4-stage compounding taxes & dual-currency
 * 4. Staff RBAC permissions and multi-tenant SaaS subscription entitlement gating
 * 5. SHA-256 hash-chained ImmutableAuditLog generation
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ChannexAvailabilityInput,
  type ChannexRatePlanMapping,
  type ChannexRestrictionsInput,
  type ChannexRoomMap,
  type ChannexRoomMapping,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  buildChannexAvailabilityPayload,
  buildChannexRestrictionsPayload,
  calculateNetAvailability,
  computeAuditEntryHash,
  createChannexAriAuditEntry,
  createChannexBookingAuditEntry,
  isStaffAuthorizedForChannelManager,
  parseChannexBookingRevision,
  resolveMealPlan,
} from "../src/index.js";

describe("Channex ARI Payload Builder Engine (channexAri.ts)", () => {
  const TENANT_ID = "amanwella-tangalle";
  const PROPERTY_ID = "prop-aman-tangalle-01";
  const FIXED_TS = "2026-11-01T08:00:00.000Z";

  const standardRoomMapping: ChannexRoomMapping = {
    roomCategoryId: "OCEAN_POOL_SUITE",
    channexRoomTypeId: "rt-chx-ocean-suite-99",
    totalPhysicalRooms: 20,
  };

  const standardRateMapping: ChannexRatePlanMapping = {
    ratePlanId: "BAR_BB_LKR",
    channexRatePlanId: "rp-chx-bar-bb-01",
    roomCategoryId: "OCEAN_POOL_SUITE",
    mealPlan: "BB",
    currency: "LKR",
    pricingModel: "TAX_EXCLUSIVE",
  };

  describe("1. Net Sellable Availability Math (calculateNetAvailability)", () => {
    it("computes net remaining sellable availability cleanly", () => {
      // 20 total - 6 booked - 2 out of order = 12
      const net = calculateNetAvailability(20, 6, 2);
      assert.strictEqual(net, 12);
    });

    it("defaults outOfOrderRooms to 0 if omitted", () => {
      // 15 total - 5 booked = 10
      const net = calculateNetAvailability(15, 5);
      assert.strictEqual(net, 10);
    });

    it("clamps net availability to 0 when bookings exceed physical inventory (no negative availability)", () => {
      // 10 total - 12 booked - 1 OOO = 0
      const net = calculateNetAvailability(10, 12, 1);
      assert.strictEqual(net, 0);
    });

    it("handles zero or degenerate total physical room inputs safely", () => {
      assert.strictEqual(calculateNetAvailability(0, 5, 0), 0);
      assert.strictEqual(calculateNetAvailability(-5, 0, 0), 0);
      assert.strictEqual(calculateNetAvailability(Number.NaN, 0, 0), 0);
    });
  });

  describe("2. Channex /api/v1/availability Payload Builder", () => {
    it("builds valid Channex availability payload across dates", () => {
      const input: ChannexAvailabilityInput = {
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        roomMapping: standardRoomMapping,
        inventoryByDate: [
          { date: "2026-11-01", bookedRooms: 4, outOfOrderRooms: 1 },
          { date: "2026-11-02", bookedRooms: 10, outOfOrderRooms: 0 },
          { date: "2026-11-03", bookedRooms: 20, outOfOrderRooms: 2 },
        ],
      };

      const res = buildChannexAvailabilityPayload(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const payload = res.value;
      assert.strictEqual(payload.values.length, 3);

      // Day 1: 20 - 4 - 1 = 15
      assert.deepStrictEqual(payload.values[0], {
        property_id: PROPERTY_ID,
        room_type_id: standardRoomMapping.channexRoomTypeId,
        date: "2026-11-01",
        availability: 15,
      });

      // Day 2: 20 - 10 - 0 = 10
      assert.deepStrictEqual(payload.values[1], {
        property_id: PROPERTY_ID,
        room_type_id: standardRoomMapping.channexRoomTypeId,
        date: "2026-11-02",
        availability: 10,
      });

      // Day 3: 20 - 20 - 2 = 0 (clamped)
      assert.deepStrictEqual(payload.values[2], {
        property_id: PROPERTY_ID,
        room_type_id: standardRoomMapping.channexRoomTypeId,
        date: "2026-11-03",
        availability: 0,
      });
    });

    it("rejects invalid tenant slug or missing identifiers", () => {
      const invalidTenantRes = buildChannexAvailabilityPayload({
        tenantId: "invalid_tenant_slug!",
        propertyId: PROPERTY_ID,
        roomMapping: standardRoomMapping,
        inventoryByDate: [],
      });
      assert.strictEqual(invalidTenantRes.ok, false);

      const missingPropRes = buildChannexAvailabilityPayload({
        tenantId: TENANT_ID,
        propertyId: "",
        roomMapping: standardRoomMapping,
        inventoryByDate: [],
      });
      assert.strictEqual(missingPropRes.ok, false);
    });

    it("rejects malformed date strings in inventory array", () => {
      const badDateRes = buildChannexAvailabilityPayload({
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        roomMapping: standardRoomMapping,
        inventoryByDate: [{ date: "01-11-2026", bookedRooms: 2, outOfOrderRooms: 0 }],
      });
      assert.strictEqual(badDateRes.ok, false);
      if (!badDateRes.ok) {
        assert.strictEqual(badDateRes.error.code, "INVALID_DATE_FORMAT");
      }
    });
  });

  describe("3. Channex /api/v1/restrictions Payload Builder with 4-Stage Taxes & Rates", () => {
    it("builds TAX_EXCLUSIVE LKR rate and stay restrictions payload", () => {
      const input: ChannexRestrictionsInput = {
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        ratePlanMapping: standardRateMapping,
        restrictionsByDate: [
          {
            date: "2026-11-01",
            baseRateLkr: 65000,
            minStayArrival: 2,
            closedToArrival: false,
          },
          {
            date: "2026-11-02",
            baseRateLkr: 75000,
            minStayThrough: 3,
            stopSell: true,
          },
        ],
      };

      const res = buildChannexRestrictionsPayload(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const payload = res.value;
      assert.strictEqual(payload.values.length, 2);

      assert.strictEqual(payload.values[0]?.rate, 65000);
      assert.strictEqual(payload.values[0]?.min_stay_arrival, 2);
      assert.strictEqual(payload.values[0]?.closed_to_arrival, false);

      assert.strictEqual(payload.values[1]?.rate, 75000);
      assert.strictEqual(payload.values[1]?.min_stay_through, 3);
      assert.strictEqual(payload.values[1]?.stop_sell, true);
    });

    it("applies 4-stage compounding Sri Lankan taxes when rate plan is TAX_INCLUSIVE", () => {
      const inclusiveMapping: ChannexRatePlanMapping = {
        ...standardRateMapping,
        pricingModel: "TAX_INCLUSIVE",
      };

      const baseRateLkr = 100000;
      const input: ChannexRestrictionsInput = {
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        ratePlanMapping: inclusiveMapping,
        taxConfig: DEFAULT_SRI_LANKA_TAX_CONFIG,
        restrictionsByDate: [{ date: "2026-11-01", baseRateLkr }],
      };

      const res = buildChannexRestrictionsPayload(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const rate = res.value.values[0]?.rate;
      assert.ok(rate !== undefined);

      // Base: 100,000
      // SC 10%: 10,000 -> Subtotal: 110,000
      // TDL 1%: 1,100
      // SSCL 2.5641%: 2,820.51
      // VAT 18%: 20,505.69
      // Grand Total: 134,343 LKR
      assert.ok(rate > baseRateLkr);
      assert.strictEqual(rate, 134343);
    });

    it("converts LKR rates to locked USD rates for international OTA rate plans", () => {
      const usdMapping: ChannexRatePlanMapping = {
        ...standardRateMapping,
        currency: "USD",
        pricingModel: "TAX_EXCLUSIVE",
      };

      const input: ChannexRestrictionsInput = {
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        ratePlanMapping: usdMapping,
        exchangeRateUsdLkr: 300.0,
        restrictionsByDate: [
          { date: "2026-11-01", baseRateLkr: 60000 }, // 60,000 / 300 = 200 USD
          { date: "2026-11-02", baseRateLkr: 75000, baseRateUsd: 250 }, // direct 250 USD
        ],
      };

      const res = buildChannexRestrictionsPayload(input);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      assert.strictEqual(res.value.values[0]?.rate, 200.0);
      assert.strictEqual(res.value.values[1]?.rate, 250.0);
    });

    it("rejects invalid exchange rate for USD conversion", () => {
      const usdMapping: ChannexRatePlanMapping = {
        ...standardRateMapping,
        currency: "USD",
      };

      const res = buildChannexRestrictionsPayload({
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        ratePlanMapping: usdMapping,
        exchangeRateUsdLkr: -50,
        restrictionsByDate: [{ date: "2026-11-01", baseRateLkr: 50000 }],
      });
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "INVALID_EXCHANGE_RATE");
      }
    });
  });

  describe("4. Staff RBAC Permissions & SaaS Subscription Entitlement Gating", () => {
    it("authorizes managerial and reservationist roles for channel manager sync", () => {
      assert.strictEqual(isStaffAuthorizedForChannelManager("SUPER_ADMIN"), true);
      assert.strictEqual(isStaffAuthorizedForChannelManager("HOTEL_ADMIN"), true);
      assert.strictEqual(isStaffAuthorizedForChannelManager("HOTEL_OWNER"), true);
      assert.strictEqual(isStaffAuthorizedForChannelManager("GENERAL_MANAGER"), true);
      assert.strictEqual(isStaffAuthorizedForChannelManager("RESERVATIONIST"), true);

      assert.strictEqual(isStaffAuthorizedForChannelManager("FRONT_DESK"), false);
      assert.strictEqual(isStaffAuthorizedForChannelManager("HOUSEKEEPING"), false);
      assert.strictEqual(isStaffAuthorizedForChannelManager("WAITER"), false);
    });

    it("rejects unauthorized staff role attempting to sync availability", () => {
      const res = buildChannexAvailabilityPayload({
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        roomMapping: standardRoomMapping,
        inventoryByDate: [{ date: "2026-11-01", bookedRooms: 2, outOfOrderRooms: 0 }],
        authorizedBy: { actorUserId: "STAFF-HK-01", role: "HOUSEKEEPING" },
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PERMISSION_DENIED");
      }
    });

    it("rejects sync when SaaS subscription does not include channel manager entitlement", () => {
      const res = buildChannexAvailabilityPayload({
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        roomMapping: standardRoomMapping,
        inventoryByDate: [{ date: "2026-11-01", bookedRooms: 2, outOfOrderRooms: 0 }],
        subscription: {
          tenantId: TENANT_ID,
          active: true,
          plan: "STARTER",
          allowChannelManager: false, // Not allowed on Starter
        },
      });

      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PLAN_LIMITATION");
      }
    });

    it("rejects sync when SaaS subscription is inactive or has tenant mismatch", () => {
      const inactiveRes = buildChannexAvailabilityPayload({
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        roomMapping: standardRoomMapping,
        inventoryByDate: [{ date: "2026-11-01", bookedRooms: 2, outOfOrderRooms: 0 }],
        subscription: {
          tenantId: TENANT_ID,
          active: false,
          allowChannelManager: true,
        },
      });
      assert.strictEqual(inactiveRes.ok, false);
      if (!inactiveRes.ok) {
        assert.strictEqual(inactiveRes.error.code, "SUBSCRIPTION_INACTIVE");
      }

      const mismatchRes = buildChannexAvailabilityPayload({
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        roomMapping: standardRoomMapping,
        inventoryByDate: [{ date: "2026-11-01", bookedRooms: 2, outOfOrderRooms: 0 }],
        subscription: {
          tenantId: "other-hotel-slug",
          active: true,
          allowChannelManager: true,
        },
      });
      assert.strictEqual(mismatchRes.ok, false);
      if (!mismatchRes.ok) {
        assert.strictEqual(mismatchRes.error.code, "TENANT_MISMATCH");
      }
    });
  });

  describe("5. Cryptographically Hash-Chained Immutable Audit Log Generation", () => {
    it("creates verified SHA-256 hash-chained audit log entry for Channex sync", () => {
      const auditRes = createChannexAriAuditEntry(
        TENANT_ID,
        "STAFF-GM-01",
        "AVAILABILITY",
        {
          propertyId: PROPERTY_ID,
          roomTypeId: standardRoomMapping.channexRoomTypeId,
          datesSynced: 30,
        },
        FIXED_TS,
        GENESIS_HASH,
      );

      assert.strictEqual(auditRes.ok, true);
      if (!auditRes.ok) return;

      const entry = auditRes.value;
      assert.strictEqual(entry.tenantId, TENANT_ID);
      assert.strictEqual(entry.action, "CHANNEX_SYNC_AVAILABILITY");
      assert.strictEqual(entry.entityType, "ChannexAriSync");
      assert.strictEqual(entry.prevHash, GENESIS_HASH);

      // Verify SHA-256 cryptographic hash integrity
      const recomputed = computeAuditEntryHash(entry);
      assert.strictEqual(entry.entryHash, recomputed);
    });

    it("creates verified SHA-256 hash-chained audit log entry for Channex booking revision", () => {
      const auditRes = createChannexBookingAuditEntry(
        TENANT_ID,
        "CHANNEX_WEBHOOK",
        "BKG-2026-9999",
        "CONFIRMED",
        { ota: "Booking.com", grossLkr: 200000 },
        FIXED_TS,
        GENESIS_HASH,
      );

      assert.strictEqual(auditRes.ok, true);
      if (!auditRes.ok) return;

      const entry = auditRes.value;
      assert.strictEqual(entry.tenantId, TENANT_ID);
      assert.strictEqual(entry.action, "OTA_BOOKING_CONFIRMED");
      assert.strictEqual(entry.entityType, "Reservation");
      assert.strictEqual(entry.entityId, "BKG-2026-9999");
      assert.strictEqual(entry.prevHash, GENESIS_HASH);

      const recomputed = computeAuditEntryHash(entry);
      assert.strictEqual(entry.entryHash, recomputed);
    });
  });

  describe("6. Channex Booking Revision Parser (parseChannexBookingRevision)", () => {
    const testRoomMap: ChannexRoomMap = {
      "rt-chx-ocean-suite-99": {
        localRoomTypeId: "OCEAN_POOL_SUITE",
        localRoomTypeName: "Ocean Pool Suite",
      },
      "rt-chx-beach-villa-01": {
        localRoomTypeId: "BEACH_VILLA",
        localRoomTypeName: "Beachfront Villa",
      },
    };

    it("parses Booking.com reservation with LKR currency, breakfast_included (BB), and 4-stage tax reverse breakdown", () => {
      const rawBookingJson = JSON.stringify({
        event: "booking_created",
        property_id: PROPERTY_ID,
        booking: {
          id: "chx-bkg-001",
          ota_reservation_code: "BKG-2026-987654",
          ota_name: "Booking.com",
          status: "new",
          currency: "LKR",
          arrival_date: "2026-11-10",
          departure_date: "2026-11-13",
          customer: {
            name: "Sunil",
            surname: "Perera",
            email: "sunil.p@gmail.com",
            phone: "+94771234567",
            country: "LK",
            notes: "Non-smoking room, high floor requested",
          },
          rooms: [
            {
              room_type_id: "rt-chx-ocean-suite-99",
              rate_plan_id: "rp-chx-bar-bb-01",
              breakfast_included: true,
              occupancy: { adults: 2, children: 1, infants: 0 },
              amount: 403029,
              days: [
                { date: "2026-11-10", amount: 134343 },
                { date: "2026-11-11", amount: 134343 },
                { date: "2026-11-12", amount: 134343 },
              ],
            },
          ],
          total_price: 403029,
          commission_percentage: 15,
          notes: "Anniversary celebration",
          special_requests: "Early check-in 1:00 PM",
        },
      });

      const res = parseChannexBookingRevision(
        rawBookingJson,
        testRoomMap,
        DEFAULT_SRI_LANKA_TAX_CONFIG,
        {
          tenantId: TENANT_ID,
          prevAuditHash: GENESIS_HASH,
        },
      );

      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const b = res.value;
      assert.strictEqual(b.bookingRef, "BKG-2026-987654");
      assert.strictEqual(b.otaReservationCode, "BKG-2026-987654");
      assert.strictEqual(b.channexBookingId, "chx-bkg-001");
      assert.strictEqual(b.channelName, "Booking.com");
      assert.strictEqual(b.source, "OTA_BOOKING.COM");
      assert.strictEqual(b.status, "CONFIRMED");
      assert.strictEqual(b.checkInDate, "2026-11-10");
      assert.strictEqual(b.checkOutDate, "2026-11-13");
      assert.strictEqual(b.nights, 3);
      assert.strictEqual(b.quotedCurrency, "LKR");
      assert.strictEqual(b.originalTotalPrice, 403029);
      assert.strictEqual(b.grossTotalLkr, 403029);

      // 15% commission on 403,029 = 60,454.35
      assert.strictEqual(b.otaCommissionPercentage, 15);
      assert.strictEqual(b.otaCommissionAmountLkr, 60454.35);
      assert.strictEqual(b.netPayableToHotelLkr, 342574.65);

      // Guest details
      assert.strictEqual(b.guest.fullName, "Sunil Perera");
      assert.strictEqual(b.guest.firstName, "Sunil");
      assert.strictEqual(b.guest.lastName, "Perera");
      assert.strictEqual(b.guest.email, "sunil.p@gmail.com");
      assert.strictEqual(b.guest.countryIso, "LK");
      assert.strictEqual(b.guest.residencyTier, "RESIDENT");

      // Meal Plan
      assert.strictEqual(b.mealPlan, "BB");
      assert.strictEqual(b.rooms[0]?.mealPlan, "BB");
      assert.strictEqual(b.rooms[0]?.localRoomTypeId, "OCEAN_POOL_SUITE");
      assert.strictEqual(b.rooms[0]?.localRoomTypeName, "Ocean Pool Suite");
      assert.strictEqual(b.rooms[0]?.adults, 2);
      assert.strictEqual(b.rooms[0]?.children, 1);
      assert.strictEqual(b.rooms[0]?.days.length, 3);

      // Reverse 4-Stage Taxes:
      // 3 nights @ 100,000 base + 34.343% tax = 403,029 gross
      // Base: 300,000 LKR
      assert.strictEqual(b.taxBreakdown.baseLkr, 300000);
      assert.strictEqual(b.taxBreakdown.scLkr, 30000);
      assert.strictEqual(b.taxBreakdown.subtotalAfterScLkr, 330000);
      assert.strictEqual(b.taxBreakdown.grandTotalLkr, 403029);

      // Special requests concatenation
      assert.ok(b.specialRequests.includes("Anniversary celebration"));
      assert.ok(b.specialRequests.includes("Early check-in 1:00 PM"));
      assert.ok(b.specialRequests.includes("Non-smoking room"));

      // Audit Log
      assert.ok(b.auditLog !== undefined);
      assert.strictEqual(b.auditLog?.tenantId, TENANT_ID);
      assert.strictEqual(b.auditLog?.action, "OTA_BOOKING_CONFIRMED");
      assert.strictEqual(b.auditLog?.entityId, "BKG-2026-987654");
      assert.strictEqual(b.auditLog?.prevHash, GENESIS_HASH);
    });

    it("parses Agoda reservation with USD currency, converting to LKR and identifying foreign tourist", () => {
      const agodaPayload = {
        id: "chx-agoda-888",
        ota_reservation_code: "AGODA-776655",
        ota_name: "Agoda",
        status: "modified",
        currency: "USD",
        arrival_date: "2026-12-20",
        departure_date: "2026-12-25",
        customer: {
          name: "Emily",
          surname: "Watson",
          email: "emily.w@oxford.ac.uk",
          phone: "+447911123456",
          country: "GB",
        },
        rooms: [
          {
            room_type_id: "rt-chx-beach-villa-01",
            meal_plan: "half_board",
            occupancy: { adults: 2, children: 0 },
            amount: 1500,
            days: [
              { date: "2026-12-20", amount: 300 },
              { date: "2026-12-21", amount: 300 },
              { date: "2026-12-22", amount: 300 },
              { date: "2026-12-23", amount: 300 },
              { date: "2026-12-24", amount: 300 },
            ],
          },
        ],
        total_price: 1500,
        ota_commission: 270, // 18% USD commission
      };

      const res = parseChannexBookingRevision(
        agodaPayload,
        testRoomMap,
        DEFAULT_SRI_LANKA_TAX_CONFIG,
        {
          tenantId: TENANT_ID,
          exchangeRateUsdLkr: 300.0,
        },
      );

      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      const b = res.value;
      assert.strictEqual(b.bookingRef, "AGODA-776655");
      assert.strictEqual(b.channelName, "Agoda");
      assert.strictEqual(b.status, "MODIFIED");
      assert.strictEqual(b.nights, 5);
      assert.strictEqual(b.quotedCurrency, "USD");
      assert.strictEqual(b.originalTotalPrice, 1500);

      // USD 1,500 * 300 = 450,000 LKR
      assert.strictEqual(b.lockedExchangeRateLkr, 300.0);
      assert.strictEqual(b.grossTotalLkr, 450000);

      // USD 270 * 300 = 81,000 LKR commission (18%)
      assert.strictEqual(b.otaCommissionAmountLkr, 81000);
      assert.strictEqual(b.otaCommissionPercentage, 18);
      assert.strictEqual(b.netPayableToHotelLkr, 369000);

      // Foreign Tourist
      assert.strictEqual(b.guest.fullName, "Emily Watson");
      assert.strictEqual(b.guest.countryIso, "GB");
      assert.strictEqual(b.guest.residencyTier, "NON_RESIDENT");

      // Meal Plan resolved to HB
      assert.strictEqual(b.mealPlan, "HB");
      assert.strictEqual(b.rooms[0]?.mealPlan, "HB");
      assert.strictEqual(b.rooms[0]?.localRoomTypeId, "BEACH_VILLA");
      assert.strictEqual(b.rooms[0]?.roomTotalGrossLkr, 450000);
    });

    it("parses Expedia cancelled reservation cleanly", () => {
      const expediaPayload = {
        id: "chx-exp-999",
        ota_name: "Expedia",
        status: "cancelled",
        currency: "LKR",
        arrival_date: "2026-11-15",
        departure_date: "2026-11-17",
        customer: { full_name: "Oliver Smith" },
        rooms: [
          {
            room_type_id: "rt-chx-ocean-suite-99",
            occupancy: { adults: 1 },
            amount: 100000,
          },
        ],
        total_price: 100000,
      };

      const res = parseChannexBookingRevision(expediaPayload, testRoomMap);
      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      assert.strictEqual(res.value.status, "CANCELLED");
      assert.strictEqual(res.value.channelName, "Expedia");
      assert.strictEqual(res.value.guest.fullName, "Oliver Smith");
    });

    it("rejects booking revision when room type is not mapped in roomMap", () => {
      const unmappedPayload = {
        id: "chx-bkg-unmapped",
        currency: "LKR",
        arrival_date: "2026-11-10",
        departure_date: "2026-11-12",
        rooms: [
          {
            room_type_id: "rt-unknown-penthouse",
            amount: 250000,
          },
        ],
        total_price: 250000,
      };

      const res = parseChannexBookingRevision(unmappedPayload, testRoomMap);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "NOT_FOUND");
        assert.ok(res.error.message.includes("rt-unknown-penthouse"));
      }
    });

    it("rejects booking revision with invalid date format or missing ID", () => {
      const invalidDatePayload = {
        id: "chx-bkg-bad-date",
        currency: "LKR",
        arrival_date: "10-11-2026", // Bad format
        departure_date: "2026-11-12",
        rooms: [{ room_type_id: "rt-chx-ocean-suite-99" }],
        total_price: 100000,
      };

      const dateRes = parseChannexBookingRevision(invalidDatePayload, testRoomMap);
      assert.strictEqual(dateRes.ok, false);
      if (!dateRes.ok) {
        assert.strictEqual(dateRes.error.code, "INVALID_DATE_FORMAT");
      }

      const missingIdPayload = {
        currency: "LKR",
        arrival_date: "2026-11-10",
        departure_date: "2026-11-12",
        rooms: [{ room_type_id: "rt-chx-ocean-suite-99" }],
        total_price: 100000,
      };

      const idRes = parseChannexBookingRevision(missingIdPayload, testRoomMap);
      assert.strictEqual(idRes.ok, false);
      if (!idRes.ok) {
        assert.strictEqual(idRes.error.code, "VALIDATION_FAILED");
      }
    });

    it("tests resolveMealPlan across all Sri Lankan hospitality board types", () => {
      assert.strictEqual(resolveMealPlan(true), "BB");
      assert.strictEqual(resolveMealPlan(false, "room_only"), "RO");
      assert.strictEqual(resolveMealPlan(false, "bed_and_breakfast"), "BB");
      assert.strictEqual(resolveMealPlan(false, "half_board"), "HB");
      assert.strictEqual(resolveMealPlan(false, "full_board"), "FB");
      assert.strictEqual(resolveMealPlan(false, "all_inclusive"), "AI");
      assert.strictEqual(resolveMealPlan(false, undefined), "RO");
    });

    it("verifies booking_new event payload with Booking.com and full tax breakdown", () => {
      const bkgNew = {
        event: "booking_new",
        property_id: PROPERTY_ID,
        booking: {
          id: "chx-bkg-new-101",
          ota_reservation_code: "BKG-NEW-101",
          ota_name: "Booking.com",
          status: "new",
          currency: "LKR",
          arrival_date: "2026-11-20",
          departure_date: "2026-11-22",
          customer: {
            name: "Nimal",
            surname: "Silva",
            email: "nimal.silva@slt.lk",
            phone: "+94712345678",
            country: "LK",
          },
          rooms: [
            {
              room_type_id: "rt-chx-ocean-suite-99",
              breakfast_included: false,
              meal_plan: "RO",
              occupancy: { adults: 2, children: 0 },
              amount: 268686,
            },
          ],
          total_price: 268686,
          ota_commission: 40302.9,
        },
      };

      const res = parseChannexBookingRevision(bkgNew, testRoomMap, DEFAULT_SRI_LANKA_TAX_CONFIG, {
        tenantId: TENANT_ID,
        authorizedBy: { actorUserId: "STAFF-RES-01", role: "RESERVATIONIST" },
        subscription: { tenantId: TENANT_ID, active: true, allowChannelManager: true },
      });

      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      assert.strictEqual(res.value.status, "CONFIRMED");
      assert.strictEqual(res.value.mealPlan, "RO");
      assert.strictEqual(res.value.grossTotalLkr, 268686);
      assert.strictEqual(res.value.taxBreakdown.baseLkr, 200000);
      assert.strictEqual(res.value.taxBreakdown.grandTotalLkr, 268686);
    });

    it("verifies booking_modification event payload with Agoda and USD-to-LKR rate locking", () => {
      const agodaMod = {
        event: "booking_modification",
        property_id: PROPERTY_ID,
        booking: {
          id: "chx-agoda-mod-202",
          ota_reservation_code: "AGODA-MOD-202",
          ota_name: "Agoda",
          status: "modified",
          currency: "USD",
          arrival_date: "2026-12-01",
          departure_date: "2026-12-05",
          customer: {
            name: "Klaus",
            surname: "Mueller",
            email: "klaus.m@berlin.de",
            phone: "+491701234567",
            country: "DE",
          },
          rooms: [
            {
              room_type_id: "rt-chx-beach-villa-01",
              breakfast_included: true,
              occupancy: { adults: 2, children: 2 },
              amount: 1200,
            },
          ],
          total_price: 1200,
          commission_percentage: 18,
        },
      };

      const res = parseChannexBookingRevision(agodaMod, testRoomMap, DEFAULT_SRI_LANKA_TAX_CONFIG, {
        tenantId: TENANT_ID,
        exchangeRateUsdLkr: 310.0,
      });

      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      assert.strictEqual(res.value.status, "MODIFIED");
      assert.strictEqual(res.value.nights, 4);
      assert.strictEqual(res.value.lockedExchangeRateLkr, 310.0);
      // 1200 USD * 310 = 372,000 LKR
      assert.strictEqual(res.value.grossTotalLkr, 372000);
      // 18% commission on 372,000 = 66,960 LKR
      assert.strictEqual(res.value.otaCommissionAmountLkr, 66960);
      assert.strictEqual(res.value.netPayableToHotelLkr, 305040);
      assert.strictEqual(res.value.guest.countryIso, "DE");
      assert.strictEqual(res.value.guest.residencyTier, "NON_RESIDENT");
    });

    it("verifies booking_cancellation event payload with Booking.com", () => {
      const bkgCancel = {
        event: "booking_cancellation",
        property_id: PROPERTY_ID,
        booking: {
          id: "chx-bkg-cancel-303",
          ota_reservation_code: "BKG-CANCEL-303",
          ota_name: "Booking.com",
          status: "cancelled",
          currency: "LKR",
          arrival_date: "2026-11-25",
          departure_date: "2026-11-28",
          customer: {
            full_name: "Chaminda Vaas",
            country: "LK",
          },
          rooms: [
            {
              room_type_id: "rt-chx-ocean-suite-99",
              occupancy: { adults: 2 },
              amount: 0,
            },
          ],
          total_price: 0,
        },
      };

      const res = parseChannexBookingRevision(
        bkgCancel,
        testRoomMap,
        DEFAULT_SRI_LANKA_TAX_CONFIG,
        {
          tenantId: TENANT_ID,
        },
      );

      assert.strictEqual(res.ok, true);
      if (!res.ok) return;

      assert.strictEqual(res.value.status, "CANCELLED");
      assert.strictEqual(res.value.bookingRef, "BKG-CANCEL-303");
      assert.strictEqual(res.value.grossTotalLkr, 0);
    });

    it("rejects booking revision when SaaS subscription is inactive or feature disabled", () => {
      const validPayload = {
        id: "chx-sub-test",
        currency: "LKR",
        arrival_date: "2026-11-10",
        departure_date: "2026-11-12",
        rooms: [{ room_type_id: "rt-chx-ocean-suite-99", amount: 100000 }],
        total_price: 100000,
      };

      const inactiveRes = parseChannexBookingRevision(validPayload, testRoomMap, undefined, {
        tenantId: TENANT_ID,
        subscription: { tenantId: TENANT_ID, active: false, allowChannelManager: true },
      });
      assert.strictEqual(inactiveRes.ok, false);
      if (!inactiveRes.ok) {
        assert.strictEqual(inactiveRes.error.code, "SUBSCRIPTION_INACTIVE");
      }

      const noFeatureRes = parseChannexBookingRevision(validPayload, testRoomMap, undefined, {
        tenantId: TENANT_ID,
        subscription: { tenantId: TENANT_ID, active: true, allowChannelManager: false },
      });
      assert.strictEqual(noFeatureRes.ok, false);
      if (!noFeatureRes.ok) {
        assert.strictEqual(noFeatureRes.error.code, "PLAN_LIMITATION");
      }
    });

    it("rejects booking revision when staff role is not authorized for channel manager", () => {
      const validPayload = {
        id: "chx-rbac-test",
        currency: "LKR",
        arrival_date: "2026-11-10",
        departure_date: "2026-11-12",
        rooms: [{ room_type_id: "rt-chx-ocean-suite-99", amount: 100000 }],
        total_price: 100000,
      };

      const rbacRes = parseChannexBookingRevision(validPayload, testRoomMap, undefined, {
        tenantId: TENANT_ID,
        authorizedBy: { actorUserId: "STAFF-WAITER-01", role: "WAITER" },
      });
      assert.strictEqual(rbacRes.ok, false);
      if (!rbacRes.ok) {
        assert.strictEqual(rbacRes.error.code, "PERMISSION_DENIED");
      }
    });
  });
});
