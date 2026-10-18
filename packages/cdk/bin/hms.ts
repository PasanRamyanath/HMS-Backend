#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { CDK_APP_NAME, CDK_DEFAULT_REGION } from "../lib/index.js";

/**
 * Sri Lanka Cloud SaaS HMS Infrastructure Application.
 * Targets AWS ap-south-1 (Mumbai) under strict Free-Tier constraints.
 */
export const app = new App();

export const DEFAULT_AWS_REGION = CDK_DEFAULT_REGION;
export const APP_NAME = CDK_APP_NAME;
