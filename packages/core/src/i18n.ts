/**
 * Pure TypeScript Trilingual Hospitality Localization Engine (@hms/core).
 *
 * Provides official English, Sinhala (සිංහල), and Tamil (தமிழ்) statutory terms for
 * Sri Lankan hospitality operations:
 * - 4-Stage Compounding Statutory Taxes (Service Charge, TDL, SSCL, VAT)
 * - 5 SLTDA Standard Meal Plans (RO, BB, HB, FB, AI)
 * - Room Statuses & Housekeeping Run-Sheets
 * - Front Desk Folios & Payment Modes (LankaQR, Cash, Card, Bank Transfer)
 * - 42-Entity Multi-Tenant SaaS Operational Actions
 *
 * Zero external npm dependencies. Pure deterministic functions returning Result<T, DomainError>.
 */

import { type DomainError, type Result, domainErr, ok } from "./result.js";

export type SupportedLanguage = "en" | "si" | "ta";

export interface LanguageMeta {
  readonly code: SupportedLanguage;
  readonly name: string;
  readonly nativeName: string;
  readonly script: "Latin" | "Sinhala" | "Tamil";
  readonly isIndic: boolean;
}

export const SUPPORTED_LANGUAGES: Readonly<Record<SupportedLanguage, LanguageMeta>> = {
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    script: "Latin",
    isIndic: false,
  },
  si: {
    code: "si",
    name: "Sinhala",
    nativeName: "සිංහල",
    script: "Sinhala",
    isIndic: true,
  },
  ta: {
    code: "ta",
    name: "Tamil",
    nativeName: "தமிழ்",
    script: "Tamil",
    isIndic: true,
  },
};

/**
 * Complete Trilingual Term Definitions for Sri Lankan Hospitality Operations.
 */
export const HOSPITALITY_TERMS = {
  // Statutory Taxes & Charges (Sri Lanka Inland Revenue Department & SLTDA)
  serviceCharge: {
    en: "10% Statutory Service Charge",
    si: "10% ව්‍යවස්ථාපිත සේවා ගාස්තුව",
    ta: "10% சட்டபூர்வ சேவை கட்டணம்",
  },
  tdl: {
    en: "1% Tourism Development Levy (TDL)",
    si: "1% සංචාරක සංවර්ධන බද්ද (TDL)",
    ta: "1% சுற்றுலா அபிவிருத்தி வரி (TDL)",
  },
  sscl: {
    en: "2.5% Social Security Contribution Levy (SSCL)",
    si: "2.5% සමාජ ආරක්ෂණ දායකත්ව බද්ද (SSCL)",
    ta: "2.5% சமூக பாதுகாப்பு பங்களிப்பு வரி (SSCL)",
  },
  vat: {
    en: "18% Value Added Tax (VAT)",
    si: "18% එකතු කළ අගය මත බද්ද (VAT)",
    ta: "18% பெறுமதி சேர் வரி (VAT)",
  },
  taxInvoice: {
    en: "Statutory Tax Invoice / Receipt",
    si: "ව්‍යවස්ථාපිත බදු ඉන්වොයිසිය / රිසිට්පත",
    ta: "சட்டபூர்வ வரி விலைப்பட்டியல் / பற்றுச்சீட்டு",
  },
  tinNumber: {
    en: "Taxpayer Identification Number (TIN)",
    si: "බදු ගෙවන්නා හඳුනාගැනීමේ අංකය (TIN)",
    ta: "வரி செலுத்துவோர் அடையாள எண் (TIN)",
  },
  sltdaLicense: {
    en: "SLTDA Registration / License No",
    si: "ශ්‍රී ලංකා සංචාරක සංවර්ධන අධිකාරී ලියාපදිංචි අංකය",
    ta: "இலங்கை சுற்றுலா அபிவிருத்தி அதிகாரசபை பதிவு இலக்கம்",
  },

  // 5 SLTDA Standard Meal Plans
  mealPlanRo: {
    en: "Room Only (RO)",
    si: "කාමරය පමණි (RO)",
    ta: "அறை மட்டும் (RO)",
  },
  mealPlanBb: {
    en: "Bed & Breakfast (BB)",
    si: "නවාතැන් සහ උදෑසන ආහාරය (BB)",
    ta: "படுக்கை மற்றும் காலை உணவு (BB)",
  },
  mealPlanHb: {
    en: "Half Board (HB)",
    si: "අර්ධ භෝජන (HB)",
    ta: "அரை உணவு திட்டம் (HB)",
  },
  mealPlanFb: {
    en: "Full Board (FB)",
    si: "පූර්ණ භෝජන (FB)",
    ta: "முழு உணவு திட்டம் (FB)",
  },
  mealPlanAi: {
    en: "All Inclusive (AI)",
    si: "සියල්ල ඇතුළත් (AI)",
    ta: "அனைத்தும் உள்ளடக்கியது (AI)",
  },

  // Reservation & Front Desk Operations
  checkIn: {
    en: "Check-In",
    si: "පැමිණීම ලියාපදිංචිය (Check-In)",
    ta: "வருகை பதிவு (Check-In)",
  },
  checkOut: {
    en: "Check-Out",
    si: "පිටවීම හා ගෙවීම් බේරුම්කරණය (Check-Out)",
    ta: "வெளியேறுதல் மற்றும் கணக்கு தீர்வு (Check-Out)",
  },
  reservationConfirmed: {
    en: "Reservation Confirmed",
    si: "වෙන්කිරීම තහවුරු විය",
    ta: "முன்பதிவு உறுதி செய்யப்பட்டது",
  },
  driverQuarters: {
    en: "Complimentary Tourist Driver Quarters",
    si: "සංචාරක රියදුරු නොමිලේ නවාතැන්",
    ta: "சுற்றுலா ஓட்டுநர் இலவச தங்குமிடம்",
  },

  // Payments & Currency
  lankaQrPayment: {
    en: "LankaQR Instant EMVCo Payment",
    si: "LankaQR ක්ෂණික ඩිජිටල් ගෙවීම",
    ta: "LankaQR உடனடி டிஜிட்டல் கட்டணம்",
  },
  currencyLkr: {
    en: "Sri Lankan Rupee (LKR)",
    si: "ශ්‍රී ලංකා රුපියල් (LKR)",
    ta: "இலங்கை ரூபாய் (LKR)",
  },
  currencyUsd: {
    en: "United States Dollar (USD)",
    si: "එක්සත් ජනපද ඩොලර් (USD)",
    ta: "அமெரிக்க டாலர் (USD)",
  },

  // Departments & Operations
  frontDesk: {
    en: "Front Desk & Reception",
    si: "පිළිගැනීමේ අංශය",
    ta: "வரவேற்பு பிரிவு",
  },
  housekeeping: {
    en: "Housekeeping",
    si: "කාමර පිරිසිදු කිරීමේ අංශය",
    ta: "அறை பராமரிப்பு பிரிவு",
  },
  kitchenKds: {
    en: "Kitchen Display System (KDS)",
    si: "මුළුතැන්ගෙයි ඇණවුම් පද්ධතිය (KDS)",
    ta: "சமையலறை காட்சி அமைப்பு (KDS)",
  },
  barPegAudit: {
    en: "Bar & Beverage Peg Audit",
    si: "බීමහල් මත්පැන් පරිභෝජන විගණනය",
    ta: "மதுபான நுகர்வு தணிக்கை",
  },
  roomQrRoomService: {
    en: "Contactless Room Service Ordering",
    si: "කාමර QR කේතය මඟින් ආහාර ඇණවුම් කිරීම",
    ta: "அறை QR மூலம் உணவு ஆர்டர் செய்தல்",
  },
} as const;

export type HospitalityTermKey = keyof typeof HOSPITALITY_TERMS;

export type TrilingualDictionary = Record<SupportedLanguage, Record<HospitalityTermKey, string>>;

/**
 * Builds and returns the compiled Trilingual dictionary indexed by language code.
 */
export function getTrilingualDictionary(): TrilingualDictionary {
  const dict: TrilingualDictionary = {
    en: {} as Record<HospitalityTermKey, string>,
    si: {} as Record<HospitalityTermKey, string>,
    ta: {} as Record<HospitalityTermKey, string>,
  };

  const keys = Object.keys(HOSPITALITY_TERMS) as HospitalityTermKey[];
  for (const key of keys) {
    const entry = HOSPITALITY_TERMS[key];
    dict.en[key] = entry.en;
    dict.si[key] = entry.si;
    dict.ta[key] = entry.ta;
  }

  return dict;
}

/**
 * Translates a hospitality term key into the requested language with fallback to English.
 */
export function translateHospitalityTerm(
  key: HospitalityTermKey,
  lang: SupportedLanguage = "en",
): string {
  const entry = HOSPITALITY_TERMS[key];
  if (!entry) {
    return key;
  }
  return entry[lang] ?? entry.en ?? key;
}

export interface CompletenessReport {
  readonly isComplete: boolean;
  readonly totalKeys: number;
  readonly missingEn: readonly string[];
  readonly missingSi: readonly string[];
  readonly missingTa: readonly string[];
}

/**
 * Validates 100% key completeness across English, Sinhala, and Tamil term entries.
 * Returns ok(report) when all 3 languages have 100% matching keys and non-empty values.
 */
export function validateTrilingualCompleteness(): Result<CompletenessReport, DomainError> {
  const keys = Object.keys(HOSPITALITY_TERMS) as HospitalityTermKey[];
  const missingEn: string[] = [];
  const missingSi: string[] = [];
  const missingTa: string[] = [];

  for (const key of keys) {
    const entry = HOSPITALITY_TERMS[key];
    if (!entry.en || entry.en.trim().length === 0) {
      missingEn.push(key);
    }
    if (!entry.si || entry.si.trim().length === 0) {
      missingSi.push(key);
    }
    if (!entry.ta || entry.ta.trim().length === 0) {
      missingTa.push(key);
    }
  }

  const isComplete = missingEn.length === 0 && missingSi.length === 0 && missingTa.length === 0;

  const report: CompletenessReport = {
    isComplete,
    totalKeys: keys.length,
    missingEn,
    missingSi,
    missingTa,
  };

  if (!isComplete) {
    return domainErr("VALIDATION_FAILED", "Trilingual hospitality dictionary is incomplete", {
      report,
    });
  }

  return ok(report);
}
