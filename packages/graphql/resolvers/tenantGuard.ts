/**
 * @hms/graphql - AppSync JS Direct Resolvers
 * Multi-Tenant Tenant Isolation & RBAC Security Guard (tenantGuard.ts)
 *
 * Enforces Rung 5 Tenant Isolation:
 * 1. Validates caller JWT custom:tenantId claim matches ctx.args.tenantId.
 * 2. Validates guest QR Lambda authorizer resolverContext.tenantId matches ctx.args.tenantId.
 * 3. Enforces RolePermissionMatrix RBAC for staff and super-admin operations.
 * 4. Zero Lambda cold-start overhead via direct AppSync JS runtime (APPSYNC_JS_1_0_0).
 */

import { util, type Context } from "@aws-appsync/utils";

export interface TenantIdentityClaims {
  sub?: string;
  email?: string;
  "custom:tenantId"?: string;
  "custom:role"?: string;
  "cognito:groups"?: string[];
  [key: string]: unknown;
}

export interface TenantLambdaResolverContext {
  tenantId?: string;
  roomNumber?: string;
  bookingRef?: string;
  stayId?: string;
  [key: string]: unknown;
}

function resolveCognitoTenant(claims: TenantIdentityClaims, targetTenantId: string): string {
  const callerTenantId = claims["custom:tenantId"];
  const groups = claims["cognito:groups"] || [];
  const isSuperAdmin = groups.includes("SuperAdmin") || claims["custom:role"] === "SUPER_ADMIN";

  if (isSuperAdmin) {
    return targetTenantId;
  }

  if (!callerTenantId || callerTenantId !== targetTenantId) {
    util.unauthorized();
  }

  return callerTenantId;
}

function resolveLambdaTenant(
  resolverContext: TenantLambdaResolverContext,
  targetTenantId: string,
): string {
  const guestTenantId = resolverContext.tenantId;
  if (!guestTenantId || guestTenantId !== targetTenantId) {
    util.unauthorized();
  }
  return guestTenantId;
}

/**
 * Validates that the executing caller belongs to the requested tenantId.
 * Throws AppSync unauthorized error if a cross-tenant breach is detected.
 *
 * @param ctx AppSync resolver context containing identity and invocation arguments
 * @param explicitTenantId Optional override tenantId (defaults to ctx.args.tenantId or ctx.args.input?.tenantId)
 * @returns The validated tenantId string
 */
export function tenantGuard<TArgs = Record<string, unknown>>(
  ctx: Context<TArgs>,
  explicitTenantId?: string,
): string {
  const args = ctx.args as Record<string, unknown> | undefined;
  const input = args?.input as Record<string, unknown> | undefined;
  const targetTenantId =
    explicitTenantId ||
    (typeof args?.tenantId === "string" ? args.tenantId : undefined) ||
    (typeof input?.tenantId === "string" ? input.tenantId : undefined) ||
    (typeof input?.id === "string" ? input.id : undefined);

  if (!targetTenantId || targetTenantId.trim().length === 0) {
    util.error("Missing mandatory tenantId in operation arguments.", "BadRequest");
  }

  const identity = ctx.identity as Record<string, unknown> | undefined;
  if (!identity) {
    util.unauthorized();
  }

  const claims = identity.claims as TenantIdentityClaims | undefined;
  if (claims) {
    return resolveCognitoTenant(claims, targetTenantId);
  }

  const resolverContext = identity.resolverContext as TenantLambdaResolverContext | undefined;
  if (resolverContext) {
    return resolveLambdaTenant(resolverContext, targetTenantId);
  }

  const idAny = identity as { accountId?: string; userArn?: string };
  if (idAny.accountId || idAny.userArn) {
    return targetTenantId;
  }

  util.unauthorized();
}

/**
 * Asserts that the authenticated staff member possesses one of the allowed roles.
 *
 * @param ctx AppSync resolver context
 * @param allowedRoles List of UserRole strings allowed to execute the operation
 */
export function requireUserRole<TArgs>(ctx: Context<TArgs>, allowedRoles: readonly string[]): void {
  const identity = ctx.identity as Record<string, unknown> | undefined;
  if (!identity) {
    util.unauthorized();
  }

  const claims = identity.claims as TenantIdentityClaims | undefined;
  if (!claims) {
    util.unauthorized();
  }

  const role = claims["custom:role"];
  const groups = claims["cognito:groups"] || [];

  if (groups.includes("SuperAdmin") || role === "SUPER_ADMIN") {
    return;
  }

  if (!role || !allowedRoles.includes(role)) {
    util.unauthorized();
  }
}

/**
 * Extracts the authenticated user identifier (sub or guest session ref).
 *
 * @param ctx AppSync resolver context
 * @returns Unique caller subject ID string
 */
export function getAuthenticatedUserId<TArgs>(ctx: Context<TArgs>): string {
  const identity = ctx.identity as Record<string, unknown> | undefined;
  if (!identity) {
    util.unauthorized();
  }

  const claims = identity.claims as TenantIdentityClaims | undefined;
  if (claims?.sub) {
    return claims.sub;
  }

  const resolverContext = identity.resolverContext as TenantLambdaResolverContext | undefined;
  if (resolverContext?.stayId) {
    return `GUEST#${resolverContext.stayId}`;
  }

  if (typeof identity.sub === "string") {
    return identity.sub;
  }

  return "SYSTEM";
}
