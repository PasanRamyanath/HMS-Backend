/**
 * @hms/core - Free Housekeeping & Express Room Amenity Catalog Presets.
 *
 * Implements Step 236 (Phase 10.11) of the Sri Lanka HMS Architecture Plan:
 * Pre-seeds 15 authentic Sri Lankan hotel housekeeping and express room service
 * amenities plus food, beverage, and spa presets with:
 * 1. Trilingual names and descriptions in English (en), Sinhala (si), and Tamil (ta).
 * 2. Zero-cost complimentary flags and delivery SLAs in minutes.
 * 3. Automatic departmental dispatch routing (HOUSEKEEPING, FRONT_DESK, BAR, ROOM_SERVICE, SPA).
 * 4. Multi-tenant catalog seed generation with SHA-256 hash-chained ImmutableAuditLog.
 * 5. Pure TypeScript with zero external NPM runtime dependencies.
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type DepartmentCode =
  | "HOUSEKEEPING"
  | "FRONT_DESK"
  | "ROOM_SERVICE"
  | "BAR"
  | "SPA"
  | "MAINTENANCE";

export interface TrilingualPresetText {
  readonly en: string;
  readonly si: string;
  readonly ta: string;
}

export interface PresetAmenityItem {
  readonly code: string;
  readonly title: TrilingualPresetText;
  readonly description: TrilingualPresetText;
  readonly categoryCode: string;
  readonly department: DepartmentCode;
  readonly isComplimentary: boolean;
  readonly priceLkr: number;
  readonly deliverySlaMinutes: number;
  readonly maxQuantityPerOrder: number;
  readonly requiresReturn: boolean;
  readonly inventorySkuRef?: string | undefined;
}

export interface PresetCategory {
  readonly code: string;
  readonly name: TrilingualPresetText;
  readonly department: DepartmentCode;
  readonly iconEmoji: string;
  readonly displayOrder: number;
  readonly items: ReadonlyArray<PresetAmenityItem>;
}

export interface SeededCatalogItem {
  readonly id: string;
  readonly tenantId: string;
  readonly categoryId: string;
  readonly code: string;
  readonly title: TrilingualPresetText;
  readonly description: TrilingualPresetText;
  readonly department: DepartmentCode;
  readonly priceLkr: number;
  readonly isComplimentary: boolean;
  readonly deliverySlaMinutes: number;
  readonly maxQuantityPerOrder: number;
  readonly requiresReturn: boolean;
  readonly isActive: boolean;
  readonly displayOrder: number;
}

export interface SeededCatalogCategory {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: TrilingualPresetText;
  readonly department: DepartmentCode;
  readonly iconEmoji: string;
  readonly displayOrder: number;
  readonly isActive: boolean;
}

export interface GeneratedCatalogSeed {
  readonly tenantId: string;
  readonly categories: ReadonlyArray<SeededCatalogCategory>;
  readonly items: ReadonlyArray<SeededCatalogItem>;
  readonly totalCategories: number;
  readonly totalItems: number;
  readonly totalComplimentaryItems: number;
  readonly auditLog: AuditLogEntry;
}

export interface CatalogSeedOptions {
  /** Optional filter to seed only specific departments (e.g. only HOUSEKEEPING). */
  readonly departments?: ReadonlyArray<DepartmentCode> | undefined;
  /** Staff user ID executing the seed (default: "system-setup"). */
  readonly userId?: string | undefined;
  /** Previous SHA-256 audit log hash for hash-chain continuity. */
  readonly previousHash?: string | undefined;
  /** Deterministic timestamp ISO string for reproducible seeds / tests. */
  readonly timestampIso?: string | undefined;
}

// ============================================================================
// Curated Housekeeping & Express Room Service Amenities (15 Preset Items)
// ============================================================================

export const HOUSEKEEPING_AMENITIES_PRESET: ReadonlyArray<PresetAmenityItem> = [
  {
    code: "HK-TOWEL-01",
    title: {
      en: "Extra Plush Bath Towel",
      si: "අමතර නාන තුවාය",
      ta: "கூடுதல் குளியல் துண்டு",
    },
    description: {
      en: "Fluffy 700 GSM Ceylon woven cotton bath sheet, sanitized and fresh.",
      si: "පිරිසිදු කළ, උසස් තත්වයේ කපු නාන තුවායක්.",
      ta: "சுத்திகரிக்கப்பட்ட பிரீமியம் பருத்தி குளியல் துண்டு.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 4,
    requiresReturn: false,
    inventorySkuRef: "LIN-TOWEL-001",
  },
  {
    code: "HK-WATER-01",
    title: {
      en: "Bottled Mineral Water 1000ml",
      si: "ඛනිජ ජල බෝතලය 1L",
      ta: "கனிம நீர் பாட்டில் 1L",
    },
    description: {
      en: "Chilled or ambient natural Ceylon spring water sealed in glass.",
      si: "ස්වභාවික ශ්‍රී ලාංකික උල්පත් ජලය (වීදුරු බෝතල් කළ).",
      ta: "இயற்கை இலங்கை ஊற்று நீர்.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 10,
    maxQuantityPerOrder: 6,
    requiresReturn: false,
    inventorySkuRef: "BEV-WATER-001",
  },
  {
    code: "HK-MOSQ-01",
    title: {
      en: "Electric Mosquito Vaporizer & Mats",
      si: "විදුලි මදුරු නාශක යන්ත්‍රය සහ තහඩු",
      ta: "மின்சார கொசு விரட்டி மற்றும் மேட்",
    },
    description: {
      en: "Odorless electric mosquito repellent unit with 3 refills for peaceful sleep.",
      si: "සුවදායක නින්දක් සඳහා සුවඳ රහිත විදුලි මදුරු නාශක යන්ත්‍රය.",
      ta: "அமைதியான தூக்கத்திற்கான மின்சார கொசு விரட்டி இயந்திரம்.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 2,
    requiresReturn: true,
    inventorySkuRef: "EQP-MOSQ-001",
  },
  {
    code: "HK-ADAPT-01",
    title: {
      en: "Universal / UK 3-Pin Travel Plug Adapter",
      si: "යුනිවර්සල් / UK 3-පින් ප්ලග් ඇඩැප්ටරය",
      ta: "சர்வதேச / UK 3-பின் பிளக் அடாப்டர்",
    },
    description: {
      en: "Surge-protected multi-country power adapter fitting Sri Lankan wall sockets.",
      si: "ශ්‍රී ලංකාවේ විදුලි සොකට් සඳහා ගැලපෙන ආරක්ෂිත ඇඩැප්ටරය.",
      ta: "இலங்கை மின் இணைப்புகளுக்கு ஏற்ற பாதுகாப்பு அடாப்டர்.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "FRONT_DESK",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 10,
    maxQuantityPerOrder: 2,
    requiresReturn: true,
    inventorySkuRef: "EQP-ADAPT-001",
  },
  {
    code: "HK-IRON-01",
    title: {
      en: "Steam Iron & Foldable Ironing Board",
      si: "හුමාල ඉස්තිරික්කය සහ නැවිය හැකි ලෑල්ල",
      ta: "நீராவி இஸ்திரி பெட்டி மற்றும் பலகை",
    },
    description: {
      en: "2200W steam iron with non-stick plate and full-size padded ironing board.",
      si: "උසස් තත්වයේ හුමාල ඉස්තිරික්කය සහ පහසු නැවිය හැකි ලෑල්ල.",
      ta: "நீராவி இஸ்திரி பெட்டி மற்றும் மடிக்கக்கூடிய பலகை.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 20,
    maxQuantityPerOrder: 1,
    requiresReturn: true,
    inventorySkuRef: "EQP-IRON-001",
  },
  {
    code: "HK-PRAY-01",
    title: {
      en: "Islamic Prayer Mat & Qibla Compass",
      si: "ඉස්ලාමීය යාඥා පැදුර සහ කිබ්ලා මාලිමාව",
      ta: "இஸ்லாமிய தொழுகை பாய் மற்றும் கிப்லா திசைகாட்டி",
    },
    description: {
      en: "Sanitized velvet prayer mat with verified Colombo Qibla direction chart.",
      si: "පිරිසිදු කරන ලද වෙල්වට් යාඥා පැදුර සහ කිබ්ලා මඟපෙන්වීම.",
      ta: "சுத்திகரிக்கப்பட்ட வெல்வெட் தொழுகை பாய் மற்றும் திசைகாட்டி.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 2,
    requiresReturn: true,
    inventorySkuRef: "LIN-PRAY-001",
  },
  {
    code: "HK-LAUND-01",
    title: {
      en: "Express Laundry & Dry Cleaning Bag",
      si: "ක්ෂණික රෙදි සේදීමේ බෑගය සහ ලැයිස්තුව",
      ta: "சலவை பை மற்றும் படிவம்",
    },
    description: {
      en: "Eco cotton laundry bag with tariff card. Runner collects from room door.",
      si: "රෙදි සේදීම සඳහා කපු බෑගය. සේවකයා කාමරයෙන් එකතු කරගනී.",
      ta: "சலவைக்கான பருத்தி பை. ஊழியர் அறையிலிருந்து பெற்றுக்கொள்வார்.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 25,
    maxQuantityPerOrder: 2,
    requiresReturn: false,
    inventorySkuRef: "LIN-BAG-001",
  },
  {
    code: "HK-PILLOW-01",
    title: {
      en: "Extra Goose Down / Hypoallergenic Pillow",
      si: "අමතර හයිපෝඇලර්ජනික් කොට්ටය",
      ta: "கூடுதல் ஒவ்வாமை எதிர்ப்பு தலையணை",
    },
    description: {
      en: "Choice of firm memory foam or ultra-soft hypoallergenic microfibre pillow.",
      si: "සුවපහසු මෘදු හෝ තද හයිපෝඇලර්ජනික් කොට්ටය.",
      ta: "சுகமான மென்மையான தலையணை.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 4,
    requiresReturn: false,
    inventorySkuRef: "LIN-PILLOW-001",
  },
  {
    code: "HK-DENT-01",
    title: {
      en: "Eco Bamboo Dental Kit & Toothpaste",
      si: "පරිසර හිතකාමී උණ බම්බු දත් බුරුසු කට්ටලය",
      ta: "மூங்கில் பல் துலக்கும் கிட்",
    },
    description: {
      en: "Biodegradable organic bamboo toothbrush with herbal clove toothpaste.",
      si: "ස්වභාවික කරාබුනැටි දන්තාලේප සහිත පරිසර හිතකාමී දත් බුරුසුව.",
      ta: "இயற்கை கிராம்பு பற்பசையுடன் கூடிய மூங்கில் பல் துலக்கி.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 10,
    maxQuantityPerOrder: 4,
    requiresReturn: false,
    inventorySkuRef: "AMN-DENT-001",
  },
  {
    code: "HK-SHAVE-01",
    title: {
      en: "Precision Shaving Kit & Herbal Foam",
      si: "රැවුල කැපීමේ කට්ටලය සහ ආලේපනය",
      ta: "சவரக் கிட் மற்றும் கிரீம்",
    },
    description: {
      en: "Triple-blade safety razor with soothing Ceylon aloe vera shaving balm.",
      si: "කෝමාරිකා සාරය සහිත තල 3 ආරක්ෂිත රැවුල කැපීමේ කට්ටලය.",
      ta: "கற்றாழை சாறுடன் கூடிய மூன்று பிளேடு சவரக் கிட்.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 10,
    maxQuantityPerOrder: 2,
    requiresReturn: false,
    inventorySkuRef: "AMN-SHAVE-001",
  },
  {
    code: "HK-CRIB-01",
    title: {
      en: "Solid Teak Baby Crib / Travel Cot Setup",
      si: "ළදරු ඇඳ සකස් කිරීම",
      ta: "குழந்தை கட்டில் அமைப்பு",
    },
    description: {
      en: "Safety-certified wooden baby crib with breathable mattress and cotton linens.",
      si: "ආරක්ෂිත ළදරු ලී ඇඳක් සහ පිරිසිදු කපු ඇඳ ඇතිරිලි.",
      ta: "பாதுகாப்பான குழந்தை மரக் கட்டில் மற்றும் மெத்தை.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 30,
    maxQuantityPerOrder: 1,
    requiresReturn: true,
    inventorySkuRef: "FURN-CRIB-001",
  },
  {
    code: "HK-SLIP-01",
    title: {
      en: "Waffle Weave Room Slippers & Robe",
      si: "කාමර සෙරෙප්පු සහ නාන ඇඳුම",
      ta: "அறை செருப்புகள் மற்றும் மேலங்கி",
    },
    description: {
      en: "Non-slip padded indoor cotton slippers and plush kimonostyle bath robe.",
      si: "ලිස්සා නොයන කපු සෙරෙප්පු යුගලක් සහ සුවපහසු නාන ඇඳුමක්.",
      ta: "வழுக்காத பருத்தி செருப்புகள் மற்றும் மேலங்கி.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 2,
    requiresReturn: false,
    inventorySkuRef: "LIN-SLIP-001",
  },
  {
    code: "HK-BLANK-01",
    title: {
      en: "Heavyweight Thermal Fleece Blanket",
      si: "අමතර උණුසුම් බ්ලැන්කට්ටුව",
      ta: "கூடுதல் கனமான போர்வை",
    },
    description: {
      en: "Ultra-warm thermal blanket for cool tropical AC or Nuwara Eliya hill nights.",
      si: "ශීතල රාත්‍රීන් සඳහා විශේෂයෙන් නිපදවූ උණුසුම් බ්ලැන්කට්ටුවක්.",
      ta: "குளிர்ந்த இரவுகளுக்கான கூடுதல் வெப்பமான போர்வை.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 2,
    requiresReturn: false,
    inventorySkuRef: "LIN-BLANK-001",
  },
  {
    code: "HK-DRYER-01",
    title: {
      en: "High-Power Ionic Hair Dryer",
      si: "අධි බලැති කෙස් වියළනය (Hair Dryer)",
      ta: "அதிவேக முடி உலர்த்தி",
    },
    description: {
      en: "2000W salon-grade hairdryer with cool shot and diffuser attachments.",
      si: "උසස් තත්වයේ කෙස් වියළනය.",
      ta: "தொழில்முறை முடி உலர்த்தி.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "HOUSEKEEPING",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 1,
    requiresReturn: true,
    inventorySkuRef: "EQP-DRYER-001",
  },
  {
    code: "HK-UMB-01",
    title: {
      en: "Full-Size Monsoon Rain Umbrella",
      si: "විශාල වැසි කුඩය",
      ta: "பெரிய மழை குடை",
    },
    description: {
      en: "Wind-resistant large golf umbrella for tropical downpours and garden walks.",
      si: "සුළඟට ඔරොත්තු දෙන විශාල වැසි කුඩයක්.",
      ta: "காற்றுக்கு எதிரான பெரிய மழை குடை.",
    },
    categoryCode: "CAT-HK-EXP",
    department: "FRONT_DESK",
    isComplimentary: true,
    priceLkr: 0,
    deliverySlaMinutes: 10,
    maxQuantityPerOrder: 2,
    requiresReturn: true,
    inventorySkuRef: "EQP-UMB-001",
  },
];

// ============================================================================
// Curated Dining, Bar & Spa Presets
// ============================================================================

export const SRI_LANKAN_BREAKFAST_PRESET: ReadonlyArray<PresetAmenityItem> = [
  {
    code: "BF-HOPP-01",
    title: {
      en: "Egg Hopper Feast (1 Egg + 4 Plain)",
      si: "බිත්තර ආප්ප සංග්‍රහය (බිත්තර 1 + සාමාන්‍ය 4)",
      ta: "முட்டை ஆப்ப விருந்து (1 முட்டை + 4 சாதாரண)",
    },
    description: {
      en: "Crispy edge bowl pancakes with spicy katta sambol, seeni sambol & coconut gravy.",
      si: "කට ගැස්මට කට්ට සම්බෝල, සීනි සම්බෝල සහ කිරි හොදි සමඟ නැවුම් ආප්ප.",
      ta: "கட்டா சம்பல் மற்றும் சீனி சம்பலுடன் மொறுமொறுப்பான ஆப்பம்.",
    },
    categoryCode: "CAT-RES-BF",
    department: "ROOM_SERVICE",
    isComplimentary: false,
    priceLkr: 1450.0,
    deliverySlaMinutes: 25,
    maxQuantityPerOrder: 4,
    requiresReturn: false,
  },
  {
    code: "BF-STRH-01",
    title: {
      en: "String Hoppers with Kiri Hodi & Pol Sambol",
      si: "ඉඳිආප්ප, කිරි හොදි සහ පොල් සම්බෝල",
      ta: "இடியாப்பம், பால் சொதி மற்றும் தேங்காய் சம்பல்",
    },
    description: {
      en: "Steamed red and white rice noodle nests with aromatic coconut milk gravy.",
      si: "රතු සහ සුදු ඉඳිආප්ප 15ක්, උකු කිරි හොදි සහ නැවුම් පොල් සම්බෝල සමඟ.",
      ta: "15 இடியாப்பங்கள், சுவையான பால் சொதி மற்றும் சம்பலுடன்.",
    },
    categoryCode: "CAT-RES-BF",
    department: "ROOM_SERVICE",
    isComplimentary: false,
    priceLkr: 1250.0,
    deliverySlaMinutes: 20,
    maxQuantityPerOrder: 4,
    requiresReturn: false,
  },
  {
    code: "BF-TEA-01",
    title: {
      en: "Single-Estate Nuwara Eliya BOPF Ceylon Tea Pot",
      si: "නුවරඑළිය සිලෝන් තේ පෝච්චිය (Pot)",
      ta: "நுவரெலியா சிலோன் தேநீர் பாட்",
    },
    description: {
      en: "Pure high-grown black tea served with fresh milk, brown sugar, and ginger biscuits.",
      si: "නැවුම් කිරි සහ හකුරු/ඉඟුරු බිස්කට් සමඟ පිරිනමන උසස් තත්වයේ තේ.",
      ta: "சுத்தமான நுவரெலியா தேநீர் பாட்.",
    },
    categoryCode: "CAT-RES-BF",
    department: "ROOM_SERVICE",
    isComplimentary: false,
    priceLkr: 650.0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 6,
    requiresReturn: false,
  },
];

export const POOL_BAR_PRESET: ReadonlyArray<PresetAmenityItem> = [
  {
    code: "BAR-THAM-01",
    title: {
      en: "Fresh Ceylon King Coconut (Thambili)",
      si: "නැවුම් තැඹිලි ගෙඩිය",
      ta: "இயற்கை இளநீர் (தம்பிலி)",
    },
    description: {
      en: "Naturally chilled golden king coconut opened to order with eco-straw.",
      si: "ස්වභාවිකව සිසිල් කළ රන්වන් තැඹිලි පානය.",
      ta: "புதிய இயற்கையான தம்பிலி இளநீர்.",
    },
    categoryCode: "CAT-BAR-POOL",
    department: "BAR",
    isComplimentary: false,
    priceLkr: 450.0,
    deliverySlaMinutes: 10,
    maxQuantityPerOrder: 8,
    requiresReturn: false,
  },
  {
    code: "BAR-LION-01",
    title: {
      en: "Lion Lager Beer Bottle 625ml",
      si: "ලයින් ලැගර් බියර් 625ml",
      ta: "லயன் லாகர் பீர் 625ml",
    },
    description: {
      en: "Sri Lanka's iconic golden lager, ice-chilled with salted devilled cashews.",
      si: "අයිස් සිසිල් කළ ශ්‍රී ලාංකික බියර් බෝතලය (කජු සමඟ).",
      ta: "குளிர்ந்த லயன் லாகர் பீர்.",
    },
    categoryCode: "CAT-BAR-POOL",
    department: "BAR",
    isComplimentary: false,
    priceLkr: 1100.0,
    deliverySlaMinutes: 10,
    maxQuantityPerOrder: 6,
    requiresReturn: false,
  },
  {
    code: "BAR-ARCK-01",
    title: {
      en: "Old Reserve Arrack Passionfruit Sour",
      si: "ඕල්ඩ් රිසර්ව් අරක්කු කොක්ටේල්",
      ta: "அரக் காக்டெய்ல்",
    },
    description: {
      en: "Distilled coconut flower arrack, fresh passionfruit pulp, lime juice, and wild kithul.",
      si: "පොල් අරක්කු සහ නැවුම් වැල්දොඩම් මිශ්‍ර කොක්ටේල් පානය.",
      ta: "சுவையான தேங்காய் அரக் காக்டெய்ல்.",
    },
    categoryCode: "CAT-BAR-POOL",
    department: "BAR",
    isComplimentary: false,
    priceLkr: 1850.0,
    deliverySlaMinutes: 15,
    maxQuantityPerOrder: 4,
    requiresReturn: false,
  },
];

export const AYURVEDA_WELLNESS_PRESET: ReadonlyArray<PresetAmenityItem> = [
  {
    code: "SPA-ABHY-01",
    title: {
      en: "Abhyanga Full Body Herbal Oil Massage (60 min)",
      si: "අභ්‍යංග ඖෂධීය තෙල් සම්බාහනය (මිනි 60)",
      ta: "அப்யங்க மூலிகை எண்ணெய் மசாஜ் (60 நிமி)",
    },
    description: {
      en: "Ancient restorative warm herbal oil therapy relaxing muscle stiffness and toxins.",
      si: "සාම්ප්‍රදායික උණුසුම් ඖෂධීය තෙල් සම්බාහනය.",
      ta: "பாரம்பரிய மூலிகை எண்ணெய் சிகிச்சை.",
    },
    categoryCode: "CAT-SPA-WELL",
    department: "SPA",
    isComplimentary: false,
    priceLkr: 9500.0,
    deliverySlaMinutes: 60,
    maxQuantityPerOrder: 2,
    requiresReturn: false,
  },
  {
    code: "SPA-SHIR-01",
    title: {
      en: "Shirodhara Third-Eye Oil Flow Therapy (45 min)",
      si: "ශිරෝධාරා ප්‍රතිකාරය (මිනි 45)",
      ta: "சிரோதாரா எண்ணெய் சிகிச்சை (45 நிமி)",
    },
    description: {
      en: "Continuous stream of warm medicated herbal oil gently poured onto the forehead.",
      si: "මානසික ආතතිය දුරු කරන සම්ප්‍රදායික ශිරෝධාරා ප්‍රතිකාරය.",
      ta: "மன அமைதிக்கான சிரோதாரா சிகிச்சை.",
    },
    categoryCode: "CAT-SPA-WELL",
    department: "SPA",
    isComplimentary: false,
    priceLkr: 12000.0,
    deliverySlaMinutes: 45,
    maxQuantityPerOrder: 2,
    requiresReturn: false,
  },
];

// ============================================================================
// Master Catalog Categories Registry
// ============================================================================

export const DEFAULT_CATALOG_CATEGORIES_PRESET: ReadonlyArray<PresetCategory> = [
  {
    code: "CAT-HK-EXP",
    name: {
      en: "Express Room Amenities & Housekeeping",
      si: "ක්ෂණික කාමර පහසුකම් සහ සේවාවන්",
      ta: "விரைவு அறை வசதிகள் மற்றும் வீட்டு பராமரிப்பு",
    },
    department: "HOUSEKEEPING",
    iconEmoji: "🧹",
    displayOrder: 1,
    items: HOUSEKEEPING_AMENITIES_PRESET,
  },
  {
    code: "CAT-RES-BF",
    name: {
      en: "Authentic Sri Lankan Breakfast",
      si: "සාම්ප්‍රදායික ශ්‍රී ලාංකික උදෑසන ආහාරය",
      ta: "பாரம்பரிய இலங்கை காலை உணவு",
    },
    department: "ROOM_SERVICE",
    iconEmoji: "🍳",
    displayOrder: 2,
    items: SRI_LANKAN_BREAKFAST_PRESET,
  },
  {
    code: "CAT-BAR-POOL",
    name: {
      en: "Poolside Cocktails & Cold Refreshments",
      si: "තටාකාංගණ කොක්ටේල් සහ සිසිල් බීම",
      ta: "குளக்கரை காக்டெய்ல் மற்றும் பானங்கள்",
    },
    department: "BAR",
    iconEmoji: "🍹",
    displayOrder: 3,
    items: POOL_BAR_PRESET,
  },
  {
    code: "CAT-SPA-WELL",
    name: {
      en: "Ayurvedic Spa & Wellness Rituals",
      si: "ආයුර්වේද ස්පා සහ සුවතා සත්කාර",
      ta: "ஆயுர்வேத ஸ்பா மற்றும் ஆரோக்கிய சிகிச்சை",
    },
    department: "SPA",
    iconEmoji: "🌿",
    displayOrder: 4,
    items: AYURVEDA_WELLNESS_PRESET,
  },
];

// ============================================================================
// Query & Inspection Helpers
// ============================================================================

export function getHousekeepingAmenitiesPreset(): ReadonlyArray<PresetAmenityItem> {
  return HOUSEKEEPING_AMENITIES_PRESET;
}

export function getAllCatalogPresets(): ReadonlyArray<PresetCategory> {
  return DEFAULT_CATALOG_CATEGORIES_PRESET;
}

export function filterPresetsByDepartment(
  department: DepartmentCode,
): ReadonlyArray<PresetCategory> {
  return DEFAULT_CATALOG_CATEGORIES_PRESET.filter((cat) => cat.department === department);
}

// ============================================================================
// Multi-Tenant Seed Generator Engine
// ============================================================================

function validateTenantId(tenantId: string): Result<void, DomainError> {
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    return domainErr("VALIDATION_FAILED", "Tenant ID is required for catalog seeding");
  }
  const cleanId = tenantId.trim().toLowerCase();
  const validPattern = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
  if (!validPattern.test(cleanId)) {
    return domainErr(
      "VALIDATION_FAILED",
      `Invalid tenant ID format '${tenantId}'. Must match /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/`,
    );
  }
  return ok(undefined);
}

export function generateTenantCatalogSeed(
  tenantId: string,
  options?: CatalogSeedOptions,
): Result<GeneratedCatalogSeed, DomainError> {
  const validation = validateTenantId(tenantId);
  if (!validation.ok) {
    return validation;
  }

  const cleanTenant = tenantId.trim().toLowerCase();
  const allowedDepts = options?.departments;
  const filteredCategories =
    allowedDepts && allowedDepts.length > 0
      ? DEFAULT_CATALOG_CATEGORIES_PRESET.filter((cat) => allowedDepts.includes(cat.department))
      : DEFAULT_CATALOG_CATEGORIES_PRESET;

  const categories: SeededCatalogCategory[] = [];
  const items: SeededCatalogItem[] = [];

  for (const catPreset of filteredCategories) {
    const categoryId = `cat_${cleanTenant}_${catPreset.code.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    categories.push({
      id: categoryId,
      tenantId: cleanTenant,
      code: catPreset.code,
      name: catPreset.name,
      department: catPreset.department,
      iconEmoji: catPreset.iconEmoji,
      displayOrder: catPreset.displayOrder,
      isActive: true,
    });

    for (let iIdx = 0; iIdx < catPreset.items.length; iIdx++) {
      const itemPreset = catPreset.items[iIdx];
      if (!itemPreset) {
        continue;
      }
      const itemId = `itm_${cleanTenant}_${itemPreset.code.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

      items.push({
        id: itemId,
        tenantId: cleanTenant,
        categoryId,
        code: itemPreset.code,
        title: itemPreset.title,
        description: itemPreset.description,
        department: itemPreset.department,
        priceLkr: itemPreset.priceLkr,
        isComplimentary: itemPreset.isComplimentary,
        deliverySlaMinutes: itemPreset.deliverySlaMinutes,
        maxQuantityPerOrder: itemPreset.maxQuantityPerOrder,
        requiresReturn: itemPreset.requiresReturn,
        isActive: true,
        displayOrder: iIdx + 1,
      });
    }
  }

  const totalComplimentary = items.filter((it) => it.isComplimentary).length;

  const auditResult = createAuditEntry({
    tenantId: cleanTenant,
    actorUserId: options?.userId ?? "system-seed-worker",
    action: "SEED_CATALOG_PRESET",
    entityType: "CATALOG",
    entityId: `catalog_${cleanTenant}`,
    isoTs: options?.timestampIso ?? new Date().toISOString(),
    afterJson: JSON.stringify({
      categoriesCount: categories.length,
      itemsCount: items.length,
      complimentaryCount: totalComplimentary,
      departments: filteredCategories.map((c) => c.department),
    }),
    prevHash: options?.previousHash,
  });

  if (!auditResult.ok) {
    return auditResult;
  }

  return ok({
    tenantId: cleanTenant,
    categories,
    items,
    totalCategories: categories.length,
    totalItems: items.length,
    totalComplimentaryItems: totalComplimentary,
    auditLog: auditResult.value,
  });
}
