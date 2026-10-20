/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Housekeeping Operations: Maintenance Tickets & Lost-and-Found Registry (housekeepingOps.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.getMaintenanceTicket
 * - Query.listMaintenanceTickets
 * - Mutation.createMaintenanceTicket
 * - Mutation.updateMaintenanceTicketStatus
 * - Query.getLostFoundItem
 * - Query.listLostFoundItems
 * - Mutation.logLostFoundItem
 * - Mutation.updateLostFoundStatus
 *
 * Single-table DynamoDB mapping:
 * MaintenanceTicket:
 *   PK: "TENANT#" + tenantId
 *   SK: "MAINT#" + ticketId
 *   GSI1PK: "TENANT#" + tenantId + "#MAINT"
 *   GSI1SK: "STATUS#" + status + "#" + severity + "#" + ticketId
 *
 * LostFoundItem:
 *   PK: "TENANT#" + tenantId
 *   SK: "LOSTFOUND#" + itemId
 *   GSI1PK: "TENANT#" + tenantId + "#LOSTFOUND"
 *   GSI1SK: "STATUS#" + status + "#" + category + "#" + itemId
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, operations, put, query, update } from "@aws-appsync/utils/dynamodb.js";
import type {
  LostFoundItem,
  MaintenanceTicket,
  MutationCreateMaintenanceTicketArgs,
  MutationLogLostFoundItemArgs,
  MutationUpdateLostFoundStatusArgs,
  MutationUpdateMaintenanceTicketStatusArgs,
  QueryGetLostFoundItemArgs,
  QueryGetMaintenanceTicketArgs,
  QueryListLostFoundItemsArgs,
  QueryListMaintenanceTicketsArgs,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

// ============================================================================
// Authorized Role Constants
// ============================================================================

export const HK_READ_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "HOUSEKEEPING_SUPERVISOR",
  "HOUSEKEEPING_STAFF",
  "MAINTENANCE",
  "FRONT_DESK",
  "SECURITY",
  "CONCIERGE",
] as const;

export const MAINTENANCE_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "HOUSEKEEPING_SUPERVISOR",
  "HOUSEKEEPING_STAFF",
  "MAINTENANCE",
  "FRONT_DESK",
] as const;

export const MAINTENANCE_STATUS_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "HOUSEKEEPING_SUPERVISOR",
  "MAINTENANCE",
] as const;

export const LOSTFOUND_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "HOUSEKEEPING_SUPERVISOR",
  "HOUSEKEEPING_STAFF",
  "FRONT_DESK",
  "SECURITY",
] as const;

// ============================================================================
// Canonical Single-Table DynamoDB Key Builders
// ============================================================================

export function getMaintenanceKey(tenantId: string, ticketId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `MAINT#${ticketId}`,
  };
}

export function getLostFoundKey(tenantId: string, itemId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `LOSTFOUND#${itemId}`,
  };
}

// ============================================================================
// Maintenance Ticket Resolvers
// ============================================================================

/**
 * Request handler for Query.getMaintenanceTicket.
 */
export function getMaintenanceTicketRequest(ctx: Context<QueryGetMaintenanceTicketArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HK_READ_ROLES);

  return get({
    key: getMaintenanceKey(tenantId, ctx.args.ticketId),
  });
}

/**
 * Response handler for Query.getMaintenanceTicket.
 */
export function getMaintenanceTicketResponse(
  ctx: Context<
    QueryGetMaintenanceTicketArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MaintenanceTicket
  >,
): MaintenanceTicket | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

/**
 * Request handler for Query.listMaintenanceTickets.
 */
export function listMaintenanceTicketsRequest(ctx: Context<QueryListMaintenanceTicketsArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HK_READ_ROLES);

  const limit = ctx.args.limit || 50;
  const nextToken = ctx.args.nextToken;

  if (ctx.args.status) {
    const q = {
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#MAINT` },
        GSI1SK: { beginsWith: `STATUS#${ctx.args.status}` },
      },
      index: "GSI1",
      limit,
    };
    return nextToken ? query({ ...q, nextToken }) : query(q);
  }

  const q = {
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "MAINT#" },
    },
    limit,
  };
  return nextToken ? query({ ...q, nextToken }) : query(q);
}

/**
 * Response handler for Query.listMaintenanceTickets.
 */
export function listMaintenanceTicketsResponse(
  ctx: Context<
    QueryListMaintenanceTicketsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: MaintenanceTicket[] }
  >,
): MaintenanceTicket[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Mutation.createMaintenanceTicket.
 */
export function createMaintenanceTicketRequest(ctx: Context<MutationCreateMaintenanceTicketArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, MAINTENANCE_WRITE_ROLES);

  const { input } = ctx.args;
  const ticketId =
    input.ticketId && input.ticketId.trim().length > 0
      ? input.ticketId
      : `maint-${util.autoId().slice(0, 8)}`;

  const now = util.time.nowISO8601();
  const key = getMaintenanceKey(tenantId, ticketId);

  const item = {
    ...key,
    id: ticketId,
    tenantId,
    entityType: "MaintenanceTicket",
    GSI1PK: `TENANT#${tenantId}#MAINT`,
    GSI1SK: `STATUS#REPORTED#${input.severity}#${ticketId}`,
    roomNumber: input.roomNumber,
    category: input.category,
    severity: input.severity,
    status: "REPORTED",
    reportedBy: input.reportedBy,
    assignedTo: input.assignedTo ?? null,
    estimatedCostLkr: input.estimatedCostLkr ?? 0,
    actualCostLkr: 0,
    description: input.description,
    reportedAtIso: input.reportedAtIso ?? now,
    resolvedAtIso: null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.createMaintenanceTicket.
 */
export function createMaintenanceTicketResponse(
  ctx: Context<
    MutationCreateMaintenanceTicketArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MaintenanceTicket
  >,
): MaintenanceTicket {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.updateMaintenanceTicketStatus.
 */
export function updateMaintenanceTicketStatusRequest(
  ctx: Context<MutationUpdateMaintenanceTicketStatusArgs>,
) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, MAINTENANCE_STATUS_ROLES);

  const { ticketId, input } = ctx.args;
  const key = getMaintenanceKey(tenantId, ticketId);
  const now = util.time.nowISO8601();

  const isResolvedOrClosed = input.status === "RESOLVED" || input.status === "CLOSED";

  const updateExpressions: Record<string, unknown> = {
    status: operations.replace(input.status),
    GSI1SK: operations.replace(`STATUS#${input.status}#${ticketId}`),
    updatedAt: operations.replace(now),
  };

  if (input.assignedTo !== undefined && input.assignedTo !== null) {
    updateExpressions.assignedTo = operations.replace(input.assignedTo);
  }
  if (input.actualCostLkr !== undefined && input.actualCostLkr !== null) {
    updateExpressions.actualCostLkr = operations.replace(input.actualCostLkr);
  }
  if (input.notes !== undefined && input.notes !== null) {
    updateExpressions.notes = operations.replace(input.notes);
  }
  if (isResolvedOrClosed) {
    updateExpressions.resolvedAtIso = operations.replace(now);
  }

  return update({
    key,
    update: updateExpressions,
  });
}

/**
 * Response handler for Mutation.updateMaintenanceTicketStatus.
 */
export function updateMaintenanceTicketStatusResponse(
  ctx: Context<
    MutationUpdateMaintenanceTicketStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MaintenanceTicket
  >,
): MaintenanceTicket {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// Lost-and-Found Registry Resolvers
// ============================================================================

/**
 * Request handler for Query.getLostFoundItem.
 */
export function getLostFoundItemRequest(ctx: Context<QueryGetLostFoundItemArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HK_READ_ROLES);

  return get({
    key: getLostFoundKey(tenantId, ctx.args.itemId),
  });
}

/**
 * Response handler for Query.getLostFoundItem.
 */
export function getLostFoundItemResponse(
  ctx: Context<
    QueryGetLostFoundItemArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    LostFoundItem
  >,
): LostFoundItem | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

/**
 * Request handler for Query.listLostFoundItems.
 */
export function listLostFoundItemsRequest(ctx: Context<QueryListLostFoundItemsArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HK_READ_ROLES);

  const limit = ctx.args.limit || 50;
  const nextToken = ctx.args.nextToken;

  if (ctx.args.status) {
    const q = {
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#LOSTFOUND` },
        GSI1SK: { beginsWith: `STATUS#${ctx.args.status}` },
      },
      index: "GSI1",
      limit,
    };
    return nextToken ? query({ ...q, nextToken }) : query(q);
  }

  const q = {
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "LOSTFOUND#" },
    },
    limit,
  };
  return nextToken ? query({ ...q, nextToken }) : query(q);
}

/**
 * Response handler for Query.listLostFoundItems.
 */
export function listLostFoundItemsResponse(
  ctx: Context<
    QueryListLostFoundItemsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: LostFoundItem[] }
  >,
): LostFoundItem[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Mutation.logLostFoundItem.
 */
export function logLostFoundItemRequest(ctx: Context<MutationLogLostFoundItemArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, LOSTFOUND_WRITE_ROLES);

  const { input } = ctx.args;
  const itemId =
    input.itemId && input.itemId.trim().length > 0
      ? input.itemId
      : `lf-${util.autoId().slice(0, 8)}`;

  const now = util.time.nowISO8601();
  const key = getLostFoundKey(tenantId, itemId);

  const item = {
    ...key,
    id: itemId,
    tenantId,
    entityType: "LostFoundItem",
    GSI1PK: `TENANT#${tenantId}#LOSTFOUND`,
    GSI1SK: `STATUS#LOGGED_IN_CUSTODY#${input.category}#${itemId}`,
    itemTitle: input.itemTitle,
    category: input.category,
    locationFound: input.locationFound,
    roomNumber: input.roomNumber ?? null,
    foundBy: input.foundBy,
    foundDateIso: input.foundDateIso ?? now,
    guestName: input.guestName ?? null,
    guestPhone: input.guestPhone ?? null,
    guestNicPassport: input.guestNicPassport ?? null,
    status: "LOGGED_IN_CUSTODY",
    estimatedValueLkr: input.estimatedValueLkr ?? 0,
    photoKey: input.photoKey ?? null,
    storageLockerNumber: input.storageLockerNumber,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.logLostFoundItem.
 */
export function logLostFoundItemResponse(
  ctx: Context<
    MutationLogLostFoundItemArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    LostFoundItem
  >,
): LostFoundItem {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.updateLostFoundStatus.
 */
export function updateLostFoundStatusRequest(ctx: Context<MutationUpdateLostFoundStatusArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, LOSTFOUND_WRITE_ROLES);

  const { itemId, input } = ctx.args;
  const key = getLostFoundKey(tenantId, itemId);
  const now = util.time.nowISO8601();

  const updateExpressions: Record<string, unknown> = {
    status: operations.replace(input.status),
    GSI1SK: operations.replace(`STATUS#${input.status}#${itemId}`),
    updatedAt: operations.replace(now),
  };

  if (input.guestName !== undefined && input.guestName !== null) {
    updateExpressions.guestName = operations.replace(input.guestName);
  }
  if (input.guestPhone !== undefined && input.guestPhone !== null) {
    updateExpressions.guestPhone = operations.replace(input.guestPhone);
  }
  if (input.guestNicPassport !== undefined && input.guestNicPassport !== null) {
    updateExpressions.guestNicPassport = operations.replace(input.guestNicPassport);
  }
  if (input.storageLockerNumber !== undefined && input.storageLockerNumber !== null) {
    updateExpressions.storageLockerNumber = operations.replace(input.storageLockerNumber);
  }
  if (input.notes !== undefined && input.notes !== null) {
    updateExpressions.notes = operations.replace(input.notes);
  }

  return update({
    key,
    update: updateExpressions,
  });
}

/**
 * Response handler for Mutation.updateLostFoundStatus.
 */
export function updateLostFoundStatusResponse(
  ctx: Context<
    MutationUpdateLostFoundStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    LostFoundItem
  >,
): LostFoundItem {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
