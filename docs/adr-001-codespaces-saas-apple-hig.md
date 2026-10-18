# ADR 001: 3-Repository Codespaces Topology, 42-Entity DynamoDB Architecture & Apple HIG Liquid Glass Design Standard

## Status
**Accepted** — Architecture Decision Record & Foundational Contract for the Sri Lankan Cloud SaaS Hotel Management System (HMS) & Contactless QR Platform.

---

## 1. Context and Problem Statement

The Sri Lankan hospitality sector—spanning boutique villas in Mirissa and Galle, heritage bungalows in Nuwara Eliya, luxury resorts in Bentota, cultural triangle hotels in Kandy/Sigiriya, and rest houses island-wide—operates under demanding operational and statutory conditions:

1. **Sri Lankan Statutory & Tax Rigor**: Mandatory compliance with Inland Revenue Department (IRD) RAMIS 4-stage compounding tax calculations (`Service Charge (10%) -> Tourism Development Levy (TDL 1%) -> Social Security Contribution Levy (SSCL 2.5%) -> Value Added Tax (VAT 18%)`), strict integer-cent rounding, IRD Commercial Tax Invoices, Sri Lanka Tourism Development Authority (SLTDA) licensing and statistical returns, Sri Lanka Tourist Police guest registration (B-Cards), and National Identity Card (NIC) / Foreign Passport identity verification.
2. **Payment Ecosystem**: Seamless coexistence of Central Bank of Sri Lanka (CBSL) LankaQR EMVCo dynamic QR code payments, internet payment gateways (PayHere, WebXPay), dual-currency pricing (`LKR` for domestic residents and locked exchange rate `USD` for foreign guests), and manual cashier shift drawer reconciliation.
3. **Cloud Infrastructure Economics**: The platform must operate under a strict permanent AWS Free Tier / near-free-tier cost ceiling in `ap-south-1` (Mumbai, ~25ms latency from Sri Lanka), guaranteeing zero idle hourly hosting bills (zero NAT Gateways, zero RDS instances, zero OpenSearch domains, and $\le 25$ total DynamoDB provisioned RCU/WCU).
4. **Guest & Staff User Experience**: Zero-login QR room service and dining ordering for guests must feel fluid and responsive on mobile browsers, while staff KDS/BOT, housekeeping, and front desk PMS systems must follow modern ergonomic standards.

To satisfy these requirements without architectural drift, this document formalizes the technical decisions governing the codebase.

---

## 2. Decision 1: 3-Repository GitHub Codespaces Topology & Workflow

The platform is structured into three discrete repositories orchestrated inside a unified GitHub Codespaces workspace:

```
/workspaces/Sri-Lanka--HMS/
├── .devcontainer/devcontainer.json           # Codespaces orchestrator (Node 22 LTS, AWS CLI, gh CLI)
├── scripts/
│   ├── sync-contracts.sh                     # Cross-repo GraphQL schema & TypeScript type sync
│   └── verify-all-repos.sh                   # Master quality gate (Biome, Knip, TypeCheck, Tests)
├── plan.md                                   # 500-step master execution plan
│
├── HMS-Backend/                              # AWS CDK v2, AppSync GraphQL, @hms/core
│   ├── packages/core/                        # Zero-dependency pure domain logic (Tax, NIC, LankaQR, AuditLog)
│   ├── packages/graphql/                     # 42-entity GraphQL schema & APPSYNC_JS_1_0_0 resolvers
│   ├── packages/cdk/                         # AWS CDK v2 infrastructure stack (ap-south-1 Mumbai)
│   ├── .github/workflows/deploy-backend.yml  # Independent keyless OIDC CI/CD deployment
│   ├── biome.json & knip.json                # Zero-console & zero-dead-code enforcement
│   └── PROGRESS.md                           # Backend milestone tracking
│
└── HMS-Frontend/                             # React 19 + Tailwind CSS v4 Apple HIG PWA & PMS
    ├── src/qr/                               # Zero-login guest room-service & dining PWA
    ├── src/staff/                            # Smartphone/Tablet KDS, BOT, Housekeeping & Waiter POS
    ├── src/admin/                            # Full hotel PMS: Tape chart, folios, stores, SLTDA & payroll
    ├── src/styles/apple-hig-theme.css        # Apple HIG Liquid Glass design tokens
    ├── .github/workflows/deploy-frontend.yml # Independent S3 + CloudFront keyless OIDC deployment
    ├── biome.json & knip.json                # Zero-console & zero-dead-code enforcement
    └── PROGRESS.md                           # Frontend milestone tracking
```

### Rationale
- **Isolated Lifecycles**: Frontend UI assets and backend infrastructure deploy independently via dedicated GitHub Actions workflows using short-lived AWS IAM OIDC role assumption (`id-token: write`).
- **Shared Contracts Without Monorepo Lock-in**: Contract synchronization is maintained via `scripts/sync-contracts.sh`, compiling AppSync schemas into frontend types (`HMS-Frontend/src/generated/graphql.ts`) without cross-repo runtime npm coupling.
- **Local Development Agility**: A single devcontainer hosts the entire platform, giving developers zero-configuration full-stack reproducibility.

---

## 3. Decision 2: 42-Entity Single-Table DynamoDB Architecture (`HmsTable`)

All persistent records are housed in a single DynamoDB table (`HmsTable`) in `ap-south-1` configured with provisioned throughput (`<= 20 RCU / 20 WCU` base, well within the AWS 25 RCU/WCU always-free tier), utilizing generic partition and sort keys:
- **Primary Key**: `PK` (String), `SK` (String)
- **Global Secondary Indexes**:
  - `GSI1PK` / `GSI1SK`: Primary domain access patterns and tenant filtering
  - `GSI2PK` / `GSI2SK`: Secondary lookup, occupancy locks, and foreign key relations
  - `GSI3PK` / `GSI3SK`: High-frequency transactional status and queue monitoring
- **Time To Live**: `ttl` (Number, epoch seconds) for ephemeral shift sessions and guest QR tokens.

### Entity Model Catalog (42 Entities)

| # | Domain | Entity Name | Primary Key (`PK` / `SK`) | `GSI1` (`PK` / `SK`) | Core Attributes & Invariants |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01** | SaaS Core | `SaasOrganization` | `ORG#<orgId>` / `METADATA` | `SAAS#ORGS` / `CREATED#<isoDate>#<orgId>` | Multi-property parent entity, owner identity, PDPA DPO contact. |
| **02** | SaaS Core | `HotelTenant` | `TENANT#<tid>` / `METADATA` | `SAAS#TENANTS` / `STATUS#<status>#<tid>` | Property profile, SLTDA registration, TIN, VAT, SSCL, tax configuration, theme accent. |
| **03** | SaaS Core | `SaasSubscription` | `TENANT#<tid>` / `SUBSCRIPTION#<subId>` | `SAAS#SUBS` / `RENEWAL#<yyyy-mm-dd>#<tid>` | Plan tier (`STARTER_VILLA`, `PRO_RESORT`, `ENTERPRISE_CHAIN`), feature entitlements, quotas. |
| **04** | SaaS Core | `SaasBillingInvoice` | `TENANT#<tid>` / `SAASINV#<invId>` | `SAAS#INVOICES` / `MONTH#<yyyy-mm>#<invId>` | SaaS subscription recurring invoice records and gateway transaction references. |
| **05** | SaaS Core | `TenantWebhookEndpoint` | `TENANT#<tid>` / `WEBHOOK#<provider>` | `WEBHOOK_PROVIDER#<provider>` / `TENANT#<tid>` | Webhook integration configurations for PayHere, WebXPay, Channex OTA, SMSGo. |
| **06** | SaaS Core | `TenantApiKey` | `TENANT#<tid>` / `APIKEY#<keyId>` | `APIKEY_HASH#<sha256>` / `TENANT#<tid>` | External API credentials for booking engine widgets and external ERP integrations. |
| **07** | IAM & Audit | `StaffUser` | `TENANT#<tid>` / `USER#<uid>` | `USER_EMAIL#<email>` / `TENANT#<tid>` | Staff identity, Cognito sub, role, department, PIN hash, EPF/ETF numbers, basic salary. |
| **08** | IAM & Audit | `RolePermissionMatrix` | `TENANT#<tid>` / `ROLE#<roleCode>` | `TENANT#<tid>#ROLES` / `ROLE#<roleCode>` | Granular RBAC definitions: allowed queries, allowed mutations, maximum discount limits. |
| **09** | IAM & Audit | `StaffShiftSession` | `TENANT#<tid>` / `SHIFTSESS#<sessId>` | `TENANT#<tid>#ACTIVESHIFTS` / `USER#<uid>#<isoStart>` | Active workstation login, assigned terminal role, clock-in/out timestamps, automatic TTL. |
| **10** | IAM & Audit | `ImmutableAuditLog` | `TENANT#<tid>` / `AUDITLOG#<isoTs>#<evtId>` | `TENANT#<tid>#AUDITENTITY#<entityType>` / `ID#<entityId>#<isoTs>` | Tamper-evident audit trail with SHA-256 hash chaining (`prevHash -> entryHash`). |
| **11** | Property & Rates | `RoomType` | `TENANT#<tid>` / `ROOMTYPE#<rtId>` | `TENANT#<tid>#RT` / `SORT#<sortOrder>#<rtId>` | Room classification, occupancy capacity, base resident LKR & foreign USD rates. |
| **12** | Property & Rates | `PhysicalRoom` | `TENANT#<tid>` / `ROOM#<roomNo>` | `TENANT#<tid>#HK` / `STATUS#<hkStatus>#<roomNo>` | Room unit, floor/wing, housekeeping status (`CLEAN`, `DIRTY`, `INSPECTED`, `OOO`). |
| **13** | Property & Rates | `RatePlan` | `TENANT#<tid>` / `RATEPLAN#<rpId>` | `TENANT#<tid>#RATEPLANS` / `ROOMTYPE#<rtId>#<mealPlan>` | Pricing packages: residency tier, meal plan (`RO`, `BB`, `HB`, `FB`, `AI`), tax-inclusive flags. |
| **14** | Property & Rates | `SeasonalRateCalendar` | `TENANT#<tid>` / `SEASON#<seasonId>` | `TENANT#<tid>#SEASONS` / `START#<yyyy-mm-dd>#<endDate>` | Date-range pricing multipliers (Esala Perahera peak, high season, monsoon discounts). |
| **15** | Property & Rates | `PromoAndVoucher` | `TENANT#<tid>` / `PROMO#<codeId>` | `TENANT#<tid>#PROMOCODE#<codeUpper>` / `VALID#<endDate>` | Promotional discount vouchers, bank card BIN discounts, and redemption tracking. |
| **16** | Property & Rates | `DriverDormBed` | `TENANT#<tid>` | `DRIVERBED#<bedId>` | `TENANT#<tid>#DRV` / `STATUS#<status>#<bedId>` | Chauffeur/guide dormitory beds, tourist guide registration number, assignment status. |
| **17** | CRM & Bookings | `GuestProfile` | `TENANT#<tid>` / `GUEST#<guestId>` | `TENANT#<tid>#GUESTID#<nicOrPassport>` / `GUEST#<guestId>` | Guest CRM, residency status, VIP tier, dietary notes, PDPA consent timestamp. |
| **18** | CRM & Bookings | `TourOperatorDmcAccount` | `TENANT#<tid>` / `DMC#<dmcId>` | `TENANT#<tid>#DMCS` / `NAME#<companyName>` | B2B Travel Agent / Destination Management Company profiles, credit limits, contracts. |
| **19** | CRM & Bookings | `Reservation` | `TENANT#<tid>` / `RES#<resId>` | `TENANT#<tid>#RESDATE` / `CHECKIN#<yyyy-mm-dd>#<resId>` | Master booking record, guest linkage, room allocation, status, QR session HMAC secret. |
| **20** | CRM & Bookings | `ReservationRoomStay` | `TENANT#<tid>` / `RESROOM#<resId>#<roomNo>#<date>` | `TENANT#<tid>#OCCUPANCY#<date>` / `ROOM#<roomNo>` | Atomic per-room-per-night lock items preventing double-booking via `TransactWriteItems`. |
| **21** | CRM & Bookings | `RoomBlockMaintenance` | `TENANT#<tid>` / `BLOCK#<blockId>` | `TENANT#<tid>#BLOCKS` / `START#<yyyy-mm-dd>#<roomNo>` | Maintenance holds, out-of-order blocks, and DMC allotment reservations. |
| **22** | CRM & Bookings | `PoliceBCardRegistration` | `TENANT#<tid>` / `BCARD#<resId>#<guestIdx>` | `TENANT#<tid>#BCARDDATE` / `ARRIVAL#<yyyy-mm-dd>#<resId>` | Statutory Sri Lanka Tourist Police form: passport/NIC, visa, arrival, next destination. |
| **23** | Folios & Billing | `GuestFolio` | `TENANT#<tid>` / `FOLIO#<folioId>` | `TENANT#<tid>#FOLIOSTATUS` / `STATUS#<status>#<folioId>` | Master billing account: base total, SC, TDL, SSCL, VAT breakdown, payments, balance. |
| **24** | Folios & Billing | `FolioLineItem` | `TENANT#<tid>` / `FOLIO#<folioId>#LINE#<lineId>` | `TENANT#<tid>#REVENUE` / `DATE#<yyyy-mm-dd>#<dept>` | Departmental charges (Room, F&B, Spa, Laundry, Minibar, Corkage) with tax snapshots. |
| **25** | Folios & Billing | `FolioPaymentTransaction` | `TENANT#<tid>` / `PAYMENT#<payId>` | `TENANT#<tid>#PAYMENTS` / `DATE#<yyyy-mm-dd>#<method>` | Settled payments: LankaQR, PayHere, WebXPay, Cash LKR, USD Cash, City Ledger. |
| **26** | Folios & Billing | `CashierShiftDrawer` | `TENANT#<tid>` / `CASHSHIFT#<shiftId>` | `TENANT#<tid>#CASHSHIFTS` / `OPEN#<isoTs>#<userId>` | Front desk cashier float, collections, petty cash payouts, counted closing variance. |
| **27** | Folios & Billing | `IrdTaxInvoiceRecord` | `TENANT#<tid>` / `TAXINV#<invNo>` | `TENANT#<tid>#TAXINVOICES` / `DATE#<yyyy-mm-dd>#<invNo>` | Immutable sequentially numbered IRD RAMIS commercial tax invoice record. |
| **28** | QR, POS & KDS | `DiningOutlet` | `TENANT#<tid>` / `OUTLET#<outletId>` | `TENANT#<tid>#OUTLETS` / `SORT#<sortOrder>#<outletId>` | Restaurants, pool bars, in-room dining services, beach clubs, service charge flag. |
| **29** | QR, POS & KDS | `MenuCategory` | `TENANT#<tid>` / `CAT#<catId>` | `TENANT#<tid>#MENU` / `SORT#<sortOrder>#CAT#<catId>` | Trilingual menu headings (`nameEn`, `nameSi`, `nameTa`), service window availability. |
| **30** | QR, POS & KDS | `MenuItem` | `TENANT#<tid>` / `ITEM#<itemId>` | `TENANT#<tid>#MENU` / `SORT#<sortOrder>#ITEM#<itemId>` | Dish details, pricing, stock flag, preparation time, spice levels, allergens, recipe BOM. |
| **31** | QR, POS & KDS | `QrLocationEndpoint` | `TENANT#<tid>` / `QRLOC#<locId>` | `TENANT#<tid>#QRLOCS` / `TYPE#<locType>#<locId>` | Room, restaurant table, or cabana physical QR endpoints with active HMAC tokens. |
| **32** | QR, POS & KDS | `ServiceOrder` | `TENANT#<tid>` / `ORDER#<orderId>` | `TENANT#<tid>#KDS#<dept>` / `STATUS#<status>#<isoTime>` | Real-time guest order: department, KDS lifecycle status, item lines, LankaQR string. |
| **33** | Housekeeping | `HousekeepingTask` | `TENANT#<tid>` / `HKTASK#<taskId>` | `TENANT#<tid>#HKQUEUE` / `STATUS#<status>#<priority>#<taskId>` | Room cleaning tickets, turndown requests, guest amenity requests, SLA timer. |
| **34** | Housekeeping | `MinibarAndLaundryLog` | `TENANT#<tid>` / `MINILNDRY#<logId>` | `TENANT#<tid>#MINILNDRYDATE` / `DATE#<yyyy-mm-dd>#<roomNo>` | Consumed minibar items and guest laundry charges posted directly to active folio. |
| **35** | Housekeeping | `MaintenanceWorkOrder` | `TENANT#<tid>` / `MAINT#<ticketId>` | `TENANT#<tid>#MAINTQUEUE` / `STATUS#<status>#<severity>#<ticketId>` | Engineering work orders (AC, plumbing, electrical) and room-blocking flags. |
| **36** | Housekeeping | `LostAndFoundItem` | `TENANT#<tid>` / `LOSTFOUND#<itemId>` | `TENANT#<tid>#LOSTFOUND` / `STATUS#<claimStatus>#<foundDate>` | Custody tracking for guest property found in rooms or public areas. |
| **37** | Banquets & Spa | `BanquetHallAndEventBEO` | `TENANT#<tid>` / `BANQUET#<eventId>` | `TENANT#<tid>#HALL#<hallId>` / `DATE#<yyyy-mm-dd>#<slot>` | Wedding Banquet Event Orders (BEOs), Poruwa/Ashtaka timings, bite plates, corkage. |
| **38** | Banquets & Spa | `AyurvedaSpaAppointment` | `TENANT#<tid>` / `SPAAPPT#<apptId>` | `TENANT#<tid>#SPADATE` / `DATE#<yyyy-mm-dd>#<therapistId>` | Traditional Sri Lankan Ayurvedic treatments, Dosha classification, therapist roster. |
| **39** | Banquets & Spa | `ExcursionAndTransferBooking` | `TENANT#<tid>` / `EXCURSION#<excId>` | `TENANT#<tid>#EXCDATE` / `DATE#<yyyy-mm-dd>#<depTime>` | Safaris (Yala/Udawalawe), whale watching, airport transfers, vehicle registration. |
| **40** | Stores & ERP | `SupplierAndStockItem` | `TENANT#<tid>` / `STOCK#<skuId>` | `TENANT#<tid>#STORECAT` / `CAT#<cat>#<skuId>` | Inventory stock items, units of measure, reorder levels, FIFO cost batches. |
| **41** | Stores & ERP | `InventoryProcurementVoucher` | `TENANT#<tid>` / `INVTX#<txId>` | `TENANT#<tid>#INVDATE` / `DATE#<yyyy-mm-dd>#<voucherType>` | Goods Received Notes (GRN), Purchase Orders (PO), Goods Issue Notes (GIN). |
| **42** | Statutory & HR | `NightAuditSltdaAndPayroll` | `TENANT#<tid>` / `AUDIT#<yyyy-mm-dd>` | `TENANT#<tid>#MONTHAUDIT` / `MONTH#<yyyy-mm>#<dd>` | Daily night audit snapshot, SLTDA returns, and monthly staff EPF/ETF/SC payroll. |

---

## 4. Decision 3: Zero-Dependency Core Domain Engine (`@hms/core`)

All core domain logic—statutory taxes, identity validation, cryptographic hashing, and currency formatting—resides in `packages/core` with **zero runtime external npm dependencies**:

1. **Explicit `Result<T, DomainError>` Pattern**: No unhandled exceptions or noisy console logging. Domain operations return deterministic `Result<T, DomainError>` values:
   ```typescript
   export type Result<T, E = DomainError> =
     | { readonly ok: true; readonly value: T }
     | { readonly ok: false; readonly error: E };
   ```
2. **Four-Stage Compounding Sri Lankan Tax Engine**:
   $$\text{Subtotal} = \text{Base Amount}$$
   $$\text{SC} = \text{Subtotal} \times 10\%$$
   $$\text{TDL} = (\text{Subtotal} + \text{SC}) \times 1\%$$
   $$\text{SSCL} = (\text{Subtotal} + \text{SC}) \times 2.5\%$$
   $$\text{VAT Base} = \text{Subtotal} + \text{SC} + \text{SSCL}$$
   $$\text{VAT} = \text{VAT Base} \times 18\%$$
   $$\text{Grand Total} = \text{Subtotal} + \text{SC} + \text{TDL} + \text{SSCL} + \text{VAT}$$
   Every intermediate calculation is rounded using half-up integer cent precision (`Math.round((v + Number.EPSILON) * 100) / 100`).
3. **Statutory Identity & Format Verification**: Pure validation utilities for:
   - Tenant IDs (`/^[a-z0-9]+(-[a-z0-9]+)*$/`)
   - Sri Lankan mobile numbers (`+947XXXXXXXX` across Dialog, Mobitel, Hutch, Airtel)
   - National Identity Cards (old 9-digit + `V`/`X` and modern 12-digit format)
   - SLTDA licensing formats (`SLTDA/SQA/...`)
   - IRD TIN and VAT registration numbers
4. **Tamper-Evident SHA-256 Audit Log Engine**: Every sensitive mutation is chained cryptographically:
   $$\text{entryHash} = \text{SHA256}(\text{prevHash} \parallel \text{tenantId} \parallel \text{actorUserId} \parallel \text{action} \parallel \text{entityType} \parallel \text{entityId} \parallel \text{isoTs} \parallel \text{afterJson})$$

---

## 5. Decision 4: Apple Human Interface Guidelines (HIG) & Liquid Glass Design Standard

The frontend user interfaces (`HMS-Frontend`) strictly implement Apple Human Interface Guidelines, Liquid Glass translucency tokens, and continuous squircle geometry:

```css
/* Liquid Glass Translucency */
.apple-liquid-glass {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.28);
}

@media (prefers-color-scheme: dark) {
  .apple-liquid-glass {
    background: rgba(28, 28, 30, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .apple-liquid-glass {
    background: #ffffff;
    backdrop-filter: none;
  }
}
```

### Apple HIG Pillars Enforced Across HMS-Frontend
1. **Materials & Vibrancy**: Translucent blurred surfaces for navigation headers, bottom shopping carts, and modal dialogs with solid fallbacks for accessibility.
2. **SF Pro Typography & Tabular Numerals**: Pixel-aligned numerical comparisons (`.tabular-nums-lkr` / `font-variant-numeric: tabular-nums`) across all LKR/USD columns, tax calculations, and countdown timers.
3. **Ergonomic Touch Targets**: Minimum interactive surface of $\ge 44 \times 44\,\text{pt}$ for touchscreens, mobile KDS order status buttons, and POS quick-keys.
4. **Continuous Squircle Geometry**: iOS/macOS-style smooth corner radii (`10px` for controls, `16px` for cards, `24px` for sheets).
5. **Fluid Spring Transitions**: `cubic-bezier(0.22, 1, 0.36, 1)` easing with instant transitions when `prefers-reduced-motion` is active.

---

## 6. Decision 5: Permanent Free-Tier Cost Ceiling & Architectural Invariants

To eliminate unexpected cloud charges, the backend infrastructure enforces hard architectural invariants:

1. **Zero NAT Gateways**: AppSync directly interacts with DynamoDB via direct JavaScript resolvers (`APPSYNC_JS_1_0_0`). No Lambda functions or AppSync data sources require VPC placement with costly NAT Gateways.
2. **Zero RDS & OpenSearch Instances**: DynamoDB single-table design with sparse GSIs satisfies 100% of read and write access patterns, eliminating relational and search cluster hosting costs.
3. **DynamoDB Provisioned Capacity Bounds**: Tables and GSIs operate in `PROVISIONED` billing mode capped at $\le 25\,\text{RCU}$ and $\le 25\,\text{WCU}$ total across all tables, fitting within the AWS Permanent Free Tier.
4. **Log Retention Capping**: CloudWatch Logs are configured with a strict 7-day retention period.
5. **Graviton2 `ARM_64` Lambdas**: Transactional Lambdas run on AWS Graviton2 processors with 128 MB memory and short execution timeouts ($\le 10\,\text{s}$).

These invariants are programmatically verified in CI via automated CloudFormation assertion suites (`packages/cdk/test/cost-guardrails.test.ts`).

---

## 7. Consequences and Quality Gates

### Positive Consequences
- **Zero Cost Idle Footprint**: The entire hotel management backend runs permanently inside AWS Free Tier limits when idle.
- **Predictable Latency**: AppSync direct DynamoDB resolvers execute in under 15ms in `ap-south-1`.
- **Legal Compliance**: Full out-of-the-box readiness for Sri Lankan IRD RAMIS audits, SLTDA licensing reviews, and Tourist Police security reporting.
- **Flawless Design Consistency**: Consistent Apple HIG aesthetics across guest mobile devices, kitchen iPads, and front desk Mac workstations.

### Negative Consequences / Trade-offs
- **Single-Table Discipline**: Adding new query access patterns requires deliberate GSI planning rather than ad-hoc SQL joins.
- **Rigorous Verification Overhead**: Every commit must pass Biome anti-noise rules (`noConsole`, `noDebugger`), Knip dead-code elimination, TypeScript strict checks, and unit tests.

---

## 8. Automated Verification Protocol

Before merging any change or advancing steps in `plan.md`:
1. **Lint & Anti-Noise**: `npx biome check .` (Zero console statements, zero debuggers, cognitive complexity $\le 12$).
2. **Dead-Code Scan**: `npx knip` (Zero unused files, types, or dependencies).
3. **TypeScript Compilation**: `npx tsc --noEmit` (Zero compiler errors).
4. **Unit & Guardrail Tests**: `npm test` across all workspaces.
5. **Infrastructure Verification**: `npx cdk synth` verifying CloudFormation validity.
