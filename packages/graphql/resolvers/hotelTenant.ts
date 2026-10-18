/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Hotel Tenant Resolver (hotelTenant.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.getHotelTenant
 * - Mutation.upsertHotelTenant
 *
 * Single-table DynamoDB mapping:
 * PK = "TENANT#" + tenantId
 * SK = "METADATA"
 * GSI1PK = "ENTITY#HotelTenant"
 * GSI1SK = "TENANT#" + tenantId
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, put } from "@aws-appsync/utils/dynamodb.js";
import type {
  HotelTenant,
  MutationUpsertHotelTenantArgs,
  QueryGetHotelTenantArgs,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

/**
 * Builds the canonical single-table DynamoDB primary key for a HotelTenant entity.
 */
export function getHotelTenantKey(tenantId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: "METADATA",
  };
}

/**
 * Request handler for Query.getHotelTenant.
 * Enforces tenant isolation guard and generates a direct DynamoDB GetItem request.
 */
export function getHotelTenantRequest(ctx: Context<QueryGetHotelTenantArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  return get({
    key: getHotelTenantKey(tenantId),
  });
}

/**
 * Response handler for Query.getHotelTenant.
 */
export function getHotelTenantResponse(
  ctx: Context<
    QueryGetHotelTenantArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    HotelTenant
  >,
): HotelTenant | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

/**
 * Request handler for Mutation.upsertHotelTenant.
 * Enforces RBAC permissions and provisions/updates hotel metadata directly in DynamoDB.
 */
export function upsertHotelTenantRequest(ctx: Context<MutationUpsertHotelTenantArgs>) {
  const { input } = ctx.args;
  let tenantId: string;

  if (input.id && input.id.trim().length > 0) {
    // Updating existing tenant property — requires tenant membership
    tenantId = tenantGuard(ctx, input.id);
    requireUserRole(ctx, ["SUPER_ADMIN", "HOTEL_OWNER", "GENERAL_MANAGER"]);
  } else {
    // Provisioning a brand-new tenant on the SaaS platform — strictly SuperAdmin
    requireUserRole(ctx, ["SUPER_ADMIN"]);
    tenantId = util.autoId();
  }

  const now = util.time.nowISO8601();

  const key = getHotelTenantKey(tenantId);
  const item = {
    ...key,
    ...input,
    id: tenantId,
    tenantId,
    entityType: "HotelTenant",
    GSI1PK: "ENTITY#HotelTenant",
    GSI1SK: `TENANT#${tenantId}`,
    currency: "LKR",
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.upsertHotelTenant.
 */
export function upsertHotelTenantResponse(
  ctx: Context<
    MutationUpsertHotelTenantArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    HotelTenant
  >,
): HotelTenant {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
