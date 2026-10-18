/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Front-Desk Reservations & Tape Chart Resolver (reservationsQuery.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.listReservationsByDateRange (Rung 4 Tape Chart 14/30-day window query via GSI1)
 * - Query.listReservations
 * - Query.getReservation
 *
 * Single-table DynamoDB mapping:
 * Reservation:
 *   PK = "TENANT#" + tenantId
 *   SK = "RES#" + reservationId
 *   GSI1PK = "TENANT#" + tenantId + "#RESDATE"
 *   GSI1SK = "CHECKIN#" + checkInDate + "#" + reservationId
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, query } from "@aws-appsync/utils/dynamodb.js";
import type {
  QueryGetReservationArgs,
  QueryListReservationsArgs,
  QueryListReservationsByDateRangeArgs,
  Reservation,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

const FRONT_DESK_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FRONT_DESK_SUPERVISOR",
  "FRONT_DESK_AGENT",
  "RESERVATION_AGENT",
  "NIGHT_AUDITOR",
] as const;

/**
 * Builds the canonical single-table DynamoDB primary key for a Reservation entity.
 */
export function getReservationKey(tenantId: string, reservationId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `RES#${reservationId}`,
  };
}

function normalizeDateRangeBound(dateStr: string, isEndBound: boolean): string {
  const base = dateStr.indexOf("CHECKIN#") === 0 ? dateStr : `CHECKIN#${dateStr}`;
  return isEndBound ? `${base}#~` : base;
}

/**
 * Request handler for Query.listReservationsByDateRange.
 * Queries GSI1 partition TENANT#${tenantId}#RESDATE between startDate and endDate
 * for the 14-day or 30-day Front-Desk Tape Chart grid.
 */
export function listReservationsByDateRangeRequest(
  ctx: Context<QueryListReservationsByDateRangeArgs>,
) {
  const { tenantId, startDate, endDate } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, FRONT_DESK_ROLES);

  const startKey = normalizeDateRangeBound(startDate, false);
  const endKey = normalizeDateRangeBound(endDate, true);

  return query({
    index: "GSI1",
    query: {
      GSI1PK: { eq: `TENANT#${validatedTenantId}#RESDATE` },
      GSI1SK: { between: [startKey, endKey] },
    },
  });
}

/**
 * Response handler for Query.listReservationsByDateRange.
 */
export function listReservationsByDateRangeResponse(
  ctx: Context<
    QueryListReservationsByDateRangeArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: Reservation[] }
  >,
): Reservation[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Query.listReservations.
 */
export function listReservationsRequest(ctx: Context<QueryListReservationsArgs>) {
  const { tenantId, checkInDate } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, FRONT_DESK_ROLES);

  if (checkInDate && checkInDate.trim().length > 0) {
    return query({
      index: "GSI1",
      query: {
        GSI1PK: { eq: `TENANT#${validatedTenantId}#RESDATE` },
        GSI1SK: { beginsWith: `CHECKIN#${checkInDate}` },
      },
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${validatedTenantId}` },
      SK: { beginsWith: "RES#" },
    },
  });
}

/**
 * Response handler for Query.listReservations.
 */
export function listReservationsResponse(
  ctx: Context<
    QueryListReservationsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: Reservation[] }
  >,
): Reservation[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const statusFilter = ctx.args.status;
  const rawItems = ctx.result?.items ?? [];

  if (statusFilter) {
    return rawItems.filter((res) => res.status === statusFilter);
  }
  return rawItems;
}

/**
 * Request handler for Query.getReservation.
 */
export function getReservationRequest(ctx: Context<QueryGetReservationArgs>) {
  const { tenantId, id } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, FRONT_DESK_ROLES);

  return get({
    key: getReservationKey(validatedTenantId, id),
  });
}

/**
 * Response handler for Query.getReservation.
 */
export function getReservationResponse(
  ctx: Context<
    QueryGetReservationArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Reservation
  >,
): Reservation | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}
