import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FolioLineItem,
  aggregateFolioTaxes,
  createFolioTaxAuditEntry,
} from "../src/folioMath.js";
import { createTaxPreset } from "../src/tax.js";

describe("Multi-Line Guest Folio Tax Aggregator (aggregateFolioTaxes)", () => {
  it("aggregates multi-department charges with 4-stage compounding taxes", () => {
    const lines: FolioLineItem[] = [
      {
        lineId: "line-1",
        department: "ROOM",
        description: "Deluxe Ocean View (2 nights)",
        quantity: 2,
        unitBaseLkr: 35000, // 70,000
      },
      {
        lineId: "line-2",
        department: "FNB",
        description: "Seafood BBQ Dinner for Two",
        quantity: 1,
        unitBaseLkr: 18500, // 18,500
      },
      {
        lineId: "line-3",
        department: "SPA",
        description: "Ayurvedic Herbal Treatment",
        quantity: 1,
        unitBaseLkr: 12000, // 12,000
      },
      {
        lineId: "line-4",
        department: "LAUNDRY",
        description: "Dry Cleaning 3 garments",
        quantity: 3,
        unitBaseLkr: 1500, // 4,500
      },
      {
        lineId: "line-5",
        department: "MINIBAR",
        description: "Artisan Sri Lankan Chocolates & Juices",
        quantity: 2,
        unitBaseLkr: 1250, // 2,500
      },
      {
        lineId: "line-6",
        department: "CORKAGE",
        description: "Wine bottle corkage fee",
        quantity: 1,
        unitBaseLkr: 3000, // 3,000
      },
    ];

    const result = aggregateFolioTaxes(lines, {
      tenantId: "galle-fort-hotel",
      folioId: "FOLIO-2024-001",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const folio = result.value;
    assert.equal(folio.tenantId, "galle-fort-hotel");
    assert.equal(folio.folioId, "FOLIO-2024-001");
    assert.equal(folio.totalLines, 6);
    assert.equal(folio.activeLines, 6);
    assert.equal(folio.voidedLines, 0);

    // Total base = 70,000 + 18,500 + 12,000 + 4,500 + 2,500 + 3,000 = 110,500.00
    assert.equal(folio.totalBaseLkr, 110500);
    assert.equal(folio.scEligibleBaseLkr, 110500);
    assert.equal(folio.scExemptBaseLkr, 0);

    // SC (10%) = 11,050.00
    assert.equal(folio.totalScLkr, 11050);

    // Subtotal after SC = 110,500 + 11,050 = 121,550.00
    assert.equal(folio.totalSubtotalAfterScLkr, 121550);

    // TDL (1%) = 1,215.50
    assert.equal(folio.totalTdlLkr, 1215.5);

    // SSCL (2.5%) = 3,038.75
    assert.equal(folio.totalSsclLkr, 3038.75);

    // VAT Base = 121,550 + 1,215.50 + 3,038.75 = 125,804.25
    assert.equal(folio.totalVatBaseLkr, 125804.25);

    // VAT (18%) = 125,804.25 * 0.18 = 22,644.77
    assert.equal(folio.totalVatLkr, 22644.77);

    // Grand total = 121,550 + 1,215.50 + 3,038.75 + 22,644.77 = 148,449.02
    assert.equal(folio.grandTotalLkr, 148449.02);

    // Invariant check: grandTotalLkr equals sum of subtotal + taxes
    const calculatedSum =
      folio.totalSubtotalAfterScLkr + folio.totalTdlLkr + folio.totalSsclLkr + folio.totalVatLkr;
    assert.equal(folio.grandTotalLkr, calculatedSum);

    // Departmental summaries
    assert.equal(folio.departmentSummaries.ROOM.baseLkr, 70000);
    assert.equal(folio.departmentSummaries.FNB.baseLkr, 18500);
    assert.equal(folio.departmentSummaries.SPA.baseLkr, 12000);
    assert.equal(folio.departmentSummaries.LAUNDRY.baseLkr, 4500);
    assert.equal(folio.departmentSummaries.MINIBAR.baseLkr, 2500);
    assert.equal(folio.departmentSummaries.CORKAGE.baseLkr, 3000);
    assert.equal(folio.departmentSummaries.EXCURSION.baseLkr, 0);
  });

  it("accurately handles Service Charge exempt lines (e.g., third-party safari & park permits)", () => {
    const lines: FolioLineItem[] = [
      {
        lineId: "line-room",
        department: "ROOM",
        description: "Yala Safari Luxury Tent",
        quantity: 1,
        unitBaseLkr: 40000,
        scExempt: false,
      },
      {
        lineId: "line-jeep",
        department: "EXCURSION",
        description: "3rd-Party 4x4 Safari Jeep Operator Payout",
        quantity: 1,
        unitBaseLkr: 25000,
        scExempt: true, // SC exempt payout
      },
      {
        lineId: "line-permit",
        department: "EXCURSION",
        description: "Department of Wildlife Conservation Entry Permit",
        quantity: 2,
        unitBaseLkr: 5000, // 10,000 total
        scExempt: true, // SC exempt government permit
      },
    ];

    const result = aggregateFolioTaxes(lines);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const folio = result.value;
    assert.equal(folio.totalBaseLkr, 75000); // 40k + 25k + 10k
    assert.equal(folio.scEligibleBaseLkr, 40000);
    assert.equal(folio.scExemptBaseLkr, 35000);

    // Service Charge only levied on 40,000 ROOM line (10% = 4,000)
    assert.equal(folio.totalScLkr, 4000);

    // Check individual line breakdowns
    const roomLine = folio.lineBreakdowns.find((l) => l.lineId === "line-room");
    assert.ok(roomLine);
    assert.equal(roomLine.scLkr, 4000);
    assert.equal(roomLine.subtotalAfterScLkr, 44000);

    const jeepLine = folio.lineBreakdowns.find((l) => l.lineId === "line-jeep");
    assert.ok(jeepLine);
    assert.equal(jeepLine.scLkr, 0);
    assert.equal(jeepLine.subtotalAfterScLkr, 25000);
    assert.equal(jeepLine.scExempt, true);

    const permitLine = folio.lineBreakdowns.find((l) => l.lineId === "line-permit");
    assert.ok(permitLine);
    assert.equal(permitLine.scLkr, 0);
    assert.equal(permitLine.subtotalAfterScLkr, 10000);
    assert.equal(permitLine.scExempt, true);

    // Subtotal after SC = 44,000 + 25,000 + 10,000 = 79,000
    assert.equal(folio.totalSubtotalAfterScLkr, 79000);
  });

  it("excludes voided lines from billable totals while tracking them in breakdown", () => {
    const lines: FolioLineItem[] = [
      {
        lineId: "line-1",
        department: "ROOM",
        description: "Room Charge",
        quantity: 1,
        unitBaseLkr: 20000,
      },
      {
        lineId: "line-2-void",
        department: "FNB",
        description: "Wrong Order - Voided Dish",
        quantity: 1,
        unitBaseLkr: 5000,
        isVoided: true,
      },
    ];

    const result = aggregateFolioTaxes(lines);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const folio = result.value;
    assert.equal(folio.totalLines, 2);
    assert.equal(folio.activeLines, 1);
    assert.equal(folio.voidedLines, 1);
    assert.equal(folio.totalBaseLkr, 20000);

    const voidedLine = folio.lineBreakdowns.find((l) => l.lineId === "line-2-void");
    assert.ok(voidedLine);
    assert.equal(voidedLine.isVoided, true);
    assert.equal(voidedLine.grandTotalLkr, 0);
  });

  it("computes taxes using custom tax presets (e.g., Small Guesthouse 0.5% TDL)", () => {
    const lines: FolioLineItem[] = [
      {
        lineId: "line-ella-1",
        department: "ROOM",
        description: "Ella Mountain View Double",
        quantity: 1,
        unitBaseLkr: 28500,
      },
    ];

    const smallGuesthousePreset = createTaxPreset("SMALL_GUESTHOUSE_05_TDL");
    const result = aggregateFolioTaxes(lines, { taxConfig: smallGuesthousePreset });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const folio = result.value;
    // Small guesthouse: No SC, 0.5% TDL, No SSCL, No VAT
    assert.equal(folio.totalBaseLkr, 28500);
    assert.equal(folio.totalScLkr, 0);
    assert.equal(folio.totalTdlLkr, 142.5);
    assert.equal(folio.totalSsclLkr, 0);
    assert.equal(folio.totalVatLkr, 0);
    assert.equal(folio.grandTotalLkr, 28642.5);
  });

  it("handles empty folios gracefully", () => {
    const result = aggregateFolioTaxes([]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.totalLines, 0);
    assert.equal(result.value.activeLines, 0);
    assert.equal(result.value.totalBaseLkr, 0);
    assert.equal(result.value.grandTotalLkr, 0);
    assert.equal(result.value.departmentSummaries.ROOM.lineCount, 0);
  });

  it("validates multi-tenant tenantId isolation", () => {
    const lines: FolioLineItem[] = [
      {
        lineId: "line-1",
        department: "ROOM",
        description: "Room",
        quantity: 1,
        unitBaseLkr: 10000,
      },
    ];

    const invalidResult = aggregateFolioTaxes(lines, { tenantId: "INVALID TENANT!" });
    assert.equal(invalidResult.ok, false);
    if (invalidResult.ok) return;
    assert.equal(invalidResult.error.code, "VALIDATION_FAILED");
  });

  it("rejects invalid line inputs with INVALID_FOLIO_LINE", () => {
    const invalidQty: FolioLineItem[] = [
      {
        lineId: "line-bad-qty",
        department: "ROOM",
        description: "Room",
        quantity: -1,
        unitBaseLkr: 10000,
      },
    ];
    const resQty = aggregateFolioTaxes(invalidQty);
    assert.equal(resQty.ok, false);
    if (!resQty.ok) {
      assert.equal(resQty.error.code, "INVALID_FOLIO_LINE");
    }

    const invalidPrice: FolioLineItem[] = [
      {
        lineId: "line-bad-price",
        department: "ROOM",
        description: "Room",
        quantity: 1,
        unitBaseLkr: -500,
      },
    ];
    const resPrice = aggregateFolioTaxes(invalidPrice);
    assert.equal(resPrice.ok, false);
    if (!resPrice.ok) {
      assert.equal(resPrice.error.code, "INVALID_FOLIO_LINE");
    }

    const missingId = [
      {
        lineId: "",
        department: "ROOM" as const,
        description: "Room",
        quantity: 1,
        unitBaseLkr: 1000,
      },
    ];
    const resMissingId = aggregateFolioTaxes(missingId);
    assert.equal(resMissingId.ok, false);
    if (!resMissingId.ok) {
      assert.equal(resMissingId.error.code, "INVALID_FOLIO_LINE");
    }
  });

  it("creates a cryptographically chained ImmutableAuditLog entry for folio calculation", () => {
    const lines: FolioLineItem[] = [
      {
        lineId: "line-101",
        department: "ROOM",
        description: "Villa Suite",
        quantity: 1,
        unitBaseLkr: 50000,
      },
    ];

    const aggRes = aggregateFolioTaxes(lines, {
      tenantId: "bentota-beach-resort",
      folioId: "FOLIO-999",
    });
    assert.equal(aggRes.ok, true);
    if (!aggRes.ok) return;

    const auditRes = createFolioTaxAuditEntry(
      "bentota-beach-resort",
      "user-cashier-04",
      "FOLIO-999",
      aggRes.value,
      "2026-10-18T10:00:00.000Z",
    );

    assert.equal(auditRes.ok, true);
    if (!auditRes.ok) return;

    const audit = auditRes.value;
    assert.equal(audit.tenantId, "bentota-beach-resort");
    assert.equal(audit.action, "AGGREGATE_FOLIO_TAXES");
    assert.equal(audit.entityType, "GuestFolio");
    assert.equal(audit.entityId, "FOLIO-999");
    assert.equal(audit.entryHash.length, 64);
  });
});
