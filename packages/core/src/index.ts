/**
 * @hms/core - Pure TypeScript Sri Lankan Hospitality & Multi-Tenant SaaS Domain Engine.
 *
 * Strict Architectural Guarantees:
 * 1. Zero external runtime npm dependencies (Node 22 standard library only).
 * 2. Explicit Result<T, DomainError> pattern for deterministic error propagation.
 * 3. 4-Stage compounding Sri Lankan tax mathematics (SC -> TDL -> SSCL -> VAT).
 * 4. SHA-256 hash-chained immutable audit log verification.
 */

export const CORE_VERSION = "1.0.0";

export * from "./result.js";
export * from "./auditChain.js";
export * from "./config.js";
export * from "./tax.js";
export * from "./folioMath.js";
export * from "./currencyLock.js";
export * from "./nicPassport.js";
export * from "./lankaQr.js";
export * from "./qrHmac.js";
export * from "./payhere.js";
export * from "./webxpay.js";
export * from "./channex.js";
export * from "./channexAri.js";
export * from "./sms.js";
export * from "./payroll.js";
export * from "./inventoryMath.js";
export * from "./rateQuote.js";
export * from "./availabilityFilter.js";
export * from "./dayUseRate.js";
export * from "./icalSync.js";
export * from "./promoOffer.js";
export * from "./splitFolioRouter.js";
export * from "./creditNote.js";
export * from "./menuSchedule.js";
export * from "./mealPlanPricing.js";
export * from "./catalogPresets.js";
export * from "./menuFiltering.js";
export * from "./orderIdempotency.js";
export * from "./orderSplitter.js";
export * from "./kdsMetrics.js";
export * from "./hkAssignment.js";
export * from "./roomDiscrepancy.js";
export * from "./hkTurnaround.js";
export * from "./banquetMath.js";
export {
  SRI_LANKA_TIMEZONE,
  SRI_LANKA_LOCALE,
  formatLkr,
  formatUsd,
  formatSlDate,
  formatSlDateTime,
  formatSlIsoDate,
} from "./format.js";
