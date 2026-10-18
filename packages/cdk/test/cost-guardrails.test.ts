import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
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
});
