import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BookingNotificationEvent,
  dispatchBookingNotification,
  formatBookingConfirmationEmail,
  formatBookingConfirmationSms,
  handler,
  sendSmsViaSmsGo,
} from "../lambdas/notifyBooking.js";

const MOCK_EVENT: BookingNotificationEvent = {
  tenantId: "tenant-galle-fort",
  reservationId: "res-2026-89412",
  bookingReference: "SL-BKG-2026-89412",
  guestName: "Kasun Jayasuriya",
  guestMobile: "0771234567",
  guestEmail: "kasun.j@example.lk",
  hotelName: "Galle Fort Lighthouse Villa",
  hotelPhone: "+94912234567",
  checkInDate: "2026-11-15",
  checkOutDate: "2026-11-18",
  nights: 3,
  roomTypeName: "Deluxe Ocean View Villa",
  mealPlanName: "Half Board (HB)",
  currency: "LKR",
  grandTotal: 210000,
  paidAmount: 63000,
  balanceDue: 147000,
  driverBedAllocated: true,
  preCheckInBaseUrl: "https://stay.hms.lk/p",
  channelSource: "DIRECT",
  serviceChargeLkr: 15631,
  tdlLkr: 1719,
  ssclLkr: 4298,
  vatLkr: 32047,
};

describe("Automated SMS & Email Booking Confirmation Dispatcher (notifyBooking.ts)", () => {
  describe("1. GSM-7 160-Character Single-Segment SMS Constraint", () => {
    it("ensures default booking SMS is strictly <= 160 characters (LKR 0.54 single segment)", () => {
      const sms = formatBookingConfirmationSms(MOCK_EVENT);
      assert.ok(
        sms.charCount <= 160,
        `SMS length ${sms.charCount} exceeded 160 character limit:\n"${sms.text}"`,
      );
      assert.strictEqual(sms.isSingleSegment, true);
      assert.ok(sms.text.includes("Bkg Confirmed!"));
      assert.ok(sms.text.includes("Ref:SL-BKG-2026-89412"));
      assert.ok(sms.text.includes("15-Nov to 18-Nov (3N)"));
      assert.ok(sms.text.includes("Bal:LKR 147k"));
      assert.ok(sms.text.includes("Pre-check-in:"));
    });

    it("maintains <= 160 characters with long hotel name and USD currency", () => {
      const longHotelEvent: BookingNotificationEvent = {
        ...MOCK_EVENT,
        hotelName: "Anantara Peace Haven Tangalle Resort & Spa Sri Lanka",
        currency: "USD",
        grandTotal: 1250,
        paidAmount: 375,
        balanceDue: 875,
        bookingReference: "BKG-99412",
      };
      const sms = formatBookingConfirmationSms(longHotelEvent);
      assert.ok(
        sms.charCount <= 160,
        `Long hotel SMS length ${sms.charCount} exceeded 160 limit:\n"${sms.text}"`,
      );
      assert.strictEqual(sms.isSingleSegment, true);
      assert.ok(sms.text.includes("Bal:USD $875"));
    });

    it("maintains <= 160 characters with zero balance due (settled full payment)", () => {
      const settledEvent: BookingNotificationEvent = {
        ...MOCK_EVENT,
        paidAmount: 210000,
        balanceDue: 0,
      };
      const sms = formatBookingConfirmationSms(settledEvent);
      assert.ok(sms.charCount <= 160);
      assert.strictEqual(sms.isSingleSegment, true);
      assert.ok(sms.text.includes("Bal:LKR 0"));
    });
  });

  describe("2. Email Confirmation Formatting & Statutory Inclusions", () => {
    it("formats comprehensive confirmation email with 4-stage tax compounding", () => {
      const email = formatBookingConfirmationEmail(MOCK_EVENT);
      assert.ok(email.subject.includes("Booking Confirmed"));
      assert.ok(email.subject.includes("Galle Fort Lighthouse Villa"));
      assert.ok(email.subject.includes("SL-BKG-2026-89412"));

      // Plain text content
      assert.ok(email.text.includes("Kasun Jayasuriya"));
      assert.ok(email.text.includes("Deluxe Ocean View Villa"));
      assert.ok(email.text.includes("Half Board (HB)"));
      assert.ok(email.text.includes("3 Nights"));
      assert.ok(email.text.includes("Driver / Chauffeur Dormitory Bed: Reserved"));
      assert.ok(email.text.includes("FAST-TRACK CONTACTLESS PRE-CHECK-IN"));

      // HTML Content & Statutory Taxes
      assert.ok(email.html.includes("10% Service Charge"));
      assert.ok(email.html.includes("1% TDL"));
      assert.ok(email.html.includes("2.5% SSCL"));
      assert.ok(email.html.includes("18% VAT"));
      assert.ok(email.html.includes("Complete Pre-Check-In"));
    });
  });

  describe("3. SMS Gateway REST API Dispatcher", () => {
    it("sendSmsViaSmsGo calls API with correct authorization and recipient payload", async () => {
      let interceptedUrl = "";
      let interceptedHeaders: Record<string, string> = {};
      let interceptedBody = "";

      const mockFetch: typeof fetch = async (url, init) => {
        interceptedUrl = String(url);
        interceptedHeaders = (init?.headers as Record<string, string>) || {};
        interceptedBody = String(init?.body || "");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "success",
            message_id: "SMSGO-MSG-89412",
          }),
        } as unknown as Response;
      };

      const result = await sendSmsViaSmsGo(
        "94771234567",
        "Test booking message",
        "secret-api-token-123",
        "GALLE-FORT",
        mockFetch,
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.messageId, "SMSGO-MSG-89412");
      assert.strictEqual(interceptedUrl, "https://api.smsgo.lk/api/v1/sms/send");
      assert.strictEqual(interceptedHeaders.Authorization, "Bearer secret-api-token-123");
      const parsedBody = JSON.parse(interceptedBody);
      assert.strictEqual(parsedBody.to, "94771234567");
      assert.strictEqual(parsedBody.sender_id, "GALLE-FORT");
    });
  });

  describe("4. End-to-End Dispatcher & Audit Log Hash-Chaining", () => {
    it("dispatchBookingNotification dispatches SMS & email, creating SHA-256 audit log", async () => {
      const mockFetch: typeof fetch = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            status: "success",
            message_id: "SMSGO-MSG-89412",
          }),
        }) as unknown as Response;

      let emailSentTo = "";
      const result = await dispatchBookingNotification(MOCK_EVENT, {
        fetchFn: mockFetch,
        smsGoApiKey: "test-key",
        smsSenderId: "HOTEL-TEST",
        emailSenderFn: async (params) => {
          emailSentTo = params.to;
          return { success: true, messageId: "SES-EMAIL-12345" };
        },
      });

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.success, true);
        assert.strictEqual(result.value.sms.dispatched, true);
        assert.strictEqual(result.value.sms.messageId, "SMSGO-MSG-89412");
        assert.strictEqual(result.value.sms.recipient, "94771234567");
        assert.strictEqual(result.value.sms.isSingleSegment, true);
        assert.strictEqual(result.value.email.dispatched, true);
        assert.strictEqual(result.value.email.messageId, "SES-EMAIL-12345");
        assert.strictEqual(emailSentTo, "kasun.j@example.lk");

        // Verify SHA-256 hash-chained audit entry
        const audit = result.value.auditLogEntry;
        assert.ok(audit);
        assert.strictEqual(audit.tenantId, "tenant-galle-fort");
        assert.strictEqual(audit.action, "SMS_SENT");
        assert.strictEqual(audit.entityId, "SMSGO-MSG-89412");
        assert.strictEqual(audit.entryHash.length, 64); // SHA-256 hex string
      }
    });

    it("handles Lambda invocation entry point cleanly", async () => {
      const mockFetch: typeof fetch = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            status: "success",
            message_id: "SMSGO-LAMBDA-1",
          }),
        }) as unknown as Response;

      const lambdaResponse = await handler(
        { body: JSON.stringify(MOCK_EVENT) },
        {},
        {
          fetchFn: mockFetch,
        },
      );

      assert.strictEqual(lambdaResponse.statusCode, 200);
      const parsedBody = JSON.parse(lambdaResponse.body);
      assert.strictEqual(parsedBody.success, true);
      assert.strictEqual(parsedBody.bookingReference, "SL-BKG-2026-89412");
    });
  });
});
