import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENESIS_HASH } from "../src/auditChain.js";
import {
  AYURVEDA_WELLNESS_PRESET,
  DEFAULT_CATALOG_CATEGORIES_PRESET,
  HOUSEKEEPING_AMENITIES_PRESET,
  POOL_BAR_PRESET,
  type PresetAmenityItem,
  type PresetCategory,
  SRI_LANKAN_BREAKFAST_PRESET,
  filterPresetsByDepartment,
  generateTenantCatalogSeed,
  getAllCatalogPresets,
  getHousekeepingAmenitiesPreset,
} from "../src/catalogPresets.js";

describe("Step 237: Trilingual Catalog Presets & Express Room Amenities (catalogPresets.ts)", () => {
  describe("1. Housekeeping Express Amenities Preset (15 Authentic Items)", () => {
    it("contains exactly 15 pre-seeded express housekeeping amenities", () => {
      const items = getHousekeepingAmenitiesPreset();
      assert.strictEqual(items.length, 15);
      assert.strictEqual(HOUSEKEEPING_AMENITIES_PRESET.length, 15);
    });

    it("ensures all 15 housekeeping amenities are strictly complimentary (0 LKR)", () => {
      for (const item of HOUSEKEEPING_AMENITIES_PRESET) {
        assert.strictEqual(item.isComplimentary, true, `${item.code} must be complimentary`);
        assert.strictEqual(item.priceLkr, 0, `${item.code} price must be 0 LKR`);
      }
    });

    it("verifies trilingual integrity (EN, SI, TA) across all 15 housekeeping items", () => {
      // Regular expressions for Sinhala (0x0D80-0x0DFF) and Tamil (0x0B80-0x0BFF) Unicode blocks
      const sinhalaRegex = /[\u0D80-\u0DFF]/;
      const tamilRegex = /[\u0B80-\u0BFF]/;

      for (const item of HOUSEKEEPING_AMENITIES_PRESET) {
        // English
        assert.ok(item.title.en.trim().length > 0, `${item.code} English title is missing`);
        assert.ok(
          item.description.en.trim().length > 0,
          `${item.code} English description is missing`,
        );

        // Sinhala
        assert.ok(
          sinhalaRegex.test(item.title.si),
          `${item.code} title.si must contain Sinhala Unicode characters`,
        );
        assert.ok(
          sinhalaRegex.test(item.description.si),
          `${item.code} description.si must contain Sinhala Unicode characters`,
        );

        // Tamil
        assert.ok(
          tamilRegex.test(item.title.ta),
          `${item.code} title.ta must contain Tamil Unicode characters`,
        );
        assert.ok(
          tamilRegex.test(item.description.ta),
          `${item.code} description.ta must contain Tamil Unicode characters`,
        );
      }
    });

    it("enforces realistic Sri Lankan hotel delivery SLAs (between 10 and 30 minutes)", () => {
      for (const item of HOUSEKEEPING_AMENITIES_PRESET) {
        assert.ok(
          item.deliverySlaMinutes >= 10,
          `${item.code} SLA too low: ${item.deliverySlaMinutes}`,
        );
        assert.ok(
          item.deliverySlaMinutes <= 30,
          `${item.code} SLA too high: ${item.deliverySlaMinutes}`,
        );
      }
    });

    it("accurately classifies equipment requiring return vs consumable room amenities", () => {
      const returnRequiredCodes = [
        "HK-MOSQ-01", // Mosquito vaporizer
        "HK-ADAPT-01", // UK adapter
        "HK-IRON-01", // Steam iron & board
        "HK-PRAY-01", // Prayer mat
        "HK-CRIB-01", // Baby crib
        "HK-DRYER-01", // Hair dryer
        "HK-UMB-01", // Umbrella
      ];

      for (const code of returnRequiredCodes) {
        const found = HOUSEKEEPING_AMENITIES_PRESET.find(
          (it: PresetAmenityItem) => it.code === code,
        );
        assert.ok(found, `Expected to find ${code}`);
        assert.strictEqual(found.requiresReturn, true, `${code} must require return`);
      }

      const consumableCodes = [
        "HK-TOWEL-01",
        "HK-WATER-01",
        "HK-DENT-01",
        "HK-SHAVE-01",
        "HK-SLIP-01",
      ];

      for (const code of consumableCodes) {
        const found = HOUSEKEEPING_AMENITIES_PRESET.find(
          (it: PresetAmenityItem) => it.code === code,
        );
        assert.ok(found, `Expected to find ${code}`);
        assert.strictEqual(found.requiresReturn, false, `${code} should not require return`);
      }
    });

    it("routes front desk items (adapters, umbrellas) and housekeeping items correctly", () => {
      const adapter = HOUSEKEEPING_AMENITIES_PRESET.find((it) => it.code === "HK-ADAPT-01");
      const umbrella = HOUSEKEEPING_AMENITIES_PRESET.find((it) => it.code === "HK-UMB-01");
      assert.strictEqual(adapter?.department, "FRONT_DESK");
      assert.strictEqual(umbrella?.department, "FRONT_DESK");

      const towel = HOUSEKEEPING_AMENITIES_PRESET.find((it) => it.code === "HK-TOWEL-01");
      assert.strictEqual(towel?.department, "HOUSEKEEPING");
    });
  });

  describe("2. Dining, Pool Bar & Ayurveda Presets Integrity", () => {
    it("provides authentic Sri Lankan breakfast specialties", () => {
      assert.strictEqual(SRI_LANKAN_BREAKFAST_PRESET.length, 3);
      const codes = SRI_LANKAN_BREAKFAST_PRESET.map((i: PresetAmenityItem) => i.code);
      assert.ok(codes.includes("BF-HOPP-01"));
      assert.ok(codes.includes("BF-STRH-01"));
      assert.ok(codes.includes("BF-TEA-01"));

      const hoppers = SRI_LANKAN_BREAKFAST_PRESET.find((i) => i.code === "BF-HOPP-01");
      assert.strictEqual(hoppers?.department, "ROOM_SERVICE");
      assert.strictEqual(hoppers?.priceLkr, 1450.0);
      assert.strictEqual(hoppers?.isComplimentary, false);
    });

    it("provides Ceylon pool bar cocktails and king coconut", () => {
      assert.strictEqual(POOL_BAR_PRESET.length, 3);
      const codes = POOL_BAR_PRESET.map((i: PresetAmenityItem) => i.code);
      assert.ok(codes.includes("BAR-THAM-01"));
      assert.ok(codes.includes("BAR-LION-01"));
      assert.ok(codes.includes("BAR-ARCK-01"));

      const thambili = POOL_BAR_PRESET.find((i) => i.code === "BAR-THAM-01");
      assert.strictEqual(thambili?.department, "BAR");
      assert.strictEqual(thambili?.priceLkr, 450.0);
    });

    it("provides authentic Ayurveda wellness spa treatments", () => {
      assert.strictEqual(AYURVEDA_WELLNESS_PRESET.length, 2);
      const codes = AYURVEDA_WELLNESS_PRESET.map((i: PresetAmenityItem) => i.code);
      assert.ok(codes.includes("SPA-ABHY-01"));
      assert.ok(codes.includes("SPA-SHIR-01"));

      const abhyanga = AYURVEDA_WELLNESS_PRESET.find((i) => i.code === "SPA-ABHY-01");
      assert.strictEqual(abhyanga?.department, "SPA");
      assert.strictEqual(abhyanga?.priceLkr, 9500.0);
    });
  });

  describe("3. Department Filtering & Registry Helpers", () => {
    it("getAllCatalogPresets returns all 4 standard categories", () => {
      const presets = getAllCatalogPresets();
      assert.strictEqual(presets.length, 4);
      assert.strictEqual(DEFAULT_CATALOG_CATEGORIES_PRESET.length, 4);
      const depts = presets.map((p: PresetCategory) => p.department);
      assert.ok(depts.includes("HOUSEKEEPING"));
      assert.ok(depts.includes("ROOM_SERVICE"));
      assert.ok(depts.includes("BAR"));
      assert.ok(depts.includes("SPA"));
    });

    it("filterPresetsByDepartment accurately isolates categories by department", () => {
      const hk = filterPresetsByDepartment("HOUSEKEEPING");
      assert.strictEqual(hk.length, 1);
      assert.strictEqual(hk[0]?.code, "CAT-HK-EXP");

      const bar = filterPresetsByDepartment("BAR");
      assert.strictEqual(bar.length, 1);
      assert.strictEqual(bar[0]?.code, "CAT-BAR-POOL");

      const spa = filterPresetsByDepartment("SPA");
      assert.strictEqual(spa.length, 1);
      assert.strictEqual(spa[0]?.code, "CAT-SPA-WELL");

      const maint = filterPresetsByDepartment("MAINTENANCE");
      assert.strictEqual(maint.length, 0);
    });
  });

  describe("4. Multi-Tenant Seed Generator Engine & Audit Chaining", () => {
    it("rejects invalid or blank tenant IDs", () => {
      const emptyRes = generateTenantCatalogSeed("");
      assert.strictEqual(emptyRes.ok, false);
      assert.strictEqual(emptyRes.error.code, "VALIDATION_FAILED");

      const invalidCharRes = generateTenantCatalogSeed("Grand-Kandy-Resort!#");
      assert.strictEqual(invalidCharRes.ok, false);
      assert.strictEqual(invalidCharRes.error.code, "VALIDATION_FAILED");
    });

    it("generates isolated catalog categories and items with valid tenant-specific keys", () => {
      const tenant = "jetwing-lighthouse";
      const result = generateTenantCatalogSeed(tenant, {
        userId: "admin-seed-usr-01",
        timestampIso: "2026-10-19T10:00:00.000Z",
      });

      assert.strictEqual(result.ok, true);
      const seed = result.value;
      assert.strictEqual(seed.tenantId, tenant);
      assert.strictEqual(seed.totalCategories, 4);
      assert.strictEqual(seed.totalItems, 23); // 15 HK + 3 BF + 3 Bar + 2 Spa = 23
      assert.strictEqual(seed.totalComplimentaryItems, 15);

      // Verify category IDs match pattern cat_<tenant>_<categoryCode>
      for (const cat of seed.categories) {
        assert.strictEqual(cat.tenantId, tenant);
        assert.ok(
          cat.id.startsWith(`cat_${tenant}_`),
          `Expected cat.id to start with cat_${tenant}_`,
        );
      }

      // Verify item IDs match pattern itm_<tenant>_<itemCode>
      for (const itm of seed.items) {
        assert.strictEqual(itm.tenantId, tenant);
        assert.ok(
          itm.id.startsWith(`itm_${tenant}_`),
          `Expected itm.id to start with itm_${tenant}_`,
        );
        assert.ok(itm.categoryId.startsWith(`cat_${tenant}_`));
      }
    });

    it("filters catalog seed generation when specific departments are requested", () => {
      const tenant = "amaya-langdale";
      const hkOnlyResult = generateTenantCatalogSeed(tenant, {
        departments: ["HOUSEKEEPING"],
      });

      assert.strictEqual(hkOnlyResult.ok, true);
      const seed = hkOnlyResult.value;
      assert.strictEqual(seed.totalCategories, 1);
      assert.strictEqual(seed.categories[0]?.code, "CAT-HK-EXP");
      assert.strictEqual(seed.totalItems, 15);
      assert.strictEqual(seed.totalComplimentaryItems, 15);
    });

    it("generates valid SHA-256 hash-chained ImmutableAuditLog with prevHash and entryHash", () => {
      const tenant = "heritance-kandalama";
      const customPrevHash = GENESIS_HASH;
      const seedResult = generateTenantCatalogSeed(tenant, {
        userId: "gm-kandalama",
        previousHash: customPrevHash,
        timestampIso: "2026-10-19T12:30:00.000Z",
      });

      assert.strictEqual(seedResult.ok, true);
      const audit = seedResult.value.auditLog;
      assert.strictEqual(audit.tenantId, tenant);
      assert.strictEqual(audit.actorUserId, "gm-kandalama");
      assert.strictEqual(audit.action, "SEED_CATALOG_PRESET");
      assert.strictEqual(audit.entityType, "CATALOG");
      assert.strictEqual(audit.prevHash, customPrevHash);
      assert.strictEqual(audit.entryHash.length, 64);
      assert.match(audit.entryHash, /^[0-9a-f]{64}$/);
    });
  });
});
