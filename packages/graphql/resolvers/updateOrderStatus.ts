/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Kitchen Display System (KDS) Order Status Transition Resolver (updateOrderStatus.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Mutation.updateOrderStatus
 * - Mutation.updateServiceOrderStatus (Real-Time KDS Transition)
 *
 * Triggers onOrderUpdated WebSocket subscription to Guest QR & KDS runner screens.
 *
 * Single-table DynamoDB mapping:
 * ServiceOrder:
 *   PK = "TENANT#" + tenantId
 *   SK = "ORDER#" + orderId
 *   GSI1PK = "TENANT#" + tenantId + "#KDS#" + department
 *   GSI1SK = "STATUS#" + status + "#" + now
 */

import { util, type Context } from "@aws-appsync/utils";
import { operations, update } from "@aws-appsync/utils/dynamodb.js";
import type {
  MutationUpdateOrderStatusArgs,
  MutationUpdateServiceOrderStatusArgs,
  OrderStatus,
  ServiceOrder,
  UpdateOrderStatusInput,
} from "../src/generated/types.js";
import { getServiceOrderKey } from "./kdsOrders.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

const KDS_UPDATE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "EXECUTIVE_CHEF",
  "FNB_SUPERVISOR",
  "WAITER",
  "POS_CASHIER",
] as const;

function applyStatusTimestamp(
  updateActions: Record<string, unknown>,
  status: OrderStatus,
  now: string,
): void {
  if (status === "ACKNOWLEDGED") {
    updateActions.kitchenAcknowledgedAt = operations.replace(now);
  } else if (status === "READY_FOR_PICKUP") {
    updateActions.readyForPickupAt = operations.replace(now);
  } else if (status === "DELIVERED") {
    updateActions.deliveredAt = operations.replace(now);
  }
}

function buildStatusUpdateOperation(tenantId: string, input: UpdateOrderStatusInput) {
  const now = util.time.nowISO8601();
  const key = getServiceOrderKey(tenantId, input.orderId);

  const updateActions: Record<string, unknown> = {
    status: operations.replace(input.status),
    GSI1SK: operations.replace(`STATUS#${input.status}#${now}`),
    updatedAt: operations.replace(now),
  };

  applyStatusTimestamp(updateActions, input.status, now);

  if (input.cancelReason && input.cancelReason.trim().length > 0) {
    updateActions.cancelReason = operations.replace(input.cancelReason);
  }

  return update({
    key,
    update: updateActions,
  });
}

/**
 * Request handler for Mutation.updateOrderStatus.
 * Updates order status on KDS and stamps milestone timestamps.
 */
export function updateOrderStatusRequest(ctx: Context<MutationUpdateOrderStatusArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, KDS_UPDATE_ROLES);

  return buildStatusUpdateOperation(validatedTenantId, input);
}

/**
 * Response handler for Mutation.updateOrderStatus.
 */
export function updateOrderStatusResponse(
  ctx: Context<
    MutationUpdateOrderStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    ServiceOrder
  >,
): ServiceOrder {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.updateServiceOrderStatus.
 * Real-time KDS transition mutation alias triggering onOrderUpdated subscription.
 */
export function updateServiceOrderStatusRequest(
  ctx: Context<MutationUpdateServiceOrderStatusArgs>,
) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, KDS_UPDATE_ROLES);

  return buildStatusUpdateOperation(validatedTenantId, input);
}

/**
 * Response handler for Mutation.updateServiceOrderStatus.
 */
export function updateServiceOrderStatusResponse(
  ctx: Context<
    MutationUpdateServiceOrderStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    ServiceOrder
  >,
): ServiceOrder {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
