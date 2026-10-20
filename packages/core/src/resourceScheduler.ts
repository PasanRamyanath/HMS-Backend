/**
 * @hms/core - Resource Slot Conflict Checker & Interval Scheduler (resourceScheduler.ts)
 *
 * Implements Step 351 (Phase 15.01) / Rung 6 of the Sri Lanka HMS Master Architecture Plan:
 * Pure deterministic interval scheduler ensuring neither Ayurveda Therapists,
 * Treatment Rooms, Safari Jeeps/Vans, nor Excursion Guides are double-booked.
 *
 * Capabilities:
 * 1. Single & Dual-Resource Interval Collision Checking (with turnaround buffer minutes)
 * 2. 60-minute Shirodhara + 15-minute cleanup buffer collision protection
 * 3. Multi-Tenant SaaS isolation & strict tenant boundary enforcement
 * 4. RBAC role guard across authorized wellness & excursion staff
 * 5. 4-Stage compounding Sri Lankan statutory hospitality taxes (SC -> TDL -> SSCL -> VAT)
 * 6. SHA-256 hash-chained ImmutableAuditLog generation
 * 7. Strictly zero console noise, cognitive complexity <= 12 per function
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type ResourceCategory =
  | "AYURVEDA_THERAPIST"
  | "TREATMENT_ROOM"
  | "SAFARI_VEHICLE"
  | "EXCURSION_GUIDE"
  | "AIRPORT_VEHICLE";

export type ResourceSlotStatus =
  | "CONFIRMED"
  | "TENTATIVE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export interface ResourceActor {
  readonly userId: string;
  readonly role: string;
  readonly tenantId: string;
}

export const RESOURCE_AUTHORIZED_ROLES: readonly string[] = [
  "ADMIN",
  "GENERAL_MANAGER",
  "DUTY_MANAGER",
  "FRONT_DESK",
  "SPA_MANAGER",
  "AYURVEDA_DOCTOR",
  "CONCIERGE",
  "EXCURSION_OFFICER",
  "RESERVATION_AGENT",
];

export interface ResourceSlot {
  readonly slotId: string;
  readonly tenantId: string;
  readonly resourceCategory: ResourceCategory;
  readonly resourceId: string;
  readonly resourceName: string;
  readonly bookingRef: string;
  readonly guestName: string;
  readonly guestRoomNumber?: string | undefined;
  readonly serviceName: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly turnaroundBufferMinutes: number;
  readonly status: ResourceSlotStatus;
  readonly priceLkr?: number | undefined;
}

export interface CandidateSlotInput {
  readonly tenantId: string;
  readonly resourceCategory: ResourceCategory;
  readonly resourceId: string;
  readonly resourceName?: string | undefined;
  readonly bookingRef: string;
  readonly guestName: string;
  readonly guestRoomNumber?: string | undefined;
  readonly serviceName: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly turnaroundBufferMinutes?: number | undefined;
  readonly ignoreSlotId?: string | undefined;
  readonly priceLkr?: number | undefined;
}

export interface SlotConflictDetail {
  readonly conflictingSlotId: string;
  readonly bookingRef: string;
  readonly resourceId: string;
  readonly resourceCategory: ResourceCategory;
  readonly existingStartIso: string;
  readonly existingEndIso: string;
  readonly effectiveExistingEndIso: string;
  readonly candidateStartIso: string;
  readonly candidateEndIso: string;
  readonly effectiveCandidateEndIso: string;
  readonly overlapMinutes: number;
  readonly message: string;
}

export interface DualResourceSlotInput {
  readonly tenantId: string;
  readonly primaryCategory: ResourceCategory;
  readonly primaryResourceId: string;
  readonly primaryResourceName?: string | undefined;
  readonly primaryBufferMinutes?: number | undefined;

  readonly secondaryCategory: ResourceCategory;
  readonly secondaryResourceId: string;
  readonly secondaryResourceName?: string | undefined;
  readonly secondaryBufferMinutes?: number | undefined;

  readonly bookingRef: string;
  readonly guestName: string;
  readonly guestRoomNumber?: string | undefined;
  readonly serviceName: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly ignoreSlotId?: string | undefined;
  readonly priceLkr?: number | undefined;
}

export interface DualResourceCheckResult {
  readonly hasConflict: boolean;
  readonly primaryConflicts: readonly SlotConflictDetail[];
  readonly secondaryConflicts: readonly SlotConflictDetail[];
}

export interface ScheduledResourceResult {
  readonly scheduledSlot: ResourceSlot;
  readonly taxBreakdown?: TaxBreakdownResult | undefined;
  readonly auditEntry: AuditLogEntry;
}

export interface ScheduledDualResourceResult {
  readonly primarySlot: ResourceSlot;
  readonly secondarySlot: ResourceSlot;
  readonly taxBreakdown?: TaxBreakdownResult | undefined;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Internal Interval & Time Math Helpers (Cognitive Complexity <= 12)
// ============================================================================

const MILLIS_PER_MINUTE = 60 * 1000;

function parseTimestamp(iso: string, label: string): Result<number, DomainError> {
  if (!iso || typeof iso !== "string" || iso.trim() === "") {
    return domainErr("INVALID_DATE_FORMAT", `${label} must be a non-empty ISO 8601 string`);
  }
  const timeMs = Date.parse(iso);
  if (Number.isNaN(timeMs)) {
    return domainErr(
      "INVALID_DATE_FORMAT",
      `${label} contains an unparseable ISO 8601 timestamp: "${iso}"`,
    );
  }
  return ok(timeMs);
}

function calculateIntervalOverlap(
  startA: number,
  endWithBufferA: number,
  startB: number,
  endWithBufferB: number,
): number {
  if (startA >= endWithBufferB || startB >= endWithBufferA) {
    return 0;
  }
  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endWithBufferA, endWithBufferB);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  return Math.round(overlapMs / MILLIS_PER_MINUTE);
}

function validateActor(actor: ResourceActor): Result<void, DomainError> {
  if (!actor || !actor.userId || !actor.tenantId) {
    return domainErr("UNAUTHORIZED", "Valid resource actor with userId and tenantId is required");
  }
  if (!RESOURCE_AUTHORIZED_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role "${actor.role}" is not authorized for resource scheduling. Allowed: ${RESOURCE_AUTHORIZED_ROLES.join(", ")}`,
    );
  }
  return ok(undefined);
}

function validateTenant(tenantId: string, actorTenantId?: string): Result<void, DomainError> {
  if (!tenantId || tenantId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "Resource tenantId must not be empty");
  }
  if (actorTenantId && tenantId !== actorTenantId) {
    return domainErr("TENANT_MISMATCH", "Cross-tenant resource access is strictly prohibited");
  }
  return ok(undefined);
}

function shouldInspectSlot(input: CandidateSlotInput, slot: ResourceSlot): boolean {
  if (slot.tenantId !== input.tenantId) return false;
  if (input.ignoreSlotId && slot.slotId === input.ignoreSlotId) return false;
  if (slot.status === "CANCELLED") return false;
  return slot.resourceCategory === input.resourceCategory && slot.resourceId === input.resourceId;
}

function evaluateSlotConflict(
  input: CandidateSlotInput,
  candStart: number,
  candEffectiveEnd: number,
  slot: ResourceSlot,
): SlotConflictDetail | undefined {
  if (!shouldInspectSlot(input, slot)) return undefined;

  const existStart = Date.parse(slot.startIso);
  const existEnd = Date.parse(slot.endIso);
  if (Number.isNaN(existStart) || Number.isNaN(existEnd)) return undefined;

  const existBufferMs = Math.max(0, slot.turnaroundBufferMinutes) * MILLIS_PER_MINUTE;
  const existEffectiveEnd = existEnd + existBufferMs;

  const overlapMins = calculateIntervalOverlap(
    candStart,
    candEffectiveEnd,
    existStart,
    existEffectiveEnd,
  );
  if (overlapMins <= 0) return undefined;

  return {
    conflictingSlotId: slot.slotId,
    bookingRef: slot.bookingRef,
    resourceId: slot.resourceId,
    resourceCategory: slot.resourceCategory,
    existingStartIso: slot.startIso,
    existingEndIso: slot.endIso,
    effectiveExistingEndIso: new Date(existEffectiveEnd).toISOString(),
    candidateStartIso: input.startIso,
    candidateEndIso: input.endIso,
    effectiveCandidateEndIso: new Date(candEffectiveEnd).toISOString(),
    overlapMinutes: overlapMins,
    message: `Resource ${slot.resourceId} (${slot.resourceName}) is occupied by ${slot.bookingRef} until ${new Date(existEffectiveEnd).toISOString()} (overlap: ${overlapMins} mins)`,
  };
}

// ============================================================================
// Single Resource Interval Conflict Checker
// ============================================================================

export function checkResourceSlotConflict(
  input: CandidateSlotInput,
  existingSlots: readonly ResourceSlot[],
): Result<{ hasConflict: boolean; conflicts: readonly SlotConflictDetail[] }, DomainError> {
  const tenantCheck = validateTenant(input.tenantId);
  if (!tenantCheck.ok) return tenantCheck;

  const startRes = parseTimestamp(input.startIso, "Candidate startIso");
  if (!startRes.ok) return startRes;
  const candStart = startRes.value;

  const endRes = parseTimestamp(input.endIso, "Candidate endIso");
  if (!endRes.ok) return endRes;
  const candEnd = endRes.value;

  if (candEnd <= candStart) {
    return domainErr(
      "VALIDATION_FAILED",
      `Candidate endIso (${input.endIso}) must be strictly after startIso (${input.startIso})`,
    );
  }

  const candBufferMs = Math.max(0, input.turnaroundBufferMinutes ?? 0) * MILLIS_PER_MINUTE;
  const candEffectiveEnd = candEnd + candBufferMs;

  const conflicts: SlotConflictDetail[] = [];
  for (let i = 0; i < existingSlots.length; i++) {
    const slot = existingSlots[i];
    if (!slot) continue;
    const conflict = evaluateSlotConflict(input, candStart, candEffectiveEnd, slot);
    if (conflict) {
      conflicts.push(conflict);
    }
  }

  return ok({
    hasConflict: conflicts.length > 0,
    conflicts,
  });
}

// ============================================================================
// Dual-Resource (Therapist + Room or Vehicle + Guide) Conflict Checker
// ============================================================================

export function checkDualResourceConflict(
  input: DualResourceSlotInput,
  existingSlots: readonly ResourceSlot[],
): Result<DualResourceCheckResult, DomainError> {
  const primaryCheck = checkResourceSlotConflict(
    {
      tenantId: input.tenantId,
      resourceCategory: input.primaryCategory,
      resourceId: input.primaryResourceId,
      resourceName: input.primaryResourceName,
      bookingRef: input.bookingRef,
      guestName: input.guestName,
      guestRoomNumber: input.guestRoomNumber,
      serviceName: input.serviceName,
      startIso: input.startIso,
      endIso: input.endIso,
      turnaroundBufferMinutes: input.primaryBufferMinutes,
      ignoreSlotId: input.ignoreSlotId,
    },
    existingSlots,
  );
  if (!primaryCheck.ok) return primaryCheck;

  const secondaryCheck = checkResourceSlotConflict(
    {
      tenantId: input.tenantId,
      resourceCategory: input.secondaryCategory,
      resourceId: input.secondaryResourceId,
      resourceName: input.secondaryResourceName,
      bookingRef: input.bookingRef,
      guestName: input.guestName,
      guestRoomNumber: input.guestRoomNumber,
      serviceName: input.serviceName,
      startIso: input.startIso,
      endIso: input.endIso,
      turnaroundBufferMinutes: input.secondaryBufferMinutes,
      ignoreSlotId: input.ignoreSlotId,
    },
    existingSlots,
  );
  if (!secondaryCheck.ok) return secondaryCheck;

  const hasConflict = primaryCheck.value.hasConflict || secondaryCheck.value.hasConflict;

  return ok({
    hasConflict,
    primaryConflicts: primaryCheck.value.conflicts,
    secondaryConflicts: secondaryCheck.value.conflicts,
  });
}

// ============================================================================
// Resource Slot Scheduler with Tax & Audit Trail
// ============================================================================

export function scheduleResourceSlot(
  actor: ResourceActor,
  input: CandidateSlotInput,
  existingSlots: readonly ResourceSlot[],
  slotId: string,
  isoTs: string,
  taxConfig: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
  prevHash?: string,
): Result<ScheduledResourceResult, DomainError> {
  const actorCheck = validateActor(actor);
  if (!actorCheck.ok) return actorCheck;

  const tenantCheck = validateTenant(input.tenantId, actor.tenantId);
  if (!tenantCheck.ok) return tenantCheck;

  const conflictCheck = checkResourceSlotConflict(input, existingSlots);
  if (!conflictCheck.ok) return conflictCheck;

  if (conflictCheck.value.hasConflict) {
    const first = conflictCheck.value.conflicts[0];
    return domainErr(
      "RESOURCE_CONFLICT",
      first?.message ?? `Resource ${input.resourceId} is already booked during this time interval`,
    );
  }

  let taxBreakdown: TaxBreakdownResult | undefined;
  if (typeof input.priceLkr === "number" && input.priceLkr > 0) {
    const taxRes = calculateForwardTax(input.priceLkr, taxConfig);
    if (!taxRes.ok) return taxRes;
    taxBreakdown = taxRes.value;
  }

  const scheduledSlot: ResourceSlot = {
    slotId,
    tenantId: input.tenantId,
    resourceCategory: input.resourceCategory,
    resourceId: input.resourceId,
    resourceName: input.resourceName ?? input.resourceId,
    bookingRef: input.bookingRef,
    guestName: input.guestName,
    guestRoomNumber: input.guestRoomNumber,
    serviceName: input.serviceName,
    startIso: input.startIso,
    endIso: input.endIso,
    turnaroundBufferMinutes: input.turnaroundBufferMinutes ?? 0,
    status: "CONFIRMED",
    priceLkr: input.priceLkr,
  };

  const auditRes = createAuditEntry({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "SCHEDULE_RESOURCE_SLOT",
    entityType: "ResourceSlot",
    entityId: slotId,
    isoTs,
    afterJson: JSON.stringify(scheduledSlot),
    prevHash,
  });
  if (!auditRes.ok) return auditRes;

  return ok({
    scheduledSlot,
    taxBreakdown,
    auditEntry: auditRes.value,
  });
}

function buildDualSlotPair(
  input: DualResourceSlotInput,
  primarySlotId: string,
  secondarySlotId: string,
): { primarySlot: ResourceSlot; secondarySlot: ResourceSlot } {
  const primarySlot: ResourceSlot = {
    slotId: primarySlotId,
    tenantId: input.tenantId,
    resourceCategory: input.primaryCategory,
    resourceId: input.primaryResourceId,
    resourceName: input.primaryResourceName ?? input.primaryResourceId,
    bookingRef: input.bookingRef,
    guestName: input.guestName,
    guestRoomNumber: input.guestRoomNumber,
    serviceName: input.serviceName,
    startIso: input.startIso,
    endIso: input.endIso,
    turnaroundBufferMinutes: input.primaryBufferMinutes ?? 0,
    status: "CONFIRMED",
    priceLkr: input.priceLkr,
  };

  const secondarySlot: ResourceSlot = {
    slotId: secondarySlotId,
    tenantId: input.tenantId,
    resourceCategory: input.secondaryCategory,
    resourceId: input.secondaryResourceId,
    resourceName: input.secondaryResourceName ?? input.secondaryResourceId,
    bookingRef: input.bookingRef,
    guestName: input.guestName,
    guestRoomNumber: input.guestRoomNumber,
    serviceName: input.serviceName,
    startIso: input.startIso,
    endIso: input.endIso,
    turnaroundBufferMinutes: input.secondaryBufferMinutes ?? 0,
    status: "CONFIRMED",
    priceLkr: undefined,
  };

  return { primarySlot, secondarySlot };
}

export function scheduleDualResourceSlots(
  actor: ResourceActor,
  input: DualResourceSlotInput,
  existingSlots: readonly ResourceSlot[],
  primarySlotId: string,
  secondarySlotId: string,
  isoTs: string,
  taxConfig: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
  prevHash?: string,
): Result<ScheduledDualResourceResult, DomainError> {
  const actorCheck = validateActor(actor);
  if (!actorCheck.ok) return actorCheck;

  const tenantCheck = validateTenant(input.tenantId, actor.tenantId);
  if (!tenantCheck.ok) return tenantCheck;

  const dualCheck = checkDualResourceConflict(input, existingSlots);
  if (!dualCheck.ok) return dualCheck;

  if (dualCheck.value.hasConflict) {
    const errDesc = [
      dualCheck.value.primaryConflicts[0]?.message,
      dualCheck.value.secondaryConflicts[0]?.message,
    ]
      .filter(Boolean)
      .join(" | ");
    return domainErr("RESOURCE_CONFLICT", errDesc || "Dual resource allocation conflict detected");
  }

  let taxBreakdown: TaxBreakdownResult | undefined;
  if (typeof input.priceLkr === "number" && input.priceLkr > 0) {
    const taxRes = calculateForwardTax(input.priceLkr, taxConfig);
    if (!taxRes.ok) return taxRes;
    taxBreakdown = taxRes.value;
  }

  const { primarySlot, secondarySlot } = buildDualSlotPair(input, primarySlotId, secondarySlotId);

  const auditRes = createAuditEntry({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "SCHEDULE_DUAL_RESOURCE_SLOTS",
    entityType: "DualResourceBooking",
    entityId: `${primarySlotId}+${secondarySlotId}`,
    isoTs,
    afterJson: JSON.stringify({ primarySlot, secondarySlot }),
    prevHash,
  });
  if (!auditRes.ok) return auditRes;

  return ok({
    primarySlot,
    secondarySlot,
    taxBreakdown,
    auditEntry: auditRes.value,
  });
}
