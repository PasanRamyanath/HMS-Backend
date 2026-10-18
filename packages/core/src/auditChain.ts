import { createHash } from "node:crypto";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

/**
 * Genesis hash representing the anchor before any audit entries exist.
 * Standard 64-character hexadecimal zero string.
 */
export const GENESIS_HASH = "0".repeat(64);

export interface AuditLogPayload {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly isoTs: string;
  readonly afterJson: string;
  readonly prevHash?: string | undefined;
}

export interface AuditLogEntry {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly isoTs: string;
  readonly afterJson: string;
  readonly prevHash: string;
  readonly entryHash: string;
}

export interface HashPayloadInput {
  readonly prevHash: string;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly isoTs: string;
  readonly afterJson: string;
}

/**
 * Computes deterministic SHA-256 entry hash over pipe-delimited payload canonical format.
 */
export function computeAuditEntryHash(input: HashPayloadInput): string {
  const canonicalString = [
    input.prevHash,
    input.tenantId,
    input.actorUserId,
    input.action,
    input.entityType,
    input.entityId,
    input.isoTs,
    input.afterJson,
  ].join("|");

  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/**
 * Constructs a verified ImmutableAuditLog entry with its cryptographically chained entryHash.
 */
export function createAuditEntry(payload: AuditLogPayload): Result<AuditLogEntry, DomainError> {
  if (!payload.tenantId || payload.tenantId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "tenantId is required for audit log");
  }
  if (!payload.actorUserId || payload.actorUserId.trim() === "") {
    return domainErr("VALIDATION_FAILED", "actorUserId is required for audit log");
  }
  if (!payload.action || payload.action.trim() === "") {
    return domainErr("VALIDATION_FAILED", "action is required for audit log");
  }

  const prevHash = payload.prevHash ?? GENESIS_HASH;
  const hashInput: HashPayloadInput = {
    prevHash,
    tenantId: payload.tenantId,
    actorUserId: payload.actorUserId,
    action: payload.action,
    entityType: payload.entityType,
    entityId: payload.entityId,
    isoTs: payload.isoTs,
    afterJson: payload.afterJson,
  };

  const entryHash = computeAuditEntryHash(hashInput);

  return ok({
    tenantId: payload.tenantId,
    actorUserId: payload.actorUserId,
    action: payload.action,
    entityType: payload.entityType,
    entityId: payload.entityId,
    isoTs: payload.isoTs,
    afterJson: payload.afterJson,
    prevHash,
    entryHash,
  });
}

/**
 * Verifies an entire sequence of audit log entries for cryptographic integrity.
 * Returns AUDIT_CHAIN_CORRUPTED if any hash mismatch or chain break is detected.
 */
export function verifyAuditChain(
  chain: readonly AuditLogEntry[],
): Result<{ verifiedCount: number }, DomainError> {
  if (chain.length === 0) {
    return ok({ verifiedCount: 0 });
  }

  for (let i = 0; i < chain.length; i++) {
    const current = chain[i];
    if (!current) {
      continue;
    }

    // Verify entry hash matches contents
    const expectedHash = computeAuditEntryHash({
      prevHash: current.prevHash,
      tenantId: current.tenantId,
      actorUserId: current.actorUserId,
      action: current.action,
      entityType: current.entityType,
      entityId: current.entityId,
      isoTs: current.isoTs,
      afterJson: current.afterJson,
    });

    if (current.entryHash !== expectedHash) {
      return domainErr("AUDIT_CHAIN_CORRUPTED", `Audit hash mismatch at index ${i}`, {
        index: i,
        actualHash: current.entryHash,
        expectedHash,
      });
    }

    // Verify linkage to previous entry
    if (i > 0) {
      const previous = chain[i - 1];
      if (previous && current.prevHash !== previous.entryHash) {
        return domainErr("AUDIT_CHAIN_CORRUPTED", `Audit chain link broken at index ${i}`, {
          index: i,
          currentPrevHash: current.prevHash,
          expectedPrevHash: previous.entryHash,
        });
      }
    }
  }

  return ok({ verifiedCount: chain.length });
}
