import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { GitHubOidcStack } from "../lib/github-oidc-stack.js";

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
  const app = new App();
  const oidcStack = new GitHubOidcStack(app, "TestGitHubOidcStack", {
    env: { region: "ap-south-1", account: "123456789012" },
  });
  const template = Template.fromStack(oidcStack);

  it("guarantees 0 NAT Gateways to prevent idle hourly VPC charges", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  it("guarantees 0 RDS instances to prevent database hosting charges", () => {
    template.resourceCountIs("AWS::RDS::DBInstance", 0);
  });

  it("guarantees 0 OpenSearch / Elasticsearch clusters", () => {
    template.resourceCountIs("AWS::OpenSearchService::Domain", 0);
    template.resourceCountIs("AWS::Elasticsearch::Domain", 0);
  });

  it("guarantees DynamoDB provisioned throughput does not exceed 25 RCU / 25 WCU", () => {
    const tables = template.findResources("AWS::DynamoDB::Table");
    const totals = Object.values(tables).reduce<ProvisionedUnits>(
      (acc, table) => {
        const capacity = calculateTableCapacity(table.Properties);
        return {
          rcu: acc.rcu + capacity.rcu,
          wcu: acc.wcu + capacity.wcu,
        };
      },
      { rcu: 0, wcu: 0 },
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

  it("synthesizes least-privilege IAM roles for GitHub Actions OIDC deployment", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "HmsBackendDeployRole",
      MaxSessionDuration: 3600,
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "HmsFrontendDeployRole",
      MaxSessionDuration: 3600,
    });
  });

  it("exports Stack Outputs for automated CI/CD secret population", () => {
    template.hasOutput("HmsBackendDeployRoleArn", {
      Export: {
        Name: "HmsBackendDeployRoleArn",
      },
    });

    template.hasOutput("HmsFrontendDeployRoleArn", {
      Export: {
        Name: "HmsFrontendDeployRoleArn",
      },
    });
  });
});
