/**
 * @hms/core - End-to-End Room Turnaround & Minibar Folio Lifecycle Test (hkTurnaround.test.ts)
 *
 * Implements Step 324 (Phase 13.24) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive integration test of the complete room turnover, minibar auto-posting,
 * and check-in gatekeeper lifecycle:
 *
 * 1. Multi-Tenant SaaS Isolation & RBAC Role Boundaries
 * 2. Complete State Flow: OCCUPIED -> CHECKED_OUT (DIRTY) -> MINIBAR_POST -> CLEANING -> INSPECTED -> CHECK_IN
 * 3. 4-Stage Compounding Sri Lankan Statutory Tax Computation for In-Room Minibar (SC -> TDL -> SSCL -> VAT)
 * 4. Supervisor Inspection Loop (Fail -> Re-clean -> Pass)
 * 5. Rung 5 Gatekeeper: Block Check-In on DIRTY or OUT_OF_ORDER rooms unless authorized Duty Manager override
 * 6. Cryptographically Hash-Chained SHA-256 Immutable Audit Log Verification & Anti-Tamper Detection
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  type MinibarConsumptionItem,
  type TurnaroundActor,
  type TurnaroundRoomRecord,
  checkOutRoomGuest,
  completeRoomCleaning,
  executeGuestCheckIn,
  inspectRoomTurnaround,
  postMinibarConsumption,
  setRoomOutOfOrder,
  startRoomCleaning,
  validateCheckInEligibility,
  validateTenantId,
  verifyAuditChain,
} from "../src/index.js";

function unwrapOk<T>(res: { ok: boolean; value?: T; error?: unknown }): T {
  assert.strictEqual(res.ok, true);
  return res.value as T;
}

// ============================================================================
// Fixtures
// ============================================================================

const TENANT_A = "galle-face-heritage";
const TENANT_B = "mirissa-bay-villas";

const ACTOR_FRONT_DESK: TurnaroundActor = {
  userId: "usr-fd-01",
  role: "FRONT_DESK",
  tenantId: TENANT_A,
};

const ACTOR_ATTENDANT: TurnaroundActor = {
  userId: "usr-hk-01",
  role: "HOUSEKEEPING_ATTENDANT",
  tenantId: TENANT_A,
};

const ACTOR_SUPERVISOR: TurnaroundActor = {
  userId: "usr-sup-01",
  role: "HOUSEKEEPING_SUPERVISOR",
  tenantId: TENANT_A,
};

const ACTOR_DUTY_MANAGER: TurnaroundActor = {
  userId: "usr-dm-01",
  role: "DUTY_MANAGER",
  tenantId: TENANT_A,
};

const INITIAL_ROOM_201: TurnaroundRoomRecord = {
  tenantId: TENANT_A,
  roomId: "rm-201",
  roomNumber: "201",
  state: "OCCUPIED",
  currentReservationId: "res-aug-8821",
  currentGuestName: "Alexander Wright",
};

describe("Step 324: End-to-End Room Turnaround, Minibar Posting & Check-In Gatekeeper (hkTurnaround.test.ts)", () => {
  // --------------------------------------------------------------------------
  // 1. Multi-Tenant SaaS Isolation & RBAC Boundaries
  // --------------------------------------------------------------------------
  describe("1. Multi-Tenant SaaS Isolation & Role Boundaries", () => {
    it("validates compliant Sri Lankan multi-tenant identifiers", () => {
      assert.strictEqual(validateTenantId(TENANT_A).ok, true);
      assert.strictEqual(validateTenantId(TENANT_B).ok, true);
      assert.strictEqual(validateTenantId("INVALID SLUG!").ok, false);
      assert.strictEqual(validateTenantId("").ok, false);
    });

    it("rejects turnaround operations across mismatched tenant boundaries", () => {
      const crossTenantActor: TurnaroundActor = {
        userId: "usr-intruder",
        role: "DUTY_MANAGER",
        tenantId: TENANT_B,
      };

      const result = checkOutRoomGuest(
        INITIAL_ROOM_201,
        crossTenantActor,
        "2026-10-20T10:00:00.000Z",
        GENESIS_HASH,
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error.code, "TENANT_MISMATCH");
        assert.ok(result.error.message.includes("does not match"));
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Full Turnaround Lifecycle with Cryptographic Audit Chain
  // --------------------------------------------------------------------------
  describe("2. Full E2E Lifecycle Flow (Check-Out -> Minibar -> Clean -> Inspect -> Check-In)", () => {
    it("executes complete turnaround lifecycle with immutable SHA-256 audit chaining", () => {
      const auditChain: AuditLogEntry[] = [];
      let currentPrevHash = GENESIS_HASH;

      // STEP A: Guest Check-Out -> Room becomes DIRTY
      const checkOut = unwrapOk(
        checkOutRoomGuest(
          INITIAL_ROOM_201,
          ACTOR_FRONT_DESK,
          "2026-10-20T10:00:00.000Z",
          currentPrevHash,
        ),
      );
      const dirtyRoom = checkOut.room;
      assert.strictEqual(dirtyRoom.state, "DIRTY");
      assert.strictEqual(dirtyRoom.currentGuestName, undefined);
      assert.strictEqual(dirtyRoom.lastDepartureAtIso, "2026-10-20T10:00:00.000Z");

      auditChain.push(checkOut.auditEntry);
      currentPrevHash = checkOut.auditEntry.entryHash;

      // STEP B: Minibar Consumption Logging with 4-Stage Sri Lankan Compounding Taxes
      const minibarItems: MinibarConsumptionItem[] = [
        {
          itemId: "mb-01",
          description: "Ceylon Elephant House Ginger Beer (EGB)",
          quantity: 2,
          unitPriceLkr: 650, // 1,300
        },
        {
          itemId: "mb-02",
          description: "Lion Lager Beer Can 330ml",
          quantity: 2,
          unitPriceLkr: 950, // 1,900
        },
        {
          itemId: "mb-03",
          description: "Artisan Roasted Ceylon Cashew Nuts 100g",
          quantity: 1,
          unitPriceLkr: 1800, // 1,800
        },
      ];
      // Total Base Supply = 1,300 + 1,900 + 1,800 = 5,000 LKR

      const minibar = unwrapOk(
        postMinibarConsumption(
          dirtyRoom,
          "fol-aug-8821",
          minibarItems,
          ACTOR_ATTENDANT,
          "2026-10-20T10:15:00.000Z",
          currentPrevHash,
          DEFAULT_SRI_LANKA_TAX_CONFIG,
        ),
      );
      const posting = minibar.posting;
      assert.strictEqual(posting.baseSupplyLkr, 5000);
      // Service Charge (10%): 5,000 * 0.10 = 500
      assert.strictEqual(posting.scLkr, 500);
      // Subtotal A: 5,500
      // TDL (1%): 5,500 * 0.01 = 55
      assert.strictEqual(posting.tdlLkr, 55);
      // SSCL (2.5%): 5,500 * 0.025 = 137.50
      assert.strictEqual(posting.ssclLkr, 137.5);
      // VAT Base: 5,500 + 55 + 137.50 = 5,692.50
      // VAT (18%): 5,692.50 * 0.18 = 1,024.65
      assert.strictEqual(posting.vatLkr, 1024.65);
      // Grand Total: 5,500 + 55 + 137.50 + 1,024.65 = 6,717.15 LKR
      assert.strictEqual(posting.grandTotalLkr, 6717.15);

      auditChain.push(minibar.auditEntry);
      currentPrevHash = minibar.auditEntry.entryHash;

      // STEP C: Start Room Cleaning -> CLEANING_IN_PROGRESS
      const startCleaning = unwrapOk(
        startRoomCleaning(
          dirtyRoom,
          "usr-att-sunil",
          ACTOR_ATTENDANT,
          "2026-10-20T10:20:00.000Z",
          currentPrevHash,
        ),
      );
      const cleaningRoom = startCleaning.room;
      assert.strictEqual(cleaningRoom.state, "CLEANING_IN_PROGRESS");
      assert.strictEqual(cleaningRoom.assignedAttendantId, "usr-att-sunil");

      auditChain.push(startCleaning.auditEntry);
      currentPrevHash = startCleaning.auditEntry.entryHash;

      // STEP D: Complete Cleaning -> CLEAN_UNINSPECTED
      const completeCleaning = unwrapOk(
        completeRoomCleaning(
          cleaningRoom,
          ACTOR_ATTENDANT,
          "2026-10-20T11:05:00.000Z",
          currentPrevHash,
        ),
      );
      const uninspectedRoom = completeCleaning.room;
      assert.strictEqual(uninspectedRoom.state, "CLEAN_UNINSPECTED");
      assert.strictEqual(uninspectedRoom.cleaningCompletedAtIso, "2026-10-20T11:05:00.000Z");

      auditChain.push(completeCleaning.auditEntry);
      currentPrevHash = completeCleaning.auditEntry.entryHash;

      // STEP E: Supervisor Inspection Fails (Touch-up required) -> Reverts to DIRTY
      const failedInspection = unwrapOk(
        inspectRoomTurnaround(
          uninspectedRoom,
          "FAIL",
          "Teak balcony table not wiped; extra beach towel missing",
          ACTOR_SUPERVISOR,
          "2026-10-20T11:20:00.000Z",
          currentPrevHash,
        ),
      );
      const touchUpRoom = failedInspection.room;
      assert.strictEqual(touchUpRoom.state, "DIRTY");
      assert.strictEqual(
        touchUpRoom.touchUpNotes,
        "Teak balcony table not wiped; extra beach towel missing",
      );

      auditChain.push(failedInspection.auditEntry);
      currentPrevHash = failedInspection.auditEntry.entryHash;

      // STEP F: Re-clean and Re-inspect (PASS) -> INSPECTED_CLEAN
      const restartCleaning = unwrapOk(
        startRoomCleaning(
          touchUpRoom,
          "usr-att-sunil",
          ACTOR_ATTENDANT,
          "2026-10-20T11:25:00.000Z",
          currentPrevHash,
        ),
      );
      auditChain.push(restartCleaning.auditEntry);
      currentPrevHash = restartCleaning.auditEntry.entryHash;

      const recompleteCleaning = unwrapOk(
        completeRoomCleaning(
          restartCleaning.room,
          ACTOR_ATTENDANT,
          "2026-10-20T11:40:00.000Z",
          currentPrevHash,
        ),
      );
      auditChain.push(recompleteCleaning.auditEntry);
      currentPrevHash = recompleteCleaning.auditEntry.entryHash;

      const passInspection = unwrapOk(
        inspectRoomTurnaround(
          recompleteCleaning.room,
          "PASS",
          "All SLTDA standards verified. Balcony pristine and king coconuts replenished.",
          ACTOR_SUPERVISOR,
          "2026-10-20T11:50:00.000Z",
          currentPrevHash,
        ),
      );
      const readyRoom = passInspection.room;
      assert.strictEqual(readyRoom.state, "INSPECTED_CLEAN");
      assert.strictEqual(readyRoom.touchUpNotes, undefined);
      assert.strictEqual(readyRoom.lastInspectedByUserId, "usr-sup-01");

      auditChain.push(passInspection.auditEntry);
      currentPrevHash = passInspection.auditEntry.entryHash;

      // STEP G: Incoming Guest Check-In (Standard happy path)
      const checkIn = unwrapOk(
        executeGuestCheckIn(
          readyRoom,
          "res-oct-9942",
          "Dr. Rohitha Perera",
          ACTOR_FRONT_DESK,
          "2026-10-20T13:00:00.000Z",
          currentPrevHash,
        ),
      );
      const occupiedRoom = checkIn.room;
      assert.strictEqual(occupiedRoom.state, "OCCUPIED");
      assert.strictEqual(occupiedRoom.currentReservationId, "res-oct-9942");
      assert.strictEqual(occupiedRoom.currentGuestName, "Dr. Rohitha Perera");

      auditChain.push(checkIn.auditEntry);

      // STEP H: Cryptographic Audit Chain Verification
      assert.strictEqual(auditChain.length, 9);
      const chainVerify = unwrapOk(verifyAuditChain(auditChain));
      assert.strictEqual(chainVerify.verifiedCount, 9);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Rung 5: Check-In Gatekeeper Invariants & Manager Overrides
  // --------------------------------------------------------------------------
  describe("3. Rung 5 Check-In Gatekeeper Verification", () => {
    it("strictly BLOCKS check-in on a DIRTY room without manager override", () => {
      const dirtyRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-201",
        roomNumber: "201",
        state: "DIRTY",
      };

      const eligibility = validateCheckInEligibility(dirtyRoom, ACTOR_FRONT_DESK);
      assert.strictEqual(eligibility.ok, false);
      if (!eligibility.ok) {
        assert.strictEqual(eligibility.error.code, "ROOM_CONFLICT");
        assert.ok(eligibility.error.message.includes("DIRTY"));
      }

      // Check-in execution attempt fails
      const checkInAttempt = executeGuestCheckIn(
        dirtyRoom,
        "res-test-01",
        "Unlucky Guest",
        ACTOR_FRONT_DESK,
        "2026-10-20T12:00:00.000Z",
        GENESIS_HASH,
      );
      assert.strictEqual(checkInAttempt.ok, false);
      if (!checkInAttempt.ok) {
        assert.strictEqual(checkInAttempt.error.code, "ROOM_CONFLICT");
      }
    });

    it("strictly BLOCKS check-in on a room currently in CLEANING_IN_PROGRESS", () => {
      const inProgressRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-202",
        roomNumber: "202",
        state: "CLEANING_IN_PROGRESS",
      };

      const eligibility = validateCheckInEligibility(inProgressRoom, ACTOR_FRONT_DESK);
      assert.strictEqual(eligibility.ok, false);
      if (!eligibility.ok) {
        assert.strictEqual(eligibility.error.code, "ROOM_CONFLICT");
        assert.ok(eligibility.error.message.includes("CLEANING_IN_PROGRESS"));
      }
    });

    it("strictly BLOCKS check-in on a CLEAN_UNINSPECTED room without supervisor sign-off", () => {
      const uninspectedRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-203",
        roomNumber: "203",
        state: "CLEAN_UNINSPECTED",
      };

      const eligibility = validateCheckInEligibility(uninspectedRoom, ACTOR_FRONT_DESK);
      assert.strictEqual(eligibility.ok, false);
      if (!eligibility.ok) {
        assert.strictEqual(eligibility.error.code, "ROOM_CONFLICT");
        assert.ok(eligibility.error.message.includes("CLEAN_UNINSPECTED"));
      }
    });

    it("strictly BLOCKS check-in on an OUT_OF_ORDER room without override", () => {
      const oooRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-204",
        roomNumber: "204",
        state: "OUT_OF_ORDER",
        outOfOrderReason: "A/C Compressor Replacement",
      };

      const eligibility = validateCheckInEligibility(oooRoom, ACTOR_FRONT_DESK);
      assert.strictEqual(eligibility.ok, false);
      if (!eligibility.ok) {
        assert.strictEqual(eligibility.error.code, "ROOM_CONFLICT");
        assert.ok(eligibility.error.message.includes("OUT_OF_ORDER"));
      }
    });

    it("CANNOT check into an already OCCUPIED room even if manager override is requested", () => {
      const occupiedRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-205",
        roomNumber: "205",
        state: "OCCUPIED",
        currentReservationId: "res-in-house",
        currentGuestName: "Elena Rostova",
      };

      const eligibility = validateCheckInEligibility(occupiedRoom, ACTOR_DUTY_MANAGER, {
        managerOverride: true,
        managerUserId: ACTOR_DUTY_MANAGER.userId,
        overrideReason: "Double book attempt",
      });

      assert.strictEqual(eligibility.ok, false);
      if (!eligibility.ok) {
        assert.strictEqual(eligibility.error.code, "ROOM_CONFLICT");
        assert.ok(eligibility.error.message.includes("already OCCUPIED"));
      }
    });

    it("permits check-in on DIRTY room when authorized DUTY_MANAGER provides valid override reason", () => {
      const dirtyRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-206",
        roomNumber: "206",
        state: "DIRTY",
      };

      const overrideOptions = {
        managerOverride: true,
        managerUserId: ACTOR_DUTY_MANAGER.userId,
        overrideReason:
          "Guest arrived on London red-eye flight exhausted. Room verbally certified clean by attendant.",
      };

      const eligibility = validateCheckInEligibility(
        dirtyRoom,
        ACTOR_DUTY_MANAGER,
        overrideOptions,
      );
      assert.strictEqual(eligibility.ok, true);
      if (eligibility.ok) {
        assert.strictEqual(eligibility.value.eligible, true);
        assert.strictEqual(eligibility.value.managerOverrideApplied, true);
        assert.strictEqual(eligibility.value.managerUserId, ACTOR_DUTY_MANAGER.userId);
      }

      // Executes check-in with manager override
      const checkInRes = executeGuestCheckIn(
        dirtyRoom,
        "res-vip-early",
        "Lord Sebastian Howard",
        ACTOR_DUTY_MANAGER,
        "2026-10-20T08:00:00.000Z",
        GENESIS_HASH,
        overrideOptions,
      );

      assert.strictEqual(checkInRes.ok, true);
      if (checkInRes.ok) {
        assert.strictEqual(checkInRes.value.room.state, "OCCUPIED");
        assert.strictEqual(checkInRes.value.room.currentGuestName, "Lord Sebastian Howard");
        assert.strictEqual(
          checkInRes.value.auditEntry.action,
          "ROOM_CHECK_IN_WITH_MANAGER_OVERRIDE",
        );
      }
    });

    it("rejects manager override attempt by an unauthorized role (e.g. HOUSEKEEPING_ATTENDANT)", () => {
      const dirtyRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-207",
        roomNumber: "207",
        state: "DIRTY",
      };

      const eligibility = validateCheckInEligibility(dirtyRoom, ACTOR_ATTENDANT, {
        managerOverride: true,
        managerUserId: ACTOR_ATTENDANT.userId,
        overrideReason: "Unauthorized override attempt by attendant",
      });

      assert.strictEqual(eligibility.ok, false);
      if (!eligibility.ok) {
        assert.strictEqual(eligibility.error.code, "PERMISSION_DENIED");
      }
    });

    it("rejects manager override if justification reason is too brief (<10 chars)", () => {
      const dirtyRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-208",
        roomNumber: "208",
        state: "DIRTY",
      };

      const eligibility = validateCheckInEligibility(dirtyRoom, ACTOR_DUTY_MANAGER, {
        managerOverride: true,
        managerUserId: ACTOR_DUTY_MANAGER.userId,
        overrideReason: "Too short", // 9 chars
      });

      assert.strictEqual(eligibility.ok, false);
      if (!eligibility.ok) {
        assert.strictEqual(eligibility.error.code, "VALIDATION_FAILED");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. Out-of-Order Lifecycle & Anti-Tamper Audit Verification
  // --------------------------------------------------------------------------
  describe("4. Out-of-Order Transitions & Audit Anti-Tamper Guard", () => {
    it("places vacant room out-of-order and prohibits placing occupied room out-of-order", () => {
      const vacantRoom: TurnaroundRoomRecord = {
        tenantId: TENANT_A,
        roomId: "rm-209",
        roomNumber: "209",
        state: "DIRTY",
      };

      const oooRes = setRoomOutOfOrder(
        vacantRoom,
        "Monsoon moisture remediation and wall repainting",
        ACTOR_DUTY_MANAGER,
        "2026-10-20T14:00:00.000Z",
        GENESIS_HASH,
      );

      assert.strictEqual(oooRes.ok, true);
      if (oooRes.ok) {
        assert.strictEqual(oooRes.value.room.state, "OUT_OF_ORDER");
        assert.strictEqual(
          oooRes.value.room.outOfOrderReason,
          "Monsoon moisture remediation and wall repainting",
        );
      }

      // Prohibits placing occupied room out-of-order
      const occupiedAttempt = setRoomOutOfOrder(
        INITIAL_ROOM_201,
        "Repairs",
        ACTOR_DUTY_MANAGER,
        "2026-10-20T14:00:00.000Z",
        GENESIS_HASH,
      );
      assert.strictEqual(occupiedAttempt.ok, false);
      if (!occupiedAttempt.ok) {
        assert.strictEqual(occupiedAttempt.error.code, "ROOM_CONFLICT");
      }
    });

    it("detects cryptographic tampering in the audit chain if any entry is modified", () => {
      const entry1Res = checkOutRoomGuest(
        INITIAL_ROOM_201,
        ACTOR_FRONT_DESK,
        "2026-10-20T10:00:00.000Z",
        GENESIS_HASH,
      );
      assert.strictEqual(entry1Res.ok, true);
      if (!entry1Res.ok) return;

      const entry2Res = startRoomCleaning(
        entry1Res.value.room,
        "usr-att-sunil",
        ACTOR_ATTENDANT,
        "2026-10-20T10:15:00.000Z",
        entry1Res.value.auditEntry.entryHash,
      );
      assert.strictEqual(entry2Res.ok, true);
      if (!entry2Res.ok) return;

      const auditChain = [entry1Res.value.auditEntry, entry2Res.value.auditEntry];
      assert.strictEqual(verifyAuditChain(auditChain).ok, true);

      // Tamper with entry 1 action
      const tamperedChain: AuditLogEntry[] = [
        {
          ...entry1Res.value.auditEntry,
          action: "ROOM_CHECKED_OUT_TAMPERED",
        },
        entry2Res.value.auditEntry,
      ];

      const verifyTampered = verifyAuditChain(tamperedChain);
      assert.strictEqual(verifyTampered.ok, false);
      if (!verifyTampered.ok) {
        assert.strictEqual(verifyTampered.error.code, "AUDIT_CHAIN_CORRUPTED");
      }
    });
  });
});
