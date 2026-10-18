import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CreateOrderAndFolioTxInput,
  executeOrderAndFolioTx,
} from "../lambdas/orderAndFolioTx.js";

interface MockSentCommand {
  readonly type: string;
  readonly input: unknown;
}

function createMockDocClient(options?: {
  readonly reservationStatus?: string;
  readonly shouldFailTx?: boolean;
}) {
  const sentCommands: MockSentCommand[] = [];

  const mockClient = {
    send: async (command: { constructor: { name: string }; input: unknown }) => {
      sentCommands.push({
        type: command.constructor.name,
        input: command.input,
      });

      if (command.constructor.name === "GetCommand") {
        if (options?.reservationStatus) {
          return {
            Item: {
              PK: "TENANT#tenant-nuwara-eliya-resort",
              SK: "STAY#stay-1234",
              status: options.reservationStatus,
            },
          };
        }
        return { Item: undefined };
      }

      if (command.constructor.name === "TransactWriteCommand") {
        if (options?.shouldFailTx) {
          throw new Error("Transaction cancelled, conditional check failed on StockItem");
        }
        return {};
      }

      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  return { mockClient, sentCommands };
}

describe("Transactional Order & Folio Posting Lambda (orderAndFolioTx.ts)", () => {
  const TEST_TENANT = "tenant-nuwara-eliya-resort";
  const TEST_TIME = "2026-10-18T19:00:00.000Z";

  it("successfully places a restaurant order with 4-stage tax compounding and audit log", async () => {
    const { mockClient, sentCommands } = createMockDocClient();

    const input: CreateOrderAndFolioTxInput = {
      tenantId: TEST_TENANT,
      locationId: "TABLE-04",
      department: "RESTAURANT",
      paymentMethod: "CASH",
      items: [
        {
          itemId: "item-ceylon-tea-pot",
          itemName: "Premium Ceylon Black Tea (Pot)",
          unitPriceLkr: 1500,
          quantity: 2,
        },
        {
          itemId: "item-kottu-roti",
          itemName: "Chicken Cheese Kottu",
          unitPriceLkr: 2500,
          quantity: 1,
        },
      ],
    };

    const res = await executeOrderAndFolioTx(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.ok(res.ok, "Expected order placement to succeed");
    const output = res.value;

    assert.equal(output.tenantId, TEST_TENANT);
    assert.equal(output.department, "RESTAURANT");
    assert.equal(output.paymentMethod, "CASH");
    // Base: 1500*2 + 2500*1 = 5500
    assert.equal(output.taxBreakdown.baseLkr, 5500);
    // SC: 10% of 5500 = 550
    assert.equal(output.taxBreakdown.scLkr, 550);
    assert.ok(output.taxBreakdown.grandTotalLkr > 5500);

    // Verify audit entry
    assert.equal(output.auditLog.action, "CREATE_SERVICE_ORDER_TX");
    assert.equal(output.auditLog.entityType, "ServiceOrder");
    assert.ok(output.auditLog.entryHash.length === 64);

    // Verify TransactWriteItems command was sent
    const txCmd = sentCommands.find((c) => c.type === "TransactWriteCommand");
    assert.ok(txCmd, "Expected TransactWriteCommand to be invoked");
  });

  it("posts room service order to active checked-in room folio with BOM deduction", async () => {
    const { mockClient, sentCommands } = createMockDocClient({
      reservationStatus: "CHECKED_IN",
    });

    const input: CreateOrderAndFolioTxInput = {
      tenantId: TEST_TENANT,
      locationId: "ROOM-302",
      department: "ROOM_SERVICE",
      paymentMethod: "POST_TO_ROOM_FOLIO",
      stayId: "stay-1234",
      folioId: "folio-master-99",
      items: [
        {
          itemId: "item-club-sandwich",
          itemName: "Heritage Club Sandwich",
          unitPriceLkr: 3200,
          quantity: 1,
          bomIngredients: [
            { ingredientId: "ing-bread-loaf", quantityRequired: 0.25 },
            { ingredientId: "ing-chicken-breast", quantityRequired: 0.15 },
          ],
        },
      ],
    };

    const res = await executeOrderAndFolioTx(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.ok(res.ok);
    const output = res.value;
    assert.ok(output.folioLineId, "Expected folioLineId to be returned");

    const txCmd = sentCommands.find((c) => c.type === "TransactWriteCommand");
    assert.ok(txCmd);
    const rawTx = txCmd.input as { TransactItems: unknown[] };

    // Should include: ServiceOrder (Put), FolioLine (Put), Folio (Update), Stock1 (Update), Stock2 (Update), AuditLog (Put) = 6 items
    assert.equal(rawTx.TransactItems.length, 6);
  });

  it("generates CBSL LankaQR MPM dynamic payload when paymentMethod is LANKA_QR", async () => {
    const { mockClient } = createMockDocClient();

    const input: CreateOrderAndFolioTxInput = {
      tenantId: TEST_TENANT,
      locationId: "TABLE-BAR-02",
      department: "BAR",
      paymentMethod: "LANKA_QR",
      lankaQrMerchantId: "MERCHANT-ELLA-01",
      lankaQrMerchantName: "Ella Cloud Resort",
      lankaQrMerchantCity: "Ella",
      items: [
        {
          itemId: "item-arrack-cocktail",
          itemName: "Ceylon Arrack Sour",
          unitPriceLkr: 2200,
          quantity: 2,
        },
      ],
    };

    const res = await executeOrderAndFolioTx(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.ok(res.ok);
    const output = res.value;
    assert.ok(output.lankaQr);
    assert.equal(output.lankaQr.isDynamic, true);
    assert.ok(output.lankaQr.payload.startsWith("000201010212"));
    assert.ok(output.lankaQr.crc.length === 4);
  });

  it("rejects POST_TO_ROOM_FOLIO when room reservation is not CHECKED_IN", async () => {
    const { mockClient } = createMockDocClient({
      reservationStatus: "CHECKED_OUT",
    });

    const input: CreateOrderAndFolioTxInput = {
      tenantId: TEST_TENANT,
      locationId: "ROOM-101",
      department: "ROOM_SERVICE",
      paymentMethod: "POST_TO_ROOM_FOLIO",
      stayId: "stay-1234",
      folioId: "folio-1234",
      items: [
        {
          itemId: "item-coffee",
          itemName: "Espresso",
          unitPriceLkr: 800,
          quantity: 1,
        },
      ],
    };

    const res = await executeOrderAndFolioTx(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "RESERVATION_NOT_ACTIVE");
    }
  });

  it("rejects POST_TO_ROOM_FOLIO when stayId or folioId is missing", async () => {
    const { mockClient } = createMockDocClient();

    const input: CreateOrderAndFolioTxInput = {
      tenantId: TEST_TENANT,
      locationId: "ROOM-101",
      department: "ROOM_SERVICE",
      paymentMethod: "POST_TO_ROOM_FOLIO",
      items: [
        {
          itemId: "item-coffee",
          itemName: "Espresso",
          unitPriceLkr: 800,
          quantity: 1,
        },
      ],
    };

    const res = await executeOrderAndFolioTx(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "INVALID_RESERVATION");
    }
  });

  it("rejects orders with empty line items", async () => {
    const { mockClient } = createMockDocClient();

    const input: CreateOrderAndFolioTxInput = {
      tenantId: TEST_TENANT,
      locationId: "ROOM-101",
      department: "ROOM_SERVICE",
      paymentMethod: "CASH",
      items: [],
    };

    const res = await executeOrderAndFolioTx(input, {
      docClient: mockClient,
    });

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "INVALID_ORDER_ITEMS");
    }
  });

  it("handles DynamoDB transaction failure with TRANSACTION_FAILED domain error", async () => {
    const { mockClient } = createMockDocClient({
      shouldFailTx: true,
    });

    const input: CreateOrderAndFolioTxInput = {
      tenantId: TEST_TENANT,
      locationId: "TABLE-01",
      department: "RESTAURANT",
      paymentMethod: "CASH",
      items: [
        {
          itemId: "item-rice",
          itemName: "Rice & Curry",
          unitPriceLkr: 1800,
          quantity: 1,
        },
      ],
    };

    const res = await executeOrderAndFolioTx(input, {
      docClient: mockClient,
      nowIsoFn: () => TEST_TIME,
    });

    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "TRANSACTION_FAILED");
    }
  });
});
