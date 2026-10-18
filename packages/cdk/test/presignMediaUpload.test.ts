import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  MAX_MEDIA_FILE_BYTES,
  PRESIGNED_URL_EXPIRY_SECONDS,
  buildMediaS3Key,
  generatePresignedMediaUploadUrl,
  handler,
  isRoleAuthorizedForCategory,
} from "../lambdas/presignMediaUpload.js";

describe("S3 Presigned WebP Media Upload Lambda (presignMediaUpload.ts)", () => {
  const dummyS3Client = new S3Client({
    region: "ap-south-1",
    credentials: { accessKeyId: "TEST_KEY", secretAccessKey: "TEST_SECRET" },
  });

  it("verifies direct getSignedUrl presigning", async () => {
    assert.equal(typeof getSignedUrl, "function");
    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "cinnamon-grand-cmb",
        category: "ROOM_TYPE",
        userRole: "HOTEL_ADMIN",
      },
      {
        s3Client: dummyS3Client,
      },
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(res.value.uploadUrl.startsWith("https://"));
  });

  const mockSignUrl = async (
    _client: S3Client,
    command: PutObjectCommand,
    options: { expiresIn: number },
  ) => {
    return `https://${command.input.Bucket}.s3.ap-south-1.amazonaws.com/${command.input.Key}?expires=${options.expiresIn}&type=${command.input.ContentType}&maxSize=${command.input.ContentLength}`;
  };

  it("successfully generates 120-second presigned WebP upload URL with default 150 KB limit", async () => {
    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "cinnamon-grand-cmb",
        category: "ROOM_TYPE",
        fileId: "deluxe-ocean-view-01",
        userRole: "HOTEL_ADMIN",
        actorUserId: "usr-admin-01",
      },
      {
        s3Client: dummyS3Client,
        bucketName: "test-media-bucket",
        signUrlFn: mockSignUrl,
      },
    );

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.tenantId, "cinnamon-grand-cmb");
    assert.equal(res.value.category, "ROOM_TYPE");
    assert.equal(res.value.contentType, "image/webp");
    assert.equal(res.value.maxByteSize, MAX_MEDIA_FILE_BYTES);
    assert.equal(res.value.expiresInSeconds, PRESIGNED_URL_EXPIRY_SECONDS);
    assert.equal(res.value.fileKey, "media/cinnamon-grand-cmb/room_type/deluxe-ocean-view-01.webp");
    assert.ok(
      res.value.uploadUrl.includes(
        "https://test-media-bucket.s3.ap-south-1.amazonaws.com/media/cinnamon-grand-cmb/room_type/deluxe-ocean-view-01.webp",
      ),
    );
    assert.ok(res.value.uploadUrl.includes("expires=120"));
    assert.ok(res.value.uploadUrl.includes("type=image/webp"));
    assert.ok(res.value.uploadUrl.includes(`maxSize=${MAX_MEDIA_FILE_BYTES}`));

    // Verify Audit Log entry
    assert.ok(res.value.auditLog);
    assert.equal(res.value.auditLog?.action, "PRESIGN_MEDIA_UPLOAD");
    assert.equal(res.value.auditLog?.tenantId, "cinnamon-grand-cmb");
    assert.equal(res.value.auditLog?.actorUserId, "usr-admin-01");
    assert.equal(res.value.auditLog?.entityType, "MEDIA_ASSET");
    assert.equal(res.value.auditLog?.entryHash.length, 64);
  });

  it("builds canonical S3 key correctly", () => {
    const key = buildMediaS3Key("jetwing-blue-negombo", "MENU_ITEM", "kottu-roti-cheese");
    assert.equal(key, "media/jetwing-blue-negombo/menu_item/kottu-roti-cheese.webp");
  });

  it("enforces RBAC role-category permission matrix", () => {
    // Hotel Admin can upload all categories
    assert.equal(isRoleAuthorizedForCategory("HOTEL_ADMIN", "HOTEL_PROFILE"), true);
    assert.equal(isRoleAuthorizedForCategory("HOTEL_ADMIN", "MENU_ITEM"), true);

    // Kitchen KDS can upload MENU_ITEM and INVENTORY_ITEM, but not HOTEL_PROFILE or ROOM_TYPE
    assert.equal(isRoleAuthorizedForCategory("KITCHEN_KDS", "MENU_ITEM"), true);
    assert.equal(isRoleAuthorizedForCategory("KITCHEN_KDS", "INVENTORY_ITEM"), true);
    assert.equal(isRoleAuthorizedForCategory("KITCHEN_KDS", "HOTEL_PROFILE"), false);
    assert.equal(isRoleAuthorizedForCategory("KITCHEN_KDS", "ROOM_TYPE"), false);

    // Guest can only upload GUEST_DOCUMENT
    assert.equal(isRoleAuthorizedForCategory("GUEST", "GUEST_DOCUMENT"), true);
    assert.equal(isRoleAuthorizedForCategory("GUEST", "MENU_ITEM"), false);

    // Unknown role is denied
    assert.equal(isRoleAuthorizedForCategory("UNKNOWN_ROLE", "GUEST_DOCUMENT"), false);
  });

  it("rejects unauthorized role attempting to upload forbidden category", async () => {
    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "cinnamon-grand-cmb",
        category: "HOTEL_PROFILE",
        userRole: "KITCHEN_KDS",
      },
      {
        s3Client: dummyS3Client,
        signUrlFn: mockSignUrl,
      },
    );

    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "UNAUTHORIZED_ROLE");
    assert.ok(res.error.message.includes("is not authorized"));
  });

  it("rejects non-webp content types", async () => {
    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "cinnamon-grand-cmb",
        category: "MENU_ITEM",
        contentType: "image/jpeg",
        userRole: "HOTEL_ADMIN",
      },
      {
        s3Client: dummyS3Client,
        signUrlFn: mockSignUrl,
      },
    );

    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "INVALID_CONTENT_TYPE");
    assert.ok(res.error.message.includes("Only image/webp is permitted"));
  });

  it("rejects file size exceeding 150 KB (153600 bytes)", async () => {
    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "cinnamon-grand-cmb",
        category: "ROOM_TYPE",
        maxByteSize: 200000,
        userRole: "HOTEL_ADMIN",
      },
      {
        s3Client: dummyS3Client,
        signUrlFn: mockSignUrl,
      },
    );

    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "FILE_SIZE_EXCEEDED");
    assert.ok(res.error.message.includes("153600 bytes"));
  });

  it("rejects unsupported media categories", async () => {
    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "cinnamon-grand-cmb",
        category: "MALICIOUS_EXE",
        userRole: "SUPER_ADMIN",
      },
      {
        s3Client: dummyS3Client,
        signUrlFn: mockSignUrl,
      },
    );

    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "INVALID_CATEGORY");
  });

  it("rejects invalid tenant slug format", async () => {
    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "INVALID TENANT!",
        category: "MENU_ITEM",
        userRole: "HOTEL_ADMIN",
      },
      {
        s3Client: dummyS3Client,
        signUrlFn: mockSignUrl,
      },
    );

    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.code, "VALIDATION_FAILED");
  });

  it("persists audit log entry to DynamoDB when docClient is supplied", async () => {
    let capturedItem: Record<string, unknown> | undefined;
    const mockDocClient = {
      send: async (cmd: { input: { Item: Record<string, unknown> } }) => {
        capturedItem = cmd.input.Item;
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    const res = await generatePresignedMediaUploadUrl(
      {
        tenantId: "cinnamon-grand-cmb",
        category: "GUEST_DOCUMENT",
        fileId: "nic-front-scan-uuid",
        userRole: "FRONT_DESK",
        actorUserId: "usr-frontdesk-09",
      },
      {
        s3Client: dummyS3Client,
        docClient: mockDocClient,
        signUrlFn: mockSignUrl,
        nowIsoFn: () => "2026-10-18T18:00:00.000Z",
      },
    );

    assert.equal(res.ok, true);
    assert.ok(capturedItem);
    assert.equal(capturedItem?.PK, "TENANT#cinnamon-grand-cmb");
    assert.ok(String(capturedItem?.SK).startsWith("AUDIT#2026-10-18T18:00:00.000Z#"));
    assert.equal(capturedItem?.action, "PRESIGN_MEDIA_UPLOAD");
  });

  it("handles AppSync GraphQL resolver event unpacking arguments and Cognito identity", async () => {
    const appSyncEvent = {
      arguments: {
        input: {
          tenantId: "cinnamon-grand-cmb",
          category: "MENU_ITEM",
          fileId: "pol-roti-combo",
        },
      },
      identity: {
        sub: "usr-sub-99",
        claims: {
          "custom:tenantId": "cinnamon-grand-cmb",
          "custom:role": "HOTEL_ADMIN",
        },
      },
    };

    const output = await handler(appSyncEvent as never, {
      s3Client: dummyS3Client,
      signUrlFn: mockSignUrl,
    });
    assert.equal(output.tenantId, "cinnamon-grand-cmb");
    assert.equal(output.category, "MENU_ITEM");
    assert.equal(output.contentType, "image/webp");
    assert.ok(output.uploadUrl.startsWith("https://"));
  });

  it("handler throws error when input fails validation", async () => {
    const appSyncEvent = {
      arguments: {
        input: {
          tenantId: "bad-tenant-!",
          category: "MENU_ITEM",
        },
      },
    };

    await assert.rejects(async () => {
      await handler(appSyncEvent as never, {
        s3Client: dummyS3Client,
        signUrlFn: mockSignUrl,
      });
    }, /\[VALIDATION_FAILED\]/);
  });
});
