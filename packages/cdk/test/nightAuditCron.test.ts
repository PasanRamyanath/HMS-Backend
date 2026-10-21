import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DEFAULT_CBSL_USD_LKR,
  type MorningFlashEmailParams,
  type MorningFlashEmailResult,
  type MorningFlashSmsParams,
  type MorningFlashSmsResult,
  type NightAuditDependencies,
  type NightAuditInput,
  type NightAuditOutput,
  executeNightAuditCron,
  formatMorningFlashEmail,
  formatMorningFlashSms,
  formatShortLkr,
  handler,
} from "../lambdas/nightAuditCron.js";

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

describe("Night Audit & Morning Flash SMS/Email Summary (nightAuditCron.ts)", () => {
  it("formats short LKR numbers accurately for SMS economy", () => {
    assert.equal(formatShortLkr(0), "0");
    assert.equal(formatShortLkr(850), "850");
    assert.equal(formatShortLkr(1200), "1k");
    assert.equal(formatShortLkr(420000), "420k");
    assert.equal(formatShortLkr(1500000), "1.5M");
    assert.equal(formatShortLkr(2000000), "2M");
  });

  it("formats 160-char morning flash SMS within GSM-7 single-segment limit", () => {
    const params: MorningFlashSmsParams = {
      hotelName: "Hotel Sigiriya",
      auditDate: "2026-10-18",
      occupiedRooms: 14,
      totalRooms: 18,
      roomRevenueLkr: 420000,
      fbRevenueLkr: 115000,
    };

    const res: MorningFlashSmsResult = formatMorningFlashSms(params);
    assert.equal(
      res.text,
      "[Hotel Sigiriya] Night Audit: Occ 78% (14/18), Room LKR 420k, F&B LKR 115k, Total LKR 535k",
    );
    assert.ok(res.charCount <= 160);
    assert.equal(res.isSingleSegment, true);

    // Test truncation with extraordinarily long hotel names
    const longParams: MorningFlashSmsParams = {
      hotelName: "Super Ultra Luxury Boutique Resort & Spa Ceylon Colombo",
      auditDate: "2026-10-18",
      occupiedRooms: 5,
      totalRooms: 10,
      roomRevenueLkr: 250000,
      fbRevenueLkr: 50000,
    };
    const longRes = formatMorningFlashSms(longParams);
    assert.ok(longRes.charCount <= 160);
    assert.equal(longRes.isSingleSegment, true);
    assert.ok(longRes.text.includes("..."));
  });

  it("formats Apple HIG morning flash email with HTML, text, and tax breakdown", () => {
    const params: MorningFlashEmailParams = {
      hotelName: "Sigiriya Villa",
      tenantId: TEST_TENANT,
      auditDate: "2026-10-18",
      occupiedRooms: 10,
      totalRooms: 20,
      roomRevenueLkr: 300000,
      fbRevenueLkr: 75000,
      totalTaxLkr: 98000,
      localGuestNights: 8,
      foreignGuestNights: 12,
      cbslUsdRateLkr: DEFAULT_CBSL_USD_LKR,
    };

    const email: MorningFlashEmailResult = formatMorningFlashEmail(params);
    assert.ok(email.subject.includes("[Sigiriya Villa]"));
    assert.ok(email.subject.includes("2026-10-18"));
    assert.ok(email.text.includes("Occupancy: 50% (10 / 20 rooms occupied)"));
    assert.ok(email.text.includes("Room Revenue: LKR 300,000"));
    assert.ok(email.text.includes("F&B Revenue: LKR 75,000"));
    assert.ok(email.text.includes("Total Net Revenue: LKR 375,000"));
    assert.ok(email.text.includes("Compounding Statutory Taxes: LKR 98,000"));
    assert.ok(email.text.includes("CBSL USD Buying Rollover Rate: LKR 310.50"));
    assert.ok(email.html.includes("Executive Morning Brief"));
    assert.ok(email.html.includes("Sigiriya Villa"));
    assert.ok(email.html.includes("tabular-nums"));
  });

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
      totalRoomsInventory: 10,
      fbRevenueLkr: 25000,
    };

    const deps: NightAuditDependencies = {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    };

    const res = await executeNightAuditCron(input, deps);

    assert.ok(res.ok, "Expected night audit execution to succeed");
    const out: NightAuditOutput = res.value;

    assert.equal(out.tenantId, TEST_TENANT);
    assert.equal(out.auditDate, "2026-10-18");
    assert.equal(out.checkedInStaysCount, 2);
    assert.equal(out.foliosUpdatedCount, 2);
    assert.equal(out.occupiedRoomsCount, 2);
    assert.equal(out.totalRoomsInventory, 10);
    assert.equal(out.occupancyRatePercent, 20); // 2 / 10 = 20%
    assert.equal(out.fbRevenueLkr, 25000);
    assert.equal(out.totalGrossRevenueLkr, 127000); // 102k + 25k

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

  it("dispatches automated 160-char morning flash SMS and email summary to hotel owner", async () => {
    let capturedSms:
      | { readonly toMobile: string; readonly text: string; readonly senderId?: string | undefined }
      | undefined;
    let capturedEmail: { to: string; subject: string; html: string; text: string } | undefined;

    const { mockClient, sentCommands } = createMockDocClient({
      stays: [
        {
          id: "stay-001",
          tenantId: TEST_TENANT,
          folioId: "folio-001",
          rateTier: "SRI_LANKAN_RESIDENT",
          mealPlan: "BB",
          adultsCount: 2,
          childrenCount: 0,
          assignedRoomId: "room-101",
          assignedRoomNumber: "101",
          quotedRateAmount: 50000,
          quotedRateCurrency: "LKR",
        },
      ],
    });

    const input: NightAuditInput = {
      tenantId: TEST_TENANT,
      hotelName: "Boutique Sigiriya",
      auditDate: "2026-10-19",
      totalRoomsInventory: 5,
      ownerMobile: "0771234567",
      ownerEmail: "gm@boutiquesigiriya.lk",
      fbRevenueLkr: 15000,
    };

    const deps: NightAuditDependencies = {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
      smsSenderId: "SIGIRIYA",
      smsSenderFn: async (params) => {
        capturedSms = params;
        return { success: true, messageId: "SMS-TEST-9988" };
      },
      emailSenderFn: async (params) => {
        capturedEmail = params;
        return { success: true, messageId: "EMAIL-TEST-7766" };
      },
    };

    const res = await executeNightAuditCron(input, deps);
    assert.ok(res.ok);
    const out = res.value;

    assert.ok(out.morningFlashSms);
    assert.equal(out.morningFlashSms.dispatched, true);
    assert.equal(out.morningFlashSms.recipientMobile, "94771234567");
    assert.equal(out.morningFlashSms.messageId, "SMS-TEST-9988");
    assert.ok(out.morningFlashSms.text.includes("[Boutique Sigiriya] Night Audit: Occ 20% (1/5)"));

    assert.ok(capturedSms);
    assert.equal(capturedSms.toMobile, "94771234567");
    assert.equal(capturedSms.senderId, "SIGIRIYA");

    assert.ok(out.morningFlashEmail);
    assert.equal(out.morningFlashEmail.dispatched, true);
    assert.equal(out.morningFlashEmail.recipientEmail, "gm@boutiquesigiriya.lk");
    assert.equal(out.morningFlashEmail.messageId, "EMAIL-TEST-7766");

    assert.ok(capturedEmail);
    assert.equal(capturedEmail.to, "gm@boutiquesigiriya.lk");
    assert.ok(capturedEmail.subject.includes("[Boutique Sigiriya]"));

    // Check that audit entry records SMS dispatch status
    const auditParsed = JSON.parse(out.auditLog.afterJson);
    assert.equal(auditParsed.smsDispatched, true);
    assert.equal(auditParsed.smsMessageId, "SMS-TEST-9988");
    assert.equal(auditParsed.emailDispatched, true);
    assert.equal(auditParsed.emailMessageId, "EMAIL-TEST-7766");

    // Check that NightAuditSummary item contains sms and email info
    const putCommands = sentCommands.filter((c) => c.type === "PutCommand") as Array<{
      input: {
        Item: {
          SK: string;
          morningFlashSms?: { dispatched: boolean };
          morningFlashEmail?: { dispatched: boolean };
        };
      };
    }>;
    const summaryRecord = putCommands.find((c) => c.input.Item.SK === "NIGHTAUDIT#2026-10-19");
    assert.ok(summaryRecord?.input.Item.morningFlashSms);
    assert.equal(summaryRecord.input.Item.morningFlashSms.dispatched, true);
  });

  it("handles invalid owner mobile number gracefully without crashing audit execution", async () => {
    const { mockClient } = createMockDocClient({ stays: [] });

    const input: NightAuditInput = {
      tenantId: TEST_TENANT,
      auditDate: "2026-10-18",
      ownerMobile: "invalid-number-123",
    };

    const res = await executeNightAuditCron(input, { docClient: mockClient });
    assert.ok(res.ok);
    const out = res.value;

    assert.ok(out.morningFlashSms);
    assert.equal(out.morningFlashSms.dispatched, false);
    assert.equal(out.morningFlashSms.messageId, "FAILED_INVALID_MOBILE");
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

  it("invokes handler entrypoint properly", async () => {
    const res = await handler({
      tenantId: TEST_TENANT,
      auditDate: "2026-10-18",
    });

    // In default handler without mocks, DynamoDB will be defaultDocClient or error gracefully
    assert.ok(res !== undefined);
  });
});
