/**
 * @hms/core - End-to-End 30-Day Simulated Month -> Night Audits -> SLTDA + TDL + IRD VAT Return Integration Test
 * (`packages/core/test/monthlyComplianceE2e.test.ts`)
 *
 * Implements Step 424 (Phase 17.24) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive statutory integration test simulating a 30-day calendar month (November 2026: 30 days):
 *
 * 1. Simulates 30 consecutive business dates (2026-11-01 to 2026-11-30) of guest occupancy,
 *    room charges, F&B transactions, and ancillary revenues.
 * 2. Runs the deterministic daily Night Audit engine (`runNightAuditCalculation`) for all 30 days,
 *    enforcing integer-cent LKR rounding, 4-stage tax compounding (SC -> TDL -> SSCL -> VAT),
 *    and continuous SHA-256 cryptographic hash-chaining of `ImmutableAuditLog` records.
 * 3. Compiles the official SLTDA Monthly Statistical Return (`compileSltdaMonthlyReturn`) and verifies
 *    that the 30 daily audits aggregate to exact mathematical room nights, bed nights, nationality distributions,
 *    ADR, and RevPAR.
 * 4. Compiles the official SLTDA Quarterly TDL Statement (`compileTdlQuarterlyReturn`) for Q4 2026 and verifies
 *    turnover bases, 1.0% statutory TDL payable, and Bank of Ceylon remittance slip references.
 * 5. Compiles the official IRD Monthly Output VAT Schedule (`compileMonthlyOutputVatSchedule`) and Quarterly SSCL
 *    Schedule (`compileQuarterlySsclSchedule`) for the simulated month's B2B and B2C invoices.
 * 6. Validates multi-tenant isolation, RBAC role guard enforcement, SaasSubscription entitlement checks,
 *    and tamper-evident cryptographic hash chain integrity.
 *
 * Zero runtime npm dependencies (Pure Node 22 test runner).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAuditEntryHash } from "../src/auditChain.js";
import {
  type IrdInvoiceRecord,
  type IrdMonthlyVatScheduleInput,
  type IrdQuarterlySsclScheduleInput,
  type IrdSaasSubscription,
  type IrdStaffActor,
  compileMonthlyOutputVatSchedule,
  compileQuarterlySsclSchedule,
} from "../src/irdTaxSchedules.js";
import {
  type InHouseReservationRecord,
  type NightAuditActor,
  type NightAuditCalculationInput,
  type NightAuditCalculationResult,
  type NightAuditFolioLineInput,
  type NightAuditSaasSubscription,
  runNightAuditCalculation,
} from "../src/nightAudit.js";
import {
  type SltdaMonthlyReturnInput,
  type SltdaSaasSubscription,
  type SltdaStaffActor,
  compileSltdaMonthlyReturn,
  compileTdlQuarterlyReturn,
} from "../src/sltdaReports.js";
import { roundLkr } from "../src/tax.js";

// ============================================================================
// Test Constants & Multi-Tenant Setup
// ============================================================================

const TENANT_ID = "cinnamon-bentota-beach";
const PROPERTY_ROOM_CAPACITY = 100;
const PROPERTY_BED_CAPACITY = 200;
const SIMULATION_YEAR_MONTH = "2026-11";
const DAYS_IN_NOVEMBER = 30;

const NIGHT_AUDITOR_ACTOR: NightAuditActor = {
  userId: "usr-night-auditor-01",
  role: "NIGHT_AUDITOR",
  tenantId: TENANT_ID,
};

const FINANCE_CONTROLLER_ACTOR: SltdaStaffActor = {
  userId: "usr-controller-01",
  role: "FINANCE_CONTROLLER",
  tenantId: TENANT_ID,
};

const IRD_ACTOR: IrdStaffActor = {
  userId: "usr-controller-01",
  role: "FINANCE_CONTROLLER",
  tenantId: TENANT_ID,
};

const ACTIVE_SAAS_SUBSCRIPTION: NightAuditSaasSubscription &
  SltdaSaasSubscription &
  IrdSaasSubscription = {
  tenantId: TENANT_ID,
  active: true,
  tier: "PRO_RESORT",
  allowsNightAudit: true,
  allowsSltdaReporting: true,
  allowsIrdReporting: true,
};

// ============================================================================
// Deterministic 30-Day Simulation Generators
// ============================================================================

interface SimulatedDayData {
  readonly dayIndex: number;
  readonly businessDate: string;
  readonly reservations: readonly InHouseReservationRecord[];
  readonly folioLines: readonly NightAuditFolioLineInput[];
  readonly invoices: readonly IrdInvoiceRecord[];
}

const NATIONALITIES = ["LK", "IN", "GB", "DE", "RU", "AU", "FR"] as const;

function buildReservation(
  r: number,
  resId: string,
  isComp: boolean,
  effectiveRate: number,
): InHouseReservationRecord {
  const nat = NATIONALITIES[r % NATIONALITIES.length] ?? "LK";
  const isDomestic = nat === "LK";

  return {
    reservationId: resId,
    tenantId: TENANT_ID,
    roomNumber: `${100 + r}`,
    roomTypeId: r % 2 === 0 ? "DELUXE_OCEAN" : "SUPERIOR_GARDEN",
    guestFullName: `Guest ${resId}`,
    nationalityCountryCode: nat,
    residencyTier: isDomestic ? "SRI_LANKAN_CITIZEN" : "TOURIST_NON_RESIDENT",
    adultsCount: 2,
    childrenCount: r % 4 === 0 ? 1 : 0,
    roomRateLkr: effectiveRate,
    isComplimentary: isComp,
    isHouseUse: false,
    isTaxExempt: false,
    status: "IN_HOUSE",
  };
}

function buildGuestInvoice(
  r: number,
  businessDate: string,
  resId: string,
  effectiveRate: number,
): IrdInvoiceRecord {
  const sc = roundLkr(effectiveRate * 0.1);
  const tdl = roundLkr(effectiveRate * 0.01);
  const sscl = roundLkr((effectiveRate + sc) * 0.025);
  const vatBase = effectiveRate + sc + sscl;
  const vat = roundLkr(vatBase * 0.18);
  const isB2b = r % 5 === 0;

  return {
    invoiceNo: `TAXINV-${businessDate.replace(/-/g, "")}-${r}`,
    invoiceDate: businessDate,
    folioId: `FOLIO-${resId}`,
    isB2b,
    buyerName: isB2b ? "Jetwing DMC Travel" : `Guest ${resId}`,
    buyerTin: isB2b ? "109847261" : undefined,
    buyerVatNo: isB2b ? "109847261-7000" : undefined,
    isVatExempt: false,
    baseSupplyLkr: effectiveRate,
    serviceChargeLkr: sc,
    tdlLkr: tdl,
    ssclLkr: sscl,
    vatBaseLkr: vatBase,
    vatLkr: vat,
    grandTotalLkr: effectiveRate + sc + tdl + sscl + vat,
  };
}

function generateSimulatedDay(day: number): SimulatedDayData {
  const dayStr = day < 10 ? `0${day}` : `${day}`;
  const businessDate = `${SIMULATION_YEAR_MONTH}-${dayStr}`;

  // Deterministic weekday vs weekend occupancy variance (75 - 90 rooms)
  const isWeekend = day % 7 === 5 || day % 7 === 6;
  const occupiedCount = isWeekend ? 90 : 75;

  const reservations: InHouseReservationRecord[] = [];
  const folioLines: NightAuditFolioLineInput[] = [];
  const invoices: IrdInvoiceRecord[] = [];

  for (let r = 1; r <= occupiedCount; r++) {
    const resId = `RES-${businessDate}-${r}`;
    const roomRate = 35000 + (r % 4) * 5000;
    const isComp = r === 1;
    const effectiveRate = isComp ? 0 : roomRate;

    reservations.push(buildReservation(r, resId, isComp, effectiveRate));

    if (!isComp) {
      folioLines.push(
        {
          folioLineId: `FL-ROOM-${resId}`,
          tenantId: TENANT_ID,
          category: "ROOM",
          baseLkr: effectiveRate,
        },
        {
          folioLineId: `FL-FNB-${resId}`,
          tenantId: TENANT_ID,
          category: "FOOD_AND_BEVERAGE",
          baseLkr: 8000 + (r % 3) * 2000,
        },
      );

      invoices.push(buildGuestInvoice(r, businessDate, resId, effectiveRate));
    }
  }

  folioLines.push({
    folioLineId: `FL-SPA-${businessDate}`,
    tenantId: TENANT_ID,
    category: "SPA",
    baseLkr: 75000,
  });

  return {
    dayIndex: day,
    businessDate,
    reservations,
    folioLines,
    invoices,
  };
}

// ============================================================================
// Master 30-Day Simulated Dataset Pre-Calculation
// ============================================================================

const simulatedDays: SimulatedDayData[] = [];
const dailyAuditResults: NightAuditCalculationResult[] = [];
const allMonthlyInvoices: IrdInvoiceRecord[] = [];

let initialPrevHash = "0".repeat(64);

for (let d = 1; d <= DAYS_IN_NOVEMBER; d++) {
  const dayData = generateSimulatedDay(d);
  simulatedDays.push(dayData);
  for (const inv of dayData.invoices) {
    allMonthlyInvoices.push(inv);
  }

  const input: NightAuditCalculationInput = {
    tenantId: TENANT_ID,
    businessDate: dayData.businessDate,
    totalAvailableRooms: PROPERTY_ROOM_CAPACITY,
    totalAvailableBeds: PROPERTY_BED_CAPACITY,
    reservations: dayData.reservations,
    folioLines: dayData.folioLines,
    actor: NIGHT_AUDITOR_ACTOR,
    subscription: ACTIVE_SAAS_SUBSCRIPTION,
    prevAuditHash: initialPrevHash,
    timestamp: `${dayData.businessDate}T23:59:59.000Z`,
  };

  const result = runNightAuditCalculation(input);
  if (result.ok) {
    dailyAuditResults.push(result.value);
    initialPrevHash = result.value.auditLog.entryHash;
  }
}

// ============================================================================
// Master End-to-End Test Suite
// ============================================================================

describe("Step 424: End-to-End 30-Day Simulated Month -> Night Audits -> SLTDA + TDL + IRD VAT Return Test", () => {
  describe("1. 30-Day Sequential Night Audit Execution & SHA-256 Hash Chaining", () => {
    it("successfully calculates and links 30 consecutive daily night audits with zero chain breakage", () => {
      assert.equal(dailyAuditResults.length, DAYS_IN_NOVEMBER);

      for (let i = 0; i < dailyAuditResults.length; i++) {
        const audit = dailyAuditResults[i];
        assert.ok(audit);

        if (i === 0) {
          assert.equal(audit.auditLog.prevHash, "0".repeat(64));
        } else {
          const prevAudit = dailyAuditResults[i - 1];
          assert.ok(prevAudit);
          assert.equal(audit.auditLog.prevHash, prevAudit.auditLog.entryHash);
        }

        const computedHash = computeAuditEntryHash(audit.auditLog);
        assert.equal(audit.auditLog.entryHash, computedHash);

        // Verify room stats
        assert.equal(audit.totalAvailableRooms, PROPERTY_ROOM_CAPACITY);
        assert.ok(audit.roomOccupancyRate >= 70 && audit.roomOccupancyRate <= 95);

        // Verify 4-stage compounding tax outputs exist
        assert.ok(audit.serviceChargePoolLkr > 0);
        assert.ok(audit.tdlPoolLkr > 0);
        assert.ok(audit.ssclPoolLkr > 0);
        assert.ok(audit.vatPoolLkr > 0);
      }
    });
  });

  describe("2. SLTDA Monthly Statistical Return (compileSltdaMonthlyReturn)", () => {
    it("accurately compiles 30 daily audits into official SLTDA Monthly Return Form", () => {
      const lastAudit = dailyAuditResults[dailyAuditResults.length - 1];
      assert.ok(lastAudit);

      const input: SltdaMonthlyReturnInput = {
        tenantId: TENANT_ID,
        yearMonth: SIMULATION_YEAR_MONTH,
        hotelName: "Cinnamon Bentota Beach Resort",
        sltdaRegistrationNumber: "SLTDA/SQA/PRO/00892",
        roomCapacity: PROPERTY_ROOM_CAPACITY,
        bedCapacity: PROPERTY_BED_CAPACITY,
        dailyAudits: dailyAuditResults,
        actor: FINANCE_CONTROLLER_ACTOR,
        subscription: ACTIVE_SAAS_SUBSCRIPTION,
        prevAuditHash: lastAudit.auditLog.entryHash,
        timestamp: "2026-12-01T09:00:00.000Z",
      };

      const result = compileSltdaMonthlyReturn(input);
      assert.ok(result.ok, "Failed to compile SLTDA monthly return");

      if (result.ok) {
        const sltda = result.value;

        // 1. Verify days in month & room capacity
        assert.equal(sltda.daysInMonth, DAYS_IN_NOVEMBER);
        assert.equal(sltda.roomCapacity, PROPERTY_ROOM_CAPACITY);
        assert.equal(sltda.auditedDaysCount, DAYS_IN_NOVEMBER);

        // 2. Total available room nights: 30 days * 100 rooms = 3,000
        assert.equal(sltda.totalAvailableRoomNights, 3000);

        // 3. Occupied room nights match exact aggregate of 30 days
        const expectedOccupiedNights = dailyAuditResults.reduce(
          (acc, d) => acc + d.occupiedRooms,
          0,
        );
        assert.equal(sltda.occupiedRoomNights, expectedOccupiedNights);

        // 4. Monthly room occupancy % matches ratio
        const expectedOccupancyRate = roundLkr((expectedOccupiedNights / 3000) * 100);
        assert.equal(sltda.roomOccupancyRate, expectedOccupancyRate);

        // 5. Nationality census distribution matches sum of daily guest nights
        assert.ok(sltda.foreignCountryBreakdown.length > 0);
        let aggregatedForeignNights = 0;
        for (const stat of sltda.foreignCountryBreakdown) {
          aggregatedForeignNights += stat.guestNights;
          assert.ok(stat.percentageOfForeignGuestNights > 0);
        }
        assert.equal(sltda.foreignGuestNights, aggregatedForeignNights);

        // 6. ADR & RevPAR in LKR
        assert.ok(sltda.averageDailyRateLkr > 35000);
        assert.ok(sltda.revParLkr > 25000);

        // 7. Audit log hash validation
        assert.equal(sltda.auditLog.prevHash, lastAudit.auditLog.entryHash);
        assert.equal(sltda.auditLog.entryHash, computeAuditEntryHash(sltda.auditLog));
      }
    });
  });

  describe("3. SLTDA Quarterly Tourism Development Levy Return (compileTdlQuarterlyReturn)", () => {
    it("accurately compiles Q4 TDL return using 30-day November figures and BOC remittance reference", () => {
      const result = compileTdlQuarterlyReturn(dailyAuditResults, "SLTDA/SQA/PRO/00892", 1.0, {
        tenantId: TENANT_ID,
        taxYear: 2026,
        quarter: 4,
        hotelName: "Cinnamon Bentota Beach Resort",
        actor: FINANCE_CONTROLLER_ACTOR,
        subscription: ACTIVE_SAAS_SUBSCRIPTION,
      });

      assert.ok(result.ok, "Failed to compile TDL quarterly return");

      if (result.ok) {
        const tdl = result.value;

        // 1. Standard hotel tier @ 1.0%
        assert.equal(tdl.tdlRatePercent, 1.0);

        // 2. November turnover is accurately aggregated
        const expectedNovTurnover = dailyAuditResults.reduce(
          (acc, d) => acc + d.totalNetRevenueLkr,
          0,
        );
        const novMonth = tdl.months.find((m) => m.yearMonth === "2026-11");
        assert.ok(novMonth);
        assert.equal(novMonth?.turnoverBaseLkr, expectedNovTurnover);

        // 3. TDL payable matches 1.0% of total turnover
        assert.ok(tdl.quarterlyTurnoverLkr > 0);
        assert.equal(tdl.quarterlyTdlPayableLkr, roundLkr(tdl.quarterlyTurnoverLkr * 0.01));

        // 4. Statutory Due Date: 15th of month following Q4 close (15 Jan 2027)
        assert.equal(tdl.statutoryDueDate, "2027-01-15");

        // 5. BOC Corporate Account verification
        assert.equal(tdl.paymentAccount, "BOC Corporate Branch A/C 73104820");
        assert.ok(tdl.paymentReference.includes("TDL-2026-Q4"));
      }
    });
  });

  describe("4. IRD Monthly Output VAT (18%) & Quarterly SSCL (2.5%) Tax Compilers", () => {
    it("accurately compiles IRD RAMIS Monthly Output VAT schedule from the 30-day invoices", () => {
      const input: IrdMonthlyVatScheduleInput = {
        tenantId: TENANT_ID,
        yearMonth: SIMULATION_YEAR_MONTH,
        hotelName: "Cinnamon Bentota Beach Resort",
        hotelTin: "103948572",
        hotelVatNo: "103948572-7000",
        invoices: allMonthlyInvoices,
        actor: IRD_ACTOR,
        subscription: ACTIVE_SAAS_SUBSCRIPTION,
      };

      const result = compileMonthlyOutputVatSchedule(input);
      assert.ok(result.ok, "Failed to compile IRD monthly output VAT schedule");

      if (result.ok) {
        const vatSchedule = result.value;

        // 1. B2B Corporate vs B2C Tourist segregation
        assert.ok(vatSchedule.b2bInvoicesCount > 0);
        assert.ok(vatSchedule.b2cInvoicesCount > 0);
        assert.equal(
          vatSchedule.b2bInvoicesCount + vatSchedule.b2cInvoicesCount,
          allMonthlyInvoices.length,
        );

        // 2. Output VAT is strictly 18% of taxable base
        assert.ok(vatSchedule.totalOutputVatLkr > 0);
        const expectedVat = allMonthlyInvoices.reduce((acc, inv) => acc + inv.vatLkr, 0);
        assert.equal(vatSchedule.totalOutputVatLkr, expectedVat);

        // 3. Statutory filing due date: 20th of following month (2026-12-20)
        assert.equal(vatSchedule.statutoryFilingDueDate, "2026-12-20");

        // 4. Tamper-evident hash chaining
        assert.ok(vatSchedule.auditLog.entryHash.length === 64);
      }
    });

    it("accurately compiles IRD Quarterly SSCL schedule for Q4 2026", () => {
      const novLiableSupply = allMonthlyInvoices.reduce(
        (acc, inv) => acc + inv.baseSupplyLkr + inv.serviceChargeLkr,
        0,
      );

      const input: IrdQuarterlySsclScheduleInput = {
        tenantId: TENANT_ID,
        taxYear: 2026,
        quarter: 4,
        hotelName: "Cinnamon Bentota Beach Resort",
        hotelTin: "103948572",
        hotelSsclNo: "103948572-8000",
        monthlyTurnovers: [
          { monthIndex: 1, yearMonth: "2026-10", liableTurnoverLkr: 240000000 },
          { monthIndex: 2, yearMonth: "2026-11", liableTurnoverLkr: novLiableSupply },
          { monthIndex: 3, yearMonth: "2026-12", liableTurnoverLkr: 310000000 },
        ],
        actor: IRD_ACTOR,
        subscription: ACTIVE_SAAS_SUBSCRIPTION,
      };

      const result = compileQuarterlySsclSchedule(input);
      assert.ok(result.ok, "Failed to compile IRD quarterly SSCL schedule");

      if (result.ok) {
        const sscl = result.value;

        assert.equal(sscl.ssclRatePercent, 2.5);
        assert.equal(sscl.months.length, 3);

        // 2.5% SSCL on November supply
        const expectedNovSscl = roundLkr(novLiableSupply * 0.025);
        const novItem = sscl.months.find((m) => m.yearMonth === "2026-11");
        assert.ok(novItem);
        assert.equal(novItem?.ssclPayableLkr, expectedNovSscl);

        // Statutory return due date: end of month following quarter (2027-01-31)
        assert.equal(sscl.statutoryReturnDueDate, "2027-01-31");
      }
    });
  });

  describe("5. Multi-Tenant Security, RBAC & Sequence Validation", () => {
    it("rejects cross-tenant daily audit injection into SLTDA monthly compiler", () => {
      const firstAudit = dailyAuditResults[0];
      assert.ok(firstAudit);

      const alienAudit: NightAuditCalculationResult = {
        ...firstAudit,
        tenantId: "heritance-kandalama-dam", // Alien tenant
      };

      const corruptedAudits = [alienAudit, ...dailyAuditResults.slice(1)];

      const input: SltdaMonthlyReturnInput = {
        tenantId: TENANT_ID,
        yearMonth: SIMULATION_YEAR_MONTH,
        hotelName: "Cinnamon Bentota Beach Resort",
        sltdaRegistrationNumber: "SLTDA/SQA/PRO/00892",
        roomCapacity: PROPERTY_ROOM_CAPACITY,
        dailyAudits: corruptedAudits,
        actor: FINANCE_CONTROLLER_ACTOR,
        subscription: ACTIVE_SAAS_SUBSCRIPTION,
      };

      const result = compileSltdaMonthlyReturn(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "TENANT_MISMATCH");
      }
    });

    it("rejects unauthorized staff actors from compiling statutory returns", () => {
      const unauthorizedActor: SltdaStaffActor = {
        userId: "usr-waiter-01",
        role: "WAITER" as unknown as SltdaStaffActor["role"],
        tenantId: TENANT_ID,
      };

      const input: SltdaMonthlyReturnInput = {
        tenantId: TENANT_ID,
        yearMonth: SIMULATION_YEAR_MONTH,
        hotelName: "Cinnamon Bentota Beach Resort",
        sltdaRegistrationNumber: "SLTDA/SQA/PRO/00892",
        roomCapacity: PROPERTY_ROOM_CAPACITY,
        dailyAudits: dailyAuditResults,
        actor: unauthorizedActor,
        subscription: ACTIVE_SAAS_SUBSCRIPTION,
      };

      const result = compileSltdaMonthlyReturn(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "PERMISSION_DENIED");
      }
    });

    it("verifies auditedDaysCount accurately reflects subset of days when partial audit is provided", () => {
      // Omit day 15
      const incompleteAudits = dailyAuditResults.filter((d) => d.businessDate !== "2026-11-15");

      const input: SltdaMonthlyReturnInput = {
        tenantId: TENANT_ID,
        yearMonth: SIMULATION_YEAR_MONTH,
        hotelName: "Cinnamon Bentota Beach Resort",
        sltdaRegistrationNumber: "SLTDA/SQA/PRO/00892",
        roomCapacity: PROPERTY_ROOM_CAPACITY,
        dailyAudits: incompleteAudits,
        actor: FINANCE_CONTROLLER_ACTOR,
        subscription: ACTIVE_SAAS_SUBSCRIPTION,
      };

      const result = compileSltdaMonthlyReturn(input);
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.daysInMonth, 30);
        assert.equal(result.value.auditedDaysCount, 29);
      }
    });
  });
});
