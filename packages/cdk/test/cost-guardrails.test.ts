import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { GitHubOidcStack } from "../lib/github-oidc-stack.js";
import { SriLankaHmsStack } from "../lib/hms-stack.js";

interface ProvisionedUnits {
  rcu: number;
  wcu: number;
}

function sumGsiThroughput(indexes: unknown): ProvisionedUnits {
  if (!Array.isArray(indexes)) {
    return { rcu: 0, wcu: 0 };
  }
  return indexes.reduce<ProvisionedUnits>(
    (acc, gsi) => ({
      rcu: acc.rcu + Number(gsi?.ProvisionedThroughput?.ReadCapacityUnits ?? 0),
      wcu: acc.wcu + Number(gsi?.ProvisionedThroughput?.WriteCapacityUnits ?? 0),
    }),
    { rcu: 0, wcu: 0 },
  );
}

function calculateTableCapacity(tableProps: Record<string, unknown> | undefined): ProvisionedUnits {
  const baseRcu = Number(
    (tableProps?.ProvisionedThroughput as Record<string, unknown> | undefined)?.ReadCapacityUnits ??
      0,
  );
  const baseWcu = Number(
    (tableProps?.ProvisionedThroughput as Record<string, unknown> | undefined)
      ?.WriteCapacityUnits ?? 0,
  );
  const gsiUnits = sumGsiThroughput(tableProps?.GlobalSecondaryIndexes);

  return {
    rcu: baseRcu + gsiUnits.rcu,
    wcu: baseWcu + gsiUnits.wcu,
  };
}

describe("CloudFormation Permanent Free-Tier Cost-Ceiling Guardrails", () => {
  const oidcApp = new App();
  const oidcStack = new GitHubOidcStack(oidcApp, "TestGitHubOidcStack", {
    env: { region: "ap-south-1", account: "123456789012" },
  });
  const oidcTemplate = Template.fromStack(oidcStack);

  const hmsApp = new App();
  const hmsStack = new SriLankaHmsStack(hmsApp, "TestSriLankaHmsStack", {
    env: { region: "ap-south-1", account: "123456789012" },
  });
  const hmsTemplate = Template.fromStack(hmsStack);

  it("guarantees 0 NAT Gateways to prevent idle hourly VPC charges", () => {
    oidcTemplate.resourceCountIs("AWS::EC2::NatGateway", 0);
    hmsTemplate.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  it("guarantees 0 RDS instances to prevent database hosting charges", () => {
    oidcTemplate.resourceCountIs("AWS::RDS::DBInstance", 0);
    hmsTemplate.resourceCountIs("AWS::RDS::DBInstance", 0);
  });

  it("guarantees 0 OpenSearch / Elasticsearch clusters", () => {
    oidcTemplate.resourceCountIs("AWS::OpenSearchService::Domain", 0);
    oidcTemplate.resourceCountIs("AWS::Elasticsearch::Domain", 0);
    hmsTemplate.resourceCountIs("AWS::OpenSearchService::Domain", 0);
    hmsTemplate.resourceCountIs("AWS::Elasticsearch::Domain", 0);
  });

  it("guarantees DynamoDB provisioned throughput does not exceed 25 RCU / 25 WCU across stacks", () => {
    const oidcTables = oidcTemplate.findResources("AWS::DynamoDB::Table");
    const hmsTables = hmsTemplate.findResources("AWS::DynamoDB::Table");

    const allTables = { ...oidcTables, ...hmsTables };
    const totals = Object.values(allTables).reduce<ProvisionedUnits>(
      (acc, table) => {
        const capacity = calculateTableCapacity(table.Properties);
        return {
          rcu: acc.rcu + capacity.rcu,
          wcu: acc.wcu + capacity.wcu,
        };
      },
      { rcu: 0, wcu: 0 },
    );

    assert.equal(
      totals.rcu,
      20,
      `Expected total DynamoDB RCU to be exactly 20 (10 base + 5 GSI1 + 5 GSI2), got ${totals.rcu}`,
    );
    assert.equal(
      totals.wcu,
      20,
      `Expected total DynamoDB WCU to be exactly 20 (10 base + 5 GSI1 + 5 GSI2), got ${totals.wcu}`,
    );
    assert.ok(
      totals.rcu <= 25,
      `Total DynamoDB RCU (${totals.rcu}) exceeds AWS Free Tier ceiling of 25`,
    );
    assert.ok(
      totals.wcu <= 25,
      `Total DynamoDB WCU (${totals.wcu}) exceeds AWS Free Tier ceiling of 25`,
    );
  });

  it("configures HmsTable with single-table PK/SK, TTL, and GSI1/GSI2 sparse indexes", () => {
    hmsTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "HmsSingleTable",
      ProvisionedThroughput: {
        ReadCapacityUnits: 10,
        WriteCapacityUnits: 10,
      },
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: {
        AttributeName: "ttl",
        Enabled: true,
      },
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: {
            ProjectionType: "ALL",
          },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
        },
        {
          IndexName: "GSI2",
          KeySchema: [
            { AttributeName: "GSI2PK", KeyType: "HASH" },
            { AttributeName: "GSI2SK", KeyType: "RANGE" },
          ],
          Projection: {
            ProjectionType: "ALL",
          },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
        },
      ],
    });
  });

  it("synthesizes least-privilege IAM roles for GitHub Actions OIDC deployment", () => {
    oidcTemplate.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "HmsBackendDeployRole",
      MaxSessionDuration: 3600,
    });

    oidcTemplate.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "HmsFrontendDeployRole",
      MaxSessionDuration: 3600,
    });
  });

  it("exports Stack Outputs for automated CI/CD secret population", () => {
    oidcTemplate.hasOutput("HmsBackendDeployRoleArn", {
      Export: {
        Name: "HmsBackendDeployRoleArn",
      },
    });

    oidcTemplate.hasOutput("HmsFrontendDeployRoleArn", {
      Export: {
        Name: "HmsFrontendDeployRoleArn",
      },
    });
  });

  it("provisions Cognito User Pool supporting email & phone login with custom tenant claims", () => {
    hmsTemplate.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "HmsUserPool",
      AutoVerifiedAttributes: ["email", "phone_number"],
      UsernameAttributes: ["email", "phone_number"],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireUppercase: true,
          RequireSymbols: false,
        },
      },
      Schema: Match.arrayWith([
        Match.objectLike({
          AttributeDataType: "String",
          Mutable: false,
          Name: "tenantId",
        }),
        Match.objectLike({
          AttributeDataType: "String",
          Mutable: true,
          Name: "department",
        }),
        Match.objectLike({
          AttributeDataType: "String",
          Mutable: true,
          Name: "role",
        }),
      ]),
    });
  });

  it("provisions Cognito User Pool Web Client without client secret for browser authentication", () => {
    hmsTemplate.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "HmsWebClient",
      GenerateSecret: false,
    });
  });

  it("exports Cognito User Pool and Table stack outputs for frontend & CI/CD", () => {
    hmsTemplate.hasOutput("HmsTableArn", {
      Export: {
        Name: "HmsTableArn",
      },
    });

    hmsTemplate.hasOutput("HmsTableName", {
      Export: {
        Name: "HmsTableName",
      },
    });

    hmsTemplate.hasOutput("HmsUserPoolId", {
      Export: {
        Name: "HmsUserPoolId",
      },
    });

    hmsTemplate.hasOutput("HmsUserPoolArn", {
      Export: {
        Name: "HmsUserPoolArn",
      },
    });

    hmsTemplate.hasOutput("HmsUserPoolClientId", {
      Export: {
        Name: "HmsUserPoolClientId",
      },
    });
  });

  it("provisions the 6 Cognito RBAC user groups for hospitality operations", () => {
    hmsTemplate.resourceCountIs("AWS::Cognito::UserPoolGroup", 6);

    const expectedGroups = [
      { name: "SUPER_ADMIN", precedence: 1 },
      { name: "HOTEL_ADMIN", precedence: 2 },
      { name: "FRONT_DESK", precedence: 3 },
      { name: "KITCHEN_KDS", precedence: 4 },
      { name: "HOUSEKEEPING", precedence: 5 },
      { name: "POS_CASHIER", precedence: 6 },
    ];

    for (const group of expectedGroups) {
      hmsTemplate.hasResourceProperties("AWS::Cognito::UserPoolGroup", {
        GroupName: group.name,
        Precedence: group.precedence,
      });
    }
  });

  it("provisions AppSync GraphQL API with Dual Auth and X-Ray disabled", () => {
    hmsTemplate.hasResourceProperties("AWS::AppSync::GraphQLApi", {
      Name: "HmsGraphQLApi",
      AuthenticationType: "AMAZON_COGNITO_USER_POOLS",
      XrayEnabled: false,
      AdditionalAuthenticationProviders: Match.arrayWith([
        Match.objectLike({
          AuthenticationType: "AWS_LAMBDA",
          LambdaAuthorizerConfig: Match.objectLike({
            AuthorizerResultTtlInSeconds: 300,
          }),
        }),
        Match.objectLike({
          AuthenticationType: "AWS_IAM",
        }),
        Match.objectLike({
          AuthenticationType: "API_KEY",
        }),
      ]),
    });
  });

  it("provisions ARM64 Graviton2 qrAuthorizer Lambda with 7-day log retention", () => {
    hmsTemplate.hasResourceProperties("AWS::Lambda::Function", {
      Architectures: ["arm64"],
      Runtime: "nodejs22.x",
      Timeout: 5,
      MemorySize: 128,
    });

    hmsTemplate.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 7,
    });
  });

  it("exports AppSync GraphQL API stack outputs", () => {
    hmsTemplate.hasOutput("HmsGraphQLApiId", {
      Export: {
        Name: "HmsGraphQLApiId",
      },
    });

    hmsTemplate.hasOutput("HmsGraphQLApiUrl", {
      Export: {
        Name: "HmsGraphQLApiUrl",
      },
    });

    hmsTemplate.hasOutput("HmsGraphQLApiArn", {
      Export: {
        Name: "HmsGraphQLApiArn",
      },
    });
  });

  it("registers HmsTable as AppSync DynamoDB DataSource", () => {
    hmsTemplate.hasResourceProperties("AWS::AppSync::DataSource", {
      Name: "HmsTableDs",
      Type: "AMAZON_DYNAMODB",
    });
  });

  it("registers all 35 direct AppSync JS DynamoDB resolvers with zero cold starts", () => {
    hmsTemplate.resourceCountIs("AWS::AppSync::Resolver", 35);

    const sampleResolvers = [
      { type: "Query", field: "getHotelTenant" },
      { type: "Mutation", field: "upsertHotelTenant" },
      { type: "Query", field: "listRooms" },
      { type: "Query", field: "listMenuCatalog" },
      { type: "Mutation", field: "toggleMenuItemStock" },
      { type: "Query", field: "listActiveOrdersByDepartment" },
      { type: "Mutation", field: "updateServiceOrderStatus" },
      { type: "Query", field: "listReservationsByDateRange" },
      { type: "Query", field: "getFolioWithLines" },
      { type: "Query", field: "listBanquetEvents" },
      { type: "Query", field: "listStockItems" },
    ];

    for (const r of sampleResolvers) {
      hmsTemplate.hasResourceProperties("AWS::AppSync::Resolver", {
        TypeName: r.type,
        FieldName: r.field,
        Runtime: {
          Name: "APPSYNC_JS",
          RuntimeVersion: "1.0.0",
        },
      });
    }
  });
});
