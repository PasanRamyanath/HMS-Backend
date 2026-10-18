import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  type CheckInGuestTxInput,
  type CheckOutGuestTxInput,
  type CreateReservationTxInput,
  executeReservationAndCheckInTx,
  handler,
} from "../lambdas/reservationAndCheckInTx.js";

const TEST_TENANT = "tenant-resort-mirissa";
const TEST_TIME = "2026-10-18T19:00:00.000Z";

interface MockClientOptions {
  readonly shouldFailTx?: boolean;
  readonly existingReservationsOnRoom?: Array<{
    readonly id: string;
    readonly checkInDate: string;
    readonly checkOutDate: string;
    readonly status: string;
  }>;
  readonly driverBedOccupied?: boolean;
  readonly existingStayStatus?: string;
  readonly folioGrossLkr?: number;
}

function handleGetCommand(inp: { Key: { PK: string; SK: string } }, options: MockClientOptions) {
  if (inp.Key.SK.startsWith("DRIVERBED#")) {
    return {
      Item: {
        PK: inp.Key.PK,
        SK: inp.Key.SK,
        isOccupied: options.driverBedOccupied ?? false,
      },
    };
  }
  if (inp.Key.SK.startsWith("STAY#")) {
    return {
      Item: {
        PK: inp.Key.PK,
        SK: inp.Key.SK,
        id: inp.Key.SK.replace("STAY#", ""),
        status: options.existingStayStatus ?? "CONFIRMED",
        assignedRoomId: "room-ocean-101",
        assignedRoomNumber: "101",
        folioId: "folio-test-001",
        driverAccommodation: {
          driverDormBedId: "bed-01",
        },
      },
    };
  }
  if (inp.Key.SK.startsWith("FOLIO#")) {
    return {
      Item: {
        PK: inp.Key.PK,
        SK: inp.Key.SK,
        totalGrossLkr: options.folioGrossLkr ?? 45000,
      },
    };
  }
  return { Item: undefined };
}

function createMockDocClient(options: MockClientOptions = {}) {
  const sentCommands: Array<{ type: string; input: unknown }> = [];

  const mockClient = {
    send: async (command: { constructor: { name: string }; input: unknown }) => {
      const type = command.constructor.name;
      sentCommands.push({ type, input: command.input });

      if (options.shouldFailTx && type === "TransactWriteCommand") {
        throw new Error("Transaction cancelled: ConditionalCheckFailed");
      }
      if (type === "QueryCommand") {
        return { Items: options.existingReservationsOnRoom ?? [] };
      }
      if (type === "GetCommand") {
        return handleGetCommand(command.input as { Key: { PK: string; SK: string } }, options);
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  return { mockClient, sentCommands };
}

describe("Transactional Reservation, Driver Bed & Check-In/Check-Out Lambda (reservationAndCheckInTx.ts)", () => {
  describe("createReservationTx", () => {
    it("successfully creates a reservation with GSI2 sparse keys, default folio, and audit log", async () => {
      const { mockClient, sentCommands } = createMockDocClient();

      const input: CreateReservationTxInput = {
        action: "CREATE_RESERVATION",
        tenantId: TEST_TENANT,
        rateTier: "SRI_LANKAN_RESIDENT",
        mealPlan: "HB",
        checkInDate: "2026-11-01",
        checkOutDate: "2026-11-05",
        adultsCount: 2,
        childrenCount: 0,
        roomTypeId: "room-type-deluxe",
        assignedRoomId: "room-deluxe-201",
        assignedRoomNumber: "201",
        guestName: "Sunil Perera",
        guestEmail: "sunil@example.lk",
        guestPhone: "+94771234567",
        guestNic: "198512345678",
        quotedRateAmount: 85000,
        quotedRateCurrency: "LKR",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
        nowIsoFn: () => TEST_TIME,
      });

      assert.ok(res.ok, "Expected reservation creation to succeed");
      const out = res.value;
      assert.equal(out.action, "CREATE_RESERVATION");
      assert.equal(out.tenantId, TEST_TENANT);
      assert.equal(out.status, "CONFIRMED");
      assert.equal(out.assignedRoomId, "room-deluxe-201");
      assert.ok(out.folioId);
      assert.ok(out.auditLog.entryHash.length === 64);

      const txCmd = sentCommands.find((c) => c.type === "TransactWriteCommand");
      assert.ok(txCmd, "Expected TransactWriteCommand to be invoked");
    });

    it("rejects reservation when dates overlap with existing booking on GSI2", async () => {
      const { mockClient } = createMockDocClient({
        existingReservationsOnRoom: [
          {
            id: "stay-existing-123",
            checkInDate: "2026-11-03",
            checkOutDate: "2026-11-07",
            status: "CONFIRMED",
          },
        ],
      });

      const input: CreateReservationTxInput = {
        action: "CREATE_RESERVATION",
        tenantId: TEST_TENANT,
        rateTier: "SRI_LANKAN_RESIDENT",
        mealPlan: "BB",
        checkInDate: "2026-11-01",
        checkOutDate: "2026-11-05",
        adultsCount: 2,
        childrenCount: 0,
        roomTypeId: "room-type-deluxe",
        assignedRoomId: "room-deluxe-201",
        guestName: "Kamal Silva",
        guestEmail: "kamal@example.lk",
        guestPhone: "+94711234567",
        quotedRateAmount: 75000,
        quotedRateCurrency: "LKR",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "ROOM_CONFLICT");
      }
    });

    it("allocates chauffeur dorm bed when driverAccommodation is requested", async () => {
      const { mockClient, sentCommands } = createMockDocClient({
        driverBedOccupied: false,
      });

      const input: CreateReservationTxInput = {
        action: "CREATE_RESERVATION",
        tenantId: TEST_TENANT,
        rateTier: "FOREIGN_NON_RESIDENT",
        mealPlan: "HB",
        checkInDate: "2026-12-01",
        checkOutDate: "2026-12-04",
        adultsCount: 2,
        childrenCount: 0,
        roomTypeId: "room-type-suite",
        guestName: "Arthur Dent",
        guestEmail: "arthur@example.co.uk",
        guestPhone: "+447911123456",
        guestPassportNumber: "N12345678",
        quotedRateAmount: 600,
        quotedRateCurrency: "USD",
        driverAccommodation: {
          driverDormBedId: "bed-dorm-04",
          driverName: "Ruwan Jayasinghe",
          driverPhone: "+94772345678",
          driverNic: "197812345678",
          vehicleNumber: "WP-CAB-4521",
        },
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.ok(res.ok);
      const txCmd = sentCommands.find((c) => c.type === "TransactWriteCommand") as {
        input: { TransactItems: Array<{ Update?: { Key: { SK: string } } }> };
      };
      const driverBedUpdate = txCmd.input.TransactItems.find(
        (it) => it.Update?.Key.SK === "DRIVERBED#bed-dorm-04",
      );
      assert.ok(driverBedUpdate, "Expected driver bed update item in transaction");
    });

    it("rejects when driver dorm bed is already occupied", async () => {
      const { mockClient } = createMockDocClient({
        driverBedOccupied: true,
      });

      const input: CreateReservationTxInput = {
        action: "CREATE_RESERVATION",
        tenantId: TEST_TENANT,
        rateTier: "FOREIGN_NON_RESIDENT",
        mealPlan: "RO",
        checkInDate: "2026-12-01",
        checkOutDate: "2026-12-04",
        adultsCount: 1,
        childrenCount: 0,
        roomTypeId: "room-type-suite",
        guestName: "Arthur Dent",
        guestEmail: "arthur@example.co.uk",
        guestPhone: "+447911123456",
        quotedRateAmount: 400,
        quotedRateCurrency: "USD",
        driverAccommodation: {
          driverDormBedId: "bed-dorm-04",
          driverName: "Ruwan Jayasinghe",
          driverPhone: "+94772345678",
          driverNic: "197812345678",
          vehicleNumber: "WP-CAB-4521",
        },
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "DRIVER_BED_UNAVAILABLE");
      }
    });

    it("rejects invalid check-in and check-out dates", async () => {
      const { mockClient } = createMockDocClient();

      const input: CreateReservationTxInput = {
        action: "CREATE_RESERVATION",
        tenantId: TEST_TENANT,
        rateTier: "SRI_LANKAN_RESIDENT",
        mealPlan: "RO",
        checkInDate: "2026-11-10",
        checkOutDate: "2026-11-05", // invalid: checkout before checkin
        adultsCount: 1,
        childrenCount: 0,
        roomTypeId: "room-type-standard",
        guestName: "Anura Dias",
        guestEmail: "anura@example.lk",
        guestPhone: "+94773456789",
        quotedRateAmount: 25000,
        quotedRateCurrency: "LKR",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "VALIDATION_FAILED");
      }
    });
  });

  describe("checkInGuestTx", () => {
    it("successfully checks in guest, verifies NIC, generates QR HMAC session token, updates room to OCCUPIED", async () => {
      const { mockClient, sentCommands } = createMockDocClient({
        existingStayStatus: "CONFIRMED",
      });

      const input: CheckInGuestTxInput = {
        action: "CHECK_IN_GUEST",
        tenantId: TEST_TENANT,
        reservationId: "stay-101",
        assignedRoomId: "room-ocean-101",
        assignedRoomNumber: "101",
        guestNic: "198512345678",
        touristPoliceBCardNumber: "BC-2026-0042",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
        nowIsoFn: () => TEST_TIME,
      });

      assert.ok(res.ok, "Expected check-in to succeed");
      const out = res.value;
      assert.equal(out.action, "CHECK_IN_GUEST");
      assert.equal(out.status, "CHECKED_IN");
      assert.ok(out.qrSessionToken, "Expected rotating contactless QR session token");

      const txCmd = sentCommands.find((c) => c.type === "TransactWriteCommand") as {
        input: { TransactItems: Array<{ Update?: { Key: { SK: string } } }> };
      };
      const roomUpdate = txCmd.input.TransactItems.find(
        (it) => it.Update?.Key.SK === "ROOM#room-ocean-101",
      );
      assert.ok(roomUpdate, "Expected room status update to OCCUPIED");
    });

    it("rejects check-in when guest NIC fails Sri Lankan format/checksum validation", async () => {
      const { mockClient } = createMockDocClient();

      const input: CheckInGuestTxInput = {
        action: "CHECK_IN_GUEST",
        tenantId: TEST_TENANT,
        reservationId: "stay-101",
        assignedRoomId: "room-ocean-101",
        assignedRoomNumber: "101",
        guestNic: "INVALID-NIC-NUMBER",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "INVALID_NIC");
      }
    });

    it("checks in foreign tourist with passport and Tourist Police B-Card serial", async () => {
      const { mockClient } = createMockDocClient({
        existingStayStatus: "CONFIRMED",
      });

      const input: CheckInGuestTxInput = {
        action: "CHECK_IN_GUEST",
        tenantId: TEST_TENANT,
        reservationId: "stay-foreign-202",
        assignedRoomId: "room-ocean-202",
        assignedRoomNumber: "202",
        guestPassportNumber: "PA98765432",
        guestNationality: "GBR",
        touristPoliceBCardNumber: "BC-2026-0089",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
        nowIsoFn: () => TEST_TIME,
      });

      assert.ok(res.ok, "Expected foreign tourist check-in to succeed");
      assert.equal(res.value.status, "CHECKED_IN");
    });

    it("rejects check-in if reservation is already CHECKED_IN", async () => {
      const { mockClient } = createMockDocClient({
        existingStayStatus: "CHECKED_IN",
      });

      const input: CheckInGuestTxInput = {
        action: "CHECK_IN_GUEST",
        tenantId: TEST_TENANT,
        reservationId: "stay-101",
        assignedRoomId: "room-ocean-101",
        assignedRoomNumber: "101",
        guestNic: "198512345678",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "RESERVATION_NOT_ACTIVE");
      }
    });
  });

  describe("checkOutGuestTx", () => {
    it("successfully checks out guest, locks 4-stage tax invoice, clears QR HMAC, vacates driver bed, sets room to VACANT_DIRTY", async () => {
      const { mockClient, sentCommands } = createMockDocClient({
        existingStayStatus: "CHECKED_IN",
        folioGrossLkr: 60000,
      });

      const input: CheckOutGuestTxInput = {
        action: "CHECK_OUT_GUEST",
        tenantId: TEST_TENANT,
        reservationId: "stay-101",
        folioId: "folio-test-001",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
        nowIsoFn: () => TEST_TIME,
      });

      assert.ok(res.ok, "Expected check-out to succeed");
      const out = res.value;
      assert.equal(out.action, "CHECK_OUT_GUEST");
      assert.equal(out.status, "CHECKED_OUT");
      assert.ok(out.taxInvoice, "Expected locked statutory tax invoice");
      assert.equal(out.taxInvoice.baseLkr, 60000);
      assert.equal(out.taxInvoice.scLkr, 6000); // 10% SC

      const txCmd = sentCommands.find((c) => c.type === "TransactWriteCommand") as {
        input: { TransactItems: Array<{ Update?: { Key: { SK: string } } }> };
      };

      // Room set to VACANT_DIRTY
      const roomUpdate = txCmd.input.TransactItems.find(
        (it) => it.Update?.Key.SK === "ROOM#room-ocean-101",
      );
      assert.ok(roomUpdate, "Expected room update to VACANT_DIRTY");

      // Driver bed vacated
      const driverBedUpdate = txCmd.input.TransactItems.find(
        (it) => it.Update?.Key.SK === "DRIVERBED#bed-01",
      );
      assert.ok(driverBedUpdate, "Expected driver bed to be vacated");
    });

    it("rejects check-out if reservation is not in CHECKED_IN status", async () => {
      const { mockClient } = createMockDocClient({
        existingStayStatus: "CONFIRMED",
      });

      const input: CheckOutGuestTxInput = {
        action: "CHECK_OUT_GUEST",
        tenantId: TEST_TENANT,
        reservationId: "stay-101",
        folioId: "folio-test-001",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "RESERVATION_NOT_ACTIVE");
      }
    });

    it("handles DynamoDB transaction failure with TRANSACTION_FAILED domain error", async () => {
      const { mockClient } = createMockDocClient({
        existingStayStatus: "CHECKED_IN",
        shouldFailTx: true,
      });

      const input: CheckOutGuestTxInput = {
        action: "CHECK_OUT_GUEST",
        tenantId: TEST_TENANT,
        reservationId: "stay-101",
        folioId: "folio-test-001",
      };

      const res = await executeReservationAndCheckInTx(input, {
        docClient: mockClient,
      });

      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, "TRANSACTION_FAILED");
      }
    });
  });

  it("validates handler entrypoint error handling on invalid action payload", async () => {
    const invalidInput = {
      action: "CHECK_IN_GUEST",
      tenantId: TEST_TENANT,
      reservationId: "stay-invalid",
      assignedRoomId: "room-101",
      assignedRoomNumber: "101",
      guestNic: "INVALID_NIC",
    } as unknown as CheckInGuestTxInput;

    const res = await handler(invalidInput);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "INVALID_NIC");
    }
  });
});
