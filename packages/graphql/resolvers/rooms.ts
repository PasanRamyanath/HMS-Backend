/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Physical Rooms & Housekeeping Resolver (rooms.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.listRooms
 * - Query.getRoom
 * - Mutation.updateRoomHousekeepingStatus
 * - Mutation.upsertRoom
 *
 * Single-table DynamoDB mapping:
 * PK = "TENANT#" + tenantId
 * SK = "ROOM#" + roomId
 * GSI1PK = "TENANT#" + tenantId + "#ROOMS"
 * GSI1SK = "STATUS#" + housekeepingStatus + "#" + roomNumber
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, operations, put, query, update } from "@aws-appsync/utils/dynamodb.js";
import type {
  MutationUpdateRoomHousekeepingStatusArgs,
  MutationUpsertRoomArgs,
  QueryGetRoomArgs,
  QueryListRoomsArgs,
  Room,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

/**
 * Builds the canonical single-table DynamoDB primary key for a Room entity.
 */
export function getRoomKey(tenantId: string, roomId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `ROOM#${roomId}`,
  };
}

/**
 * Request handler for Query.listRooms.
 * Queries all physical rooms belonging to the tenant partition.
 */
export function listRoomsRequest(ctx: Context<QueryListRoomsArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "ROOM#" },
    },
  });
}

/**
 * Response handler for Query.listRooms.
 */
export function listRoomsResponse(
  ctx: Context<
    QueryListRoomsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: Room[] }
  >,
): Room[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Query.getRoom.
 */
export function getRoomRequest(ctx: Context<QueryGetRoomArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  return get({
    key: getRoomKey(tenantId, ctx.args.id),
  });
}

/**
 * Response handler for Query.getRoom.
 */
export function getRoomResponse(
  ctx: Context<
    QueryGetRoomArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Room
  >,
): Room | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

/**
 * Request handler for Mutation.updateRoomHousekeepingStatus.
 * Updates the room cleanliness status and triggers onRoomStatusChanged subscriptions.
 */
export function updateRoomHousekeepingStatusRequest(
  ctx: Context<MutationUpdateRoomHousekeepingStatusArgs>,
) {
  const { tenantId, roomId, status } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, [
    "SUPER_ADMIN",
    "HOTEL_OWNER",
    "GENERAL_MANAGER",
    "OPERATIONS_MANAGER",
    "HOUSEKEEPING_SUPERVISOR",
    "HOUSEKEEPING_STAFF",
    "MAINTENANCE",
  ]);

  const now = util.time.nowISO8601();
  const key = getRoomKey(validatedTenantId, roomId);

  return update({
    key,
    update: {
      housekeepingStatus: operations.replace(status),
      GSI1SK: operations.replace(`STATUS#${status}`),
      updatedAt: operations.replace(now),
    },
  });
}

/**
 * Response handler for Mutation.updateRoomHousekeepingStatus.
 */
export function updateRoomHousekeepingStatusResponse(
  ctx: Context<
    MutationUpdateRoomHousekeepingStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Room
  >,
): Room {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.upsertRoom.
 */
export function upsertRoomRequest(ctx: Context<MutationUpsertRoomArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, ["SUPER_ADMIN", "HOTEL_OWNER", "GENERAL_MANAGER", "OPERATIONS_MANAGER"]);

  const roomId = input.id && input.id.trim().length > 0 ? input.id : util.autoId();
  const now = util.time.nowISO8601();
  const key = getRoomKey(validatedTenantId, roomId);

  const item = {
    ...key,
    ...input,
    id: roomId,
    tenantId: validatedTenantId,
    entityType: "Room",
    GSI1PK: `TENANT#${validatedTenantId}#ROOMS`,
    GSI1SK: `STATUS#${input.housekeepingStatus}#${input.roomNumber}`,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.upsertRoom.
 */
export function upsertRoomResponse(
  ctx: Context<
    MutationUpsertRoomArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Room
  >,
): Room {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
