import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ModuleEntitlementKey,
  type TenantSubscriptionState,
  assertModuleEntitled,
  canCreateBanquetBooking,
  canCreateReservation,
  canRunPayroll,
  hasModuleEntitlement,
  validateRoomCountQuota,
} from "../src/entitlements.js";

describe("Step 458 (Phase 19.08): SaaS Tier Module Entitlements Unit Tests (entitlements.test.ts)", () => {
  const starterTenant: TenantSubscriptionState = {
    tenantId: "tenant-beach-cafe",
    planTier: "STARTER_QR_ONLY",
    status: "ACTIVE",
    currentRoomCount: 10,
  };

  const growthTenant: TenantSubscriptionState = {
    tenantId: "tenant-galle-boutique",
    planTier: "GROWTH_PMS_PLUS_QR",
    status: "ACTIVE",
    currentRoomCount: 25,
  };

  const enterpriseTenant: TenantSubscriptionState = {
    tenantId: "tenant-shangri-la-colombo",
    planTier: "ENTERPRISE_RESORT_ERP",
    status: "ACTIVE",
    currentRoomCount: 300,
  };

  describe("1. STARTER_QR_ONLY Tier Constraints", () => {
    it("permits QR menu and ordering module", () => {
      const res = hasModuleEntitlement(starterTenant, "qrMenuAndOrdering");
      assert.strictEqual(res.ok, true);
    });

    it("rejects Front Desk PMS on starter tier without add-ons", () => {
      const res = hasModuleEntitlement(starterTenant, "frontDeskPms");
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "ENTITLEMENT_MODULE_DISABLED");
      }
    });

    it("rejects Banquets module on starter tier", () => {
      const res = hasModuleEntitlement(starterTenant, "banquets");
      assert.strictEqual(res.ok, false);
    });

    it("rejects HR and Payroll on starter tier", () => {
      const res = hasModuleEntitlement(starterTenant, "payrollEpfEtf");
      assert.strictEqual(res.ok, false);
    });

    it("enforces Rung 2: canCreateReservation blocks reservation creation on STARTER_QR_ONLY", () => {
      const res = canCreateReservation(starterTenant);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "ENTITLEMENT_MODULE_DISABLED");
      }
    });
  });

  describe("2. GROWTH_PMS_PLUS_QR Tier Capabilities", () => {
    it("permits both QR Ordering and Front Desk PMS", () => {
      assert.strictEqual(hasModuleEntitlement(growthTenant, "qrMenuAndOrdering").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "frontDeskPms").ok, true);
    });

    it("permits KDS kitchen and Tape Chart", () => {
      assert.strictEqual(hasModuleEntitlement(growthTenant, "kdsKitchen").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "tapeChart").ok, true);
    });

    it("permits canCreateReservation guard", () => {
      assert.strictEqual(canCreateReservation(growthTenant).ok, true);
    });

    it("rejects Enterprise-only modules like banquets without add-on", () => {
      assert.strictEqual(hasModuleEntitlement(growthTenant, "banquets").ok, false);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "payrollEpfEtf").ok, false);
    });
  });

  describe("3. ENTERPRISE_RESORT_ERP Tier Comprehensive Unlocks", () => {
    const allModules: ModuleEntitlementKey[] = [
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

    it("unlocks all 13 ERP hospitality modules", () => {
      for (const mod of allModules) {
        const res = hasModuleEntitlement(enterpriseTenant, mod);
        assert.strictEqual(res.ok, true, `Module ${mod} should be entitled for ENTERPRISE`);
      }
    });

    it("permits banquet booking creation", () => {
      assert.strictEqual(canCreateBanquetBooking(enterpriseTenant).ok, true);
    });

    it("permits monthly payroll runs", () => {
      assert.strictEqual(canRunPayroll(enterpriseTenant).ok, true);
    });
  });

  describe("4. Custom Feature Flag Add-Ons", () => {
    it("unlocks Front Desk PMS on STARTER tier if actively purchased as add-on", () => {
      const starterWithPmsAddon: TenantSubscriptionState = {
        ...starterTenant,
        activeAddOns: ["frontDeskPms"],
      };

      const res = hasModuleEntitlement(starterWithPmsAddon, "frontDeskPms");
      assert.strictEqual(res.ok, true);
      assert.strictEqual(canCreateReservation(starterWithPmsAddon).ok, true);
    });

    it("unlocks banquets on GROWTH tier via add-on", () => {
      const growthWithBanquetAddon: TenantSubscriptionState = {
        ...growthTenant,
        activeAddOns: ["banquets"],
      };

      assert.strictEqual(canCreateBanquetBooking(growthWithBanquetAddon).ok, true);
    });
  });

  describe("5. Room Count Quota Validation", () => {
    it("allows rooms within tier limit (15 for STARTER)", () => {
      assert.strictEqual(validateRoomCountQuota(starterTenant, 15).ok, true);
    });

    it("rejects room count exceeding tier limit (16 for STARTER)", () => {
      const res = validateRoomCountQuota(starterTenant, 16);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "PLAN_LIMITATION");
      }
    });

    it("allows up to 40 rooms on GROWTH tier", () => {
      assert.strictEqual(validateRoomCountQuota(growthTenant, 40).ok, true);
      assert.strictEqual(validateRoomCountQuota(growthTenant, 41).ok, false);
    });
  });

  describe("6. Assertion Utility", () => {
    it("assertModuleEntitled returns error result on disabled module", () => {
      const res = assertModuleEntitled(starterTenant, "payrollEpfEtf");
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "ENTITLEMENT_MODULE_DISABLED");
      }
    });

    it("assertModuleEntitled succeeds on entitled module", () => {
      const res = assertModuleEntitled(enterpriseTenant, "payrollEpfEtf");
      assert.strictEqual(res.ok, true);
    });
  });
});
