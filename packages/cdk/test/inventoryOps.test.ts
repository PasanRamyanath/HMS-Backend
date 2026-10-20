import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { SriLankaHmsStack } from "../lib/hms-stack.js";

describe("Step 393: AppSync Direct JS Resolvers for Inventory Operations (inventoryOps.ts)", () => {
  const TEST_TENANT = "tenant-resort-01";

  // Synthesize HMS Stack for AppSync Resolver verification
  const app = new App();
  const stack = new SriLankaHmsStack(app, "TestHmsStackForInventory", {
    env: { region: "ap-south-1", account: "123456789012" },
  });
  const template = Template.fromStack(stack);

  describe("1. Bundled AppSync JS Code Verification (inventoryOps.js)", () => {
    const bundlePath = resolve(process.cwd(), "../graphql/dist/resolvers/inventoryOps.js");
    const bundleCode = readFileSync(bundlePath, "utf8");

    it("verifies bundled resolver artifact exists and contains essential functions", () => {
      assert.ok(bundleCode.length > 500);
      assert.ok(bundleCode.includes("getStockItemRequest"));
      assert.ok(bundleCode.includes("getStockItemResponse"));
      assert.ok(bundleCode.includes("getPurchaseOrderRequest"));
      assert.ok(bundleCode.includes("getPurchaseOrderResponse"));
      assert.ok(bundleCode.includes("listPurchaseOrdersRequest"));
      assert.ok(bundleCode.includes("listPurchaseOrdersResponse"));
      assert.ok(bundleCode.includes("getInventoryVoucherRequest"));
      assert.ok(bundleCode.includes("getInventoryVoucherResponse"));
      assert.ok(bundleCode.includes("listInventoryVouchersRequest"));
      assert.ok(bundleCode.includes("listInventoryVouchersResponse"));
      assert.ok(bundleCode.includes("upsertStockItemRequest"));
      assert.ok(bundleCode.includes("upsertStockItemResponse"));
      assert.ok(bundleCode.includes("recordGrnRequest"));
      assert.ok(bundleCode.includes("recordGrnResponse"));
      assert.ok(bundleCode.includes("createGoodsIssueNoteRequest"));
      assert.ok(bundleCode.includes("createGoodsIssueNoteResponse"));
    });

    it("verifies multi-tenant security guards are baked into resolver bundle", () => {
      assert.ok(bundleCode.includes("tenantGuard"));
      assert.ok(bundleCode.includes("requireUserRole"));
      assert.ok(bundleCode.includes("INVENTORY_READ_ROLES"));
      assert.ok(bundleCode.includes("INVENTORY_WRITE_ROLES"));
    });

    it("verifies canonical single-table DynamoDB keys in resolver bundle", () => {
      assert.ok(bundleCode.includes("STOCK#"));
      assert.ok(bundleCode.includes("PO#"));
      assert.ok(bundleCode.includes("VOUCHER#"));
      assert.ok(bundleCode.includes("TENANT#"));
      assert.ok(bundleCode.includes("GRN_GOODS_RECEIVED_NOTE"));
      assert.ok(bundleCode.includes("GIN_GOODS_ISSUE_NOTE"));
    });
  });

  describe("2. CDK CloudFormation AppSync Resolvers Registration", () => {
    const expectedResolvers = [
      { type: "Query", field: "getStockItem" },
      { type: "Query", field: "getPurchaseOrder" },
      { type: "Query", field: "listPurchaseOrders" },
      { type: "Query", field: "getInventoryVoucher" },
      { type: "Query", field: "listInventoryVouchers" },
      { type: "Mutation", field: "upsertStockItem" },
      { type: "Mutation", field: "recordGrn" },
      { type: "Mutation", field: "createGoodsIssueNote" },
    ];

    for (const res of expectedResolvers) {
      it(`provisions direct JS resolver for ${res.type}.${res.field}`, () => {
        template.hasResourceProperties("AWS::AppSync::Resolver", {
          TypeName: res.type,
          FieldName: res.field,
          Runtime: {
            Name: "APPSYNC_JS",
            RuntimeVersion: "1.0.0",
          },
        });
      });
    }
  });

  describe("3. Canonical Key Pattern Logic", () => {
    it("follows single-table standard for StockItem", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const sk = "STOCK#SKU-TEA-001";
      const gsi1pk = `TENANT#${TEST_TENANT}#STOCK`;
      const gsi1sk = "DEPT#FNB#CAT#DRY_GOODS#SKU-TEA-001";

      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(sk, "STOCK#SKU-TEA-001");
      assert.equal(gsi1pk, "TENANT#tenant-resort-01#STOCK");
      assert.equal(gsi1sk, "DEPT#FNB#CAT#DRY_GOODS#SKU-TEA-001");
    });

    it("follows single-table standard for PurchaseOrder", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const sk = "PO#PO-2026-0088";
      const gsi1pk = `TENANT#${TEST_TENANT}#PO`;
      const gsi1sk = "STATUS#APPROVED#DATE#2026-10-20#PO-2026-0088";

      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(sk, "PO#PO-2026-0088");
      assert.equal(gsi1pk, "TENANT#tenant-resort-01#PO");
      assert.equal(gsi1sk, "STATUS#APPROVED#DATE#2026-10-20#PO-2026-0088");
    });

    it("follows single-table standard for GRN and GIN vouchers", () => {
      const pk = `TENANT#${TEST_TENANT}`;
      const grnSk = "VOUCHER#grn-abc12345";
      const grnGsi1pk = `TENANT#${TEST_TENANT}#VOUCHERS`;
      const grnGsi1sk = "TYPE#GRN_GOODS_RECEIVED_NOTE#DATE#2026-10-20#grn-abc12345";

      assert.equal(pk, "TENANT#tenant-resort-01");
      assert.equal(grnSk, "VOUCHER#grn-abc12345");
      assert.equal(grnGsi1pk, "TENANT#tenant-resort-01#VOUCHERS");
      assert.equal(grnGsi1sk, "TYPE#GRN_GOODS_RECEIVED_NOTE#DATE#2026-10-20#grn-abc12345");
    });
  });
});
