/**
 * Sri Lanka Personal Data Protection Act (PDPA) No. 9 of 2022 & GDPR Compliance Engine
 * (`packages/core/src/pdpaCompliance.ts`)
 *
 * Implements Step 460 (Phase 19.10) of the Sri Lanka HMS Master Architecture Plan:
 * - Redacts guest PII (Personally Identifiable Information) on demand pursuant to Section 14
 *   (Right to Erasure) of the Sri Lanka Personal Data Protection Act No. 9 of 2022.
 * - Scrubs sensitive fields:
 *   - `fullName` -> "[REDACTED - PDPA NO. 9 OF 2022]"
 *   - `nicOrPassport` -> "[REDACTED]"
 *   - `phone` -> "[REDACTED]"
 *   - `email` -> "[REDACTED]"
 *   - `signatureUrl` -> ""
 *   - `emergencyContactPhone` -> undefined / removed
 * - Preserves statutory audit records required by Inland Revenue Department (IRD) Act No. 24 of 2017
 *   and Sri Lanka Tourism Development Authority (SLTDA) Tourism Act No. 38 of 2005:
 *   - `nationalityIso` (e.g. "LKA", "GBR", "DEU", "IND")
 *   - `isSriLankanResident` (resident vs foreign non-resident)
 *   - 4-stage compounding statutory taxes (`SC`, `TDL`, `SSCL`, `VAT`) and gross totals
 *   - check-in and check-out dates
 * - Appends cryptographically chained SHA-256 `ImmutableAuditLog` entry documenting erasure.
 * - Enforces multi-tenant isolation and Role-Based Access Control (RBAC).
 */

import { type AuditLogEntry, GENESIS_HASH, computeAuditEntryHash } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type PdpaLegalBasis =
  | "RIGHT_TO_ERASURE"
  | "CONSENT_WITHDRAWN"
  | "RETENTION_EXPIRED"
  | "DATA_SUBJECT_REQUEST";

export const AUTHORIZED_PDPA_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "HOTEL_OWNER",
  "GENERAL_MANAGER",
  "COMPLIANCE_OFFICER",
]);

export interface GuestPiiRecord {
  readonly guestId: string;
  readonly tenantId: string;
  readonly fullName: string;
  readonly nicOrPassport: string;
  readonly phone: string;
  readonly email: string;
  readonly signatureUrl: string;
  readonly nationalityIso: string;
  readonly isSriLankanResident: boolean;
  readonly emergencyContactPhone?: string | undefined;
  readonly dietaryNotes?: string | undefined;
  readonly roomNumber?: string | undefined;
}

export interface StayFolioTaxRecord {
  readonly folioId: string;
  readonly guestId: string;
  readonly tenantId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly nationalityIso: string;
  readonly isSriLankanResident: boolean;
  readonly baseRoomChargeLkr: number;
  readonly foodAndBeverageLkr: number;
  readonly serviceChargeLkr: number; // 10%
  readonly tdlLkr: number; // 1%
  readonly ssclLkr: number; // 2.5%
  readonly vatLkr: number; // 18%
  readonly totalPaidLkr: number;
}

export interface PdpaAnonymizationRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly guestId: string;
  readonly requestedByUserId: string;
  readonly actorRole: string;
  readonly requestDateIso: string;
  readonly legalBasis: PdpaLegalBasis;
  readonly notes?: string | undefined;
}

export interface AnonymizedGuestRecord {
  readonly guestId: string;
  readonly tenantId: string;
  readonly fullName: string;
  readonly nicOrPassport: string;
  readonly phone: string;
  readonly email: string;
  readonly signatureUrl: string;
  readonly nationalityIso: string;
  readonly isSriLankanResident: boolean;
  readonly isAnonymized: true;
  readonly anonymizedAtIso: string;
  readonly legalBasis: PdpaLegalBasis;
  readonly requestedByUserId: string;
}

export interface PdpaErasureResult {
  readonly originalGuestId: string;
  readonly anonymizedRecord: AnonymizedGuestRecord;
  readonly preservedFolioCount: number;
  readonly preservedTotalTaxLkr: number;
  readonly auditEntry: AuditLogEntry;
}

export interface TenantPdpaExport {
  readonly tenantId: string;
  readonly exportTimestampIso: string;
  readonly exportedByUserId: string;
  readonly anonymizedGuests: ReadonlyArray<AnonymizedGuestRecord>;
  readonly preservedStatutoryFolios: ReadonlyArray<StayFolioTaxRecord>;
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Validates whether an actor role and subscription status are authorized to trigger PDPA erasure.
 */
export function validatePdpaAuthorization(
  actorRole: string,
  tenantSubscriptionActive = true,
): Result<true, DomainError> {
  if (!tenantSubscriptionActive) {
    return domainErr(
      "SUBSCRIPTION_INACTIVE",
      "Tenant SaaS subscription is inactive or suspended. Cannot process PDPA erasure requests.",
    );
  }

  if (!AUTHORIZED_PDPA_ROLES.has(actorRole)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role '${actorRole}' is not authorized to execute PDPA right to erasure operations. Authorized roles: ${Array.from(
        AUTHORIZED_PDPA_ROLES,
      ).join(", ")}.`,
      { actorRole },
    );
  }

  return ok(true);
}

/**
 * Redacts guest PII pursuant to Section 14 of Sri Lanka PDPA No. 9 of 2022 while
 * retaining non-identifying statutory tax & nationality data for IRD / SLTDA compliance.
 */
export function anonymizeGuestPii(
  guest: GuestPiiRecord,
  request: PdpaAnonymizationRequest,
  associatedFolios: ReadonlyArray<StayFolioTaxRecord> = [],
  prevHash = GENESIS_HASH,
): Result<PdpaErasureResult, DomainError> {
  // 1. Authorization Guard
  const authCheck = validatePdpaAuthorization(request.actorRole);
  if (!authCheck.ok) {
    return authCheck;
  }

  // 2. Tenant Boundary Isolation Check
  if (guest.tenantId !== request.tenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Tenant boundary violation: guest tenant '${guest.tenantId}' does not match request tenant '${request.tenantId}'.`,
      { guestTenantId: guest.tenantId, requestTenantId: request.tenantId },
    );
  }

  // 3. Guest ID Match Check
  if (guest.guestId !== request.guestId) {
    return domainErr(
      "PDPA_REQUEST_INVALID",
      `Target guestId '${guest.guestId}' does not match request guestId '${request.guestId}'.`,
      { guestId: guest.guestId, requestGuestId: request.guestId },
    );
  }

  // 4. Scrub PII and construct Anonymized Record
  const anonymizedRecord: AnonymizedGuestRecord = {
    guestId: guest.guestId,
    tenantId: guest.tenantId,
    fullName: "[REDACTED - PDPA NO. 9 OF 2022]",
    nicOrPassport: "[REDACTED]",
    phone: "[REDACTED]",
    email: "[REDACTED]",
    signatureUrl: "",
    nationalityIso: guest.nationalityIso, // Preserved for SLTDA arrival statistics
    isSriLankanResident: guest.isSriLankanResident, // Preserved for IRD tax rate validation
    isAnonymized: true,
    anonymizedAtIso: request.requestDateIso,
    legalBasis: request.legalBasis,
    requestedByUserId: request.requestedByUserId,
  };

  // 5. Calculate preserved financial tax totals for audit reconciliation
  const preservedFolios = associatedFolios.filter((f) => f.guestId === guest.guestId);
  const preservedTotalTaxLkr = preservedFolios.reduce((acc, f) => {
    const folioTaxes = f.serviceChargeLkr + f.tdlLkr + f.ssclLkr + f.vatLkr;
    return Math.round((acc + folioTaxes + Number.EPSILON) * 100) / 100;
  }, 0);

  // 6. Create cryptographic SHA-256 Immutable Audit Log Entry
  const afterJson = JSON.stringify({
    guestId: guest.guestId,
    legalBasis: request.legalBasis,
    preservedFoliosCount: preservedFolios.length,
    preservedTotalTaxLkr,
    nationalityIso: guest.nationalityIso,
  });

  const entryHash = computeAuditEntryHash({
    prevHash,
    tenantId: guest.tenantId,
    actorUserId: request.requestedByUserId,
    action: "PDPA_GUEST_ERASURE",
    entityType: "GUEST_PII",
    entityId: guest.guestId,
    isoTs: request.requestDateIso,
    afterJson,
  });

  const auditEntry: AuditLogEntry = {
    tenantId: guest.tenantId,
    actorUserId: request.requestedByUserId,
    action: "PDPA_GUEST_ERASURE",
    entityType: "GUEST_PII",
    entityId: guest.guestId,
    isoTs: request.requestDateIso,
    afterJson,
    prevHash,
    entryHash,
  };

  return ok({
    originalGuestId: guest.guestId,
    anonymizedRecord,
    preservedFolioCount: preservedFolios.length,
    preservedTotalTaxLkr,
    auditEntry,
  });
}

/**
 * Validates that an anonymization operation did not mutate or delete statutory SLTDA/IRD financial folio records.
 */
export function verifyStatutoryTaxPreservation(
  originalFolios: ReadonlyArray<StayFolioTaxRecord>,
  archivedFolios: ReadonlyArray<StayFolioTaxRecord>,
): Result<boolean, DomainError> {
  if (originalFolios.length !== archivedFolios.length) {
    return domainErr(
      "VALIDATION_FAILED",
      `Statutory folio count mismatch: original has ${originalFolios.length}, archived has ${archivedFolios.length}. Folio tax records must never be deleted under Inland Revenue Act No. 24 of 2017.`,
    );
  }

  for (let i = 0; i < originalFolios.length; i++) {
    const orig = originalFolios[i];
    const arch = archivedFolios[i];

    if (!orig || !arch) {
      continue;
    }

    if (
      orig.folioId !== arch.folioId ||
      orig.totalPaidLkr !== arch.totalPaidLkr ||
      orig.vatLkr !== arch.vatLkr ||
      orig.tdlLkr !== arch.tdlLkr ||
      orig.ssclLkr !== arch.ssclLkr ||
      orig.serviceChargeLkr !== arch.serviceChargeLkr ||
      orig.nationalityIso !== arch.nationalityIso ||
      orig.isSriLankanResident !== arch.isSriLankanResident
    ) {
      return domainErr(
        "TAX_MISMATCH",
        `Statutory tax preservation violation on folio '${orig.folioId}'. Financial fields or nationality altered during PDPA processing.`,
        { original: orig, archived: arch },
      );
    }
  }

  return ok(true);
}

/**
 * Builds a tenant compliance export containing anonymized guest directory and full
 * preserved statutory stay folios with an unbroken cryptographic audit trail.
 */
export function exportTenantPdpaArchive(params: {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actorRole: string;
  readonly guests: ReadonlyArray<GuestPiiRecord>;
  readonly folios: ReadonlyArray<StayFolioTaxRecord>;
  readonly exportTimestampIso: string;
  readonly prevHash?: string | undefined;
}): Result<TenantPdpaExport, DomainError> {
  const authCheck = validatePdpaAuthorization(params.actorRole);
  if (!authCheck.ok) {
    return authCheck;
  }

  // Cross-tenant verification
  for (const g of params.guests) {
    if (g.tenantId !== params.tenantId) {
      return domainErr(
        "TENANT_MISMATCH",
        `Cross-tenant data leakage detected: guest '${g.guestId}' belongs to tenant '${g.tenantId}', expected '${params.tenantId}'.`,
      );
    }
  }

  for (const f of params.folios) {
    if (f.tenantId !== params.tenantId) {
      return domainErr(
        "TENANT_MISMATCH",
        `Cross-tenant data leakage detected: folio '${f.folioId}' belongs to tenant '${f.tenantId}', expected '${params.tenantId}'.`,
      );
    }
  }

  // Redact all guest PII
  const anonymizedGuests: AnonymizedGuestRecord[] = params.guests.map((g) => ({
    guestId: g.guestId,
    tenantId: g.tenantId,
    fullName: "[REDACTED - PDPA NO. 9 OF 2022]",
    nicOrPassport: "[REDACTED]",
    phone: "[REDACTED]",
    email: "[REDACTED]",
    signatureUrl: "",
    nationalityIso: g.nationalityIso,
    isSriLankanResident: g.isSriLankanResident,
    isAnonymized: true,
    anonymizedAtIso: params.exportTimestampIso,
    legalBasis: "RETENTION_EXPIRED",
    requestedByUserId: params.actorUserId,
  }));

  const prevHash = params.prevHash ?? GENESIS_HASH;
  const afterJson = JSON.stringify({
    tenantId: params.tenantId,
    anonymizedGuestCount: anonymizedGuests.length,
    preservedFolioCount: params.folios.length,
    exportedByUserId: params.actorUserId,
  });

  const entryHash = computeAuditEntryHash({
    prevHash,
    tenantId: params.tenantId,
    actorUserId: params.actorUserId,
    action: "PDPA_TENANT_EXPORT",
    entityType: "TENANT_ARCHIVE",
    entityId: params.tenantId,
    isoTs: params.exportTimestampIso,
    afterJson,
  });

  const auditEntry: AuditLogEntry = {
    tenantId: params.tenantId,
    actorUserId: params.actorUserId,
    action: "PDPA_TENANT_EXPORT",
    entityType: "TENANT_ARCHIVE",
    entityId: params.tenantId,
    isoTs: params.exportTimestampIso,
    afterJson,
    prevHash,
    entryHash,
  };

  return ok({
    tenantId: params.tenantId,
    exportTimestampIso: params.exportTimestampIso,
    exportedByUserId: params.actorUserId,
    anonymizedGuests,
    preservedStatutoryFolios: params.folios,
    auditEntry,
  });
}
