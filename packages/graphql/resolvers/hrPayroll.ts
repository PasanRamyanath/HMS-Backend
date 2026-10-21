/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Human Resources, Roster, Attendance & Payroll Operations (hrPayroll.ts)
 *
 * Implements Direct DynamoDB operations for:
 * - Query.getDepartmentRoster
 * - Mutation.saveDepartmentRoster
 * - Query.getStaffAttendance
 * - Mutation.recordStaffAttendance
 * - Query.getStaffScPoolStatement
 * - Mutation.distributeStaffScPool
 * - Query.getMonthlyPayroll
 * - Mutation.runMonthlyPayroll
 * - Query.listStaffLeaveRequests
 * - Mutation.submitStaffLeaveRequest
 * - Mutation.approveStaffLeaveRequest
 *
 * Single-table DynamoDB mapping:
 * DepartmentRoster:
 *   PK: "TENANT#" + tenantId
 *   SK: "ROSTER#" + department + "#" + weekStartDate
 *   GSI1PK: "TENANT#" + tenantId + "#ROSTERS"
 *   GSI1SK: "DEPT#" + department + "#DATE#" + weekStartDate
 *
 * StaffAttendanceRecord:
 *   PK: "TENANT#" + tenantId
 *   SK: "ATTENDANCE#" + userId + "#" + date
 *   GSI1PK: "TENANT#" + tenantId + "#ATTENDANCE"
 *   GSI1SK: "USER#" + userId + "#DATE#" + date
 *
 * StaffScPoolStatement:
 *   PK: "TENANT#" + tenantId
 *   SK: "SC_POOL#" + year + "#" + month
 *   GSI1PK: "TENANT#" + tenantId + "#SC_POOLS"
 *   GSI1SK: "YEAR#" + year + "#MONTH#" + month
 *
 * MonthlyPayrollRun:
 *   PK: "TENANT#" + tenantId
 *   SK: "PAYROLL#" + billingPeriod
 *   GSI1PK: "TENANT#" + tenantId + "#PAYROLL"
 *   GSI1SK: "PERIOD#" + billingPeriod
 *
 * StaffLeaveRequest:
 *   PK: "TENANT#" + tenantId
 *   SK: "LEAVE#" + leaveRequestId
 *   GSI1PK: "TENANT#" + tenantId + "#LEAVES"
 *   GSI1SK: "STATUS#" + status + "#DATE#" + startDate + "#" + leaveRequestId
 */

import { util, type Context } from "@aws-appsync/utils";
import { get, operations, put, query, update } from "@aws-appsync/utils/dynamodb.js";
import type {
  DepartmentRoster,
  MonthlyPayrollRun,
  MutationApproveStaffLeaveRequestArgs,
  MutationDistributeStaffScPoolArgs,
  MutationRecordStaffAttendanceArgs,
  MutationRunMonthlyPayrollArgs,
  MutationSaveDepartmentRosterArgs,
  MutationSubmitStaffLeaveRequestArgs,
  QueryGetDepartmentRosterArgs,
  QueryGetMonthlyPayrollArgs,
  QueryGetStaffAttendanceArgs,
  QueryGetStaffScPoolStatementArgs,
  QueryListStaffLeaveRequestsArgs,
  StaffAttendanceRecord,
  StaffAttendanceSummary,
  StaffLeaveRequest,
  StaffScPoolStatement,
} from "../src/generated/types.js";
import { requireUserRole, tenantGuard } from "./tenantGuard.js";

// ============================================================================
// Authorized Role Constants (RolePermissionMatrix RBAC)
// ============================================================================

export const HR_READ_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FINANCE_CONTROLLER",
  "HR_MANAGER",
  "DEPARTMENT_HEAD",
  "FRONT_DESK",
  "STAFF",
] as const;

export const ROSTER_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "HR_MANAGER",
  "DEPARTMENT_HEAD",
] as const;

export const ATTENDANCE_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "HR_MANAGER",
  "DEPARTMENT_HEAD",
  "FRONT_DESK",
  "STAFF",
] as const;

export const LEAVE_SUBMIT_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "FINANCE_CONTROLLER",
  "HR_MANAGER",
  "DEPARTMENT_HEAD",
  "FRONT_DESK",
  "RESERVATIONIST",
  "EXECUTIVE_CHEF",
  "SOUS_CHEF",
  "LINE_COOK",
  "FNB_CAPTAIN",
  "WAITER",
  "BARTENDER",
  "HOUSEKEEPING_SUPERVISOR",
  "ROOM_ATTENDANT",
  "MAINTENANCE",
  "STORE_KEEPER",
  "POS_CASHIER",
  "STAFF",
] as const;

export const LEAVE_APPROVE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "OPERATIONS_MANAGER",
  "HR_MANAGER",
  "DEPARTMENT_HEAD",
] as const;

export const PAYROLL_WRITE_ROLES = [
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "FINANCE_CONTROLLER",
  "HR_MANAGER",
] as const;

// ============================================================================
// Canonical Single-Table DynamoDB Key Builders
// ============================================================================

export function getDepartmentRosterKey(
  tenantId: string,
  department: string,
  weekStartDate: string,
) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `ROSTER#${department}#${weekStartDate}`,
  };
}

export function getStaffAttendanceKey(tenantId: string, userId: string, date: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `ATTENDANCE#${userId}#${date}`,
  };
}

export function getStaffScPoolKey(tenantId: string, year: number, month: number) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `SC_POOL#${year}#${month}`,
  };
}

export function getMonthlyPayrollKey(tenantId: string, billingPeriod: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `PAYROLL#${billingPeriod}`,
  };
}

export function getStaffLeaveRequestKey(tenantId: string, leaveRequestId: string) {
  return {
    PK: `TENANT#${tenantId}`,
    SK: `LEAVE#${leaveRequestId}`,
  };
}

// ============================================================================
// Department Roster Handlers
// ============================================================================

export function getDepartmentRosterRequest(ctx: Context<QueryGetDepartmentRosterArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HR_READ_ROLES);

  return get({
    key: getDepartmentRosterKey(tenantId, ctx.args.department, ctx.args.weekStartDate),
  });
}

export function getDepartmentRosterResponse(
  ctx: Context<
    QueryGetDepartmentRosterArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    DepartmentRoster
  >,
): DepartmentRoster | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

export function saveDepartmentRosterRequest(ctx: Context<MutationSaveDepartmentRosterArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, ROSTER_WRITE_ROLES);

  const now = util.time.nowISO8601();
  const { department, weekStartDate, entries } = ctx.args.input;
  const id = `ROSTER#${department}#${weekStartDate}`;

  const key = getDepartmentRosterKey(tenantId, department, weekStartDate);

  return put({
    key,
    item: {
      ...key,
      id,
      tenantId,
      department,
      weekStartDate,
      entries,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `TENANT#${tenantId}#ROSTERS`,
      GSI1SK: `DEPT#${department}#DATE#${weekStartDate}`,
    },
  });
}

export function saveDepartmentRosterResponse(
  ctx: Context<
    MutationSaveDepartmentRosterArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    DepartmentRoster
  >,
): DepartmentRoster {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// Staff Attendance Handlers
// ============================================================================

export function getStaffAttendanceRequest(ctx: Context<QueryGetStaffAttendanceArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HR_READ_ROLES);

  const monthPadded = ctx.args.month < 10 ? `0${ctx.args.month}` : `${ctx.args.month}`;

  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: `ATTENDANCE#${ctx.args.userId}#${ctx.args.year}-${monthPadded}` },
    },
    limit: 100,
  });
}

export function getStaffAttendanceResponse(
  ctx: Context<
    QueryGetStaffAttendanceArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: StaffAttendanceRecord[] }
  >,
): StaffAttendanceSummary {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }

  const items = ctx.result?.items ?? [];
  let daysWorked = 0;
  let poyaHolidaysWorked = 0;
  let overtimeHours = 0;

  for (const item of items) {
    if (item.attendanceStatus === "PRESENT" || item.hoursWorked > 0) {
      daysWorked += 1;
    }
    if (item.isPoyaOrHoliday) {
      poyaHolidaysWorked += 1;
    }
    overtimeHours += item.overtimeHours || 0;
  }

  return {
    tenantId: ctx.args.tenantId,
    userId: ctx.args.userId,
    year: ctx.args.year,
    month: ctx.args.month,
    daysWorked,
    poyaHolidaysWorked,
    overtimeHours,
    records: items,
  };
}

export function recordStaffAttendanceRequest(ctx: Context<MutationRecordStaffAttendanceArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, ATTENDANCE_WRITE_ROLES);

  const {
    userId,
    staffName,
    date,
    shiftType,
    clockInTime,
    clockOutTime,
    hoursWorked,
    overtimeHours,
    isPoyaOrHoliday,
    attendanceStatus,
  } = ctx.args.input;

  const id = `ATTENDANCE#${userId}#${date}`;
  const key = getStaffAttendanceKey(tenantId, userId, date);

  return put({
    key,
    item: {
      ...key,
      id,
      tenantId,
      userId,
      staffName,
      date,
      shiftType,
      clockInTime: clockInTime ?? null,
      clockOutTime: clockOutTime ?? null,
      hoursWorked,
      overtimeHours: overtimeHours ?? 0,
      isPoyaOrHoliday: isPoyaOrHoliday ?? false,
      attendanceStatus,
      GSI1PK: `TENANT#${tenantId}#ATTENDANCE`,
      GSI1SK: `USER#${userId}#DATE#${date}`,
    },
  });
}

export function recordStaffAttendanceResponse(
  ctx: Context<
    MutationRecordStaffAttendanceArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    StaffAttendanceRecord
  >,
): StaffAttendanceRecord {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// Service Charge Pool Handlers
// ============================================================================

export function getStaffScPoolStatementRequest(ctx: Context<QueryGetStaffScPoolStatementArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HR_READ_ROLES);

  return get({
    key: getStaffScPoolKey(tenantId, ctx.args.year, ctx.args.month),
  });
}

export function getStaffScPoolStatementResponse(
  ctx: Context<
    QueryGetStaffScPoolStatementArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    StaffScPoolStatement
  >,
): StaffScPoolStatement | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

export function distributeStaffScPoolRequest(ctx: Context<MutationDistributeStaffScPoolArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, PAYROLL_WRITE_ROLES);

  const { year, month, breakageReserveDeductionPct } = ctx.args.input;
  const id = `SC_POOL#${year}#${month}`;
  const key = getStaffScPoolKey(tenantId, year, month);
  const now = util.time.nowISO8601();
  const identity = ctx.identity as { sub?: string } | undefined;

  return put({
    key,
    item: {
      ...key,
      id,
      tenantId,
      year,
      month,
      breakageReserveDeductionPct,
      totalServiceChargeCollectedLkr: 0,
      breakageReserveAmountLkr: 0,
      distributablePoolLkr: 0,
      totalScDisbursedLkr: 0,
      eligibleStaffCount: 0,
      staffShares: [],
      isDisbursed: true,
      authorizedByUserId: identity?.sub ?? "SYSTEM",
      disbursedAt: now,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `TENANT#${tenantId}#SC_POOLS`,
      GSI1SK: `YEAR#${year}#MONTH#${month}`,
    },
  });
}

export function distributeStaffScPoolResponse(
  ctx: Context<
    MutationDistributeStaffScPoolArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    StaffScPoolStatement
  >,
): StaffScPoolStatement {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// Monthly Payroll Handlers
// ============================================================================

export function getMonthlyPayrollRequest(ctx: Context<QueryGetMonthlyPayrollArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HR_READ_ROLES);

  return get({
    key: getMonthlyPayrollKey(tenantId, ctx.args.billingPeriod),
  });
}

export function getMonthlyPayrollResponse(
  ctx: Context<
    QueryGetMonthlyPayrollArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MonthlyPayrollRun
  >,
): MonthlyPayrollRun | null {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result ?? null;
}

export function runMonthlyPayrollRequest(ctx: Context<MutationRunMonthlyPayrollArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, PAYROLL_WRITE_ROLES);

  const { billingPeriod } = ctx.args.input;
  const id = `PAYROLL#${billingPeriod}`;
  const key = getMonthlyPayrollKey(tenantId, billingPeriod);
  const now = util.time.nowISO8601();

  return put({
    key,
    item: {
      ...key,
      id,
      tenantId,
      billingPeriod,
      totalGrossEarningsLkr: 0,
      totalNetPayLkr: 0,
      totalEmployeeEpf8Lkr: 0,
      totalEmployerEpf12Lkr: 0,
      totalEmployerEtf3Lkr: 0,
      totalServiceChargeDisbursedLkr: 0,
      slips: [],
      isFinalized: true,
      createdAt: now,
      updatedAt: now,
      GSI1PK: `TENANT#${tenantId}#PAYROLL`,
      GSI1SK: `PERIOD#${billingPeriod}`,
    },
  });
}

export function runMonthlyPayrollResponse(
  ctx: Context<
    MutationRunMonthlyPayrollArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    MonthlyPayrollRun
  >,
): MonthlyPayrollRun {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

// ============================================================================
// Staff Leave Request Handlers
// ============================================================================

export function listStaffLeaveRequestsRequest(ctx: Context<QueryListStaffLeaveRequestsArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, HR_READ_ROLES);

  if (ctx.args.status) {
    return query({
      query: {
        GSI1PK: { eq: `TENANT#${tenantId}#LEAVES` },
        GSI1SK: { beginsWith: `STATUS#${ctx.args.status}` },
      },
      index: "GSI1",
      limit: 100,
    });
  }

  return query({
    query: {
      PK: { eq: `TENANT#${tenantId}` },
      SK: { beginsWith: "LEAVE#" },
    },
    limit: 100,
  });
}

export function listStaffLeaveRequestsResponse(
  ctx: Context<
    QueryListStaffLeaveRequestsArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    { items?: StaffLeaveRequest[] }
  >,
): StaffLeaveRequest[] {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result?.items ?? [];
}

export function submitStaffLeaveRequestRequest(ctx: Context<MutationSubmitStaffLeaveRequestArgs>) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, LEAVE_SUBMIT_ROLES);

  const {
    userId,
    staffName,
    epfNo,
    leaveType,
    startDate,
    endDate,
    isHalfDay,
    requestedDays,
    reason,
    relieverStaffId,
  } = ctx.args.input;

  const leaveId = util.autoId();
  const id = `LEAVE#${leaveId}`;
  const key = getStaffLeaveRequestKey(tenantId, leaveId);
  const now = util.time.nowISO8601();

  return put({
    key,
    item: {
      ...key,
      id,
      tenantId,
      userId,
      staffName,
      epfNo,
      leaveType,
      startDate,
      endDate,
      isHalfDay: isHalfDay ?? false,
      requestedDays,
      reason,
      relieverStaffId: relieverStaffId ?? null,
      status: "PENDING",
      appliedAt: now,
      approvedByName: null,
      approvedAt: null,
      GSI1PK: `TENANT#${tenantId}#LEAVES`,
      GSI1SK: `STATUS#PENDING#DATE#${startDate}#${id}`,
    },
  });
}

export function submitStaffLeaveRequestResponse(
  ctx: Context<
    MutationSubmitStaffLeaveRequestArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    StaffLeaveRequest
  >,
): StaffLeaveRequest {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}

export function approveStaffLeaveRequestRequest(
  ctx: Context<MutationApproveStaffLeaveRequestArgs>,
) {
  const tenantId = tenantGuard(ctx, ctx.args.tenantId);
  requireUserRole(ctx, LEAVE_APPROVE_ROLES);

  const { leaveRequestId, status, managerNotes } = ctx.args.input;
  const key = getStaffLeaveRequestKey(tenantId, leaveRequestId);
  const now = util.time.nowISO8601();
  const identity = ctx.identity as { claims?: { name?: string } } | undefined;
  const approverName = identity?.claims?.name ?? "Hotel Manager";

  const updateActions: Record<string, unknown> = {
    status: operations.replace(status),
    approvedByName: operations.replace(approverName),
    approvedAt: operations.replace(now),
    updatedAt: operations.replace(now),
    GSI1SK: operations.replace(`STATUS#${status}#${leaveRequestId}`),
  };

  if (managerNotes) {
    updateActions.managerNotes = operations.replace(managerNotes);
  }

  return update({
    key,
    update: updateActions,
  });
}

export function approveStaffLeaveRequestResponse(
  ctx: Context<
    MutationApproveStaffLeaveRequestArgs,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    StaffLeaveRequest
  >,
): StaffLeaveRequest {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
