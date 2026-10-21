/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Kitchen Display System (KDS) & Bar Active Orders Resolver (kdsOrders.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.listActiveOrdersByDepartment (Rung 4 KDS Kanban query via GSI1)
 * - Query.listActiveServiceOrders
 * - Query.getServiceOrder
 *
 * Single-table DynamoDB mapping:
 * ServiceOrder:
 *   PK = "TENANT#" + tenantId
 *   SK = "ORDER#" + orderId
 *   GSI1PK = "TENANT#" + tenantId + "#KDS#" + department
 *   GSI1SK = "STATUS#" + status + "#" + createdAt
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, query } from "@aws-appsync/utils/dynamodb.js";
import type {
  OrderStatus,
  QueryGetServiceOrderArgs,
  QueryListActiveOrdersByDepartmentArgs,
  QueryListActiveServiceOrdersArgs,
  ServiceOrder,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

const KDS_STAFF_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "EXECUTIVE_CHEF",
  "FNB_SUPERVISOR",
  "WAITER",
  "POS_CASHIER",
] as const;

/**
 * Builds the canonical single-table DynamoDB primary key for a ServiceOrder entity.
 */
export function getServiceOrderKey(tenantId: string, orderId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `ORDER#${orderId}`,
  };
}

/**
 * Checks whether an order lifecycle status represents an active kitchen ticket.
 */
export function isActiveOrderStatus(status: OrderStatus): boolean {
  return status !== "DELIVERED" && status !== "CANCELLED";
}

/**
 * Request handler for Query.listActiveOrdersByDepartment.
 * Queries GSI1 partition TENANT#${tenantId}#KDS#${department} for real-time
 * kitchen display system kanban columns.
 */
export function listActiveOrdersByDepartmentRequest(
  ctx: Context<QueryListActiveOrdersByDepartmentArgs>,
) {
  const { tenantId, department } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, KDS_STAFF_ROLES);

  return query({
    index: "GSI1",
    query: {
      GSI1PK: { eq: `TENANT#${validatedTenantId}#KDS#${department}` },
    },
  });
}

/**
 * Response handler for Query.listActiveOrdersByDepartment.
 * Filters out terminal orders (DELIVERED, CANCELLED) and returns active orders.
 */
export function listActiveOrdersByDepartmentResponse(
  ctx: Context<
    QueryListActiveOrdersByDepartmentArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: ServiceOrder[] }
  >,
): ServiceOrder[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const rawOrders = ctx.result?.items ?? [];
  const activeOrders: ServiceOrder[] = [];
  for (const order of rawOrders) {
    if (isActiveOrderStatus(order.status)) {
      activeOrders.push(order);
    }
  }
  return activeOrders;
}

/**
 * Request handler for Query.listActiveServiceOrders.
 */
export function listActiveServiceOrdersRequest(ctx: Context<QueryListActiveServiceOrdersArgs>) {
  const { tenantId, department } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, KDS_STAFF_ROLES);

  if (department) {
    return query({
      index: "GSI1",
      query: {
        GSI1PK: { eq: `TENANT#${validatedTenantId}#KDS#${department}` },
      },
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${validatedTenantId}` },
      SK: { beginsWith: "ORDER#" },
    },
  });
}

/**
 * Response handler for Query.listActiveServiceOrders.
 */
export function listActiveServiceOrdersResponse(
  ctx: Context<
    QueryListActiveServiceOrdersArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: ServiceOrder[] }
  >,
): ServiceOrder[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const rawOrders = ctx.result?.items ?? [];
  const diningTypeFilter = ctx.args.diningType;
  const filteredOrders: ServiceOrder[] = [];

  for (const order of rawOrders) {
    if (isActiveOrderStatus(order.status)) {
      if (!diningTypeFilter || order.diningType === diningTypeFilter) {
        filteredOrders.push(order);
      }
    }
  }

  return filteredOrders;
}

/**
 * Request handler for Query.getServiceOrder.
 */
export function getServiceOrderRequest(ctx: Context<QueryGetServiceOrderArgs>) {
  const { tenantId, id } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  return get({
    key: getServiceOrderKey(validatedTenantId, id),
  });
}

/**
 * Response handler for Query.getServiceOrder.
 */
export function getServiceOrderResponse(
  ctx: Context<
    QueryGetServiceOrderArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    ServiceOrder
  >,
): ServiceOrder | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}
