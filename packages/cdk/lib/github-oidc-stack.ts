import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import {
  Effect,
  OpenIdConnectPrincipal,
  OpenIdConnectProvider,
  PolicyDocument,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface GitHubOidcStackProps extends StackProps {
  /** GitHub organization or user owning the HMS repositories. */
  readonly githubOrg?: string;
  /** GitHub repository name for the backend. */
  readonly backendRepoName?: string;
  /** GitHub repository name for the frontend. */
  readonly frontendRepoName?: string;
}

/**
 * AWS IAM GitHub Actions OIDC Stack for Sri Lanka Cloud SaaS HMS.
 *
 * Establishes keyless OpenID Connect (OIDC) federation between GitHub Actions
 * runners and AWS ap-south-1 (Mumbai), eliminating long-lived AWS IAM access keys.
 * Roles are strictly restricted by repository sub claims.
 */
export class GitHubOidcStack extends Stack {
  public readonly oidcProvider: OpenIdConnectProvider;
  public readonly backendDeployRole: Role;
  public readonly frontendDeployRole: Role;

  constructor(scope: Construct, id: string, props?: GitHubOidcStackProps) {
    super(scope, id, props);

    const githubOrg = props?.githubOrg ?? "PasanRamyanath";
    const backendRepo = props?.backendRepoName ?? "HMS-Backend";
    const frontendRepo = props?.frontendRepoName ?? "HMS-Frontend";

    // 1. GitHub Actions OIDC Provider
    this.oidcProvider = new OpenIdConnectProvider(this, "GitHubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
      thumbprints: [
        "6938fd4d98bab03faadb97b34396831e3780aea1",
        "1c58a3a8518e8759bf075b76b750d4f8d264fcd3",
      ],
    });

    // 2. Least-privilege assume role principal scoped to HMS-Backend repo
    const backendPrincipal = new OpenIdConnectPrincipal(this.oidcProvider, {
      StringLike: {
        "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${backendRepo}:*`,
      },
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      },
    });

    this.backendDeployRole = new Role(this, "HmsBackendDeployRole", {
      roleName: "HmsBackendDeployRole",
      assumedBy: backendPrincipal,
      description:
        "Least-privilege role assumed by GitHub Actions in PasanRamyanath/HMS-Backend to deploy CDK stacks",
      maxSessionDuration: Duration.hours(1),
      inlinePolicies: {
        HmsBackendCdkDeployPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: "CloudFormationDeployAccess",
              effect: Effect.ALLOW,
              actions: [
                "cloudformation:DescribeStacks",
                "cloudformation:DescribeChangeSet",
                "cloudformation:CreateChangeSet",
                "cloudformation:ExecuteChangeSet",
                "cloudformation:DeleteChangeSet",
                "cloudformation:GetTemplate",
                "cloudformation:GetTemplateSummary",
              ],
              resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/Hms*/*`],
            }),
            new PolicyStatement({
              sid: "CdkBootstrapToolkitAccess",
              effect: Effect.ALLOW,
              actions: [
                "s3:GetObject*",
                "s3:PutObject*",
                "s3:ListBucket",
                "s3:AbortMultipartUpload",
              ],
              resources: ["arn:aws:s3:::cdk-*-assets-*", "arn:aws:s3:::cdk-*-assets-*/*"],
            }),
            new PolicyStatement({
              sid: "CdkLookupAndStsAssumeRole",
              effect: Effect.ALLOW,
              actions: ["sts:AssumeRole"],
              resources: [
                `arn:aws:iam::${this.account}:role/cdk-*-lookup-role-${this.account}-${this.region}`,
                `arn:aws:iam::${this.account}:role/cdk-*-deploy-role-${this.account}-${this.region}`,
                `arn:aws:iam::${this.account}:role/cdk-*-file-publishing-role-${this.account}-${this.region}`,
                `arn:aws:iam::${this.account}:role/cdk-*-image-publishing-role-${this.account}-${this.region}`,
              ],
            }),
            new PolicyStatement({
              sid: "ServerlessServiceAccess",
              effect: Effect.ALLOW,
              actions: [
                "appsync:*",
                "dynamodb:*",
                "lambda:*",
                "logs:*",
                "cognito-idp:*",
                "iam:PassRole",
                "iam:GetRole",
                "iam:CreateRole",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // 3. Least-privilege assume role principal scoped to HMS-Frontend repo
    const frontendPrincipal = new OpenIdConnectPrincipal(this.oidcProvider, {
      StringLike: {
        "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${frontendRepo}:*`,
      },
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      },
    });

    this.frontendDeployRole = new Role(this, "HmsFrontendDeployRole", {
      roleName: "HmsFrontendDeployRole",
      assumedBy: frontendPrincipal,
      description:
        "Least-privilege role assumed by GitHub Actions in PasanRamyanath/HMS-Frontend for S3 sync and CloudFront invalidation",
      maxSessionDuration: Duration.hours(1),
      inlinePolicies: {
        HmsFrontendDeployPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: "S3FrontendBucketSync",
              effect: Effect.ALLOW,
              actions: [
                "s3:ListBucket",
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:PutObjectAcl",
              ],
              resources: ["arn:aws:s3:::hms-frontend-*", "arn:aws:s3:::hms-frontend-*/*"],
            }),
            new PolicyStatement({
              sid: "CloudFrontInvalidation",
              effect: Effect.ALLOW,
              actions: [
                "cloudfront:CreateInvalidation",
                "cloudfront:GetInvalidation",
                "cloudfront:GetDistribution",
              ],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
            }),
          ],
        }),
      },
    });

    // 4. CloudFormation Outputs
    new CfnOutput(this, "HmsBackendDeployRoleArn", {
      value: this.backendDeployRole.roleArn,
      description:
        "ARN of HmsBackendDeployRole to configure in PasanRamyanath/HMS-Backend GitHub Secrets",
      exportName: "HmsBackendDeployRoleArn",
    });

    new CfnOutput(this, "HmsFrontendDeployRoleArn", {
      value: this.frontendDeployRole.roleArn,
      description:
        "ARN of HmsFrontendDeployRole to configure in PasanRamyanath/HMS-Frontend GitHub Secrets",
      exportName: "HmsFrontendDeployRoleArn",
    });
  }
}
