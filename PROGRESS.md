# HMS-Backend — Live Step Progress Tracker

This file tracks the sequential completion of backend implementation steps defined in the master plan (`/workspaces/Sri-Lanka--HMS/plan.md`).

## Phase 01: GitHub Codespaces 3-Repo Bootstrap & Quality Gates
- [x] Step 001: Clone `HMS-Backend` & `HMS-Frontend` First Inside Codespace
- [x] Step 002: Configure `.devcontainer/devcontainer.json` & bootstrap script
- [x] Step 003: Install Ponytail & Addy Osmani's agent-skills plugins in AGY CLI
- [x] Step 004: Install Apple HIG & UI/UX skills in AGY CLI
- [x] Step 005: Author `.antigravity/rules.md` & `AGENTS.md`
- [x] Step 006: Initialize Live Step Checkbox Trackers (`PROGRESS.md`) & `.gitignore`
- [x] Step 007: Configure Strict Anti-Noise `biome.json`
- [x] Step 008: Configure `knip.json` Pruner
- [x] Step 009: Configure `lefthook.yml` Quality Gates
- [x] Step 010: Pin Node.js 22 LTS (`.nvmrc`) & Author `package.json` Workspaces + `tsconfig.base.json`
- [x] Step 011: Scaffold `packages/core` Pure Domain Package
- [x] Step 012: Implement Explicit `Result<T, E>` & Error Catalog
- [x] Step 013: Implement SHA-256 Hash-Chained `ImmutableAuditLog` Engine
- [x] Step 014: Scaffold `packages/graphql` for 42-Entity Schema
- [x] Step 015: Scaffold `packages/cdk` Near-Free-Tier Stack
- [x] Step 016: Author AWS IAM GitHub OIDC Stack (`packages/cdk/lib/github-oidc-stack.ts`)
- [x] Step 017: Author Independent Backend GitHub Actions CI/CD Workflow (`.github/workflows/deploy-backend.yml`)
- [x] Step 018: Scaffold `HMS-Frontend` for React 19 + Tailwind CSS v4 + Apple HIG
- [x] Step 019: Author Independent Frontend GitHub Actions CI/CD Workflow (`HMS-Frontend/.github/workflows/deploy-frontend.yml`)
- [x] Step 020: Create Cross-Repo GraphQL Contract Sync Script (`scripts/sync-contracts.sh`)
- [x] Step 021: Implement Shared Sri Lankan Currency & `Asia/Colombo` Date Helpers (`format.ts`)
- [x] Step 022: Implement Runtime Tenant, Mobile, SLTDA & IRD Validators (`config.ts`)
- [x] Step 023: Write CloudFormation Permanent Free-Tier Cost-Ceiling Guardrail Test (`cost-guardrails.test.ts`)
- [x] Step 024: Author Master Architecture Decision Record (`docs/adr-001-codespaces-saas-apple-hig.md`)
- [x] Step 025: Create & Execute Master 3-Repo Verification Gate (`scripts/verify-all-repos.sh`)

## Phase 02: Sri Lankan Statutory Tax, NIC/Passport, LankaQR & Payment Crypto Engine
- [x] Step 026: Define Tax Configuration & Breakdown Types (`tax.ts`)
- [x] Step 027: Implement Exact Half-Up Rupee & Cent Rounding Helper `roundLkr`
- [ ] Step 028: Implement Forward 4-Stage Compounding Tax Calculation (`calculateForwardTax`)
- [ ] Step 029: Implement Small Guest House Tier Support (`createTaxPreset`)
- [ ] Step 030: Implement Reverse All-Inclusive Gross-to-Net Derivation (`calculateReverseTax`)
- [ ] Step 031: Write Exhaustive IRD/SLTDA Tax Test Vectors
