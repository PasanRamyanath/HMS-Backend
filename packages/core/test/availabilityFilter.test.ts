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

  describe("Back-to-Back Same-Day Turnaround ([checkIn, checkOut) Semantics)", () => {
    const testRooms: ReadonlyArray<RoomInventoryItem> = [
      {
        id: "rm-101",
        tenantId,
        roomNumber: "101",
        roomTypeId: "rt-ocean-view",
        building: "Villa Lotus",
        floor: "1",
        isActive: true,
      },
      {
        id: "rm-102",
        tenantId,
        roomNumber: "102",
        roomTypeId: "rt-ocean-view",
        building: "Villa Lotus",
        floor: "1",
        isActive: true,
      },
      {
        id: "rm-103",
        tenantId,
        roomNumber: "103",
        roomTypeId: "rt-ocean-view",
        building: "Villa Lotus",
        floor: "1",
        isActive: true,
      },
    ];

    it("allows immediate check-in at 14:00 when prior guest checks out at 11:00 on the same date", () => {
      // Prior reservation: Guest departing 2026-10-20 (Check-out 11:00 AM)
      const existing: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "res-departing",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-15",
          checkOutDate: "2026-10-20",
          status: "CHECKED_IN",
        },
      ];

      // New reservation inquiry: Guest arriving 2026-10-20 (Check-in 14:00 PM) -> 2026-10-25
      const singleCheck = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        reservations: existing,
      });

      assert.strictEqual(singleCheck.ok, true);
      if (singleCheck.ok) {
        assert.strictEqual(singleCheck.value, true);
      }

      const multiCheck = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        rooms: testRooms,
        reservations: existing,
      });

      assert.strictEqual(multiCheck.ok, true);
      if (multiCheck.ok) {
        assert.strictEqual(multiCheck.value.availableRoomsCount, 3);
        assert.strictEqual(multiCheck.value.conflictingRoomIds.length, 0);
        assert.strictEqual(multiCheck.value.isAvailable, true);
      }
    });

    it("supports multi-guest sequential booking chains with back-to-back same-day handoffs", () => {
      // 3 sequential contiguous stays on the same room
      // Guest A: [2026-10-10, 2026-10-14)
      // Guest B: [2026-10-14, 2026-10-18)
      // Guest C: [2026-10-18, 2026-10-22)
      const bookingChain: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "chain-guest-a",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-10",
          checkOutDate: "2026-10-14",
          status: "CHECKED_OUT",
        },
        {
          id: "chain-guest-b",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-14",
          checkOutDate: "2026-10-18",
          status: "CHECKED_IN",
        },
        {
          id: "chain-guest-c",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-18",
          checkOutDate: "2026-10-22",
          status: "CONFIRMED",
        },
      ];

      // Next guest arriving exactly on 2026-10-22: [2026-10-22, 2026-10-26)
      const nextGuest = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-10-22",
        checkOutDate: "2026-10-26",
        reservations: bookingChain,
      });
      assert.strictEqual(nextGuest.ok, true);
      if (nextGuest.ok) {
        assert.strictEqual(nextGuest.value, true);
      }

      // Guest arriving before Guest A: [2026-10-06, 2026-10-10)
      const priorGuest = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-10-06",
        checkOutDate: "2026-10-10",
        reservations: bookingChain,
      });
      assert.strictEqual(priorGuest.ok, true);
      if (priorGuest.ok) {
        assert.strictEqual(priorGuest.value, true);
      }

      // Guest overlapping across boundary [2026-10-13, 2026-10-15) must conflict with both A and B
      const overlappingGuest = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-10-13",
        checkOutDate: "2026-10-15",
        reservations: bookingChain,
      });
      assert.strictEqual(overlappingGuest.ok, true);
      if (overlappingGuest.ok) {
        assert.strictEqual(overlappingGuest.value, false);
      }
    });

    it("permits guest check-in on the exact day a scheduled maintenance block concludes", () => {
      // AC deep-cleaning scheduled until 2026-10-20
      const maintenanceBlocks: ReadonlyArray<MaintenanceBlock> = [
        {
          id: "maint-1",
          tenantId,
          roomId: "rm-102",
          startDate: "2026-10-17",
          endDate: "2026-10-20",
          reason: "Air Conditioner Deep Sanitization & Filter Replacement",
        },
      ];

      // Guest checks in on 2026-10-20 after maintenance completes
      const res = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-24",
        rooms: testRooms,
        reservations: [],
        maintenanceBlocks,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.availableRoomsCount, 3);
        assert.strictEqual(res.value.conflictingRoomIds.includes("rm-102"), false);
        assert.strictEqual(res.value.isAvailable, true);
      }
    });

    it("permits scheduled maintenance block to start on the exact day a guest checks out", () => {
      // Guest checks out on 2026-10-20
      const guestReservations: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "res-guest-departing",
          tenantId,
          roomId: "rm-103",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-16",
          checkOutDate: "2026-10-20",
          status: "CHECKED_IN",
        },
      ];

      // Routine plumbing overhaul starting on 2026-10-20
      const maintenanceBlocks: ReadonlyArray<MaintenanceBlock> = [
        {
          id: "maint-2",
          tenantId,
          roomId: "rm-103",
          startDate: "2026-10-20",
          endDate: "2026-10-23",
          reason: "Plumbing Overhaul",
        },
      ];

      // Verify room 103 is available for the departing guest's window [16, 20) without collision with maintenance
      const priorCheck = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-103",
        checkInDate: "2026-10-16",
        checkOutDate: "2026-10-20",
        reservations: [],
        maintenanceBlocks,
      });

      assert.strictEqual(priorCheck.ok, true);
      if (priorCheck.ok) {
        assert.strictEqual(priorCheck.value, true);
      }

      // And for the maintenance window [20, 23), room 103 does not conflict with the departing guest
      const duringMaint = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-103",
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-23",
        reservations: guestReservations,
        maintenanceBlocks: [],
      });

      assert.strictEqual(duringMaint.ok, true);
      if (duringMaint.ok) {
        assert.strictEqual(duringMaint.value, true);
      }
    });

    it("handles rapid single-night back-to-back stays without collision", () => {
      // 3 consecutive 1-night stays on room 101:
      // Night 1: [2026-11-01, 2026-11-02)
      // Night 2: [2026-11-02, 2026-11-03)
      // Night 3: [2026-11-03, 2026-11-04)
      const oneNightReservations: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "stay-night-1",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-11-01",
          checkOutDate: "2026-11-02",
          status: "CONFIRMED",
        },
        {
          id: "stay-night-2",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-11-02",
          checkOutDate: "2026-11-03",
          status: "CONFIRMED",
        },
      ];

      // Checking availability for Night 3: [2026-11-03, 2026-11-04)
      const night3Check = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-11-03",
        checkOutDate: "2026-11-04",
        reservations: oneNightReservations,
      });

      assert.strictEqual(night3Check.ok, true);
      if (night3Check.ok) {
        assert.strictEqual(night3Check.value, true);
      }

      // Inquiry overlapping 1 hour or 1 night across night 1 & 2 [2026-11-01, 2026-11-03) should conflict
      const twoNightOverlap = checkSingleRoomAvailability({
        tenantId,
        roomId: "rm-101",
        checkInDate: "2026-11-01",
        checkOutDate: "2026-11-03",
        reservations: oneNightReservations,
      });

      assert.strictEqual(twoNightOverlap.ok, true);
      if (twoNightOverlap.ok) {
        assert.strictEqual(twoNightOverlap.value, false);
      }
    });

    it("processes entire property turnaround on checkout day for group reservations", () => {
      // Entire hotel (rm-101, rm-102, rm-103) departing 2026-10-20
      const groupDeparture: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "grp-1",
          tenantId,
          roomId: "rm-101",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-15",
          checkOutDate: "2026-10-20",
          status: "CHECKED_IN",
        },
        {
          id: "grp-2",
          tenantId,
          roomId: "rm-102",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-15",
          checkOutDate: "2026-10-20",
          status: "CHECKED_IN",
        },
        {
          id: "grp-3",
          tenantId,
          roomId: "rm-103",
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-15",
          checkOutDate: "2026-10-20",
          status: "CHECKED_IN",
        },
      ];

      // New corporate group checking in on 2026-10-20 for 3 rooms
      const groupArrival = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-25",
        roomTypeId: "rt-ocean-view",
        requestedCount: 3,
        rooms: testRooms,
        reservations: groupDeparture,
      });

      assert.strictEqual(groupArrival.ok, true);
      if (groupArrival.ok) {
        assert.strictEqual(groupArrival.value.availableRoomsCount, 3);
        assert.strictEqual(groupArrival.value.availableCountByRoomType["rt-ocean-view"], 3);
        assert.strictEqual(groupArrival.value.conflictingRoomIds.length, 0);
        assert.strictEqual(groupArrival.value.isAvailable, true);
      }
    });

    it("supports same-day turnaround in chauffeur dormitory beds", () => {
      const beds: ReadonlyArray<DriverDormBedItem> = [
        {
          id: "bed-sl-1",
          tenantId,
          bedNumber: "D-01",
          dormName: "Chauffeur Quarters North",
          gender: "MALE",
          isActive: true,
        },
      ];

      // Chauffeur 1 departs 2026-10-20 morning
      const bedBookings: ReadonlyArray<ExistingDriverBedBooking> = [
        {
          id: "driver-booking-1",
          tenantId,
          driverBedId: "bed-sl-1",
          checkInDate: "2026-10-17",
          checkOutDate: "2026-10-20",
          status: "CHECKED_IN",
        },
      ];

      // Chauffeur 2 arrives 2026-10-20 afternoon
      const bedCheck = filterAvailableDriverBeds({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-23",
        gender: "MALE",
        requestedBedsCount: 1,
        driverBeds: beds,
        existingBookings: bedBookings,
      });

      assert.strictEqual(bedCheck.ok, true);
      if (bedCheck.ok) {
        assert.strictEqual(bedCheck.value.availableBedsCount, 1);
        assert.strictEqual(bedCheck.value.isAvailable, true);
        assert.strictEqual(bedCheck.value.availableBeds[0]?.id, "bed-sl-1");
      }
    });

    it("does not deduct unallocated room-type pool for non-overlapping same-day check-in", () => {
      // DMC unallocated room-type reservation departing 2026-10-20
      const unallocatedSlots: ReadonlyArray<ExistingReservationSlot> = [
        {
          id: "dmc-unallocated-1",
          tenantId,
          roomTypeId: "rt-ocean-view",
          checkInDate: "2026-10-15",
          checkOutDate: "2026-10-20",
          status: "CONFIRMED",
        },
      ];

      // Walk-in booking arriving 2026-10-20
      const res = filterAvailableRooms({
        tenantId,
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-22",
        roomTypeId: "rt-ocean-view",
        requestedCount: 3,
        rooms: testRooms,
        reservations: unallocatedSlots,
      });

      assert.strictEqual(res.ok, true);
      if (res.ok) {
        // All 3 rooms are available because unallocated reservation concluded on 2026-10-20
        assert.strictEqual(res.value.availableCountByRoomType["rt-ocean-view"], 3);
        assert.strictEqual(res.value.isAvailable, true);
      }
    });
  });
});
