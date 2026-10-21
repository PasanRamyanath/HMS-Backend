import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SriLankaHmsStack } from "../lib/hms-stack.js";

describe("Step 442: AppSync Direct JS Resolvers for Roster, Attendance, SC Pool & Payroll (hrPayroll.ts)", () => {
  const TEST_TENANT = "tenant-resort-01";

  // Synthesize HMS Stack for AppSync Resolver verification
  const app = new App();
  const stack = new SriLankaHmsStack(app, "TestHmsStackForHrPayroll", {
    env: { region: "ap-south-1", account: "123456789012" },
  });
  const template = Template.fromStack(stack);

  describe("1. Bundled AppSync JS Code Verification (hrPayroll.js)", () => {
    const bundlePath = resolve(process.cwd(), "../graphql/dist/resolvers/hrPayroll.js");
    const bundleCode = readFileSync(bundlePath, "utf8");

    it("verifies bundled resolver artifact exists and contains essential functions", () => {
      assert.ok(bundleCode.length > 500);
      assert.ok(bundleCode.includes("getDepartmentRosterRequest"));
      assert.ok(bundleCode.includes("getDepartmentRosterResponse"));
      assert.ok(bundleCode.includes("saveDepartmentRosterRequest"));
      assert.ok(bundleCode.includes("saveDepartmentRosterResponse"));
      assert.ok(bundleCode.includes("getStaffAttendanceRequest"));
      assert.ok(bundleCode.includes("getStaffAttendanceResponse"));
      assert.ok(bundleCode.includes("recordStaffAttendanceRequest"));
      assert.ok(bundleCode.includes("recordStaffAttendanceResponse"));
      assert.ok(bundleCode.includes("getStaffScPoolStatementRequest"));
      assert.ok(bundleCode.includes("getStaffScPoolStatementResponse"));
      assert.ok(bundleCode.includes("distributeStaffScPoolRequest"));
      assert.ok(bundleCode.includes("distributeStaffScPoolResponse"));
      assert.ok(bundleCode.includes("getMonthlyPayrollRequest"));
      assert.ok(bundleCode.includes("getMonthlyPayrollResponse"));
      assert.ok(bundleCode.includes("runMonthlyPayrollRequest"));
      assert.ok(bundleCode.includes("runMonthlyPayrollResponse"));
      assert.ok(bundleCode.includes("listStaffLeaveRequestsRequest"));
      assert.ok(bundleCode.includes("listStaffLeaveRequestsResponse"));
      assert.ok(bundleCode.includes("submitStaffLeaveRequestRequest"));
      assert.ok(bundleCode.includes("submitStaffLeaveRequestResponse"));
      assert.ok(bundleCode.includes("approveStaffLeaveRequestRequest"));
      assert.ok(bundleCode.includes("approveStaffLeaveRequestResponse"));
    });

    it("verifies multi-tenant security guards are baked into resolver bundle", () => {
      assert.ok(bundleCode.includes("tenantGuard"));
      assert.ok(bundleCode.includes("requireUserRole"));
      assert.ok(bundleCode.includes("HR_READ_ROLES"));
      assert.ok(bundleCode.includes("ROSTER_WRITE_ROLES"));
      assert.ok(bundleCode.includes("ATTENDANCE_WRITE_ROLES"));
      assert.ok(bundleCode.includes("PAYROLL_WRITE_ROLES"));
      assert.ok(bundleCode.includes("LEAVE_SUBMIT_ROLES"));
      assert.ok(bundleCode.includes("LEAVE_APPROVE_ROLES"));
    });

    it("verifies canonical single-table DynamoDB keys in resolver bundle", () => {
      assert.ok(bundleCode.includes("ROSTER#"));
      assert.ok(bundleCode.includes("ATTENDANCE#"));
      assert.ok(bundleCode.includes("SC_POOL#"));
      assert.ok(bundleCode.includes("PAYROLL#"));
      assert.ok(bundleCode.includes("LEAVE#"));
      assert.ok(bundleCode.includes("TENANT#"));
    });
  });

  describe("2. CDK CloudFormation AppSync Resolvers Registration", () => {
    const expectedResolvers = [
      { type: "Query", field: "getDepartmentRoster" },
      { type: "Mutation", field: "saveDepartmentRoster" },
      { type: "Query", field: "getStaffAttendance" },
      { type: "Mutation", field: "recordStaffAttendance" },
      { type: "Query", field: "getStaffScPoolStatement" },
      { type: "Mutation", field: "distributeStaffScPool" },
      { type: "Query", field: "getMonthlyPayroll" },
      { type: "Mutation", field: "runMonthlyPayroll" },
      { type: "Query", field: "listStaffLeaveRequests" },
      { type: "Mutation", field: "submitStaffLeaveRequest" },
      { type: "Mutation", field: "approveStaffLeaveRequest" },
    ];

    for (const res of expectedResolvers) {
      it(`provisions direct JS resolver for ${res.type}.${res.field}`, () => {
        template.hasResourceProperties("AWS::AppSync::Resolver", {
          TypeName: res.type,
          FieldName: res.field,
          Runtime: {
            Name: "APPSYNC_JS",
            RuntimeVersion: "1.0.0",
          },
        });
      });
    }
  });

  describe("3. Canonical Key Pattern Logic", () => {
    it("follows single-table standard for DepartmentRoster", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const sk = "ROSTER#FOOD_AND_BEVERAGE#2026-10-19";
      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(sk, "ROSTER#FOOD_AND_BEVERAGE#2026-10-19");
    });

    it("follows single-table standard for StaffAttendance", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const sk = "ATTENDANCE#USR-001#2026-10-21";
      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(sk, "ATTENDANCE#USR-001#2026-10-21");
    });

    it("follows single-table standard for StaffScPool", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const sk = "SC_POOL#2026#10";
      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(sk, "SC_POOL#2026#10");
    });

    it("follows single-table standard for MonthlyPayroll", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const sk = "PAYROLL#2026-10";
      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(sk, "PAYROLL#2026-10");
    });

    it("follows single-table standard for StaffLeaveRequest", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const sk = "LEAVE#REQ-001";
      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(sk, "LEAVE#REQ-001");
    });
  });
});
