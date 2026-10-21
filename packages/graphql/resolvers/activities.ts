/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Spa, Excursions, Safari Jeeps & Airport Transfers (activities.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.getExcursionBooking
 * - Query.listExcursionBookings (GSI1PK = TENANT#${tenantId}#ACTDATE)
 * - Query.getAyurvedaAppointment
 * - Query.listAyurvedaAppointments (GSI1PK = TENANT#${tenantId}#ACTDATE)
 * - Mutation.createExcursionBooking
 * - Mutation.createAyurvedaAppointment
 * - Mutation.createActivityBooking
 * - Mutation.updateExcursionStatus
 * - Mutation.updateAyurvedaAppointmentStatus
 *
 * Single-table DynamoDB mapping:
 * ExcursionBooking:
 *   PK: "TENANT#" + tenantId
 *   SK: "EXCURSION#" + id
 *   GSI1PK: "TENANT#" + tenantId + "#ACTDATE"
 *   GSI1SK: "DATE#" + excursionDate + "#EXCURSION#" + id
 *
 * AyurvedaAppointment:
 *   PK: "TENANT#" + tenantId
 *   SK: "AYURVEDA#" + id
 *   GSI1PK: "TENANT#" + tenantId + "#ACTDATE"
 *   GSI1SK: "DATE#" + appointmentDate + "#AYURVEDA#" + id
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, operations, put, query, update } from "@aws-appsync/utils/dynamodb.js";
import type {
  AyurvedaAppointment,
  CreateAyurvedaAppointmentInput,
  CreateExcursionBookingInput,
  ExcursionBooking,
  MutationCreateActivityBookingArgs,
  MutationCreateAyurvedaAppointmentArgs,
  MutationCreateExcursionBookingArgs,
  MutationUpdateAyurvedaAppointmentStatusArgs,
  MutationUpdateExcursionStatusArgs,
  QueryGetAyurvedaAppointmentArgs,
  QueryGetExcursionBookingArgs,
  QueryListAyurvedaAppointmentsArgs,
  QueryListExcursionBookingsArgs,
  TaxBreakdown,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

// ============================================================================
// Authorized Role Constants
// ============================================================================

export const ACTIVITY_READ_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FRONT_DESK",
  "CONCIERGE",
  "SPA_MANAGER",
  "AYURVEDA_DOCTOR",
  "THERAPIST",
  "CHAUFFEUR",
  "DRIVER",
] as const;

export const ACTIVITY_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FRONT_DESK",
  "CONCIERGE",
  "SPA_MANAGER",
  "AYURVEDA_DOCTOR",
] as const;

export const ACTIVITY_STATUS_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FRONT_DESK",
  "CONCIERGE",
  "SPA_MANAGER",
  "AYURVEDA_DOCTOR",
  "THERAPIST",
  "CHAUFFEUR",
  "DRIVER",
] as const;

// ============================================================================
// Canonical Single-Table DynamoDB Key Builders
// ============================================================================

export function getExcursionBookingKey(tenantId: string, id: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `EXCURSION#${id}`,
  };
}

export function getAyurvedaKey(tenantId: string, id: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `AYURVEDA#${id}`,
  };
}

// ============================================================================
// Pure Calculation Helpers (4-Stage Tax & Time)
// ============================================================================

function roundLkr(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Computes 4-stage compounding Sri Lankan statutory hospitality taxes for activities:
 * Stage 1: 10% Service Charge (SC)
 * Stage 2: 1% Tourism Development Levy (TDL) on (Base + SC)
 * Stage 3: 2.5% Social Security Contribution Levy (SSCL) on (Base + SC)
 * Stage 4: 18% Value Added Tax (VAT) on (Base + SC + TDL + SSCL)
 */
export function calculateActivityTaxBreakdown(baseSupplyLkr: number): TaxBreakdown {
  const base = roundLkr(Math.max(0, baseSupplyLkr));
  const serviceChargeLkr = roundLkr(base * 0.1);
  const subtotalAfterScLkr = roundLkr(base + serviceChargeLkr);
  const tdlLkr = roundLkr(subtotalAfterScLkr * 0.01);
  const ssclLkr = roundLkr(subtotalAfterScLkr * 0.025);
  const vatBaseLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr);
  const vatLkr = roundLkr(vatBaseLkr * 0.18);
  const totalGrossLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr + vatLkr);
  const totalTaxAndServiceLkr = roundLkr(serviceChargeLkr + tdlLkr + ssclLkr + vatLkr);
  const effectiveTaxRate = base > 0 ? roundLkr((totalGrossLkr - base) / base) : 0;

  return {
    baseSupplyLkr: base,
    serviceChargeLkr,
    tdlLkr,
    ssclLkr,
    vatLkr,
    totalTaxAndServiceLkr,
    totalGrossLkr,
    effectiveTaxRate,
  };
}

/**
 * Calculates AWSTime endTime given startTime (HH:MM or HH:MM:SS) and duration in minutes.
 */
export function computeEndTime(startTime: string, durationMinutes: number): string {
  const parts = startTime.split(":");
  const hours = Math.floor(+(parts[0] || 0));
  const minutes = Math.floor(+(parts[1] || 0));
  const totalMins = (hours * 60 + minutes + Math.max(0, durationMinutes)) % (24 * 60);
  const endHours = Math.floor(totalMins / 60);
  const endMinutes = totalMins % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(endHours)}:${pad(endMinutes)}:00Z`;
}

// ============================================================================
// Entity Item Builders
// ============================================================================

export function buildExcursionBookingItem(tenantId: string, input: CreateExcursionBookingInput) {
  const id = `exc-${util.autoId().slice(0, 8)}`;
  const now = util.time.nowISO8601();
  const taxBreakdown = calculateActivityTaxBreakdown(input.retailRateLkr);
  const dateCompact = input.excursionDate.split("-").join("");
  const suffix = id.slice(-4).toUpperCase();
  const bookingNumber = `EXC-${dateCompact}-${suffix}`;

  return {
    ...getExcursionBookingKey(tenantId, id),
    GSI1PK: `TENANT#${tenantId}#ACTDATE`,
    GSI1SK: `DATE#${input.excursionDate}#EXCURSION#${id}`,
    entityType: "ExcursionBooking",
    id,
    tenantId,
    bookingNumber,
    activityType: input.activityType,
    title: input.title,
    guestName: input.guestName,
    guestPhone: input.guestPhone,
    reservationId: input.reservationId ?? null,
    roomNumber: input.roomNumber ?? null,
    excursionDate: input.excursionDate,
    departureTime: input.departureTime,
    returnTime: input.returnTime ?? null,
    numberOfAdults: input.numberOfAdults,
    numberOfChildren: input.numberOfChildren ?? 0,
    vehicleRegistrationNo: input.vehicleRegistrationNo ?? null,
    driverOrGuideName: input.driverOrGuideName ?? null,
    driverContactPhone: input.driverContactPhone ?? null,
    pickupLocation: input.pickupLocation,
    dropoffLocation: input.dropoffLocation,
    supplierCostLkr: roundLkr(input.supplierCostLkr ?? 0),
    retailRateLkr: roundLkr(input.retailRateLkr),
    taxBreakdown,
    totalGrossLkr: taxBreakdown.totalGrossLkr,
    folioId: null,
    isBilledToFolio: !!input.chargeToFolio,
    status: "CONFIRMED",
    specialRequirements: input.specialRequirements ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildAyurvedaAppointmentItem(
  tenantId: string,
  input: CreateAyurvedaAppointmentInput,
) {
  const id = `ayu-${util.autoId().slice(0, 8)}`;
  const now = util.time.nowISO8601();
  const taxBreakdown = calculateActivityTaxBreakdown(input.rateLkr);
  const dateCompact = input.appointmentDate.split("-").join("");
  const suffix = id.slice(-4).toUpperCase();
  const appointmentNumber = `AYU-${dateCompact}-${suffix}`;
  const endTime = computeEndTime(input.startTime, input.durationMinutes);

  return {
    ...getAyurvedaKey(tenantId, id),
    GSI1PK: `TENANT#${tenantId}#ACTDATE`,
    GSI1SK: `DATE#${input.appointmentDate}#AYURVEDA#${id}`,
    entityType: "AyurvedaAppointment",
    id,
    tenantId,
    appointmentNumber,
    treatmentType: input.treatmentType,
    treatmentName: input.treatmentName,
    durationMinutes: input.durationMinutes,
    guestName: input.guestName,
    reservationId: input.reservationId ?? null,
    roomNumber: input.roomNumber ?? null,
    appointmentDate: input.appointmentDate,
    startTime: input.startTime,
    endTime,
    treatmentRoomId: input.treatmentRoomId ?? null,
    therapistName: input.therapistName ?? null,
    healthNotesOrAllergies: input.healthNotesOrAllergies ?? null,
    herbalOilsUsed: input.herbalOilsUsed ?? [],
    rateLkr: roundLkr(input.rateLkr),
    taxBreakdown,
    totalGrossLkr: taxBreakdown.totalGrossLkr,
    folioId: null,
    isBilledToFolio: !!input.chargeToFolio,
    status: "SCHEDULED",
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Resolvers: Excursion Booking
// ============================================================================

export function getExcursionBookingRequest(ctx: Context<QueryGetExcursionBookingArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  return get({
    key: getExcursionBookingKey(tenantId, ctx.args.id),
  });
}

export function getExcursionBookingResponse(
  ctx: Context<
    QueryGetExcursionBookingArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    ExcursionBooking | null
  >,
): ExcursionBooking | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

export function listExcursionBookingsRequest(ctx: Context<QueryListExcursionBookingsArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  if (ctx.identity && (ctx.identity as { claims?: unknown }).claims) {
    requireUserRole(ctx, ACTIVITY_READ_ROLES);
  }

  const { excursionDate } = ctx.args;
  if (excursionDate) {
    return query({
      index: "GSI1",
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#ACTDATE` },
        GSI1SK: { beginsWith: `DATE#${excursionDate}#EXCURSION#` },
      },
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "EXCURSION#" },
    },
  });
}

export function listExcursionBookingsResponse(
  ctx: Context<
    QueryListExcursionBookingsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: ExcursionBooking[] }
  >,
): ExcursionBooking[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

export function createExcursionBookingRequest(ctx: Context<MutationCreateExcursionBookingArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  if (ctx.identity && (ctx.identity as { claims?: unknown }).claims) {
    requireUserRole(ctx, ACTIVITY_WRITE_ROLES);
  }

  const item = buildExcursionBookingItem(tenantId, ctx.args.input);
  return put({
    key: getExcursionBookingKey(tenantId, item.id),
    item,
  });
}

export function createExcursionBookingResponse(
  ctx: Context<
    MutationCreateExcursionBookingArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    ExcursionBooking
  >,
): ExcursionBooking {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

export function updateExcursionStatusRequest(ctx: Context<MutationUpdateExcursionStatusArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  if (ctx.identity && (ctx.identity as { claims?: unknown }).claims) {
    requireUserRole(ctx, ACTIVITY_STATUS_ROLES);
  }

  const { id, status } = ctx.args;
  const key = getExcursionBookingKey(tenantId, id);
  const now = util.time.nowISO8601();

  return update({
    key,
    update: {
      status: operations.replace(status),
      updatedAt: operations.replace(now),
    },
  });
}

export function updateExcursionStatusResponse(
  ctx: Context<
    MutationUpdateExcursionStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    ExcursionBooking
  >,
): ExcursionBooking {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// Resolvers: Ayurveda Appointment
// ============================================================================

export function getAyurvedaAppointmentRequest(ctx: Context<QueryGetAyurvedaAppointmentArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  return get({
    key: getAyurvedaKey(tenantId, ctx.args.id),
  });
}

export function getAyurvedaAppointmentResponse(
  ctx: Context<
    QueryGetAyurvedaAppointmentArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    AyurvedaAppointment | null
  >,
): AyurvedaAppointment | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

export function listAyurvedaAppointmentsRequest(ctx: Context<QueryListAyurvedaAppointmentsArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  if (ctx.identity && (ctx.identity as { claims?: unknown }).claims) {
    requireUserRole(ctx, ACTIVITY_READ_ROLES);
  }

  const { appointmentDate } = ctx.args;
  if (appointmentDate) {
    return query({
      index: "GSI1",
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#ACTDATE` },
        GSI1SK: { beginsWith: `DATE#${appointmentDate}#AYURVEDA#` },
      },
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "AYURVEDA#" },
    },
  });
}

export function listAyurvedaAppointmentsResponse(
  ctx: Context<
    QueryListAyurvedaAppointmentsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: AyurvedaAppointment[] }
  >,
): AyurvedaAppointment[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

export function createAyurvedaAppointmentRequest(
  ctx: Context<MutationCreateAyurvedaAppointmentArgs>,
) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  if (ctx.identity && (ctx.identity as { claims?: unknown }).claims) {
    requireUserRole(ctx, ACTIVITY_WRITE_ROLES);
  }

  const item = buildAyurvedaAppointmentItem(tenantId, ctx.args.input);
  return put({
    key: getAyurvedaKey(tenantId, item.id),
    item,
  });
}

export function createAyurvedaAppointmentResponse(
  ctx: Context<
    MutationCreateAyurvedaAppointmentArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    AyurvedaAppointment
  >,
): AyurvedaAppointment {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

export function updateAyurvedaAppointmentStatusRequest(
  ctx: Context<MutationUpdateAyurvedaAppointmentStatusArgs>,
) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  if (ctx.identity && (ctx.identity as { claims?: unknown }).claims) {
    requireUserRole(ctx, ACTIVITY_STATUS_ROLES);
  }

  const { id, status } = ctx.args;
  const key = getAyurvedaKey(tenantId, id);
  const now = util.time.nowISO8601();

  return update({
    key,
    update: {
      status: operations.replace(status),
      updatedAt: operations.replace(now),
    },
  });
}

export function updateAyurvedaAppointmentStatusResponse(
  ctx: Context<
    MutationUpdateAyurvedaAppointmentStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    AyurvedaAppointment
  >,
): AyurvedaAppointment {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// Resolvers: Unified Activity Booking
// ============================================================================

export function createActivityBookingRequest(ctx: Context<MutationCreateActivityBookingArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  if (ctx.identity && (ctx.identity as { claims?: unknown }).claims) {
    requireUserRole(ctx, ACTIVITY_WRITE_ROLES);
  }

  const { input } = ctx.args;
  if (input.activityCategory === "EXCURSION") {
    if (!input.excursionInput) {
      util.error("Missing excursionInput for EXCURSION category", "BadRequest");
    }
    const item = buildExcursionBookingItem(tenantId, input.excursionInput);
    return put({
      key: getExcursionBookingKey(tenantId, item.id),
      item,
    });
  }

  if (input.activityCategory === "AYURVEDA") {
    if (!input.ayurvedaInput) {
      util.error("Missing ayurvedaInput for AYURVEDA category", "BadRequest");
    }
    const item = buildAyurvedaAppointmentItem(tenantId, input.ayurvedaInput);
    return put({
      key: getAyurvedaKey(tenantId, item.id),
      item,
    });
  }

  util.error(`Unsupported activityCategory: ${input.activityCategory}`, "BadRequest");
}

export function createActivityBookingResponse(
  ctx: Context<
    MutationCreateActivityBookingArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >,
): boolean {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return true;
}
