# Sri Lanka HMS — Flutter / Dart SDK Contract Bundle

This directory contains the ready-to-import GraphQL contracts and AWS configuration for the upcoming **Sri Lanka HMS Cross-Platform Mobile Applications** (Guest Ordering, Waiter POS, Housekeeping Runner, and Kitchen KDS).

## Architecture Highlights
- **Single-Table Partition Isolation**: Every query and mutation validates `tenantId` (`PK = TENANT#<id>`).
- **AWS Free Tier Target**: Designed for AWS `ap-south-1` (Mumbai) serverless infrastructure avoiding DynamoDB PITR and NAT Gateway costs.
- **CBSL LankaQR & Statutory Tax Compounding**: Strict calculation sequence: `Base -> 10% SC -> 1% TDL -> 2.5% SSCL -> 18% VAT`.
- **Real-Time WebSocket Order Sync**: Subscriptions `onServiceOrderCreated` and `onOrderStatusUpdated` stream instant updates.

## Directory Structure
- `schema.graphql`: The complete 42-entity GraphQL schema.
- `operations.graphql`: All queries, mutations, and subscriptions in a single file.
- `queries/`: Modular queries for hotel tenants, room inventory, menus, folios, and reservations.
- `mutations/`: Service orders, status changes, and folio charges.
- `subscriptions/`: AppSync WebSocket subscriptions for instant KDS/POS notifications.
- `hms_aws_config.json`: AWS Amplify / custom client connection parameters.

## Integration Quick Start (Flutter / Dart)

### 1. Add Dependencies in `pubspec.yaml`
```yaml
dependencies:
  graphql_flutter: ^5.1.2
  amplify_flutter: ^2.0.0
  amplify_api: ^2.0.0
  amplify_auth_cognito: ^2.0.0

dev_dependencies:
  build_runner: ^2.4.9
  graphql_codegen: ^0.14.0
```

### 2. Configure `graphql_codegen.yaml`
```yaml
schema: packages/graphql/flutter-sdk/schema.graphql
documents: packages/graphql/flutter-sdk/**/*.graphql
outputDirectory: lib/graphql/__generated__
namingConvention: pascalCase
```

### 3. Generate Typed Dart Models
```bash
dart run build_runner build --delete-conflicting-outputs
```

### 4. Deep-Link QR Scanning Scheme
Contactless room service QR codes decode to:
```
slhms://qr/:tenantId/:locationId?t=<hmacSha256Token>
```
Where the mobile app extracts `tenantId` and `locationId` (e.g. `ROOM_104`) to query `ListMenuCatalog` using the embedded API key without requiring staff login.
