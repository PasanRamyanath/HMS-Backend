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

