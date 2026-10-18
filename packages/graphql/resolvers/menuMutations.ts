/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * F&B Menu Mutations Resolver (menuMutations.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Mutation.upsertMenuItem
 * - Mutation.toggleMenuItemAvailability
 * - Mutation.toggleMenuItemStock (Rung 4 1-tap instant inStock toggle <20ms)
 * - Mutation.upsertMenuCategory
 *
 * Single-table DynamoDB mapping:
 * MenuCategory:
 *   PK = "TENANT#" + tenantId
 *   SK = "CATEGORY#" + categoryId
 *   GSI1PK = "TENANT#" + tenantId + "#MENU"
 *   GSI1SK = "CATEGORY#" + displayOrder + "#" + categoryId
 *
 * MenuItem:
 *   PK = "TENANT#" + tenantId
 *   SK = "ITEM#" + itemId
 *   GSI1PK = "TENANT#" + tenantId + "#MENU"
 *   GSI1SK = "ITEM#" + categoryId + "#" + displayOrder + "#" + itemId
 */

import { util, type Context } from "@aws-appsync/utils";
import { operations, put, update } from "@aws-appsync/utils/dynamodb.js";
import type {
  MenuCategory,
  MenuItem,
  MutationToggleMenuItemAvailabilityArgs,
  MutationToggleMenuItemStockArgs,
  MutationUpsertMenuCategoryArgs,
  MutationUpsertMenuItemArgs,
} from "../src/generated/types.js";
import { getMenuCategoryKey, getMenuItemKey } from "./menuCatalog.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

const CHEF_ADMIN_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "EXECUTIVE_CHEF",
  "FNB_SUPERVISOR",
  "POS_CASHIER",
] as const;

const STOCK_TOGGLE_ROLES = [
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
 * Request handler for Mutation.upsertMenuItem.
 * Creates or updates a dish/beverage item in the tenant menu partition.
 */
export function upsertMenuItemRequest(ctx: Context<MutationUpsertMenuItemArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, CHEF_ADMIN_ROLES);

  const itemId = input.id && input.id.trim().length > 0 ? input.id : util.autoId();
  const now = util.time.nowISO8601();
  const key = getMenuItemKey(validatedTenantId, itemId);

  const item = {
    ...key,
    ...input,
    id: itemId,
    tenantId: validatedTenantId,
    entityType: "MenuItem",
    GSI1PK: `TENANT#${validatedTenantId}#MENU`,
    GSI1SK: `ITEM#${input.categoryId}#${input.displayOrder}#${itemId}`,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.upsertMenuItem.
 */
export function upsertMenuItemResponse(
  ctx: Context<
    MutationUpsertMenuItemArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MenuItem
  >,
): MenuItem {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.toggleMenuItemAvailability.
 */
export function toggleMenuItemAvailabilityRequest(
  ctx: Context<MutationToggleMenuItemAvailabilityArgs>,
) {
  const { tenantId, id, isAvailable } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, STOCK_TOGGLE_ROLES);

  const now = util.time.nowISO8601();
  const key = getMenuItemKey(validatedTenantId, id);

  return update({
    key,
    update: {
      isAvailable: operations.replace(isAvailable),
      updatedAt: operations.replace(now),
    },
  });
}

/**
 * Response handler for Mutation.toggleMenuItemAvailability.
 */
export function toggleMenuItemAvailabilityResponse(
  ctx: Context<
    MutationToggleMenuItemAvailabilityArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MenuItem
  >,
): MenuItem {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.toggleMenuItemStock.
 * Rung 4: 1-tap instant inStock toggle for Kitchen KDS / Chef screen (<20ms).
 */
export function toggleMenuItemStockRequest(ctx: Context<MutationToggleMenuItemStockArgs>) {
  const { tenantId, id, inStock } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, STOCK_TOGGLE_ROLES);

  const now = util.time.nowISO8601();
  const key = getMenuItemKey(validatedTenantId, id);

  return update({
    key,
    update: {
      isAvailable: operations.replace(inStock),
      updatedAt: operations.replace(now),
    },
  });
}

/**
 * Response handler for Mutation.toggleMenuItemStock.
 */
export function toggleMenuItemStockResponse(
  ctx: Context<
    MutationToggleMenuItemStockArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MenuItem
  >,
): MenuItem {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.upsertMenuCategory.
 */
export function upsertMenuCategoryRequest(ctx: Context<MutationUpsertMenuCategoryArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, CHEF_ADMIN_ROLES);

  const categoryId = input.id && input.id.trim().length > 0 ? input.id : util.autoId();
  const now = util.time.nowISO8601();
  const key = getMenuCategoryKey(validatedTenantId, categoryId);

  const item = {
    ...key,
    ...input,
    id: categoryId,
    tenantId: validatedTenantId,
    entityType: "MenuCategory",
    GSI1PK: `TENANT#${validatedTenantId}#MENU`,
    GSI1SK: `CATEGORY#${input.displayOrder}#${categoryId}`,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.upsertMenuCategory.
 */
export function upsertMenuCategoryResponse(
  ctx: Context<
    MutationUpsertMenuCategoryArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MenuCategory
  >,
): MenuCategory {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
