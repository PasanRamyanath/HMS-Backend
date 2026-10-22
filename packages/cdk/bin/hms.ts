#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import {
  CDK_APP_NAME,
  CDK_DEFAULT_REGION,
  GitHubOidcStack,
  type GitHubOidcStackProps,
  SriLankaHmsStack,
  type SriLankaHmsStackProps,
} from "../lib/index.js";

/**
 * Sri Lanka Cloud SaaS HMS Infrastructure Application.
 * Targets AWS ap-south-1 (Mumbai) under strict Free-Tier constraints.
 */
export const app = new App();

export const DEFAULT_AWS_REGION = CDK_DEFAULT_REGION;
export const APP_NAME = CDK_APP_NAME;

const region = process.env.CDK_DEFAULT_REGION ?? CDK_DEFAULT_REGION;
const account = process.env.CDK_DEFAULT_ACCOUNT;

const env = account ? { region, account } : { region };

const oidcProps: GitHubOidcStackProps = {
  env,
  description:
    "AWS IAM GitHub Actions OIDC Provider & Roles for PasanRamyanath/HMS-Backend and HMS-Frontend",
};

export const oidcStack = new GitHubOidcStack(app, "HmsGitHubOidcStack", oidcProps);

const deployEnv = process.env.DEPLOY_ENV ?? "dev";
const isDefaultDev = deployEnv === "dev" || deployEnv === "main";
const stackName = isDefaultDev ? "SriLankaHmsStack" : `SriLankaHmsStack-${deployEnv}`;

const hmsProps: SriLankaHmsStackProps = {
  env,
  stage: deployEnv,
  description: `Sri Lankan Cloud SaaS Hotel Management System & Contactless QR Platform Serverless Infrastructure (${deployEnv.toUpperCase()} - Mumbai ap-south-1)`,
};

export const hmsStack = new SriLankaHmsStack(app, stackName, hmsProps);

// Cost-allocation & operational tags across all synthesized constructs
Tags.of(app).add("Project", "SriLankaHMS");
Tags.of(app).add("Environment", deployEnv);
Tags.of(app).add("ManagedBy", "AWS-CDK");
Tags.of(app).add("Region", region);
Tags.of(app).add("Compliance", "SLTDA-TourismAct-No38-2005");
Tags.of(app).add("CostCeiling", "PermanentFreeTier");
