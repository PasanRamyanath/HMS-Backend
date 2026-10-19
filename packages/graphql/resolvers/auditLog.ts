/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Immutable Audit Trail Logger for Statutory Tax & Room Rate Modifications (auditLog.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Mutation.logTaxConfigModification (appends AUDITLOG# record for SC/TDL/SSCL/VAT changes)
 * - Mutation.logRoomTypeRateModification (appends AUDITLOG# record for room rate matrix edits)
 * - Query.listAuditLogsByEntity (queries audit history for a specific entity, e.g. TaxConfig or RoomType)
 * - Query.getAuditLogEntry (fetches a single audit log record by ISO timestamp and auditId)
 *
 * Single-table DynamoDB mapping:
 * AuditLogRecord:
 *   PK = "TENANT#" + tenantId
 *   SK = "AUDITLOG#" + isoTs + "#" + auditId
 *   GSI1PK = "TENANT#" + tenantId + "#AUDITLOGS"
 *   GSI1SK = "ENTITY#" + entityType + "#" + isoTs
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, put, query } from "@aws-appsync/utils/dynamodb.js";
import { getAuthenticatedUserId, requireUserRole, tenantGuard } from "./tenantGuard.js";

// ============================================================================
// Types & Contracts
// ============================================================================

export interface AuditLogRecord {
  readonly PK: string;
  readonly SK: string;
  readonly GSI1PK: string;
  readonly GSI1SK: string;
  readonly id: string;
  readonly tenantId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly changedBy: string;
  readonly oldValueJson: string;
  readonly newValueJson: string;
  readonly changeSummary?: string | undefined;
  readonly prevHash?: string | undefined;
  readonly isoTs: string;
  readonly createdAt: string;
}

export interface LogTaxConfigModificationInput {
  readonly tenantId: string;
  readonly oldConfigJson: string;
  readonly newConfigJson: string;
  readonly reason?: string | undefined;
  readonly prevHash?: string | undefined;
}

export interface LogRoomTypeRateModificationInput {
  readonly tenantId: string;
  readonly roomTypeId: string;
  readonly oldRatesJson: string;
  readonly newRatesJson: string;
  readonly reason?: string | undefined;
  readonly prevHash?: string | undefined;
}

export interface QueryListAuditLogsByEntityArgs {
  readonly tenantId: string;
  readonly entityType: string;
  readonly limit?: number | undefined;
  readonly nextToken?: string | undefined;
}

export interface QueryGetAuditLogEntryArgs {
  readonly tenantId: string;
  readonly isoTs: string;
  readonly auditId: string;
}

export interface MutationLogTaxConfigModificationArgs {
  readonly input: LogTaxConfigModificationInput;
}

export interface MutationLogRoomTypeRateModificationArgs {
  readonly input: LogRoomTypeRateModificationInput;
}

// Roles authorized to write / read audit records
export const AUDIT_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "FINANCE_CONTROLLER",
] as const;

export const AUDIT_READ_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "FINANCE_CONTROLLER",
  "NIGHT_AUDITOR",
] as const;

// ============================================================================
// Pure Key & Item Builders
// ============================================================================

/**
 * Builds the canonical single-table DynamoDB primary key for an AuditLog entity.
 */
export function getAuditLogKey(tenantId: string, isoTs: string, auditId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `AUDITLOG#${isoTs}#${auditId}`,
  };
}

export interface BuildAuditLogItemParams {
  readonly tenantId: string;
  readonly auditId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly changedBy: string;
  readonly oldValueJson: string;
  readonly newValueJson: string;
  readonly isoTs: string;
  readonly changeSummary?: string | undefined;
  readonly prevHash?: string | undefined;
}

/**
 * Pure builder function for constructing an immutable DynamoDB AuditLog item.
 */
export function buildAuditLogItem(params: BuildAuditLogItemParams): AuditLogRecord {
  const key = getAuditLogKey(params.tenantId, params.isoTs, params.auditId);

  return {
    ...key,
    GSI1PK: `TENANT#${params.tenantId}#AUDITLOGS`,
    GSI1SK: `ENTITY#${params.entityType}#${params.isoTs}`,
    id: params.auditId,
    tenantId: params.tenantId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    changedBy: params.changedBy,
    oldValueJson: params.oldValueJson,
    newValueJson: params.newValueJson,
    changeSummary: params.changeSummary,
    prevHash: params.prevHash,
    isoTs: params.isoTs,
    createdAt: params.isoTs,
  };
}

export interface TaxConfigAuditParams {
  readonly tenantId: string;
  readonly changedBy: string;
  readonly oldConfigJson: string;
  readonly newConfigJson: string;
  readonly reason?: string | undefined;
  readonly prevHash?: string | undefined;
  readonly isoTs?: string | undefined;
  readonly auditId?: string | undefined;
}

/**
 * Formats a dedicated audit entry when Sri Lankan statutory tax parameters are modified.
 */
export function buildTaxConfigAuditItem(params: TaxConfigAuditParams): AuditLogRecord {
  const auditId = params.auditId || util.autoId();
  const isoTs = params.isoTs || util.time.nowISO8601();

  return buildAuditLogItem({
    tenantId: params.tenantId,
    auditId,
    action: "UPDATE_TAX_CONFIG",
    entityType: "TaxConfig",
    entityId: "STATUTORY_TAX_CONFIG",
    changedBy: params.changedBy,
    oldValueJson: params.oldConfigJson,
    newValueJson: params.newConfigJson,
    changeSummary: params.reason || "Sri Lankan Statutory Tax parameters modified",
    prevHash: params.prevHash,
    isoTs,
  });
}

export interface RoomRateAuditParams {
  readonly tenantId: string;
  readonly roomTypeId: string;
  readonly changedBy: string;
  readonly oldRatesJson: string;
  readonly newRatesJson: string;
  readonly reason?: string | undefined;
  readonly prevHash?: string | undefined;
  readonly isoTs?: string | undefined;
  readonly auditId?: string | undefined;
}

/**
 * Formats a dedicated audit entry when room category tariffs or seasonal bands are modified.
 */
export function buildRoomRateAuditItem(params: RoomRateAuditParams): AuditLogRecord {
  const auditId = params.auditId || util.autoId();
  const isoTs = params.isoTs || util.time.nowISO8601();

  return buildAuditLogItem({
    tenantId: params.tenantId,
    auditId,
    action: "UPDATE_ROOM_RATES",
    entityType: "RoomType",
    entityId: params.roomTypeId,
    changedBy: params.changedBy,
    oldValueJson: params.oldRatesJson,
    newValueJson: params.newRatesJson,
    changeSummary: params.reason || `Room rate matrix updated for ${params.roomTypeId}`,
    prevHash: params.prevHash,
    isoTs,
  });
}

// ============================================================================
// AppSync JS Request & Response Handlers
// ============================================================================

/**
 * Request handler for Mutation.logTaxConfigModification.
 * Validates tenant isolation, verifies finance/admin RBAC role, and writes audit record to DynamoDB.
 */
export function logTaxConfigModificationRequest(
  ctx: Context<MutationLogTaxConfigModificationArgs>,
) {
  const { input } = ctx.args;
  const tenantId = tenantGuard(ctx, input.tenantId);
  requireUserRole(ctx, AUDIT_WRITE_ROLES);

  const actorUserId = getAuthenticatedUserId(ctx);
  const record = buildTaxConfigAuditItem({
    tenantId,
    changedBy: actorUserId,
    oldConfigJson: input.oldConfigJson,
    newConfigJson: input.newConfigJson,
    reason: input.reason,
    prevHash: input.prevHash,
  });

  return put({
    key: {
      PK: record.PK,
      SK: record.SK,
    },
    item: record,
  });
}

/**
 * Response handler for Mutation.logTaxConfigModification.
 */
export function logTaxConfigModificationResponse(
  ctx: Context<
    MutationLogTaxConfigModificationArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    AuditLogRecord
  >,
): AuditLogRecord {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.logRoomTypeRateModification.
 * Validates tenant isolation, verifies GM/owner RBAC role, and writes audit record to DynamoDB.
 */
export function logRoomTypeRateModificationRequest(
  ctx: Context<MutationLogRoomTypeRateModificationArgs>,
) {
  const { input } = ctx.args;
  const tenantId = tenantGuard(ctx, input.tenantId);
  requireUserRole(ctx, AUDIT_WRITE_ROLES);

  const actorUserId = getAuthenticatedUserId(ctx);
  const record = buildRoomRateAuditItem({
    tenantId,
    roomTypeId: input.roomTypeId,
    changedBy: actorUserId,
    oldRatesJson: input.oldRatesJson,
    newRatesJson: input.newRatesJson,
    reason: input.reason,
    prevHash: input.prevHash,
  });

  return put({
    key: {
      PK: record.PK,
      SK: record.SK,
    },
    item: record,
  });
}

/**
 * Response handler for Mutation.logRoomTypeRateModification.
 */
export function logRoomTypeRateModificationResponse(
  ctx: Context<
    MutationLogRoomTypeRateModificationArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    AuditLogRecord
  >,
): AuditLogRecord {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Query.listAuditLogsByEntity.
 * Queries GSI1 for audit events filtered by entityType (e.g. TaxConfig or RoomType).
 */
export function listAuditLogsByEntityRequest(ctx: Context<QueryListAuditLogsByEntityArgs>) {
  const { tenantId, entityType, limit, nextToken } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);
  requireUserRole(ctx, AUDIT_READ_ROLES);

  if (nextToken) {
    return query({
      index: "GSI1",
      query: {
        GSI1PK: { eq: `TENANT#${validatedTenantId}#AUDITLOGS` },
        GSI1SK: { beginsWith: `ENTITY#${entityType}#` },
      },
      limit: limit || 50,
      nextToken,
      scanIndexForward: false, // Chronological descending (newest first)
    });
  }

  return query({
    index: "GSI1",
    query: {
      GSI1PK: { eq: `TENANT#${validatedTenantId}#AUDITLOGS` },
      GSI1SK: { beginsWith: `ENTITY#${entityType}#` },
    },
    limit: limit || 50,
    scanIndexForward: false, // Chronological descending (newest first)
  });
}

/**
 * Response handler for Query.listAuditLogsByEntity.
 */
export function listAuditLogsByEntityResponse(
  ctx: Context<
    QueryListAuditLogsByEntityArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: AuditLogRecord[] }
  >,
): AuditLogRecord[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Query.getAuditLogEntry.
 * Fetches an immutable audit record directly by its compound primary key.
 */
export function getAuditLogEntryRequest(ctx: Context<QueryGetAuditLogEntryArgs>) {
  const { tenantId, isoTs, auditId } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);
  requireUserRole(ctx, AUDIT_READ_ROLES);

  return get({
    key: getAuditLogKey(validatedTenantId, isoTs, auditId),
  });
}

/**
 * Response handler for Query.getAuditLogEntry.
 */
export function getAuditLogEntryResponse(
  ctx: Context<
    QueryGetAuditLogEntryArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    AuditLogRecord
  >,
): AuditLogRecord | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}
