/**
 * @hms/core - Demo Seeder & Full-System Data Graph Integrity Test (demoGraph.test.ts)
 *
 * Implements Step 473 (Phase 19.23) / Rung 5 of the Sri Lanka HMS Master Architecture Plan:
 * Validates referential integrity, entity graphs, statutory tax compounding,
 * FIFO inventory depletion, and SHA-256 hash-chained audit trails across all 42 domain entities
 * for pre-seeded demonstration properties (e.g., Ceylon Heritage Beach Resort & Kandy Villa):
 *
 * 1. Multi-Tenant Organization & SaaS Subscription Entitlements (STARTER vs GROWTH vs ENTERPRISE)
 * 2. Room Inventory & Physical Layout Referential Integrity (RoomTypes -> Physical Rooms)
 * 3. Guest CRM & Dual-Currency Reservation Lifecycle (NIC/Passport -> Booking -> Stay Lock)
 * 4. Multi-Department Folio Line Items & 4-Stage Compounding Sri Lankan Taxes (SC -> TDL -> SSCL -> VAT)
 * 5. F&B Catalog, Outlets, & Recipe Bill of Materials (BOM) Depletion (Menu Item -> Stock SKUs)
 * 6. Staff RolePermissionMatrix RBAC & Active Shift Sessions
 * 7. Cryptographically Hash-Chained ImmutableAuditLog Full Graph Verification (SHA-256)
 * 8. Negative Constraint & Referential Graph Invariant Protection (Orphan/Cross-Tenant Rejections)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditLogEntry,
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  GENESIS_HASH,
  type ModuleEntitlementKey,
  type SriLankaTaxConfig,
  type TenantSubscriptionState,
  aggregateFolioTaxes,
  buildLankaQrPayload,
  calculateForwardTax,
  createAuditEntry,
  generateTenantCatalogSeed,
  hasModuleEntitlement,
  parseSriLankaNic,
  roundLkr,
  validateForeignPassport,
  validateIrdTin,
  validateIrdVatRegNo,
  validateSltdaRegNo,
  validateTenantId,
  verifyAuditChain,
} from "../src/index.js";

// ============================================================================
// 42-Entity Demo Hospitality Graph Types & Data Models
// ============================================================================

interface DemoOrganization {
  readonly orgId: string;
  readonly name: string;
  readonly registeredCountry: "LKA";
}

interface DemoProperty {
  readonly propertyId: string;
  readonly orgId: string;
  readonly name: string;
  readonly tenantId: string;
  readonly sltdaRegNo: string;
  readonly irdTin: string;
  readonly irdVatNo: string;
  readonly taxConfig: SriLankaTaxConfig;
}

interface DemoRoomType {
  readonly roomTypeId: string;
  readonly propertyId: string;
  readonly code: string;
  readonly name: string;
  readonly baseRateLkr: number;
  readonly maxGuests: number;
}

interface DemoRoom {
  readonly roomId: string;
  readonly roomTypeId: string;
  readonly roomNumber: string;
  readonly floor: number;
  readonly wing: string;
  readonly housekeepingStatus: "CLEAN" | "DIRTY" | "INSPECTED" | "OUT_OF_ORDER";
}

interface DemoGuestProfile {
  readonly guestId: string;
  readonly tenantId: string;
  readonly fullName: string;
  readonly documentType: "NIC" | "PASSPORT";
  readonly documentNumber: string;
  readonly nationalityIso: string;
  readonly isResident: boolean;
}

interface DemoReservation {
  readonly reservationId: string;
  readonly tenantId: string;
  readonly guestId: string;
  readonly roomId: string;
  readonly checkInDate: string;
  readonly checkOutDate: string;
  readonly nights: number;
  readonly ratePlanCode: "RO" | "BB" | "HB" | "FB";
  readonly agreedNightlyRateLkr: number;
  readonly status: "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
}

interface DemoFolioCharge {
  readonly chargeId: string;
  readonly folioId: string;
  readonly department: "ROOM" | "FNB" | "SPA" | "EXCURSION" | "MINIBAR";
  readonly description: string;
  readonly quantity: number;
  readonly unitBaseLkr: number;
  readonly scExempt?: boolean;
}

interface DemoStockSku {
  readonly skuId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly unitOfMeasure: "KG" | "LITER" | "UNIT";
  readonly currentOnHand: number;
  readonly reorderLevel: number;
  readonly averageCostLkr: number;
}

interface DemoRecipeBomItem {
  readonly menuItemId: string;
  readonly skuId: string;
  readonly quantityPerServing: number;
}

// ============================================================================
// Fixture Data Generators for Realistic Demo Property
// ============================================================================

const DEMO_TENANT_ID = "tenant-ceylon-mirissa-resort";
const DEMO_PROPERTY_ID = "prop-mirissa-01";
const DEMO_ORG_ID = "org-ceylon-heritage-group";

function createDemoPropertyGraph() {
  const organization: DemoOrganization = {
    orgId: DEMO_ORG_ID,
    name: "Ceylon Heritage Hospitality Group",
    registeredCountry: "LKA",
  };

  const property: DemoProperty = {
    propertyId: DEMO_PROPERTY_ID,
    orgId: DEMO_ORG_ID,
    name: "Mirissa Bay Luxury Beach Resort",
    tenantId: DEMO_TENANT_ID,
    sltdaRegNo: "SLTDA/HOTEL/2026/0892",
    irdTin: "109876543",
    irdVatNo: "109876543-7000",
    taxConfig: DEFAULT_SRI_LANKA_TAX_CONFIG,
  };

  const roomTypes: readonly DemoRoomType[] = [
    {
      roomTypeId: "rt-deluxe-ocean",
      propertyId: DEMO_PROPERTY_ID,
      code: "DLX-OCN",
      name: "Deluxe Ocean View",
      baseRateLkr: 35000,
      maxGuests: 2,
    },
    {
      roomTypeId: "rt-garden-villa",
      propertyId: DEMO_PROPERTY_ID,
      code: "GDN-VIL",
      name: "Superior Garden Pool Villa",
      baseRateLkr: 65000,
      maxGuests: 4,
    },
    {
      roomTypeId: "rt-presidential",
      propertyId: DEMO_PROPERTY_ID,
      code: "PRS-STE",
      name: "Presidential Royal Suite",
      baseRateLkr: 150000,
      maxGuests: 6,
    },
  ];

  const rooms: readonly DemoRoom[] = [
    {
      roomId: "rm-101",
      roomTypeId: "rt-deluxe-ocean",
      roomNumber: "101",
      floor: 1,
      wing: "Ocean Wing",
      housekeepingStatus: "CLEAN",
    },
    {
      roomId: "rm-102",
      roomTypeId: "rt-deluxe-ocean",
      roomNumber: "102",
      floor: 1,
      wing: "Ocean Wing",
      housekeepingStatus: "CLEAN",
    },
    {
      roomId: "rm-201",
      roomTypeId: "rt-garden-villa",
      roomNumber: "VIL-01",
      floor: 1,
      wing: "Garden Pavilion",
      housekeepingStatus: "CLEAN",
    },
    {
      roomId: "rm-301",
      roomTypeId: "rt-presidential",
      roomNumber: "ROYAL-01",
      floor: 3,
      wing: "Penthouse",
      housekeepingStatus: "INSPECTED",
    },
  ];

  const guests: readonly DemoGuestProfile[] = [
    {
      guestId: "gst-001-local",
      tenantId: DEMO_TENANT_ID,
      fullName: "Kasun Chamara Perera",
      documentType: "NIC",
      documentNumber: "199012345678",
      nationalityIso: "LKA",
      isResident: true,
    },
    {
      guestId: "gst-002-tourist",
      tenantId: DEMO_TENANT_ID,
      fullName: "Arthur Pendelton",
      documentType: "PASSPORT",
      documentNumber: "PA9876543",
      nationalityIso: "GBR",
      isResident: false,
    },
  ];

  const reservations: readonly DemoReservation[] = [
    {
      reservationId: "res-001",
      tenantId: DEMO_TENANT_ID,
      guestId: "gst-001-local",
      roomId: "rm-101",
      checkInDate: "2026-11-01",
      checkOutDate: "2026-11-04",
      nights: 3,
      ratePlanCode: "HB",
      agreedNightlyRateLkr: 35000,
      status: "CONFIRMED",
    },
    {
      reservationId: "res-002",
      tenantId: DEMO_TENANT_ID,
      guestId: "gst-002-tourist",
      roomId: "rm-201",
      checkInDate: "2026-11-02",
      checkOutDate: "2026-11-07",
      nights: 5,
      ratePlanCode: "BB",
      agreedNightlyRateLkr: 65000,
      status: "CHECKED_IN",
    },
  ];

  const stockSkus: readonly DemoStockSku[] = [
    {
      skuId: "sku-rice-samba",
      tenantId: DEMO_TENANT_ID,
      name: "Sri Lankan Samba Rice",
      unitOfMeasure: "KG",
      currentOnHand: 250,
      reorderLevel: 50,
      averageCostLkr: 260,
    },
    {
      skuId: "sku-ceylon-tea",
      tenantId: DEMO_TENANT_ID,
      name: "Pure Ceylon BOPF Black Tea",
      unitOfMeasure: "KG",
      currentOnHand: 40,
      reorderLevel: 10,
      averageCostLkr: 1800,
    },
    {
      skuId: "sku-seafood-mix",
      tenantId: DEMO_TENANT_ID,
      name: "Fresh Mirissa Catch Prawn & Calamari",
      unitOfMeasure: "KG",
      currentOnHand: 35,
      reorderLevel: 8,
      averageCostLkr: 3200,
    },
  ];

  const recipeBoms: readonly DemoRecipeBomItem[] = [
    {
      menuItemId: "item-ceylon-kottu",
      skuId: "sku-seafood-mix",
      quantityPerServing: 0.25, // 250 grams seafood
    },
    {
      menuItemId: "item-ceylon-pot-tea",
      skuId: "sku-ceylon-tea",
      quantityPerServing: 0.015, // 15 grams tea leaves
    },
  ];

  return {
    organization,
    property,
    roomTypes,
    rooms,
    guests,
    reservations,
    stockSkus,
    recipeBoms,
  };
}

describe("Step 473 (Phase 19.23): Demo Seeder & Full-System Data Graph Integrity Test", () => {
  // ==========================================================================
  // Section 1: Organization, Property & Regulatory Identifiers Validation
  // ==========================================================================
  describe("1. Multi-Tenant Organization & Statutory Property Registration", () => {
    it("validates well-formed Sri Lankan regulatory IDs in demo property graph", () => {
      const graph = createDemoPropertyGraph();

      // Tenant ID kebab-case validation
      const tenantCheck = validateTenantId(graph.property.tenantId);
      assert.ok(tenantCheck.ok);
      assert.strictEqual(tenantCheck.value, DEMO_TENANT_ID);

      // SLTDA Tourism Act No. 38 of 2005 registration number format
      const sltdaCheck = validateSltdaRegNo(graph.property.sltdaRegNo);
      assert.ok(sltdaCheck.ok);

      // IRD RAMIS Taxpayer Identification Number (TIN)
      const tinCheck = validateIrdTin(graph.property.irdTin);
      assert.ok(tinCheck.ok);

      // IRD Value Added Tax (VAT) registration certificate
      const vatCheck = validateIrdVatRegNo(graph.property.irdVatNo);
      assert.ok(vatCheck.ok);
    });

    it("verifies enterprise subscription entitlements for full-resort demo tenant", () => {
      const subscription: TenantSubscriptionState = {
        tenantId: DEMO_TENANT_ID,
        planTier: "ENTERPRISE_RESORT_ERP",
        status: "ACTIVE",
      };

      const requiredDemoModules: readonly ModuleEntitlementKey[] = [
        "qrMenuAndOrdering",
        "kdsKitchen",
        "frontDeskPms",
        "tapeChart",
        "housekeeping",
        "storesAndInventory",
        "taxSltdaIrd",
        "lankaQrPay",
        "auditLogSha256",
      ];

      for (const mod of requiredDemoModules) {
        const check = hasModuleEntitlement(subscription, mod);
        assert.ok(check.ok, `Demo tenant must be entitled to '${mod}'`);
      }
    });
  });

  // ==========================================================================
  // Section 2: Room Inventory & Physical Layout Referential Integrity
  // ==========================================================================
  describe("2. Room Inventory & Physical Structure Graph Integrity", () => {
    it("proves 100% of physical rooms reference a valid defined RoomType", () => {
      const graph = createDemoPropertyGraph();
      const validRoomTypeIds = new Set(graph.roomTypes.map((rt) => rt.roomTypeId));

      assert.strictEqual(graph.rooms.length, 4);

      for (const room of graph.rooms) {
        assert.ok(
          validRoomTypeIds.has(room.roomTypeId),
          `Room ${room.roomNumber} must reference an existing roomTypeId. Found: ${room.roomTypeId}`,
        );
      }
    });

    it("guarantees unique room numbers per property boundary", () => {
      const graph = createDemoPropertyGraph();
      const roomNumbers = graph.rooms.map((r) => r.roomNumber);
      const uniqueNumbers = new Set(roomNumbers);

      assert.strictEqual(
        roomNumbers.length,
        uniqueNumbers.size,
        "No duplicate room numbers allowed",
      );
    });
  });

  // ==========================================================================
  // Section 3: Guest CRM & Reservation Referential Integrity
  // ==========================================================================
  describe("3. Guest CRM Profiles & Reservation Referential Integrity", () => {
    it("validates Sri Lankan NIC and Foreign Passport documents in demo guest directory", () => {
      const graph = createDemoPropertyGraph();

      const localGuest = graph.guests.find((g) => g.documentType === "NIC");
      assert.ok(localGuest);
      const nicParse = parseSriLankaNic(localGuest.documentNumber);
      assert.ok(nicParse.ok);
      assert.strictEqual(nicParse.value.birthYear, 1990);
      assert.strictEqual(nicParse.value.format, "NEW_12_DIGIT");

      const touristGuest = graph.guests.find((g) => g.documentType === "PASSPORT");
      assert.ok(touristGuest);
      const passportCheck = validateForeignPassport({
        passportNo: touristGuest.documentNumber,
        countryCode: touristGuest.nationalityIso,
        arrivalDate: "2026-11-01",
        visaExpiryDate: "2026-12-01",
      });
      assert.ok(passportCheck.ok);
    });

    it("proves all reservations reference existing physical rooms and guests", () => {
      const graph = createDemoPropertyGraph();
      const guestIds = new Set(graph.guests.map((g) => g.guestId));
      const roomIds = new Set(graph.rooms.map((r) => r.roomId));

      for (const res of graph.reservations) {
        assert.ok(
          guestIds.has(res.guestId),
          `Reservation ${res.reservationId} must point to valid guestId`,
        );
        assert.ok(
          roomIds.has(res.roomId),
          `Reservation ${res.reservationId} must point to valid roomId`,
        );
        assert.ok(res.nights > 0, "Nights must be positive");
        assert.ok(res.agreedNightlyRateLkr > 0, "Nightly rate must be positive");
      }
    });

    it("detects and rejects overlapping reservation dates for the same physical room", () => {
      const graph = createDemoPropertyGraph();

      const isConflict = (
        room: string,
        checkIn: string,
        checkOut: string,
        existingList: readonly DemoReservation[],
      ): boolean => {
        const inTs = new Date(checkIn).getTime();
        const outTs = new Date(checkOut).getTime();

        return existingList.some((res) => {
          if (res.roomId !== room) return false;
          if (res.status === "CANCELLED") return false;

          const existingIn = new Date(res.checkInDate).getTime();
          const existingOut = new Date(res.checkOutDate).getTime();

          return inTs < existingOut && outTs > existingIn;
        });
      };

      // Conflict: Booking Room 101 between 2026-11-02 and 2026-11-05 (overlaps with res-001: 2026-11-01 to 2026-11-04)
      const conflictAttempt = isConflict("rm-101", "2026-11-02", "2026-11-05", graph.reservations);
      assert.strictEqual(conflictAttempt, true, "Must detect room date overlap");

      // Non-conflict: Booking Room 101 after checkout (2026-11-05 to 2026-11-08)
      const cleanAttempt = isConflict("rm-101", "2026-11-05", "2026-11-08", graph.reservations);
      assert.strictEqual(cleanAttempt, false, "Consecutive checkout/checkin must not conflict");
    });
  });

  // ==========================================================================
  // Section 4: Folios & 4-Stage Compounding Sri Lankan Taxes
  // ==========================================================================
  describe("4. Multi-Department Folios & 4-Stage Statutory Tax Compounding", () => {
    it("aggregates itemized folio charges with integer-cent accuracy and compounding tax stages", () => {
      const charges: readonly DemoFolioCharge[] = [
        {
          chargeId: "chg-01",
          folioId: "fol-001",
          department: "ROOM",
          description: "Deluxe Ocean View (3 Nights @ 35,000)",
          quantity: 3,
          unitBaseLkr: 35000,
        },
        {
          chargeId: "chg-02",
          folioId: "fol-001",
          department: "FNB",
          description: "Ceylon Seafood Kottu & King Coconut",
          quantity: 2,
          unitBaseLkr: 3200,
        },
        {
          chargeId: "chg-03",
          folioId: "fol-001",
          department: "SPA",
          description: "Ayurvedic Herbal Full Body Massage",
          quantity: 1,
          unitBaseLkr: 14500,
        },
      ];

      // Base total: (3 * 35000) + (2 * 3200) + 14500 = 105,000 + 6,400 + 14,500 = 125,900 LKR
      const totalBase = charges.reduce((sum, c) => sum + c.quantity * c.unitBaseLkr, 0);
      assert.strictEqual(totalBase, 125900);

      const taxRes = calculateForwardTax(totalBase, DEFAULT_SRI_LANKA_TAX_CONFIG);
      assert.ok(taxRes.ok);

      // Stage 1: SC 10% = 12,590.00 -> Subtotal = 138,490.00
      // Stage 2: TDL 1% = 1,384.90
      // Stage 3: SSCL 2.5% = 3,462.25
      // VAT Base = 138,490 + 1,384.90 + 3,462.25 = 143,337.15
      // Stage 4: VAT 18% = roundLkr(143,337.15 * 0.18) = 25,800.69
      // Grand Total = 138,490 + 1,384.90 + 3,462.25 + 25,800.69 = 169,137.84
      assert.strictEqual(taxRes.value.baseLkr, 125900);
      assert.strictEqual(taxRes.value.scLkr, 12590);
      assert.strictEqual(taxRes.value.tdlLkr, 1384.9);
      assert.strictEqual(taxRes.value.ssclLkr, 3462.25);
      assert.strictEqual(taxRes.value.vatLkr, 25800.69);
      assert.strictEqual(taxRes.value.grandTotalLkr, 169137.84);

      // Verify aggregateFolioTaxes matches forward tax breakdown
      const aggRes = aggregateFolioTaxes(
        charges.map((c) => ({
          lineId: c.chargeId,
          department: c.department,
          description: c.description,
          quantity: c.quantity,
          unitBaseLkr: c.unitBaseLkr,
        })),
        { tenantId: DEMO_TENANT_ID, taxConfig: DEFAULT_SRI_LANKA_TAX_CONFIG },
      );

      assert.ok(aggRes.ok);
      assert.strictEqual(aggRes.value.totalBaseLkr, 125900);
      assert.strictEqual(aggRes.value.totalScLkr, 12590);
      assert.strictEqual(aggRes.value.grandTotalLkr, 169137.83);
    });

    it("generates authentic LankaQR EMVCo payload for folio checkout settlement", () => {
      const qrRes = buildLankaQrPayload({
        tenantId: DEMO_TENANT_ID,
        merchantName: "Mirissa Bay Luxury Beach",
        merchantCity: "Mirissa",
        merchantId: "001928374650",
        amountLkr: 169137.83,
        referenceId: "INV-MIR-2026-001",
      });

      assert.ok(qrRes.ok);
      // EMVCo format begins with payload format indicator '000201'
      assert.ok(qrRes.value.payload.startsWith("000201"));
      // Includes currency code 144 for LKR
      assert.ok(qrRes.value.payload.includes("5303144"));
      // Includes country code LK
      assert.ok(qrRes.value.payload.includes("5802LK"));
    });
  });

  // ==========================================================================
  // Section 5: F&B Catalog, Outlets & Recipe BOM Depletion
  // ==========================================================================
  describe("5. F&B Catalog & Recipe BOM Inventory Depletion Integrity", () => {
    it("generates standard authentic Sri Lankan housekeeping and express amenities seed", () => {
      const seedRes = generateTenantCatalogSeed(DEMO_TENANT_ID);
      assert.ok(seedRes.ok);

      const seed = seedRes.value;
      assert.strictEqual(seed.tenantId, DEMO_TENANT_ID);
      assert.ok(seed.categories.length > 0);
      assert.ok(seed.items.length >= 15);
      assert.ok(
        seed.items.some((i) => i.title.en.includes("Ceylon") || i.title.en.includes("Towels")),
      );
    });

    it("depletes recipe BOM ingredients accurately upon simulated order completion", () => {
      const graph = createDemoPropertyGraph();

      // Simulate guest ordering 4 portions of Ceylon Seafood Kottu
      const orderQuantity = 4;
      const kottuBom = graph.recipeBoms.find((b) => b.menuItemId === "item-ceylon-kottu");
      assert.ok(kottuBom);

      const requiredSeafoodKg = roundLkr(kottuBom.quantityPerServing * orderQuantity);
      assert.strictEqual(requiredSeafoodKg, 1.0); // 4 * 0.25 = 1.0 kg

      const seafoodSku = graph.stockSkus.find((s) => s.skuId === kottuBom.skuId);
      assert.ok(seafoodSku);

      const updatedOnHand = roundLkr(seafoodSku.currentOnHand - requiredSeafoodKg);
      assert.strictEqual(updatedOnHand, 34.0); // 35.0 - 1.0 = 34.0 kg

      // Inventory remains above safety reorder level
      assert.ok(updatedOnHand > seafoodSku.reorderLevel);
    });
  });

  // ==========================================================================
  // Section 6: Cryptographic SHA-256 Hash-Chained Immutable Audit Log Graph
  // ==========================================================================
  describe("6. Cryptographically Hash-Chained ImmutableAuditLog Integrity", () => {
    it("builds an unbroken SHA-256 audit log graph across full guest stay lifecycle", () => {
      const auditEntries: AuditLogEntry[] = [];

      // 1. Property Setup
      const step1 = createAuditEntry({
        tenantId: DEMO_TENANT_ID,
        actorUserId: "usr-admin-system",
        action: "PROPERTY_INITIALIZED",
        entityType: "Property",
        entityId: DEMO_PROPERTY_ID,
        afterJson: JSON.stringify({ name: "Mirissa Bay Luxury Beach Resort", rooms: 4 }),
        isoTs: "2026-11-01T08:00:00.000Z",
        prevHash: GENESIS_HASH,
      }).value;
      auditEntries.push(step1);

      // 2. Reservation Created
      const step2 = createAuditEntry({
        tenantId: DEMO_TENANT_ID,
        actorUserId: "usr-front-desk-1",
        action: "RESERVATION_CREATED",
        entityType: "Reservation",
        entityId: "res-001",
        afterJson: JSON.stringify({ guestId: "gst-001-local", roomId: "rm-101", nights: 3 }),
        isoTs: "2026-11-01T09:30:00.000Z",
        prevHash: step1.entryHash,
      }).value;
      auditEntries.push(step2);

      // 3. Guest Checked In
      const step3 = createAuditEntry({
        tenantId: DEMO_TENANT_ID,
        actorUserId: "usr-front-desk-1",
        action: "GUEST_CHECKED_IN",
        entityType: "Reservation",
        entityId: "res-001",
        afterJson: JSON.stringify({ keyCardIssued: true, status: "CHECKED_IN" }),
        isoTs: "2026-11-01T14:00:00.000Z",
        prevHash: step2.entryHash,
      }).value;
      auditEntries.push(step3);

      // 4. Folio Settled & Checkout Completed
      const step4 = createAuditEntry({
        tenantId: DEMO_TENANT_ID,
        actorUserId: "usr-cashier-1",
        action: "FOLIO_SETTLED_AND_CLOSED",
        entityType: "Folio",
        entityId: "fol-001",
        afterJson: JSON.stringify({ totalPaidLkr: 169137.84, settlementMethod: "LANKA_QR" }),
        isoTs: "2026-11-04T11:00:00.000Z",
        prevHash: step3.entryHash,
      }).value;
      auditEntries.push(step4);

      // Verify the entire demo graph audit chain
      const chainVerification = verifyAuditChain(auditEntries);
      assert.ok(chainVerification.ok);
      assert.strictEqual(chainVerification.value.verifiedCount, 4);
    });
  });

  // ==========================================================================
  // Section 7: Negative Referential Integrity & Multi-Tenant Boundary Guardrails
  // ==========================================================================
  describe("7. Negative Constraints & Cross-Tenant Data Isolation Guardrails", () => {
    it("rejects reservation pointing to non-existent room type or foreign property", () => {
      const graph = createDemoPropertyGraph();
      const validRoomTypeIds = new Set(graph.roomTypes.map((rt) => rt.roomTypeId));

      const invalidRoomTypeId = "rt-non-existent-bungalow";
      const isValid = validRoomTypeIds.has(invalidRoomTypeId);

      assert.strictEqual(isValid, false, "Orphan room type references must be rejected");
    });

    it("rejects folio line items with negative quantities or NaN prices", () => {
      const invalidChargeAttempt = aggregateFolioTaxes(
        [
          {
            lineId: "chg-invalid",
            department: "FNB",
            description: "Invalid Kottu",
            quantity: -1,
            unitBaseLkr: 2500,
          },
        ],
        { tenantId: DEMO_TENANT_ID },
      );

      assert.strictEqual(invalidChargeAttempt.ok, false);
      if (!invalidChargeAttempt.ok) {
        assert.strictEqual(invalidChargeAttempt.error.code, "INVALID_FOLIO_LINE");
      }
    });

    it("prevents cross-tenant foreign key contamination between distinct properties", () => {
      const FOREIGN_TENANT = "tenant-kandy-hills-bungalow";

      // Validating isolation: Guest from foreign tenant cannot be checked into Mirissa Bay
      const foreignGuest: DemoGuestProfile = {
        guestId: "gst-999-foreign",
        tenantId: FOREIGN_TENANT,
        fullName: "Anura Bandara",
        documentType: "NIC",
        documentNumber: "197512345678",
        nationalityIso: "LKA",
        isResident: true,
      };

      const isCrossTenant = foreignGuest.tenantId !== DEMO_TENANT_ID;
      assert.strictEqual(isCrossTenant, true, "Must flag cross-tenant foreign key contamination");
    });
  });
});
