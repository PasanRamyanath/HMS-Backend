/**
 * @hms/core - Sri Lankan Wedding & Banquet Pricing Calculator (banquetMath.ts)
 *
 * Implements Step 326 (Phase 14.01) / Rung 6 of the Sri Lanka HMS Master Architecture Plan:
 * Comprehensive pricing, quotation, and deposit scheduling engine tailored to
 * Sri Lankan hotel weddings, homecoming receptions, and corporate banquets:
 *
 * 1. Guaranteed Pax & Extra Pax Overflow calculations
 * 2. Tiered Menu Plate Rates (Bronze, Silver, Gold, Platinum, Custom)
 * 3. Both Tax-Inclusive Nett per-plate quotes & Tax-Exclusive corporate packages
 * 4. Devilled Sri Lankan 'Bite Plates' per table (Cashew, Cuttlefish, Mutton, Pork)
 * 5. Hard-Liquor Corkage & Chasers (Waived, Per-Bottle, Per-Pax, Fixed Hall Fee)
 * 6. Hall Hire & AC Overtime hourly rates beyond standard included package hours
 * 7. Traditional Ceremony Add-Ons (Poruwa Setup, Kandyan Dancers, Ashtaka, Oil Lamp)
 * 8. Staged Advance Deposit Schedule (Booking 20%, 2nd Advance 30%, Final 50%)
 * 9. IRD & SLTDA 4-Stage Statutory Tax Compounding (SC 10% -> TDL 1% -> SSCL 2.5% -> VAT 18%)
 * 10. Multi-Tenant SaaS Isolation & SHA-256 Hash-Chained Immutable Audit Trail
 */

import { type AuditLogEntry, createAuditEntry } from "./auditChain.js";
import { type DomainError, type Result, domainErr, ok } from "./result.js";
import {
  DEFAULT_SRI_LANKA_TAX_CONFIG,
  type SriLankaTaxConfig,
  type TaxBreakdownResult,
  calculateForwardTax,
  calculateReverseTax,
  roundLkr,
} from "./tax.js";

// ============================================================================
// Types & Domain Models
// ============================================================================

export type BanquetPricingModel = "TAX_INCLUSIVE_NETT" | "TAX_EXCLUSIVE";

export type BanquetPackageTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "CUSTOM";

export type CorkagePolicy = "WAIVED" | "PER_BOTTLE" | "PER_PAX_FLAT" | "FIXED_HALL_FEE";

export interface BanquetActor {
  readonly userId: string;
  readonly role: string;
  readonly tenantId: string;
}

export const BANQUET_AUTHORIZED_ROLES: readonly string[] = [
  "ADMIN",
  "GENERAL_MANAGER",
  "DUTY_MANAGER",
  "FRONT_DESK",
  "BANQUET_SALES_MANAGER",
  "SALES_COORDINATOR",
  "FOOD_AND_BEVERAGE_MANAGER",
  "OWNER",
];

export interface BitePlateItem {
  readonly itemId: string;
  readonly name: string;
  readonly unitPriceLkr: number;
  readonly quantity: number;
}

export interface CorkageConfig {
  readonly policy: CorkagePolicy;
  readonly bottleCount?: number | undefined;
  readonly ratePerBottleLkr?: number | undefined;
  readonly ratePerPaxLkr?: number | undefined;
  readonly fixedFeeLkr?: number | undefined;
  readonly chasersCostLkr?: number | undefined;
}

export interface HallHireConfig {
  readonly baseHallHireLkr?: number | undefined;
  readonly includedAcHours?: number | undefined;
  readonly actualHours?: number | undefined;
  readonly overtimeHourlyRateLkr?: number | undefined;
}

export interface TraditionalCeremonyAddOns {
  readonly poruwaSetupLkr?: number | undefined;
  readonly traditionalDancersLkr?: number | undefined;
  readonly ashtakaJayamangalaLkr?: number | undefined;
  readonly oilLampAndDecorLkr?: number | undefined;
  readonly djBandSoundLkr?: number | undefined;
}

export interface DepositScheduleRule {
  readonly bookingAdvancePct: number;
  readonly secondAdvancePct: number;
  readonly finalSettlementPct: number;
}

export const DEFAULT_DEPOSIT_SCHEDULE_RULE: DepositScheduleRule = {
  bookingAdvancePct: 20,
  secondAdvancePct: 30,
  finalSettlementPct: 50,
};

export interface DepositStage {
  readonly stageNumber: number;
  readonly stageName: string;
  readonly percentage: number;
  readonly amountLkr: number;
  readonly dueDateDescription: string;
}

export interface BanquetQuoteInput {
  readonly quoteId: string;
  readonly tenantId: string;
  readonly eventName: string;
  readonly eventDateIso: string;
  readonly hallName: string;
  readonly pricingModel: BanquetPricingModel;
  readonly packageTier: BanquetPackageTier;
  readonly guaranteedPax: number;
  readonly plateRateLkr: number;
  readonly extraPaxCount?: number | undefined;
  readonly extraPaxRateLkr?: number | undefined;
  readonly bitePlates?: readonly BitePlateItem[] | undefined;
  readonly corkage?: CorkageConfig | undefined;
  readonly hallHire?: HallHireConfig | undefined;
  readonly ceremonyAddOns?: TraditionalCeremonyAddOns | undefined;
  readonly depositRule?: DepositScheduleRule | undefined;
  readonly taxConfig?: SriLankaTaxConfig | undefined;
}

export interface BanquetQuoteResult {
  readonly quoteId: string;
  readonly tenantId: string;
  readonly eventName: string;
  readonly eventDateIso: string;
  readonly hallName: string;
  readonly pricingModel: BanquetPricingModel;
  readonly packageTier: BanquetPackageTier;
  readonly guaranteedPax: number;
  readonly extraPaxCount: number;
  readonly totalPax: number;

  readonly plateChargesLkr: number;
  readonly extraPaxChargesLkr: number;
  readonly totalFoodLkr: number;

  readonly bitePlatesTotalLkr: number;
  readonly corkageTotalLkr: number;
  readonly chasersTotalLkr: number;
  readonly hallHireBaseLkr: number;
  readonly overtimeHours: number;
  readonly overtimeCostLkr: number;
  readonly ceremonyAddOnsTotalLkr: number;

  readonly totalBaseSupplyLkr: number;
  readonly scLkr: number;
  readonly subtotalAfterScLkr: number;
  readonly tdlLkr: number;
  readonly ssclLkr: number;
  readonly vatBaseLkr: number;
  readonly vatLkr: number;
  readonly grandTotalLkr: number;

  readonly effectivePerPaxLkr: number;
  readonly depositSchedule: readonly DepositStage[];
  readonly auditEntry: AuditLogEntry;
}

// ============================================================================
// Internal Calculation Helpers
// ============================================================================

function computeBitePlatesTotal(items?: readonly BitePlateItem[]): number {
  if (!items || items.length === 0) return 0;
  let total = 0;
  for (const item of items) {
    if (item.unitPriceLkr > 0 && item.quantity > 0) {
      total += item.unitPriceLkr * item.quantity;
    }
  }
  return roundLkr(total);
}

function computeCorkageAmount(corkage: CorkageConfig | undefined, totalPax: number): number {
  if (!corkage) return 0;
  switch (corkage.policy) {
    case "WAIVED":
      return 0;
    case "PER_BOTTLE": {
      const bottles = Math.max(0, corkage.bottleCount ?? 0);
      const rate = Math.max(0, corkage.ratePerBottleLkr ?? 0);
      return roundLkr(bottles * rate);
    }
    case "PER_PAX_FLAT": {
      const rate = Math.max(0, corkage.ratePerPaxLkr ?? 0);
      return roundLkr(totalPax * rate);
    }
    case "FIXED_HALL_FEE":
      return roundLkr(Math.max(0, corkage.fixedFeeLkr ?? 0));
  }
}

function computeOvertimeCost(hallHire: HallHireConfig | undefined): {
  overtimeHours: number;
  overtimeCostLkr: number;
} {
  if (!hallHire) return { overtimeHours: 0, overtimeCostLkr: 0 };
  const includedHours = Math.max(0, hallHire.includedAcHours ?? 7);
  const actualHours = Math.max(0, hallHire.actualHours ?? includedHours);
  const overtimeHours = Math.max(0, roundLkr(actualHours - includedHours));
  const rate = Math.max(0, hallHire.overtimeHourlyRateLkr ?? 0);
  const overtimeCostLkr = roundLkr(overtimeHours * rate);
  return { overtimeHours, overtimeCostLkr };
}

function computeCeremonyAddOnsTotal(ceremony?: TraditionalCeremonyAddOns): number {
  if (!ceremony) return 0;
  const poruwa = Math.max(0, ceremony.poruwaSetupLkr ?? 0);
  const dancers = Math.max(0, ceremony.traditionalDancersLkr ?? 0);
  const ashtaka = Math.max(0, ceremony.ashtakaJayamangalaLkr ?? 0);
  const decor = Math.max(0, ceremony.oilLampAndDecorLkr ?? 0);
  const sound = Math.max(0, ceremony.djBandSoundLkr ?? 0);
  return roundLkr(poruwa + dancers + ashtaka + decor + sound);
}

function buildDepositSchedule(
  grandTotalLkr: number,
  rule: DepositScheduleRule = DEFAULT_DEPOSIT_SCHEDULE_RULE,
): readonly DepositStage[] {
  const stage1Amount = roundLkr((grandTotalLkr * rule.bookingAdvancePct) / 100);
  const stage2Amount = roundLkr((grandTotalLkr * rule.secondAdvancePct) / 100);
  const stage3Amount = roundLkr(grandTotalLkr - stage1Amount - stage2Amount);

  return [
    {
      stageNumber: 1,
      stageName: "Booking Advance (Confirmation)",
      percentage: rule.bookingAdvancePct,
      amountLkr: stage1Amount,
      dueDateDescription: "Due immediately upon booking date reservation",
    },
    {
      stageNumber: 2,
      stageName: "Second Advance (Menu & Setup Lock)",
      percentage: rule.secondAdvancePct,
      amountLkr: stage2Amount,
      dueDateDescription: "Due 30 days prior to event date",
    },
    {
      stageNumber: 3,
      stageName: "Final Settlement",
      percentage: rule.finalSettlementPct,
      amountLkr: stage3Amount,
      dueDateDescription: "Due on or before event date",
    },
  ];
}

function validateQuoteInput(
  input: BanquetQuoteInput,
  actor: BanquetActor,
): Result<true, DomainError> {
  if (actor.tenantId !== input.tenantId) {
    return domainErr(
      "TENANT_MISMATCH",
      `Actor tenant ${actor.tenantId} does not match quote tenant ${input.tenantId}.`,
    );
  }

  if (!BANQUET_AUTHORIZED_ROLES.includes(actor.role)) {
    return domainErr(
      "PERMISSION_DENIED",
      `Role ${actor.role} is not authorized to generate banquet quotes.`,
    );
  }

  if (input.guaranteedPax < 1) {
    return domainErr(
      "VALIDATION_FAILED",
      "Guaranteed pax must be at least 1 guest for banquet reservation.",
    );
  }

  if (input.plateRateLkr < 0) {
    return domainErr("VALIDATION_FAILED", "Plate rate cannot be negative.");
  }

  if ((input.extraPaxCount ?? 0) < 0) {
    return domainErr("VALIDATION_FAILED", "Extra pax overflow count cannot be negative.");
  }

  const depositRule = input.depositRule ?? DEFAULT_DEPOSIT_SCHEDULE_RULE;
  const pctSum =
    depositRule.bookingAdvancePct + depositRule.secondAdvancePct + depositRule.finalSettlementPct;
  if (roundLkr(pctSum) !== 100) {
    return domainErr(
      "VALIDATION_FAILED",
      `Deposit schedule percentages must sum to 100%. Received ${pctSum}%.`,
    );
  }

  return ok(true);
}

function computeFoodCharges(
  guaranteedPax: number,
  plateRateLkr: number,
  extraPax: number,
  extraPaxRateLkr?: number,
): { plateCharges: number; extraPaxCharges: number; totalFoodCharges: number } {
  const extraRate = extraPaxRateLkr ?? plateRateLkr;
  const plateCharges = roundLkr(guaranteedPax * plateRateLkr);
  const extraPaxCharges = roundLkr(extraPax * extraRate);
  const totalFoodCharges = roundLkr(plateCharges + extraPaxCharges);
  return { plateCharges, extraPaxCharges, totalFoodCharges };
}

function resolveQuoteTaxes(
  rawSum: number,
  pricingModel: BanquetPricingModel,
  taxConfig: SriLankaTaxConfig,
): Result<TaxBreakdownResult, DomainError> {
  if (pricingModel === "TAX_INCLUSIVE_NETT") {
    return calculateReverseTax(rawSum, taxConfig);
  }
  return calculateForwardTax(rawSum, taxConfig);
}

// ============================================================================
// Main Domain Export: calculateBanquetQuote
// ============================================================================

/**
 * Calculates a complete, auditable wedding and banquet quote adhering to
 * Sri Lankan statutory tax compounding, staged advance deposits, and extra pax overflow.
 */
export function calculateBanquetQuote(
  input: BanquetQuoteInput,
  actor: BanquetActor,
  isoTs: string,
  prevHash: string,
): Result<BanquetQuoteResult, DomainError> {
  const validationRes = validateQuoteInput(input, actor);
  if (!validationRes.ok) return validationRes;

  const extraPax = Math.max(0, input.extraPaxCount ?? 0);
  const totalPax = input.guaranteedPax + extraPax;

  const { plateCharges, extraPaxCharges, totalFoodCharges } = computeFoodCharges(
    input.guaranteedPax,
    input.plateRateLkr,
    extraPax,
    input.extraPaxRateLkr,
  );

  const bitePlatesTotal = computeBitePlatesTotal(input.bitePlates);
  const corkageTotal = computeCorkageAmount(input.corkage, totalPax);
  const chasersTotal = roundLkr(Math.max(0, input.corkage?.chasersCostLkr ?? 0));
  const hallHireBase = roundLkr(Math.max(0, input.hallHire?.baseHallHireLkr ?? 0));
  const { overtimeHours, overtimeCostLkr } = computeOvertimeCost(input.hallHire);
  const ceremonyAddOnsTotal = computeCeremonyAddOnsTotal(input.ceremonyAddOns);

  const rawSum = roundLkr(
    totalFoodCharges +
      bitePlatesTotal +
      corkageTotal +
      chasersTotal +
      hallHireBase +
      overtimeCostLkr +
      ceremonyAddOnsTotal,
  );

  const taxConfig = input.taxConfig ?? DEFAULT_SRI_LANKA_TAX_CONFIG;
  const taxRes = resolveQuoteTaxes(rawSum, input.pricingModel, taxConfig);
  if (!taxRes.ok) return taxRes;
  const taxBreakdown = taxRes.value;

  const effectivePerPax = totalPax > 0 ? roundLkr(taxBreakdown.grandTotalLkr / totalPax) : 0;
  const depositSchedule = buildDepositSchedule(
    taxBreakdown.grandTotalLkr,
    input.depositRule ?? DEFAULT_DEPOSIT_SCHEDULE_RULE,
  );

  const auditRes = createAuditEntry({
    tenantId: input.tenantId,
    actorUserId: actor.userId,
    action: "BANQUET_QUOTE_GENERATED",
    entityType: "BanquetQuote",
    entityId: input.quoteId,
    isoTs,
    prevHash,
    afterJson: JSON.stringify({
      quoteId: input.quoteId,
      eventName: input.eventName,
      eventDateIso: input.eventDateIso,
      hallName: input.hallName,
      pricingModel: input.pricingModel,
      packageTier: input.packageTier,
      guaranteedPax: input.guaranteedPax,
      extraPaxCount: extraPax,
      totalPax,
      totalBaseSupplyLkr: taxBreakdown.baseLkr,
      scLkr: taxBreakdown.scLkr,
      tdlLkr: taxBreakdown.tdlLkr,
      ssclLkr: taxBreakdown.ssclLkr,
      vatLkr: taxBreakdown.vatLkr,
      grandTotalLkr: taxBreakdown.grandTotalLkr,
      effectivePerPaxLkr: effectivePerPax,
    }),
  });
  if (!auditRes.ok) return auditRes;

  return ok({
    quoteId: input.quoteId,
    tenantId: input.tenantId,
    eventName: input.eventName,
    eventDateIso: input.eventDateIso,
    hallName: input.hallName,
    pricingModel: input.pricingModel,
    packageTier: input.packageTier,
    guaranteedPax: input.guaranteedPax,
    extraPaxCount: extraPax,
    totalPax,
    plateChargesLkr: plateCharges,
    extraPaxChargesLkr: extraPaxCharges,
    totalFoodLkr: totalFoodCharges,
    bitePlatesTotalLkr: bitePlatesTotal,
    corkageTotalLkr: corkageTotal,
    chasersTotalLkr: chasersTotal,
    hallHireBaseLkr: hallHireBase,
    overtimeHours,
    overtimeCostLkr,
    ceremonyAddOnsTotalLkr: ceremonyAddOnsTotal,
    totalBaseSupplyLkr: taxBreakdown.baseLkr,
    scLkr: taxBreakdown.scLkr,
    subtotalAfterScLkr: taxBreakdown.subtotalAfterScLkr,
    tdlLkr: taxBreakdown.tdlLkr,
    ssclLkr: taxBreakdown.ssclLkr,
    vatBaseLkr: taxBreakdown.vatBaseLkr,
    vatLkr: taxBreakdown.vatLkr,
    grandTotalLkr: taxBreakdown.grandTotalLkr,
    effectivePerPaxLkr: effectivePerPax,
    depositSchedule,
    auditEntry: auditRes.value,
  });
}
