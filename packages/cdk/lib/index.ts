/**
 * @hms/cdk stack definitions and construct exports.
 */
export const CDK_APP_NAME = "SriLankaHmsInfrastructure";
export const CDK_DEFAULT_REGION = "ap-south-1";

export {
  GitHubOidcStack,
  type GitHubOidcStackProps,
} from "./github-oidc-stack.js";

export {
  SriLankaHmsStack,
  type SriLankaHmsStackProps,
} from "./hms-stack.js";
