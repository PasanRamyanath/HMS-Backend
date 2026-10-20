/**
 * Automated Daily Attendant Room Assignment Balancer (hkAssignment.ts)
 *
 * Hospitality Workload Engine for Sri Lankan hotels, resorts, and boutique villas.
 *
 * Operational Principles & Algorithmic Design:
 * - Pure deterministic greedy load balancer (LPT - Longest Processing Time heuristic).
 * - Workload weighting credits:
 *   - CHECKOUT dirty rooms: 2.0 credits (full linen stripping, deep sanitization, minibar reset)
 *   - STAYOVER dirty rooms: 1.0 credit (towel refresh, bed making, trash clearing)
 *   - TOUCH_UP rooms: 0.5 credits (vacant inspected refresh before arrival)
 *   - DEEP_CLEAN rooms: 3.0 credits (quarterly deep scrub / seasonal reset)
 * - Floor Clustering Heuristic:
 *   - Attendants are clustered by floor/wing to minimize heavy housekeeping trolley transit.
 * - Priority Sequencing:
 *   - Within each attendant's task sheet, rooms are sequenced with VIP and Arrival Today
 *     checkouts first so they are ready for morning/midday check-ins.
 * - Multi-tenant SaaS validation & immutable audit payload generation.
 * - Zero external npm dependencies & strict cognitive complexity <= 12 per function.
 */

import { type DomainError, type Result, domainErr, ok } from "./result.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type HousekeepingTurnaroundType = "CHECKOUT" | "STAYOVER" | "TOUCH_UP" | "DEEP_CLEAN";

export type HousekeepingRoomPriority = "VIP" | "ARRIVAL_TODAY" | "STANDARD";

export interface HousekeepingAssignmentRoom {
  readonly roomId: string;
  readonly roomNumber: string;
  readonly floor: string;
  readonly buildingWing?: string | undefined;
  readonly turnaroundType: HousekeepingTurnaroundType;
  readonly priority?: HousekeepingRoomPriority | undefined;
  readonly customWeight?: number | undefined;
  readonly notes?: string | undefined;
}

export interface OnDutyAttendant {
  readonly attendantId: string;
  readonly name: string;
  readonly preferredFloors?: readonly string[] | undefined;
  readonly shiftHours?: number | undefined;
  readonly maxCredits?: number | undefined;
}

export interface AssignedRoomTask {
  readonly roomId: string;
  readonly roomNumber: string;
  readonly floor: string;
  readonly buildingWing?: string | undefined;
  readonly turnaroundType: HousekeepingTurnaroundType;
  readonly priority: HousekeepingRoomPriority;
  readonly credits: number;
  readonly sequenceNumber: number;
  readonly notes?: string | undefined;
}

export interface AttendantTaskSheet {
  readonly attendantId: string;
  readonly attendantName: string;
  readonly totalCredits: number;
  readonly checkoutCount: number;
  readonly stayoverCount: number;
  readonly touchUpCount: number;
  readonly deepCleanCount: number;
  readonly totalRoomsCount: number;
  readonly assignedRooms: readonly AssignedRoomTask[];
  readonly primaryFloor?: string | undefined;
}

export interface HousekeepingAssignmentInput {
  readonly tenantId: string;
  readonly dateIso: string;
  readonly rooms: readonly HousekeepingAssignmentRoom[];
  readonly attendants: readonly OnDutyAttendant[];
  readonly customWeights?: Partial<Record<HousekeepingTurnaroundType, number>> | undefined;
  readonly enforceFloorClustering?: boolean | undefined;
}

export interface HousekeepingAssignmentOutput {
  readonly tenantId: string;
  readonly dateIso: string;
  readonly totalRooms: number;
  readonly totalCredits: number;
  readonly averageCreditsPerAttendant: number;
  readonly maxCreditDifference: number;
  readonly taskSheets: readonly AttendantTaskSheet[];
  readonly unassignedRooms: readonly HousekeepingAssignmentRoom[];
  readonly auditPayload: Readonly<Record<string, unknown>>;
}

// ============================================================================
// Default Weight Presets (Hospitality Standard)
// ============================================================================

export const DEFAULT_TURNAROUND_WEIGHTS: Readonly<Record<HousekeepingTurnaroundType, number>> = {
  CHECKOUT: 2.0,
  STAYOVER: 1.0,
  TOUCH_UP: 0.5,
  DEEP_CLEAN: 3.0,
};

// ============================================================================
// Internal Attendant State Tracker
// ============================================================================

interface AttendantRunningState {
  readonly attendantId: string;
  readonly name: string;
  readonly preferredFloors: readonly string[];
  readonly shiftHours: number;
  readonly maxCredits: number;
  accumulatedCredits: number;
  floorRoomCounts: Map<string, number>;
  tasks: Array<Omit<AssignedRoomTask, "sequenceNumber">>;
}

// ============================================================================
// Pure Resolvers (Cognitive Complexity <= 12)
// ============================================================================

export function resolveRoomTurnaroundWeight(
  room: HousekeepingAssignmentRoom,
  customWeights?: Partial<Record<HousekeepingTurnaroundType, number>> | undefined,
): number {
  if (room.customWeight !== undefined && room.customWeight > 0) {
    return Math.round(room.customWeight * 100) / 100;
  }
  const weight =
    customWeights?.[room.turnaroundType] ?? DEFAULT_TURNAROUND_WEIGHTS[room.turnaroundType];
  return Math.round(weight * 100) / 100;
}

export function resolvePriorityRank(priority?: HousekeepingRoomPriority | undefined): number {
  switch (priority) {
    case "VIP":
      return 1;
    case "ARRIVAL_TODAY":
      return 2;
    default:
      return 3;
  }
}

export function sortRoomsForGreedyAssignment(
  rooms: readonly HousekeepingAssignmentRoom[],
  customWeights?: Partial<Record<HousekeepingTurnaroundType, number>> | undefined,
): HousekeepingAssignmentRoom[] {
  return [...rooms].sort((a, b) => {
    // 1. Heavier workload first (LPT heuristic)
    const weightA = resolveRoomTurnaroundWeight(a, customWeights);
    const weightB = resolveRoomTurnaroundWeight(b, customWeights);
    if (weightB !== weightA) {
      return weightB - weightA;
    }

    // 2. Higher priority first (VIP -> Arrival Today -> Standard)
    const prioA = resolvePriorityRank(a.priority);
    const prioB = resolvePriorityRank(b.priority);
    if (prioA !== prioB) {
      return prioA - prioB;
    }

    // 3. Group by floor for initial clustering
    if (a.floor !== b.floor) {
      return a.floor.localeCompare(b.floor, undefined, { numeric: true });
    }

    // 4. Stable room number sort
    return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
  });
}

export function evaluateAttendantFitScore(
  attendant: AttendantRunningState,
  room: HousekeepingAssignmentRoom,
  roomWeight: number,
  enforceFloorClustering: boolean,
): number {
  // Check max credits limit
  if (attendant.accumulatedCredits + roomWeight > attendant.maxCredits) {
    return Number.POSITIVE_INFINITY;
  }

  let score = attendant.accumulatedCredits;

  if (enforceFloorClustering) {
    const existingRoomsOnFloor = attendant.floorRoomCounts.get(room.floor) ?? 0;
    if (existingRoomsOnFloor > 0) {
      // Clustering reward: strong deduction to keep attendant on same floor
      score -= 2.0 * existingRoomsOnFloor;
    } else if (attendant.preferredFloors.includes(room.floor)) {
      // Preference reward
      score -= 2.5;
    } else if (attendant.preferredFloors.length > 0) {
      // Penalty when room does not match attendant's preferred floors
      score += 3.0;
    } else if (attendant.tasks.length > 0) {
      // Floor hopping penalty
      score += 1.5;
    }
  }

  return score;
}

export function findBestAttendantForRoom(
  attendants: AttendantRunningState[],
  room: HousekeepingAssignmentRoom,
  roomWeight: number,
  enforceFloorClustering: boolean,
): AttendantRunningState | null {
  let bestAttendant: AttendantRunningState | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const attendant of attendants) {
    const score = evaluateAttendantFitScore(attendant, room, roomWeight, enforceFloorClustering);

    if (score < bestScore) {
      bestScore = score;
      bestAttendant = attendant;
    }
  }

  return bestAttendant;
}

export function buildAssignedRoomTasks(
  rawTasks: Array<Omit<AssignedRoomTask, "sequenceNumber">>,
): AssignedRoomTask[] {
  // Sort tasks within attendant's day: VIP first, then Arrival Today, then by room number
  const sorted = [...rawTasks].sort((a, b) => {
    const prioA = resolvePriorityRank(a.priority);
    const prioB = resolvePriorityRank(b.priority);
    if (prioA !== prioB) {
      return prioA - prioB;
    }
    return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
  });

  return sorted.map((task, index) => ({
    ...task,
    sequenceNumber: index + 1,
  }));
}

export function determinePrimaryFloor(floorCounts: Map<string, number>): string | undefined {
  let maxCount = 0;
  let primary: string | undefined;

  for (const [floor, count] of floorCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      primary = floor;
    }
  }

  return primary;
}

export function compileAttendantTaskSheet(state: AttendantRunningState): AttendantTaskSheet {
  const assignedRooms = buildAssignedRoomTasks(state.tasks);

  let checkoutCount = 0;
  let stayoverCount = 0;
  let touchUpCount = 0;
  let deepCleanCount = 0;

  for (const task of assignedRooms) {
    switch (task.turnaroundType) {
      case "CHECKOUT":
        checkoutCount += 1;
        break;
      case "STAYOVER":
        stayoverCount += 1;
        break;
      case "TOUCH_UP":
        touchUpCount += 1;
        break;
      case "DEEP_CLEAN":
        deepCleanCount += 1;
        break;
    }
  }

  return {
    attendantId: state.attendantId,
    attendantName: state.name,
    totalCredits: Math.round(state.accumulatedCredits * 100) / 100,
    checkoutCount,
    stayoverCount,
    touchUpCount,
    deepCleanCount,
    totalRoomsCount: assignedRooms.length,
    assignedRooms,
    primaryFloor: determinePrimaryFloor(state.floorRoomCounts),
  };
}

export function validateAssignmentInput(
  input: HousekeepingAssignmentInput,
): Result<void, DomainError> {
  if (!input.tenantId || input.tenantId.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "tenantId must not be empty");
  }

  if (!input.attendants || input.attendants.length === 0) {
    return domainErr(
      "VALIDATION_FAILED",
      "At least one on-duty attendant is required for room assignment",
    );
  }

  // Check duplicate room IDs
  const roomIds = new Set<string>();
  for (const room of input.rooms) {
    if (roomIds.has(room.roomId)) {
      return domainErr(
        "VALIDATION_FAILED",
        `Duplicate roomId found in assignment batch: ${room.roomId}`,
        { roomId: room.roomId },
      );
    }
    roomIds.add(room.roomId);
  }

  return ok(undefined);
}

// ============================================================================
// Main Domain Balancer: assignHousekeepingRooms (Complexity <= 12)
// ============================================================================

export function assignHousekeepingRooms(
  input: HousekeepingAssignmentInput,
): Result<HousekeepingAssignmentOutput, DomainError> {
  const validation = validateAssignmentInput(input);
  if (!validation.ok) {
    return validation;
  }

  const enforceClustering = input.enforceFloorClustering !== false;

  // Initialize attendant states
  const attendantsState: AttendantRunningState[] = input.attendants.map((a) => ({
    attendantId: a.attendantId,
    name: a.name,
    preferredFloors: a.preferredFloors ?? [],
    shiftHours: a.shiftHours ?? 8.0,
    maxCredits: a.maxCredits ?? Number.POSITIVE_INFINITY,
    accumulatedCredits: 0,
    floorRoomCounts: new Map<string, number>(),
    tasks: [],
  }));

  const sortedRooms = sortRoomsForGreedyAssignment(input.rooms, input.customWeights);
  const unassignedRooms: HousekeepingAssignmentRoom[] = [];
  let totalAssignedCredits = 0;

  for (const room of sortedRooms) {
    const weight = resolveRoomTurnaroundWeight(room, input.customWeights);
    const bestAttendant = findBestAttendantForRoom(
      attendantsState,
      room,
      weight,
      enforceClustering,
    );

    if (bestAttendant) {
      bestAttendant.accumulatedCredits =
        Math.round((bestAttendant.accumulatedCredits + weight) * 100) / 100;
      totalAssignedCredits = Math.round((totalAssignedCredits + weight) * 100) / 100;

      const floorCount = bestAttendant.floorRoomCounts.get(room.floor) ?? 0;
      bestAttendant.floorRoomCounts.set(room.floor, floorCount + 1);

      bestAttendant.tasks.push({
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        floor: room.floor,
        buildingWing: room.buildingWing,
        turnaroundType: room.turnaroundType,
        priority: room.priority ?? "STANDARD",
        credits: weight,
        notes: room.notes,
      });
    } else {
      unassignedRooms.push(room);
    }
  }

  // Compile task sheets
  const taskSheets = attendantsState.map(compileAttendantTaskSheet);

  // Compute metrics
  const totalRooms = input.rooms.length - unassignedRooms.length;
  const averageCreditsPerAttendant =
    taskSheets.length > 0 ? Math.round((totalAssignedCredits / taskSheets.length) * 100) / 100 : 0;

  const creditLoads = taskSheets.map((s) => s.totalCredits);
  const maxLoad = Math.max(0, ...creditLoads);
  const minLoad = Math.min(maxLoad, ...creditLoads);
  const maxCreditDifference = Math.round((maxLoad - minLoad) * 100) / 100;

  const auditPayload: Record<string, unknown> = {
    tenantId: input.tenantId,
    dateIso: input.dateIso,
    totalRoomsRequested: input.rooms.length,
    totalRoomsAssigned: totalRooms,
    unassignedCount: unassignedRooms.length,
    totalCredits: totalAssignedCredits,
    attendantCount: input.attendants.length,
    maxCreditDifference,
    calculatedAtIso: new Date().toISOString(),
  };

  return ok({
    tenantId: input.tenantId,
    dateIso: input.dateIso,
    totalRooms,
    totalCredits: totalAssignedCredits,
    averageCreditsPerAttendant,
    maxCreditDifference,
    taskSheets,
    unassignedRooms,
    auditPayload,
  });
}
