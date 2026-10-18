/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Guest & DMC Folio Query Resolver (folioQuery.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.getFolioWithLines (Rung 4 single-query fetch returning master folio + all line items)
 * - Query.getFolio
 * - Query.listFoliosForReservation
 *
 * Single-table DynamoDB mapping:
 * Folio Master:
 *   PK = "TENANT#" + tenantId
 *   SK = "FOLIO#" + folioId
 *   GSI1PK = "TENANT#" + tenantId + "#RES#" + reservationId
 *   GSI1SK = "FOLIO#" + folioId
 *
 * Folio Line Item:
 *   PK = "TENANT#" + tenantId
 *   SK = "FOLIO#" + folioId + "#LINE#" + lineId
 */

import { util, type Context } from "@aws-appsync/utils";
import { query } from "@aws-appsync/utils/dynamodb.js";
import type {
  Folio,
  FolioLineItem,
  QueryGetFolioArgs,
  QueryGetFolioWithLinesArgs,
  QueryListFoliosForReservationArgs,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

const FOLIO_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FRONT_DESK_SUPERVISOR",
  "FRONT_DESK_AGENT",
  "RESERVATION_AGENT",
  "NIGHT_AUDITOR",
  "POS_CASHIER",
] as const;

/**
 * Builds the canonical single-table DynamoDB primary key for a Folio entity.
 */
export function getFolioKey(tenantId: string, folioId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `FOLIO#${folioId}`,
  };
}

/**
 * Builds the canonical single-table DynamoDB primary key for a FolioLineItem entity.
 */
export function getFolioLineKey(tenantId: string, folioId: string, lineId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `FOLIO#${folioId}#LINE#${lineId}`,
  };
}

function isFolioLineItem(record: Record<string, unknown>, folioId: string): boolean {
  if (record.entityType === "FolioLineItem") {
    return true;
  }
  const sk = typeof record.SK === "string" ? record.SK : "";
  return sk.indexOf(`FOLIO#${folioId}#LINE#`) === 0;
}

function assembleFolioWithLines(
  rawRecords: Array<Record<string, unknown>>,
  folioId: string,
): Folio | null {
  let masterRecord: Folio | null = null;
  const lineItems: FolioLineItem[] = [];

  for (const record of rawRecords) {
    if (isFolioLineItem(record, folioId)) {
      lineItems.push(record as unknown as FolioLineItem);
    } else {
      masterRecord = record as unknown as Folio;
    }
  }

  if (!masterRecord) {
    return null;
  }

  masterRecord.lineItems = lineItems;
  return masterRecord;
}

/**
 * Request handler for Query.getFolioWithLines.
 * Queries PK = TENANT#${tenantId} and SK begins_with FOLIO#${folioId}
 * returning both the master folio item and all line items in one DynamoDB read.
 */
export function getFolioWithLinesRequest(ctx: Context<QueryGetFolioWithLinesArgs>) {
  const { tenantId, folioId } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, FOLIO_ROLES);

  return query({
    query: {
      PK: { eq: `TENANT#${validatedTenantId}` },
      SK: { beginsWith: `FOLIO#${folioId}` },
    },
  });
}

/**
 * Response handler for Query.getFolioWithLines.
 * Assembles the master folio record and nested line items.
 */
export function getFolioWithLinesResponse(
  ctx: Context<
    QueryGetFolioWithLinesArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: Array<Record<string, unknown>> }
  >,
): Folio | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const rawRecords = ctx.result?.items ?? [];
  return assembleFolioWithLines(rawRecords, ctx.args.folioId);
}

/**
 * Request handler for Query.getFolio.
 */
export function getFolioRequest(ctx: Context<QueryGetFolioArgs>) {
  const { tenantId, id } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, FOLIO_ROLES);

  return query({
    query: {
      PK: { eq: `TENANT#${validatedTenantId}` },
      SK: { beginsWith: `FOLIO#${id}` },
    },
  });
}

/**
 * Response handler for Query.getFolio.
 */
export function getFolioResponse(
  ctx: Context<
    QueryGetFolioArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: Array<Record<string, unknown>> }
  >,
): Folio | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const rawRecords = ctx.result?.items ?? [];
  return assembleFolioWithLines(rawRecords, ctx.args.id);
}

/**
 * Request handler for Query.listFoliosForReservation.
 */
export function listFoliosForReservationRequest(ctx: Context<QueryListFoliosForReservationArgs>) {
  const { tenantId, reservationId } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, FOLIO_ROLES);

  return query({
    index: "GSI1",
    query: {
      GSI1PK: { eq: `TENANT#${validatedTenantId}#RES#${reservationId}` },
    },
  });
}

/**
 * Response handler for Query.listFoliosForReservation.
 */
export function listFoliosForReservationResponse(
  ctx: Context<
    QueryListFoliosForReservationArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: Folio[] }
  >,
): Folio[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const folios = ctx.result?.items ?? [];
  for (const folio of folios) {
    if (!folio.lineItems) {
      folio.lineItems = [];
    }
  }
  return folios;
}
