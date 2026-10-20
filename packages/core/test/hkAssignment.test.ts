import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TURNAROUND_WEIGHTS,
  type HousekeepingAssignmentRoom,
  type OnDutyAttendant,
  assignHousekeepingRooms,
  resolvePriorityRank,
  resolveRoomTurnaroundWeight,
  sortRoomsForGreedyAssignment,
} from "../src/hkAssignment.js";

describe("Step 305 & 306: Daily Attendant Room Assignment Balancer (hkAssignment.ts)", () => {
  describe("1. Validation & Input Sanitization", () => {
    it("fails when tenantId is empty", () => {
      const result = assignHousekeepingRooms({
        tenantId: "   ",
        dateIso: "2026-10-20",
        rooms: [],
        attendants: [{ attendantId: "att-1", name: "Kamal" }],
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "VALIDATION_FAILED");
        assert.match(result.error.message, /tenantId must not be empty/);
      }
    });

    it("fails when attendants list is empty", () => {
      const result = assignHousekeepingRooms({
        tenantId: "cinnamon-wild-yala",
        dateIso: "2026-10-20",
        rooms: [
          {
            roomId: "rm-101",
            roomNumber: "101",
            floor: "1",
            turnaroundType: "CHECKOUT",
          },
        ],
        attendants: [],
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "VALIDATION_FAILED");
        assert.match(result.error.message, /At least one on-duty attendant is required/);
      }
    });

    it("fails when duplicate roomId exists in room batch", () => {
      const result = assignHousekeepingRooms({
        tenantId: "cinnamon-wild-yala",
        dateIso: "2026-10-20",
        rooms: [
          {
            roomId: "rm-101",
            roomNumber: "101",
            floor: "1",
            turnaroundType: "CHECKOUT",
          },
          {
            roomId: "rm-101",
            roomNumber: "101-Dup",
            floor: "1",
            turnaroundType: "STAYOVER",
          },
        ],
        attendants: [{ attendantId: "att-1", name: "Kamal" }],
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "VALIDATION_FAILED");
        assert.match(result.error.message, /Duplicate roomId/);
      }
    });
  });

  describe("2. Workload Weighting Credits & Priority Sorting", () => {
    it("resolves default standard hospitality weights (Checkout: 2.0, Stayover: 1.0, Touch-up: 0.5, Deep-clean: 3.0)", () => {
      assert.equal(DEFAULT_TURNAROUND_WEIGHTS.CHECKOUT, 2.0);
      assert.equal(DEFAULT_TURNAROUND_WEIGHTS.STAYOVER, 1.0);
      assert.equal(DEFAULT_TURNAROUND_WEIGHTS.TOUCH_UP, 0.5);
      assert.equal(DEFAULT_TURNAROUND_WEIGHTS.DEEP_CLEAN, 3.0);

      const checkoutRoom: HousekeepingAssignmentRoom = {
        roomId: "rm-1",
        roomNumber: "101",
        floor: "1",
        turnaroundType: "CHECKOUT",
      };
      assert.equal(resolveRoomTurnaroundWeight(checkoutRoom), 2.0);

      const stayoverRoom: HousekeepingAssignmentRoom = {
        roomId: "rm-2",
        roomNumber: "102",
        floor: "1",
        turnaroundType: "STAYOVER",
      };
      assert.equal(resolveRoomTurnaroundWeight(stayoverRoom), 1.0);
    });

    it("supports customWeights and room-level customWeight overrides", () => {
      const roomWithCustom: HousekeepingAssignmentRoom = {
        roomId: "rm-presidential",
        roomNumber: "PH-1",
        floor: "4",
        turnaroundType: "CHECKOUT",
        customWeight: 4.5,
      };
      assert.equal(resolveRoomTurnaroundWeight(roomWithCustom), 4.5);

      const regularRoom: HousekeepingAssignmentRoom = {
        roomId: "rm-103",
        roomNumber: "103",
        floor: "1",
        turnaroundType: "CHECKOUT",
      };
      assert.equal(resolveRoomTurnaroundWeight(regularRoom, { CHECKOUT: 2.5 }), 2.5);
    });

    it("ranks room priority: VIP -> ARRIVAL_TODAY -> STANDARD", () => {
      assert.equal(resolvePriorityRank("VIP"), 1);
      assert.equal(resolvePriorityRank("ARRIVAL_TODAY"), 2);
      assert.equal(resolvePriorityRank("STANDARD"), 3);
      assert.equal(resolvePriorityRank(undefined), 3);
    });

    it("sorts rooms for greedy assignment with heaviest workloads and VIPs first", () => {
      const rooms: HousekeepingAssignmentRoom[] = [
        {
          roomId: "r1",
          roomNumber: "101",
          floor: "1",
          turnaroundType: "STAYOVER",
          priority: "STANDARD",
        },
        {
          roomId: "r2",
          roomNumber: "102",
          floor: "1",
          turnaroundType: "CHECKOUT",
          priority: "STANDARD",
        },
        {
          roomId: "r3",
          roomNumber: "103",
          floor: "1",
          turnaroundType: "CHECKOUT",
          priority: "VIP",
        },
      ];

      const sorted = sortRoomsForGreedyAssignment(rooms);
      assert.equal(sorted[0]?.roomId, "r3"); // VIP Checkout (weight 2, prio 1)
      assert.equal(sorted[1]?.roomId, "r2"); // Standard Checkout (weight 2, prio 3)
      assert.equal(sorted[2]?.roomId, "r1"); // Stayover (weight 1)
    });
  });

  describe("3. Workload Balancing (Checkout vs Stayover Point Distribution)", () => {
    it("distributes dirty checkout rooms (2.0) and stayover rooms (1.0) evenly across attendants", () => {
      // 4 checkout rooms (4 * 2 = 8 pts) + 4 stayover rooms (4 * 1 = 4 pts) = 12 pts total
      // 2 attendants -> exactly 6 credits each!
      const rooms: HousekeepingAssignmentRoom[] = [
        { roomId: "r1", roomNumber: "101", floor: "1", turnaroundType: "CHECKOUT" },
        { roomId: "r2", roomNumber: "102", floor: "1", turnaroundType: "CHECKOUT" },
        { roomId: "r3", roomNumber: "103", floor: "1", turnaroundType: "CHECKOUT" },
        { roomId: "r4", roomNumber: "104", floor: "1", turnaroundType: "CHECKOUT" },
        { roomId: "r5", roomNumber: "105", floor: "1", turnaroundType: "STAYOVER" },
        { roomId: "r6", roomNumber: "106", floor: "1", turnaroundType: "STAYOVER" },
        { roomId: "r7", roomNumber: "107", floor: "1", turnaroundType: "STAYOVER" },
        { roomId: "r8", roomNumber: "108", floor: "1", turnaroundType: "STAYOVER" },
      ];

      const attendants: OnDutyAttendant[] = [
        { attendantId: "att-kamal", name: "Kamal Silva" },
        { attendantId: "att-nimal", name: "Nimal Perera" },
      ];

      const result = assignHousekeepingRooms({
        tenantId: "heritance-kandalama",
        dateIso: "2026-10-20",
        rooms,
        attendants,
        enforceFloorClustering: false,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.totalRooms, 8);
        assert.equal(result.value.totalCredits, 12);
        assert.equal(result.value.averageCreditsPerAttendant, 6);
        assert.equal(result.value.maxCreditDifference, 0);

        const sheet1 = result.value.taskSheets[0];
        const sheet2 = result.value.taskSheets[1];
        assert.ok(sheet1 && sheet2);
        assert.equal(sheet1.totalCredits, 6);
        assert.equal(sheet2.totalCredits, 6);
      }
    });

    it("minimizes credit difference when total credits are odd", () => {
      // 3 checkouts (6 pts) + 2 stayovers (2 pts) = 8 pts across 3 attendants -> ~2.67 pts each
      const rooms: HousekeepingAssignmentRoom[] = [
        { roomId: "r1", roomNumber: "101", floor: "1", turnaroundType: "CHECKOUT" },
        { roomId: "r2", roomNumber: "102", floor: "1", turnaroundType: "CHECKOUT" },
        { roomId: "r3", roomNumber: "103", floor: "1", turnaroundType: "CHECKOUT" },
        { roomId: "r4", roomNumber: "104", floor: "1", turnaroundType: "STAYOVER" },
        { roomId: "r5", roomNumber: "105", floor: "1", turnaroundType: "STAYOVER" },
      ];

      const attendants: OnDutyAttendant[] = [
        { attendantId: "att-1", name: "Attendant 1" },
        { attendantId: "att-2", name: "Attendant 2" },
        { attendantId: "att-3", name: "Attendant 3" },
      ];

      const result = assignHousekeepingRooms({
        tenantId: "cinnamon-bentota",
        dateIso: "2026-10-20",
        rooms,
        attendants,
        enforceFloorClustering: false,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.totalCredits, 8);
        assert.ok(result.value.maxCreditDifference <= 1.0);
      }
    });
  });

  describe("4. Floor Clustering & Priority Task Sequencing", () => {
    it("clusters attendants by floor when floor clustering is enabled", () => {
      // Floor 1 has 4 rooms, Floor 2 has 4 rooms
      const rooms: HousekeepingAssignmentRoom[] = [
        { roomId: "f1-1", roomNumber: "101", floor: "Floor 1", turnaroundType: "CHECKOUT" },
        { roomId: "f1-2", roomNumber: "102", floor: "Floor 1", turnaroundType: "CHECKOUT" },
        { roomId: "f1-3", roomNumber: "103", floor: "Floor 1", turnaroundType: "STAYOVER" },
        { roomId: "f1-4", roomNumber: "104", floor: "Floor 1", turnaroundType: "STAYOVER" },
        { roomId: "f2-1", roomNumber: "201", floor: "Floor 2", turnaroundType: "CHECKOUT" },
        { roomId: "f2-2", roomNumber: "202", floor: "Floor 2", turnaroundType: "CHECKOUT" },
        { roomId: "f2-3", roomNumber: "203", floor: "Floor 2", turnaroundType: "STAYOVER" },
        { roomId: "f2-4", roomNumber: "204", floor: "Floor 2", turnaroundType: "STAYOVER" },
      ];

      const attendants: OnDutyAttendant[] = [
        { attendantId: "att-f1", name: "Floor 1 Attendant", preferredFloors: ["Floor 1"] },
        { attendantId: "att-f2", name: "Floor 2 Attendant", preferredFloors: ["Floor 2"] },
      ];

      const result = assignHousekeepingRooms({
        tenantId: "shangrila-colombo",
        dateIso: "2026-10-20",
        rooms,
        attendants,
        enforceFloorClustering: true,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        const sheetF1 = result.value.taskSheets.find((s) => s.attendantId === "att-f1");
        const sheetF2 = result.value.taskSheets.find((s) => s.attendantId === "att-f2");
        assert.ok(sheetF1 && sheetF2);

        // Floor clustering ensured each attendant remained primarily on their assigned floor
        assert.equal(sheetF1.primaryFloor, "Floor 1");
        assert.equal(sheetF2.primaryFloor, "Floor 2");
      }
    });

    it("sequences VIP and Arrival Today rooms first within an attendant's task sheet", () => {
      const rooms: HousekeepingAssignmentRoom[] = [
        {
          roomId: "r-std",
          roomNumber: "101",
          floor: "1",
          turnaroundType: "CHECKOUT",
          priority: "STANDARD",
        },
        {
          roomId: "r-vip",
          roomNumber: "102",
          floor: "1",
          turnaroundType: "CHECKOUT",
          priority: "VIP",
        },
        {
          roomId: "r-arr",
          roomNumber: "103",
          floor: "1",
          turnaroundType: "CHECKOUT",
          priority: "ARRIVAL_TODAY",
        },
      ];

      const attendants: OnDutyAttendant[] = [{ attendantId: "att-1", name: "Kamal" }];

      const result = assignHousekeepingRooms({
        tenantId: "resort-tangalle",
        dateIso: "2026-10-20",
        rooms,
        attendants,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        const sheet = result.value.taskSheets[0];
        assert.ok(sheet);
        assert.equal(sheet.assignedRooms.length, 3);

        // Task sequence: #1 VIP, #2 Arrival Today, #3 Standard
        assert.equal(sheet.assignedRooms[0]?.roomId, "r-vip");
        assert.equal(sheet.assignedRooms[0]?.sequenceNumber, 1);

        assert.equal(sheet.assignedRooms[1]?.roomId, "r-arr");
        assert.equal(sheet.assignedRooms[1]?.sequenceNumber, 2);

        assert.equal(sheet.assignedRooms[2]?.roomId, "r-std");
        assert.equal(sheet.assignedRooms[2]?.sequenceNumber, 3);
      }
    });

    it("respects attendant maxCredits capacity limit and reports unassigned rooms", () => {
      const rooms: HousekeepingAssignmentRoom[] = [
        { roomId: "r1", roomNumber: "101", floor: "1", turnaroundType: "CHECKOUT" }, // 2.0
        { roomId: "r2", roomNumber: "102", floor: "1", turnaroundType: "CHECKOUT" }, // 2.0
        { roomId: "r3", roomNumber: "103", floor: "1", turnaroundType: "CHECKOUT" }, // 2.0
      ];

      // Max capacity 3.0 credits -> can only take 1 checkout room (2.0)
      const attendants: OnDutyAttendant[] = [
        { attendantId: "att-trainee", name: "Trainee Runner", maxCredits: 3.0 },
      ];

      const result = assignHousekeepingRooms({
        tenantId: "anantara-peace-haven",
        dateIso: "2026-10-20",
        rooms,
        attendants,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.totalRooms, 1);
        assert.equal(result.value.unassignedRooms.length, 2);
        assert.equal(result.value.auditPayload.unassignedCount, 2);
      }
    });

    it("generates structured audit payload with tenant and workload metrics", () => {
      const result = assignHousekeepingRooms({
        tenantId: "jetwing-lighthouse",
        dateIso: "2026-10-20",
        rooms: [{ roomId: "r1", roomNumber: "101", floor: "1", turnaroundType: "STAYOVER" }],
        attendants: [{ attendantId: "att-1", name: "Kamal" }],
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        const audit = result.value.auditPayload;
        assert.equal(audit.tenantId, "jetwing-lighthouse");
        assert.equal(audit.totalRoomsRequested, 1);
        assert.equal(audit.totalRoomsAssigned, 1);
        assert.equal(audit.attendantCount, 1);
        assert.ok(typeof audit.calculatedAtIso === "string");
      }
    });
  });
});
