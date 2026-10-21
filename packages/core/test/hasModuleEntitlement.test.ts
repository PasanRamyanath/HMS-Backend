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
} from "../src/tenant/hasModuleEntitlement.js";

describe("Step 457 (Phase 19.07): Module Entitlement Guard (hasModuleEntitlement.ts)", () => {
  const starterTenant: TenantSubscriptionState = {
    tenantId: "tenant-beach-cafe",
    planTier: "STARTER_QR_ONLY",
    status: "ACTIVE",
    currentRoomCount: 8,
  };

  const growthTenant: TenantSubscriptionState = {
    tenantId: "tenant-galle-villa",
    planTier: "GROWTH_PMS_PLUS_QR",
    status: "ACTIVE",
    currentRoomCount: 24,
  };

  const enterpriseTenant: TenantSubscriptionState = {
    tenantId: "tenant-kingsbury-resort",
    planTier: "ENTERPRISE_RESORT_ERP",
    status: "ACTIVE",
    currentRoomCount: 120,
  };

  describe("1. Subscription Status Checks", () => {
    it("rejects module access when tenant subscription is SUSPENDED", () => {
      const suspendedTenant: TenantSubscriptionState = {
        ...starterTenant,
        status: "SUSPENDED",
      };

      const res = hasModuleEntitlement(suspendedTenant, "qrMenuAndOrdering");
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "SUBSCRIPTION_INACTIVE");
        assert.ok(res.error.message.includes("SUSPENDED"));
      }
    });

    it("rejects module access when tenant subscription is EXPIRED or CANCELLED", () => {
      const expiredTenant: TenantSubscriptionState = {
        ...growthTenant,
        status: "EXPIRED",
      };

      const res = hasModuleEntitlement(expiredTenant, "frontDeskPms");
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "SUBSCRIPTION_INACTIVE");
      }
    });
  });

  describe("2. Tier Included Module Defaults", () => {
    it("STARTER_QR_ONLY permits QR ordering, KDS, and LankaQR", () => {
      assert.strictEqual(hasModuleEntitlement(starterTenant, "qrMenuAndOrdering").ok, true);
      assert.strictEqual(hasModuleEntitlement(starterTenant, "kdsKitchen").ok, true);
      assert.strictEqual(hasModuleEntitlement(starterTenant, "lankaQrPay").ok, true);
    });

    it("STARTER_QR_ONLY rejects front-desk, tape chart, banquets, and payroll", () => {
      const pmsRes = hasModuleEntitlement(starterTenant, "frontDeskPms");
      assert.strictEqual(pmsRes.ok, false);
      if (!pmsRes.ok) {
        assert.strictEqual(pmsRes.error.code, "ENTITLEMENT_MODULE_DISABLED");
      }

      const banquetRes = hasModuleEntitlement(starterTenant, "banquets");
      assert.strictEqual(banquetRes.ok, false);
      if (!banquetRes.ok) {
        assert.strictEqual(banquetRes.error.code, "ENTITLEMENT_MODULE_DISABLED");
      }

      const payrollRes = hasModuleEntitlement(starterTenant, "payrollEpfEtf");
      assert.strictEqual(payrollRes.ok, false);
      if (!payrollRes.ok) {
        assert.strictEqual(payrollRes.error.code, "ENTITLEMENT_MODULE_DISABLED");
      }
    });

    it("GROWTH_PMS_PLUS_QR permits PMS, tape chart, housekeeping, and statutory tax", () => {
      assert.strictEqual(hasModuleEntitlement(growthTenant, "frontDeskPms").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "tapeChart").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "housekeeping").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "taxSltdaIrd").ok, true);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "auditLogSha256").ok, true);
    });

    it("GROWTH_PMS_PLUS_QR rejects banquets, spa, and payroll", () => {
      assert.strictEqual(hasModuleEntitlement(growthTenant, "banquets").ok, false);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "payrollEpfEtf").ok, false);
      assert.strictEqual(hasModuleEntitlement(growthTenant, "multiProperty").ok, false);
    });

    it("ENTERPRISE_RESORT_ERP permits all 13 hospitality ERP modules", () => {
      const allModules: ReadonlyArray<ModuleEntitlementKey> = [
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
        const res = hasModuleEntitlement(enterpriseTenant, mod);
        assert.strictEqual(res.ok, true, `Expected module ${mod} to be entitled on enterprise`);
      }
    });
  });

  describe("3. Add-Ons & Custom Administrative Overrides", () => {
    it("permits module access when listed in activeAddOns", () => {
      const starterWithBanquets: TenantSubscriptionState = {
        ...starterTenant,
        activeAddOns: ["banquets", "storesAndInventory"],
      };

      assert.strictEqual(hasModuleEntitlement(starterWithBanquets, "banquets").ok, true);
      assert.strictEqual(hasModuleEntitlement(starterWithBanquets, "storesAndInventory").ok, true);
      assert.strictEqual(hasModuleEntitlement(starterWithBanquets, "payrollEpfEtf").ok, false);
    });

    it("respects custom administrative override enabling an unentitled module", () => {
      const starterWithOverride: TenantSubscriptionState = {
        ...starterTenant,
        customOverrides: {
          payrollEpfEtf: true,
        },
      };

      const res = hasModuleEntitlement(starterWithOverride, "payrollEpfEtf");
      assert.strictEqual(res.ok, true);
    });

    it("respects custom administrative override disabling an included module", () => {
      const enterpriseWithDisabledBanquets: TenantSubscriptionState = {
        ...enterpriseTenant,
        customOverrides: {
          banquets: false,
        },
      };

      const res = hasModuleEntitlement(enterpriseWithDisabledBanquets, "banquets");
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "ENTITLEMENT_MODULE_DISABLED");
        assert.ok(res.error.message.includes("explicitly disabled by administrative override"));
      }
    });
  });

  describe("4. Active Engineering Principle: canCreateReservation Guard", () => {
    it("Rung 2: Rejects room reservation creation when tenant plan is STARTER_QR_ONLY", () => {
      const res = canCreateReservation(starterTenant);
      assert.strictEqual(res.ok, false);
      if (!res.ok) {
        assert.strictEqual(res.error.code, "ENTITLEMENT_MODULE_DISABLED");
        assert.ok(res.error.message.includes("not entitled to module 'frontDeskPms'"));
      }
    });

    it("Permits room reservation creation on GROWTH and ENTERPRISE tiers", () => {
      assert.strictEqual(canCreateReservation(growthTenant).ok, true);
      assert.strictEqual(canCreateReservation(enterpriseTenant).ok, true);
    });

    it("Permits room reservation on STARTER_QR_ONLY if frontDeskPms is an active add-on", () => {
      const starterWithPms: TenantSubscriptionState = {
        ...starterTenant,
        activeAddOns: ["frontDeskPms"],
      };

      assert.strictEqual(canCreateReservation(starterWithPms).ok, true);
    });
  });

  describe("5. Banquet and Payroll Mutation Guards", () => {
    it("canCreateBanquetBooking permits enterprise and rejects starter without add-on", () => {
      assert.strictEqual(canCreateBanquetBooking(starterTenant).ok, false);
      assert.strictEqual(canCreateBanquetBooking(growthTenant).ok, false);
      assert.strictEqual(canCreateBanquetBooking(enterpriseTenant).ok, true);
    });

    it("canRunPayroll permits enterprise and rejects starter/growth", () => {
      assert.strictEqual(canRunPayroll(starterTenant).ok, false);
      assert.strictEqual(canRunPayroll(growthTenant).ok, false);
      assert.strictEqual(canRunPayroll(enterpriseTenant).ok, true);
    });

    it("assertModuleEntitled returns true on success and structured error on failure", () => {
      assert.strictEqual(assertModuleEntitled(growthTenant, "housekeeping").ok, true);
      const fail = assertModuleEntitled(starterTenant, "housekeeping");
      assert.strictEqual(fail.ok, false);
      if (!fail.ok) {
        assert.strictEqual(fail.error.code, "ENTITLEMENT_MODULE_DISABLED");
      }
    });
  });

  describe("6. Plan Room Count Quota Validation", () => {
    it("validates room count against tier limits", () => {
      // Starter limit 15 rooms
      assert.strictEqual(validateRoomCountQuota(starterTenant, 12).ok, true);
      assert.strictEqual(validateRoomCountQuota(starterTenant, 15).ok, true);

      const failStarter = validateRoomCountQuota(starterTenant, 16);
      assert.strictEqual(failStarter.ok, false);
      if (!failStarter.ok) {
        assert.strictEqual(failStarter.error.code, "PLAN_LIMITATION");
      }

      // Growth limit 40 rooms
      assert.strictEqual(validateRoomCountQuota(growthTenant, 35).ok, true);
      assert.strictEqual(validateRoomCountQuota(growthTenant, 45).ok, false);

      // Enterprise unlimited (up to 10,000)
      assert.strictEqual(validateRoomCountQuota(enterpriseTenant, 250).ok, true);
    });
  });
});
