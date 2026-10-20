/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Store Inventory, Procurement & FIFO Voucher Operations (inventoryOps.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.getStockItem
 * - Query.getPurchaseOrder
 * - Query.listPurchaseOrders
 * - Query.getInventoryVoucher
 * - Query.listInventoryVouchers
 * - Mutation.upsertStockItem
 * - Mutation.recordGrn
 * - Mutation.createGoodsIssueNote
 *
 * Single-table DynamoDB mapping:
 * StockItem:
 *   PK: "TENANT#" + tenantId
 *   SK: "STOCK#" + stockItemId
 *   GSI1PK: "TENANT#" + tenantId + "#STOCK"
 *   GSI1SK: "DEPT#" + department + "#CAT#" + category + "#" + stockItemId
 *
 * PurchaseOrder:
 *   PK: "TENANT#" + tenantId
 *   SK: "PO#" + purchaseOrderId
 *   GSI1PK: "TENANT#" + tenantId + "#PO"
 *   GSI1SK: "STATUS#" + status + "#DATE#" + orderDate + "#" + purchaseOrderId
 *
 * InventoryVoucher:
 *   PK: "TENANT#" + tenantId
 *   SK: "VOUCHER#" + voucherId
 *   GSI1PK: "TENANT#" + tenantId + "#VOUCHERS"
 *   GSI1SK: "TYPE#" + voucherType + "#DATE#" + voucherDate + "#" + voucherId
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, put, query } from "@aws-appsync/utils/dynamodb.js";
import type {
  InventoryVoucher,
  MutationCreateGoodsIssueNoteArgs,
  MutationRecordGrnArgs,
  MutationUpsertStockItemArgs,
  PurchaseOrder,
  QueryGetInventoryVoucherArgs,
  QueryGetPurchaseOrderArgs,
  QueryGetStockItemArgs,
  QueryListInventoryVouchersArgs,
  QueryListPurchaseOrdersArgs,
  StockItem,
} from "../src/generated/types.js";
import { getStockItemKey } from "./reportsAndStock.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

// ============================================================================
// Authorized Role Constants (RolePermissionMatrix RBAC)
// ============================================================================

export const INVENTORY_READ_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FINANCE_CONTROLLER",
  "EXECUTIVE_CHEF",
  "FNB_SUPERVISOR",
  "STORE_KEEPER",
  "POS_CASHIER",
  "MAINTENANCE",
] as const;

export const INVENTORY_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FINANCE_CONTROLLER",
  "STORE_KEEPER",
  "EXECUTIVE_CHEF",
  "FNB_SUPERVISOR",
] as const;

// ============================================================================
// Canonical Single-Table DynamoDB Key Builders
// ============================================================================

export function getPurchaseOrderKey(tenantId: string, purchaseOrderId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `PO#${purchaseOrderId}`,
  };
}

export function getInventoryVoucherKey(tenantId: string, voucherId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `VOUCHER#${voucherId}`,
  };
}

// ============================================================================
// StockItem Operations (Query.getStockItem, Mutation.upsertStockItem)
// ============================================================================

/**
 * Request handler for Query.getStockItem.
 */
export function getStockItemRequest(ctx: Context<QueryGetStockItemArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_READ_ROLES);

  return get({
    key: getStockItemKey(tenantId, ctx.args.id),
  });
}

/**
 * Response handler for Query.getStockItem.
 */
export function getStockItemResponse(
  ctx: Context<
    QueryGetStockItemArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    StockItem
  >,
): StockItem | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

/**
 * Request handler for Mutation.upsertStockItem.
 */
export function upsertStockItemRequest(ctx: Context<MutationUpsertStockItemArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_WRITE_ROLES);

  const { input } = ctx.args;
  const id = input.id && input.id.trim().length > 0 ? input.id : `sku-${util.autoId().slice(0, 8)}`;

  const now = util.time.nowISO8601();
  const key = getStockItemKey(tenantId, id);

  const item = {
    ...key,
    id,
    tenantId,
    entityType: "StockItem",
    GSI1PK: `TENANT#${tenantId}#STOCK`,
    GSI1SK: `DEPT#${input.department}#CAT#${input.category}#${id}`,
    sku: input.sku,
    name: input.name,
    category: input.category,
    department: input.department,
    unitOfMeasure: input.unitOfMeasure,
    parLevel: input.parLevel,
    reorderQuantity: input.reorderQuantity,
    currentStock: 0,
    fifoCostPerUnitLkr: 0,
    totalValueLkr: 0,
    batches: [],
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.upsertStockItem.
 */
export function upsertStockItemResponse(
  ctx: Context<
    MutationUpsertStockItemArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    StockItem
  >,
): StockItem {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// PurchaseOrder Operations (Query.getPurchaseOrder, Query.listPurchaseOrders)
// ============================================================================

/**
 * Request handler for Query.getPurchaseOrder.
 */
export function getPurchaseOrderRequest(ctx: Context<QueryGetPurchaseOrderArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_READ_ROLES);

  return get({
    key: getPurchaseOrderKey(tenantId, ctx.args.id),
  });
}

/**
 * Response handler for Query.getPurchaseOrder.
 */
export function getPurchaseOrderResponse(
  ctx: Context<
    QueryGetPurchaseOrderArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    PurchaseOrder
  >,
): PurchaseOrder | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

/**
 * Request handler for Query.listPurchaseOrders.
 */
export function listPurchaseOrdersRequest(ctx: Context<QueryListPurchaseOrdersArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_READ_ROLES);

  if (ctx.args.status) {
    return query({
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#PO` },
        GSI1SK: { beginsWith: `STATUS#${ctx.args.status}` },
      },
      index: "GSI1",
      limit: 100,
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "PO#" },
    },
    limit: 100,
  });
}

/**
 * Response handler for Query.listPurchaseOrders.
 */
export function listPurchaseOrdersResponse(
  ctx: Context<
    QueryListPurchaseOrdersArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: PurchaseOrder[] }
  >,
): PurchaseOrder[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

// ============================================================================
// InventoryVoucher Operations (GRN, GIN, PR, Adjustments)
// ============================================================================

/**
 * Request handler for Query.getInventoryVoucher.
 */
export function getInventoryVoucherRequest(ctx: Context<QueryGetInventoryVoucherArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_READ_ROLES);

  return get({
    key: getInventoryVoucherKey(tenantId, ctx.args.id),
  });
}

/**
 * Response handler for Query.getInventoryVoucher.
 */
export function getInventoryVoucherResponse(
  ctx: Context<
    QueryGetInventoryVoucherArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    InventoryVoucher
  >,
): InventoryVoucher | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

/**
 * Request handler for Query.listInventoryVouchers.
 */
export function listInventoryVouchersRequest(ctx: Context<QueryListInventoryVouchersArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_READ_ROLES);

  if (ctx.args.voucherType) {
    return query({
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#VOUCHERS` },
        GSI1SK: { beginsWith: `TYPE#${ctx.args.voucherType}` },
      },
      index: "GSI1",
      limit: 100,
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "VOUCHER#" },
    },
    limit: 100,
  });
}

/**
 * Response handler for Query.listInventoryVouchers.
 */
export function listInventoryVouchersResponse(
  ctx: Context<
    QueryListInventoryVouchersArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: InventoryVoucher[] }
  >,
): InventoryVoucher[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Mutation.recordGrn (Goods Received Note).
 */
export function recordGrnRequest(ctx: Context<MutationRecordGrnArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_WRITE_ROLES);

  const { input } = ctx.args;
  const voucherId = `grn-${util.autoId().slice(0, 8)}`;
  const now = util.time.nowISO8601();
  const dateStr = input.grnDate || now.slice(0, 10);
  const voucherNumber = `GRN-${dateStr.replace(/-/g, "")}-${util.autoId().slice(0, 4).toUpperCase()}`;

  let totalValueLkr = 0;
  const voucherItems = [];

  for (const it of input.items) {
    const lineTotal =
      Math.round((it.quantityReceived * it.unitCostLkr + Number.EPSILON) * 100) / 100;
    totalValueLkr += lineTotal;
    voucherItems.push({
      stockItemId: it.stockItemId,
      stockItemSku: it.stockItemId,
      stockItemName: it.stockItemId,
      quantity: it.quantityReceived,
      unitOfMeasure: "units",
      unitCostLkr: it.unitCostLkr,
      totalCostLkr: lineTotal,
    });
  }

  totalValueLkr = Math.round((totalValueLkr + Number.EPSILON) * 100) / 100;

  const identity = ctx.identity as Record<string, unknown> | undefined;
  const authorizedByUserId =
    (identity?.sub as string) || (identity?.username as string) || "SYSTEM_STORE";

  const key = getInventoryVoucherKey(tenantId, voucherId);
  const item = {
    ...key,
    id: voucherId,
    tenantId,
    entityType: "InventoryVoucher",
    voucherNumber,
    voucherType: "GRN_GOODS_RECEIVED_NOTE",
    voucherDate: dateStr,
    department: input.department,
    sourceLocation: "Receiving Bay / Supplier",
    destinationLocation: "Main Central Store",
    supplierName: input.supplierName,
    poNumber: input.poNumber ?? null,
    items: voucherItems,
    totalValueLkr,
    authorizedByUserId,
    remarks: input.remarks ?? null,
    GSI1PK: `TENANT#${tenantId}#VOUCHERS`,
    GSI1SK: `TYPE#GRN_GOODS_RECEIVED_NOTE#DATE#${dateStr}#${voucherId}`,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.recordGrn.
 */
export function recordGrnResponse(
  ctx: Context<
    MutationRecordGrnArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    InventoryVoucher
  >,
): InventoryVoucher {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.createGoodsIssueNote (Goods Issue Note).
 */
export function createGoodsIssueNoteRequest(ctx: Context<MutationCreateGoodsIssueNoteArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, INVENTORY_WRITE_ROLES);

  const { input } = ctx.args;
  const voucherId = `gin-${util.autoId().slice(0, 8)}`;
  const now = util.time.nowISO8601();
  const dateStr = input.issueDate || now.slice(0, 10);
  const voucherNumber = `GIN-${dateStr.replace(/-/g, "")}-${util.autoId().slice(0, 4).toUpperCase()}`;

  const voucherItems = [];
  for (const it of input.items) {
    voucherItems.push({
      stockItemId: it.stockItemId,
      stockItemSku: it.stockItemId,
      stockItemName: it.stockItemId,
      quantity: it.quantityIssued,
      unitOfMeasure: "units",
      unitCostLkr: 0,
      totalCostLkr: 0,
    });
  }

  const identity = ctx.identity as Record<string, unknown> | undefined;
  const authorizedByUserId =
    (identity?.sub as string) || (identity?.username as string) || "SYSTEM_STORE";

  const key = getInventoryVoucherKey(tenantId, voucherId);
  const item = {
    ...key,
    id: voucherId,
    tenantId,
    entityType: "InventoryVoucher",
    voucherNumber,
    voucherType: "GIN_GOODS_ISSUE_NOTE",
    voucherDate: dateStr,
    department: input.destinationDepartment,
    sourceLocation: input.sourceLocation,
    destinationLocation: input.destinationLocation,
    supplierName: null,
    poNumber: null,
    items: voucherItems,
    totalValueLkr: 0,
    authorizedByUserId,
    remarks: input.remarks ?? null,
    GSI1PK: `TENANT#${tenantId}#VOUCHERS`,
    GSI1SK: `TYPE#GIN_GOODS_ISSUE_NOTE#DATE#${dateStr}#${voucherId}`,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.createGoodsIssueNote.
 */
export function createGoodsIssueNoteResponse(
  ctx: Context<
    MutationCreateGoodsIssueNoteArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    InventoryVoucher
  >,
): InventoryVoucher {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
