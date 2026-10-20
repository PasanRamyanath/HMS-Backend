/**
 * @hms/core - Kitchen Display System (KDS) SLA Metrics & Bottleneck Analytics Engine (kdsMetrics.ts)
 *
 * Implements deterministic analytics for Sri Lankan resort and hotel kitchens,
 * bars, and live buffet stations:
 * - Computes average prep times across key order lifecycle stages:
 *     NEW_ORDER -> COOKING -> READY -> DELIVERED.
 * - Evaluates order SLA compliance (on-time vs delayed order classification).
 * - Identifies slow dishes with high prep times exceeding department thresholds.
 * - Detects peak kitchen bottleneck hours based on delay rates and volume.
 * - Enforces multi-tenant `tenantId` isolation and role-based access control (RBAC).
 * - Enforces SaaS subscription entitlement checks.
 * - Appends cryptographic SHA-256 hash-chained `ImmutableAuditLog` records.
 * - Zero external npm dependencies & cognitive complexity <= 12 per function.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { validateTenantId } from "./config.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type KdsDepartment = "KITCHEN" | "BAR" | "DESSERT_STATION";

export type KdsOrderLifecycleStage = "NEW_ORDER" | "COOKING" | "READY" | "DELIVERED" | "CANCELLED";

export interface KdsItemDetail {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly quantity: number;
  readonly prepTimeMinutes?: number | undefined;
}

export interface KdsTicketRecord {
  readonly orderId: string;
  readonly tenantId: string;
  readonly kotNumber: string;
  readonly department: KdsDepartment;
  readonly destinationType: string;
  readonly destination: string;
  readonly receivedAt: string; // ISO String
  readonly startedCookingAt?: string | undefined;
  readonly readyAt?: string | undefined;
  readonly deliveredAt?: string | undefined;
  readonly cancelledAt?: string | undefined;
  readonly slaTargetMinutes: number;
  readonly items: readonly KdsItemDetail[];
  readonly grossTotalLkr: number;
}

export interface KdsStageAverages {
  readonly avgQueueMinutes: number; // receivedAt -> startedCookingAt
  readonly avgCookingMinutes: number; // startedCookingAt -> readyAt
  readonly avgDispatchMinutes: number; // readyAt -> deliveredAt
  readonly avgTotalCycleMinutes: number; // receivedAt -> deliveredAt
  readonly sampleCount: number;
}

export interface KdsSlaPerformance {
  readonly totalCompletedOrders: number;
  readonly onTimeOrdersCount: number;
  readonly delayedOrdersCount: number;
  readonly complianceRatePercent: number;
  readonly avgDelayMinutes: number;
  readonly longestDelayMinutes: number;
  readonly longestDelayedKotNumber?: string | undefined;
}

export interface SlowDishAnalysis {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly orderFrequency: number;
  readonly avgCookingMinutes: number;
  readonly slaTargetMinutes: number;
  readonly delayRatePercent: number;
  readonly isBottleneck: boolean;
}

export interface HourlyBottleneckAnalysis {
  readonly hour: number; // 0 - 23
  readonly hourLabel: string; // e.g. "12:00 - 13:00"
  readonly ordersCount: number;
  readonly avgTotalCycleMinutes: number;
  readonly delayedCount: number;
  readonly delayRatePercent: number;
  readonly isPeakBottleneck: boolean;
}

export interface KdsMetricsActor {
  readonly userId: string;
  readonly role: string;
  readonly tenantId: string;
}

export interface KdsMetricsSubscription {
  readonly tenantId: string;
  readonly tier: string;
  readonly active: boolean;
  readonly allowKdsAnalytics?: boolean | undefined;
}

export interface GenerateKdsReportInput {
  readonly tenantId: string;
  readonly actor: KdsMetricsActor;
  readonly tickets: readonly KdsTicketRecord[];
  readonly subscription?: KdsMetricsSubscription | undefined;
  readonly periodStartIso?: string | undefined;
  readonly periodEndIso?: string | undefined;
  readonly prevAuditHash?: string | undefined;
}

export interface KdsPerformanceReport {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalTicketsProcessed: number;
  readonly departmentBreakdown: Readonly<Record<KdsDepartment, number>>;
  readonly stageAverages: KdsStageAverages;
  readonly slaPerformance: KdsSlaPerformance;
  readonly slowDishes: readonly SlowDishAnalysis[];
  readonly hourlyBottlenecks: readonly HourlyBottleneckAnalysis[];
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Security & Authorization Constants
// ============================================================================

export const AUTHORIZED_KDS_METRICS_ROLES: ReadonlySet<string> = new Set([
  "CHEF",
  "HEAD_CHEF",
  "SOUS_CHEF",
  "KITCHEN_MANAGER",
  "F_AND_B_MANAGER",
  "DUTY_MANAGER",
  "HOTEL_MANAGER",
  "GENERAL_MANAGER",
  "SUPER_ADMIN",
  "ADMIN",
]);

// ============================================================================
// Pure Calculation Helpers
// ============================================================================

/**
 * Computes elapsed time in decimal minutes between two ISO timestamps.
 * Returns null if either timestamp is missing or if start is after end.
 */
export function computeDurationMinutes(
  startIso?: string | undefined,
  endIso?: string | undefined,
): number | null {
  if (!startIso || !endIso) return null;

  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return null;
  }

  const diffMinutes = (endMs - startMs) / 60000;
  return Math.round((diffMinutes + Number.EPSILON) * 100) / 100;
}

/**
 * Evaluates whether an order ticket completed within its target SLA minutes.
 * An order is considered completed when it has readyAt or deliveredAt.
 * Returns null if the ticket is not completed or timestamps are invalid.
 */
export function isOrderOnTime(ticket: KdsTicketRecord): boolean | null {
  if (ticket.cancelledAt) return null;

  const completionTimestamp = ticket.readyAt || ticket.deliveredAt;
  if (!completionTimestamp) return null;

  const duration = computeDurationMinutes(ticket.receivedAt, completionTimestamp);
  if (duration === null) return null;

  return duration <= ticket.slaTargetMinutes;
}

function computeMetricAverage(
  tickets: readonly KdsTicketRecord[],
  startSelector: (t: KdsTicketRecord) => string | undefined,
  endSelector: (t: KdsTicketRecord) => string | undefined,
): { avg: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const t of tickets) {
    if (t.cancelledAt) continue;
    const dur = computeDurationMinutes(startSelector(t), endSelector(t));
    if (dur !== null) {
      sum += dur;
      count += 1;
    }
  }
  return {
    avg: count > 0 ? Math.round((sum / count + Number.EPSILON) * 100) / 100 : 0,
    count,
  };
}

/**
 * Computes average durations across lifecycle stages for completed tickets.
 */
export function computeKdsStageAverages(tickets: readonly KdsTicketRecord[]): KdsStageAverages {
  const queue = computeMetricAverage(
    tickets,
    (t) => t.receivedAt,
    (t) => t.startedCookingAt,
  );
  const cooking = computeMetricAverage(
    tickets,
    (t) => t.startedCookingAt,
    (t) => t.readyAt,
  );
  const dispatch = computeMetricAverage(
    tickets,
    (t) => t.readyAt,
    (t) => t.deliveredAt,
  );
  const total = computeMetricAverage(
    tickets,
    (t) => t.receivedAt,
    (t) => t.deliveredAt,
  );

  return {
    avgQueueMinutes: queue.avg,
    avgCookingMinutes: cooking.avg,
    avgDispatchMinutes: dispatch.avg,
    avgTotalCycleMinutes: total.avg,
    sampleCount: total.count,
  };
}

function evaluateTicketDelay(t: KdsTicketRecord): { isDelayed: boolean; delayMinutes: number } {
  const onTime = isOrderOnTime(t);
  if (onTime === null || onTime) {
    return { isDelayed: false, delayMinutes: 0 };
  }
  const completionTime = t.readyAt || t.deliveredAt;
  const duration = computeDurationMinutes(t.receivedAt, completionTime) || 0;
  return {
    isDelayed: true,
    delayMinutes: Math.max(0, duration - t.slaTargetMinutes),
  };
}

/**
 * Evaluates overall SLA compliance across completed order tickets.
 */
export function computeKdsSlaPerformance(tickets: readonly KdsTicketRecord[]): KdsSlaPerformance {
  let completedCount = 0;
  let onTimeCount = 0;
  let delayedCount = 0;
  let totalDelayMinutes = 0;
  let longestDelay = 0;
  let longestKot: string | undefined;

  for (const t of tickets) {
    const onTime = isOrderOnTime(t);
    if (onTime === null) continue;

    completedCount += 1;
    if (onTime) {
      onTimeCount += 1;
    } else {
      delayedCount += 1;
      const { delayMinutes } = evaluateTicketDelay(t);
      totalDelayMinutes += delayMinutes;

      if (delayMinutes > longestDelay) {
        longestDelay = delayMinutes;
        longestKot = t.kotNumber;
      }
    }
  }

  const compliance =
    completedCount > 0
      ? Math.round(((onTimeCount / completedCount) * 100 + Number.EPSILON) * 10) / 10
      : 100;
  const avgDelay =
    delayedCount > 0
      ? Math.round((totalDelayMinutes / delayedCount + Number.EPSILON) * 100) / 100
      : 0;

  return {
    totalCompletedOrders: completedCount,
    onTimeOrdersCount: onTimeCount,
    delayedOrdersCount: delayedCount,
    complianceRatePercent: compliance,
    avgDelayMinutes: avgDelay,
    longestDelayMinutes: Math.round((longestDelay + Number.EPSILON) * 100) / 100,
    longestDelayedKotNumber: longestKot,
  };
}

interface DishAccumulator {
  name: string;
  category: string;
  totalCookingMinutes: number;
  count: number;
  delayedCount: number;
  slaTargetMinutes: number;
}

function recordDishPrep(
  map: Map<string, DishAccumulator>,
  item: KdsItemDetail,
  effectiveCookTime: number,
  isDelayed: boolean,
  slaTargetMinutes: number,
): void {
  const existing = map.get(item.itemId);
  if (!existing) {
    map.set(item.itemId, {
      name: item.name,
      category: item.category,
      totalCookingMinutes: effectiveCookTime * item.quantity,
      count: item.quantity,
      delayedCount: isDelayed ? item.quantity : 0,
      slaTargetMinutes,
    });
  } else {
    existing.totalCookingMinutes += effectiveCookTime * item.quantity;
    existing.count += item.quantity;
    if (isDelayed) {
      existing.delayedCount += item.quantity;
    }
  }
}

function processTicketDishes(map: Map<string, DishAccumulator>, t: KdsTicketRecord): void {
  if (t.cancelledAt) return;
  const cookingDuration = computeDurationMinutes(t.startedCookingAt, t.readyAt);
  const isDelayed = isOrderOnTime(t) === false;

  for (const item of t.items) {
    const effectiveCookTime = item.prepTimeMinutes ?? cookingDuration ?? t.slaTargetMinutes;
    recordDishPrep(map, item, effectiveCookTime, isDelayed, t.slaTargetMinutes);
  }
}

function accumulateDishPrepTimes(
  tickets: readonly KdsTicketRecord[],
): Map<string, DishAccumulator> {
  const map = new Map<string, DishAccumulator>();
  for (const t of tickets) {
    processTicketDishes(map, t);
  }
  return map;
}

function formatDishAnalysis(
  itemId: string,
  acc: DishAccumulator,
  thresholdMultiplier: number,
): SlowDishAnalysis {
  const avgCooking = Math.round((acc.totalCookingMinutes / acc.count + Number.EPSILON) * 100) / 100;
  const delayRate = Math.round(((acc.delayedCount / acc.count) * 100 + Number.EPSILON) * 10) / 10;
  const isBottleneck = avgCooking >= acc.slaTargetMinutes * thresholdMultiplier || delayRate >= 35;

  return {
    itemId,
    name: acc.name,
    category: acc.category,
    orderFrequency: acc.count,
    avgCookingMinutes: avgCooking,
    slaTargetMinutes: acc.slaTargetMinutes,
    delayRatePercent: delayRate,
    isBottleneck,
  };
}

/**
 * Surfaces slow-preparing dishes that exceed target durations or have high delay rates.
 */
export function identifySlowDishes(
  tickets: readonly KdsTicketRecord[],
  thresholdMultiplier = 1.2,
): readonly SlowDishAnalysis[] {
  const map = accumulateDishPrepTimes(tickets);
  const results: SlowDishAnalysis[] = [];

  for (const [itemId, acc] of map.entries()) {
    results.push(formatDishAnalysis(itemId, acc, thresholdMultiplier));
  }

  return results.sort((a, b) => b.avgCookingMinutes - a.avgCookingMinutes);
}

interface HourAccumulator {
  ordersCount: number;
  totalCycleMinutes: number;
  delayedCount: number;
}

function recordHourlyTicket(buckets: Map<number, HourAccumulator>, t: KdsTicketRecord): void {
  if (t.cancelledAt) return;
  const date = new Date(t.receivedAt);
  if (Number.isNaN(date.getTime())) return;

  const acc = buckets.get(date.getUTCHours());
  if (!acc) return;

  acc.ordersCount += 1;
  const cycle = computeDurationMinutes(t.receivedAt, t.deliveredAt || t.readyAt);
  if (cycle !== null) {
    acc.totalCycleMinutes += cycle;
  }
  if (isOrderOnTime(t) === false) {
    acc.delayedCount += 1;
  }
}

function accumulateHourlyTicketBuckets(
  tickets: readonly KdsTicketRecord[],
): Map<number, HourAccumulator> {
  const buckets = new Map<number, HourAccumulator>();
  for (let h = 0; h < 24; h += 1) {
    buckets.set(h, { ordersCount: 0, totalCycleMinutes: 0, delayedCount: 0 });
  }
  for (const t of tickets) {
    recordHourlyTicket(buckets, t);
  }
  return buckets;
}

function formatHourlyAnalysis(hour: number, acc: HourAccumulator): HourlyBottleneckAnalysis {
  const avgCycle =
    acc.ordersCount > 0
      ? Math.round((acc.totalCycleMinutes / acc.ordersCount + Number.EPSILON) * 100) / 100
      : 0;
  const delayRate =
    acc.ordersCount > 0
      ? Math.round(((acc.delayedCount / acc.ordersCount) * 100 + Number.EPSILON) * 10) / 10
      : 0;

  const startStr = String(hour).padStart(2, "0");
  const endStr = String((hour + 1) % 24).padStart(2, "0");
  const hourLabel = `${startStr}:00 - ${endStr}:00`;

  const isPeakBottleneck = acc.ordersCount >= 3 && (delayRate >= 30 || avgCycle >= 30);

  return {
    hour,
    hourLabel,
    ordersCount: acc.ordersCount,
    avgTotalCycleMinutes: avgCycle,
    delayedCount: acc.delayedCount,
    delayRatePercent: delayRate,
    isPeakBottleneck,
  };
}

/**
 * Analyzes ticket flow by hour of day (0-23) to highlight peak kitchen bottlenecks.
 */
export function analyzeHourlyBottlenecks(
  tickets: readonly KdsTicketRecord[],
): readonly HourlyBottleneckAnalysis[] {
  const buckets = accumulateHourlyTicketBuckets(tickets);
  const results: HourlyBottleneckAnalysis[] = [];

  for (let h = 0; h < 24; h += 1) {
    const acc = buckets.get(h) || { ordersCount: 0, totalCycleMinutes: 0, delayedCount: 0 };
    results.push(formatHourlyAnalysis(h, acc));
  }

  return results;
}

// ============================================================================
// Core Execution Pipeline: generateKdsPerformanceReport
// ============================================================================

function validateMetricsActor(
  actor: KdsMetricsActor,
  expectedTenantId: string,
): Result<true, DomainError> {
  if (actor.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant '${actor.tenantId}' does not match requested tenant '${expectedTenantId}'`,
      { actorTenantId: actor.tenantId, expectedTenantId },
    );
  }

  if (!AUTHORIZED_KDS_METRICS_ROLES.has(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actor.role}' is not authorized to generate KDS SLA & bottleneck analytics`,
      { role: actor.role },
    );
  }

  return ok(true);
}

function validateMetricsSubscription(
  sub: KdsMetricsSubscription | undefined,
  expectedTenantId: string,
): Result<true, DomainError> {
  if (!sub) return ok(true);

  if (sub.tenantId !== expectedTenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Subscription tenant '${sub.tenantId}' does not match expected tenant '${expectedTenantId}'`,
      { subscriptionTenantId: sub.tenantId, expectedTenantId },
    );
  }

  if (!sub.active) {
    return domainErr(
      "SUBSCRIPTION_INACTIVE",
      "Hotel SaaS subscription is suspended or inactive. Cannot generate KDS metrics.",
      { tenantId: expectedTenantId },
    );
  }

  if (sub.allowKdsAnalytics === false) {
    return domainErr(
      "PLAN_LIMITATION",
      "KDS SLA and bottleneck analytics are not enabled on this subscription tier.",
      { tier: sub.tier },
    );
  }

  return ok(true);
}

/**
 * Generates comprehensive KDS SLA metrics, slow dish diagnostics, peak bottleneck hours,
 * and appends a verified cryptographic SHA-256 hash-chained ImmutableAuditLog entry.
 */
export function generateKdsPerformanceReport(
  input: GenerateKdsReportInput,
): Result<KdsPerformanceReport, DomainError> {
  // 1. Validate tenant isolation
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) return tenantRes;
  const tenantId = tenantRes.value;

  // 2. Validate actor authorization
  const actorRes = validateMetricsActor(input.actor, tenantId);
  if (!actorRes.ok) return actorRes;

  // 3. Validate SaaS subscription entitlement
  const subRes = validateMetricsSubscription(input.subscription, tenantId);
  if (!subRes.ok) return subRes;

  // Filter tickets to current tenant
  const tenantTickets = input.tickets.filter((t) => t.tenantId === tenantId);

  // 4. Compute metrics
  const stageAverages = computeKdsStageAverages(tenantTickets);
  const slaPerformance = computeKdsSlaPerformance(tenantTickets);
  const slowDishes = identifySlowDishes(tenantTickets);
  const hourlyBottlenecks = analyzeHourlyBottlenecks(tenantTickets);

  // Department breakdown
  const departmentBreakdown: Record<KdsDepartment, number> = {
    KITCHEN: 0,
    BAR: 0,
    DESSERT_STATION: 0,
  };

  for (const t of tenantTickets) {
    if (t.department in departmentBreakdown) {
      departmentBreakdown[t.department] += 1;
    }
  }

  const nowIso = new Date().toISOString();
  const periodStart = input.periodStartIso || (tenantTickets[0]?.receivedAt ?? nowIso);
  const periodEnd = input.periodEndIso || nowIso;

  // 5. Append SHA-256 hash-chained ImmutableAuditLog record
  const auditRes = createAuditEntry({
    tenantId,
    actorUserId: input.actor.userId,
    action: "GENERATE_KDS_PERFORMANCE_REPORT",
    entityType: "KdsPerformanceReport",
    entityId: `KDS-REP-${tenantId}-${Date.now()}`,
    isoTs: nowIso,
    afterJson: JSON.stringify({
      totalTicketsProcessed: tenantTickets.length,
      complianceRatePercent: slaPerformance.complianceRatePercent,
      avgTotalCycleMinutes: stageAverages.avgTotalCycleMinutes,
      slowDishesCount: slowDishes.length,
    }),
    prevHash: input.prevAuditHash,
  });

  if (!auditRes.ok) {
    return auditRes;
  }

  return ok({
    tenantId,
    generatedAt: nowIso,
    periodStart,
    periodEnd,
    totalTicketsProcessed: tenantTickets.length,
    departmentBreakdown,
    stageAverages,
    slaPerformance,
    slowDishes,
    hourlyBottlenecks,
    auditEntry: auditRes.value,
  });
}
