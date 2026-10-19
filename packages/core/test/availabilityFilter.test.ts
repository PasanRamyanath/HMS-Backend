import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AvailableDriverBedsResult,
  type AvailableRoomsResult,
  type DriverDormBedItem,
  type ExistingDriverBedBooking,
  type ExistingReservationSlot,
  type MaintenanceBlock,
  type RoomInventoryItem,
  checkIntervalOverlap,
  checkSingleRoomAvailability,
  createAvailabilityAuditRecord,
  filterAvailableDriverBeds,
  filterAvailableRooms,
  isBlockingReservationStatus,
  validateDateRange,
} from "../src/index.js";

describe("Date-Range Conflict & Room Availability Filter (availabilityFilter.ts)", () => {
  const tenantId = "tenant-galle-fort";

  describe("Pure Interval Overlap Mathematics (checkIntervalOverlap)", () => {
    it("returns true for overlapping date ranges", () => {
      // Requested: [2026-10-20, 2026-10-25)
      // Existing:  [2026-10-22, 2026-10-28)
      assert.strictEqual(
        checkIntervalOverlap("2026-10-20", "2026-10-25", "2026-10-22", "2026-10-28"),
        true,
      );
    });

    it("returns false for non-overlapping disjoint ranges", () => {
      // Requested: [2026-10-10, 2026-10-15)
      // Existing:  [2026-10-20, 2026-10-25)
      assert.strictEqual(
        checkIntervalOverlap("2026-10-10", "2026-10-15", "2026-10-20", "2026-10-25"),
        false,
      );
      assert.strictEqual(
        checkIntervalOverlap("2026-10-25", "2026-10-30", "2026-10-10", "2026-10-20"),
        false,
      );
    });

    it("guarantees same-day checkout/checkin turnaround does NOT conflict", () => {
      // Existing guest checks out on 2026-10-20 at 11:00 AM
      // New guest checks in on 2026-10-20 at 2:00 PM
      assert.strictEqual(
        checkIntervalOverlap("2026-10-20", "2026-10-23", "2026-10-18", "2026-10-20"),
        false,
      );
      assert.strictEqual(
        checkIntervalOverlap("2026-10-18", "2026-10-20", "2026-10-20", "2026-10-23"),
        false,
      );
    });

    it("detects completely enclosed intervals", () => {
      // Requested: [2026-10-21, 2026-10-23)
      // Existing:  [2026-10-19, 2026-10-26)
      assert.strictEqual(
        checkIntervalOverlap("2026-10-21", "2026-10-23", "2026-10-19", "2026-10-26"),
        true,
      );
    });
  });

  describe("Date Range Validation (validateDateRange)", () => {
    it("validates valid ISO date string range and calculates nights", () => {
      const res = validateDateRange("2026-10-20", "2026-10-25");
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.checkIn, "2026-10-20");
        assert.strictEqual(res.value.checkOut, "2026-10-25");
        assert.strictEqual(res.value.nights, 5);
      }
    });

    it("returns error for invalid date format", () => {
      const invalidIn = validateDateRange("20-10-2026", "2026-10-25");
      assert.strictEqual(invalidIn.ok, false);
      if (!invalidIn.ok) {
        assert.strictEqual(invalidIn.error.code, "VALIDATION_FAILED");
      }

      const invalidOut = validateDateRange("2026-10-20", "not-a-date");
      assert.strictEqual(invalidOut.ok, false);
      if (!invalidOut.ok) {
        assert.strictEqual(invalidOut.error.code, "VALIDATION_FAILED");
      }
    });

    it("returns DATE_OVERLAP error when checkIn >= checkOut", () => {
      const sameDay = validateDateRange("2026-10-20", "2026-10-20");
      assert.strictEqual(sameDay.ok, false);
      if (!sameDay.ok) {
        assert.strictEqual(sameDay.error.code, "DATE_OVERLAP");
      }

      const reversed = validateDateRange("2026-10-25", "2026-10-20");
      assert.strictEqual(reversed.ok, false);
      if (!reversed.ok) {
        assert.strictEqual(reversed.error.code, "DATE_OVERLAP");
      }
    });
  });

  describe("Blocking Reservation Status Check (isBlockingReservationStatus)", () => {
    it("identifies blocking vs non-blocking statuses", () => {
      assert.strictEqual(isBlockingReservationStatus("CONFIRMED"), true);
      assert.strictEqual(isBlockingReservationStatus("CHECKED_IN"), true);
      assert.strictEqual(isBlockingReservationStatus("INQUIRY"), true);
      assert.strictEqual(isBlockingReservationStatus("OUT_OF_ORDER"), true);

      assert.strictEqual(isBlockingReservationStatus("CANCELLED"), false);
      assert.strictEqual(isBlockingReservationStatus("NO_SHOW"), false);
    });
  });

  describe("Multi-Tenant Room Availability Filter (filterAvailableRooms)", () => {
    const sampleRooms: ReadonlyArray<RoomInventoryItem> = [
      {
        id: "rm-101",
        tenantId,
        roomNumber: "101",
        roomTypeId: "rt-deluxe",
        building: "Main",
        floor: "1",
        isActive: true,
      },
      {
        id: "rm-102",
        tenantId,
        roomNumber: "102",
        roomTypeId: "rt-deluxe",
        building: "Main",
        floor: "1",
        isActive: true,
      },
      {
        id: "rm-103",
        tenantId,
        roomNumber: "103",
        roomTypeId: "rt-deluxe",
        building: "Main",
        floor: "1",
        isActive: true,
      },
      {
        id: "rm-201",
        tenantId,
        roomNumber: "201",
        roomTypeId: "rt-suite",
        building: "Main",
        floor: "2",
        isActive: true,
      },
      {
        id: "rm-202",
        tenantId,
        roomNumber: "202",
        roomTypeId: "rt-suite",
        building: "Main",
        floor: "2",
        isActive: false,
      }, // Inactive
    ];

    it("enforces tenantId validation", () => {
      const res = filterAvailableRooms({
        tenantId: "invalid/tenant",
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        rooms: sampleRooms,
        reservations: [],
      });
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "VALIDATION_FAILED");
      }
    });

    it("returns all active rooms when no reservations or blocks exist", () => {
      const res = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        rooms: sampleRooms,
        reservations: [],
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val: AvailableRoomsResult = res.value;
        assert.strictEqual(val.totalRoomsCount, 4); // rm-202 is inactive
        assert.strictEqual(val.availableRoomsCount, 4);
        assert.strictEqual(val.availableCountByRoomType["rt-deluxe"], 3);
        assert.strictEqual(val.availableCountByRoomType["rt-suite"], 1);
        assert.strictEqual(val.isAvailable, true);
      }
    });

    it("filters out rooms with overlapping reservations", () => {
      const existingReservations: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "res-1",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-deluxe",
          checkInDate: "2026-10-18",
          checkOutDate: "2026-10-22", // overlaps 2026-10-20 -> 2026-10-25
          status: "CHECKED_IN",
        },
        {
          id: "res-cancelled",
          tenantId,
          roomId: "rm-102",
          roomTypeId: "rt-deluxe",
          checkInDate: "2026-10-19",
          checkOutDate: "2026-10-24",
          status: "CANCELLED", // Should NOT block rm-102
        },
      ];

      const res = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        rooms: sampleRooms,
        reservations: existingReservations,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.availableRoomsCount, 3); // 102, 103, 201
        assert.ok(res.value.conflictingRoomIds.includes("rm-101"));
        assert.ok(!res.value.conflictingRoomIds.includes("rm-102"));
        assert.strictEqual(res.value.availableCountByRoomType["rt-deluxe"], 2);
      }
    });

    it("filters out rooms under maintenance block", () => {
      const blocks: ReadonlyArray<MaintenanceBlock> = [
        {
          id: "block-103",
          tenantId,
          roomId: "rm-103",
          startDate: "2026-10-19",
          endDate: "2026-10-23",
          reason: "Air conditioner service",
        },
      ];

      const res = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        rooms: sampleRooms,
        reservations: [],
        maintenanceBlocks: blocks,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.ok(res.value.conflictingRoomIds.includes("rm-103"));
        assert.strictEqual(res.value.availableCountByRoomType["rt-deluxe"], 2);
      }
    });

    it("deducts unallocated room-type reservations from available count", () => {
      const unallocated: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "res-unallocated",
          tenantId,
          roomTypeId: "rt-deluxe",
          checkInDate: "2026-10-20",
          checkOutDate: "2026-10-22",
          status: "CONFIRMED",
        },
      ];

      const res = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        roomTypeId: "rt-deluxe",
        requestedCount: 3,
        rooms: sampleRooms,
        reservations: unallocated,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        // 3 physical rooms minus 1 unallocated = 2 available
        assert.strictEqual(res.value.availableCountByRoomType["rt-deluxe"], 2);
        // Requested 3 rooms, so isAvailable is false
        assert.strictEqual(res.value.isAvailable, false);
      }
    });
  });

  describe("Single Room Availability Check (checkSingleRoomAvailability)", () => {
    const reservations: ReadonlyArray<ExistingReservationSlot> = [
      {
        id: "res-occupied",
        tenantId,
        roomId: "rm-101",
        roomTypeId: "rt-deluxe",
        checkInDate: "2026-10-19",
        checkOutDate: "2026-10-22",
        status: "CONFIRMED",
      },
    ];

    it("returns false when room has an active overlapping reservation", () => {
      const res = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-24",
        reservations,
      });
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value, false);
      }
    });

    it("returns true when room has back-to-back non-overlapping booking", () => {
      const res = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-10-22", // Arrives exactly when prior guest departs
        checkOutDate: "2026-10-25",
        reservations,
      });
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value, true);
      }
    });
  });

  describe("Chauffeur / Driver Dormitory Bed Availability (filterAvailableDriverBeds)", () => {
    const driverBeds: ReadonlyArray<DriverDormBedItem> = [
      {
        id: "bed-m1",
        tenantId,
        bedNumber: "B1",
        dormName: "Chauffeur Wing A",
        gender: "MALE",
        isActive: true,
      },
      {
        id: "bed-m2",
        tenantId,
        bedNumber: "B2",
        dormName: "Chauffeur Wing A",
        gender: "MALE",
        isActive: true,
      },
      {
        id: "bed-f1",
        tenantId,
        bedNumber: "B3",
        dormName: "Chauffeur Wing B",
        gender: "FEMALE",
        isActive: true,
      },
      {
        id: "bed-m3",
        tenantId,
        bedNumber: "B4",
        dormName: "Chauffeur Wing A",
        gender: "MALE",
        isActive: false,
      }, // Inactive
    ];

    const bookings: ReadonlyArray<ExistingDriverBedBooking> = [
      {
        id: "book-1",
        tenantId,
        driverBedId: "bed-m1",
        checkInDate: "2026-10-19",
        checkOutDate: "2026-10-22",
        status: "CONFIRMED",
      },
    ];

    it("calculates available driver beds filtering by gender and active status", () => {
      const res = filterAvailableDriverBeds({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-24",
        gender: "MALE",
        requestedBedsCount: 1,
        driverBeds,
        existingBookings: bookings,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        const val: AvailableDriverBedsResult = res.value;
        assert.strictEqual(val.totalBedsCount, 2); // bed-m1 and bed-m2
        assert.strictEqual(val.availableBedsCount, 1); // bed-m2 (bed-m1 is booked)
        assert.strictEqual(val.availableBeds[0]?.id, "bed-m2");
        assert.strictEqual(val.isAvailable, true);
      }
    });

    it("returns isAvailable=false when requested beds exceed available count", () => {
      const res = filterAvailableDriverBeds({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-24",
        gender: "MALE",
        requestedBedsCount: 2, // Only 1 available
        driverBeds,
        existingBookings: bookings,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.availableBedsCount, 1);
        assert.strictEqual(res.value.isAvailable, false);
      }
    });
  });

  describe("Audit Log Payload Generation", () => {
    it("creates tamper-evident audit record for availability query", () => {
      const res = createAvailabilityAuditRecord(
        "genesis-hash-000",
        tenantId,
        "staff-frontdesk-1",
        "ROOM_AVAILABILITY_QUERY",
        {
          checkIn: "2026-10-20",
          checkOut: "2026-10-25",
          availableCount: 4,
        },
      );

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.tenantId, tenantId);
        assert.strictEqual(res.value.action, "ROOM_AVAILABILITY_QUERY");
        assert.strictEqual(res.value.prevHash, "genesis-hash-000");
        assert.strictEqual(res.value.entryHash.length, 64); // SHA-256 hex string
      }
    });
  });
});
