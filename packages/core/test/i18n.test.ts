import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOSPITALITY_TERMS,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  getTrilingualDictionary,
  translateHospitalityTerm,
  validateTrilingualCompleteness,
} from "../src/i18n.js";

describe("Step 484 (Phase 20.09): Trilingual Key Completeness in i18n.ts (English / සිංහල / தமிழ்)", () => {
  describe("1. Supported Languages Metadata", () => {
    it("defines English, Sinhala, and Tamil metadata with native scripts", () => {
      const languages: SupportedLanguage[] = ["en", "si", "ta"];
      for (const lang of languages) {
        const meta = SUPPORTED_LANGUAGES[lang];
        assert.ok(meta, `Missing metadata for ${lang}`);
        assert.strictEqual(meta.code, lang);
        assert.ok(meta.name.length > 0);
        assert.ok(meta.nativeName.length > 0);
      }
      assert.strictEqual(SUPPORTED_LANGUAGES.si.nativeName, "සිංහල");
      assert.strictEqual(SUPPORTED_LANGUAGES.ta.nativeName, "தமிழ்");
      assert.strictEqual(SUPPORTED_LANGUAGES.si.isIndic, true);
      assert.strictEqual(SUPPORTED_LANGUAGES.ta.isIndic, true);
      assert.strictEqual(SUPPORTED_LANGUAGES.en.isIndic, false);
    });
  });

  describe("2. Rung 5: 100% Trilingual Key Parity & Completeness", () => {
    it("asserts Object.keys(dict.en) matches Object.keys(dict.si) and Object.keys(dict.ta) 100%", () => {
      const dict = getTrilingualDictionary();
      const enKeys = Object.keys(dict.en).sort();
      const siKeys = Object.keys(dict.si).sort();
      const taKeys = Object.keys(dict.ta).sort();

      assert.ok(enKeys.length > 0, "Dictionary must contain keys");
      assert.deepStrictEqual(
        siKeys,
        enKeys,
        "Sinhala keys must match English keys 100% with zero omissions",
      );
      assert.deepStrictEqual(
        taKeys,
        enKeys,
        "Tamil keys must match English keys 100% with zero omissions",
      );
    });

    it("confirms validateTrilingualCompleteness returns ok with zero missing keys", () => {
      const res = validateTrilingualCompleteness();
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.strictEqual(res.value.isComplete, true);
        assert.strictEqual(res.value.missingEn.length, 0);
        assert.strictEqual(res.value.missingSi.length, 0);
        assert.strictEqual(res.value.missingTa.length, 0);
        assert.ok(res.value.totalKeys >= 15);
      }
    });

    it("guarantees every single term has non-empty and trimmed strings across all languages", () => {
      for (const [key, term] of Object.entries(HOSPITALITY_TERMS)) {
        assert.ok(term.en.trim().length > 0, `English term for ${key} must not be empty`);
        assert.ok(term.si.trim().length > 0, `Sinhala term for ${key} must not be empty`);
        assert.ok(term.ta.trim().length > 0, `Tamil term for ${key} must not be empty`);
      }
    });
  });

  describe("3. Sri Lankan Statutory Tax & Hospitality Translations", () => {
    it("translates 4-stage compounding taxes accurately into Sinhala and Tamil", () => {
      assert.strictEqual(translateHospitalityTerm("serviceCharge", "si"), "10% ව්‍යවස්ථාපිත සේවා ගාස්තුව");
      assert.strictEqual(translateHospitalityTerm("serviceCharge", "ta"), "10% சட்டபூர்வ சேவை கட்டணம்");
      assert.strictEqual(translateHospitalityTerm("vat", "si"), "18% එකතු කළ අගය මත බද්ද (VAT)");
      assert.strictEqual(translateHospitalityTerm("vat", "ta"), "18% பெறுமதி சேர் வரி (VAT)");
    });

    it("translates 5 SLTDA meal plans correctly", () => {
      assert.strictEqual(translateHospitalityTerm("mealPlanRo", "si"), "කාමරය පමණි (RO)");
      assert.strictEqual(translateHospitalityTerm("mealPlanBb", "si"), "නවාතැන් සහ උදෑසන ආහාරය (BB)");
      assert.strictEqual(translateHospitalityTerm("mealPlanAi", "ta"), "அனைத்தும் உள்ளடக்கியது (AI)");
    });

    it("falls back to English when language is not provided or key exists in English", () => {
      assert.strictEqual(
        translateHospitalityTerm("lankaQrPayment"),
        "LankaQR Instant EMVCo Payment",
      );
      assert.strictEqual(
        translateHospitalityTerm("lankaQrPayment", "en"),
        "LankaQR Instant EMVCo Payment",
      );
    });
  });
});
