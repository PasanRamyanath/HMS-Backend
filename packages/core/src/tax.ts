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
