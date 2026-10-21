import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

describe("Step 458 (Phase 19.08): Tenant Room Count Quota Enforcement Resolver (enforceRoomCountQuota.js)", () => {
  const bundlePath = resolve(process.cwd(), "../graphql/dist/resolvers/enforceRoomCountQuota.js");
  const bundleCode = readFileSync(bundlePath, "utf8");

  describe("1. Bundled AppSync JS Code Verification (enforceRoomCountQuota.js)", () => {
    it("verifies bundled resolver artifact exists in dist and contains required functions", () => {
      assert.ok(bundleCode.length > 300);
      assert.ok(bundleCode.includes("enforceRoomCountQuotaRequest"));
      assert.ok(bundleCode.includes("enforceRoomCountQuotaResponse"));
      assert.ok(bundleCode.includes("evaluateRoomQuota"));
      assert.ok(bundleCode.includes("PLAN_ROOM_LIMITS"));
    });

    it("verifies QUOTA_EXCEEDED error code and AppSync error handling are baked in", () => {
      assert.ok(bundleCode.includes("QUOTA_EXCEEDED"));
      assert.ok(bundleCode.includes("Room quota exceeded for plan"));
      assert.ok(bundleCode.includes("Upgrade to GROWTH_PMS_PLUS_QR or ENTERPRISE_RESORT_ERP"));
      assert.ok(bundleCode.includes("tenantGuard"));
    });
  });

  describe("2. Plan Quota Boundaries & Rung 2 Rules", () => {
    it("configures plan room limits: STARTER_QR_ONLY (15), GROWTH (40), ENTERPRISE (10000)", async () => {
      const mod = await import(pathToFileURL(bundlePath).href);
      assert.strictEqual(mod.PLAN_ROOM_LIMITS.STARTER_QR_ONLY, 15);
      assert.strictEqual(mod.PLAN_ROOM_LIMITS.GROWTH_PMS_PLUS_QR, 40);
      assert.strictEqual(mod.PLAN_ROOM_LIMITS.ENTERPRISE_RESORT_ERP, 10000);
      assert.strictEqual(mod.DEFAULT_PLAN_TIER, "STARTER_QR_ONLY");
    });

    it("Rung 2: Prevents adding room #16 to hotel tenant enrolled in STARTER_QR_ONLY", async () => {
      const mod = await import(pathToFileURL(bundlePath).href);
      // 15 existing rooms on starter plan -> adding room 16 is blocked
      const result = mod.evaluateRoomQuota("STARTER_QR_ONLY", 15);
      assert.strictEqual(result.isAllowed, false);
      assert.strictEqual(result.currentRoomCount, 15);
      assert.strictEqual(result.roomLimit, 15);
      assert.strictEqual(
        result.errorMessage,
        "Room quota exceeded for plan STARTER_QR_ONLY. Maximum allowed is 15 rooms. Upgrade to GROWTH_PMS_PLUS_QR or ENTERPRISE_RESORT_ERP.",
      );
    });

    it("permits adding rooms below the quota limit on STARTER_QR_ONLY", async () => {
      const mod = await import(pathToFileURL(bundlePath).href);
      // 14 existing rooms on starter plan -> adding room 15 is allowed
      const result = mod.evaluateRoomQuota("STARTER_QR_ONLY", 14);
      assert.strictEqual(result.isAllowed, true);
      assert.strictEqual(result.currentRoomCount, 14);
      assert.strictEqual(result.roomLimit, 15);
      assert.strictEqual(result.errorMessage, undefined);
    });

    it("enforces GROWTH_PMS_PLUS_QR 40-room ceiling", async () => {
      const mod = await import(pathToFileURL(bundlePath).href);
      // 39 existing rooms -> allowed
      assert.strictEqual(mod.evaluateRoomQuota("GROWTH_PMS_PLUS_QR", 39).isAllowed, true);

      // 40 existing rooms -> blocked
      const blocked = mod.evaluateRoomQuota("GROWTH_PMS_PLUS_QR", 40);
      assert.strictEqual(blocked.isAllowed, false);
      assert.strictEqual(blocked.roomLimit, 40);
      assert.ok(blocked.errorMessage?.includes("Maximum allowed is 40 rooms"));
    });

    it("permits large-scale room inventory on ENTERPRISE_RESORT_ERP", async () => {
      const mod = await import(pathToFileURL(bundlePath).href);
      assert.strictEqual(mod.evaluateRoomQuota("ENTERPRISE_RESORT_ERP", 15).isAllowed, true);
      assert.strictEqual(mod.evaluateRoomQuota("ENTERPRISE_RESORT_ERP", 45).isAllowed, true);
      assert.strictEqual(mod.evaluateRoomQuota("ENTERPRISE_RESORT_ERP", 250).isAllowed, true);
      assert.strictEqual(mod.evaluateRoomQuota("ENTERPRISE_RESORT_ERP", 500).isAllowed, true);
    });

    it("honors custom administrative room limit overrides", async () => {
      const mod = await import(pathToFileURL(bundlePath).href);
      // Starter plan with negotiated custom limit of 20 rooms
      const customEvaluation = mod.evaluateRoomQuota("STARTER_QR_ONLY", 15, 20);
      assert.strictEqual(customEvaluation.isAllowed, true);
      assert.strictEqual(customEvaluation.roomLimit, 20);

      // Exceeding custom limit of 20
      const exceededCustom = mod.evaluateRoomQuota("STARTER_QR_ONLY", 20, 20);
      assert.strictEqual(exceededCustom.isAllowed, false);
      assert.strictEqual(exceededCustom.roomLimit, 20);
    });
  });
});
