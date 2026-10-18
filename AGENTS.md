# HMS-Backend — Agent Guidelines & Architecture Rules

## 1. Monorepo Structure
- `packages/core` (`@hms/core`): Pure TypeScript Sri Lankan hospitality domain math, 4-stage tax compounding (`SC -> TDL -> SSCL -> VAT`), NIC/Passport validation, LankaQR EMVCo generation, payment crypto (`PayHere`, `WebXPay`, `Channex`), and FIFO inventory cost engine. **Zero external runtime npm dependencies** (only Node 22 standard library).
- `packages/graphql` (`@hms/graphql`): AppSync GraphQL schema for all 42 multi-tenant SaaS entities, Direct AppSync JS DynamoDB resolvers, and codegen exporter.
- `packages/cdk` (`@hms/cdk`): AWS CDK v2 TypeScript infrastructure in `ap-south-1` Mumbai targeting permanent AWS Free Tier (Single-Table DynamoDB 20 RCU/20 WCU, AppSync, Node.js 22 ARM64 Graviton2 Lambdas, Cognito, S3 + CloudFront).

## 2. Anti-Noise & Code Quality Standards
- No arbitrary LOC caps: Write expressive, human-readable code.
- Zero `console.log`, `console.error`, `console.warn`, or `debugger` statements (`suspicious.noConsole: "error"` in Biome).
- Use explicit typed `Result<T, DomainError>` values (`packages/core/src/result.ts`).
- Enforce `npx knip` to verify zero dead exports, unused types, or unneeded dependencies.
- Cognitive complexity must stay <= 12 per function.

## 3. Step Protocol & Git Push Gate
- Each backend step corresponds to `plan.md` in root and `PROGRESS.md` in this repository.
- Verify using: `npx biome check . && npx knip && npm test`.
- Mark step checkbox as `- [x]` in `PROGRESS.md` and root `plan.md`.
- Commit with conventional commit message `feat(step-XXX): ...` and push to `origin main`.
