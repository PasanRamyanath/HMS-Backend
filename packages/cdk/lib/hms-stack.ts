import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  Expiration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
  AuthorizationType,
  Code,
  Definition,
  type DynamoDbDataSource,
  FunctionRuntime,
  GraphqlApi,
} from "aws-cdk-lib/aws-appsync";
import {
  AccountRecovery,
  CfnUserPoolGroup,
  StringAttribute,
  UserPool,
  type UserPoolClient,
} from "aws-cdk-lib/aws-cognito";
import {
  AttributeType,
  BillingMode,
  type ITable,
  ProjectionType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SriLankaHmsStackProps extends StackProps {}

interface HmsUserGroupConfig {
  readonly groupName: string;
  readonly description: string;
  readonly precedence: number;
}

/**
 * 6 Core Cognito RBAC user groups mapping directly to Sri Lankan hotel operations
 * and GraphQL @aws_auth(cognito_groups: [...]) security boundaries.
 */
const HMS_USER_GROUPS: readonly HmsUserGroupConfig[] = [
  {
    groupName: "SUPER_ADMIN",
    description: "Platform Super Administrator across all tenant hotels",
    precedence: 1,
  },
  {
    groupName: "HOTEL_ADMIN",
    description: "Hotel General Manager / Owner with full property administration",
    precedence: 2,
  },
  {
    groupName: "FRONT_DESK",
    description: "Front Desk reception, check-in, check-out, and folio cashiering",
    precedence: 3,
  },
  {
    groupName: "KITCHEN_KDS",
    description: "Kitchen and Bar KDS display operators and station chefs",
    precedence: 4,
  },
  {
    groupName: "HOUSEKEEPING",
    description: "Housekeeping supervisors and room attendants",
    precedence: 5,
  },
  {
    groupName: "POS_CASHIER",
    description: "Restaurant, bar, and banquet point-of-sale cashiers",
    precedence: 6,
  },
] as const;

interface DirectJsResolverMapping {
  readonly typeName: "Query" | "Mutation";
  readonly fieldName: string;
  readonly file: string;
  readonly reqFn: string;
  readonly resFn: string;
}

/**
 * Compact declarative mapping table for all 35 direct AppSync JS DynamoDB resolvers.
 * Resolvers execute entirely in the AppSync edge runtime without Lambda invocations.
 */
const DIRECT_JS_RESOLVERS: readonly DirectJsResolverMapping[] = [
  // Hotel Tenant (hotelTenant.js)
  {
    typeName: "Query",
    fieldName: "getHotelTenant",
    file: "hotelTenant.js",
    reqFn: "getHotelTenantRequest",
    resFn: "getHotelTenantResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "upsertHotelTenant",
    file: "hotelTenant.js",
    reqFn: "upsertHotelTenantRequest",
    resFn: "upsertHotelTenantResponse",
  },

  // Rooms (rooms.js)
  {
    typeName: "Query",
    fieldName: "listRooms",
    file: "rooms.js",
    reqFn: "listRoomsRequest",
    resFn: "listRoomsResponse",
  },
  {
    typeName: "Query",
    fieldName: "getRoom",
    file: "rooms.js",
    reqFn: "getRoomRequest",
    resFn: "getRoomResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "upsertRoom",
    file: "rooms.js",
    reqFn: "upsertRoomRequest",
    resFn: "upsertRoomResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "updateRoomHousekeepingStatus",
    file: "rooms.js",
    reqFn: "updateRoomHousekeepingStatusRequest",
    resFn: "updateRoomHousekeepingStatusResponse",
  },

  // Menu Catalog (menuCatalog.js)
  {
    typeName: "Query",
    fieldName: "listMenuCatalog",
    file: "menuCatalog.js",
    reqFn: "listMenuCatalogRequest",
    resFn: "listMenuCatalogResponse",
  },
  {
    typeName: "Query",
    fieldName: "listMenuCategories",
    file: "menuCatalog.js",
    reqFn: "listMenuCategoriesRequest",
    resFn: "listMenuCategoriesResponse",
  },
  {
    typeName: "Query",
    fieldName: "listMenuItems",
    file: "menuCatalog.js",
    reqFn: "listMenuItemsRequest",
    resFn: "listMenuItemsResponse",
  },

  // Menu Mutations (menuMutations.js)
  {
    typeName: "Mutation",
    fieldName: "upsertMenuItem",
    file: "menuMutations.js",
    reqFn: "upsertMenuItemRequest",
    resFn: "upsertMenuItemResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "upsertMenuCategory",
    file: "menuMutations.js",
    reqFn: "upsertMenuCategoryRequest",
    resFn: "upsertMenuCategoryResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "toggleMenuItemStock",
    file: "menuMutations.js",
    reqFn: "toggleMenuItemStockRequest",
    resFn: "toggleMenuItemStockResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "toggleMenuItemAvailability",
    file: "menuMutations.js",
    reqFn: "toggleMenuItemAvailabilityRequest",
    resFn: "toggleMenuItemAvailabilityResponse",
  },

  // KDS Orders (kdsOrders.js)
  {
    typeName: "Query",
    fieldName: "listActiveOrdersByDepartment",
    file: "kdsOrders.js",
    reqFn: "listActiveOrdersByDepartmentRequest",
    resFn: "listActiveOrdersByDepartmentResponse",
  },
  {
    typeName: "Query",
    fieldName: "listActiveServiceOrders",
    file: "kdsOrders.js",
    reqFn: "listActiveServiceOrdersRequest",
    resFn: "listActiveServiceOrdersResponse",
  },
  {
    typeName: "Query",
    fieldName: "getServiceOrder",
    file: "kdsOrders.js",
    reqFn: "getServiceOrderRequest",
    resFn: "getServiceOrderResponse",
  },

  // Order Status Transitions (updateOrderStatus.js)
  {
    typeName: "Mutation",
    fieldName: "updateServiceOrderStatus",
    file: "updateOrderStatus.js",
    reqFn: "updateServiceOrderStatusRequest",
    resFn: "updateServiceOrderStatusResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "updateOrderStatus",
    file: "updateOrderStatus.js",
    reqFn: "updateOrderStatusRequest",
    resFn: "updateOrderStatusResponse",
  },

  // Reservations & Tape Chart (reservationsQuery.js)
  {
    typeName: "Query",
    fieldName: "listReservationsByDateRange",
    file: "reservationsQuery.js",
    reqFn: "listReservationsByDateRangeRequest",
    resFn: "listReservationsByDateRangeResponse",
  },
  {
    typeName: "Query",
    fieldName: "listReservations",
    file: "reservationsQuery.js",
    reqFn: "listReservationsRequest",
    resFn: "listReservationsResponse",
  },
  {
    typeName: "Query",
    fieldName: "getReservation",
    file: "reservationsQuery.js",
    reqFn: "getReservationRequest",
    resFn: "getReservationResponse",
  },

  // Guest Folios (folioQuery.js)
  {
    typeName: "Query",
    fieldName: "getFolioWithLines",
    file: "folioQuery.js",
    reqFn: "getFolioWithLinesRequest",
    resFn: "getFolioWithLinesResponse",
  },
  {
    typeName: "Query",
    fieldName: "getFolio",
    file: "folioQuery.js",
    reqFn: "getFolioRequest",
    resFn: "getFolioResponse",
  },
  {
    typeName: "Query",
    fieldName: "listFoliosForReservation",
    file: "folioQuery.js",
    reqFn: "listFoliosForReservationRequest",
    resFn: "listFoliosForReservationResponse",
  },

  // Banquets & Weddings (banquets.js)
  {
    typeName: "Query",
    fieldName: "listBanquetEvents",
    file: "banquets.js",
    reqFn: "listBanquetEventsRequest",
    resFn: "listBanquetEventsResponse",
  },
  {
    typeName: "Query",
    fieldName: "getBanquetEvent",
    file: "banquets.js",
    reqFn: "getBanquetEventRequest",
    resFn: "getBanquetEventResponse",
  },
  {
    typeName: "Query",
    fieldName: "listBanquetHalls",
    file: "banquets.js",
    reqFn: "listBanquetHallsRequest",
    resFn: "listBanquetHallsResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "upsertBanquetHall",
    file: "banquets.js",
    reqFn: "upsertBanquetHallRequest",
    resFn: "upsertBanquetHallResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "upsertBanquetEvent",
    file: "banquets.js",
    reqFn: "upsertBanquetEventRequest",
    resFn: "upsertBanquetEventResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "createBanquetEvent",
    file: "banquets.js",
    reqFn: "createBanquetEventRequest",
    resFn: "createBanquetEventResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "updateBanquetEventStatus",
    file: "banquets.js",
    reqFn: "updateBanquetEventStatusRequest",
    resFn: "updateBanquetEventStatusResponse",
  },

  // Store Inventory & SLTDA Statutory Reports (reportsAndStock.js)
  {
    typeName: "Query",
    fieldName: "listStockItems",
    file: "reportsAndStock.js",
    reqFn: "listStockItemsRequest",
    resFn: "listStockItemsResponse",
  },
  {
    typeName: "Query",
    fieldName: "listSltdaMonthlyReports",
    file: "reportsAndStock.js",
    reqFn: "listSltdaMonthlyReportsRequest",
    resFn: "listSltdaMonthlyReportsResponse",
  },
  {
    typeName: "Query",
    fieldName: "getSltdaMonthlyReturn",
    file: "reportsAndStock.js",
    reqFn: "getSltdaMonthlyReturnRequest",
    resFn: "getSltdaMonthlyReturnResponse",
  },
  {
    typeName: "Query",
    fieldName: "getNightAuditReport",
    file: "reportsAndStock.js",
    reqFn: "getNightAuditReportRequest",
    resFn: "getNightAuditReportResponse",
  },
] as const;

/**
 * Sri Lankan Cloud SaaS HMS Serverless Infrastructure Stack.
 * Provisions the permanent AWS Free-Tier compliant stack in ap-south-1 (Mumbai):
 * - Single-Table DynamoDB (20 RCU / 20 WCU total across base table + GSIs)
 * - Cognito User Pool with RBAC groups
 * - AppSync GraphQL API with direct APPSYNC_JS resolvers
 * - ARM_64 Graviton2 Lambdas (Node.js 22)
 * - 7-day CloudWatch log retention
 * - Zero NAT Gateways / Zero RDS / Zero OpenSearch instances
 */
export class SriLankaHmsStack extends Stack {
  public readonly deploymentRegion: string;
  public readonly hmsTable: Table;
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly userGroups: Record<string, CfnUserPoolGroup>;
  public readonly qrAuthorizerFn: NodejsFunction;
  public readonly api: GraphqlApi;
  public readonly dbDataSource: DynamoDbDataSource;

  constructor(scope: Construct, id: string, props?: SriLankaHmsStackProps) {
    super(scope, id, props);

    this.deploymentRegion = this.region;

    // Single-table DynamoDB for all 42 multi-tenant SaaS entities
    // Base table allocated 10 RCU / 10 WCU
    this.hmsTable = new Table(this, "HmsTable", {
      tableName: "HmsSingleTable",
      partitionKey: {
        name: "PK",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "SK",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PROVISIONED,
      readCapacity: 10,
      writeCapacity: 10,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
    });

    // GSI1: Primary multi-entity inversion index (e.g., GSI1PK = TENANT#<id>#ORDERS, GSI1SK = <status>#<timestamp>)
    // Allocated 5 RCU / 5 WCU
    this.hmsTable.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: {
        name: "GSI1PK",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "GSI1SK",
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5,
    });

    // GSI2: Secondary cross-entity / date-range index (e.g., GSI2PK = TENANT#<id>#RESERVATIONS, GSI2SK = <checkInDate>)
    // Allocated 5 RCU / 5 WCU
    this.hmsTable.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: {
        name: "GSI2PK",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "GSI2SK",
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5,
    });

    // Cognito User Pool for multi-tenant hotel staff & super-admins
    // Free Tier allows 50,000 MAUs per month with Cognito Essentials/Lite
    this.userPool = new UserPool(this, "HmsUserPool", {
      userPoolName: "HmsUserPool",
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        phone: true,
      },
      autoVerify: {
        email: true,
        phone: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        phoneNumber: {
          required: false,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        tenantId: new StringAttribute({
          minLen: 1,
          maxLen: 128,
          mutable: false,
        }),
        department: new StringAttribute({
          minLen: 1,
          maxLen: 64,
          mutable: true,
        }),
        role: new StringAttribute({
          minLen: 1,
          maxLen: 64,
          mutable: true,
        }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Web / PWA client without client secret for browser authentication
    this.userPoolClient = this.userPool.addClient("HmsWebClient", {
      userPoolClientName: "HmsWebClient",
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
    });

    // 6 Cognito User Groups for Role-Based Access Control (RBAC)
    // Enforces AppSync GraphQL @aws_auth(cognito_groups: [...])
    const groups: Record<string, CfnUserPoolGroup> = {};
    for (const group of HMS_USER_GROUPS) {
      groups[group.groupName] = new CfnUserPoolGroup(this, `Group${group.groupName}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: group.groupName,
        description: group.description,
        precedence: group.precedence,
      });
    }
    this.userGroups = groups;

    // ARM_64 Graviton2 AppSync Custom Lambda Authorizer for zero-login guest QR ordering
    // Log group with 7-day retention prevents CloudWatch log cost accumulation
    const authorizerLogGroup = new LogGroup(this, "QrAuthorizerLogGroup", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.qrAuthorizerFn = new NodejsFunction(this, "QrAuthorizerFn", {
      entry: resolve(__dirname, "../lambdas/qrAuthorizer.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(5),
      memorySize: 128,
      logGroup: authorizerLogGroup,
      environment: {
        QR_HMAC_SECRET: "sri-lanka-hms-guest-qr-secret-key-change-in-prod",
      },
      bundling: {
        minify: true,
        sourceMap: false,
        target: "es2022",
      },
    });

    // AWS AppSync Managed GraphQL API with Dual Auth (USER_POOLS + LAMBDA)
    // - Default Auth: Cognito User Pool (Staff, General Manager, POS Cashier, Super Admin)
    // - Additional Auth 1: Lambda Authorizer (Contactless Guest QR session tokens)
    // - Additional Auth 2: AWS IAM (Backend transactional Lambdas & event processors)
    // - Additional Auth 3: API Key (Public metadata & health checks)
    // - Verbose logging and X-Ray tracing disabled to preserve AWS Free Tier
    this.api = new GraphqlApi(this, "HmsApi", {
      name: "HmsGraphQLApi",
      definition: Definition.fromFile(resolve(__dirname, "../../graphql/schema.graphql")),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: this.userPool,
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.LAMBDA,
            lambdaAuthorizerConfig: {
              handler: this.qrAuthorizerFn,
              resultsCacheTtl: Duration.minutes(5),
            },
          },
          {
            authorizationType: AuthorizationType.IAM,
          },
          {
            authorizationType: AuthorizationType.API_KEY,
            apiKeyConfig: {
              expires: Expiration.after(Duration.days(365)),
              description: "Public Guest API Key",
            },
          },
        ],
      },
      xrayEnabled: false,
    });

    // Wire HmsTable as AppSync DynamoDB Data Source
    this.dbDataSource = this.api.addDynamoDbDataSource(
      "HmsTableDs",
      this.hmsTable as unknown as ITable,
    );

    // Register all 35 direct AppSync JS DynamoDB resolvers from compiled dist/resolvers
    const resolversDir = resolve(__dirname, "../../graphql/dist/resolvers");
    for (const r of DIRECT_JS_RESOLVERS) {
      const codePath = resolve(resolversDir, r.file);
      const rawCode = readFileSync(codePath, "utf8");
      const adaptedCode = `${rawCode}\nexport const request = ${r.reqFn};\nexport const response = ${r.resFn};\n`;
      this.dbDataSource.createResolver(`Resolver${r.typeName}${r.fieldName}`, {
        typeName: r.typeName,
        fieldName: r.fieldName,
        code: Code.fromInline(adaptedCode),
        runtime: FunctionRuntime.JS_1_0_0,
      });
    }

    // Stack Outputs for automated CI/CD and Frontend environment configuration
    new CfnOutput(this, "HmsTableArn", {
      value: this.hmsTable.tableArn,
      description: "DynamoDB Single-Table ARN",
      exportName: "HmsTableArn",
    });

    new CfnOutput(this, "HmsTableName", {
      value: this.hmsTable.tableName,
      description: "DynamoDB Single-Table Name",
      exportName: "HmsTableName",
    });

    new CfnOutput(this, "HmsUserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID for Sri Lanka HMS",
      exportName: "HmsUserPoolId",
    });

    new CfnOutput(this, "HmsUserPoolArn", {
      value: this.userPool.userPoolArn,
      description: "Cognito User Pool ARN for Sri Lanka HMS",
      exportName: "HmsUserPoolArn",
    });

    new CfnOutput(this, "HmsUserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito User Pool Web Client ID for Sri Lanka HMS",
      exportName: "HmsUserPoolClientId",
    });

    new CfnOutput(this, "HmsGraphQLApiId", {
      value: this.api.apiId,
      description: "AppSync GraphQL API ID for Sri Lanka HMS",
      exportName: "HmsGraphQLApiId",
    });

    new CfnOutput(this, "HmsGraphQLApiUrl", {
      value: this.api.graphqlUrl,
      description: "AppSync GraphQL API Endpoint URL",
      exportName: "HmsGraphQLApiUrl",
    });

    new CfnOutput(this, "HmsGraphQLApiArn", {
      value: this.api.arn,
      description: "AppSync GraphQL API ARN",
      exportName: "HmsGraphQLApiArn",
    });
  }
}
