/**
 * @hms/core - Split-Order Department Splitter (orderSplitter.ts)
 *
 * Implements deterministic order splitting for Sri Lankan resort restaurants,
 * bars, poolside cabanas, and in-room dining:
 * - Splits mixed carts (e.g. `2x Rice & Curry + 2x Lion Beer`) into linked
 *   `KITCHEN` (KOT) and `BAR` (BOT) tickets while maintaining 1 unified folio bill.
 * - Enforces multi-tenant `tenantId` isolation and role-based access control (RBAC).
 * - Enforces SaaS subscription entitlement checks.
 * - Computes statutory 4-stage compounding Sri Lankan hospitality taxes:
 *     SC (10%) -> TDL (1%) -> SSCL (2.5%) -> VAT (18%)
 *   with Service Charge waiver on Walk-In Takeaway orders.
 * - Appends cryptographic SHA-256 hash-chained `ImmutableAuditLog` records.
 * - Zero external npm dependencies & cognitive complexity <= 12 per function.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type OrderDepartment = "KITCHEN" | "BAR" | "DESSERT_STATION";

export type TicketType = "KOT" | "BOT";

export type SplitOrderSource = "QR_GUEST" | "WAITER_POS" | "IN_ROOM_DINING" | "FRONT_DESK";

export type OrderDestinationType = "TABLE" | "ROOM" | "CABANA" | "TAKEAWAY";

export interface SplitOrderItemInput {
  readonly itemId: string;
  readonly name: string;
  readonly nameSi?: string | undefined;
  readonly nameTa?: string | undefined;
  readonly department: OrderDepartment;
  readonly quantity: number;
  readonly unitPriceLkr: number;
  readonly spiceLevel?: string | undefined;
  readonly modifiers?: readonly string[] | undefined;
  readonly specialInstructions?: string | undefined;
}

export interface SplitOrderActor {
  readonly userId: string;
  readonly role: string;
  readonly tenantId: string;
}

export interface OrderSubscriptionContext {
  readonly tenantId: string;
  readonly active: boolean;
  readonly tier?: string | undefined;
  readonly allowKdsBot?: boolean | undefined;
}

export interface SplitOrderInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly actor: SplitOrderActor;
  readonly orderSource: SplitOrderSource;
  readonly destinationType: OrderDestinationType;
  readonly destination: string;
  readonly guestName?: string | undefined;
  readonly items: readonly SplitOrderItemInput[];
  readonly taxConfig?: Partial<SriLankaTaxConfig> | undefined;
  readonly cbslUsdRate?: number | undefined;
  readonly subscription?: OrderSubscriptionContext | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly isoTimestamp?: string | undefined;
}

export interface DepartmentTicketItem {
  readonly itemId: string;
  readonly name: string;
  readonly nameSi?: string | undefined;
  readonly nameTa?: string | undefined;
  readonly quantity: number;
  readonly unitPriceLkr: number;
  readonly lineTotalLkr: number;
  readonly spiceLevel?: string | undefined;
  readonly modifiers?: readonly string[] | undefined;
  readonly specialInstructions?: string | undefined;
}

export interface DepartmentTicket {
  readonly ticketId: string;
  readonly masterOrderId: string;
  readonly ticketType: TicketType;
  readonly department: OrderDepartment;
  readonly ticketNumber: string;
  readonly destination: string;
  readonly items: readonly DepartmentTicketItem[];
  readonly totalItemsCount: number;
  readonly subtotalLkr: number;
  readonly firedAt: string;
  readonly slaTargetMinutes: number;
}

export interface CombinedBillSummary {
  readonly grossSubtotalLkr: number;
  readonly taxBreakdown: TaxBreakdownResult;
  readonly grandTotalLkr: number;
  readonly approxUsd: number;
  readonly departmentSubtotals: Record<OrderDepartment, number>;
}

export interface SplitOrderResult {
  readonly masterOrderId: string;
  readonly tenantId: string;
  readonly destination: string;
  readonly orderSource: SplitOrderSource;
  readonly tickets: readonly DepartmentTicket[];
  readonly combinedBill: CombinedBillSummary;
  readonly auditLog: AuditLogEntry;
}

// ============================================================================
// Authorization & Subscriptions
// ============================================================================

const AUTHORIZED_SPLIT_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "RESTAURANT_MANAGER",
  "FRONT_DESK",
  "CASHIER",
  "WAITER",
  "BARTENDER",
  "CHEF",
  "GUEST",
  "GUEST_QR",
]);

function validateOrderActor(
  actor: SplitOrderActor,
  expectedTenantId: string,
): Result<true, DomainError> {
  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match order tenant '${expectedTenantId}'`,
      { actorTenantId: actor.tenantId, expectedTenantId },
    );
  }

  if (!AUTHORIZED_SPLIT_ROLES.has(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized to create or split F&B orders`,
      { role: actor.role },
    );
  }

  return ok(true);
}

function validateOrderSubscription(
  sub: OrderSubscriptionContext | undefined,
  expectedTenantId: string,
): Result<true, DomainError> {
  if (!sub) {
    return ok(true);
  }

  if (sub.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenant '${sub.tenantId}' does not match order tenant '${expectedTenantId}'`,
      { subscriptionTenantId: sub.tenantId, expectedTenantId },
    );
  }

  if (!sub.active) {
    return domainErr(
      "SUBSCRIPTION_INACTIVE",
      "Hotel SaaS subscription is suspended or inactive. Cannot process orders.",
      { tenantId: expectedTenantId },
    );
  }

  if (sub.allowKdsBot === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "KDS and BOT order routing is not enabled on this subscription tier",
      { tier: sub.tier },
    );
  }

  return ok(true);
}

// ============================================================================
// Item Validation & Department Ticket Helpers
// ============================================================================

function validateSingleItem(item: SplitOrderItemInput): Result<true, DomainError> {
  if (!item.itemId || item.itemId.trim() === "") {
    return domainErr("INVALID_ORDER_ITEMS", "Item ID must not be empty");
  }
  if (!item.name || item.name.trim() === "") {
    return domainErr("INVALID_ORDER_ITEMS", "Item name must not be empty");
  }
  if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
    return domainErr(
      "INVALID_ORDER_ITEMS",
      `Item quantity must be a positive integer, received ${item.quantity}`,
      { itemId: item.itemId, quantity: item.quantity },
    );
  }
  if (!Number.isFinite(item.unitPriceLkr) || item.unitPriceLkr < 0) {
    return domainErr(
      "INVALID_ORDER_ITEMS",
      `Item price must be a non-negative number, received ${item.unitPriceLkr}`,
      { itemId: item.itemId, unitPriceLkr: item.unitPriceLkr },
    );
  }
  return ok(true);
}

function validateOrderItems(items: readonly SplitOrderItemInput[]): Result<true, DomainError> {
  if (!items || items.length === 0) {
    return domainErr("INVALID_ORDER_ITEMS", "Order must contain at least one menu item");
  }

  for (const item of items) {
    const res = validateSingleItem(item);
    if (!res.ok) {
      return res;
    }
  }

  return ok(true);
}

interface DepartmentPartition {
  readonly kitchenItems: SplitOrderItemInput[];
  readonly barItems: SplitOrderItemInput[];
  readonly dessertItems: SplitOrderItemInput[];
}

function partitionItemsByDepartment(items: readonly SplitOrderItemInput[]): DepartmentPartition {
  const kitchenItems: SplitOrderItemInput[] = [];
  const barItems: SplitOrderItemInput[] = [];
  const dessertItems: SplitOrderItemInput[] = [];

  for (const item of items) {
    if (item.department === "BAR") {
      barItems.push(item);
    } else if (item.department === "DESSERT_STATION") {
      dessertItems.push(item);
    } else {
      kitchenItems.push(item);
    }
  }

  return { kitchenItems, barItems, dessertItems };
}

function getDepartmentSlaMinutes(dept: OrderDepartment): number {
  if (dept === "BAR") return 10;
  if (dept === "DESSERT_STATION") return 12;
  return 20;
}

function buildDepartmentTicket(
  dept: OrderDepartment,
  items: readonly SplitOrderItemInput[],
  masterOrderId: string,
  destination: string,
  firedAt: string,
): DepartmentTicket {
  const ticketType: TicketType = dept === "BAR" ? "BOT" : "KOT";
  const prefix = dept === "BAR" ? "BOT" : dept === "DESSERT_STATION" ? "DOT" : "KOT";
  const ticketId = `${masterOrderId}-${prefix}`;
  const ticketNumber = `${prefix}-${masterOrderId.slice(-4).toUpperCase()}`;

  const ticketItems: DepartmentTicketItem[] = items.map((it) => ({
    itemId: it.itemId,
    name: it.name,
    nameSi: it.nameSi,
    nameTa: it.nameTa,
    quantity: it.quantity,
    unitPriceLkr: roundLkr(it.unitPriceLkr),
    lineTotalLkr: roundLkr(it.unitPriceLkr * it.quantity),
    spiceLevel: it.spiceLevel,
    modifiers: it.modifiers,
    specialInstructions: it.specialInstructions,
  }));

  const totalItemsCount = ticketItems.reduce((acc, it) => acc + it.quantity, 0);
  const subtotalLkr = roundLkr(ticketItems.reduce((acc, it) => acc + it.lineTotalLkr, 0));

  return {
    ticketId,
    masterOrderId,
    ticketType,
    department: dept,
    ticketNumber,
    destination,
    items: ticketItems,
    totalItemsCount,
    subtotalLkr,
    firedAt,
    slaTargetMinutes: getDepartmentSlaMinutes(dept),
  };
}

function generateDepartmentTickets(
  partition: DepartmentPartition,
  masterOrderId: string,
  destination: string,
  firedAt: string,
): DepartmentTicket[] {
  const tickets: DepartmentTicket[] = [];
  if (partition.kitchenItems.length > 0) {
    tickets.push(
      buildDepartmentTicket("KITCHEN", partition.kitchenItems, masterOrderId, destination, firedAt),
    );
  }
  if (partition.barItems.length > 0) {
    tickets.push(
      buildDepartmentTicket("BAR", partition.barItems, masterOrderId, destination, firedAt),
    );
  }
  if (partition.dessertItems.length > 0) {
    tickets.push(
      buildDepartmentTicket(
        "DESSERT_STATION",
        partition.dessertItems,
        masterOrderId,
        destination,
        firedAt,
      ),
    );
  }
  return tickets;
}

function computeCombinedBillSummary(
  partition: DepartmentPartition,
  destinationType: OrderDestinationType,
  customTaxConfig?: Partial<SriLankaTaxConfig>,
  cbslUsdRate = 310,
): Result<CombinedBillSummary, DomainError> {
  const deptSubtotals: Record<OrderDepartment, number> = {
    KITCHEN: roundLkr(
      partition.kitchenItems.reduce((acc, it) => acc + it.unitPriceLkr * it.quantity, 0),
    ),
    BAR: roundLkr(partition.barItems.reduce((acc, it) => acc + it.unitPriceLkr * it.quantity, 0)),
    DESSERT_STATION: roundLkr(
      partition.dessertItems.reduce((acc, it) => acc + it.unitPriceLkr * it.quantity, 0),
    ),
  };

  const grossSubtotalLkr = roundLkr(
    deptSubtotals.KITCHEN + deptSubtotals.BAR + deptSubtotals.DESSERT_STATION,
  );

  const isTakeaway = destinationType === "TAKEAWAY";
  const taxConfig: SriLankaTaxConfig = {
    ...DEFAULT_SRI_LANKA_TAX_CONFIG,
    ...(customTaxConfig ?? {}),
    enableSC: isTakeaway
      ? false
      : (customTaxConfig?.enableSC ?? DEFAULT_SRI_LANKA_TAX_CONFIG.enableSC),
  };

  const taxResult = calculateForwardTax(grossSubtotalLkr, taxConfig);
  if (!taxResult.ok) {
    return taxResult;
  }

  const taxBreakdown = taxResult.value;
  const rate = cbslUsdRate > 0 ? cbslUsdRate : 310;
  const approxUsd = roundLkr(taxBreakdown.grandTotalLkr / rate);

  return ok({
    grossSubtotalLkr,
    taxBreakdown,
    grandTotalLkr: taxBreakdown.grandTotalLkr,
    approxUsd,
    departmentSubtotals: deptSubtotals,
  });
}

// ============================================================================
// Main Exported Function: splitOrderByDepartment
// ============================================================================

/**
 * Pure function splitting a mixed cart into linked KOT (Kitchen) and BOT (Bar)
 * tickets while calculating a unified 4-stage compounding statutory hotel bill.
 */
export function splitOrderByDepartment(
  input: SplitOrderInput,
): Result<SplitOrderResult, DomainError> {
  // 1. Validate Tenant ID
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const tenantId = tenantRes.value;

  // 2. Validate Actor RBAC
  const actorRes = validateOrderActor(input.actor, tenantId);
  if (!actorRes.ok) {
    return actorRes;
  }

  // 3. Validate SaaS Subscription
  const subRes = validateOrderSubscription(input.subscription, tenantId);
  if (!subRes.ok) {
    return subRes;
  }

  // 4. Validate Items
  const itemsRes = validateOrderItems(input.items);
  if (!itemsRes.ok) {
    return itemsRes;
  }

  const firedAt = input.isoTimestamp ?? new Date().toISOString();

  // 5. Partition Items & Build Tickets
  const partition = partitionItemsByDepartment(input.items);
  const tickets = generateDepartmentTickets(partition, input.orderId, input.destination, firedAt);

  // 6. Compute Combined 4-Stage Tax Bill
  const billRes = computeCombinedBillSummary(
    partition,
    input.destinationType,
    input.taxConfig,
    input.cbslUsdRate,
  );
  if (!billRes.ok) {
    return billRes;
  }
  const combinedBill = billRes.value;

  // 7. Generate Cryptographic Hash-Chained Audit Record
  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.actor.userId,
    action: "ORDER_SPLIT_DISPATCHED",
    entityType: "MasterOrder",
    entityId: input.orderId,
    isoTs: firedAt,
    prevHash: input.prevAuditHash,
    afterJson: JSON.stringify({
      orderId: input.orderId,
      destination: input.destination,
      destinationType: input.destinationType,
      ticketsCreated: tickets.map((t) => ({
        ticketId: t.ticketId,
        ticketType: t.ticketType,
        department: t.department,
        itemsCount: t.totalItemsCount,
        subtotalLkr: t.subtotalLkr,
      })),
      grandTotalLkr: combinedBill.grandTotalLkr,
    }),
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    masterOrderId: input.orderId,
    tenantId,
    destination: input.destination,
    orderSource: input.orderSource,
    tickets,
    combinedBill,
    auditLog: auditRes.value,
  });
}
