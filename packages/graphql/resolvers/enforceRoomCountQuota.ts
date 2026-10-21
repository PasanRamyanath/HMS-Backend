/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Tenant Room Count Quota Enforcement Resolver (`enforceRoomCountQuota.ts`)
 *
 * Enforces Rung 2 SaaS Subscription Room Quotas:
 * - STARTER_QR_ONLY: Maximum 15 physical rooms.
 * - GROWTH_PMS_PLUS_QR: Maximum 40 physical rooms.
 * - ENTERPRISE_RESORT_ERP: Unlimited rooms (up to 10,000).
 *
 * Prevents adding room #16 to a hotel tenant enrolled in STARTER_QR_ONLY.
 * Rejects with typed AppSync error:
 * Code: "QUOTA_EXCEEDED"
 * Message: "Room quota exceeded for plan {plan}. Maximum allowed is {max} rooms. Upgrade to GROWTH_PMS_PLUS_QR or ENTERPRISE_RESORT_ERP."
 */

import { util, type Context } from "@aws-appsync/utils";
import type { MutationUpsertRoomArgs } from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

export const PLAN_ROOM_LIMITS: Record<string, number> = {
  STARTER_QR_ONLY: 15,
  GROWTH_PMS_PLUS_QR: 40,
  ENTERPRISE_RESORT_ERP: 10000,
};

export const DEFAULT_PLAN_TIER = "STARTER_QR_ONLY";

export interface RoomQuotaEvaluation {
  readonly isAllowed: boolean;
  readonly planTier: string;
  readonly currentRoomCount: number;
  readonly roomLimit: number;
  readonly errorMessage?: string | undefined;
}

/**
 * Pure evaluation helper determining if a room creation would breach plan quota.
 */
export function evaluateRoomQuota(
  planTier: string,
  currentRoomCount: number,
  customMaxRooms?: number,
): RoomQuotaEvaluation {
  const normalizedTier = PLAN_ROOM_LIMITS[planTier] !== undefined ? planTier : DEFAULT_PLAN_TIER;
  const roomLimit = customMaxRooms ?? PLAN_ROOM_LIMITS[normalizedTier] ?? 15;

  if (currentRoomCount >= roomLimit) {
    return {
      isAllowed: false,
      planTier: normalizedTier,
      currentRoomCount,
      roomLimit,
      errorMessage: `Room quota exceeded for plan ${normalizedTier}. Maximum allowed is ${roomLimit} rooms. Upgrade to GROWTH_PMS_PLUS_QR or ENTERPRISE_RESORT_ERP.`,
    };
  }

  return {
    isAllowed: true,
    planTier: normalizedTier,
    currentRoomCount,
    roomLimit,
  };
}

/**
 * Request handler for AppSync pipeline step: Query current room count for tenant.
 */
export function enforceRoomCountQuotaRequest(ctx: Context<MutationUpsertRoomArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, ["SUPER_ADMIN", "HOTEL_OWNER", "GENERAL_MANAGER", "OPERATIONS_MANAGER"]);

  // Stash tenant and input details for response evaluation
  ctx.stash.validatedTenantId = validatedTenantId;
  ctx.stash.isUpdate = !!(input.id && input.id.trim().length > 0);

  // If updating an existing room, retrieve existing room item
  if (ctx.stash.isUpdate) {
    return {
      operation: "GetItem",
      key: util.dynamodb.toMapValues({
        PK: `TENANT#${validatedTenantId}`,
        SK: `ROOM#${input.id}`,
      }),
    };
  }

  // When creating a new room, query all rooms in the tenant partition using util.dynamodb
  return {
    operation: "Query",
    query: {
      expression: "PK = :pk and begins_with(SK, :skPrefix)",
      expressionValues: util.dynamodb.toMapValues({
        ":pk": `TENANT#${validatedTenantId}`,
        ":skPrefix": "ROOM#",
      }),
    },
    select: "COUNT",
  };
}

/**
 * Response handler for AppSync pipeline step: Check room quota and throw QUOTA_EXCEEDED if breached.
 */
export function enforceRoomCountQuotaResponse(
  ctx: Context<
    MutationUpsertRoomArgs,
    Record<string, unknown>,
    { validatedTenantId?: string; isUpdate?: boolean; planTier?: string; customMaxRooms?: number },
    Record<string, unknown>,
    { count?: number; items?: unknown[]; sc?: number }
  >,
) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  // Updating an existing room does not increase room count
  if (ctx.stash.isUpdate) {
    return true;
  }

  const currentCount = ctx.result?.count ?? ctx.result?.items?.length ?? 0;
  const planTier = typeof ctx.stash.planTier === "string" ? ctx.stash.planTier : DEFAULT_PLAN_TIER;
  const customLimit =
    typeof ctx.stash.customMaxRooms === "number" ? ctx.stash.customMaxRooms : undefined;

  const evaluation = evaluateRoomQuota(planTier, currentCount, customLimit);

  if (!evaluation.isAllowed) {
    util.error(
      evaluation.errorMessage ??
        `Room quota exceeded for plan ${evaluation.planTier}. Maximum allowed is ${evaluation.roomLimit} rooms. Upgrade to GROWTH_PMS_PLUS_QR or ENTERPRISE_RESORT_ERP.`,
      "QUOTA_EXCEEDED",
      {
        tenantId: ctx.stash.validatedTenantId,
        planTier: evaluation.planTier,
        currentRoomCount: evaluation.currentRoomCount,
        roomLimit: evaluation.roomLimit,
      },
    );
  }

  return true;
}
