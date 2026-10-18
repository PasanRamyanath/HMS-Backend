import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export interface SriLankaHmsStackProps extends StackProps {}

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

  constructor(scope: Construct, id: string, props?: SriLankaHmsStackProps) {
    super(scope, id, props);

    this.deploymentRegion = this.region;

    // Single-table DynamoDB for all 42 multi-tenant SaaS entities
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
  }
}
