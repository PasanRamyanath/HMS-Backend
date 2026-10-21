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
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import {
  CachePolicy,
  Distribution,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
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
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import {
  Architecture,
  type FunctionUrl,
  FunctionUrlAuthType,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SriLankaHmsStackProps extends StackProps {
  readonly budgetAlertEmail?: string;
}

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
 * Compact declarative mapping table for all 52 direct AppSync JS DynamoDB resolvers.
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

  // Housekeeping Operations: Maintenance Tickets & Lost-and-Found (housekeepingOps.js)
  {
    typeName: "Query",
    fieldName: "getMaintenanceTicket",
    file: "housekeepingOps.js",
    reqFn: "getMaintenanceTicketRequest",
    resFn: "getMaintenanceTicketResponse",
  },
  {
    typeName: "Query",
    fieldName: "listMaintenanceTickets",
    file: "housekeepingOps.js",
    reqFn: "listMaintenanceTicketsRequest",
    resFn: "listMaintenanceTicketsResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "createMaintenanceTicket",
    file: "housekeepingOps.js",
    reqFn: "createMaintenanceTicketRequest",
    resFn: "createMaintenanceTicketResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "updateMaintenanceTicketStatus",
    file: "housekeepingOps.js",
    reqFn: "updateMaintenanceTicketStatusRequest",
    resFn: "updateMaintenanceTicketStatusResponse",
  },
  {
    typeName: "Query",
    fieldName: "getLostFoundItem",
    file: "housekeepingOps.js",
    reqFn: "getLostFoundItemRequest",
    resFn: "getLostFoundItemResponse",
  },
  {
    typeName: "Query",
    fieldName: "listLostFoundItems",
    file: "housekeepingOps.js",
    reqFn: "listLostFoundItemsRequest",
    resFn: "listLostFoundItemsResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "logLostFoundItem",
    file: "housekeepingOps.js",
    reqFn: "logLostFoundItemRequest",
    resFn: "logLostFoundItemResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "updateLostFoundStatus",
    file: "housekeepingOps.js",
    reqFn: "updateLostFoundStatusRequest",
    resFn: "updateLostFoundStatusResponse",
  },

  // Spa, Excursions, Safari Jeeps & Airport Transfers (activities.js)
  {
    typeName: "Query",
    fieldName: "getExcursionBooking",
    file: "activities.js",
    reqFn: "getExcursionBookingRequest",
    resFn: "getExcursionBookingResponse",
  },
  {
    typeName: "Query",
    fieldName: "listExcursionBookings",
    file: "activities.js",
    reqFn: "listExcursionBookingsRequest",
    resFn: "listExcursionBookingsResponse",
  },
  {
    typeName: "Query",
    fieldName: "getAyurvedaAppointment",
    file: "activities.js",
    reqFn: "getAyurvedaAppointmentRequest",
    resFn: "getAyurvedaAppointmentResponse",
  },
  {
    typeName: "Query",
    fieldName: "listAyurvedaAppointments",
    file: "activities.js",
    reqFn: "listAyurvedaAppointmentsRequest",
    resFn: "listAyurvedaAppointmentsResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "createExcursionBooking",
    file: "activities.js",
    reqFn: "createExcursionBookingRequest",
    resFn: "createExcursionBookingResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "createAyurvedaAppointment",
    file: "activities.js",
    reqFn: "createAyurvedaAppointmentRequest",
    resFn: "createAyurvedaAppointmentResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "createActivityBooking",
    file: "activities.js",
    reqFn: "createActivityBookingRequest",
    resFn: "createActivityBookingResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "updateExcursionStatus",
    file: "activities.js",
    reqFn: "updateExcursionStatusRequest",
    resFn: "updateExcursionStatusResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "updateAyurvedaAppointmentStatus",
    file: "activities.js",
    reqFn: "updateAyurvedaAppointmentStatusRequest",
    resFn: "updateAyurvedaAppointmentStatusResponse",
  },

  // Store Inventory, Procurement & FIFO Vouchers (inventoryOps.js)
  {
    typeName: "Query",
    fieldName: "getStockItem",
    file: "inventoryOps.js",
    reqFn: "getStockItemRequest",
    resFn: "getStockItemResponse",
  },
  {
    typeName: "Query",
    fieldName: "getPurchaseOrder",
    file: "inventoryOps.js",
    reqFn: "getPurchaseOrderRequest",
    resFn: "getPurchaseOrderResponse",
  },
  {
    typeName: "Query",
    fieldName: "listPurchaseOrders",
    file: "inventoryOps.js",
    reqFn: "listPurchaseOrdersRequest",
    resFn: "listPurchaseOrdersResponse",
  },
  {
    typeName: "Query",
    fieldName: "getInventoryVoucher",
    file: "inventoryOps.js",
    reqFn: "getInventoryVoucherRequest",
    resFn: "getInventoryVoucherResponse",
  },
  {
    typeName: "Query",
    fieldName: "listInventoryVouchers",
    file: "inventoryOps.js",
    reqFn: "listInventoryVouchersRequest",
    resFn: "listInventoryVouchersResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "upsertStockItem",
    file: "inventoryOps.js",
    reqFn: "upsertStockItemRequest",
    resFn: "upsertStockItemResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "recordGrn",
    file: "inventoryOps.js",
    reqFn: "recordGrnRequest",
    resFn: "recordGrnResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "createGoodsIssueNote",
    file: "inventoryOps.js",
    reqFn: "createGoodsIssueNoteRequest",
    resFn: "createGoodsIssueNoteResponse",
  },

  // HR, Roster, Attendance & Payroll (hrPayroll.js)
  {
    typeName: "Query",
    fieldName: "getDepartmentRoster",
    file: "hrPayroll.js",
    reqFn: "getDepartmentRosterRequest",
    resFn: "getDepartmentRosterResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "saveDepartmentRoster",
    file: "hrPayroll.js",
    reqFn: "saveDepartmentRosterRequest",
    resFn: "saveDepartmentRosterResponse",
  },
  {
    typeName: "Query",
    fieldName: "getStaffAttendance",
    file: "hrPayroll.js",
    reqFn: "getStaffAttendanceRequest",
    resFn: "getStaffAttendanceResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "recordStaffAttendance",
    file: "hrPayroll.js",
    reqFn: "recordStaffAttendanceRequest",
    resFn: "recordStaffAttendanceResponse",
  },
  {
    typeName: "Query",
    fieldName: "getStaffScPoolStatement",
    file: "hrPayroll.js",
    reqFn: "getStaffScPoolStatementRequest",
    resFn: "getStaffScPoolStatementResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "distributeStaffScPool",
    file: "hrPayroll.js",
    reqFn: "distributeStaffScPoolRequest",
    resFn: "distributeStaffScPoolResponse",
  },
  {
    typeName: "Query",
    fieldName: "getMonthlyPayroll",
    file: "hrPayroll.js",
    reqFn: "getMonthlyPayrollRequest",
    resFn: "getMonthlyPayrollResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "runMonthlyPayroll",
    file: "hrPayroll.js",
    reqFn: "runMonthlyPayrollRequest",
    resFn: "runMonthlyPayrollResponse",
  },
  {
    typeName: "Query",
    fieldName: "listStaffLeaveRequests",
    file: "hrPayroll.js",
    reqFn: "listStaffLeaveRequestsRequest",
    resFn: "listStaffLeaveRequestsResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "submitStaffLeaveRequest",
    file: "hrPayroll.js",
    reqFn: "submitStaffLeaveRequestRequest",
    resFn: "submitStaffLeaveRequestResponse",
  },
  {
    typeName: "Mutation",
    fieldName: "approveStaffLeaveRequest",
    file: "hrPayroll.js",
    reqFn: "approveStaffLeaveRequestRequest",
    resFn: "approveStaffLeaveRequestResponse",
  },
] as const;

interface LeanLambdaOptions {
  readonly memorySize?: number | undefined;
  readonly timeout?: Duration | undefined;
  readonly environment?: Record<string, string> | undefined;
}

/**
 * Creates an optimized ARM_64 Graviton2 Node.js 22 Lambda with 7-day log retention.
 * Enforces strict AWS Free-Tier compute and CloudWatch log limits.
 */
function createLeanLambda(
  scope: Construct,
  id: string,
  entry: string,
  options: LeanLambdaOptions = {},
): NodejsFunction {
  const logGroup = new LogGroup(scope, `${id}LogGroup`, {
    retention: RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });

  return new NodejsFunction(scope, id, {
    entry,
    handler: "handler",
    runtime: Runtime.NODEJS_22_X,
    architecture: Architecture.ARM_64,
    memorySize: options.memorySize ?? 192,
    timeout: options.timeout ?? Duration.seconds(10),
    logGroup,
    bundling: {
      minify: true,
      sourceMap: false,
      target: "es2022",
    },
    ...(options.environment ? { environment: options.environment } : {}),
  });
}

function createCognitoUserGroups(
  scope: Construct,
  userPoolId: string,
): Record<string, CfnUserPoolGroup> {
  const groups: Record<string, CfnUserPoolGroup> = {};
  for (const group of HMS_USER_GROUPS) {
    groups[group.groupName] = new CfnUserPoolGroup(scope, `Group${group.groupName}`, {
      userPoolId,
      groupName: group.groupName,
      description: group.description,
      precedence: group.precedence,
    });
  }
  return groups;
}

function registerDirectJsResolvers(dataSource: DynamoDbDataSource, resolversDir: string): void {
  for (const r of DIRECT_JS_RESOLVERS) {
    const codePath = resolve(resolversDir, r.file);
    const rawCode = readFileSync(codePath, "utf8");
    const adaptedCode = `${rawCode}\nexport const request = ${r.reqFn};\nexport const response = ${r.resFn};\n`;
    dataSource.createResolver(`Resolver${r.typeName}${r.fieldName}`, {
      typeName: r.typeName,
      fieldName: r.fieldName,
      code: Code.fromInline(adaptedCode),
      runtime: FunctionRuntime.JS_1_0_0,
    });
  }
}

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
  public readonly orderAndFolioTxFn: NodejsFunction;
  public readonly reservationAndCheckInTxFn: NodejsFunction;
  public readonly webhooksIngressFn: NodejsFunction;
  public readonly webhooksUrl: FunctionUrl;
  public readonly nightAuditCronFn: NodejsFunction;
  public readonly nightAuditRule: Rule;
  public readonly presignMediaUploadFn: NodejsFunction;
  public readonly assetBucket: Bucket;
  public readonly distribution: Distribution;
  public readonly securityHeadersPolicy: ResponseHeadersPolicy;
  public readonly costBudget: CfnBudget;

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

    // Single S3 Bucket for React 19 SPA static assets and tenant WebP media
    // Rung 4: 100% blocked public access (served through CloudFront OAC in Step 091)
    // S3-managed encryption avoids KMS key hourly charges in Free Tier
    this.assetBucket = new Bucket(this, "HmsAssetBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD, HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    // CloudFront Distribution using permanent 1 TB/month Always Free tier
    // - Origin Access Control (OAC) to HmsAssetBucket (100% blocked public access)
    // - PriceClass.PRICE_CLASS_ALL includes Mumbai, Chennai, and Colombo edge POPs
    // - SPA fallback: HTTP 403 & 404 rewrite to /index.html with HTTP 200 OK
    // - CachingOptimized policy for /assets/* and /media/*
    const s3Origin = S3BucketOrigin.withOriginAccessControl(this.assetBucket as unknown as IBucket);

    // Native CloudFront ResponseHeadersPolicy (100% Free Tier, zero Lambda@Edge cost)
    // Enforces strict CSP, HSTS (365 days), X-Frame-Options DENY, XSS protection, and referrer policy
    this.securityHeadersPolicy = new ResponseHeadersPolicy(this, "HmsSecurityHeadersPolicy", {
      responseHeadersPolicyName: "HmsStrictSecurityHeadersPolicy",
      comment:
        "Strict security headers (CSP, HSTS, X-Frame-Options, XSS, Referrer) for Sri Lanka HMS Free Tier",
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy:
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: {
          override: true,
        },
        frameOptions: {
          frameOption: HeadersFrameOption.DENY,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    this.distribution = new Distribution(this, "HmsCloudFront", {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: this.securityHeadersPolicy,
      },
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_ALL,
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.seconds(0),
        },
      ],
      additionalBehaviors: {
        "/assets/*": {
          origin: s3Origin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: this.securityHeadersPolicy,
        },
        "/media/*": {
          origin: s3Origin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: this.securityHeadersPolicy,
        },
      },
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
    this.userGroups = createCognitoUserGroups(this, this.userPool.userPoolId);

    // ARM_64 Graviton2 AppSync Custom Lambda Authorizer for zero-login guest QR ordering
    this.qrAuthorizerFn = createLeanLambda(
      this,
      "QrAuthorizerFn",
      resolve(__dirname, "../lambdas/qrAuthorizer.ts"),
      {
        memorySize: 128,
        timeout: Duration.seconds(5),
        environment: {
          QR_HMAC_SECRET: "sri-lanka-hms-guest-qr-secret-key-change-in-prod",
        },
      },
    );

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
    registerDirectJsResolvers(this.dbDataSource, resolversDir);

    // Common environment variable for multi-tenant DynamoDB operations
    const lambdaEnv = {
      TABLE_NAME: this.hmsTable.tableName,
    };

    // 1. Transactional Order & Folio Posting Lambda
    this.orderAndFolioTxFn = createLeanLambda(
      this,
      "OrderAndFolioTxFn",
      resolve(__dirname, "../lambdas/orderAndFolioTx.ts"),
      {
        memorySize: 192,
        timeout: Duration.seconds(10),
        environment: lambdaEnv,
      },
    );
    this.hmsTable.grantReadWriteData(this.orderAndFolioTxFn);

    // 2. Reservation, Chauffeur Driver Bed & Check-In/Check-Out Transaction Lambda
    this.reservationAndCheckInTxFn = createLeanLambda(
      this,
      "ReservationAndCheckInTxFn",
      resolve(__dirname, "../lambdas/reservationAndCheckInTx.ts"),
      {
        memorySize: 192,
        timeout: Duration.seconds(10),
        environment: {
          ...lambdaEnv,
          QR_HMAC_SECRET: "sri-lanka-hms-guest-qr-secret-key-change-in-prod",
        },
      },
    );
    this.hmsTable.grantReadWriteData(this.reservationAndCheckInTxFn);

    // 3. Unified Webhook Ingress Lambda (PayHere, WebXPay, Channex, SMSGo) with Function URL
    this.webhooksIngressFn = createLeanLambda(
      this,
      "WebhooksIngressFn",
      resolve(__dirname, "../lambdas/webhooksIngress.ts"),
      {
        memorySize: 192,
        timeout: Duration.seconds(10),
        environment: {
          ...lambdaEnv,
          PAYHERE_SECRET: "sri-lanka-hms-payhere-secret-change-in-prod",
          WEBXPAY_SECRET: "sri-lanka-hms-webxpay-secret-change-in-prod",
          CHANNEX_SECRET: "sri-lanka-hms-channex-secret-change-in-prod",
          SMSGO_SECRET: "sri-lanka-hms-smsgo-secret-change-in-prod",
        },
      },
    );
    this.hmsTable.grantReadWriteData(this.webhooksIngressFn);
    this.webhooksUrl = this.webhooksIngressFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
    });

    // 4. Night Audit & CBSL Exchange Rate Rollover Lambda
    this.nightAuditCronFn = createLeanLambda(
      this,
      "NightAuditCronFn",
      resolve(__dirname, "../lambdas/nightAuditCron.ts"),
      {
        memorySize: 192,
        timeout: Duration.seconds(30),
        environment: lambdaEnv,
      },
    );
    this.hmsTable.grantReadWriteData(this.nightAuditCronFn);

    // EventBridge Daily Scheduled Rule at 23:59 Sri Lanka Standard Time (18:29 UTC)
    this.nightAuditRule = new Rule(this, "NightAuditRule", {
      schedule: Schedule.cron({ minute: "29", hour: "18" }),
      description: "Triggers Sri Lanka HMS Night Audit daily at 23:59 Asia/Colombo (18:29 UTC)",
      targets: [new LambdaFunction(this.nightAuditCronFn)],
    });

    // 5. S3 Presigned WebP Media Upload URL Generator Lambda
    this.presignMediaUploadFn = createLeanLambda(
      this,
      "PresignMediaUploadFn",
      resolve(__dirname, "../lambdas/presignMediaUpload.ts"),
      {
        memorySize: 192,
        timeout: Duration.seconds(10),
        environment: {
          ...lambdaEnv,
          MEDIA_BUCKET_NAME: this.assetBucket.bucketName,
        },
      },
    );
    this.hmsTable.grantReadWriteData(this.presignMediaUploadFn);
    this.assetBucket.grantPut(this.presignMediaUploadFn);
    this.assetBucket.grantRead(this.presignMediaUploadFn);

    // AWS Budgets $1.00 Monthly Zero-Spend Cost Guardrail Alert
    const budgetAlertEmail = props?.budgetAlertEmail ?? "alerts@srilanka-hms.local";
    this.costBudget = new CfnBudget(this, "HmsZeroSpendBudget", {
      budget: {
        budgetName: "HmsPermanentFreeTierBudget",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: {
          amount: 1,
          unit: "USD",
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "ACTUAL",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            {
              subscriptionType: "EMAIL",
              address: budgetAlertEmail,
            },
          ],
        },
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "FORECASTED",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [
            {
              subscriptionType: "EMAIL",
              address: budgetAlertEmail,
            },
          ],
        },
      ],
    });

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

    new CfnOutput(this, "HmsAssetBucketName", {
      value: this.assetBucket.bucketName,
      description: "S3 Asset & Tenant WebP Media Bucket Name",
      exportName: "HmsAssetBucketName",
    });

    new CfnOutput(this, "HmsAssetBucketArn", {
      value: this.assetBucket.bucketArn,
      description: "S3 Asset & Tenant WebP Media Bucket ARN",
      exportName: "HmsAssetBucketArn",
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

    new CfnOutput(this, "OrderAndFolioTxFnArn", {
      value: this.orderAndFolioTxFn.functionArn,
      description: "Transactional Order & Folio Posting Lambda ARN",
      exportName: "OrderAndFolioTxFnArn",
    });

    new CfnOutput(this, "ReservationAndCheckInTxFnArn", {
      value: this.reservationAndCheckInTxFn.functionArn,
      description: "Reservation & Check-In/Check-Out Lambda ARN",
      exportName: "ReservationAndCheckInTxFnArn",
    });

    new CfnOutput(this, "WebhooksIngressUrl", {
      value: this.webhooksUrl.url,
      description: "Unified Webhook Ingress Lambda Function URL",
      exportName: "WebhooksIngressUrl",
    });

    new CfnOutput(this, "NightAuditCronFnArn", {
      value: this.nightAuditCronFn.functionArn,
      description: "Night Audit & CBSL Exchange Rate Rollover Lambda ARN",
      exportName: "NightAuditCronFnArn",
    });

    new CfnOutput(this, "NightAuditRuleArn", {
      value: this.nightAuditRule.ruleArn,
      description: "EventBridge Night Audit Daily Scheduled Rule ARN",
      exportName: "NightAuditRuleArn",
    });

    new CfnOutput(this, "PresignMediaUploadFnArn", {
      value: this.presignMediaUploadFn.functionArn,
      description: "S3 Presigned WebP Media Upload Lambda ARN",
      exportName: "PresignMediaUploadFnArn",
    });

    new CfnOutput(this, "HmsDistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront Distribution ID for Sri Lanka HMS",
      exportName: "HmsDistributionId",
    });

    new CfnOutput(this, "HmsDistributionDomainName", {
      value: this.distribution.distributionDomainName,
      description: "CloudFront Distribution Domain Name",
      exportName: "HmsDistributionDomainName",
    });

    new CfnOutput(this, "HmsCloudFrontUrl", {
      value: `https://${this.distribution.distributionDomainName}`,
      description: "CloudFront Distribution Web URL",
      exportName: "HmsCloudFrontUrl",
    });

    new CfnOutput(this, "HmsSecurityHeadersPolicyId", {
      value: this.securityHeadersPolicy.responseHeadersPolicyId,
      description: "CloudFront Security Headers Policy ID for Sri Lanka HMS",
      exportName: "HmsSecurityHeadersPolicyId",
    });

    new CfnOutput(this, "HmsBudgetId", {
      value: this.costBudget.ref,
      description: "AWS Budgets Zero-Spend $1.00 Cost Alert ID",
      exportName: "HmsBudgetId",
    });
  }
}
