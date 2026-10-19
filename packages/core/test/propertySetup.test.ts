/**
 * @hms/core - Integration Test for Property Setup & Tax Preset Persistence (propertySetup.test.ts)
 *
 * Validates the end-to-end multi-tenant property configuration, tax preset switching,
 * dual-currency rate matrix serialization, RBAC role permission checks,
 * SaasSubscription tier entitlements, 4-stage compounding Sri Lankan tax rules,
 * and SHA-256 hash-chained ImmutableAuditLog persistence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  GENESIS_HASH,
  computeAuditEntryHash,
  createAuditEntry,
  verifyAuditChain,
} from "../src/auditChain.js";
import {
  validateIrdTin,
  validateIrdVatRegNo,
  validateSltdaRegNo,
  validateSriLankanMobile,
  validateTenantId,
} from "../src/config.js";
import { convertForeignToLkrBase, lockExchangeRate } from "../src/currencyLock.js";
import { calculateStayQuote } from "../src/rateQuote.js";
import {
  type SriLankaTaxConfig,
  type SriLankaTaxPreset,
  calculateForwardTax,
  calculateReverseTax,
  createTaxPreset,
  roundLkr,
} from "../src/tax.js";

// ============================================================================
// Multi-Tenant Domain Models for Property & SaaS Entitlements (Test Scaffolding)
// ============================================================================

type SaasTier = "FREE" | "STARTER" | "PRO" | "ENTERPRISE";

interface SaasSubscription {
  readonly tenantId: string;
  readonly tier: SaasTier;
  readonly maxRooms: number;
  readonly allowDualCurrency: boolean;
  readonly allowCustomTaxes: boolean;
  readonly allowChannelManager: boolean;
  readonly active: boolean;
}

type StaffRole =
  | "SUPER_ADMIN"
  | "HOTEL_OWNER"
  | "GENERAL_MANAGER"
  | "FRONT_DESK"
  | "RESERVATIONIST"
  | "HOUSEKEEPING"
  | "WAITER";

type RolePermission =
  | "MANAGE_PROPERTY_SETTINGS"
  | "MODIFY_TAX_CONFIG"
  | "MODIFY_RATE_MATRIX"
  | "CREATE_RESERVATION"
  | "VIEW_FOLIO";

const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly RolePermission[]>> = {
  SUPER_ADMIN: [
    "MANAGE_PROPERTY_SETTINGS",
    "MODIFY_TAX_CONFIG",
    "MODIFY_RATE_MATRIX",
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
  ],
  HOTEL_OWNER: [
    "MANAGE_PROPERTY_SETTINGS",
    "MODIFY_TAX_CONFIG",
    "MODIFY_RATE_MATRIX",
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
  ],
  GENERAL_MANAGER: [
    "MANAGE_PROPERTY_SETTINGS",
    "MODIFY_TAX_CONFIG",
    "MODIFY_RATE_MATRIX",
    "CREATE_RESERVATION",
    "VIEW_FOLIO",
  ],
  FRONT_DESK: ["CREATE_RESERVATION", "VIEW_FOLIO"],
  RESERVATIONIST: ["CREATE_RESERVATION", "VIEW_FOLIO"],
  HOUSEKEEPING: ["VIEW_FOLIO"],
  WAITER: ["VIEW_FOLIO"],
};

function hasPermission(role: StaffRole, permission: RolePermission): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed ? allowed.includes(permission) : false;
}

function authorizePropertyMutation(
  callerTenantId: string,
  callerRole: StaffRole,
  targetTenantId: string,
  permission: RolePermission,
): boolean {
  if (callerRole === "SUPER_ADMIN") {
    return true;
  }
  if (callerTenantId !== targetTenantId) {
    return false;
  }
  return hasPermission(callerRole, permission);
}

interface PropertyConfig {
  readonly id: string;
  readonly name: string;
  readonly legalName: string;
  readonly address: string;
  readonly city: string;
  readonly district: string;
  readonly phone: string;
  readonly email: string;
  readonly sltdaRegNo: string;
  readonly tinNo: string;
  readonly vatRegNo?: string | undefined;
  readonly lankaQrMerchantId?: string | undefined;
  readonly cbslUsdRateLkr: number;
  readonly currency: string;
  readonly taxPreset: SriLankaTaxPreset;
  readonly taxConfig: SriLankaTaxConfig;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RoomTypeRateConfig {
  readonly id: string;
  readonly name: string;
  readonly baseRateLkr: number;
  readonly baseRateUsd: number;
  readonly maxOccupancy: number;
  readonly isDormBed: boolean;
}

function appendAuditRecord(
  chain: AuditLogEntry[],
  tenantId: string,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  isoTs: string,
  afterJson: string,
): void {
  const prevHash = chain.length > 0 ? chain[chain.length - 1]?.entryHash : GENESIS_HASH;
  const entryRes = createAuditEntry({
    tenantId,
    actorUserId,
    action,
    entityType,
    entityId,
    isoTs,
    afterJson,
    prevHash,
  });
  assert.equal(entryRes.ok, true);
  if (entryRes.ok) {
    chain.push(entryRes.value);
  }
}

// ============================================================================
// Test Suite: Property Setup & Tax Preset Persistence
// ============================================================================

describe("Integration Test: Property Setup & Tax Preset Persistence", () => {
  describe("1. Multi-Tenant Property Configuration & Statutory Identity", () => {
    it("validates and normalizes tenant identifier slug", () => {
      const valid = validateTenantId("galle-fort-heritage");
      assert.equal(valid.ok, true);
      if (valid.ok) {
        assert.equal(valid.value, "galle-fort-heritage");
      }

      const uppercase = validateTenantId("  MIRISSA-PALMS-RESORT  ");
      assert.equal(uppercase.ok, true);
      if (uppercase.ok) {
        assert.equal(uppercase.value, "mirissa-palms-resort");
      }

      const invalid = validateTenantId("ab");
      assert.equal(invalid.ok, false);
      const invalidChars = validateTenantId("hotel_with_underscore");
      assert.equal(invalidChars.ok, false);
    });

    it("validates Sri Lankan statutory credentials (SLTDA, TIN, VAT, canonical phone)", () => {
      const sltda = validateSltdaRegNo("SLTDA/SQA/HOTEL/00456");
      assert.equal(sltda.ok, true);

      const tin = validateIrdTin("109876543");
      assert.equal(tin.ok, true);

      const vat = validateIrdVatRegNo("109876543-7000");
      assert.equal(vat.ok, true);

      const phone = validateSriLankanMobile("077 345 6789");
      assert.equal(phone.ok, true);
      if (phone.ok) {
        assert.equal(phone.value, "+94773456789");
      }
    });

    it("serializes and deserializes Property entity with complete statutory attributes", () => {
      const property: PropertyConfig = {
        id: "bentota-surf-haven",
        name: "Bentota Surf Haven",
        legalName: "Bentota Surf Haven (Pvt) Ltd",
        address: "124 Galle Road, Bentota",
        city: "Bentota",
        district: "Galle",
        phone: "+94773456789",
        email: "reservations@bentotasurfhaven.lk",
        sltdaRegNo: "SLTDA/SQA/HOTEL/00456",
        tinNo: "109876543",
        vatRegNo: "109876543-7000",
        lankaQrMerchantId: "LANKAQR#BENTOTA01",
        cbslUsdRateLkr: 308.5,
        currency: "LKR",
        taxPreset: "LUXURY_VAT_HOTEL",
        taxConfig: createTaxPreset("LUXURY_VAT_HOTEL"),
        createdAt: "2026-10-19T00:00:00.000Z",
        updatedAt: "2026-10-19T00:00:00.000Z",
      };

      const serialized = JSON.stringify(property);
      const parsed = JSON.parse(serialized) as PropertyConfig;

      assert.equal(parsed.id, "bentota-surf-haven");
      assert.equal(parsed.taxPreset, "LUXURY_VAT_HOTEL");
      assert.equal(parsed.taxConfig.enableSC, true);
      assert.equal(parsed.taxConfig.scRate, 0.1);
      assert.equal(parsed.taxConfig.enableVAT, true);
      assert.equal(parsed.taxConfig.vatRate, 0.18);
      assert.equal(parsed.cbslUsdRateLkr, 308.5);
    });
  });

  describe("2. Tax Preset Switching & 4-Stage Compounding Verification", () => {
    it("verifies LUXURY_VAT_HOTEL 4-stage tax compounding (SC 10% -> TDL 1% -> SSCL 2.5% -> VAT 18%)", () => {
      const config = createTaxPreset("LUXURY_VAT_HOTEL");
      const baseSupplyLkr = 75000;
      const res = calculateForwardTax(baseSupplyLkr, config);

      assert.equal(res.ok, true);
      if (!res.ok) return;

      assert.equal(res.value.baseLkr, 75000);
      assert.equal(res.value.scLkr, 7500); // 10% of 75,000
      assert.equal(res.value.subtotalAfterScLkr, 82500);
      assert.equal(res.value.tdlLkr, 825); // 1% of 82,500
      assert.equal(res.value.ssclLkr, 2062.5); // 2.5% of 82,500
      assert.equal(res.value.vatBaseLkr, 85387.5); // 82,500 + 825 + 2062.50
      assert.equal(res.value.vatLkr, 15369.75); // 18% of 85,387.50
      assert.equal(res.value.grandTotalLkr, 100757.25);
      assert.equal(res.value.isVatRegistered, true);
    });

    it("verifies BOUTIQUE_NON_VAT (10% SC, 1% TDL, 0% SSCL, 0% VAT)", () => {
      const config = createTaxPreset("BOUTIQUE_NON_VAT");
      const baseSupplyLkr = 40000;
      const res = calculateForwardTax(baseSupplyLkr, config);

      assert.equal(res.ok, true);
      if (!res.ok) return;

      assert.equal(res.value.baseLkr, 40000);
      assert.equal(res.value.scLkr, 4000); // 10% of 40,000
      assert.equal(res.value.subtotalAfterScLkr, 44000);
      assert.equal(res.value.tdlLkr, 440); // 1% of 44,000
      assert.equal(res.value.ssclLkr, 0);
      assert.equal(res.value.vatLkr, 0);
      assert.equal(res.value.grandTotalLkr, 44440);
      assert.equal(res.value.isVatRegistered, false);
    });

    it("verifies SMALL_GUESTHOUSE_05_TDL (0% SC, 0.5% TDL, 0% SSCL, 0% VAT)", () => {
      const config = createTaxPreset("SMALL_GUESTHOUSE_05_TDL");
      const baseSupplyLkr = 20000;
      const res = calculateForwardTax(baseSupplyLkr, config);

      assert.equal(res.ok, true);
      if (!res.ok) return;

      assert.equal(res.value.baseLkr, 20000);
      assert.equal(res.value.scLkr, 0);
      assert.equal(res.value.tdlLkr, 100); // 0.5% of 20,000
      assert.equal(res.value.ssclLkr, 0);
      assert.equal(res.value.vatLkr, 0);
      assert.equal(res.value.grandTotalLkr, 20100);
      assert.equal(res.value.isVatRegistered, false);
    });

    it("verifies TAX_EXEMPT preset maintains 1:1 base-to-grand-total parity", () => {
      const config = createTaxPreset("TAX_EXEMPT");
      const baseSupplyLkr = 35000;
      const res = calculateForwardTax(baseSupplyLkr, config);

      assert.equal(res.ok, true);
      if (!res.ok) return;

      assert.equal(res.value.baseLkr, 35000);
      assert.equal(res.value.scLkr, 0);
      assert.equal(res.value.tdlLkr, 0);
      assert.equal(res.value.ssclLkr, 0);
      assert.equal(res.value.vatLkr, 0);
      assert.equal(res.value.grandTotalLkr, 35000);
    });

    it("verifies reverse tax extraction from gross inclusive quotation exactly reconciles", () => {
      const config = createTaxPreset("LUXURY_VAT_HOTEL");
      const grossInclusiveLkr = 100757.25;
      const rev = calculateReverseTax(grossInclusiveLkr, config);

      assert.equal(rev.ok, true);
      if (!rev.ok) return;

      assert.equal(rev.value.baseLkr, 75000);
      assert.equal(rev.value.grandTotalLkr, 100757.25);
      assert.equal(rev.value.vatLkr, 15369.75);
    });
  });

  describe("3. Dual-Currency Rate Matrix & CBSL Exchange Rate Locking", () => {
    const cbslExchangeRate = 305.5; // LKR per USD

    const roomRates: readonly RoomTypeRateConfig[] = [
      {
        id: "DELUXE_OCEAN_SUITE",
        name: "Deluxe Ocean Suite",
        baseRateLkr: 60000,
        baseRateUsd: 196.4,
        maxOccupancy: 3,
        isDormBed: false,
      },
      {
        id: "SUPERIOR_GARDEN_VILLA",
        name: "Superior Garden Villa",
        baseRateLkr: 45000,
        baseRateUsd: 147.3,
        maxOccupancy: 2,
        isDormBed: false,
      },
      {
        id: "DRIVER_DORM_BED",
        name: "Chauffeur / Driver Dormitory Bed",
        baseRateLkr: 3500,
        baseRateUsd: 11.46,
        maxOccupancy: 1,
        isDormBed: true,
      },
    ];

    it("converts USD foreign rate to locked LKR base with integer-cent rounding", () => {
      const suite = roomRates[0];
      assert.ok(suite);

      const convertedLkr = convertForeignToLkrBase(suite.baseRateUsd, cbslExchangeRate);
      assert.equal(convertedLkr.ok, true);
      if (convertedLkr.ok) {
        assert.equal(convertedLkr.value, 60000.2);
      }

      const locked = lockExchangeRate({
        foreignCurrency: "USD",
        foreignAmount: suite.baseRateUsd,
        lockedExchangeRateLkr: cbslExchangeRate,
        tenantId: "bentota-surf-haven",
      });
      assert.equal(locked.ok, true);
      if (locked.ok) {
        assert.equal(locked.value.baseLkr, 60000.2);
        assert.equal(locked.value.foreignCurrency, "USD");
        assert.equal(locked.value.lockedExchangeRateLkr, 305.5);
      }
    });

    it("computes multi-night rate quote across seasonal bands using locked rates", () => {
      const quoteRes = calculateStayQuote({
        tenantId: "bentota-surf-haven",
        checkInDate: "2026-12-14",
        checkOutDate: "2026-12-16",
        roomCategoryId: "DELUXE_OCEAN_SUITE",
        residencyTier: "RESIDENT",
        adultCount: 2,
        mealPlan: "HB",
        pricingModel: "TAX_EXCLUSIVE",
        baseRateLkr: 60000,
        seasonalBands: [
          {
            id: "peak-festive",
            name: "Peak Festive Season",
            bandType: "PEAK",
            startDate: "12-15",
            endDate: "01-15",
            multiplier: 1.35,
          },
        ],
        mealPlanSupplementsLkr: {
          HB: 4500,
        },
      });

      assert.equal(quoteRes.ok, true);
      if (!quoteRes.ok) return;

      const quote = quoteRes.value;
      assert.equal(quote.totalNights, 2);
      assert.equal(quote.nights[0]?.date, "2026-12-14");
      assert.equal(quote.nights[0]?.seasonalMultiplier, 1.0);
      assert.equal(quote.nights[1]?.date, "2026-12-15");
      assert.equal(quote.nights[1]?.seasonalMultiplier, 1.35);

      // Verify rounding on tax and grand total
      assert.equal(quote.grandTotalLkr, roundLkr(quote.grandTotalLkr));
      assert.ok(quote.totalVatLkr > 0);
    });
  });

  describe("4. RolePermissionMatrix RBAC & Tenant Isolation Guard", () => {
    const tenantA = "bentota-surf-haven";
    const tenantB = "kandy-hills-villa";

    it("grants property and tax configuration access to Owner and GM within their tenant", () => {
      assert.equal(
        authorizePropertyMutation(tenantA, "HOTEL_OWNER", tenantA, "MANAGE_PROPERTY_SETTINGS"),
        true,
      );
      assert.equal(
        authorizePropertyMutation(tenantA, "GENERAL_MANAGER", tenantA, "MODIFY_TAX_CONFIG"),
        true,
      );
      assert.equal(
        authorizePropertyMutation(tenantA, "GENERAL_MANAGER", tenantA, "MODIFY_RATE_MATRIX"),
        true,
      );
    });

    it("rejects front-desk and service staff from mutating tax and rate configuration", () => {
      assert.equal(
        authorizePropertyMutation(tenantA, "FRONT_DESK", tenantA, "MODIFY_TAX_CONFIG"),
        false,
      );
      assert.equal(
        authorizePropertyMutation(tenantA, "HOUSEKEEPING", tenantA, "MANAGE_PROPERTY_SETTINGS"),
        false,
      );
      assert.equal(
        authorizePropertyMutation(tenantA, "WAITER", tenantA, "MODIFY_RATE_MATRIX"),
        false,
      );
    });

    it("blocks cross-tenant property mutations even for General Managers", () => {
      assert.equal(
        authorizePropertyMutation(tenantA, "GENERAL_MANAGER", tenantB, "MODIFY_TAX_CONFIG"),
        false,
      );
      assert.equal(
        authorizePropertyMutation(tenantA, "HOTEL_OWNER", tenantB, "MANAGE_PROPERTY_SETTINGS"),
        false,
      );
    });

    it("allows SuperAdmin global cross-tenant management", () => {
      assert.equal(
        authorizePropertyMutation("any-tenant", "SUPER_ADMIN", tenantB, "MODIFY_TAX_CONFIG"),
        true,
      );
    });
  });

  describe("5. SaasSubscription Entitlements & Quotas", () => {
    const freeSub: SaasSubscription = {
      tenantId: "colombo-guesthouse",
      tier: "FREE",
      maxRooms: 5,
      allowDualCurrency: false,
      allowCustomTaxes: false,
      allowChannelManager: false,
      active: true,
    };

    const proSub: SaasSubscription = {
      tenantId: "bentota-surf-haven",
      tier: "PRO",
      maxRooms: 100,
      allowDualCurrency: true,
      allowCustomTaxes: true,
      allowChannelManager: true,
      active: true,
    };

    function validateRoomCreationEntitlement(
      sub: SaasSubscription,
      currentRoomCount: number,
    ): boolean {
      return sub.active && currentRoomCount < sub.maxRooms;
    }

    function validateDualCurrencyEntitlement(sub: SaasSubscription): boolean {
      return sub.active && sub.allowDualCurrency;
    }

    it("enforces room capacity quota limits according to SaaS tier", () => {
      assert.equal(validateRoomCreationEntitlement(freeSub, 4), true);
      assert.equal(validateRoomCreationEntitlement(freeSub, 5), false); // Exceeded FREE tier max 5
      assert.equal(validateRoomCreationEntitlement(proSub, 50), true);
    });

    it("enforces feature entitlements for dual currency", () => {
      assert.equal(validateDualCurrencyEntitlement(freeSub), false);
      assert.equal(validateDualCurrencyEntitlement(proSub), true);
    });
  });

  describe("6. SHA-256 Hash-Chained ImmutableAuditLog Persistence", () => {
    it("records unbroken cryptographic audit trail across sequential property & tax mutations", () => {
      const chain: AuditLogEntry[] = [];
      const tenantId = "bentota-surf-haven";
      const actorUserId = "USER#gm-001";

      appendAuditRecord(
        chain,
        tenantId,
        actorUserId,
        "PROPERTY_INITIALIZED",
        "Property",
        tenantId,
        "2026-10-19T08:00:00.000Z",
        JSON.stringify({
          name: "Bentota Surf Haven",
          taxPreset: "BOUTIQUE_NON_VAT",
        }),
      );

      appendAuditRecord(
        chain,
        tenantId,
        actorUserId,
        "TAX_PRESET_CHANGED",
        "TaxConfig",
        `${tenantId}#TAX`,
        "2026-10-19T08:15:00.000Z",
        JSON.stringify({
          taxPreset: "LUXURY_VAT_HOTEL",
          enableVAT: true,
          vatRate: 0.18,
        }),
      );

      appendAuditRecord(
        chain,
        tenantId,
        actorUserId,
        "CBSL_RATE_UPDATED",
        "Property",
        tenantId,
        "2026-10-19T08:30:00.000Z",
        JSON.stringify({
          cbslUsdRateLkr: 308.5,
        }),
      );

      appendAuditRecord(
        chain,
        tenantId,
        actorUserId,
        "ROOM_RATE_MATRIX_UPDATED",
        "RoomType",
        "DELUXE_OCEAN_SUITE",
        "2026-10-19T08:45:00.000Z",
        JSON.stringify({
          baseRateLkr: 60000,
          baseRateUsd: 196.4,
        }),
      );

      const verification = verifyAuditChain(chain);
      assert.equal(verification.ok, true);
      if (verification.ok) {
        assert.equal(verification.value.verifiedCount, 4);
      }
    });

    it("detects cryptographic tampering when historical state payload is modified", () => {
      const chain: AuditLogEntry[] = [];
      const tenantId = "bentota-surf-haven";
      const actorUserId = "USER#gm-001";

      const e1 = createAuditEntry({
        tenantId,
        actorUserId,
        action: "TAX_PRESET_CHANGED",
        entityType: "TaxConfig",
        entityId: `${tenantId}#TAX`,
        isoTs: "2026-10-19T09:00:00.000Z",
        afterJson: JSON.stringify({ taxPreset: "LUXURY_VAT_HOTEL", vatRate: 0.18 }),
      });
      assert.equal(e1.ok, true);
      if (e1.ok) chain.push(e1.value);

      const prev1 = chain[0]?.entryHash;
      const e2 = createAuditEntry({
        tenantId,
        actorUserId,
        action: "CBSL_RATE_UPDATED",
        entityType: "Property",
        entityId: tenantId,
        isoTs: "2026-10-19T09:10:00.000Z",
        afterJson: JSON.stringify({ cbslUsdRateLkr: 308.5 }),
        prevHash: prev1,
      });
      assert.equal(e2.ok, true);
      if (e2.ok) chain.push(e2.value);

      // Malicious tamper: adversary rewrites historical tax rate in e1
      const tamperedChain: AuditLogEntry[] = [
        {
          ...(chain[0] as AuditLogEntry),
          afterJson: JSON.stringify({ taxPreset: "LUXURY_VAT_HOTEL", vatRate: 0.08 }),
        },
        chain[1] as AuditLogEntry,
      ];

      const verification = verifyAuditChain(tamperedChain);
      assert.equal(verification.ok, false);
      if (!verification.ok) {
        assert.equal(verification.error.code, "AUDIT_CHAIN_CORRUPTED");
      }
    });

    it("verifies computeAuditEntryHash produces deterministic digest matching createAuditEntry", () => {
      const hashInput = {
        prevHash: GENESIS_HASH,
        tenantId: "bentota-surf-haven",
        actorUserId: "USER#gm-001",
        action: "PROPERTY_INITIALIZED",
        entityType: "Property",
        entityId: "bentota-surf-haven",
        isoTs: "2026-10-19T08:00:00.000Z",
        afterJson: JSON.stringify({ name: "Bentota Surf Haven" }),
      };

      const directHash = computeAuditEntryHash(hashInput);
      const entryRes = createAuditEntry({
        tenantId: hashInput.tenantId,
        actorUserId: hashInput.actorUserId,
        action: hashInput.action,
        entityType: hashInput.entityType,
        entityId: hashInput.entityId,
        isoTs: hashInput.isoTs,
        afterJson: hashInput.afterJson,
        prevHash: hashInput.prevHash,
      });

      assert.equal(entryRes.ok, true);
      if (entryRes.ok) {
        assert.equal(entryRes.value.entryHash, directHash);
      }
    });
  });
});
