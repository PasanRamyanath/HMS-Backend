import assert from "node:assert";
import { describe, it } from "node:test";
import {
  type CandidateSlotInput,
  type DualResourceSlotInput,
  type ResourceActor,
  type ResourceSlot,
  checkDualResourceConflict,
  checkResourceSlotConflict,
  scheduleDualResourceSlots,
  scheduleResourceSlot,
} from "../src/resourceScheduler.js";

describe("Step 351: resourceScheduler — Resource Slot Conflict Checker for Therapists, Rooms & Safari Vehicles", () => {
  const tenantId = "TENANT-BREEZE-001";

  const spaManager: ResourceActor = {
    userId: "STAFF-SPA-01",
    role: "SPA_MANAGER",
    tenantId,
  };

  const ayurvedaDoctor: ResourceActor = {
    userId: "STAFF-DOC-02",
    role: "AYURVEDA_DOCTOR",
    tenantId,
  };

  const concierge: ResourceActor = {
    userId: "STAFF-CONC-03",
    role: "CONCIERGE",
    tenantId,
  };

  describe("1. Pure Interval Conflict Math with Turnaround Buffer (Rung 6)", () => {
    // Existing Shirodhara booking: 09:00 to 10:00 with 15-minute turnaround buffer (effective end 10:15)
    const existingShirodharaSlot: ResourceSlot = {
      slotId: "SLOT-001",
      tenantId,
      resourceCategory: "TREATMENT_ROOM",
      resourceId: "ROOM-SHIRO-1",
      resourceName: "Ayurvedic Shirodhara Suite 1",
      bookingRef: "SPA-2026-001",
      guestName: "Lady Sarah Jenkins",
      serviceName: "Shirodhara Oil Treatment (60m)",
      startIso: "2026-10-25T09:00:00.000Z",
      endIso: "2026-10-25T10:00:00.000Z",
      turnaroundBufferMinutes: 15, // buffer holds room until 10:15:00.000Z
      status: "CONFIRMED",
    };

    it("detects conflict when candidate booking overlaps with the active session (09:30 - 10:30)", () => {
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "TREATMENT_ROOM",
        resourceId: "ROOM-SHIRO-1",
        bookingRef: "SPA-2026-002",
        guestName: "Mr. David Miller",
        serviceName: "Abhyanga Body Massage",
        startIso: "2026-10-25T09:30:00.000Z",
        endIso: "2026-10-25T10:30:00.000Z",
      };

      const result = checkResourceSlotConflict(candidate, [existingShirodharaSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, true);
      assert.strictEqual(result.value.conflicts.length, 1);
      const conflict = result.value.conflicts[0];
      assert.ok(conflict);
      assert.strictEqual(conflict.conflictingSlotId, "SLOT-001");
      assert.strictEqual(conflict.overlapMinutes, 45); // 09:30 to 10:15 (buffer end)
    });

    it("blocks overlapping booking that falls squarely into the 15-minute cleanup buffer (10:00 - 11:00)", () => {
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "TREATMENT_ROOM",
        resourceId: "ROOM-SHIRO-1",
        bookingRef: "SPA-2026-003",
        guestName: "Mrs. Elena Rostova",
        serviceName: "Herbal Compress Therapy",
        startIso: "2026-10-25T10:00:00.000Z",
        endIso: "2026-10-25T11:00:00.000Z",
      };

      const result = checkResourceSlotConflict(candidate, [existingShirodharaSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, true);
      assert.strictEqual(result.value.conflicts.length, 1);
      assert.strictEqual(result.value.conflicts[0]?.overlapMinutes, 15); // 10:00 to 10:15
    });

    it("allows booking starting exactly when cleanup buffer concludes (10:15 - 11:15)", () => {
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "TREATMENT_ROOM",
        resourceId: "ROOM-SHIRO-1",
        bookingRef: "SPA-2026-004",
        guestName: "Mrs. Elena Rostova",
        serviceName: "Herbal Compress Therapy",
        startIso: "2026-10-25T10:15:00.000Z",
        endIso: "2026-10-25T11:15:00.000Z",
      };

      const result = checkResourceSlotConflict(candidate, [existingShirodharaSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, false);
      assert.strictEqual(result.value.conflicts.length, 0);
    });

    it("detects backward buffer collision when candidate buffer spills into existing booking", () => {
      // Candidate ends at 08:55 but has a 15 min buffer (extends to 09:10, overlapping 09:00 start)
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "TREATMENT_ROOM",
        resourceId: "ROOM-SHIRO-1",
        bookingRef: "SPA-2026-005",
        guestName: "Early Bird Guest",
        serviceName: "Head Massage",
        startIso: "2026-10-25T08:00:00.000Z",
        endIso: "2026-10-25T08:55:00.000Z",
        turnaroundBufferMinutes: 15, // effective end 09:10:00.000Z
      };

      const result = checkResourceSlotConflict(candidate, [existingShirodharaSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, true);
      assert.strictEqual(result.value.conflicts[0]?.overlapMinutes, 10); // 09:00 to 09:10
    });

    it("ignores self when editing an existing slot with ignoreSlotId", () => {
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "TREATMENT_ROOM",
        resourceId: "ROOM-SHIRO-1",
        bookingRef: "SPA-2026-001",
        guestName: "Lady Sarah Jenkins",
        serviceName: "Shirodhara Oil Treatment (60m)",
        startIso: "2026-10-25T09:00:00.000Z",
        endIso: "2026-10-25T10:00:00.000Z",
        turnaroundBufferMinutes: 15,
        ignoreSlotId: "SLOT-001", // updating own slot
      };

      const result = checkResourceSlotConflict(candidate, [existingShirodharaSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, false);
    });

    it("ignores cancelled slots during collision evaluation", () => {
      const cancelledSlot: ResourceSlot = {
        ...existingShirodharaSlot,
        status: "CANCELLED",
      };

      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "TREATMENT_ROOM",
        resourceId: "ROOM-SHIRO-1",
        bookingRef: "SPA-2026-006",
        guestName: "New Guest",
        serviceName: "Foot Reflexology",
        startIso: "2026-10-25T09:30:00.000Z",
        endIso: "2026-10-25T10:30:00.000Z",
      };

      const result = checkResourceSlotConflict(candidate, [cancelledSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, false);
    });
  });

  describe("2. Safari Jeep & Excursion Fleet Coordination", () => {
    // Yala Safari 4x4 Jeep with 30-minute vehicle wash and refuel buffer
    const yalaJeepSlot: ResourceSlot = {
      slotId: "SLOT-VEH-01",
      tenantId,
      resourceCategory: "SAFARI_VEHICLE",
      resourceId: "JEEP-YALA-01",
      resourceName: "Yala Custom 4x4 Toyota Hilux (Open Roof)",
      bookingRef: "EXC-2026-010",
      guestName: "Sir Arthur Conan",
      serviceName: "Yala National Park Morning Game Drive",
      startIso: "2026-10-25T05:30:00.000Z",
      endIso: "2026-10-25T10:30:00.000Z",
      turnaroundBufferMinutes: 30, // holds vehicle until 11:00:00.000Z
      status: "CONFIRMED",
    };

    it("blocks afternoon excursion attempt starting before morning turnaround wash finishes (10:45)", () => {
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "SAFARI_VEHICLE",
        resourceId: "JEEP-YALA-01",
        bookingRef: "EXC-2026-011",
        guestName: "Schmidt Family",
        serviceName: "Bundala Bird Sanctuary Afternoon Excursion",
        startIso: "2026-10-25T10:45:00.000Z",
        endIso: "2026-10-25T14:45:00.000Z",
      };

      const result = checkResourceSlotConflict(candidate, [yalaJeepSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, true);
      assert.strictEqual(result.value.conflicts[0]?.overlapMinutes, 15); // 10:45 to 11:00
    });

    it("confirms afternoon excursion starting at 11:00 after wash completion", () => {
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "SAFARI_VEHICLE",
        resourceId: "JEEP-YALA-01",
        bookingRef: "EXC-2026-012",
        guestName: "Schmidt Family",
        serviceName: "Bundala Bird Sanctuary Afternoon Excursion",
        startIso: "2026-10-25T11:00:00.000Z",
        endIso: "2026-10-25T15:00:00.000Z",
      };

      const result = checkResourceSlotConflict(candidate, [yalaJeepSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, false);
    });
  });

  describe("3. Dual-Resource Conflict Detection (Therapist + Room)", () => {
    const existingTherapistSlot: ResourceSlot = {
      slotId: "SLOT-TH-01",
      tenantId,
      resourceCategory: "AYURVEDA_THERAPIST",
      resourceId: "TH-ANOMA-01",
      resourceName: "Therapist Anoma Senanayake",
      bookingRef: "SPA-2026-020",
      guestName: "Guest A",
      serviceName: "Panchakarma Consultation",
      startIso: "2026-10-25T14:00:00.000Z",
      endIso: "2026-10-25T15:00:00.000Z",
      turnaroundBufferMinutes: 10,
      status: "CONFIRMED",
    };

    const existingRoomSlot: ResourceSlot = {
      slotId: "SLOT-RM-02",
      tenantId,
      resourceCategory: "TREATMENT_ROOM",
      resourceId: "ROOM-AYUR-02",
      resourceName: "Ayurveda Herbal Bath Suite 2",
      bookingRef: "SPA-2026-021",
      guestName: "Guest B",
      serviceName: "Herbal Steam Bath",
      startIso: "2026-10-25T15:30:00.000Z",
      endIso: "2026-10-25T16:30:00.000Z",
      turnaroundBufferMinutes: 15,
      status: "CONFIRMED",
    };

    const slots = [existingTherapistSlot, existingRoomSlot];

    it("flags primary resource conflict when therapist is busy even if room is free", () => {
      const dualInput: DualResourceSlotInput = {
        tenantId,
        primaryCategory: "AYURVEDA_THERAPIST",
        primaryResourceId: "TH-ANOMA-01",
        secondaryCategory: "TREATMENT_ROOM",
        secondaryResourceId: "ROOM-AYUR-02", // room is free at 14:00
        bookingRef: "SPA-2026-030",
        guestName: "New Guest",
        serviceName: "Shirodhara & Head Therapy",
        startIso: "2026-10-25T14:30:00.000Z",
        endIso: "2026-10-25T15:30:00.000Z",
      };

      const result = checkDualResourceConflict(dualInput, slots);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, true);
      assert.strictEqual(result.value.primaryConflicts.length, 1);
      assert.strictEqual(result.value.secondaryConflicts.length, 0);
    });

    it("flags secondary resource conflict when room is busy even if therapist is free", () => {
      const dualInput: DualResourceSlotInput = {
        tenantId,
        primaryCategory: "AYURVEDA_THERAPIST",
        primaryResourceId: "TH-ANOMA-01", // therapist is free at 16:00
        secondaryCategory: "TREATMENT_ROOM",
        secondaryResourceId: "ROOM-AYUR-02", // room busy until 16:45 (16:30 + 15m buffer)
        bookingRef: "SPA-2026-031",
        guestName: "New Guest",
        serviceName: "Herbal Steam Therapy",
        startIso: "2026-10-25T16:00:00.000Z",
        endIso: "2026-10-25T17:00:00.000Z",
      };

      const result = checkDualResourceConflict(dualInput, slots);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, true);
      assert.strictEqual(result.value.primaryConflicts.length, 0);
      assert.strictEqual(result.value.secondaryConflicts.length, 1);
    });

    it("confirms dual booking when both therapist and treatment room are free", () => {
      const dualInput: DualResourceSlotInput = {
        tenantId,
        primaryCategory: "AYURVEDA_THERAPIST",
        primaryResourceId: "TH-ANOMA-01",
        secondaryCategory: "TREATMENT_ROOM",
        secondaryResourceId: "ROOM-AYUR-02",
        bookingRef: "SPA-2026-032",
        guestName: "New Guest",
        serviceName: "Combined Wellness Therapy",
        startIso: "2026-10-25T17:00:00.000Z",
        endIso: "2026-10-25T18:00:00.000Z",
      };

      const result = checkDualResourceConflict(dualInput, slots);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, false);
      assert.strictEqual(result.value.primaryConflicts.length, 0);
      assert.strictEqual(result.value.secondaryConflicts.length, 0);
    });
  });

  describe("4. Multi-Tenant SaaS Barrier & Role RBAC", () => {
    it("ensures slots belonging to another tenant never cause conflict", () => {
      const foreignSlot: ResourceSlot = {
        slotId: "FOREIGN-SLOT-01",
        tenantId: "TENANT-OTHER-HOTEL",
        resourceCategory: "AYURVEDA_THERAPIST",
        resourceId: "TH-001",
        resourceName: "Shared ID in different tenant",
        bookingRef: "FOREIGN-BOOKING",
        guestName: "Foreign Guest",
        serviceName: "Massage",
        startIso: "2026-10-25T09:00:00.000Z",
        endIso: "2026-10-25T10:00:00.000Z",
        turnaroundBufferMinutes: 15,
        status: "CONFIRMED",
      };

      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "AYURVEDA_THERAPIST",
        resourceId: "TH-001",
        bookingRef: "LOCAL-BOOKING",
        guestName: "Local Guest",
        serviceName: "Massage",
        startIso: "2026-10-25T09:00:00.000Z",
        endIso: "2026-10-25T10:00:00.000Z",
      };

      const result = checkResourceSlotConflict(candidate, [foreignSlot]);
      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      assert.strictEqual(result.value.hasConflict, false);
    });

    it("rejects unauthorized staff role with PERMISSION_DENIED", () => {
      const unauthorizedActor: ResourceActor = {
        userId: "STAFF-HK-01",
        role: "ROOM_ATTENDANT",
        tenantId,
      };

      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "AYURVEDA_THERAPIST",
        resourceId: "TH-001",
        bookingRef: "BK-001",
        guestName: "Guest",
        serviceName: "Spa",
        startIso: "2026-10-25T09:00:00.000Z",
        endIso: "2026-10-25T10:00:00.000Z",
      };

      const result = scheduleResourceSlot(
        unauthorizedActor,
        candidate,
        [],
        "NEW-SLOT-01",
        "2026-10-20T10:00:00.000Z",
      );
      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "PERMISSION_DENIED");
    });

    it("rejects cross-tenant booking attempt with TENANT_MISMATCH", () => {
      const candidate: CandidateSlotInput = {
        tenantId: "TENANT-DIFFERENT",
        resourceCategory: "AYURVEDA_THERAPIST",
        resourceId: "TH-001",
        bookingRef: "BK-001",
        guestName: "Guest",
        serviceName: "Spa",
        startIso: "2026-10-25T09:00:00.000Z",
        endIso: "2026-10-25T10:00:00.000Z",
      };

      const result = scheduleResourceSlot(
        spaManager,
        candidate,
        [],
        "NEW-SLOT-01",
        "2026-10-20T10:00:00.000Z",
      );
      assert.strictEqual(result.ok, false);
      if (result.ok) return;
      assert.strictEqual(result.error.code, "TENANT_MISMATCH");
    });
  });

  describe("5. Statutory Tax Compounding & Hash-Chained Audit Trail", () => {
    it("schedules slot and calculates 4-stage compounding taxes on 15,000 LKR base spa supply", () => {
      const candidate: CandidateSlotInput = {
        tenantId,
        resourceCategory: "AYURVEDA_THERAPIST",
        resourceId: "TH-PRIYA-01",
        resourceName: "Dr. Priyantha (Vaidya)",
        bookingRef: "SPA-2026-050",
        guestName: "Baroness Von Weber",
        guestRoomNumber: "SUITE-301",
        serviceName: "Royal Ayurvedic Shirodhara & Herbal Steam",
        startIso: "2026-10-25T11:00:00.000Z",
        endIso: "2026-10-25T12:00:00.000Z",
        turnaroundBufferMinutes: 15,
        priceLkr: 15000,
      };

      const result = scheduleResourceSlot(
        ayurvedaDoctor,
        candidate,
        [],
        "SLOT-AYUR-101",
        "2026-10-20T10:00:00.000Z",
      );

      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const { scheduledSlot, taxBreakdown, auditEntry } = result.value;
      assert.strictEqual(scheduledSlot.slotId, "SLOT-AYUR-101");
      assert.strictEqual(scheduledSlot.status, "CONFIRMED");

      // Verify 4-stage tax compounding
      assert.ok(taxBreakdown);
      assert.strictEqual(taxBreakdown.baseLkr, 15000);
      assert.strictEqual(taxBreakdown.scLkr, 1500); // 10%
      assert.strictEqual(taxBreakdown.subtotalAfterScLkr, 16500);
      assert.strictEqual(taxBreakdown.tdlLkr, 165); // 1%
      assert.strictEqual(taxBreakdown.ssclLkr, 412.5); // 2.5%
      assert.strictEqual(taxBreakdown.vatBaseLkr, 17077.5); // 16500 + 165 + 412.5
      assert.strictEqual(taxBreakdown.vatLkr, 3073.95); // 18% of 17077.5
      assert.strictEqual(taxBreakdown.grandTotalLkr, 20151.45);

      // Verify SHA-256 hash-chained ImmutableAuditLog
      assert.strictEqual(auditEntry.action, "SCHEDULE_RESOURCE_SLOT");
      assert.strictEqual(auditEntry.entityType, "ResourceSlot");
      assert.strictEqual(auditEntry.entityId, "SLOT-AYUR-101");
      assert.strictEqual(auditEntry.entryHash.length, 64);
    });

    it("schedules dual resource slots with single audit entry for linked primary and secondary resources", () => {
      const dualInput: DualResourceSlotInput = {
        tenantId,
        primaryCategory: "SAFARI_VEHICLE",
        primaryResourceId: "VEH-JEEP-02",
        primaryResourceName: "Udawalawe Safari 4x4 Jeep 2",
        primaryBufferMinutes: 30,

        secondaryCategory: "EXCURSION_GUIDE",
        secondaryResourceId: "GUIDE-SUNIL-01",
        secondaryResourceName: "Senior Naturalist Guide Sunil",
        secondaryBufferMinutes: 15,

        bookingRef: "SAF-2026-099",
        guestName: "Ambassador Tanaka",
        serviceName: "Udawalawe Elephant Transit Home & Park Safari",
        startIso: "2026-10-26T06:00:00.000Z",
        endIso: "2026-10-26T10:00:00.000Z",
        priceLkr: 32000,
      };

      const result = scheduleDualResourceSlots(
        concierge,
        dualInput,
        [],
        "SLOT-JEEP-02",
        "SLOT-GUIDE-01",
        "2026-10-20T10:00:00.000Z",
      );

      assert.strictEqual(result.ok, true);
      if (!result.ok) return;

      const { primarySlot, secondarySlot, taxBreakdown, auditEntry } = result.value;
      assert.strictEqual(primarySlot.slotId, "SLOT-JEEP-02");
      assert.strictEqual(primarySlot.priceLkr, 32000);
      assert.strictEqual(secondarySlot.slotId, "SLOT-GUIDE-01");
      assert.strictEqual(secondarySlot.priceLkr, undefined);

      assert.ok(taxBreakdown);
      assert.strictEqual(taxBreakdown.baseLkr, 32000);
      assert.strictEqual(auditEntry.action, "SCHEDULE_DUAL_RESOURCE_SLOTS");
      assert.strictEqual(auditEntry.entityType, "DualResourceBooking");
      assert.strictEqual(auditEntry.entityId, "SLOT-JEEP-02+SLOT-GUIDE-01");
      assert.strictEqual(auditEntry.entryHash.length, 64);
    });
  });
});
