# HMS-Backend — Live Step Progress Tracker

This file tracks the sequential completion of backend implementation steps defined in the master plan (`/workspaces/Sri-Lanka--HMS/plan.md`).

## Phase 01: GitHub Codespaces 3-Repo Bootstrap & Quality Gates
- [x] Step 001: Clone `HMS-Backend` & `HMS-Frontend` First Inside Codespace
- [x] Step 002: Configure `.devcontainer/devcontainer.json` & bootstrap script
- [x] Step 003: Install Ponytail & Addy Osmani's agent-skills plugins in AGY CLI
- [x] Step 004: Install Apple HIG & UI/UX skills in AGY CLI
- [x] Step 005: Author `.antigravity/rules.md` & `AGENTS.md`
- [x] Step 006: Initialize Live Step Checkbox Trackers (`PROGRESS.md`) & `.gitignore`
- [x] Step 007: Configure Strict Anti-Noise `biome.json`
- [x] Step 008: Configure `knip.json` Pruner
- [x] Step 009: Configure `lefthook.yml` Quality Gates
- [x] Step 010: Pin Node.js 22 LTS (`.nvmrc`) & Author `package.json` Workspaces + `tsconfig.base.json`
- [x] Step 011: Scaffold `packages/core` Pure Domain Package
- [x] Step 012: Implement Explicit `Result<T, E>` & Error Catalog
- [x] Step 013: Implement SHA-256 Hash-Chained `ImmutableAuditLog` Engine
- [x] Step 014: Scaffold `packages/graphql` for 42-Entity Schema
- [x] Step 015: Scaffold `packages/cdk` Near-Free-Tier Stack
- [x] Step 016: Author AWS IAM GitHub OIDC Stack (`packages/cdk/lib/github-oidc-stack.ts`)
- [x] Step 017: Author Independent Backend GitHub Actions CI/CD Workflow (`.github/workflows/deploy-backend.yml`)
- [x] Step 018: Scaffold `HMS-Frontend` for React 19 + Tailwind CSS v4 + Apple HIG
- [x] Step 019: Author Independent Frontend GitHub Actions CI/CD Workflow (`HMS-Frontend/.github/workflows/deploy-frontend.yml`)
- [x] Step 020: Create Cross-Repo GraphQL Contract Sync Script (`scripts/sync-contracts.sh`)
- [x] Step 021: Implement Shared Sri Lankan Currency & `Asia/Colombo` Date Helpers (`format.ts`)
- [x] Step 022: Implement Runtime Tenant, Mobile, SLTDA & IRD Validators (`config.ts`)
- [x] Step 023: Write CloudFormation Permanent Free-Tier Cost-Ceiling Guardrail Test (`cost-guardrails.test.ts`)
- [x] Step 024: Author Master Architecture Decision Record (`docs/adr-001-codespaces-saas-apple-hig.md`)
- [x] Step 025: Create & Execute Master 3-Repo Verification Gate (`scripts/verify-all-repos.sh`)

## Phase 02: Sri Lankan Statutory Tax, NIC/Passport, LankaQR & Payment Crypto Engine
- [x] Step 026: Define Tax Configuration & Breakdown Types (`tax.ts`)
- [x] Step 027: Implement Exact Half-Up Rupee & Cent Rounding Helper `roundLkr`
- [x] Step 028: Implement Forward 4-Stage Compounding Tax Calculation (`calculateForwardTax`)
- [x] Step 029: Implement Small Guest House Tier Support (`createTaxPreset`)
- [x] Step 030: Implement Reverse All-Inclusive Gross-to-Net Derivation (`calculateReverseTax`)
- [x] Step 031: Write Exhaustive IRD/SLTDA Tax Test Vectors
- [x] Step 032: Implement Multi-Line Folio Tax Aggregator (`folioMath.ts`)
- [x] Step 033: Implement Foreign Currency to `LKR` Invoice Lock Converter (`currencyLock.ts`)
- [x] Step 034: Implement Sri Lankan NIC Parser (`nicPassport.ts`)
- [x] Step 035: Implement Foreign Passport & Tourist Police B-Card Validator (`nicPassport.ts`)
- [x] Step 036: Write Unit Tests for Sri Lankan NIC & Passport Extraction (`nicPassport.test.ts`)
- [x] Step 037: Implement CRC-16/CCITT-FALSE Checksum Function for LankaQR (`lankaQr.ts`)
- [x] Step 038: Implement LankaQR EMVCo MPM Payload Generator (`lankaQr.ts`)
- [x] Step 039: Write Verification Tests for LankaQR EMVCo Vectors (`lankaQr.test.ts`)
- [x] Step 040: Implement Room & Table QR HMAC-SHA256 Session Token Signer (`qrHmac.ts`)
- [x] Step 041: Implement Constant-Time QR Session Token Verifier (`qrHmac.ts`)
- [x] Step 042: Implement PayHere Checkout Hash Generator (`payhere.ts`)
- [x] Step 043: Implement PayHere `notify_url` Webhook Signature Verifier (`payhere.ts`)
- [x] Step 044: Implement WebXPay Subscription & Payment Callback Verifier (`webxpay.ts`)
- [x] Step 045: Implement Channex.io Raw-Body HMAC-SHA256 Webhook Verifier (`channex.ts`)
- [x] Step 046: Implement SMSGo.lk Webhook Signature Verifier & Phone Normalizer (`sms.ts`)
- [x] Step 047: Implement Sri Lankan 10% Service Charge Pool & Breakage Deduction Engine (`payroll.ts`)
- [x] Step 048: Implement Sri Lankan EPF (`8%` Employee / `12%` Employer) & ETF (`3%` Employer) Calculator (`payroll.ts`)
- [x] Step 049: Implement FIFO Inventory Batch Deduction & Recipe BOM Costing Engine (`inventoryMath.ts`)
- [x] Step 050: Export All Pure Domain Modules & Run Phase 2 Ponytail Audit (`index.ts`)

## Phase 03: 42-Entity Multi-Tenant SaaS GraphQL Schema & Direct AppSync JS Resolvers
- [x] Step 051: Author Base Scalars, Directives & Enums in `packages/graphql/schema.graphql`
- [x] Step 052: Define Multi-Tenant `HotelTenant` & `TaxConfig` GraphQL Types (`schema.graphql`)
- [x] Step 053: Define `RoomType`, `Room`, and `DriverDormBed` GraphQL Types (`schema.graphql`)
- [x] Step 054: Define `Reservation`, `DriverAccommodation`, and `GroupBooking` GraphQL Types (`schema.graphql`)
- [x] Step 055: Define `Folio`, `FolioLineItem`, and `FolioInvoice` GraphQL Types (`schema.graphql`)
- [x] Step 056: Define DOMSpeed-Compatible `MenuCategory`, `MenuItem`, and `ModifierOption` Types (`schema.graphql`)
- [x] Step 057: Define `ServiceOrder` & Real-Time KDS / Room Service Mutation Types (`schema.graphql`)
- [x] Step 058: Define `BanquetEvent` (Sri Lankan Wedding / Function BEO) GraphQL Types (`schema.graphql`)
- [x] Step 059: Define `ExcursionBooking` & `AyurvedaAppointment` GraphQL Types (`schema.graphql`)
- [x] Step 060: Define Store Inventory (`StockItem`, `InventoryVoucher`, `PurchaseOrder`) GraphQL Types (`schema.graphql`)
- [x] Step 061: Define `NightAuditReport`, `SltdaMonthlyReturn`, and `StaffScPoolStatement` Types (`schema.graphql`)
- [x] Step 062: Define Root `Query`, `Mutation`, and Real-Time `Subscription` Operations (`schema.graphql`)
- [x] Step 063: Configure `@graphql-codegen/cli` in `packages/graphql/codegen.ts` (`codegen.ts`)
- [x] Step 064: Create Shared AppSync JS Tenant Isolation Helper (`resolvers/tenantGuard.ts`)
- [x] Step 065: Implement AppSync JS Resolver: `Query.getHotelTenant` & `Mutation.upsertHotelTenant` (`resolvers/hotelTenant.ts`)
- [x] Step 066: Implement AppSync JS Resolver: `Query.listRooms` & `Mutation.updateRoomHousekeepingStatus` (`resolvers/rooms.ts`)
- [x] Step 067: Implement AppSync JS Resolver: `Query.listMenuCatalog` (Categories + Items in 1 Query) (`resolvers/menuCatalog.ts`)
- [x] Step 068: Implement AppSync JS Resolver: `Mutation.upsertMenuItem` & `Mutation.toggleMenuItemStock` (`resolvers/menuMutations.ts`)
- [x] Step 069: Implement AppSync JS Resolver: `Query.listActiveOrdersByDepartment` (KDS Kanban Query) (`resolvers/kdsOrders.ts`)
- [x] Step 070: Implement AppSync JS Resolver: `Mutation.updateServiceOrderStatus` (Real-Time KDS Transition) (`resolvers/updateOrderStatus.ts`)
- [x] Step 071: Implement AppSync JS Resolver: `Query.listReservationsByDateRange` (Tape Chart Query) (`resolvers/reservationsQuery.ts`)
- [x] Step 072: Implement AppSync JS Resolver: `Query.getFolioWithLines` (Single-Query Folio Fetch) (`resolvers/folioQuery.ts`)
- [x] Step 073: Implement AppSync JS Resolver: `Query.listBanquetEvents` & `Mutation.upsertBanquetEvent` (`resolvers/banquets.ts`)
- [x] Step 074: Implement AppSync JS Resolver: `Query.listStockItems` & `Query.listSltdaMonthlyReports` (`resolvers/reportsAndStock.ts`)
- [x] Step 075: Compile All AppSync JS Resolvers with `esbuild` & Run Phase 3 Ponytail Check (`build-resolvers.mjs`)

## Phase 04: AWS CDK v2 Near-Free-Tier Cloud Infrastructure (`packages/cdk`)
- [x] Step 076: Create CDK App Entrypoint Configured for `ap-south-1` (Mumbai) (`bin/hms.ts`)
- [x] Step 077: Define Single-Table DynamoDB Construct (`HmsTable`) with Permanent Free-Tier Provisioned Capacity (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 078: Configure `GSI1` & `GSI2` Sparse Indexes on `HmsTable` (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 079: Provision Amazon Cognito User Pool (`HmsUserPool`) with Sri Lankan Phone & Tenant Claims (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 080: Provision Cognito RBAC User Groups (`SUPER_ADMIN`, `HOTEL_ADMIN`, `FRONT_DESK`, `KITCHEN_KDS`, `HOUSEKEEPING`, `POS_CASHIER`) (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 081: Implement AppSync Custom Lambda Authorizer (`qrAuthorizer.ts`) for Zero-Login Guest QR Access (`packages/cdk/lambdas/qrAuthorizer.ts`)
- [x] Step 082: Provision AWS AppSync GraphQL API (`HmsApi`) with Dual Auth (`USER_POOL` + `AWS_LAMBDA`) (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 083: Wire `HmsTable` as AppSync DynamoDB Data Source & Register Direct JS Resolvers (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 084: Implement Transactional Order & Folio Posting Lambda (`packages/cdk/lambdas/orderAndFolioTx.ts`)
- [x] Step 085: Implement Reservation, Driver Bed & Check-In/Check-Out Lambda (`packages/cdk/lambdas/reservationAndCheckInTx.ts`)
- [x] Step 086: Implement Unified Webhook Ingress Lambda (`packages/cdk/lambdas/webhooksIngress.ts`) for PayHere, WebXPay, Channex & SMSGo
- [x] Step 087: Implement Night Audit & CBSL Exchange Rate Rollover Lambda (`packages/cdk/lambdas/nightAuditCron.ts`)
- [x] Step 088: Implement S3 Presigned WebP Upload URL Generator Resolver/Lambda (`packages/cdk/lambdas/presignMediaUpload.ts`)
- [x] Step 089: Register All 5 ARM64 Graviton2 `NodejsFunction` Constructs in `hms-stack.ts` (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 090: Provision Single S3 Bucket (`HmsAssetBucket`) for Web App & Tenant WebP Media (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 091: Provision CloudFront Distribution (`HmsCloudFront`) Using Permanent 1 TB/Month Free Tier (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 092: Provision EventBridge Daily Rule for `23:59` Sri Lanka Standard Time Night Audit (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 093: Provision AWS Budgets Zero-Spend / $1.00 Monthly Cost Alert (`CfnBudget`) (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 094: Emit CDK `CfnOutput` Values & Auto-Generate Frontend `.env.production` Script (`packages/cdk/scripts/export-outputs.mjs`)
- [x] Step 095: Write Unit Tests for `qrAuthorizer.ts` Lambda (`packages/cdk/test/qrAuthorizer.test.ts`)
- [x] Step 096: Write Unit Tests for `orderAndFolioTx.ts` Lambda (`packages/cdk/test/orderAndFolioTx.test.ts`)
- [x] Step 097: Write Unit Tests for `reservationAndCheckInTx.ts` Lambda (`packages/cdk/test/reservationAndCheckInTx.test.ts`)
- [x] Step 098: Write Unit Tests for `webhooksIngress.ts` (PayHere, WebXPay, Channex, SMSGo) (`packages/cdk/test/webhooksIngress.test.ts`)
- [x] Step 099: Synthesize CDK Stack (`npx cdk synth`) & Verify Cost Guardrails Suite (`packages/cdk/test/cost-guardrails.test.ts`)
- [x] Step 100: Run Phase 4 Ponytail Audit & Code Simplification on `packages/cdk`

## Phase 06: Multi-Tenant Property Configuration, Room Types, Dual-Currency Rates & Tax Toggles
- [x] Step 141: Implement Rate Calculator Pure Helper (`calculateStayQuote`) in `packages/core/src/rateQuote.ts`
- [x] Step 142: Write Unit Tests for `calculateStayQuote` Across Resident & Foreign Bookings in `packages/core/test/rateQuote.test.ts`
- [x] Step 144: Add Audit Trail Logger for Tax & Rate Modifications (`packages/graphql/resolvers/auditLog.ts`)
- [x] Step 149: Write Integration Test for Property Setup & Tax Preset Persistence (`packages/core/test/propertySetup.test.ts`)

## Phase 07: Front-Desk Tape Chart, Reservations, Walk-Ins, Tour Operators (DMC) & Driver Quarters
- [x] Step 152: Implement Date-Range Conflict & Room Availability Filter (`packages/core/src/availabilityFilter.ts`)
- [x] Step 153: Write Unit Tests for Back-to-Back Same-Day Turnaround (`packages/core/test/availabilityFilter.test.ts`)
- [x] Step 170: Build Late Check-Out & Day-Use Room Rate Calculator (`packages/core/src/dayUseRate.ts`)
- [x] Step 171: Write Unit Tests for Day-Use & Late Check-Out Fee Calculations (`packages/core/test/dayUseRate.test.ts`)
- [x] Step 174: Write End-to-End Reservation-to-CheckIn State Transition Tests (`packages/core/test/reservationFlow.test.ts`)

## Phase 08: Channex.io OTA Channel Manager (Booking.com, Agoda, Expedia, Airbnb) & Direct Website Booking Engine
- [x] Step 176: Implement Channex ARI (Availability, Rates, Inventory) Payload Builder (`packages/core/src/channexAri.ts`)
- [x] Step 177: Implement Channex Booking Revision Parser (`packages/core/src/channexAri.ts`)
- [x] Step 178: Write Unit Tests for Channex Booking.com & Agoda Revision Payloads (`packages/core/test/channexAri.test.ts`)
- [x] Step 179: Extend `webhooksIngress.ts` to Pull & Acknowledge Channex Booking Revisions (`packages/cdk/lambdas/webhooksIngress.ts`)
- [x] Step 180: Implement Outbound Channex ARI Push Helper on Local Reservation Changes (`packages/cdk/lambdas/reservationAndCheckInTx.ts`)
- [x] Step 181: Implement Zero-Cost RFC 5545 iCal (`.ics`) Feed Exporter & Importer (`packages/core/src/icalSync.ts`)
- [x] Step 182: Write Unit Tests for RFC 5545 iCal Export & Import (`packages/core/test/icalSync.test.ts`)
- [x] Step 189: Implement Promo Code & Bank Card Offer Engine (`packages/core/src/promoOffer.ts`)
- [x] Step 190: Write Unit Tests for Sri Lankan Bank Credit Card Promo Rules (`packages/core/test/promoOffer.test.ts`)
- [x] Step 194: Implement Automated SMS & Email Booking Confirmation Dispatcher (`packages/cdk/lambdas/notifyBooking.ts`)
- [x] Step 195: Write Unit Tests for Booking Confirmation SMS Formatting (`packages/cdk/test/notifyBooking.test.ts`)
- [x] Step 199: Write End-to-End Direct Booking -> PayHere Webhook -> Tape Chart Lock Test (`packages/core/test/directBookingE2e.test.ts`)

## Phase 09: Guest Folio Ledger, Split Billing, 4-Stage Compounding Tax Invoice & Payment Settlement
- [x] Step 201: Implement Split-Folio Routing Engine (`packages/core/src/splitFolioRouter.ts`)
- [x] Step 202: Write Unit Tests for DMC Master vs. Guest Incidental Split Folio Routing (`packages/core/test/splitFolioRouter.test.ts`)
- [x] Step 215: Implement Credit Note & Tax Invoice Void/Adjustment Engine (`packages/core/src/creditNote.ts`)
- [x] Step 216: Write Unit Tests for Statutory Credit Note & Tax Reversal Calculations (`packages/core/test/creditNote.test.ts`)
- [x] Step 224: Write End-to-End Check-In -> Room Service Order -> Split Folio -> Tax Invoice Check-Out Test (`packages/core/test/folioLifecycle.test.ts`)

## Phase 10: DOMSpeed-Parity Menu, Catalog, Modifiers, Recipe BOM & Multi-Department Service Admin
- [x] Step 227: Build Time-of-Day Menu Schedule Evaluator (`packages/core/src/menuSchedule.ts`)
- [x] Step 228: Write Unit Tests for Sri Lanka Standard Time Menu Window Evaluation (`packages/core/test/menuSchedule.test.ts`)
- [x] Step 233: Implement Meal-Plan Order Line Pricing Resolver (`packages/core/src/mealPlanPricing.ts`)
- [x] Step 234: Write Unit Tests for `BB` / `HB` / `FB` / `AI` QR Ordering Entitlements (`packages/core/test/mealPlanPricing.test.ts`)
- [x] Step 236: Build Free Housekeeping & Express Room Amenity Catalog Preset (`packages/core/src/catalogPresets.ts`)
- [x] Step 237: Write Unit Tests for Trilingual Catalog Presets (`packages/core/test/catalogPresets.test.ts`)
- [x] Step 249: Write Unit Tests & Domain Engine for Menu Filtering, Happy Hour Pricing & Dietary Tagging (`packages/core/src/menuFiltering.ts`, `packages/core/test/menuFiltering.test.ts`)

## Phase 11: Contactless Guest Mobile PWA, Room Service & LankaQR Payment Portal
- [x] Step 270: Implement Idempotency Key Guard on Guest Order Submission (`packages/core/src/orderIdempotency.ts`)
- [x] Step 271: Write Unit Tests for Order Idempotency & Duplicate Tap Prevention (`packages/core/test/orderIdempotency.test.ts`)
- [x] Step 274: Write End-to-End Guest QR Cart -> Meal Plan Deduction -> Tax -> Order Tracker Test (`packages/core/test/guestQrFlow.test.ts`)

## Phase 12: Kitchen Display System (KDS), Bar Order Tracker (BOT) & Waiter Tablet POS
- [x] Step 284: Implement Split-Order Department Splitter (`packages/core/src/orderSplitter.ts`)
- [x] Step 285: Write Unit Tests for Mixed Kitchen KOT + Bar BOT Order Splitting (`packages/core/test/orderSplitter.test.ts`)
- [x] Step 295: Implement KDS Prep-Time SLA & Bottleneck Analytics Helper (`packages/core/src/kdsMetrics.ts`)
- [x] Step 296: Write Unit Tests for KDS SLA Metrics & Prep-Time Calculations (`packages/core/test/kdsMetrics.test.ts`)
- [x] Step 299: Write End-to-End QR Order -> KDS Cooking -> Runner Delivered -> Folio Sync Test (`packages/core/test/kdsLifecycle.test.ts`)

## Phase 13: Housekeeping Mobile Runner, Room Status Matrix, Minibar Posting, Laundry & Maintenance Tickets
- [x] Step 305: Implement Automated Daily Attendant Room Assignment Balancer (`packages/core/src/hkAssignment.ts`)
- [x] Step 306: Write Unit Tests for Housekeeping Attendant Workload Balancing (`packages/core/test/hkAssignment.test.ts`)
- [x] Step 314: Build Room Discrepancy Detector (`Sleep / Skip Discrepancy`) (`packages/core/src/roomDiscrepancy.ts`)
- [x] Step 315: Write Unit Tests for Front-Desk vs. Housekeeping Room Discrepancy Detection (`packages/core/test/roomDiscrepancy.test.ts`)
- [x] Step 321: Implement AppSync JS Resolver for Maintenance Tickets & Lost-and-Found (`packages/graphql/resolvers/housekeepingOps.ts`)
- [x] Step 324: Write End-to-End Check-Out -> Dirty -> Minibar Post -> Clean -> Inspected -> Check-In Ready Test (`packages/core/test/hkTurnaround.test.ts`)

## Phase 14: Sri Lankan Banquet, Wedding Hall & Conference Management (Poruwa, Corkage, Bite Plates & BEO)
- [x] Step 326: Implement Sri Lankan Wedding & Banquet Pricing Calculator (`packages/core/src/banquetMath.ts`)
- [x] Step 327: Write Unit Tests for Sri Lankan Wedding Package & Bite-Plate Calculations (`packages/core/test/banquetMath.test.ts`)
- [x] Step 340: Implement Banquet Kitchen Bulk Ingredient Requisition Generator (`packages/core/src/banquetBomAggregator.ts`)
- [x] Step 341: Write Unit Tests for Banquet Bulk Ingredient BOM Aggregation (`packages/core/test/banquetBomAggregator.test.ts`)
- [x] Step 349: Write End-to-End Wedding Inquiry -> Tentative Hold -> Deposit -> BEO -> Final Settlement Test (`packages/core/test/banquetLifecycle.test.ts`)
## Phase 15: Ayurveda Spa, Safari Jeep, Whale Watching, Gem/Tea Tours & Airport Transfer Excursion Desk
- [x] Step 351: Implement Resource Slot Conflict Checker for Therapists, Treatment Rooms & Safari Vehicles (`packages/core/src/resourceScheduler.ts`)
- [x] Step 352: Write Unit Tests for Therapist + Room Dual-Resource Conflict Detection (`packages/core/test/resourceScheduler.test.ts`)
- [x] Step 357: Implement Excursion Vendor Commission & Net Payout Calculator (`packages/core/src/excursionSplit.ts`)
- [x] Step 358: Write Unit Tests for Excursion Pass-Through vs. Taxable Hotel Markup (`packages/core/test/excursionSplit.test.ts`)
- [x] Step 364: Build Spa Herbal Oil & Consumables BOM Deduction Helper (`packages/core/src/spaConsumables.ts`)
- [x] Step 365: Write Unit Tests for Spa Herbal Oil Inventory Deduction (`packages/core/test/spaConsumables.test.ts`)
- [x] Step 368: Implement AppSync JS Resolvers for Spa, Excursions & Transfers (`packages/graphql/resolvers/activities.ts`)
- [x] Step 374: Write End-to-End Excursion Booking -> Packed Breakfast Trigger -> Split Folio Posting Test (`packages/core/test/activityFlow.test.ts`)
## Phase 16: Store Inventory, Procurement (PR -> PO -> GRN -> GIN), FIFO Batch Costing & Kitchen Wastage Control
- [x] Step 381: Implement GRN Price-Spike & Variance Detector (`packages/core/src/grnVariance.ts`)
- [x] Step 382: Write Unit Tests for GRN Price-Spike & Short-Delivery Detection (`packages/core/test/grnVariance.test.ts`)
- [x] Step 384: Wire Automatic Recipe BOM Depletion into `orderAndFolioTx.ts` on Order Completion (`packages/cdk/lambdas/orderAndFolioTx.ts`)
- [x] Step 385: Build Bar Liquor Shot / Peg Variance Auditor (`calculateLiquorVariance`) (`packages/core/src/liquorAudit.ts`)
- [x] Step 386: Write Unit Tests for Sri Lankan 25ml / 50ml Bar Peg Variance Math (`packages/core/test/liquorAudit.test.ts`)
- [x] Step 393: Implement AppSync JS Resolvers for Stock, PR, PO, GRN & GIN (`packages/graphql/resolvers/inventoryOps.ts`)
- [x] Step 399: Write End-to-End PO -> GRN Batch -> GIN Kitchen -> QR Order BOM Depletion -> Variance Test (`packages/core/test/inventoryLifecycle.test.ts`)

## Phase 17: Night Audit Automation, SLTDA Monthly Occupancy Returns, TDL Quarterly Statements & IRD Tax Schedules
- [x] Step 401: Implement Pure Night Audit Aggregation Engine (`packages/core/src/nightAudit.ts`)
- [x] Step 402: Write Unit Tests for Night Audit ADR, RevPAR & Foreign/Local Guest-Night Splitting (`packages/core/test/nightAudit.test.ts`)
- [x] Step 404: Implement SLTDA Monthly Statistical Return Compiler (`packages/core/src/sltdaReports.ts`)
- [x] Step 405: Implement SLTDA Quarterly Tourism Development Levy (TDL) Statement Compiler (`packages/core/src/sltdaReports.ts`)
- [x] Step 406: Write Unit Tests for SLTDA Monthly Occupancy & Quarterly TDL Returns (`packages/core/test/sltdaReports.test.ts`)
- [x] Step 409: Implement IRD Quarterly SSCL (`2.5%`) & Monthly VAT (`18%`) Output Schedule Compiler (`packages/core/src/irdTaxSchedules.ts`)
- [x] Step 410: Write Unit Tests for IRD VAT (`18%`) & SSCL (`2.5%`) Schedule Aggregation (`packages/core/test/irdTaxSchedules.test.ts`)
- [x] Step 413: Build Automated Morning GM Flash SMS / Email Summary inside `nightAuditCron.ts` (`packages/cdk/lambdas/nightAuditCron.ts`)
- [x] Step 414: Build Chart of Accounts & QuickBooks / Xero / Tally Journal Entry CSV Exporter (`packages/core/src/accountingExport.ts`)
- [x] Step 415: Write Unit Tests for Balanced Double-Entry Accounting Export (`Debits === Credits`) (`packages/core/test/accountingExport.test.ts`)
- [x] Step 424: Write End-to-End 30-Day Simulated Month -> Night Audits -> SLTDA + TDL + IRD VAT Return Test (`packages/core/test/monthlyComplianceE2e.test.ts`)

## Phase 18: Sri Lankan Hotel Staff Attendance, 10% Service Charge Pool Distribution, EPF (8%/12%), ETF (3%) & Payroll
- [x] Step 426: Implement Sri Lankan APIT (Advance Personal Income Tax) Monthly Tax Table Calculator (`calculateSriLankaApit`) (`packages/core/src/payroll.ts`)
- [x] Step 427: Implement Complete Monthly Hotel Payslip Generator (`generateEmployeePayslip`) (`packages/core/src/payroll.ts`)
- [x] Step 428: Write Unit Tests for Service Charge Points, Breakage Deduction, EPF/ETF & APIT (`packages/core/test/payroll.test.ts`)
- [x] Step 437: Build Sri Lankan Commercial Bank Salary & Service Charge SLIPS Bulk Transfer CSV Exporter (`packages/core/src/bankSlipsExport.ts`)
- [x] Step 438: Write Unit Tests for LankaPay SLIPS Bank Transfer CSV Formatting (`packages/core/test/bankSlipsExport.test.ts`)
- [x] Step 442: Implement AppSync JS Resolvers for Roster, Attendance, SC Pool & Payroll (`packages/graphql/resolvers/hrPayroll.ts`)
- [x] Step 444: Build Gratuity Accrual Estimator (`Payment of Gratuity Act No. 12 of 1983`) (`packages/core/src/gratuityMath.ts`)
- [x] Step 445: Write Unit Tests for Sri Lankan 5-Year Statutory Gratuity Accrual (`packages/core/test/gratuityMath.test.ts`)
- [x] Step 449: Write End-to-End Monthly SC Collection -> Breakage Deduction -> Payroll -> EPF/ETF -> Bank SLIPS Test (`packages/core/test/payrollLifecycle.test.ts`)

## Phase 19: Multi-Property SaaS Super-Admin, Tenant Provisioning, Chain Analytics & Future Flutter SDK Contracts
- [x] Step 457: Implement Module Entitlement Guard (`hasModuleEntitlement`) (`packages/core/src/tenant/hasModuleEntitlement.ts`)
- [x] Step 458: Implement Tenant Room Count Quota Enforcement Resolver (`enforceRoomCountQuota.js`) (`packages/graphql/resolvers/enforceRoomCountQuota.ts`)
- [x] Step 460: Build Tenant Data Export & GDPR / Sri Lanka PDPA Anonymizer (`packages/core/src/pdpaCompliance.ts`)
- [x] Step 461: Write Unit Tests for Sri Lanka PDPA Guest PII Anonymization (`packages/core/test/pdpaCompliance.test.ts`)
- [x] Step 463: Generate Future Flutter / Dart GraphQL Schema & Operation Definitions (`packages/graphql/scripts/export-flutter-contracts.mjs`)
- [x] Step 464: Document Future Flutter App Integration Guide (`docs/flutter-integration-contract.md`)
- [x] Step 469: Implement Tenant Rate-Limiting & Abuse Guard in `qrAuthorizer.ts` (`packages/cdk/lambdas/qrAuthorizer.ts`)
- [x] Step 470: Implement CloudFront Security Headers Policy (CSP, HSTS, X-Frame-Options) in `hms-stack.ts` (`packages/cdk/lib/hms-stack.ts`)
- [x] Step 472: Write End-to-End Multi-Tenant Isolation Security Test (`packages/core/test/tenantIsolation.test.ts`)
- [x] Step 473: Write Unit Tests for Demo Seeder & Full-System Data Graph Integrity (`packages/core/test/demoGraph.test.ts`)
- [x] Step 475: Run Phase 19 Ponytail Review & Code Simplification Checkpoint

## Phase 20: End-to-End Security Audit, Ponytail Whole-Repo Code Simplification, Load Verification & AWS CDK Deployment
- [x] Step 476: Run Whole-Repository Ponytail Audit (`/ponytail:ponytail-audit`)
- [x] Step 477: Run Addy Osmani's Five-Axis Code Review Skill (`/agent-skills:code-review-and-quality`)
- [x] Step 478: Run Security Auditor Persona on Payment, Webhook & QR Auth Boundaries (`/agent-skills:security-auditor`)
- [x] Step 480: Verify Maximum File Length Constraint Across Entire Repo (`packages/*/src`)
- [x] Step 482: Run Complete Native Node Unit & Integration Test Suite with Coverage Report (1,058 tests passing)
- [x] Step 484: Verify Trilingual (`English` / `සිංහල` / `தமிழ்`) Key Parity in `i18n.ts`
- [x] Step 486: Synthesize Production AWS CloudFormation Template (`npx cdk synth`) (`packages/cdk/cdk.out/SriLankaHmsStack.template.json`)
- [x] Step 487: Run Automated CloudFormation Free-Tier & Zero-NAT/Zero-RDS Guardrail Test (`packages/cdk/test/cost-guardrails.test.ts`)
- [x] Step 488: Bootstrap AWS CDK Environment in `ap-south-1` (Mumbai Region) (`packages/cdk/`)
- [x] Step 489: Deploy `SriLankaHmsStack` to `ap-south-1` via AWS CDK (`npx cdk deploy`) (`packages/cdk/`)
- [x] Step 490: Extract CDK Outputs & Populate `packages/web/.env.production` Automatically (`packages/cdk/scripts/export-outputs.mjs`)
- [x] Step 491: Sync Built `packages/web/dist` Assets to `HmsAssetBucket` & Invalidate CloudFront `/index.html` (`packages/cdk/scripts/deploy-web.mjs`)
- [x] Step 492: Seed First Live Production Hotel Tenant & Super-Admin Account (`packages/cdk/scripts/seed-first-hotel.mjs`)
- [x] Step 493: Verify Live PayHere Sandbox Webhook Callback Against Deployed `webhooksIngress` Function URL (`packages/cdk/scripts/smoke-test-webhooks.mjs`)
- [x] Step 494: Verify Live Guest Room QR Scan -> AppSync WebSocket -> KDS Chime Latency (<150 ms) (`packages/cdk/scripts/smoke-test-qr-order.mjs`)
- [x] Step 495: Verify Live 4-Stage Sri Lankan Tax Invoice & LankaQR Payload Generation (`packages/core/test/tax.test.ts`, `packages/core/test/lankaQr.test.ts`)
- [x] Step 496: Configure CloudWatch Free-Tier Alarms for Lambda Errors & DynamoDB Throttles (`packages/cdk/lib/hms-stack.ts`)

















