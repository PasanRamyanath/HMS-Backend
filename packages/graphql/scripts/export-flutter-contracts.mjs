/**
 * Future Flutter / Dart GraphQL Schema & Operation Exporter
 * (`packages/graphql/scripts/export-flutter-contracts.mjs`)
 *
 * Implements Step 463 (Phase 19.13) of the Sri Lanka HMS Master Architecture Plan:
 * - Exports `schema.graphql`, modular operation `.graphql` documents, bundled `operations.graphql`,
 *   and `hms_aws_config.json` into `packages/graphql/flutter-sdk/`.
 * - Enables plug-and-play code generation for future Flutter / Dart cross-platform mobile apps
 *   using Artemis, GraphQL Codegen, Ferry, or AWS Amplify Flutter.
 * - Adheres strictly to the 42-Entity Multi-Tenant SaaS & Sri Lankan Statutory Contract:
 *   - `tenantId` partition isolation (`PK = TENANT#<tid>`)
 *   - RolePermissionMatrix RBAC and Guest QR HMAC authentication
 *   - 4-stage compounding LKR tax math (`SC -> TDL -> SSCL -> VAT`)
 *   - Permanent AWS Free Tier compliance (ap-south-1 Mumbai)
 * - Zero console.log / console.error statements (`suspicious.noConsole: "error"` compliant).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Root paths
const packageRoot = resolve(__dirname, "..");
const schemaPath = join(packageRoot, "schema.graphql");
const outputDir = join(packageRoot, "flutter-sdk");
const queriesDir = join(outputDir, "queries");
const mutationsDir = join(outputDir, "mutations");
const subscriptionsDir = join(outputDir, "subscriptions");

// Ensure directories exist
mkdirSync(outputDir, { recursive: true });
mkdirSync(queriesDir, { recursive: true });
mkdirSync(mutationsDir, { recursive: true });
mkdirSync(subscriptionsDir, { recursive: true });

// 1. Read & Export schema.graphql
if (!existsSync(schemaPath)) {
  process.stderr.write(`Error: schema.graphql not found at ${schemaPath}\n`);
  process.exit(1);
}

const originalSchema = readFileSync(schemaPath, "utf8");
const schemaHeader = `# ==============================================================================
# Sri Lanka Hotel Management System (HMS) - Mobile SDK GraphQL Schema
# Purpose-built for Flutter / Dart Client Code Generation (Artemis / Ferry / Codegen)
# Architecture: Single-Table DynamoDB (PK = TENANT#<id>), CBSL LankaQR, 4-Stage Tax
# Target Region: AWS ap-south-1 (Mumbai) • Always Free Tier Compliant
# ==============================================================================

`;

writeFileSync(join(outputDir, "schema.graphql"), schemaHeader + originalSchema, "utf8");

// 2. Define Modular Operation Documents
const HOTEL_QUERIES = `query GetHotelTenant($tenantId: ID!) {
  getHotelTenant(tenantId: $tenantId) {
    id
    name
    legalEntityName
    sltdaRegistrationNumber
    vatRegistrationNumber
    currency
    tier
    roomCount
    address
    city
    contactEmail
    contactPhone
    isActive
    serviceChargePercent
    tdlPercent
    ssclPercent
    vatPercent
    createdAt
    updatedAt
  }
}

query ListRooms($tenantId: ID!) {
  listRooms(tenantId: $tenantId) {
    id
    roomNumber
    type
    floor
    status
    housekeepingStatus
    baseRateLkr
    maxOccupancy
    features
    updatedAt
  }
}

query GetRoom($tenantId: ID!, $id: ID!) {
  getRoom(tenantId: $tenantId, id: $id) {
    id
    roomNumber
    type
    floor
    status
    housekeepingStatus
    baseRateLkr
    maxOccupancy
    features
    currentReservationId
    updatedAt
  }
}
`;

const MENU_QUERIES = `query ListMenuCatalog($tenantId: ID!) {
  listMenuCatalog(tenantId: $tenantId) {
    id
    name
    department
    displayOrder
    isActive
    items {
      id
      categoryId
      name
      description
      priceLkr
      dietaryTags
      isAvailable
      inStock
      prepTimeMinutes
      imageUrl
    }
  }
}

query GetMenuItem($tenantId: ID!, $id: ID!) {
  getMenuItem(tenantId: $tenantId, id: $id) {
    id
    categoryId
    name
    description
    priceLkr
    dietaryTags
    isAvailable
    inStock
    prepTimeMinutes
    imageUrl
  }
}
`;

const ORDER_QUERIES = `query GetServiceOrder($tenantId: ID!, $id: ID!) {
  getServiceOrder(tenantId: $tenantId, id: $id) {
    id
    orderNumber
    orderSource
    orderStatus
    department
    roomNumber
    tableNumber
    items {
      id
      menuItemId
      name
      quantity
      unitPriceLkr
      itemTotalLkr
      specialInstructions
    }
    subtotalLkr
    serviceChargeLkr
    tdlLkr
    ssclLkr
    vatLkr
    totalAmountLkr
    createdAt
    updatedAt
  }
}

query ListActiveOrdersByDepartment($tenantId: ID!, $department: Department!) {
  listActiveOrdersByDepartment(tenantId: $tenantId, department: $department) {
    id
    orderNumber
    orderSource
    orderStatus
    department
    roomNumber
    tableNumber
    items {
      id
      name
      quantity
      unitPriceLkr
      itemTotalLkr
    }
    totalAmountLkr
    createdAt
    updatedAt
  }
}
`;

const FOLIO_QUERIES = `query GetFolio($tenantId: ID!, $id: ID!) {
  getFolio(tenantId: $tenantId, id: $id) {
    id
    folioNumber
    reservationId
    roomNumber
    guestId
    status
    currency
    baseAmountLkr
    serviceChargeLkr
    tdlLkr
    ssclLkr
    vatLkr
    totalDueLkr
    totalPaidLkr
    balanceLkr
    createdAt
    updatedAt
  }
}

query GetFolioWithLines($tenantId: ID!, $folioId: ID!) {
  getFolioWithLines(tenantId: $tenantId, folioId: $folioId) {
    id
    folioNumber
    roomNumber
    status
    lines {
      id
      chargeType
      description
      amountLkr
      serviceChargeLkr
      tdlLkr
      ssclLkr
      vatLkr
      totalLineLkr
      createdAt
    }
    totalDueLkr
    balanceLkr
  }
}

query GetFolioInvoice($tenantId: ID!, $id: ID!) {
  getFolioInvoice(tenantId: $tenantId, id: $id) {
    id
    invoiceNumber
    folioId
    guestName
    guestNationality
    guestNicOrPassport
    legalEntityName
    sltdaRegNumber
    vatRegNumber
    totalTaxExclusiveLkr
    serviceChargeLkr
    tdlLkr
    ssclLkr
    vatLkr
    grandTotalLkr
    paymentMethod
    issuedAt
  }
}
`;

const RESERVATION_QUERIES = `query GetReservation($tenantId: ID!, $id: ID!) {
  getReservation(tenantId: $tenantId, id: $id) {
    id
    confirmationCode
    roomNumber
    guestName
    guestPhone
    guestEmail
    guestNationality
    checkInDate
    checkOutDate
    adultsCount
    childrenCount
    status
    mealPlan
    totalAmountLkr
    advancePaymentLkr
    createdAt
  }
}

query ListReservations($tenantId: ID!, $status: ReservationStatus, $checkInDate: AWSDate) {
  listReservations(tenantId: $tenantId, status: $status, checkInDate: $checkInDate) {
    id
    confirmationCode
    roomNumber
    guestName
    guestPhone
    checkInDate
    checkOutDate
    status
    totalAmountLkr
  }
}
`;

const ORDER_MUTATIONS = `mutation CreateServiceOrder($tenantId: ID!, $input: CreateServiceOrderInput!) {
  createServiceOrder(tenantId: $tenantId, input: $input) {
    id
    orderNumber
    orderStatus
    roomNumber
    totalAmountLkr
    createdAt
  }
}

mutation UpdateOrderStatus($tenantId: ID!, $input: UpdateOrderStatusInput!) {
  updateOrderStatus(tenantId: $tenantId, input: $input) {
    id
    orderNumber
    orderStatus
    updatedAt
  }
}
`;

const ROOM_MUTATIONS = `mutation UpdateRoomHousekeepingStatus($tenantId: ID!, $roomId: ID!, $status: HousekeepingStatus!) {
  updateRoomHousekeepingStatus(tenantId: $tenantId, roomId: $roomId, status: $status) {
    id
    roomNumber
    housekeepingStatus
    updatedAt
  }
}
`;

const FOLIO_MUTATIONS = `mutation AddFolioCharge($tenantId: ID!, $input: AddFolioChargeInput!) {
  addFolioCharge(tenantId: $tenantId, input: $input) {
    id
    folioNumber
    baseAmountLkr
    serviceChargeLkr
    tdlLkr
    ssclLkr
    vatLkr
    totalDueLkr
    balanceLkr
  }
}

mutation SettleFolio($tenantId: ID!, $input: SettleFolioInput!) {
  settleFolio(tenantId: $tenantId, input: $input) {
    id
    invoiceNumber
    folioId
    grandTotalLkr
    paymentMethod
    issuedAt
  }
}
`;

const REALTIME_SUBSCRIPTIONS = `subscription OnServiceOrderCreated($tenantId: ID!) {
  onServiceOrderCreated(tenantId: $tenantId) {
    id
    orderNumber
    orderSource
    orderStatus
    department
    roomNumber
    tableNumber
    items {
      id
      name
      quantity
      unitPriceLkr
    }
    totalAmountLkr
    createdAt
  }
}

subscription OnOrderStatusUpdated($tenantId: ID!) {
  onOrderStatusUpdated(tenantId: $tenantId) {
    id
    orderNumber
    orderStatus
    department
    roomNumber
    updatedAt
  }
}

subscription OnRoomStatusChanged($tenantId: ID!) {
  onRoomStatusChanged(tenantId: $tenantId) {
    id
    roomNumber
    status
    housekeepingStatus
    updatedAt
  }
}

subscription OnFolioUpdated($tenantId: ID!) {
  onFolioUpdated(tenantId: $tenantId) {
    id
    folioNumber
    status
    totalDueLkr
    totalPaidLkr
    balanceLkr
    updatedAt
  }
}
`;

// Write individual files
writeFileSync(join(queriesDir, "hotel.graphql"), HOTEL_QUERIES, "utf8");
writeFileSync(join(queriesDir, "menu.graphql"), MENU_QUERIES, "utf8");
writeFileSync(join(queriesDir, "orders.graphql"), ORDER_QUERIES, "utf8");
writeFileSync(join(queriesDir, "folios.graphql"), FOLIO_QUERIES, "utf8");
writeFileSync(join(queriesDir, "reservations.graphql"), RESERVATION_QUERIES, "utf8");

writeFileSync(join(mutationsDir, "orders.graphql"), ORDER_MUTATIONS, "utf8");
writeFileSync(join(mutationsDir, "rooms.graphql"), ROOM_MUTATIONS, "utf8");
writeFileSync(join(mutationsDir, "folios.graphql"), FOLIO_MUTATIONS, "utf8");

writeFileSync(join(subscriptionsDir, "realtime.graphql"), REALTIME_SUBSCRIPTIONS, "utf8");

// Write bundled operations.graphql
const bundledOperations = `# ==============================================================================
# Sri Lanka HMS Mobile Flutter SDK - Complete Bundled Operation Definitions
# ==============================================================================

# --- QUERIES ---
${HOTEL_QUERIES}
${MENU_QUERIES}
${ORDER_QUERIES}
${FOLIO_QUERIES}
${RESERVATION_QUERIES}

# --- MUTATIONS ---
${ORDER_MUTATIONS}
${ROOM_MUTATIONS}
${FOLIO_MUTATIONS}

# --- REAL-TIME SUBSCRIPTIONS ---
${REALTIME_SUBSCRIPTIONS}
`;

writeFileSync(join(outputDir, "operations.graphql"), bundledOperations, "utf8");

// 3. Generate hms_aws_config.json
const hmsAwsConfig = {
  UserAgent: "aws-amplify-cli/2.0",
  Version: "1.0",
  auth: {
    plugins: {
      awsCognitoAuthPlugin: {
        UserAgent: "aws-amplify-cli/0.1.0",
        Version: "0.1.0",
        IdentityManager: {
          Default: {},
        },
        CredentialsProvider: {
          CognitoIdentity: {
            Default: {
              Region: "ap-south-1",
            },
          },
        },
        CognitoUserPool: {
          Default: {
            PoolId: "ap-south-1_dummyPoolId",
            AppClientId: "dummyAppClientId",
            Region: "ap-south-1",
          },
        },
        Auth: {
          Default: {
            authenticationFlowType: "USER_SRP_AUTH",
            socialProviders: [],
            usernameAttributes: ["EMAIL", "PHONE_NUMBER"],
            signupAttributes: ["EMAIL", "NAME", "PHONE_NUMBER"],
            passwordProtectionSettings: {
              passwordPolicyMinLength: 8,
              passwordPolicyCharacters: [],
            },
            mfaConfiguration: "OFF",
            mfaTypes: ["SMS"],
            verificationMechanisms: ["EMAIL"],
          },
        },
      },
    },
  },
  api: {
    plugins: {
      awsAPIPlugin: {
        hmsAppSyncApi: {
          endpointType: "GraphQL",
          endpoint: "https://dummy-appsync-api-id.appsync-api.ap-south-1.amazonaws.com/graphql",
          region: "ap-south-1",
          authorizationType: "AMAZON_COGNITO_USER_POOLS",
          apiKey: "da2-dummy-guest-qr-api-key",
        },
      },
    },
  },
  hmsCustom: {
    platform: "Sri Lanka Cloud SaaS HMS",
    defaultAwsRegion: "ap-south-1",
    realtimeEndpoint:
      "wss://dummy-appsync-api-id.appsync-realtime-api.ap-south-1.amazonaws.com/graphql",
    qrHmacScheme: "slhms://qr/:tenantId/:locationId?t=<hmac>",
    currency: "LKR",
    statutoryTaxSequence: [
      { code: "SC", ratePct: 10, description: "Mandatory Hospitality Service Charge" },
      { code: "TDL", ratePct: 1, description: "Tourism Development Levy on (Base + SC)" },
      {
        code: "SSCL",
        ratePct: 2.5,
        description: "Social Security Contribution Levy on (Base + SC)",
      },
      { code: "VAT", ratePct: 18, description: "Value Added Tax on compounded total" },
    ],
    freeTierGuardrails: {
      dynamoDbMaxStorageGb: 25,
      appSyncMonthlyOperationsLimit: 250000,
      lambdaMonthlyInvocationsLimit: 1000000,
      cloudFrontMonthlyEgressGb: 1000,
    },
  },
};

writeFileSync(
  join(outputDir, "hms_aws_config.json"),
  JSON.stringify(hmsAwsConfig, null, 2),
  "utf8",
);

// 4. Generate Flutter SDK README.md
const readmeContent = `# Sri Lanka HMS — Flutter / Dart SDK Contract Bundle

This directory contains the ready-to-import GraphQL contracts and AWS configuration for the upcoming **Sri Lanka HMS Cross-Platform Mobile Applications** (Guest Ordering, Waiter POS, Housekeeping Runner, and Kitchen KDS).

## Architecture Highlights
- **Single-Table Partition Isolation**: Every query and mutation validates \`tenantId\` (\`PK = TENANT#<id>\`).
- **AWS Free Tier Target**: Designed for AWS \`ap-south-1\` (Mumbai) serverless infrastructure avoiding DynamoDB PITR and NAT Gateway costs.
- **CBSL LankaQR & Statutory Tax Compounding**: Strict calculation sequence: \`Base -> 10% SC -> 1% TDL -> 2.5% SSCL -> 18% VAT\`.
- **Real-Time WebSocket Order Sync**: Subscriptions \`onServiceOrderCreated\` and \`onOrderStatusUpdated\` stream instant updates.

## Directory Structure
- \`schema.graphql\`: The complete 42-entity GraphQL schema.
- \`operations.graphql\`: All queries, mutations, and subscriptions in a single file.
- \`queries/\`: Modular queries for hotel tenants, room inventory, menus, folios, and reservations.
- \`mutations/\`: Service orders, status changes, and folio charges.
- \`subscriptions/\`: AppSync WebSocket subscriptions for instant KDS/POS notifications.
- \`hms_aws_config.json\`: AWS Amplify / custom client connection parameters.

## Integration Quick Start (Flutter / Dart)

### 1. Add Dependencies in \`pubspec.yaml\`
\`\`\`yaml
dependencies:
  graphql_flutter: ^5.1.2
  amplify_flutter: ^2.0.0
  amplify_api: ^2.0.0
  amplify_auth_cognito: ^2.0.0

dev_dependencies:
  build_runner: ^2.4.9
  graphql_codegen: ^0.14.0
\`\`\`

### 2. Configure \`graphql_codegen.yaml\`
\`\`\`yaml
schema: packages/graphql/flutter-sdk/schema.graphql
documents: packages/graphql/flutter-sdk/**/*.graphql
outputDirectory: lib/graphql/__generated__
namingConvention: pascalCase
\`\`\`

### 3. Generate Typed Dart Models
\`\`\`bash
dart run build_runner build --delete-conflicting-outputs
\`\`\`

### 4. Deep-Link QR Scanning Scheme
Contactless room service QR codes decode to:
\`\`\`
slhms://qr/:tenantId/:locationId?t=<hmacSha256Token>
\`\`\`
Where the mobile app extracts \`tenantId\` and \`locationId\` (e.g. \`ROOM_104\`) to query \`ListMenuCatalog\` using the embedded API key without requiring staff login.
`;

writeFileSync(join(outputDir, "README.md"), readmeContent, "utf8");

// Format exported contracts with Biome to ensure perfect code formatting
try {
  execSync(`npx biome check --write ${outputDir}`, { stdio: "ignore" });
} catch {
  // Graceful fallback if biome CLI is not in PATH
}

// Success notification via stdout
process.stdout.write(`
==============================================================================
Flutter SDK Contract Export Complete
==============================================================================
- Destination Directory: ${outputDir}
- Schema: ${join(outputDir, "schema.graphql")} (${originalSchema.length} bytes)
- Bundled Operations: ${join(outputDir, "operations.graphql")}
- Modular Queries: 5 files in queries/
- Modular Mutations: 3 files in mutations/
- Modular Subscriptions: 1 file in subscriptions/
- AWS & LankaQR Configuration: ${join(outputDir, "hms_aws_config.json")}
- Documentation: ${join(outputDir, "README.md")}
==============================================================================
`);
