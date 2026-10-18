/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * F&B Menu Catalog & Trilingual Dishes Resolver (menuCatalog.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.listMenuCatalog (Rung 4 single 1-RRU query returning categories + items)
 * - Query.listMenuCategories
 * - Query.listMenuItems
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
import { query } from "@aws-appsync/utils/dynamodb.js";
import type {
  MenuCategory,
  MenuItem,
  QueryListMenuCatalogArgs,
  QueryListMenuCategoriesArgs,
  QueryListMenuItemsArgs,
} from "../src/generated/types.js";
import { tenantGuard } from "./tenantGuard.js";

/**
 * Builds the canonical single-table DynamoDB primary key for a MenuCategory entity.
 */
export function getMenuCategoryKey(tenantId: string, categoryId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `CATEGORY#${categoryId}`,
  };
}

/**
 * Builds the canonical single-table DynamoDB primary key for a MenuItem entity.
 */
export function getMenuItemKey(tenantId: string, itemId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `ITEM#${itemId}`,
  };
}

/**
 * Request handler for Query.listMenuCatalog.
 * Queries GSI1 partition TENANT#${tenantId}#MENU in a single 1-RRU read
 * returning both MenuCategory and MenuItem items for the Contactless Guest QR PWA.
 */
export function listMenuCatalogRequest(ctx: Context<QueryListMenuCatalogArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  return query({
    index: "GSI1",
    query: {
      GSI1PK: { eq: `TENANT#${tenantId}#MENU` },
    },
  });
}

function isMenuItemRecord(record: Record<string, unknown>): boolean {
  if (record.entityType === "MenuItem") {
    return true;
  }
  const sk = typeof record.SK === "string" ? record.SK : "";
  return sk.indexOf("ITEM#") === 0;
}

function groupItemsByCategoryId(items: MenuItem[]): Record<string, MenuItem[]> {
  const grouped: Record<string, MenuItem[]> = {};
  for (const item of items) {
    const catId = item.categoryId;
    const list = grouped[catId];
    if (list) {
      list.push(item);
    } else {
      grouped[catId] = [item];
    }
  }
  return grouped;
}

function sortMenuItems(items: MenuItem[]): void {
  items.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

function partitionCatalogRecords(rawRecords: Array<Record<string, unknown>>): {
  categories: MenuCategory[];
  items: MenuItem[];
} {
  const categories: MenuCategory[] = [];
  const items: MenuItem[] = [];

  for (const record of rawRecords) {
    if (isMenuItemRecord(record)) {
      items.push(record as unknown as MenuItem);
    } else {
      categories.push(record as unknown as MenuCategory);
    }
  }

  return { categories, items };
}

/**
 * Response handler for Query.listMenuCatalog.
 * Combines MenuCategory and MenuItem entities into hierarchical categories
 * with nested items, sorted by displayOrder.
 */
export function listMenuCatalogResponse(
  ctx: Context<
    QueryListMenuCatalogArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: Array<Record<string, unknown>> }
  >,
): MenuCategory[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const rawRecords = ctx.result?.items ?? [];
  const { categories, items } = partitionCatalogRecords(rawRecords);
  const itemsByCat = groupItemsByCategoryId(items);

  categories.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  for (const cat of categories) {
    const catItems = itemsByCat[cat.id] ?? [];
    sortMenuItems(catItems);
    cat.items = catItems;
  }

  return categories;
}

/**
 * Request handler for Query.listMenuCategories.
 */
export function listMenuCategoriesRequest(ctx: Context<QueryListMenuCategoriesArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "CATEGORY#" },
    },
  });
}

/**
 * Response handler for Query.listMenuCategories.
 */
export function listMenuCategoriesResponse(
  ctx: Context<
    QueryListMenuCategoriesArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: MenuCategory[] }
  >,
): MenuCategory[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const categories = ctx.result?.items ?? [];
  categories.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  return categories;
}

/**
 * Request handler for Query.listMenuItems.
 */
export function listMenuItemsRequest(ctx: Context<QueryListMenuItemsArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  const categoryId = ctx.args.categoryId;

  if (categoryId && categoryId.trim().length > 0) {
    return query({
      index: "GSI1",
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#MENU` },
        GSI1SK: { beginsWith: `ITEM#${categoryId}#` },
      },
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "ITEM#" },
    },
  });
}

/**
 * Response handler for Query.listMenuItems.
 */
export function listMenuItemsResponse(
  ctx: Context<
    QueryListMenuItemsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: MenuItem[] }
  >,
): MenuItem[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const items = ctx.result?.items ?? [];
  sortMenuItems(items);
  return items;
}
