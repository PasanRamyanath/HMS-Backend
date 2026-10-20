/**
 * Housekeeping Room Turnaround & Minibar Folio Lifecycle Engine (hkTurnaround.ts)
 *
 * Hospitality Domain Engine for Sri Lankan Hotels, Resorts, and Luxury Villas:
 * - Implements the full lifecycle:
 *   OCCUPIED -> CHECKED_OUT -> DIRTY -> MINIBAR_POST -> CLEANING_IN_PROGRESS -> CLEAN_UNINSPECTED -> INSPECTED_CLEAN -> CHECK_IN
 * - Enforces Rung 5 Check-In Gatekeeper:
 *   A room CANNOT be checked into while OUT_OF_ORDER or DIRTY unless an authorized Duty Manager override is supplied.
 * - Auto-posts in-room minibar consumption with 4-stage compounding Sri Lankan statutory taxes (SC -> TDL -> SSCL -> VAT).
 * - Generates cryptographically hash-chained SHA-256 Immutable Audit Log records on every status mutation.
 * - Multi-tenant SaaS isolation (tenantId validation) and RolePermissionMatrix RBAC.
 * - Strict zero external runtime npm dependencies & cognitive complexity <= 12 per function.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type RoomTurnaroundState =
  | "OCCUPIED"
  | "CHECKED_OUT"
  | "DIRTY"
  | "CLEANING_IN_PROGRESS"
  | "CLEAN_UNINSPECTED"
  | "INSPECTED_CLEAN"
  | "OUT_OF_ORDER";

export type TurnaroundStaffRole =
  | "HOUSEKEEPING_ATTENDANT"
  | "HOUSEKEEPING_SUPERVISOR"
  | "EXECUTIVE_HOUSEKEEPER"
  | "FRONT_DESK"
  | "DUTY_MANAGER"
  | "GENERAL_MANAGER"
  | "ADMIN";

export interface TurnaroundActor {
  readonly userId: string;
  readonly role: TurnaroundStaffRole;
  readonly tenantId: string;
}

export interface MinibarConsumptionItem {
  readonly itemId: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceLkr: number;
}

export interface MinibarFolioPosting {
  readonly postingId: string;
  readonly folioId: string;
  readonly roomId: string;
  readonly roomNumber: string;
  readonly items: readonly MinibarConsumptionItem[];
  readonly baseSupplyLkr: number;
  readonly scLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatLkr: number;
  readonly grandTotalLkr: number;
  readonly postedAtIso: string;
  readonly postedByUserId: string;
}

export interface TurnaroundRoomRecord {
  readonly tenantId: string;
  readonly roomId: string;
  readonly roomNumber: string;
  readonly state: RoomTurnaroundState;
  readonly currentReservationId?: string | undefined;
  readonly currentGuestName?: string | undefined;
  readonly assignedAttendantId?: string | undefined;
  readonly lastDepartureAtIso?: string | undefined;
  readonly cleaningStartedAtIso?: string | undefined;
  readonly cleaningCompletedAtIso?: string | undefined;
  readonly lastInspectedAtIso?: string | undefined;
  readonly lastInspectedByUserId?: string | undefined;
  readonly outOfOrderReason?: string | undefined;
  readonly touchUpNotes?: string | undefined;
}

export interface CheckInOverrideOptions {
  readonly managerOverride?: boolean | undefined;
  readonly managerUserId?: string | undefined;
  readonly overrideReason?: string | undefined;
}

export interface CheckInEligibilityResult {
  readonly eligible: boolean;
  readonly roomId: string;
  readonly roomNumber: string;
  readonly roomState: RoomTurnaroundState;
  readonly managerOverrideApplied: boolean;
  readonly managerUserId?: string | undefined;
  readonly overrideReason?: string | undefined;
}

// ============================================================================
// Tenant & Role RBAC Validation
// ============================================================================

export function assertTurnaroundActorTenant(
  roomTenantId: string,
  actor: TurnaroundActor,
): Result<true, DomainError> {
  const tenantRes = validateTenantId(roomTenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  if (actor.tenantId !== roomTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match room tenant '${roomTenantId}'.`,
    );
  }
  return ok(true);
}

export function isManagerRole(role: TurnaroundStaffRole): boolean {
  return role === "DUTY_MANAGER" || role === "GENERAL_MANAGER" || role === "ADMIN";
}

// ============================================================================
// State Machine Transitions
// ============================================================================

/**
 * 1. Check-Out Guest -> Room transitions to DIRTY
 */
export function checkOutRoomGuest(
  room: TurnaroundRoomRecord,
  actor: TurnaroundActor,
  isoTs: string,
  prevHash: string,
): Result<{ room: TurnaroundRoomRecord; auditEntry: AuditLogEntry }, DomainError> {
  const tenantCheck = assertTurnaroundActorTenant(room.tenantId, actor);
  if (!tenantCheck.ok) return tenantCheck;

  if (room.state !== "OCCUPIED") {
    return domainErr(
      "INVALID_STATE",
      `Cannot check out room ${room.roomNumber} in state '${room.state}'. Room must be OCCUPIED.`,
    );
  }

  const updatedRoom: TurnaroundRoomRecord = {
    ...room,
    state: "DIRTY",
    currentReservationId: undefined,
    currentGuestName: undefined,
    lastDepartureAtIso: isoTs,
    cleaningStartedAtIso: undefined,
    cleaningCompletedAtIso: undefined,
    touchUpNotes: undefined,
  };

  const auditRes = createAuditEntry({
    tenantId: room.tenantId,
    actorUserId: actor.userId,
    action: "ROOM_CHECKED_OUT_DIRTY",
    entityType: "ROOM_TURNAROUND",
    entityId: room.roomId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify({
      previousState: room.state,
      newState: updatedRoom.state,
      lastDepartureAtIso: isoTs,
    }),
  });

  if (!auditRes.ok) return auditRes;

  return ok({ room: updatedRoom, auditEntry: auditRes.value });
}

/**
 * 2. Record & Auto-Post Minibar Consumption with 4-stage compounding Sri Lankan tax
 */
export function postMinibarConsumption(
  room: TurnaroundRoomRecord,
  folioId: string,
  items: readonly MinibarConsumptionItem[],
  actor: TurnaroundActor,
  isoTs: string,
  prevHash: string,
  taxConfig: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
): Result<{ posting: MinibarFolioPosting; auditEntry: AuditLogEntry }, DomainError> {
  const tenantCheck = assertTurnaroundActorTenant(room.tenantId, actor);
  if (!tenantCheck.ok) return tenantCheck;

  if (items.length === 0) {
    return domainErr("VALIDATION_FAILED", "Minibar consumption item list cannot be empty.");
  }

  let baseSupplyLkr = 0;
  for (const item of items) {
    if (item.quantity <= 0 || item.unitPriceLkr < 0) {
      return domainErr(
        "VALIDATION_FAILED",
        `Invalid minibar item quantity (${item.quantity}) or unit price (${item.unitPriceLkr}).`,
      );
    }
    baseSupplyLkr = roundLkr(baseSupplyLkr + item.quantity * item.unitPriceLkr);
  }

  const taxRes = calculateForwardTax(baseSupplyLkr, taxConfig);
  if (!taxRes.ok) return taxRes;
  const tax = taxRes.value;

  const posting: MinibarFolioPosting = {
    postingId: `mb-post-${room.roomId}-${Date.parse(isoTs)}`,
    folioId,
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    items,
    baseSupplyLkr: tax.baseLkr,
    scLkr: tax.scLkr,
    tdlLkr: tax.tdlLkr,
    ssclLkr: tax.ssclLkr,
    vatLkr: tax.vatLkr,
    grandTotalLkr: tax.grandTotalLkr,
    postedAtIso: isoTs,
    postedByUserId: actor.userId,
  };

  const auditRes = createAuditEntry({
    tenantId: room.tenantId,
    actorUserId: actor.userId,
    action: "MINIBAR_CONSUMPTION_POSTED",
    entityType: "FOLIO_CHARGE",
    entityId: posting.postingId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify(posting),
  });

  if (!auditRes.ok) return auditRes;

  return ok({ posting, auditEntry: auditRes.value });
}

/**
 * 3. Start Cleaning -> Room transitions to CLEANING_IN_PROGRESS
 */
export function startRoomCleaning(
  room: TurnaroundRoomRecord,
  attendantId: string,
  actor: TurnaroundActor,
  isoTs: string,
  prevHash: string,
): Result<{ room: TurnaroundRoomRecord; auditEntry: AuditLogEntry }, DomainError> {
  const tenantCheck = assertTurnaroundActorTenant(room.tenantId, actor);
  if (!tenantCheck.ok) return tenantCheck;

  if (room.state !== "DIRTY" && room.state !== "CHECKED_OUT") {
    return domainErr(
      "INVALID_STATE",
      `Room ${room.roomNumber} must be DIRTY to start cleaning. Current state: '${room.state}'.`,
    );
  }

  const updatedRoom: TurnaroundRoomRecord = {
    ...room,
    state: "CLEANING_IN_PROGRESS",
    assignedAttendantId: attendantId,
    cleaningStartedAtIso: isoTs,
  };

  const auditRes = createAuditEntry({
    tenantId: room.tenantId,
    actorUserId: actor.userId,
    action: "ROOM_CLEANING_STARTED",
    entityType: "ROOM_TURNAROUND",
    entityId: room.roomId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify({
      previousState: room.state,
      newState: updatedRoom.state,
      attendantId,
      cleaningStartedAtIso: isoTs,
    }),
  });

  if (!auditRes.ok) return auditRes;

  return ok({ room: updatedRoom, auditEntry: auditRes.value });
}

/**
 * 4. Complete Cleaning -> Room transitions to CLEAN_UNINSPECTED
 */
export function completeRoomCleaning(
  room: TurnaroundRoomRecord,
  actor: TurnaroundActor,
  isoTs: string,
  prevHash: string,
): Result<{ room: TurnaroundRoomRecord; auditEntry: AuditLogEntry }, DomainError> {
  const tenantCheck = assertTurnaroundActorTenant(room.tenantId, actor);
  if (!tenantCheck.ok) return tenantCheck;

  if (room.state !== "CLEANING_IN_PROGRESS") {
    return domainErr(
      "INVALID_STATE",
      `Room ${room.roomNumber} must be in CLEANING_IN_PROGRESS state to complete cleaning. Current: '${room.state}'.`,
    );
  }

  const updatedRoom: TurnaroundRoomRecord = {
    ...room,
    state: "CLEAN_UNINSPECTED",
    cleaningCompletedAtIso: isoTs,
  };

  const auditRes = createAuditEntry({
    tenantId: room.tenantId,
    actorUserId: actor.userId,
    action: "ROOM_CLEANING_COMPLETED",
    entityType: "ROOM_TURNAROUND",
    entityId: room.roomId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify({
      previousState: room.state,
      newState: updatedRoom.state,
      cleaningCompletedAtIso: isoTs,
    }),
  });

  if (!auditRes.ok) return auditRes;

  return ok({ room: updatedRoom, auditEntry: auditRes.value });
}

/**
 * 5. Supervisor Inspection -> PASS (INSPECTED_CLEAN) or FAIL (reverts to DIRTY with touch-up notes)
 */
export function inspectRoomTurnaround(
  room: TurnaroundRoomRecord,
  result: "PASS" | "FAIL",
  notes: string,
  actor: TurnaroundActor,
  isoTs: string,
  prevHash: string,
): Result<{ room: TurnaroundRoomRecord; auditEntry: AuditLogEntry }, DomainError> {
  const tenantCheck = assertTurnaroundActorTenant(room.tenantId, actor);
  if (!tenantCheck.ok) return tenantCheck;

  if (room.state !== "CLEAN_UNINSPECTED") {
    return domainErr(
      "INVALID_STATE",
      `Room ${room.roomNumber} must be CLEAN_UNINSPECTED before inspection. Current state: '${room.state}'.`,
    );
  }

  const newState: RoomTurnaroundState = result === "PASS" ? "INSPECTED_CLEAN" : "DIRTY";

  const updatedRoom: TurnaroundRoomRecord = {
    ...room,
    state: newState,
    lastInspectedAtIso: isoTs,
    lastInspectedByUserId: actor.userId,
    touchUpNotes: result === "FAIL" ? notes : undefined,
  };

  const auditRes = createAuditEntry({
    tenantId: room.tenantId,
    actorUserId: actor.userId,
    action: result === "PASS" ? "ROOM_INSPECTION_PASSED" : "ROOM_INSPECTION_FAILED",
    entityType: "ROOM_TURNAROUND",
    entityId: room.roomId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify({
      previousState: room.state,
      newState,
      inspectionResult: result,
      inspectorUserId: actor.userId,
      notes,
    }),
  });

  if (!auditRes.ok) return auditRes;

  return ok({ room: updatedRoom, auditEntry: auditRes.value });
}

/**
 * 6. Place Room Out of Order
 */
export function setRoomOutOfOrder(
  room: TurnaroundRoomRecord,
  reason: string,
  actor: TurnaroundActor,
  isoTs: string,
  prevHash: string,
): Result<{ room: TurnaroundRoomRecord; auditEntry: AuditLogEntry }, DomainError> {
  const tenantCheck = assertTurnaroundActorTenant(room.tenantId, actor);
  if (!tenantCheck.ok) return tenantCheck;

  if (room.state === "OCCUPIED") {
    return domainErr(
      "ROOM_CONFLICT",
      `Cannot place room ${room.roomNumber} OUT_OF_ORDER while occupied by guest. Relocate guest first.`,
    );
  }

  const updatedRoom: TurnaroundRoomRecord = {
    ...room,
    state: "OUT_OF_ORDER",
    outOfOrderReason: reason,
  };

  const auditRes = createAuditEntry({
    tenantId: room.tenantId,
    actorUserId: actor.userId,
    action: "ROOM_SET_OUT_OF_ORDER",
    entityType: "ROOM_TURNAROUND",
    entityId: room.roomId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify({
      previousState: room.state,
      newState: "OUT_OF_ORDER",
      reason,
    }),
  });

  if (!auditRes.ok) return auditRes;

  return ok({ room: updatedRoom, auditEntry: auditRes.value });
}

// ============================================================================
// Rung 5: Check-In Gatekeeper
// ============================================================================

/**
 * Evaluates whether a room is eligible for guest check-in.
 * Rung 5 Rule:
 * - Room MUST be INSPECTED_CLEAN.
 * - If DIRTY, CLEANING_IN_PROGRESS, CLEAN_UNINSPECTED, or OUT_OF_ORDER:
 *   Check-in is BLOCKED unless a valid manager override is provided.
 * - OCCUPIED rooms can NEVER be checked into.
 */
export function validateCheckInEligibility(
  room: TurnaroundRoomRecord,
  actor: TurnaroundActor,
  options?: CheckInOverrideOptions,
): Result<CheckInEligibilityResult, DomainError> {
  const tenantCheck = assertTurnaroundActorTenant(room.tenantId, actor);
  if (!tenantCheck.ok) return tenantCheck;

  if (room.state === "OCCUPIED") {
    return domainErr(
      "ROOM_CONFLICT",
      `Room ${room.roomNumber} is already OCCUPIED by an in-house guest.`,
    );
  }

  // 1. Happy path: room is verified INSPECTED_CLEAN
  if (room.state === "INSPECTED_CLEAN") {
    return ok({
      eligible: true,
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      roomState: room.state,
      managerOverrideApplied: false,
    });
  }

  // 2. Room is not inspected clean (DIRTY, CLEAN_UNINSPECTED, CLEANING_IN_PROGRESS, or OUT_OF_ORDER)
  const isOverrideRequested = Boolean(options?.managerOverride);

  if (!isOverrideRequested) {
    if (room.state === "OUT_OF_ORDER") {
      return domainErr(
        "ROOM_CONFLICT",
        `Room ${room.roomNumber} is OUT_OF_ORDER (${room.outOfOrderReason ?? "Maintenance Hold"}) and cannot be checked into.`,
      );
    }
    return domainErr(
      "ROOM_CONFLICT",
      `Room ${room.roomNumber} is currently in state '${room.state}' and is not certified INSPECTED_CLEAN for check-in.`,
    );
  }

  // 3. Manager override requested: Validate RBAC & audit reason
  const overrideManagerUserId = options?.managerUserId ?? actor.userId;
  const isAuthorizingRole = isManagerRole(actor.role);

  if (!isAuthorizingRole) {
    return domainErr(
      "PERMISSION_DENIED",
      `User '${actor.userId}' with role '${actor.role}' lacks authority to override check-in on uncertified room. Duty Manager or above required.`,
    );
  }

  const reason = options?.overrideReason?.trim() ?? "";
  if (reason.length < 10) {
    return domainErr(
      "VALIDATION_FAILED",
      "Manager override requires a detailed justification (minimum 10 characters).",
    );
  }

  return ok({
    eligible: true,
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    roomState: room.state,
    managerOverrideApplied: true,
    managerUserId: overrideManagerUserId,
    overrideReason: reason,
  });
}

/**
 * Executes guest check-in if gatekeeper criteria are satisfied.
 */
export function executeGuestCheckIn(
  room: TurnaroundRoomRecord,
  reservationId: string,
  guestName: string,
  actor: TurnaroundActor,
  isoTs: string,
  prevHash: string,
  overrideOptions?: CheckInOverrideOptions,
): Result<{ room: TurnaroundRoomRecord; auditEntry: AuditLogEntry }, DomainError> {
  const eligibilityRes = validateCheckInEligibility(room, actor, overrideOptions);
  if (!eligibilityRes.ok) {
    return eligibilityRes;
  }

  const eligibility = eligibilityRes.value;

  const updatedRoom: TurnaroundRoomRecord = {
    ...room,
    state: "OCCUPIED",
    currentReservationId: reservationId,
    currentGuestName: guestName,
    touchUpNotes: undefined,
  };

  const auditRes = createAuditEntry({
    tenantId: room.tenantId,
    actorUserId: actor.userId,
    action: eligibility.managerOverrideApplied
      ? "ROOM_CHECK_IN_WITH_MANAGER_OVERRIDE"
      : "ROOM_CHECK_IN_STANDARD",
    entityType: "ROOM_TURNAROUND",
    entityId: room.roomId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify({
      previousState: room.state,
      newState: "OCCUPIED",
      reservationId,
      guestName,
      managerOverrideApplied: eligibility.managerOverrideApplied,
      managerUserId: eligibility.managerUserId,
      overrideReason: eligibility.overrideReason,
    }),
  });

  if (!auditRes.ok) return auditRes;

  return ok({ room: updatedRoom, auditEntry: auditRes.value });
}
