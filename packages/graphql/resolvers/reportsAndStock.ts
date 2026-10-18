/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Inventory Stock & Statutory Audit Reports Resolver (reportsAndStock.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.listStockItems (filtered optionally by department and category)
 * - Query.listSltdaMonthlyReports (filtered optionally by calendar year)
 * - Query.getSltdaMonthlyReturn (SLTDA statistical return by year/month)
 * - Query.getNightAuditReport (Night audit daily rollover report)
 *
 * Single-table DynamoDB mapping:
 * StockItem:
 *   PK = "TENANT#" + tenantId
 *   SK = "STOCK#" + stockItemId
 *   GSI1PK = "TENANT#" + tenantId + "#STOCK"
 *   GSI1SK = "DEPT#" + department + "#CAT#" + category + "#" + stockItemId
 *
 * SltdaMonthlyReturn:
 *   PK = "TENANT#" + tenantId
 *   SK = "AUDIT#SLTDA#" + year + "#" + month
 *   GSI1PK = "TENANT#" + tenantId + "#AUDITS"
 *   GSI1SK = "TYPE#SLTDA#YEAR#" + year + "#MONTH#" + month
 *
 * NightAuditReport:
 *   PK = "TENANT#" + tenantId
 *   SK = "AUDIT#NIGHT#" + auditDate
 *   GSI1PK = "TENANT#" + tenantId + "#AUDITS"
 *   GSI1SK = "TYPE#NIGHT#DATE#" + auditDate
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, query } from "@aws-appsync/utils/dynamodb.js";
import type {
  NightAuditReport,
  QueryGetNightAuditReportArgs,
  QueryGetSltdaMonthlyReturnArgs,
  QueryListSltdaMonthlyReportsArgs,
  QueryListStockItemsArgs,
  SltdaMonthlyReturn,
  StockItem,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

const INVENTORY_READ_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "EXECUTIVE_CHEF",
  "FNB_SUPERVISOR",
  "STORE_KEEPER",
  "POS_CASHIER",
] as const;

const AUDIT_READ_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FINANCE_CONTROLLER",
  "NIGHT_AUDITOR",
] as const;

/**
 * Builds the canonical single-table DynamoDB primary key for a StockItem entity.
 */
export function getStockItemKey(tenantId: string, stockItemId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `STOCK#${stockItemId}`,
  };
}

/**
 * Builds the canonical single-table DynamoDB primary key for an SLTDA Monthly Return entity.
 */
export function getSltdaReturnKey(tenantId: string, year: number, month: number) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `AUDIT#SLTDA#${year}#${month}`,
  };
}

/**
 * Builds the canonical single-table DynamoDB primary key for a Night Audit Report entity.
 */
export function getNightAuditReportKey(tenantId: string, auditDate: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `AUDIT#NIGHT#${auditDate}`,
  };
}

/**
 * Request handler for Query.listStockItems.
 * Queries inventory SKUs filtered by department and category.
 */
export function listStockItemsRequest(ctx: Context<QueryListStockItemsArgs>) {
  const { tenantId, department, category } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, INVENTORY_READ_ROLES);

  if (department && category) {
    return query({
      query: {
        GSI1PK: { eq: `TENANT#${validatedTenantId}#STOCK` },
        GSI1SK: { beginsWith: `DEPT#${department}#CAT#${category}` },
      },
      index: "GSI1",
    });
  }

  if (department) {
    return query({
      query: {
        GSI1PK: { eq: `TENANT#${validatedTenantId}#STOCK` },
        GSI1SK: { beginsWith: `DEPT#${department}` },
      },
      index: "GSI1",
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${validatedTenantId}` },
      SK: { beginsWith: "STOCK#" },
    },
  });
}

/**
 * Response handler for Query.listStockItems.
 */
export function listStockItemsResponse(
  ctx: Context<
    QueryListStockItemsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items: StockItem[] }
  >,
): StockItem[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Query.listSltdaMonthlyReports.
 * Queries SLTDA monthly statistical returns optionally filtered by calendar year.
 */
export function listSltdaMonthlyReportsRequest(ctx: Context<QueryListSltdaMonthlyReportsArgs>) {
  const { tenantId, year } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, AUDIT_READ_ROLES);

  if (year) {
    return query({
      query: {
        GSI1PK: { eq: `TENANT#${validatedTenantId}#AUDITS` },
        GSI1SK: { beginsWith: `TYPE#SLTDA#YEAR#${year}` },
      },
      index: "GSI1",
    });
  }

  return query({
    query: {
      GSI1PK: { eq: `TENANT#${validatedTenantId}#AUDITS` },
      GSI1SK: { beginsWith: "TYPE#SLTDA" },
    },
    index: "GSI1",
  });
}

/**
 * Response handler for Query.listSltdaMonthlyReports.
 */
export function listSltdaMonthlyReportsResponse(
  ctx: Context<
    QueryListSltdaMonthlyReportsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items: SltdaMonthlyReturn[] }
  >,
): SltdaMonthlyReturn[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Query.getSltdaMonthlyReturn.
 */
export function getSltdaMonthlyReturnRequest(ctx: Context<QueryGetSltdaMonthlyReturnArgs>) {
  const { tenantId, year, month } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, AUDIT_READ_ROLES);

  return get({
    key: getSltdaReturnKey(validatedTenantId, year, month),
  });
}

/**
 * Response handler for Query.getSltdaMonthlyReturn.
 */
export function getSltdaMonthlyReturnResponse(
  ctx: Context<
    QueryGetSltdaMonthlyReturnArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    SltdaMonthlyReturn | null
  >,
): SltdaMonthlyReturn | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Query.getNightAuditReport.
 */
export function getNightAuditReportRequest(ctx: Context<QueryGetNightAuditReportArgs>) {
  const { tenantId, auditDate } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, AUDIT_READ_ROLES);

  return get({
    key: getNightAuditReportKey(validatedTenantId, auditDate),
  });
}

/**
 * Response handler for Query.getNightAuditReport.
 */
export function getNightAuditReportResponse(
  ctx: Context<
    QueryGetNightAuditReportArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    NightAuditReport | null
  >,
): NightAuditReport | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
