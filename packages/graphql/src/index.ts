/**
 * @hms/graphql
 * Single source of truth for the 42-entity Sri Lanka HMS GraphQL schema and AppSync JS resolvers.
 */

export const GRAPHQL_PACKAGE_NAME = "@hms/graphql";
export const APPSYNC_RUNTIME_VERSION = "APPSYNC_JS_1_0_0";

export * from "./generated/types.js";
export * from "../resolvers/tenantGuard.js";
export * from "../resolvers/hotelTenant.js";
export * from "../resolvers/rooms.js";
export * from "../resolvers/menuCatalog.js";
export * from "../resolvers/menuMutations.js";
