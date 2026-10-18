/**
 * @hms/core - Sri Lankan Hospitality Statutory Tax Engine.
 *
 * Implements Inland Revenue Department (IRD) & Sri Lanka Tourism Development
 * Authority (SLTDA) 4-stage compounding statutory hotel tax mathematics:
 *
 * Stage 0: Base Supply (B) = Room / F&B / Spa / Extras
 * Stage 1: Service Charge (SC) = round(B * scRate) -> Subtotal A = B + SC
 * Stage 2: Tourism Development Levy (TDL) = round(A * tdlRate)
 * Stage 3: Social Security Contribution Levy (SSCL) = round(A * ssclRate)
 * Stage 4: Value Added Tax (VAT) = round((A + TDL + SSCL) * vatRate)
 * Grand Total (G) = Subtotal A + TDL + SSCL + VAT
 */
import { type DomainError, type Result, domainErr, ok } from "./result.js";
/**
 * Statutory configuration governing Sri Lankan hotel tax computations.
 */
export interface SriLankaTaxConfig {
  /** Governed by the Shop & Office Employees Act (typically 10.0%, 0.10). */
  readonly enableSC: boolean;
  readonly scRate: number;

  /** Governed by Tourism Act No. 38 of 2005 (1.0% standard, 0.5% small guesthouse). */
  readonly enableTDL: boolean;
  readonly tdlRate: number;

  /** Governed by SSCL Act No. 25 of 2022 (2.5%, 0.025 on post-SC subtotal). */
  readonly enableSSCL: boolean;
  readonly ssclRate: number;

  /** Value Added Tax Act No. 14 of 2002 as amended (18.0%, 0.18). */
  readonly enableVAT: boolean;
  readonly vatRate: number;
}

/**
 * Detailed line-by-line breakdown resulting from a 4-stage tax computation.
 */
export interface TaxBreakdownResult {
  /** Stage 0: Initial taxable base supply amount in Sri Lankan Rupees. */
  readonly baseLkr: number;

  /** Stage 1: 10% Service Charge distributed to the staff pool. */
  readonly scLkr: number;

  /** Subtotal A = baseLkr + scLkr (assessment base for TDL & SSCL). */
  readonly subtotalAfterScLkr: number;

  /** Stage 2: Tourism Development Levy (TDL) remitted to SLTDA. */
  readonly tdlLkr: number;

  /** Stage 3: Social Security Contribution Levy (SSCL) remitted to IRD. */
  readonly ssclLkr: number;

  /** Combined taxable base for VAT = subtotalAfterScLkr + tdlLkr + ssclLkr. */
  readonly vatBaseLkr: number;

  /** Stage 4: 18% Value Added Tax (VAT) remitted to IRD. */
  readonly vatLkr: number;

  /** Grand total payable in Sri Lankan Rupees = baseLkr + sc + tdl + sscl + vat. */
  readonly grandTotalLkr: number;

  /** Effective percentage loading above base supply: (grandTotalLkr - baseLkr) / baseLkr. */
  readonly effectiveTaxRate: number;

  /** Flag indicating whether VAT was levied on this transaction. */
  readonly isVatRegistered: boolean;
}

/**
 * Standard Sri Lankan statutory default configuration for full-service VAT hotels.
 */
export const DEFAULT_SRI_LANKA_TAX_CONFIG: SriLankaTaxConfig = {
  enableSC: true,
  scRate: 0.1,
  enableTDL: true,
  tdlRate: 0.01,
  enableSSCL: true,
  ssclRate: 0.025,
  enableVAT: true,
  vatRate: 0.18,
};

/**
 * Exact half-up rounding helper to two decimal places (integer cents)
 * using Number.EPSILON to eliminate IEEE 754 floating-point precision drift.
 *
 * @param value Number in Sri Lankan Rupees
 * @returns Rounded number with exactly 2 decimal precision
 */
export function roundLkr(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes forward 4-stage compounding Sri Lankan statutory hospitality taxes:
 *
 * Stage 1: Service Charge (SC) = roundLkr(baseLkr * scRate)
 * Subtotal A: subtotalAfterScLkr = baseLkr + scLkr
 * Stage 2: Tourism Development Levy (TDL) = roundLkr(subtotalAfterScLkr * tdlRate)
 * Stage 3: Social Security Contribution Levy (SSCL) = roundLkr(subtotalAfterScLkr * ssclRate)
 * VAT Base: vatBaseLkr = subtotalAfterScLkr + tdlLkr + ssclLkr
 * Stage 4: Value Added Tax (VAT) = roundLkr(vatBaseLkr * vatRate)
 * Grand Total: grandTotalLkr = subtotalAfterScLkr + tdlLkr + ssclLkr + vatLkr
 *
 * @param baseLkr Base supply amount in Sri Lankan Rupees
 * @param config Statutory tax configuration
 * @returns Result containing detailed TaxBreakdownResult or DomainError
 */
export function calculateForwardTax(
  baseLkr: number,
  config: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
): Result<TaxBreakdownResult, DomainError> {
  if (!Number.isFinite(baseLkr) || baseLkr < 0) {
    return domainErr(
      "INVALID_TAX_BASE",
      "Base taxable supply amount must be a non-negative finite number",
      { baseLkr },
    );
  }

  const base = roundLkr(baseLkr);
  const scLkr = config.enableSC ? roundLkr(base * config.scRate) : 0;
  const subtotalAfterScLkr = roundLkr(base + scLkr);
  const tdlLkr = config.enableTDL ? roundLkr(subtotalAfterScLkr * config.tdlRate) : 0;
  const ssclLkr = config.enableSSCL ? roundLkr(subtotalAfterScLkr * config.ssclRate) : 0;
  const vatBaseLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr);
  const vatLkr = config.enableVAT ? roundLkr(vatBaseLkr * config.vatRate) : 0;
  const grandTotalLkr = roundLkr(subtotalAfterScLkr + tdlLkr + ssclLkr + vatLkr);
  const effectiveTaxRate = base > 0 ? roundLkr((grandTotalLkr - base) / base) : 0;

  return ok({
    baseLkr: base,
    scLkr,
    subtotalAfterScLkr,
    tdlLkr,
    ssclLkr,
    vatBaseLkr,
    vatLkr,
    grandTotalLkr,
    effectiveTaxRate,
    isVatRegistered: config.enableVAT,
  });
}

/**
 * Standard Sri Lankan statutory tax profile presets.
 */
export type SriLankaTaxPreset =
  | "LUXURY_VAT_HOTEL"
  | "BOUTIQUE_NON_VAT"
  | "SMALL_GUESTHOUSE_05_TDL"
  | "TAX_EXEMPT";

/**
 * Generates an immutable SriLankaTaxConfig based on standard statutory profiles.
 *
 * - LUXURY_VAT_HOTEL: Full 4-stage compounding (10% SC, 1% TDL, 2.5% SSCL, 18% VAT).
 * - BOUTIQUE_NON_VAT: Below IRD VAT threshold (10% SC, 1% TDL, zero SSCL/VAT).
 * - SMALL_GUESTHOUSE_05_TDL: SLTDA small operator under LKR 12M annual turnover (0.5% TDL, zero SC/SSCL/VAT).
 * - TAX_EXEMPT: Zero taxes and zero service charges across all stages.
 *
 * @param preset Statutory preset profile name
 * @returns SriLankaTaxConfig configured to official statutory rates
 */
export function createTaxPreset(preset: SriLankaTaxPreset): SriLankaTaxConfig {
  switch (preset) {
    case "LUXURY_VAT_HOTEL":
      return {
        enableSC: true,
        scRate: 0.1,
        enableTDL: true,
        tdlRate: 0.01,
        enableSSCL: true,
        ssclRate: 0.025,
        enableVAT: true,
        vatRate: 0.18,
      };
    case "BOUTIQUE_NON_VAT":
      return {
        enableSC: true,
        scRate: 0.1,
        enableTDL: true,
        tdlRate: 0.01,
        enableSSCL: false,
        ssclRate: 0,
        enableVAT: false,
        vatRate: 0,
      };
    case "SMALL_GUESTHOUSE_05_TDL":
      return {
        enableSC: false,
        scRate: 0,
        enableTDL: true,
        tdlRate: 0.005,
        enableSSCL: false,
        ssclRate: 0,
        enableVAT: false,
        vatRate: 0,
      };
    case "TAX_EXEMPT":
      return {
        enableSC: false,
        scRate: 0,
        enableTDL: false,
        tdlRate: 0,
        enableSSCL: false,
        ssclRate: 0,
        enableVAT: false,
        vatRate: 0,
      };
  }
}

/**
 * Derives net base supply and itemized statutory taxes from an all-inclusive gross quotation
 * (such as OTA or tour operator contracted rates).
 *
 * Uses the exact reciprocal multiplier:
 * m = (1 + sc) * (1 + tdl + sscl) * (1 + vat)
 * base = roundLkr(grossInclusiveLkr / m)
 *
 * Runs calculateForwardTax(base) and reconciles any cent/rupee rounding residual
 * (grossInclusiveLkr - sum) on the VAT line (when VAT is enabled) or baseLkr (when VAT is off)
 * so printed folio line items sum exactly to the contracted gross amount.
 *
 * @param grossInclusiveLkr Total contracted all-inclusive amount in Sri Lankan Rupees
 * @param config Statutory tax configuration
 * @returns Result containing detailed TaxBreakdownResult or DomainError
 */
function getReciprocalMultiplier(config: SriLankaTaxConfig): number {
  const scRate = config.enableSC ? config.scRate : 0;
  const tdlRate = config.enableTDL ? config.tdlRate : 0;
  const ssclRate = config.enableSSCL ? config.ssclRate : 0;
  const vatRate = config.enableVAT ? config.vatRate : 0;
  return (1 + scRate) * (1 + tdlRate + ssclRate) * (1 + vatRate);
}

function reconcileVatResidual(fwd: TaxBreakdownResult, residual: number): TaxBreakdownResult {
  const adjustedVatLkr = roundLkr(fwd.vatLkr + residual);
  const adjustedGrandTotalLkr = roundLkr(
    fwd.subtotalAfterScLkr + fwd.tdlLkr + fwd.ssclLkr + adjustedVatLkr,
  );
  const effectiveTaxRate =
    fwd.baseLkr > 0 ? roundLkr((adjustedGrandTotalLkr - fwd.baseLkr) / fwd.baseLkr) : 0;

  return {
    ...fwd,
    vatLkr: adjustedVatLkr,
    grandTotalLkr: adjustedGrandTotalLkr,
    effectiveTaxRate,
  };
}

/**
 * Derives net base supply and itemized statutory taxes from an all-inclusive gross quotation
 * (such as OTA or tour operator contracted rates).
 *
 * Uses the exact reciprocal multiplier:
 * m = (1 + sc) * (1 + tdl + sscl) * (1 + vat)
 * base = roundLkr(grossInclusiveLkr / m)
 *
 * Runs calculateForwardTax(base) and reconciles any cent/rupee rounding residual
 * (grossInclusiveLkr - sum) on the VAT line (when VAT is enabled) or baseLkr (when VAT is off)
 * so printed folio line items sum exactly to the contracted gross amount.
 *
 * @param grossInclusiveLkr Total contracted all-inclusive amount in Sri Lankan Rupees
 * @param config Statutory tax configuration
 * @returns Result containing detailed TaxBreakdownResult or DomainError
 */
export function calculateReverseTax(
  grossInclusiveLkr: number,
  config: SriLankaTaxConfig = DEFAULT_SRI_LANKA_TAX_CONFIG,
): Result<TaxBreakdownResult, DomainError> {
  if (!Number.isFinite(grossInclusiveLkr) || grossInclusiveLkr < 0) {
    return domainErr(
      "INVALID_TAX_BASE",
      "Gross all-inclusive amount must be a non-negative finite number",
      { grossInclusiveLkr },
    );
  }

  const gross = roundLkr(grossInclusiveLkr);
  if (gross === 0) {
    return calculateForwardTax(0, config);
  }

  const m = getReciprocalMultiplier(config);
  if (m <= 0) {
    return domainErr("VALIDATION_FAILED", "Invalid tax multiplier", { m });
  }

  const baseLkr = roundLkr(gross / m);
  const forwardRes = calculateForwardTax(baseLkr, config);
  if (!forwardRes.ok) {
    return forwardRes;
  }

  const fwd = forwardRes.value;
  const residual = roundLkr(gross - fwd.grandTotalLkr);
  if (residual === 0) {
    return ok(fwd);
  }

  if (config.enableVAT) {
    return ok(reconcileVatResidual(fwd, residual));
  }

  const adjustedBase = roundLkr(fwd.baseLkr + residual);
  return calculateForwardTax(adjustedBase, config);
}
