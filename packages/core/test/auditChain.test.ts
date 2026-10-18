import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  GENESIS_HASH,
  computeAuditEntryHash,
  createAuditEntry,
  verifyAuditChain,
} from "../src/auditChain.js";

describe("SHA-256 Hash-Chained ImmutableAuditLog Engine", () => {
  it("computes deterministic 64-character hex hash", () => {
    const hash = computeAuditEntryHash({
      prevHash: GENESIS_HASH,
      tenantId: "TENANT#lk-col-01",
      actorUserId: "USER#gm-001",
      action: "ROOM_CHECK_IN",
      entityType: "Reservation",
      entityId: "RES#2026-1001",
      isoTs: "2026-10-18T14:00:00.000Z",
      afterJson: JSON.stringify({ roomNo: "101", guestId: "GUEST#001" }),
    });

    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("creates initial entry anchored to GENESIS_HASH", () => {
    const result = createAuditEntry({
      tenantId: "TENANT#lk-col-01",
      actorUserId: "USER#gm-001",
      action: "RATE_PLAN_CREATED",
      entityType: "RatePlan",
      entityId: "RP#bb-deluxe",
      isoTs: "2026-10-18T14:05:00.000Z",
      afterJson: JSON.stringify({ baseLkr: 32000, mealPlan: "BB" }),
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.prevHash, GENESIS_HASH);
      assert.equal(result.value.entryHash.length, 64);
    }
  });

  it("builds and verifies a 3-entry unbroken audit chain", () => {
    const entries: AuditLogEntry[] = [];

    // Entry 1
    const res1 = createAuditEntry({
      tenantId: "TENANT#lk-galle-02",
      actorUserId: "USER#frontdesk-01",
      action: "FOLIO_CREATED",
      entityType: "GuestFolio",
      entityId: "FOLIO#1001",
      isoTs: "2026-10-18T14:10:00.000Z",
      afterJson: JSON.stringify({ roomNo: "204", baseTotalLkr: 50000 }),
    });
    assert.equal(res1.ok, true);
    if (res1.ok) entries.push(res1.value);

    // Entry 2 (linked to Entry 1)
    const res2 = createAuditEntry({
      tenantId: "TENANT#lk-galle-02",
      actorUserId: "USER#pos-waiter",
      action: "FOLIO_LINE_POSTED",
      entityType: "FolioLineItem",
      entityId: "LINE#501",
      isoTs: "2026-10-18T14:15:00.000Z",
      afterJson: JSON.stringify({ dept: "FNB", desc: "Ceylon Tea Pot", unitBaseLkr: 1500 }),
      prevHash: entries[0]?.entryHash,
    });
    assert.equal(res2.ok, true);
    if (res2.ok) entries.push(res2.value);

    // Entry 3 (linked to Entry 2)
    const res3 = createAuditEntry({
      tenantId: "TENANT#lk-galle-02",
      actorUserId: "USER#cashier-01",
      action: "PAYMENT_SETTLED",
      entityType: "FolioPaymentTransaction",
      entityId: "PAY#901",
      isoTs: "2026-10-18T14:20:00.000Z",
      afterJson: JSON.stringify({ method: "LANKAQR", amountLkr: 51500 }),
      prevHash: entries[1]?.entryHash,
    });
    assert.equal(res3.ok, true);
    if (res3.ok) entries.push(res3.value);

    assert.equal(entries.length, 3);
    const verification = verifyAuditChain(entries);
    assert.equal(verification.ok, true);
    if (verification.ok) {
      assert.equal(verification.value.verifiedCount, 3);
    }
  });

  it("detects payload tampering in any audit entry", () => {
    const res1 = createAuditEntry({
      tenantId: "TENANT#lk-01",
      actorUserId: "USER#gm",
      action: "POLICE_BCARD_SUBMITTED",
      entityType: "PoliceBCardRegistration",
      entityId: "BCARD#01",
      isoTs: "2026-10-18T14:25:00.000Z",
      afterJson: JSON.stringify({ passportNo: "N1234567" }),
    });
    assert.equal(res1.ok, true);
    if (!res1.ok) return;

    // Tamper with afterJson without updating entryHash
    const tamperedEntry: AuditLogEntry = {
      ...res1.value,
      afterJson: JSON.stringify({ passportNo: "FORGED_PASSPORT" }),
    };

    const verification = verifyAuditChain([tamperedEntry]);
    assert.equal(verification.ok, false);
    if (!verification.ok) {
      assert.equal(verification.error.code, "AUDIT_CHAIN_CORRUPTED");
    }
  });

  it("detects broken linkage between entries", () => {
    const res1 = createAuditEntry({
      tenantId: "TENANT#lk-01",
      actorUserId: "USER#gm",
      action: "EVENT_CREATED",
      entityType: "BanquetHall",
      entityId: "HALL#01",
      isoTs: "2026-10-18T14:30:00.000Z",
      afterJson: JSON.stringify({ pax: 250 }),
    });
    assert.equal(res1.ok, true);
    if (!res1.ok) return;

    const res2 = createAuditEntry({
      tenantId: "TENANT#lk-01",
      actorUserId: "USER#gm",
      action: "EVENT_UPDATED",
      entityType: "BanquetHall",
      entityId: "HALL#01",
      isoTs: "2026-10-18T14:35:00.000Z",
      afterJson: JSON.stringify({ pax: 300 }),
      prevHash: "f".repeat(64), // Invalid prevHash not matching res1
    });
    assert.equal(res2.ok, true);
    if (!res2.ok) return;

    const verification = verifyAuditChain([res1.value, res2.value]);
    assert.equal(verification.ok, false);
    if (!verification.ok) {
      assert.equal(verification.error.code, "AUDIT_CHAIN_CORRUPTED");
    }
  });

  it("rejects empty tenantId or actorUserId with VALIDATION_FAILED", () => {
    const invalidTenant = createAuditEntry({
      tenantId: "",
      actorUserId: "USER#01",
      action: "TEST",
      entityType: "Room",
      entityId: "101",
      isoTs: "2026-10-18T14:40:00.000Z",
      afterJson: "{}",
    });
    assert.equal(invalidTenant.ok, false);
    if (!invalidTenant.ok) {
      assert.equal(invalidTenant.error.code, "VALIDATION_FAILED");
    }
  });
});
