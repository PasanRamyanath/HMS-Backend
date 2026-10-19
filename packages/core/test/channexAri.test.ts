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
  type ChannexRoomMapping,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  buildChannexAvailabilityPayload,
  buildChannexRestrictionsPayload,
  calculateNetAvailability,
  computeAuditEntryHash,
  createChannexAriAuditEntry,
  isStaffAuthorizedForChannelManager,
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
  });
});
