/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Banquet Functions, Weddings (BEO) & Event Hall Scheduling (banquets.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.listBanquetEvents (filtered optionally by eventDate)
 * - Query.getBanquetEvent
 * - Query.listBanquetHalls
 * - Mutation.upsertBanquetHall
 * - Mutation.upsertBanquetEvent (enforcing hall + date + slot uniqueness)
 * - Mutation.createBanquetEvent
 * - Mutation.updateBanquetEventStatus
 *
 * Single-table DynamoDB mapping:
 * BanquetHall:
 *   PK = "TENANT#" + tenantId
 *   SK = "BANQUETHALL#" + hallId
 *   GSI1PK = "TENANT#" + tenantId + "#BANQUETHALLS"
 *   GSI1SK = "NAME#" + name
 *
 * BanquetEvent:
 *   PK = "TENANT#" + tenantId
 *   SK = "BANQUET#" + eventId
 *   GSI1PK = "TENANT#" + tenantId + "#BANQUETS"
 *   GSI1SK = "DATE#" + eventDate + "#SLOT#" + slot + "#" + eventId
 *   GSI2PK = "TENANT#" + tenantId + "#HALL#" + hallId
 *   GSI2SK = "DATE#" + eventDate + "#SLOT#" + slot
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, operations, put, query, update } from "@aws-appsync/utils/dynamodb.js";
import type {
  BanquetEvent,
  BanquetHall,
  BitePlateItem,
  BitePlateItemInput,
  MutationCreateBanquetEventArgs,
  MutationUpdateBanquetEventStatusArgs,
  MutationUpsertBanquetEventArgs,
  MutationUpsertBanquetHallArgs,
  QueryGetBanquetEventArgs,
  QueryListBanquetEventsArgs,
  QueryListBanquetHallsArgs,
  TaxBreakdown,
  UpsertBanquetEventInput,
} from "../src/generated/types.js";
import { getAuthenticatedUserId, requireUserRole, tenantGuard } from "./tenantGuard.js";

const BANQUET_STAFF_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "BANQUET_MANAGER",
  "FNB_SUPERVISOR",
  "EXECUTIVE_CHEF",
  "FRONT_DESK",
] as const;

const BANQUET_ADMIN_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "BANQUET_MANAGER",
] as const;

/**
 * Exact half-up rounding helper to 2 decimal places (integer cents)
 * using Number.EPSILON to eliminate IEEE 754 precision drift.
 */
export function roundLkr(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Builds the canonical single-table DynamoDB primary key for a BanquetHall entity.
 */
export function getBanquetHallKey(tenantId: string, hallId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `BANQUETHALL#${hallId}`,
  };
}

/**
 * Builds the canonical single-table DynamoDB primary key for a BanquetEvent entity.
 */
export function getBanquetEventKey(tenantId: string, eventId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `BANQUET#${eventId}`,
  };
}

/**
 * Computes 4-stage compounding Sri Lankan statutory hospitality taxes for banquets:
 * Stage 1: 10% Service Charge (SC)
 * Stage 2: 1% Tourism Development Levy (TDL) on (Base + SC)
 * Stage 3: 2.5% Social Security Contribution Levy (SSCL) on (Base + SC)
 * Stage 4: 18% Value Added Tax (VAT) on (Base + SC + TDL + SSCL)
 */
export function calculateBanquetTaxBreakdown(baseSupplyLkr: number): TaxBreakdown {
  const base = roundLkr(baseSupplyLkr);
  const serviceChargeLkr = roundLkr(base * 0.1);
  const subtotalAfterScLkr = roundLkr(base + serviceChargeLkr);
  const tdlLkr = roundLkr(subtotalAfterScLkr * 0.01);
  const ssclLkr = roundLkr(subtotalAfterScLkr * 0.025);
  const vatBaseLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr);
  const vatLkr = roundLkr(vatBaseLkr * 0.18);
  const totalGrossLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr + vatLkr);
  const totalTaxAndServiceLkr = roundLkr(serviceChargeLkr + tdlLkr + ssclLkr + vatLkr);
  const effectiveTaxRate = base > 0 ? roundLkr((totalGrossLkr - base) / base) : 0;

  return {
    baseSupplyLkr: base,
    serviceChargeLkr,
    tdlLkr,
    ssclLkr,
    vatLkr,
    totalTaxAndServiceLkr,
    totalGrossLkr,
    effectiveTaxRate,
  };
}

/**
 * Maps input bite plate items and calculates individual line totals.
 */
export function processBitePlates(
  rawBites: (BitePlateItemInput | null | undefined)[] | null | undefined,
): { items: BitePlateItem[]; totalLkr: number } {
  if (!rawBites || rawBites.length === 0) {
    return { items: [], totalLkr: 0 };
  }

  let totalLkr = 0;
  const items: BitePlateItem[] = [];

  for (const b of rawBites) {
    if (!b) {
      continue;
    }
    const itemTotal = roundLkr(b.quantityKgOrPlates * b.ratePerUnitLkr);
    totalLkr = roundLkr(totalLkr + itemTotal);
    items.push({
      id: util.autoId(),
      name: b.name,
      quantityKgOrPlates: b.quantityKgOrPlates,
      unitOfMeasure: b.unitOfMeasure,
      ratePerUnitLkr: b.ratePerUnitLkr,
      totalAmountLkr: itemTotal,
    });
  }

  return { items, totalLkr };
}

/**
 * Request handler for Query.listBanquetEvents.
 */
export function listBanquetEventsRequest(ctx: Context<QueryListBanquetEventsArgs>) {
  const { tenantId, eventDate } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, BANQUET_STAFF_ROLES);

  if (eventDate) {
    return query({
      query: {
        GSI1PK: { eq: `TENANT#${validatedTenantId}#BANQUETS` },
        GSI1SK: { beginsWith: `DATE#${eventDate}` },
      },
      index: "GSI1",
    });
  }

  return query({
    query: {
      GSI1PK: { eq: `TENANT#${validatedTenantId}#BANQUETS` },
    },
    index: "GSI1",
  });
}

/**
 * Response handler for Query.listBanquetEvents.
 */
export function listBanquetEventsResponse(
  ctx: Context<
    QueryListBanquetEventsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items: BanquetEvent[] }
  >,
): BanquetEvent[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Query.getBanquetEvent.
 */
export function getBanquetEventRequest(ctx: Context<QueryGetBanquetEventArgs>) {
  const { tenantId, id } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);
  return get({ key: getBanquetEventKey(validatedTenantId, id) });
}

/**
 * Response handler for Query.getBanquetEvent.
 */
export function getBanquetEventResponse(
  ctx: Context<
    QueryGetBanquetEventArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    BanquetEvent | null
  >,
): BanquetEvent | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Query.listBanquetHalls.
 */
export function listBanquetHallsRequest(ctx: Context<QueryListBanquetHallsArgs>) {
  const validatedTenantId = tenantGuard(ctx, ctx.args.tenantId);
  return query({
    query: {
      PK: { eq: `TENANT#${validatedTenantId}` },
      SK: { beginsWith: "BANQUETHALL#" },
    },
  });
}

/**
 * Response handler for Query.listBanquetHalls.
 */
export function listBanquetHallsResponse(
  ctx: Context<
    QueryListBanquetHallsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items: BanquetHall[] }
  >,
): BanquetHall[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

/**
 * Request handler for Mutation.upsertBanquetHall.
 */
export function upsertBanquetHallRequest(ctx: Context<MutationUpsertBanquetHallArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, BANQUET_ADMIN_ROLES);

  const hallId = input.id && input.id.trim().length > 0 ? input.id : util.autoId();
  const now = util.time.nowISO8601();
  const key = getBanquetHallKey(validatedTenantId, hallId);

  const item = {
    ...key,
    ...input,
    id: hallId,
    tenantId: validatedTenantId,
    entityType: "BanquetHall",
    GSI1PK: `TENANT#${validatedTenantId}#BANQUETHALLS`,
    GSI1SK: `NAME#${input.name.toUpperCase()}`,
    createdAt: now,
    updatedAt: now,
  };

  return put({
    key,
    item,
  });
}

/**
 * Response handler for Mutation.upsertBanquetHall.
 */
export function upsertBanquetHallResponse(
  ctx: Context<
    MutationUpsertBanquetHallArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    BanquetHall
  >,
): BanquetHall {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Helper to build the PutItem payload for creating or updating a BanquetEvent.
 * Enforces hall + date + slot uniqueness when creating a new event.
 */
function buildBanquetEventPut(
  ctx: Context<MutationUpsertBanquetEventArgs>,
  validatedTenantId: string,
  input: UpsertBanquetEventInput,
) {
  const now = util.time.nowISO8601();
  const isCreate = !input.id || input.id.trim().length === 0;
  // Canonical deterministic slot identifier guaranteeing no double-booking per hall/date/slot
  const slotKey = `BEO-${input.hallId}-${input.eventDate}-${input.slot}`;
  const eventId = isCreate ? slotKey : (input.id as string);
  const key = getBanquetEventKey(validatedTenantId, eventId);

  const cateringSubtotal = roundLkr(input.guaranteedGuestCount * input.perPlateRateLkr);
  const { items: processedBites, totalLkr: bitesTotal } = processBitePlates(input.bitePlates);
  const subtotalLkr = roundLkr(
    cateringSubtotal + bitesTotal + input.corkageFeeTotalLkr + input.hallRentalChargeLkr,
  );

  const taxBreakdown = calculateBanquetTaxBreakdown(subtotalLkr);
  const advanceDeposit = roundLkr(input.advanceDepositPaidLkr ?? 0);
  const balanceDueLkr = roundLkr(taxBreakdown.totalGrossLkr - advanceDeposit);
  const eventNumber =
    input.eventNumber ?? `BEO-${input.eventDate.replace(/-/g, "")}-${eventId.slice(-6)}`;

  const item = {
    ...key,
    ...input,
    id: eventId,
    tenantId: validatedTenantId,
    eventNumber,
    bitePlates: processedBites,
    subtotalLkr,
    taxBreakdown,
    totalGrossLkr: taxBreakdown.totalGrossLkr,
    advanceDepositPaidLkr: advanceDeposit,
    balanceDueLkr,
    status: input.status ?? "CONFIRMED",
    entityType: "BanquetEvent",
    slotKey,
    GSI1PK: `TENANT#${validatedTenantId}#BANQUETS`,
    GSI1SK: `DATE#${input.eventDate}#SLOT#${input.slot}#${eventId}`,
    GSI2PK: `TENANT#${validatedTenantId}#HALL#${input.hallId}`,
    GSI2SK: `DATE#${input.eventDate}#SLOT#${input.slot}`,
    createdAt: now,
    updatedAt: now,
    auditTrail: [
      {
        action: isCreate ? "CREATE_BANQUET_EVENT" : "UPDATE_BANQUET_EVENT",
        performedBy: getAuthenticatedUserId(ctx),
        timestamp: now,
        grossAmountLkr: taxBreakdown.totalGrossLkr,
      },
    ],
  };

  if (isCreate) {
    // Condition expression guaranteeing hall + date + slot uniqueness
    return put({
      key,
      item,
      condition: {
        PK: { attributeExists: false },
        SK: { attributeExists: false },
      },
    });
  }

  return put({
    key,
    item,
  });
}

/**
 * Request handler for Mutation.upsertBanquetEvent.
 */
export function upsertBanquetEventRequest(ctx: Context<MutationUpsertBanquetEventArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, BANQUET_ADMIN_ROLES);

  return buildBanquetEventPut(ctx, validatedTenantId, input);
}

/**
 * Response handler for Mutation.upsertBanquetEvent.
 */
export function upsertBanquetEventResponse(
  ctx: Context<
    MutationUpsertBanquetEventArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    BanquetEvent
  >,
): BanquetEvent {
  if (ctx.error) {
    if (ctx.error.type === "DynamoDB:ConditionalCheckFailedException") {
      util.error(
        "Hall is already booked for this date and time-slot. Please select an alternate slot or venue.",
        "DUPLICATE_BANQUET_SLOT",
      );
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.createBanquetEvent.
 */
export function createBanquetEventRequest(ctx: Context<MutationCreateBanquetEventArgs>) {
  const { tenantId, input } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, BANQUET_ADMIN_ROLES);

  return buildBanquetEventPut(
    ctx as unknown as Context<MutationUpsertBanquetEventArgs>,
    validatedTenantId,
    input,
  );
}

/**
 * Response handler for Mutation.createBanquetEvent.
 */
export function createBanquetEventResponse(
  ctx: Context<
    MutationCreateBanquetEventArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    BanquetEvent
  >,
): BanquetEvent {
  if (ctx.error) {
    if (ctx.error.type === "DynamoDB:ConditionalCheckFailedException") {
      util.error(
        "Hall is already booked for this date and time-slot. Please select an alternate slot or venue.",
        "DUPLICATE_BANQUET_SLOT",
      );
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

/**
 * Request handler for Mutation.updateBanquetEventStatus.
 */
export function updateBanquetEventStatusRequest(
  ctx: Context<MutationUpdateBanquetEventStatusArgs>,
) {
  const { tenantId, id, status } = ctx.args;
  const validatedTenantId = tenantGuard(ctx, tenantId);

  requireUserRole(ctx, BANQUET_STAFF_ROLES);

  const now = util.time.nowISO8601();
  const key = getBanquetEventKey(validatedTenantId, id);

  return update({
    key,
    update: {
      status: operations.replace(status),
      updatedAt: operations.replace(now),
    },
  });
}

/**
 * Response handler for Mutation.updateBanquetEventStatus.
 */
export function updateBanquetEventStatusResponse(
  ctx: Context<
    MutationUpdateBanquetEventStatusArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    BanquetEvent
  >,
): BanquetEvent {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
