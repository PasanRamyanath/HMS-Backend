import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FrontDeskRoomRecord,
  type HousekeepingObservationRecord,
  authorizeDiscrepancyOperation,
  classifyRoomDiscrepancy,
  computeDiscrepancyAuditEntry,
  detectRoomDiscrepancies,
  resolveRoomDiscrepancy,
} from "../src/roomDiscrepancy.js";

describe("Step 314 & 315: Room Discrepancy Detector (roomDiscrepancy.ts)", () => {
  const tenantId = "cinnamon-wild-yala";
  const auditDateIso = "2026-10-20T10:00:00Z";

  describe("1. Validation & Input Sanitization", () => {
    it("fails when tenantId is empty or invalid format", () => {
      const resEmpty = detectRoomDiscrepancies({
        tenantId: "   ",
        auditDateIso,
        frontDeskRooms: [
          { roomId: "rm-1", roomNumber: "101", status: "OCCUPIED", registeredGuestsCount: 2 },
        ],
        housekeepingObservations: [
          {
            roomId: "rm-1",
            roomNumber: "101",
            observationStatus: "OBSERVED_OCCUPIED",
            observedGuestsCount: 2,
            hasLuggage: true,
            bedSleptIn: true,
            attendantId: "att-1",
            attendantName: "Kamal",
            inspectedAtIso: auditDateIso,
          },
        ],
      });
      assert.equal(resEmpty.ok, false);
      if (!resEmpty.ok) {
        assert.equal(resEmpty.error.code, "VALIDATION_FAILED");
      }
    });

    it("fails when frontDeskRooms array is empty", () => {
      const res = detectRoomDiscrepancies({
        tenantId,
        auditDateIso,
        frontDeskRooms: [],
        housekeepingObservations: [
          {
            roomId: "rm-1",
            roomNumber: "101",
            observationStatus: "OBSERVED_OCCUPIED",
            observedGuestsCount: 2,
            hasLuggage: true,
            bedSleptIn: true,
            attendantId: "att-1",
            attendantName: "Kamal",
            inspectedAtIso: auditDateIso,
          },
        ],
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "VALIDATION_FAILED");
        assert.match(res.error.message, /frontDeskRoom/);
      }
    });

    it("fails when housekeepingObservations array is empty", () => {
      const res = detectRoomDiscrepancies({
        tenantId,
        auditDateIso,
        frontDeskRooms: [
          { roomId: "rm-1", roomNumber: "101", status: "OCCUPIED", registeredGuestsCount: 2 },
        ],
        housekeepingObservations: [],
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "VALIDATION_FAILED");
        assert.match(res.error.message, /housekeepingObservation/);
      }
    });
  });

  describe("2. Discrepancy Classification Engine (SKIP, SLEEP, PERSONS_MISMATCH)", () => {
    it("flags SKIP when Front Desk is OCCUPIED but Housekeeping observes room VACANT", () => {
      const fd: FrontDeskRoomRecord = {
        roomId: "rm-101",
        roomNumber: "101",
        status: "OCCUPIED",
        registeredGuestsCount: 2,
        guestName: "John Skipper",
        reservationId: "res-101",
        currentFolioBalanceLkr: 45000,
        nightlyRateLkr: 25000,
      };

      const hk: HousekeepingObservationRecord = {
        roomId: "rm-101",
        roomNumber: "101",
        observationStatus: "OBSERVED_VACANT",
        observedGuestsCount: 0,
        hasLuggage: false,
        bedSleptIn: false,
        attendantId: "att-1",
        attendantName: "Sunil Silva",
        inspectedAtIso: auditDateIso,
        notes: "No luggage found in wardrobe, room is empty.",
      };

      const item = classifyRoomDiscrepancy(fd, hk);
      assert.equal(item.discrepancyType, "SKIP");
      assert.equal(item.isDiscrepancy, true);
      assert.equal(item.severity, "CRITICAL"); // Outstanding folio balance triggers critical
      assert.equal(item.recommendation, "CONTACT_GUEST_AND_LOCK_KEYCARD_CHECK_FOLIO");
      assert.ok(item.financialImpact);
      // Base: 25,000, SC: 2,500, TDL: 275, SSCL: 687.50, VAT: 5,123.25 -> Grand: 33,585.75
      // Total recovery = 45,000 folio + 33,585.75 = 78,585.75
      assert.equal(item.financialImpact.baseAmountLkr, 25000);
      assert.equal(item.financialImpact.taxes.scLkr, 2500);
      assert.equal(item.financialImpact.taxes.grandTotalLkr, 33585.75);
      assert.equal(item.financialImpact.totalRecoveryLkr, 78585.75);
    });

    it("flags SLEEP when Front Desk is VACANT but Housekeeping observes bed SLEPT IN or OCCUPIED", () => {
      const fd: FrontDeskRoomRecord = {
        roomId: "rm-102",
        roomNumber: "102",
        status: "VACANT",
        registeredGuestsCount: 0,
        nightlyRateLkr: 30000,
      };

      const hk: HousekeepingObservationRecord = {
        roomId: "rm-102",
        roomNumber: "102",
        observationStatus: "OBSERVED_SLEPT",
        observedGuestsCount: 0,
        hasLuggage: true,
        bedSleptIn: true,
        attendantId: "att-1",
        attendantName: "Sunil Silva",
        inspectedAtIso: auditDateIso,
        notes: "Bedsheet disheveled, suitcase on luggage rack.",
      };

      const item = classifyRoomDiscrepancy(fd, hk);
      assert.equal(item.discrepancyType, "SLEEP");
      assert.equal(item.isDiscrepancy, true);
      assert.equal(item.severity, "CRITICAL");
      assert.equal(item.recommendation, "INVESTIGATE_UNAUTHORIZED_OCCUPANT_ALERT_SECURITY");
      assert.ok(item.financialImpact);
      // Base: 30,000, SC 10%: 3,000, Subtotal: 33,000, TDL 1%: 330, SSCL 2.5%: 825, VAT 18%: 6,147.90
      // Grand Total: 40,302.90
      assert.equal(item.financialImpact.baseAmountLkr, 30000);
      assert.equal(item.financialImpact.taxes.scLkr, 3000);
      assert.equal(item.financialImpact.taxes.tdlLkr, 330);
      assert.equal(item.financialImpact.taxes.ssclLkr, 825);
      assert.equal(item.financialImpact.taxes.vatLkr, 6147.9);
      assert.equal(item.financialImpact.totalRecoveryLkr, 40302.9);
    });

    it("flags SLEEP when Front Desk is OUT_OF_ORDER but Housekeeping observes occupant", () => {
      const fd: FrontDeskRoomRecord = {
        roomId: "rm-103",
        roomNumber: "103",
        status: "OUT_OF_ORDER",
        registeredGuestsCount: 0,
      };

      const hk: HousekeepingObservationRecord = {
        roomId: "rm-103",
        roomNumber: "103",
        observationStatus: "OBSERVED_OCCUPIED",
        observedGuestsCount: 1,
        hasLuggage: true,
        bedSleptIn: true,
        attendantId: "att-2",
        attendantName: "Nimal",
        inspectedAtIso: auditDateIso,
      };

      const item = classifyRoomDiscrepancy(fd, hk);
      assert.equal(item.discrepancyType, "SLEEP");
      assert.equal(item.severity, "CRITICAL");
      assert.equal(item.recommendation, "INVESTIGATE_UNAUTHORIZED_OCCUPANT_ALERT_SECURITY");
    });

    it("flags PERSONS_MISMATCH when observed guests exceed front desk registration", () => {
      const fd: FrontDeskRoomRecord = {
        roomId: "rm-104",
        roomNumber: "104",
        status: "OCCUPIED",
        registeredGuestsCount: 1,
        guestName: "Mr. Fernando",
      };

      const hk: HousekeepingObservationRecord = {
        roomId: "rm-104",
        roomNumber: "104",
        observationStatus: "OBSERVED_OCCUPIED",
        observedGuestsCount: 3,
        hasLuggage: true,
        bedSleptIn: true,
        attendantId: "att-2",
        attendantName: "Nimal",
        inspectedAtIso: auditDateIso,
        notes: "3 adult guests observed inside room.",
      };

      const item = classifyRoomDiscrepancy(fd, hk);
      assert.equal(item.discrepancyType, "PERSONS_MISMATCH");
      assert.equal(item.isDiscrepancy, true);
      assert.equal(item.severity, "MEDIUM");
      assert.equal(item.recommendation, "VERIFY_GUEST_COUNT_AND_APPLY_SUPPLEMENT");
      assert.ok(item.financialImpact);
      // 2 extra guests * 3500 = 7000 LKR base supplement
      // Tax: SC: 700, Sub: 7700, TDL: 77, SSCL: 192.50, VAT: 1434.51 -> Grand: 9404.01
      assert.equal(item.financialImpact.baseAmountLkr, 7000);
      assert.equal(item.financialImpact.taxes.scLkr, 700);
      assert.equal(item.financialImpact.totalRecoveryLkr, 9404.01);
    });

    it("confirms MATCH when Front Desk and Housekeeping statuses align", () => {
      const fdOccupied: FrontDeskRoomRecord = {
        roomId: "rm-105",
        roomNumber: "105",
        status: "OCCUPIED",
        registeredGuestsCount: 2,
      };
      const hkOccupied: HousekeepingObservationRecord = {
        roomId: "rm-105",
        roomNumber: "105",
        observationStatus: "OBSERVED_OCCUPIED",
        observedGuestsCount: 2,
        hasLuggage: true,
        bedSleptIn: true,
        attendantId: "att-1",
        attendantName: "Kamal",
        inspectedAtIso: auditDateIso,
      };
      const matchOcc = classifyRoomDiscrepancy(fdOccupied, hkOccupied);
      assert.equal(matchOcc.discrepancyType, "MATCH_OCCUPIED");
      assert.equal(matchOcc.isDiscrepancy, false);
      assert.equal(matchOcc.severity, "NONE");

      const fdVacant: FrontDeskRoomRecord = {
        roomId: "rm-106",
        roomNumber: "106",
        status: "VACANT",
        registeredGuestsCount: 0,
      };
      const hkVacant: HousekeepingObservationRecord = {
        roomId: "rm-106",
        roomNumber: "106",
        observationStatus: "OBSERVED_VACANT",
        observedGuestsCount: 0,
        hasLuggage: false,
        bedSleptIn: false,
        attendantId: "att-1",
        attendantName: "Kamal",
        inspectedAtIso: auditDateIso,
      };
      const matchVac = classifyRoomDiscrepancy(fdVacant, hkVacant);
      assert.equal(matchVac.discrepancyType, "MATCH_VACANT");
      assert.equal(matchVac.isDiscrepancy, false);
      assert.equal(matchVac.severity, "NONE");
    });

    it("flags STATUS_UNKNOWN when room has DND sign hung on occupied room", () => {
      const fd: FrontDeskRoomRecord = {
        roomId: "rm-107",
        roomNumber: "107",
        status: "OCCUPIED",
        registeredGuestsCount: 2,
      };
      const hk: HousekeepingObservationRecord = {
        roomId: "rm-107",
        roomNumber: "107",
        observationStatus: "OBSERVED_DND",
        observedGuestsCount: 0,
        hasLuggage: false,
        bedSleptIn: false,
        attendantId: "att-1",
        attendantName: "Kamal",
        inspectedAtIso: auditDateIso,
      };

      const item = classifyRoomDiscrepancy(fd, hk);
      assert.equal(item.discrepancyType, "STATUS_UNKNOWN");
      assert.equal(item.isDiscrepancy, false);
      assert.equal(item.severity, "LOW");
      assert.equal(item.recommendation, "SCHEDULE_SUPERVISOR_REINSPECTION");
    });
  });

  describe("3. Batch Discrepancy Detection & Financial Risk Report", () => {
    it("processes multi-room inventory and aggregates metrics and revenue risk", () => {
      const frontDeskRooms: FrontDeskRoomRecord[] = [
        {
          roomId: "rm-1",
          roomNumber: "101",
          status: "OCCUPIED",
          registeredGuestsCount: 2,
          nightlyRateLkr: 20000,
        },
        {
          roomId: "rm-2",
          roomNumber: "102",
          status: "OCCUPIED",
          registeredGuestsCount: 2,
          nightlyRateLkr: 20000,
        }, // SKIP
        {
          roomId: "rm-3",
          roomNumber: "103",
          status: "VACANT",
          registeredGuestsCount: 0,
          nightlyRateLkr: 20000,
        },
        {
          roomId: "rm-4",
          roomNumber: "104",
          status: "VACANT",
          registeredGuestsCount: 0,
          nightlyRateLkr: 20000,
        }, // SLEEP
        {
          roomId: "rm-5",
          roomNumber: "105",
          status: "OCCUPIED",
          registeredGuestsCount: 1,
          nightlyRateLkr: 20000,
        }, // PERSONS_MISMATCH
      ];

      const housekeepingObservations: HousekeepingObservationRecord[] = [
        {
          roomId: "rm-1",
          roomNumber: "101",
          observationStatus: "OBSERVED_OCCUPIED",
          observedGuestsCount: 2,
          hasLuggage: true,
          bedSleptIn: true,
          attendantId: "att-1",
          attendantName: "Kamal",
          inspectedAtIso: auditDateIso,
        },
        {
          roomId: "rm-2",
          roomNumber: "102",
          observationStatus: "OBSERVED_VACANT",
          observedGuestsCount: 0,
          hasLuggage: false,
          bedSleptIn: false,
          attendantId: "att-1",
          attendantName: "Kamal",
          inspectedAtIso: auditDateIso,
        },
        {
          roomId: "rm-3",
          roomNumber: "103",
          observationStatus: "OBSERVED_VACANT",
          observedGuestsCount: 0,
          hasLuggage: false,
          bedSleptIn: false,
          attendantId: "att-1",
          attendantName: "Kamal",
          inspectedAtIso: auditDateIso,
        },
        {
          roomId: "rm-4",
          roomNumber: "104",
          observationStatus: "OBSERVED_SLEPT",
          observedGuestsCount: 1,
          hasLuggage: true,
          bedSleptIn: true,
          attendantId: "att-2",
          attendantName: "Sunil",
          inspectedAtIso: auditDateIso,
        },
        {
          roomId: "rm-5",
          roomNumber: "105",
          observationStatus: "OBSERVED_OCCUPIED",
          observedGuestsCount: 3,
          hasLuggage: true,
          bedSleptIn: true,
          attendantId: "att-2",
          attendantName: "Sunil",
          inspectedAtIso: auditDateIso,
        },
      ];

      const result = detectRoomDiscrepancies({
        tenantId,
        auditDateIso,
        frontDeskRooms,
        housekeepingObservations,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        const report = result.value;
        assert.equal(report.totalRoomsChecked, 5);
        assert.equal(report.matchingRoomsCount, 2); // rm-1 and rm-3
        assert.equal(report.totalDiscrepanciesCount, 3);
        assert.equal(report.skipCount, 1); // rm-2
        assert.equal(report.sleepCount, 1); // rm-4
        assert.equal(report.personsMismatchCount, 1); // rm-5
        assert.ok(report.totalPotentialRevenueRiskLkr > 0);

        // Audit log entry generation
        const auditEntry = computeDiscrepancyAuditEntry(report, "mgr-ruwan");
        assert.equal(auditEntry.tenantId, tenantId);
        assert.equal(auditEntry.action, "AUDIT_ROOM_DISCREPANCY_BATCH");
        assert.equal(auditEntry.entryHash.length, 64);
      }
    });
  });

  describe("4. RolePermissionMatrix RBAC Guard", () => {
    it("allows Housekeeping Supervisor and Front Desk Manager to resolve discrepancies", () => {
      const supRes = authorizeDiscrepancyOperation(
        tenantId,
        "HOUSEKEEPING_SUPERVISOR",
        tenantId,
        "RESOLVE_ROOM_DISCREPANCY",
      );
      assert.equal(supRes.ok, true);

      const fdmRes = authorizeDiscrepancyOperation(
        tenantId,
        "FRONT_DESK_MANAGER",
        tenantId,
        "RESOLVE_ROOM_DISCREPANCY",
      );
      assert.equal(fdmRes.ok, true);
    });

    it("rejects Front Desk Agent and Attendant from resolving discrepancies", () => {
      const fdaRes = authorizeDiscrepancyOperation(
        tenantId,
        "FRONT_DESK_AGENT",
        tenantId,
        "RESOLVE_ROOM_DISCREPANCY",
      );
      assert.equal(fdaRes.ok, false);
      if (!fdaRes.ok) {
        assert.equal(fdaRes.error.code, "PERMISSION_DENIED");
      }

      const attRes = authorizeDiscrepancyOperation(
        tenantId,
        "HOUSEKEEPING_ATTENDANT",
        tenantId,
        "RESOLVE_ROOM_DISCREPANCY",
      );
      assert.equal(attRes.ok, false);
      if (!attRes.ok) {
        assert.equal(attRes.error.code, "PERMISSION_DENIED");
      }
    });

    it("rejects cross-tenant operation attempts", () => {
      const res = authorizeDiscrepancyOperation(
        tenantId,
        "HOUSEKEEPING_SUPERVISOR",
        "other-hotel-galle",
        "RESOLVE_ROOM_DISCREPANCY",
      );
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "TENANT_MISMATCH");
      }
    });
  });

  describe("5. Discrepancy Resolution & Hash-Chained Audit Trail", () => {
    it("records supervisor discrepancy resolution with SHA-256 audit entry", () => {
      const resolution = resolveRoomDiscrepancy({
        tenantId,
        roomId: "rm-102",
        resolutionAction: "CONFIRMED_SKIPPER_FOLIO_POSTED",
        actorUserId: "user-hk-sup-01",
        actorRole: "HOUSEKEEPING_SUPERVISOR",
        resolutionNotes:
          "Guest departed without settling mini-bar. Folio locked and charged to pre-authorized card.",
        resolvedAtIso: "2026-10-20T11:00:00Z",
        adjustedFolioAmountLkr: 78585.75,
      });

      assert.equal(resolution.ok, true);
      if (resolution.ok) {
        assert.equal(resolution.value.resolved, true);
        assert.equal(resolution.value.resolutionAction, "CONFIRMED_SKIPPER_FOLIO_POSTED");
        assert.equal(resolution.value.auditEntry.entryHash.length, 64);
        assert.match(resolution.value.auditEntry.action, /RESOLVE_DISCREPANCY/);
      }
    });
  });
});
