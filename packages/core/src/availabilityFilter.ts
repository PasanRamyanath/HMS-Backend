/**
 * @hms/core - Date-Range Conflict & Room Availability Filter (availabilityFilter.ts).
 *
 * Implements high-performance pure date interval collision detection for:
 * 1. Physical Room inventory across RoomTypes and wings.
 * 2. Sri Lankan Chauffeur / Driver Dormitory bed slots.
 * 3. Maintenance and Out-of-Order blocking intervals.
 *
 * Architectural Invariants:
 * - Half-open interval [checkIn, checkOut) semantics:
 *   Check-Out at 11:00 AM does NOT block Check-In at 2:00 PM on the same date.
 * - Interval overlap condition: (reqStart < existingEnd && reqEnd > existingStart).
 * - Multi-tenant isolation: enforces strict tenantId validation and match.
 * - Result<T, DomainError> deterministic error model.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

// ============================================================================
// Types & Contracts
// ============================================================================

export interface ExistingReservationSlot {
  readonly id: string;
  readonly tenantId: string;
  readonly roomId?: string | undefined;
  readonly roomTypeId: string;
  readonly checkInDate: string; // YYYY-MM-DD
  readonly checkOutDate: string; // YYYY-MM-DD
  readonly status: string; // CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED, NO_SHOW, INQUIRY
  readonly driverBedId?: string | undefined;
}

export interface RoomInventoryItem {
  readonly id: string;
  readonly tenantId: string;
  readonly roomNumber: string;
  readonly roomTypeId: string;
  readonly building: string;
  readonly floor: string;
  readonly isActive: boolean;
  readonly isSmokingAllowed?: boolean | undefined;
  readonly isAccessible?: boolean | undefined;
}

export interface MaintenanceBlock {
  readonly id: string;
  readonly tenantId: string;
  readonly roomId: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD
  readonly reason?: string | undefined;
}

export type DormGender = "MALE" | "FEMALE" | "ANY";

export interface DriverDormBedItem {
  readonly id: string;
  readonly tenantId: string;
  readonly bedNumber: string;
  readonly dormName: string;
  readonly gender: DormGender;
  readonly isActive: boolean;
}

export interface ExistingDriverBedBooking {
  readonly id: string;
  readonly tenantId: string;
  readonly driverBedId: string;
  readonly checkInDate: string; // YYYY-MM-DD
  readonly checkOutDate: string; // YYYY-MM-DD
  readonly status: string;
}

export interface RoomAvailabilityQuery {
  readonly tenantId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly roomTypeId?: string | undefined;
  readonly requestedCount?: number | undefined;
  readonly rooms: ReadonlyArray<RoomInventoryItem>;
  readonly reservations: ReadonlyArray<ExistingReservationSlot>;
  readonly maintenanceBlocks?: ReadonlyArray<MaintenanceBlock> | undefined;
}

export interface DriverBedAvailabilityQuery {
  readonly tenantId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly gender?: DormGender | undefined;
  readonly requestedBedsCount?: number | undefined;
  readonly driverBeds: ReadonlyArray<DriverDormBedItem>;
  readonly existingBookings: ReadonlyArray<ExistingDriverBedBooking>;
}

export interface AvailableRoomsResult {
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly nights: number;
  readonly totalRoomsCount: number;
  readonly availableRooms: ReadonlyArray<RoomInventoryItem>;
  readonly availableRoomsCount: number;
  readonly availableCountByRoomType: Readonly<Record<string, number>>;
  readonly conflictingRoomIds: ReadonlyArray<string>;
  readonly isAvailable: boolean;
}

export interface AvailableDriverBedsResult {
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly nights: number;
  readonly totalBedsCount: number;
  readonly availableBeds: ReadonlyArray<DriverDormBedItem>;
  readonly availableBedsCount: number;
  readonly isAvailable: boolean;
}

export interface CheckSingleRoomAvailabilityInput {
  readonly tenantId: string;
  readonly roomId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly reservations: ReadonlyArray<ExistingReservationSlot>;
  readonly maintenanceBlocks?: ReadonlyArray<MaintenanceBlock> | undefined;
}

// ============================================================================
// Pure Interval & Date Validation
// ============================================================================

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks whether two half-open date intervals [startA, endA) and [startB, endB) overlap.
 *
 * Invariant: Check-Out on date T does NOT conflict with Check-In on date T.
 */
export function checkIntervalOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA < endB && endA > startB;
}

/**
 * Validates ISO date format and ensures checkInDate is strictly before checkOutDate.
 */
export function validateDateRange(
  checkInDate: unknown,
  checkOutDate: unknown,
): Result<{ checkIn: string; checkOut: string; nights: number }, DomainError> {
  if (typeof checkInDate !== "string" || !ISO_DATE_REGEX.test(checkInDate.trim())) {
    return domainErr(
      "VALIDATION_FAILED",
      "checkInDate must be a valid ISO YYYY-MM-DD date string",
      {
        checkInDate,
      },
    );
  }

  if (typeof checkOutDate !== "string" || !ISO_DATE_REGEX.test(checkOutDate.trim())) {
    return domainErr(
      "VALIDATION_FAILED",
      "checkOutDate must be a valid ISO YYYY-MM-DD date string",
      {
        checkOutDate,
      },
    );
  }

  const checkIn = checkInDate.trim();
  const checkOut = checkOutDate.trim();

  if (checkIn >= checkOut) {
    return domainErr("DATE_OVERLAP", "checkInDate must be strictly earlier than checkOutDate", {
      checkIn,
      checkOut,
    });
  }

  const startTime = new Date(`${checkIn}T00:00:00Z`).getTime();
  const endTime = new Date(`${checkOut}T00:00:00Z`).getTime();
  const nights = Math.round((endTime - startTime) / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    return domainErr("DATE_OVERLAP", "Stay must be at least 1 night", {
      checkIn,
      checkOut,
      nights,
    });
  }

  return ok({ checkIn, checkOut, nights });
}

/**
 * Determines whether a reservation status blocks room inventory.
 */
export function isBlockingReservationStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  if (normalized === "CANCELLED" || normalized === "NO_SHOW") {
    return false;
  }
  return true;
}

// ============================================================================
// Room Availability Engine
// ============================================================================

function collectConflictingRoomIds(
  reservations: ReadonlyArray<ExistingReservationSlot>,
  maintenanceBlocks: ReadonlyArray<MaintenanceBlock>,
  checkIn: string,
  checkOut: string,
): Set<string> {
  const conflicting = new Set<string>();

  for (const res of reservations) {
    if (!isBlockingReservationStatus(res.status)) {
      continue;
    }
    if (res.roomId && checkIntervalOverlap(checkIn, checkOut, res.checkInDate, res.checkOutDate)) {
      conflicting.add(res.roomId);
    }
  }

  for (const block of maintenanceBlocks) {
    if (checkIntervalOverlap(checkIn, checkOut, block.startDate, block.endDate)) {
      conflicting.add(block.roomId);
    }
  }

  return conflicting;
}

function tallyAvailableByType(
  availableRooms: ReadonlyArray<RoomInventoryItem>,
  unallocatedReservationCountByType: Readonly<Record<string, number>>,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const room of availableRooms) {
    counts[room.roomTypeId] = (counts[room.roomTypeId] ?? 0) + 1;
  }

  for (const [typeId, unallocatedCount] of Object.entries(unallocatedReservationCountByType)) {
    const current = counts[typeId] ?? 0;
    counts[typeId] = Math.max(0, current - unallocatedCount);
  }

  return counts;
}

function countUnallocatedReservations(
  reservations: ReadonlyArray<ExistingReservationSlot>,
  checkIn: string,
  checkOut: string,
): Record<string, number> {
  const unallocatedCounts: Record<string, number> = {};

  for (const res of reservations) {
    if (!isBlockingReservationStatus(res.status)) {
      continue;
    }
    if (!res.roomId && checkIntervalOverlap(checkIn, checkOut, res.checkInDate, res.checkOutDate)) {
      unallocatedCounts[res.roomTypeId] = (unallocatedCounts[res.roomTypeId] ?? 0) + 1;
    }
  }

  return unallocatedCounts;
}

/**
 * Computes available rooms by room type for a specified [checkInDate, checkOutDate) window.
 */
export function filterAvailableRooms(
  query: RoomAvailabilityQuery,
): Result<AvailableRoomsResult, DomainError> {
  const tenantRes = validateTenantId(query.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const validTenant = tenantRes.value;

  const dateRes = validateDateRange(query.checkInDate, query.checkOutDate);
  if (!dateRes.ok) {
    return dateRes;
  }
  const { checkIn, checkOut, nights } = dateRes.value;

  // Filter active rooms for tenant
  const activeRooms = query.rooms.filter((room) => room.tenantId === validTenant && room.isActive);

  // Check tenant isolation on reservations & blocks
  const tenantReservations = query.reservations.filter((r) => r.tenantId === validTenant);
  const tenantBlocks = (query.maintenanceBlocks ?? []).filter((b) => b.tenantId === validTenant);

  // Collect occupied room IDs
  const conflictingSet = collectConflictingRoomIds(
    tenantReservations,
    tenantBlocks,
    checkIn,
    checkOut,
  );

  // Rooms that have no direct assigned conflicts
  const candidateRooms = activeRooms.filter((r) => !conflictingSet.has(r.id));

  // Tally unallocated reservations
  const unallocatedCounts = countUnallocatedReservations(tenantReservations, checkIn, checkOut);

  const availableCountByType = tallyAvailableByType(candidateRooms, unallocatedCounts);

  // If specific room type requested, verify its availability count
  let isAvailable = candidateRooms.length > 0;
  const requestedCount = Math.max(1, query.requestedCount ?? 1);

  if (query.roomTypeId) {
    const typeAvailable = availableCountByType[query.roomTypeId] ?? 0;
    isAvailable = typeAvailable >= requestedCount;
  } else {
    isAvailable = candidateRooms.length >= requestedCount;
  }

  return ok({
    checkInDate: checkIn,
    checkOutDate: checkOut,
    nights,
    totalRoomsCount: activeRooms.length,
    availableRooms: candidateRooms,
    availableRoomsCount: candidateRooms.length,
    availableCountByRoomType: availableCountByType,
    conflictingRoomIds: Array.from(conflictingSet).sort(),
    isAvailable,
  });
}

function hasReservationConflict(
  reservations: ReadonlyArray<ExistingReservationSlot>,
  tenantId: string,
  roomId: string,
  checkIn: string,
  checkOut: string,
): boolean {
  return reservations.some(
    (res) =>
      res.tenantId === tenantId &&
      res.roomId === roomId &&
      isBlockingReservationStatus(res.status) &&
      checkIntervalOverlap(checkIn, checkOut, res.checkInDate, res.checkOutDate),
  );
}

function hasMaintenanceConflict(
  blocks: ReadonlyArray<MaintenanceBlock> | undefined,
  tenantId: string,
  roomId: string,
  checkIn: string,
  checkOut: string,
): boolean {
  if (!blocks || blocks.length === 0) {
    return false;
  }
  return blocks.some(
    (block) =>
      block.tenantId === tenantId &&
      block.roomId === roomId &&
      checkIntervalOverlap(checkIn, checkOut, block.startDate, block.endDate),
  );
}

/**
 * Checks if a specific physical room is available for [checkInDate, checkOutDate).
 */
export function checkSingleRoomAvailability(
  input: CheckSingleRoomAvailabilityInput,
): Result<boolean, DomainError> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }

  const dateRes = validateDateRange(input.checkInDate, input.checkOutDate);
  if (!dateRes.ok) {
    return dateRes;
  }
  const { checkIn, checkOut } = dateRes.value;

  if (hasReservationConflict(input.reservations, input.tenantId, input.roomId, checkIn, checkOut)) {
    return ok(false);
  }

  if (
    hasMaintenanceConflict(input.maintenanceBlocks, input.tenantId, input.roomId, checkIn, checkOut)
  ) {
    return ok(false);
  }

  return ok(true);
}

// ============================================================================
// Driver Dormitory Bed Availability Engine
// ============================================================================

/**
 * Computes available Chauffeur / Driver Dormitory beds for [checkInDate, checkOutDate).
 */
export function filterAvailableDriverBeds(
  query: DriverBedAvailabilityQuery,
): Result<AvailableDriverBedsResult, DomainError> {
  const tenantRes = validateTenantId(query.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const validTenant = tenantRes.value;

  const dateRes = validateDateRange(query.checkInDate, query.checkOutDate);
  if (!dateRes.ok) {
    return dateRes;
  }
  const { checkIn, checkOut, nights } = dateRes.value;

  // Active beds for tenant matching gender if specified
  const candidateBeds = query.driverBeds.filter((bed) => {
    if (bed.tenantId !== validTenant || !bed.isActive) {
      return false;
    }
    if (
      query.gender &&
      query.gender !== "ANY" &&
      bed.gender !== "ANY" &&
      bed.gender !== query.gender
    ) {
      return false;
    }
    return true;
  });

  // Find occupied driver bed IDs
  const occupiedBedIds = new Set<string>();
  for (const booking of query.existingBookings) {
    if (booking.tenantId !== validTenant) {
      continue;
    }
    if (!isBlockingReservationStatus(booking.status)) {
      continue;
    }
    if (checkIntervalOverlap(checkIn, checkOut, booking.checkInDate, booking.checkOutDate)) {
      occupiedBedIds.add(booking.driverBedId);
    }
  }

  const availableBeds = candidateBeds.filter((b) => !occupiedBedIds.has(b.id));
  const requestedCount = Math.max(1, query.requestedBedsCount ?? 1);
  const isAvailable = availableBeds.length >= requestedCount;

  return ok({
    checkInDate: checkIn,
    checkOutDate: checkOut,
    nights,
    totalBedsCount: candidateBeds.length,
    availableBeds,
    availableBedsCount: availableBeds.length,
    isAvailable,
  });
}

// ============================================================================
// Immutable Audit Log Payload Generation
// ============================================================================

export function createAvailabilityAuditRecord(
  previousHash: string,
  tenantId: string,
  staffUserId: string,
  action: "ROOM_AVAILABILITY_QUERY" | "DRIVER_BED_AVAILABILITY_QUERY",
  querySummary: Readonly<Record<string, unknown>>,
): Result<AuditLogEntry, DomainError> {
  return createAuditEntry({
    prevHash: previousHash,
    tenantId,
    actorUserId: staffUserId,
    action,
    entityType: "AvailabilityQuery",
    entityId: `${action}-${tenantId}`,
    isoTs: "2026-10-19T00:00:00.000Z",
    afterJson: JSON.stringify(querySummary),
  });
}
