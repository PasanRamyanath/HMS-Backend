import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type IcalEventBooking,
  type IcalGenerateInput,
  createIcalAuditEntry,
  generateIcalFeed,
  parseIcalFeed,
} from "../src/icalSync.js";

const TEST_TENANT = "tenant-resort-mirissa";
const TEST_TIME = "2026-10-19T08:00:00.000Z";

describe("RFC 5545 iCal Feed Exporter & Importer (icalSync.ts)", () => {
  describe("generateIcalFeed", () => {
    it("generates a valid RFC 5545 calendar feed with CRLF delimiters", () => {
      const bookings: IcalEventBooking[] = [
        {
          uid: "res-deluxe-001",
          summary: "Reserved - Kasun Perera",
          checkInDate: "2026-11-01",
          checkOutDate: "2026-11-04",
          guestName: "Kasun Perera",
          roomNumber: "101",
          description: "Breakfast included; late arrival",
        },
        {
          uid: "res-deluxe-002",
          summary: "Reserved - Elena Petrova",
          checkInDate: "2026-11-05",
          checkOutDate: "2026-11-08",
          guestName: "Elena Petrova",
          roomNumber: "102",
        },
      ];

      const input: IcalGenerateInput = {
        tenantId: TEST_TENANT,
        calendarName: "Mirissa Ocean Villa - Deluxe Rooms",
        roomTypeId: "room-type-deluxe",
        bookings,
        nowIso: TEST_TIME,
      };

      const res = generateIcalFeed(input);
      assert.ok(res.ok, "Expected iCal generation to succeed");
      const ics = res.value;

      assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"), "Must start with BEGIN:VCALENDAR");
      assert.ok(ics.includes("VERSION:2.0\r\n"), "Must include VERSION:2.0");
      assert.ok(ics.includes("PRODID:-//Sri Lanka HMS//EN\r\n"), "Must include PRODID");
      assert.ok(
        ics.includes("X-WR-CALNAME:Mirissa Ocean Villa - Deluxe Rooms\r\n"),
        "Must include calendar name",
      );
      assert.ok(
        ics.includes("X-WR-TIMEZONE:Asia/Colombo\r\n"),
        "Must include default Sri Lanka timezone",
      );

      // Check first VEVENT
      assert.ok(
        ics.includes(`UID:res-deluxe-001@${TEST_TENANT}.hms.lk\r\n`),
        "UID must have tenant domain",
      );
      assert.ok(
        ics.includes("DTSTART;VALUE=DATE:20261101\r\n"),
        "DTSTART must match check-in date",
      );
      assert.ok(ics.includes("DTEND;VALUE=DATE:20261104\r\n"), "DTEND must match check-out date");
      assert.ok(ics.includes("SUMMARY:Reserved - Kasun Perera\r\n"), "SUMMARY must match booking");
      assert.ok(
        ics.includes(
          "DESCRIPTION:Guest: Kasun Perera | Room: 101 | Breakfast included\\; late arrival\r\n",
        ),
        "DESCRIPTION must have escaped semicolons",
      );
      assert.ok(ics.includes("STATUS:CONFIRMED\r\n"), "STATUS must be CONFIRMED");

      // Check end
      assert.ok(ics.endsWith("END:VCALENDAR\r\n"), "Must end with END:VCALENDAR");
    });

    it("rejects invalid tenant identifier or empty calendar name", () => {
      const invalidTenantRes = generateIcalFeed({
        tenantId: "INVALID TENANT",
        calendarName: "Villa Calendar",
        bookings: [],
      });
      assert.equal(invalidTenantRes.ok, false);

      const emptyNameRes = generateIcalFeed({
        tenantId: TEST_TENANT,
        calendarName: "   ",
        bookings: [],
      });
      assert.equal(emptyNameRes.ok, false);
      if (!emptyNameRes.ok) {
        assert.equal(emptyNameRes.error.code, "VALIDATION_FAILED");
      }
    });

    it("performs full round-trip generation and parsing idempotency", () => {
      const originalBookings: IcalEventBooking[] = [
        {
          uid: "hms-stay-101",
          summary: "Reserved - Nuwan Silva",
          checkInDate: "2026-12-01",
          checkOutDate: "2026-12-04",
          guestName: "Nuwan Silva",
          roomNumber: "Ocean-Suite-1",
        },
        {
          uid: "hms-stay-102",
          summary: "Reserved - Anouk De Silva",
          checkInDate: "2026-12-05",
          checkOutDate: "2026-12-10",
          guestName: "Anouk De Silva",
          roomNumber: "Ocean-Suite-2",
        },
      ];

      const genRes = generateIcalFeed({
        tenantId: TEST_TENANT,
        calendarName: "Round Trip Calendar",
        bookings: originalBookings,
        nowIso: TEST_TIME,
      });
      assert.ok(genRes.ok);

      const parseRes = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: genRes.value,
      });
      assert.ok(parseRes.ok);
      assert.equal(parseRes.value.bookings.length, 2);

      const [first, second] = parseRes.value.bookings;
      assert.ok(first);
      assert.equal(first.source, "DIRECT_HMS");
      assert.equal(first.checkInDate, "2026-12-01");
      assert.equal(first.checkOutDate, "2026-12-04");
      assert.equal(first.nights, 3);
      assert.equal(first.status, "CONFIRMED");

      assert.ok(second);
      assert.equal(second.source, "DIRECT_HMS");
      assert.equal(second.checkInDate, "2026-12-05");
      assert.equal(second.checkOutDate, "2026-12-10");
      assert.equal(second.nights, 5);
      assert.equal(second.status, "CONFIRMED");
    });
  });

  describe("parseIcalFeed", () => {
    it("parses Airbnb .ics feed with folded lines and extracts dates and source", () => {
      const airbnbIcal = [
        "BEGIN:VCALENDAR",
        "PRODID;X-RICAL-TZOFFSET=+0530:-//Airbnb Inc//Hosting Calendar 0.8.8//EN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:Mirissa Beachfront Suite (Airbnb)",
        "BEGIN:VEVENT",
        "DTEND;VALUE=DATE:20261205",
        "DTSTART;VALUE=DATE:20261201",
        "UID:12345678-hm9x@airbnb.com",
        "SUMMARY:Reserved (HM9X4K2)",
        "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/detail",
        " s/HM9X4K2",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      const res = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: airbnbIcal,
        actorUserId: "emp-frontdesk-1",
        nowIso: TEST_TIME,
      });

      assert.ok(res.ok, "Expected Airbnb feed parsing to succeed");
      const feed = res.value;
      assert.equal(feed.calendarName, "Mirissa Beachfront Suite (Airbnb)");
      assert.equal(feed.bookings.length, 1);

      const b = feed.bookings[0];
      assert.ok(b);
      assert.equal(b.uid, "12345678-hm9x@airbnb.com");
      assert.equal(b.source, "AIRBNB");
      assert.equal(b.checkInDate, "2026-12-01");
      assert.equal(b.checkOutDate, "2026-12-05");
      assert.equal(b.nights, 4);
      assert.equal(b.status, "CONFIRMED");
      assert.ok(b.description?.includes("HM9X4K2"), "Expected folded line to be unfolded");
      assert.ok(feed.auditLog, "Expected SHA-256 audit log entry");
      assert.equal(feed.auditLog?.entryHash.length, 64);
    });

    it("parses Booking.com .ics feed with datetime timestamps and cancels", () => {
      const bookingDotComIcal = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Booking.com//EN",
        "X-WR-CALNAME:Booking.com - Standard Ocean Villa",
        "BEGIN:VEVENT",
        "UID:bkg-994821@booking.com",
        "DTSTART:20261210T140000Z",
        "DTEND:20261215T110000Z",
        "SUMMARY:Booking.com - John Smith",
        "DESCRIPTION:PIN: 4821\\, Non-refundable",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:bkg-994822@booking.com",
        "DTSTART:20261220T140000Z",
        "DTEND:20261222T110000Z",
        "SUMMARY:Booking.com - Sarah Davis",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      const res = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: bookingDotComIcal,
      });

      assert.ok(res.ok, "Expected Booking.com feed parsing to succeed");
      const feed = res.value;
      assert.equal(feed.bookings.length, 2);

      const [first, second] = feed.bookings;
      assert.ok(first);
      assert.equal(first.source, "BOOKING_COM");
      assert.equal(first.checkInDate, "2026-12-10");
      assert.equal(first.checkOutDate, "2026-12-15");
      assert.equal(first.nights, 5);
      assert.equal(first.status, "CONFIRMED");
      assert.ok(first.description?.includes("PIN: 4821, Non-refundable"));

      assert.ok(second);
      assert.equal(second.source, "BOOKING_COM");
      assert.equal(second.checkInDate, "2026-12-20");
      assert.equal(second.checkOutDate, "2026-12-22");
      assert.equal(second.nights, 2);
      assert.equal(second.status, "CANCELLED");
    });

    it("parses feed with TZID timezone prefix on DTSTART and DTEND", () => {
      const tzidIcal = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Custom Property//EN",
        "BEGIN:VEVENT",
        "UID:tz-booking-001@example.com",
        "DTSTART;TZID=Asia/Colombo:20261115T140000",
        "DTEND;TZID=Asia/Colombo:20261118T110000",
        "SUMMARY:Closed - Maintenance Block",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      const res = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: tzidIcal,
      });

      assert.ok(res.ok);
      const booking = res.value.bookings[0];
      assert.ok(booking);
      assert.equal(booking.checkInDate, "2026-11-15");
      assert.equal(booking.checkOutDate, "2026-11-18");
      assert.equal(booking.nights, 3);
    });

    it("detects VRBO and Expedia calendar sources accurately", () => {
      const vrboIcal = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//HomeAway Inc//EN",
        "BEGIN:VEVENT",
        "UID:vrbo-stay-5501@vrbo.com",
        "DTSTART;VALUE=DATE:20261225",
        "DTEND;VALUE=DATE:20261228",
        "SUMMARY:VRBO Reservation",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      const res = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: vrboIcal,
      });

      assert.ok(res.ok);
      assert.equal(res.value.bookings[0]?.source, "VRBO");

      const expediaIcal = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Expedia Inc//EN",
        "BEGIN:VEVENT",
        "UID:expedia-res-8831@expedia.com",
        "DTSTART;VALUE=DATE:20261229",
        "DTEND;VALUE=DATE:20261231",
        "SUMMARY:Expedia Booking",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      const expRes = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: expediaIcal,
      });
      assert.ok(expRes.ok);
      assert.equal(expRes.value.bookings[0]?.source, "EXPEDIA");
    });

    it("rejects non-calendar or empty content with descriptive domain error", () => {
      const emptyRes = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: "",
      });
      assert.equal(emptyRes.ok, false);
      if (!emptyRes.ok) {
        assert.equal(emptyRes.error.code, "VALIDATION_FAILED");
      }

      const invalidContentRes = parseIcalFeed({
        tenantId: TEST_TENANT,
        icalContent: "<html><body>Not a calendar</body></html>",
      });
      assert.equal(invalidContentRes.ok, false);
      if (!invalidContentRes.ok) {
        assert.equal(invalidContentRes.error.code, "VALIDATION_FAILED");
      }
    });

    it("creates hash-chained audit log with createIcalAuditEntry", () => {
      const auditRes = createIcalAuditEntry(
        TEST_TENANT,
        "emp-admin-1",
        "ICAL_EXPORT",
        {
          calendarName: "Direct Web Export",
          bookingsCount: 5,
        },
        TEST_TIME,
      );

      assert.ok(auditRes.ok);
      const log = auditRes.value;
      assert.equal(log.tenantId, TEST_TENANT);
      assert.equal(log.actorUserId, "emp-admin-1");
      assert.equal(log.action, "ICAL_FEED_EXPORT");
      assert.equal(log.entityType, "IcalCalendarSync");
      assert.equal(log.entryHash.length, 64);
    });
  });
});
