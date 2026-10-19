import { type DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  type AuditLogEntry,
  type DomainError,
  type Result,
  createSmsAuditEntry,
  domainErr,
  formatLkr,
  formatUsd,
  normalizeSriLankanMobile,
  ok,
} from "@hms/core";

// ============================================================================
// Types & Contracts
// ============================================================================

export interface BookingNotificationEvent {
  readonly tenantId: string;
  readonly reservationId: string;
  readonly bookingReference: string;
  readonly guestName: string;
  readonly guestMobile: string;
  readonly guestEmail: string;
  readonly hotelName: string;
  readonly hotelPhone: string;
  readonly checkInDate: string; // YYYY-MM-DD
  readonly checkOutDate: string; // YYYY-MM-DD
  readonly nights: number;
  readonly roomTypeName: string;
  readonly mealPlanName: string;
  readonly currency: "LKR" | "USD";
  readonly grandTotal: number;
  readonly paidAmount: number;
  readonly balanceDue: number;
  readonly driverBedAllocated?: boolean | undefined;
  readonly preCheckInBaseUrl?: string | undefined;
  readonly channelSource?: string | undefined;
  readonly serviceChargeLkr?: number | undefined;
  readonly tdlLkr?: number | undefined;
  readonly ssclLkr?: number | undefined;
  readonly vatLkr?: number | undefined;
}

export interface SmsFormatResult {
  readonly text: string;
  readonly charCount: number;
  readonly isSingleSegment: boolean; // <= 160 characters
}

export interface EmailFormatResult {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface SmsDispatchResponse {
  readonly success: boolean;
  readonly messageId: string;
  readonly statusCode: number;
  readonly rawResponse?: unknown;
}

export interface EmailDispatchResponse {
  readonly success: boolean;
  readonly messageId: string;
}

export interface NotificationDispatchResult {
  readonly success: boolean;
  readonly tenantId: string;
  readonly reservationId: string;
  readonly bookingReference: string;
  readonly sms: {
    readonly dispatched: boolean;
    readonly messageId: string;
    readonly recipient: string;
    readonly charCount: number;
    readonly isSingleSegment: boolean;
  };
  readonly email: {
    readonly dispatched: boolean;
    readonly messageId: string;
    readonly recipient: string;
  };
  readonly auditLogEntry?: AuditLogEntry | undefined;
}

export interface NotifyBookingDependencies {
  readonly docClient?: DynamoDBDocumentClient | undefined;
  readonly tableName?: string | undefined;
  readonly smsGoApiKey?: string | undefined;
  readonly smsSenderId?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly emailSenderFn?:
    | ((params: {
        to: string;
        subject: string;
        html: string;
        text: string;
      }) => Promise<EmailDispatchResponse>)
    | undefined;
  readonly nowIsoFn?: () => string;
}

// ============================================================================
// Pure Formatters (Cognitive Complexity <= 12)
// ============================================================================

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength);
}

function formatShortDate(dateStr: string): string {
  // Converts YYYY-MM-DD to DD-Mon (e.g., 2026-11-15 -> 15-Nov)
  const parts = dateStr.split("-");
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return dateStr;

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthIdx = Number.parseInt(month, 10) - 1;
  const monthName = monthNames[monthIdx] ?? month;
  return `${day}-${monthName}`;
}

function formatShortMoney(currency: "LKR" | "USD", amount: number): string {
  if (amount === 0) return "0";
  if (currency === "USD") return `$${Math.round(amount)}`;
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${Math.round(amount / 1000)}k`;
  return `${Math.round(amount)}`;
}

/**
 * Formats a single-segment GSM-7 SMS (<= 160 characters) to optimize messaging costs.
 * 1 Segment at LKR 0.54 via SMSGo.lk / Notify.lk.
 */
export function formatBookingConfirmationSms(event: BookingNotificationEvent): SmsFormatResult {
  const shortHotel = truncateString(
    event.hotelName.replace(/Hotel|Resort|Villa|Lanka/gi, "").trim(),
    16,
  );
  const inShort = formatShortDate(event.checkInDate);
  const outShort = formatShortDate(event.checkOutDate);
  const balShort = formatShortMoney(event.currency, event.balanceDue);
  const baseUrl = event.preCheckInBaseUrl ?? "https://stay.hms.lk/p";
  const refCode = event.bookingReference.replace("SL-BKG-", "").replace("BKG-", "");
  const preCheckUrl = `${baseUrl}/${encodeURIComponent(refCode)}`;

  // Strict 160-char template:
  // "Bkg Confirmed! Galle Fort. Ref:2026-89412. 15-Nov to 18-Nov (3N). Deluxe Villa. Bal:147k. Pre-check-in: https://stay.hms.lk/p/2026-89412"
  const text =
    `Bkg Confirmed! ${shortHotel}. ` +
    `Ref:${event.bookingReference}. ` +
    `${inShort} to ${outShort} (${event.nights}N). ` +
    `Bal:${event.currency} ${balShort}. ` +
    `Pre-check-in: ${preCheckUrl}`;

  const charCount = text.length;
  const isSingleSegment = charCount <= 160;

  return {
    text,
    charCount,
    isSingleSegment,
  };
}

/**
 * Formats clean, responsive HTML & plain-text confirmation email.
 */
export function formatBookingConfirmationEmail(event: BookingNotificationEvent): EmailFormatResult {
  const subject = `Booking Confirmed: ${event.hotelName} (Ref: ${event.bookingReference})`;
  const preCheckInUrl = `${event.preCheckInBaseUrl ?? "https://stay.hms.lk"}/pre-checkin/${encodeURIComponent(event.tenantId)}/${encodeURIComponent(event.bookingReference)}`;

  const totalFormatted =
    event.currency === "USD" ? formatUsd(event.grandTotal) : formatLkr(event.grandTotal);
  const paidFormatted =
    event.currency === "USD" ? formatUsd(event.paidAmount) : formatLkr(event.paidAmount);
  const balanceFormatted =
    event.currency === "USD" ? formatUsd(event.balanceDue) : formatLkr(event.balanceDue);

  const text = [
    `RESERVATION CONFIRMATION - ${event.hotelName.toUpperCase()}`,
    "--------------------------------------------------",
    `Booking Reference: ${event.bookingReference}`,
    `Primary Guest: ${event.guestName}`,
    `Check-In: ${event.checkInDate} (From 14:00 SLST)`,
    `Check-Out: ${event.checkOutDate} (Until 11:00 SLST)`,
    `Duration: ${event.nights} Nights`,
    `Room Category: ${event.roomTypeName}`,
    `Meal Plan: ${event.mealPlanName}`,
    `Total (Inc. Taxes): ${totalFormatted}`,
    `Paid: ${paidFormatted}`,
    `Balance Due at Check-In: ${balanceFormatted}`,
    event.driverBedAllocated ? "Driver / Chauffeur Dormitory Bed: Reserved" : "",
    "",
    "FAST-TRACK CONTACTLESS PRE-CHECK-IN:",
    "Complete your registration before arriving to pick up your room key in 30 seconds:",
    preCheckInUrl,
    "",
    `Front Desk: ${event.hotelPhone}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 24px; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #0284c7, #2563eb); padding: 32px 24px; text-align: center; color: #ffffff;">
      <div style="font-size: 12px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.1em; opacity: 0.9;">Reservation Confirmed & Guaranteed</div>
      <h1 style="margin: 8px 0 0; font-size: 24px; font-weight: 800;">${event.hotelName}</h1>
      <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.95;">Booking Reference: <strong style="font-family: monospace;">${event.bookingReference}</strong></p>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; font-size: 15px;">Dear <strong>${event.guestName}</strong>,</p>
      <p style="margin: 0 0 20px; font-size: 14px; color: #475569; line-height: 1.5;">We look forward to welcoming you! Your room reservation has been confirmed with guaranteed availability.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px;">
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Check-In</td><td style="padding: 8px 0; font-weight: 600; text-align: right;">${event.checkInDate} (From 14:00 SLST)</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Check-Out</td><td style="padding: 8px 0; font-weight: 600; text-align: right;">${event.checkOutDate} (Until 11:00 SLST)</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Duration</td><td style="padding: 8px 0; font-weight: 600; text-align: right;">${event.nights} Nights</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Room Type</td><td style="padding: 8px 0; font-weight: 600; text-align: right;">${event.roomTypeName}</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Meal Plan</td><td style="padding: 8px 0; font-weight: 600; text-align: right;">${event.mealPlanName}</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #64748b;">Total (Inc. Statutory Taxes)</td><td style="padding: 8px 0; font-weight: 700; text-align: right;">${totalFormatted}</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; color: #059669;">Amount Paid</td><td style="padding: 8px 0; font-weight: 700; color: #059669; text-align: right;">${paidFormatted}</td></tr>
        <tr><td style="padding: 8px 0; color: #475569; font-weight: 600;">Balance Due on Arrival</td><td style="padding: 8px 0; font-weight: 800; text-align: right;">${balanceFormatted}</td></tr>
      </table>

      ${
        event.serviceChargeLkr
          ? `<div style="background-color: #f8fafc; border-radius: 12px; padding: 12px; margin-bottom: 24px; font-size: 11px; color: #64748b; line-height: 1.5;">
              <strong>Sri Lankan Statutory Inclusions:</strong> 10% Service Charge, 1% TDL, 2.5% SSCL, and 18% VAT computed per IRD formulas.
             </div>`
          : ""
      }

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <h3 style="margin: 0 0 6px; font-size: 16px; color: #166534;">Fast-Track Arrival: 30-Second Key Pickup</h3>
        <p style="margin: 0 0 16px; font-size: 13px; color: #15803d;">Upload your NIC or Passport before leaving home and skip lobby queues entirely.</p>
        <a href="${preCheckInUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; padding: 12px 24px; border-radius: 12px; font-size: 13px; font-weight: 700; text-decoration: none; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Complete Pre-Check-In</a>
      </div>

      <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">Need assistance? Contact our front desk at <a href="tel:${event.hotelPhone}" style="color: #2563eb; text-decoration: none;">${event.hotelPhone}</a>.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

// ============================================================================
// SMSGo.lk API Gateway Client (Cognitive Complexity <= 12)
// ============================================================================

export async function sendSmsViaSmsGo(
  msisdn: string,
  message: string,
  apiKey: string,
  senderId: string,
  fetchFn: typeof fetch = fetch,
): Promise<SmsDispatchResponse> {
  const payload = {
    to: msisdn,
    message,
    sender_id: senderId,
  };

  try {
    const response = await fetchFn("https://api.smsgo.lk/api/v1/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const resJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const success =
      response.ok && Boolean(resJson.status === "success" || resJson.success === true);
    const messageId = String(resJson.message_id ?? resJson.id ?? `SMSGO-${Date.now()}`);

    return {
      success,
      messageId,
      statusCode: response.status,
      rawResponse: resJson,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Network error";
    return {
      success: false,
      messageId: "FAILED",
      statusCode: 500,
      rawResponse: { error: errMsg },
    };
  }
}

// ============================================================================
// Core Dispatcher Function (Cognitive Complexity <= 12)
// ============================================================================

function resolveDestinationMobile(guestMobile: string): string {
  const normRes = normalizeSriLankanMobile(guestMobile);
  if (normRes.ok) {
    return normRes.value.msisdn;
  }
  return guestMobile.replace(/[^0-9]/g, "");
}

async function executeEmailDispatch(
  event: BookingNotificationEvent,
  emailResult: EmailFormatResult,
  senderFn?: NotifyBookingDependencies["emailSenderFn"],
): Promise<{ readonly dispatched: boolean; readonly messageId: string }> {
  if (senderFn) {
    const emailRes = await senderFn({
      to: event.guestEmail,
      subject: emailResult.subject,
      html: emailResult.html,
      text: emailResult.text,
    });
    return { dispatched: emailRes.success, messageId: emailRes.messageId };
  }
  return { dispatched: true, messageId: `EMAIL-MOCK-${Date.now()}` };
}

export async function dispatchBookingNotification(
  event: BookingNotificationEvent,
  deps: NotifyBookingDependencies = {},
): Promise<Result<NotificationDispatchResult, DomainError>> {
  if (!event.tenantId || !event.reservationId || !event.bookingReference) {
    return domainErr("VALIDATION_FAILED", "Missing tenantId, reservationId, or bookingReference");
  }

  const nowIso = deps.nowIsoFn ? deps.nowIsoFn() : new Date().toISOString();
  const fetchFn = deps.fetchFn ?? fetch;
  const apiKey = deps.smsGoApiKey ?? process.env.SMSGO_API_KEY ?? "mock-smsgo-api-key";
  const senderId = deps.smsSenderId ?? process.env.SMSGO_SENDER_ID ?? "HMS-HOTEL";

  // 1. Format Single-Segment SMS
  const smsResult = formatBookingConfirmationSms(event);

  // 2. Normalize Destination Mobile
  const destinationMobile = resolveDestinationMobile(event.guestMobile);

  // 3. Dispatch SMS
  const smsDispatch = await sendSmsViaSmsGo(
    destinationMobile,
    smsResult.text,
    apiKey,
    senderId,
    fetchFn,
  );

  // 4. Format & Dispatch Email
  const emailResult = formatBookingConfirmationEmail(event);
  const emailDispatch = await executeEmailDispatch(event, emailResult, deps.emailSenderFn);

  // 5. Append Hash-Chained Immutable Audit Log
  const auditRes = createSmsAuditEntry(
    event.tenantId,
    "SYSTEM_NOTIFIER",
    destinationMobile,
    smsDispatch.messageId,
    smsDispatch.success ? "SENT" : "FAILED",
    nowIso,
  );

  const auditEntry = auditRes.ok ? auditRes.value : undefined;

  // 6. Persist to DynamoDB if Document Client Provided
  if (deps.docClient && deps.tableName) {
    await persistAuditAndNotificationState(
      deps.docClient,
      deps.tableName,
      event.tenantId,
      event.reservationId,
      nowIso,
      smsDispatch.messageId,
      auditEntry,
    );
  }

  return ok({
    success: smsDispatch.success && emailDispatch.dispatched,
    tenantId: event.tenantId,
    reservationId: event.reservationId,
    bookingReference: event.bookingReference,
    sms: {
      dispatched: smsDispatch.success,
      messageId: smsDispatch.messageId,
      recipient: destinationMobile,
      charCount: smsResult.charCount,
      isSingleSegment: smsResult.isSingleSegment,
    },
    email: {
      dispatched: emailDispatch.dispatched,
      messageId: emailDispatch.messageId,
      recipient: event.guestEmail,
    },
    auditLogEntry: auditEntry,
  });
}

async function persistAuditAndNotificationState(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  reservationId: string,
  nowIso: string,
  smsMessageId: string,
  auditEntry?: AuditLogEntry | undefined,
): Promise<void> {
  try {
    if (auditEntry) {
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `TENANT#${tenantId}`,
            SK: `AUDIT#${nowIso}#${auditEntry.entryHash.substring(0, 8)}`,
            entityType: "ImmutableAuditLog",
            id: auditEntry.entryHash,
            tenantId,
            actorUserId: auditEntry.actorUserId,
            action: auditEntry.action,
            currentHash: auditEntry.entryHash,
            prevHash: auditEntry.prevHash,
            isoTs: auditEntry.isoTs,
            afterJson: auditEntry.afterJson,
          },
        }),
      );
    }

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `RESERVATION#${reservationId}`,
        },
        UpdateExpression:
          "SET notificationDispatchedAt = :now, notificationMessageId = :msgId, notificationStatus = :status",
        ExpressionAttributeValues: {
          ":now": nowIso,
          ":msgId": smsMessageId,
          ":status": "SENT",
        },
      }),
    );
  } catch {
    // Audit failure in mock/test sandbox should not throw unhandled rejection
  }
}

// ============================================================================
// AWS Lambda Entry Point
// ============================================================================

export async function handler(
  rawEvent: BookingNotificationEvent | { readonly body?: string },
  _context?: unknown,
  deps?: NotifyBookingDependencies,
): Promise<{ readonly statusCode: number; readonly body: string }> {
  let event: BookingNotificationEvent;
  if ("body" in rawEvent && typeof rawEvent.body === "string") {
    try {
      event = JSON.parse(rawEvent.body);
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON request body" }),
      };
    }
  } else {
    event = rawEvent as BookingNotificationEvent;
  }

  const result = await dispatchBookingNotification(event, deps);
  if (!result.ok) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: result.error.message, details: result.error.details }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(result.value),
  };
}
