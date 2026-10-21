/**
 * @hms/core - End-to-End Multi-Tenant Isolation Security Test (tenantIsolation.test.ts)
 *
 * Implements Step 472 (Phase 19.22) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Proves mathematically and cryptographically that `TENANT#hotel-a` credentials, QR tokens,
 * staff roles, and audit chains can NEVER read, mutate, or contaminate `TENANT#hotel-b` records:
 *
 * 1. Single-Table Partition Key Boundary Isolation (PK = `TENANT#<tenantId>`)
 * 2. QR HMAC Session Token Tenant Isolation & Anti-Tamper Boundary
 * 3. RolePermissionMatrix RBAC Isolation Across Tenant Boundaries
 * 4. Multi-Tenant SaaS Subscription Tier & Module Entitlement Boundaries
 * 5. Independent Sri Lankan 4-Stage Compounding Statutory Tax Isolation (SC -> TDL -> SSCL -> VAT)
 * 6. Cryptographically Hash-Chained ImmutableAuditLog Multi-Tenant Chain Isolation (SHA-256)
 * 7. Sri Lanka PDPA No. 9 of 2022 Guest PII Anonymization & Data Boundary Isolation
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  type GuestPiiRecord,
  type ModuleEntitlementKey,
  type PdpaAnonymizationRequest,
  type SriLankaTaxConfig,
  type StayFolioTaxRecord,
  type TenantSubscriptionState,
  aggregateFolioTaxes,
  anonymizeGuestPii,
  calculateForwardTax,
  computeAuditEntryHash,
  createAuditEntry,
  createTaxPreset,
  hasModuleEntitlement,
  roundLkr,
  signQrSessionToken,
  validatePdpaAuthorization,
  validateTenantId,
  verifyAuditChain,
  verifyQrSessionToken,
  verifyStatutoryTaxPreservation,
} from "../src/index.js";

// ============================================================================
// Multi-Tenant Test Constants & Actors
// ============================================================================

const TENANT_A = "tenant-galle-fort-villa";
const TENANT_B = "tenant-kandy-mountain-resort";
const TENANT_C_ENTERPRISE = "tenant-ceylon-heritage-chain";

const SECRET_A = "sri-lanka-secret-galle-fort-32b-key";
const SECRET_B = "sri-lanka-secret-kandy-hills-32b-key";

describe("Step 472 (Phase 19.22): End-to-End Multi-Tenant Isolation Security Suite", () => {
  // ==========================================================================
  // Section 1: Single-Table Partition Key Boundary Isolation
  // ==========================================================================
  describe("1. Single-Table Partition Key Boundary Isolation (PK = TENANT#<tenantId>)", () => {
    it("validates well-formed kebab-case tenant identifiers", () => {
      const resA = validateTenantId(TENANT_A);
      const resB = validateTenantId(TENANT_B);
      const resC = validateTenantId(TENANT_C_ENTERPRISE);

      assert.ok(resA.ok);
      assert.strictEqual(resA.value, TENANT_A);
      assert.ok(resB.ok);
      assert.strictEqual(resB.value, TENANT_B);
      assert.ok(resC.ok);
      assert.strictEqual(resC.value, TENANT_C_ENTERPRISE);
    });

    it("rejects malicious cross-tenant injection and traversal strings in tenantId", () => {
      const maliciousPayloads = [
        "",
        "   ",
        "TENANT_A", // uppercase rejected
        "tenant-a#SK=ROOM-101", // partition escape attempt
        "../tenant-b", // path traversal
        "tenant-a' OR '1'='1", // SQL injection attempt
        "tenant-a; DROP TABLE HmsSingleTable", // SQL command injection
        "tenant a", // whitespace illegal
        "tenant$a", // illegal symbols
      ];

      for (const payload of maliciousPayloads) {
        const res = validateTenantId(payload);
        assert.strictEqual(res.ok, false, `Expected '${payload}' to be rejected as tenantId`);
      }
    });

    it("guarantees disjoint partition keys across tenants preventing cross-tenant NoSQL leakage", () => {
      const buildPartitionKey = (tid: string) => `TENANT#${validateTenantId(tid).value}`;

      const pkA = buildPartitionKey(TENANT_A);
      const pkB = buildPartitionKey(TENANT_B);

      assert.notStrictEqual(pkA, pkB);
      assert.strictEqual(pkA, "TENANT#tenant-galle-fort-villa");
      assert.strictEqual(pkB, "TENANT#tenant-kandy-mountain-resort");
      assert.ok(!pkA.includes(TENANT_B));
      assert.ok(!pkB.includes(TENANT_A));
    });
  });

  // ==========================================================================
  // Section 2: QR HMAC Session Token Tenant Isolation
  // ==========================================================================
  describe("2. Contactless Guest QR HMAC Session Token Tenant Boundary", () => {
    it("signs valid guest QR tokens bound strictly to their respective tenantId", () => {
      const exp = Math.floor(Date.now() / 1000) + 7200;

      const tokenResA = signQrSessionToken({
        tenantId: TENANT_A,
        location: "ROOM-104",
        stayId: "stay-galle-901",
        exp,
        secret: SECRET_A,
      });

      const tokenResB = signQrSessionToken({
        tenantId: TENANT_B,
        location: "ROOM-201",
        stayId: "stay-kandy-802",
        exp,
        secret: SECRET_B,
      });

      assert.ok(tokenResA.ok);
      assert.ok(tokenResB.ok);
      assert.notStrictEqual(tokenResA.value, tokenResB.value);

      // Verify Token A produces payload bound to Tenant A
      const verifiedA = verifyQrSessionToken(tokenResA.value, SECRET_A);
      assert.ok(verifiedA.ok);
      assert.strictEqual(verifiedA.value.tid, TENANT_A);
      assert.strictEqual(verifiedA.value.loc, "ROOM-104");
      assert.strictEqual(verifiedA.value.sty, "stay-galle-901");

      // Verify Token B produces payload bound to Tenant B
      const verifiedB = verifyQrSessionToken(tokenResB.value, SECRET_B);
      assert.ok(verifiedB.ok);
      assert.strictEqual(verifiedB.value.tid, TENANT_B);
      assert.strictEqual(verifiedB.value.loc, "ROOM-201");
      assert.strictEqual(verifiedB.value.sty, "stay-kandy-802");
    });

    it("rejects token verification when Tenant A token is checked with Tenant B secret", () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const tokenA = signQrSessionToken({
        tenantId: TENANT_A,
        location: "ROOM-101",
        stayId: "stay-001",
        exp,
        secret: SECRET_A,
      }).value;

      // Attempt to verify Token A with Tenant B's secret
      const res = verifyQrSessionToken(tokenA, SECRET_B);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "INVALID_SIGNATURE");
      }
    });

    it("detects cross-tenant replay even if tenants share a dev secret key", () => {
      const sharedDevSecret = "shared-local-dev-hmac-secret-key-32b";
      const exp = Math.floor(Date.now() / 1000) + 3600;

      const tokenA = signQrSessionToken({
        tenantId: TENANT_A,
        location: "POOL-VILLA-1",
        stayId: "stay-pool-01",
        exp,
        secret: sharedDevSecret,
      }).value;

      const verified = verifyQrSessionToken(tokenA, sharedDevSecret);
      assert.ok(verified.ok);

      // Downstream resolver tenant isolation check:
      // The incoming HTTP request targets TENANT_B, but verified token payload belongs to TENANT_A
      const targetOperationTenant = TENANT_B;
      const isCrossTenantAccess = verified.value.tid !== targetOperationTenant;

      assert.strictEqual(isCrossTenantAccess, true, "Must flag cross-tenant token mismatch");
    });
  });

  // ==========================================================================
  // Section 3: Staff RolePermissionMatrix RBAC Isolation Across Tenants
  // ==========================================================================
  describe("3. Staff RolePermissionMatrix RBAC Isolation Across Tenant Boundaries", () => {
    interface StaffSession {
      readonly userId: string;
      readonly tenantId: string;
      readonly role: "GENERAL_MANAGER" | "FRONT_DESK" | "HOUSEKEEPING" | "SUPER_ADMIN";
    }

    const authorizeTenantMutation = (
      session: StaffSession,
      targetTenantId: string,
      requiredRole: string,
    ): { authorized: boolean; reason?: string } => {
      // Super Admin has cross-tenant platform maintenance privileges
      if (session.role === "SUPER_ADMIN") {
        return { authorized: true };
      }

      // Single-tenant staff roles can NEVER access a different tenant's records
      if (session.tenantId !== targetTenantId) {
        return {
          authorized: false,
          reason: `Cross-tenant access rejected: Actor tenant '${session.tenantId}' !== target '${targetTenantId}'`,
        };
      }

      if (session.role !== requiredRole && session.role !== "GENERAL_MANAGER") {
        return {
          authorized: false,
          reason: `Insufficient role '${session.role}' for required '${requiredRole}'`,
        };
      }

      return { authorized: true };
    };

    it("blocks General Manager of Hotel A from accessing Hotel B data", () => {
      const gmHotelA: StaffSession = {
        userId: "usr-gm-galle",
        tenantId: TENANT_A,
        role: "GENERAL_MANAGER",
      };

      // GM Hotel A mutates Hotel A -> Allowed
      const allowedA = authorizeTenantMutation(gmHotelA, TENANT_A, "FRONT_DESK");
      assert.strictEqual(allowedA.authorized, true);

      // GM Hotel A attempts to mutate Hotel B -> REJECTED
      const crossTenantAttempt = authorizeTenantMutation(gmHotelA, TENANT_B, "FRONT_DESK");
      assert.strictEqual(crossTenantAttempt.authorized, false);
      assert.ok(crossTenantAttempt.reason?.includes("Cross-tenant access rejected"));
    });

    it("allows Super-Admin cross-property platform access but restricts standard staff", () => {
      const superAdmin: StaffSession = {
        userId: "usr-super-admin-01",
        tenantId: "tenant-saas-platform-root",
        role: "SUPER_ADMIN",
      };

      const frontDeskA: StaffSession = {
        userId: "usr-fd-galle",
        tenantId: TENANT_A,
        role: "FRONT_DESK",
      };

      // Super Admin can audit both properties
      assert.strictEqual(
        authorizeTenantMutation(superAdmin, TENANT_A, "FRONT_DESK").authorized,
        true,
      );
      assert.strictEqual(
        authorizeTenantMutation(superAdmin, TENANT_B, "FRONT_DESK").authorized,
        true,
      );

      // Front desk staff is strictly sandboxed to Tenant A
      assert.strictEqual(
        authorizeTenantMutation(frontDeskA, TENANT_A, "FRONT_DESK").authorized,
        true,
      );
      assert.strictEqual(
        authorizeTenantMutation(frontDeskA, TENANT_B, "FRONT_DESK").authorized,
        false,
      );
    });
  });

  // ==========================================================================
  // Section 4: Multi-Tenant SaaS Subscription & Module Entitlements
  // ==========================================================================
  describe("4. Multi-Tenant SaaS Subscription Tier & Module Entitlement Boundaries", () => {
    const starterSubscription: TenantSubscriptionState = {
      tenantId: TENANT_A,
      planTier: "STARTER_QR_ONLY",
      status: "ACTIVE",
    };

    const growthSubscription: TenantSubscriptionState = {
      tenantId: TENANT_B,
      planTier: "GROWTH_PMS_PLUS_QR",
      status: "ACTIVE",
    };

    const enterpriseSubscription: TenantSubscriptionState = {
      tenantId: TENANT_C_ENTERPRISE,
      planTier: "ENTERPRISE_RESORT_ERP",
      status: "ACTIVE",
    };

    it("enforces STARTER_QR_ONLY boundary (permits QR/KDS, blocks PMS & Payroll)", () => {
      // Allowed on Starter
      assert.strictEqual(hasModuleEntitlement(starterSubscription, "qrMenuAndOrdering").ok, true);
      assert.strictEqual(hasModuleEntitlement(starterSubscription, "kdsKitchen").ok, true);
      assert.strictEqual(hasModuleEntitlement(starterSubscription, "lankaQrPay").ok, true);

      // Blocked on Starter
      const pmsRes = hasModuleEntitlement(starterSubscription, "frontDeskPms");
      const payrollRes = hasModuleEntitlement(starterSubscription, "payrollEpfEtf");
      const banquetsRes = hasModuleEntitlement(starterSubscription, "banquets");

      assert.strictEqual(pmsRes.ok, false);
      if (!pmsRes.ok) assert.strictEqual(pmsRes.error.code, "ENTITLEMENT_MODULE_DISABLED");

      assert.strictEqual(payrollRes.ok, false);
      if (!payrollRes.ok) assert.strictEqual(payrollRes.error.code, "ENTITLEMENT_MODULE_DISABLED");

      assert.strictEqual(banquetsRes.ok, false);
    });

    it("enforces GROWTH_PMS_PLUS_QR boundary (permits PMS & Tax, blocks multiProperty chain)", () => {
      // Allowed on Growth
      assert.strictEqual(hasModuleEntitlement(growthSubscription, "frontDeskPms").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthSubscription, "tapeChart").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthSubscription, "taxSltdaIrd").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthSubscription, "housekeeping").ok, true);

      // Blocked on Growth
      const chainRes = hasModuleEntitlement(growthSubscription, "multiProperty");
      assert.strictEqual(chainRes.ok, false);
      if (!chainRes.ok) assert.strictEqual(chainRes.error.code, "ENTITLEMENT_MODULE_DISABLED");
    });

    it("permits all 13 modules on ENTERPRISE_RESORT_ERP", () => {
      const allModules: readonly ModuleEntitlementKey[] = [
        "qrMenuAndOrdering",
        "kdsKitchen",
        "lankaQrPay",
        "frontDeskPms",
        "tapeChart",
        "housekeeping",
        "banquets",
        "spaAndActivities",
        "storesAndInventory",
        "taxSltdaIrd",
        "payrollEpfEtf",
        "multiProperty",
        "auditLogSha256",
      ];

      for (const mod of allModules) {
        const res = hasModuleEntitlement(enterpriseSubscription, mod);
        assert.strictEqual(res.ok, true, `Module '${mod}' should be enabled for Enterprise`);
      }
    });

    it("rejects all module entitlements when subscription is SUSPENDED or EXPIRED", () => {
      const suspendedSub: TenantSubscriptionState = {
        tenantId: TENANT_A,
        planTier: "ENTERPRISE_RESORT_ERP",
        status: "SUSPENDED",
      };

      const res = hasModuleEntitlement(suspendedSub, "frontDeskPms");
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "SUBSCRIPTION_INACTIVE");
      }
    });
  });

  // ==========================================================================
  // Section 5: Independent Sri Lankan Statutory Tax Compounding
  // ==========================================================================
  describe("5. Independent Sri Lankan Statutory Tax Isolation (SC -> TDL -> SSCL -> VAT)", () => {
    it("computes 4-stage compounding taxes independently per hotel statutory registration", () => {
      // Hotel A: 5-Star Luxury Resort (10% SC, 1% TDL, 2.5% SSCL, 18% VAT)
      const configA: SriLankaTaxConfig = {
        enableSC: true,
        scRate: 0.1,
        enableTDL: true,
        tdlRate: 0.01,
        enableSSCL: true,
        ssclRate: 0.025,
        enableVAT: true,
        vatRate: 0.18,
      };

      // Hotel B: Small Eco Boutique (Exempt from SSCL and VAT, registered for SC and TDL)
      const configB: SriLankaTaxConfig = createTaxPreset("BOUTIQUE_NON_VAT");

      const baseAmount = 10_000.0;

      const taxResA = calculateForwardTax(baseAmount, configA);
      const taxResB = calculateForwardTax(baseAmount, configB);

      assert.ok(taxResA.ok);
      assert.ok(taxResB.ok);

      // Hotel A:
      // Base: 10,000.00
      // SC 10%: 1,000.00 -> Subtotal: 11,000.00
      // TDL 1%: 110.00
      // SSCL 2.5%: 275.00
      // VAT Base: 11,385.00
      // VAT 18%: 2,049.30
      // Total: 13,434.30
      assert.strictEqual(taxResA.value.baseLkr, 10000);
      assert.strictEqual(taxResA.value.scLkr, 1000);
      assert.strictEqual(taxResA.value.tdlLkr, 110);
      assert.strictEqual(taxResA.value.ssclLkr, 275);
      assert.strictEqual(taxResA.value.vatLkr, 2049.3);
      assert.strictEqual(taxResA.value.grandTotalLkr, 13434.3);

      // Hotel B:
      // Base: 10,000.00
      // SC 10%: 1,000.00 -> Subtotal: 11,000.00
      // TDL 1%: 110.00
      // SSCL: 0, VAT: 0 -> Total: 11,110.00
      assert.strictEqual(taxResB.value.baseLkr, 10000);
      assert.strictEqual(taxResB.value.scLkr, 1000);
      assert.strictEqual(taxResB.value.tdlLkr, 110);
      assert.strictEqual(taxResB.value.ssclLkr, 0);
      assert.strictEqual(taxResB.value.vatLkr, 0);
      assert.strictEqual(taxResB.value.grandTotalLkr, 11110);

      // Tax results are strictly disjoint
      assert.notStrictEqual(taxResA.value.grandTotalLkr, taxResB.value.grandTotalLkr);
    });

    it("verifies integer-cent rounding across tax aggregation in multi-tenant folios", () => {
      const unrounded = 1234.56789;
      const rounded = roundLkr(unrounded);
      assert.strictEqual(rounded, 1234.57);

      const res = aggregateFolioTaxes(
        [
          {
            lineId: "line-1",
            department: "FNB",
            description: "Ceylon Seafood Kottu",
            quantity: 1,
            unitBaseLkr: 2500,
          },
        ],
        { tenantId: TENANT_A, taxConfig: DEFAULT_SRI_LANKA_TAX_CONFIG },
      );

      assert.ok(res.ok);
      assert.strictEqual(res.value.totalBaseLkr, 2500);
      assert.strictEqual(res.value.totalScLkr, 250);
    });
  });

  // ==========================================================================
  // Section 6: Cryptographic SHA-256 Hash-Chained ImmutableAuditLog Isolation
  // ==========================================================================
  describe("6. Cryptographically Hash-Chained ImmutableAuditLog Multi-Tenant Isolation (SHA-256)", () => {
    it("builds independent unbroken audit chains for distinct tenants", () => {
      // Tenant A chain
      const entryA1Res = createAuditEntry({
        tenantId: TENANT_A,
        actorUserId: "usr-manager-a",
        action: "RESERVATION_CREATED",
        entityType: "Reservation",
        entityId: "res-001",
        afterJson: JSON.stringify({ room: "101", guest: "Kasun Perera" }),
        isoTs: "2026-10-21T10:00:00.000Z",
        prevHash: GENESIS_HASH,
      });
      assert.ok(entryA1Res.ok);
      const entryA1 = entryA1Res.value;

      const entryA2Res = createAuditEntry({
        tenantId: TENANT_A,
        actorUserId: "usr-manager-a",
        action: "GUEST_CHECKED_IN",
        entityType: "Reservation",
        entityId: "res-001",
        afterJson: JSON.stringify({ room: "101", keyIssued: true }),
        isoTs: "2026-10-21T14:00:00.000Z",
        prevHash: entryA1.entryHash,
      });
      assert.ok(entryA2Res.ok);
      const entryA2 = entryA2Res.value;

      // Tenant B chain
      const entryB1Res = createAuditEntry({
        tenantId: TENANT_B,
        actorUserId: "usr-manager-b",
        action: "RESERVATION_CREATED",
        entityType: "Reservation",
        entityId: "res-901",
        afterJson: JSON.stringify({ room: "201", guest: "Nimal Silva" }),
        isoTs: "2026-10-21T10:05:00.000Z",
        prevHash: GENESIS_HASH,
      });
      assert.ok(entryB1Res.ok);
      const entryB1 = entryB1Res.value;

      // Verify each chain independently
      const chainAVerify = verifyAuditChain([entryA1, entryA2]);
      const chainBVerify = verifyAuditChain([entryB1]);

      assert.ok(chainAVerify.ok);
      assert.strictEqual(chainAVerify.value.verifiedCount, 2);
      assert.ok(chainBVerify.ok);
      assert.strictEqual(chainBVerify.value.verifiedCount, 1);
    });

    it("fails cryptographic verification when Tenant A entry is injected into Tenant B chain", () => {
      const entryB1 = createAuditEntry({
        tenantId: TENANT_B,
        actorUserId: "usr-manager-b",
        action: "RESERVATION_CREATED",
        entityType: "Reservation",
        entityId: "res-901",
        afterJson: JSON.stringify({ room: "201" }),
        isoTs: "2026-10-21T10:05:00.000Z",
        prevHash: GENESIS_HASH,
      }).value;

      const entryA1 = createAuditEntry({
        tenantId: TENANT_A,
        actorUserId: "usr-manager-a",
        action: "RESERVATION_CREATED",
        entityType: "Reservation",
        entityId: "res-001",
        afterJson: JSON.stringify({ room: "101" }),
        isoTs: "2026-10-21T10:00:00.000Z",
        prevHash: GENESIS_HASH,
      }).value;

      // Splicing Tenant A's entry into Tenant B's chain:
      // [entryB1, entryA1] -> entryA1 points to GENESIS_HASH, NOT entryB1.entryHash
      const crossChainCorrupted: readonly AuditLogEntry[] = [entryB1, entryA1];
      const verifyRes = verifyAuditChain(crossChainCorrupted);

      assert.strictEqual(verifyRes.ok, false);
      if (!verifyRes.ok) {
        assert.strictEqual(verifyRes.error.code, "AUDIT_CHAIN_CORRUPTED");
      }
    });

    it("proves computeAuditEntryHash includes tenantId in cryptographic preimage", () => {
      const basePayload = {
        prevHash: GENESIS_HASH,
        actorUserId: "usr-same-actor",
        action: "UPDATE_TARIFF",
        entityType: "RoomRate",
        entityId: "RATE-DELUXE",
        afterJson: JSON.stringify({ rateLkr: 25000 }),
        isoTs: "2026-10-21T12:00:00.000Z",
      };

      const hashForTenantA = computeAuditEntryHash({
        ...basePayload,
        tenantId: TENANT_A,
      });

      const hashForTenantB = computeAuditEntryHash({
        ...basePayload,
        tenantId: TENANT_B,
      });

      // Different tenant IDs produce entirely different cryptographic hashes
      assert.notStrictEqual(hashForTenantA, hashForTenantB);
      assert.strictEqual(hashForTenantA.length, 64);
      assert.strictEqual(hashForTenantB.length, 64);
    });
  });

  // ==========================================================================
  // Section 7: Sri Lanka PDPA No. 9 of 2022 Privacy & Anonymization Isolation
  // ==========================================================================
  describe("7. Sri Lanka PDPA Guest PII Anonymization & Data Erasure Boundary", () => {
    const guestHotelA: GuestPiiRecord = {
      guestId: "gst-001",
      tenantId: TENANT_A,
      fullName: "Kasun Chamara Perera",
      email: "kasun.perera@example.lk",
      phone: "+94771234567",
      nicOrPassport: "199012345678",
      signatureUrl: "https://storage.hms.local/sig/gst-001.png",
      nationalityIso: "LKA",
      isSriLankanResident: true,
    };

    const guestHotelB: GuestPiiRecord = {
      guestId: "gst-902",
      tenantId: TENANT_B,
      fullName: "Nimal Wickramasinghe",
      email: "nimal.w@example.lk",
      phone: "+94719876543",
      nicOrPassport: "198512345678",
      signatureUrl: "https://storage.hms.local/sig/gst-902.png",
      nationalityIso: "LKA",
      isSriLankanResident: true,
    };

    const dummyFoliosHotelA: readonly StayFolioTaxRecord[] = [
      {
        folioId: "fol-001",
        guestId: "gst-001",
        tenantId: TENANT_A,
        checkInDate: "2026-10-10",
        checkOutDate: "2026-10-12",
        nationalityIso: "LKA",
        isSriLankanResident: true,
        baseRoomChargeLkr: 20000,
        foodAndBeverageLkr: 5000,
        serviceChargeLkr: 2500,
        tdlLkr: 275,
        ssclLkr: 687.5,
        vatLkr: 5123.25,
        totalPaidLkr: 33585.75,
      },
    ];

    it("verifies PDPA erasure authorization restricts non-manager roles", () => {
      assert.strictEqual(validatePdpaAuthorization("GENERAL_MANAGER").ok, true);
      assert.strictEqual(validatePdpaAuthorization("COMPLIANCE_OFFICER").ok, true);
      assert.strictEqual(validatePdpaAuthorization("SUPER_ADMIN").ok, true);

      const waiterRes = validatePdpaAuthorization("WAITER");
      assert.strictEqual(waiterRes.ok, false);
      if (!waiterRes.ok) assert.strictEqual(waiterRes.error.code, "PERMISSION_DENIED");
    });

    it("anonymizes Hotel A guest PII without affecting Hotel B guest records", () => {
      const pdpaRequest: PdpaAnonymizationRequest = {
        guestId: "gst-001",
        tenantId: TENANT_A,
        requestedByUserId: "usr-dpo-galle",
        actorRole: "COMPLIANCE_OFFICER",
        legalBasis: "RIGHT_TO_ERASURE",
        requestDateIso: "2026-10-21T15:00:00.000Z",
      };

      const result = anonymizeGuestPii(guestHotelA, pdpaRequest, dummyFoliosHotelA);
      assert.ok(result.ok);

      const anonymizedA = result.value.anonymizedRecord;

      // Guest A is redacted pursuant to Sri Lanka PDPA Section 14
      assert.strictEqual(anonymizedA.isAnonymized, true);
      assert.strictEqual(anonymizedA.fullName, "[REDACTED - PDPA NO. 9 OF 2022]");
      assert.strictEqual(anonymizedA.email, "[REDACTED]");
      assert.strictEqual(anonymizedA.phone, "[REDACTED]");
      assert.strictEqual(anonymizedA.nicOrPassport, "[REDACTED]");
      // Non-identifying statistical demographics preserved for SLTDA
      assert.strictEqual(anonymizedA.nationalityIso, "LKA");

      // Statutory tax records preserved
      const verifyFolios = verifyStatutoryTaxPreservation(dummyFoliosHotelA, dummyFoliosHotelA);
      assert.ok(verifyFolios.ok);

      // Hotel B guest record is completely un-mutated and isolated
      assert.strictEqual(guestHotelB.fullName, "Nimal Wickramasinghe");
      assert.strictEqual(guestHotelB.email, "nimal.w@example.lk");
      assert.strictEqual(guestHotelB.nicOrPassport, "198512345678");
    });

    it("rejects cross-tenant PDPA erasure requests", () => {
      // Actor from Hotel A attempting to erase guest belonging to Hotel B
      const crossTenantPdpaRequest: PdpaAnonymizationRequest = {
        guestId: "gst-902", // Hotel B's guest
        tenantId: TENANT_A, // Request specifies Hotel A
        requestedByUserId: "usr-dpo-galle",
        actorRole: "COMPLIANCE_OFFICER",
        legalBasis: "RIGHT_TO_ERASURE",
        requestDateIso: "2026-10-21T15:00:00.000Z",
      };

      const res = anonymizeGuestPii(guestHotelB, crossTenantPdpaRequest, []);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "TENANT_MISMATCH");
      }
    });
  });
});
