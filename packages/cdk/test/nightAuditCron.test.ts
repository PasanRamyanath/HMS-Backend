import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { type NightAuditInput, executeNightAuditCron } from "../lambdas/nightAuditCron.js";

const TEST_TENANT = "tenant-boutique-sigiriya";
const TEST_TIME = "2026-10-18T18:29:00.000Z";

interface MockClientOptions {
  readonly stays?: Array<{
    readonly id: string;
    readonly tenantId: string;
    readonly folioId: string;
    readonly rateTier: "SRI_LANKAN_RESIDENT" | "FOREIGN_NON_RESIDENT";
    readonly mealPlan: "RO" | "BB" | "HB" | "FB" | "ALL_INCLUSIVE";
    readonly adultsCount: number;
    readonly childrenCount: number;
    readonly assignedRoomId: string;
    readonly assignedRoomNumber: string;
    readonly quotedRateAmount: number;
    readonly quotedRateCurrency: string;
    readonly lockedExchangeRate?: number;
  }>;
}

function createMockDocClient(options: MockClientOptions = {}) {
  const sentCommands: Array<{ type: string; input: unknown }> = [];

  const mockClient = {
    send: async (command: { constructor: { name: string }; input: unknown }) => {
      const type = command.constructor.name;
      sentCommands.push({ type, input: command.input });

      if (type === "QueryCommand") {
        return {
          Items: options.stays ?? [],
        };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  return { mockClient, sentCommands };
}

describe("Night Audit & CBSL Exchange Rate Rollover Lambda (nightAuditCron.ts)", () => {
  it("successfully posts nightly room charges, aggregates SLTDA guest nights, and writes audit logs", async () => {
    const { mockClient, sentCommands } = createMockDocClient({
      stays: [
        {
          id: "stay-001",
          tenantId: TEST_TENANT,
          folioId: "folio-001",
          rateTier: "SRI_LANKAN_RESIDENT",
          mealPlan: "HB",
          adultsCount: 2,
          childrenCount: 1,
          assignedRoomId: "room-101",
          assignedRoomNumber: "101",
          quotedRateAmount: 40000,
          quotedRateCurrency: "LKR",
        },
        {
          id: "stay-002",
          tenantId: TEST_TENANT,
          folioId: "folio-002",
          rateTier: "FOREIGN_NON_RESIDENT",
          mealPlan: "BB",
          adultsCount: 2,
          childrenCount: 0,
          assignedRoomId: "room-202",
          assignedRoomNumber: "202",
          quotedRateAmount: 200, // 200 USD @ 310 = 62,000 LKR
          quotedRateCurrency: "USD",
          lockedExchangeRate: 310,
        },
      ],
    });

    const input: NightAuditInput = {
      tenantId: TEST_TENANT,
      auditDate: "2026-10-18",
      cbslUsdRateLkr: 312.0,
    };

    const res = await executeNightAuditCron(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.ok(res.ok, "Expected night audit execution to succeed");
    const out = res.value;

    assert.equal(out.tenantId, TEST_TENANT);
    assert.equal(out.auditDate, "2026-10-18");
    assert.equal(out.checkedInStaysCount, 2);
    assert.equal(out.foliosUpdatedCount, 2);
    assert.equal(out.occupiedRoomsCount, 2);

    // Guest nights tally:
    // stay-001: 2 adults + 1 child = 3 local guest nights
    // stay-002: 2 adults + 0 child = 2 foreign guest nights
    assert.equal(out.localGuestNights, 3);
    assert.equal(out.foreignGuestNights, 2);

    // Revenue tally: 40,000 + (200 * 310 = 62,000) = 102,000 LKR base
    assert.equal(out.totalRoomRevenueLkr, 102000);
    assert.ok(out.totalTaxLkr > 0);
    assert.equal(out.cbslUsdRateLkr, 312.0);

    // Verify TransactWriteCommand was called for each folio update
    const txCommands = sentCommands.filter((c) => c.type === "TransactWriteCommand");
    assert.equal(txCommands.length, 2);

    // Verify NightAuditSummary and CBSL exchange rate PutCommands
    const putCommands = sentCommands.filter((c) => c.type === "PutCommand") as Array<{
      input: { Item: { SK: string } };
    }>;
    const cbslRecord = putCommands.find((c) => c.input.Item.SK === "CBSLRATE#2026-10-18");
    const summaryRecord = putCommands.find((c) => c.input.Item.SK === "NIGHTAUDIT#2026-10-18");
    const auditRecord = putCommands.find((c) => c.input.Item.SK.startsWith("AUDIT#"));

    assert.ok(cbslRecord, "Expected CBSLRATE record");
    assert.ok(summaryRecord, "Expected NIGHTAUDIT summary record");
    assert.ok(auditRecord, "Expected ImmutableAuditLog record");
  });

  it("handles zero checked-in stays gracefully", async () => {
    const { mockClient } = createMockDocClient({ stays: [] });

    const input: NightAuditInput = {
      tenantId: TEST_TENANT,
      auditDate: "2026-10-18",
    };

    const res = await executeNightAuditCron(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.ok(res.ok);
    const out = res.value;
    assert.equal(out.checkedInStaysCount, 0);
    assert.equal(out.foliosUpdatedCount, 0);
    assert.equal(out.totalRoomRevenueLkr, 0);
    assert.equal(out.localGuestNights, 0);
    assert.equal(out.foreignGuestNights, 0);
  });

  it("rejects invalid tenant identifier", async () => {
    const { mockClient } = createMockDocClient();

    const input: NightAuditInput = {
      tenantId: "",
    };

    const res = await executeNightAuditCron(input, {
      docClient: mockClient,
    });

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "VALIDATION_FAILED");
    }
  });
});
