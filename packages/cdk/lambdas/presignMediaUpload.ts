import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type AuditLogEntry,
  type DomainError,
  type Result,
  createAuditEntry,
  domainErr,
  ok,
  validateTenantId,
} from "@hms/core";

export const MAX_MEDIA_FILE_BYTES = 153600; // 150 KB max for optimized WebP
export const PRESIGNED_URL_EXPIRY_SECONDS = 120; // 120-second validity window

export type MediaUploadCategory =
  | "ROOM_TYPE"
  | "MENU_ITEM"
  | "HOTEL_PROFILE"
  | "GUEST_DOCUMENT"
  | "STAFF_AVATAR"
  | "INVENTORY_ITEM";

const VALID_CATEGORIES = new Set<string>([
  "ROOM_TYPE",
  "MENU_ITEM",
  "HOTEL_PROFILE",
  "GUEST_DOCUMENT",
  "STAFF_AVATAR",
  "INVENTORY_ITEM",
]);

const CATEGORY_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  SUPER_ADMIN: [
    "ROOM_TYPE",
    "MENU_ITEM",
    "HOTEL_PROFILE",
    "GUEST_DOCUMENT",
    "STAFF_AVATAR",
    "INVENTORY_ITEM",
  ],
  HOTEL_ADMIN: [
    "ROOM_TYPE",
    "MENU_ITEM",
    "HOTEL_PROFILE",
    "GUEST_DOCUMENT",
    "STAFF_AVATAR",
    "INVENTORY_ITEM",
  ],
  FRONT_DESK: ["GUEST_DOCUMENT", "ROOM_TYPE"],
  KITCHEN_KDS: ["MENU_ITEM", "INVENTORY_ITEM"],
  POS_CASHIER: ["MENU_ITEM"],
  HOUSEKEEPING: ["ROOM_TYPE", "STAFF_AVATAR"],
  GUEST: ["GUEST_DOCUMENT"],
};

export interface PresignMediaUploadInput {
  readonly tenantId: string;
  readonly category: MediaUploadCategory | string;
  readonly fileId?: string | undefined;
  readonly userRole?: string | undefined;
  readonly contentType?: string | undefined;
  readonly maxByteSize?: number | undefined;
  readonly prevAuditHash?: string | undefined;
  readonly actorUserId?: string | undefined;
}

export interface PresignMediaUploadOutput {
  readonly uploadUrl: string;
  readonly fileKey: string;
  readonly tenantId: string;
  readonly category: string;
  readonly fileId: string;
  readonly contentType: "image/webp";
  readonly maxByteSize: number;
  readonly expiresInSeconds: number;
  readonly auditLog?: AuditLogEntry | undefined;
}

export interface PresignMediaUploadDependencies {
  readonly s3Client?: S3Client | undefined;
  readonly docClient?: DynamoDBDocumentClient | undefined;
  readonly bucketName?: string | undefined;
  readonly nowIsoFn?: () => string;
  readonly uuidFn?: () => string;
  readonly signUrlFn?: (
    client: S3Client,
    command: PutObjectCommand,
    options: { expiresIn: number },
  ) => Promise<string>;
}

export interface AppSyncMediaUploadEvent {
  readonly arguments?:
    | {
        readonly input?: PresignMediaUploadInput | undefined;
      }
    | undefined;
  readonly identity?:
    | {
        readonly sub?: string | undefined;
        readonly username?: string | undefined;
        readonly claims?:
          | {
              readonly "custom:tenantId"?: string | undefined;
              readonly "custom:role"?: string | undefined;
              readonly [key: string]: unknown;
            }
          | undefined;
      }
    | undefined;
}

let defaultS3Client: S3Client | undefined;

function getDefaultS3Client(): S3Client {
  if (!defaultS3Client) {
    const hasAwsCreds = Boolean(
      process.env.AWS_ACCESS_KEY_ID ||
        process.env.AWS_PROFILE ||
        process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
    );
    defaultS3Client = new S3Client({
      region: process.env.AWS_REGION ?? "ap-south-1",
      ...(hasAwsCreds
        ? {}
        : {
            credentials: {
              accessKeyId: "HMS_LOCAL_MOCK_KEY",
              secretAccessKey: "HMS_LOCAL_MOCK_SECRET",
            },
          }),
    });
  }
  return defaultS3Client;
}

function generateSafeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `f${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Validates role-based access for media upload categories.
 */
export function isRoleAuthorizedForCategory(role: string, category: string): boolean {
  const allowed = CATEGORY_ROLE_PERMISSIONS[role.toUpperCase()];
  if (!allowed) {
    return false;
  }
  return allowed.includes(category.toUpperCase());
}

/**
 * Validates request input parameters against SaaS invariants.
 */
function validateMediaParameters(
  input: PresignMediaUploadInput,
): Result<{ category: string; maxBytes: number; fileId: string }, DomainError> {
  const normalizedCategory = input.category.trim().toUpperCase();
  if (!VALID_CATEGORIES.has(normalizedCategory)) {
    return domainErr("VALIDATION_FAILED", `Unsupported media category: ${input.category}`, {
      category: input.category,
      supported: Array.from(VALID_CATEGORIES),
    });
  }

  if (input.contentType && input.contentType.trim().toLowerCase() !== "image/webp") {
    return domainErr("VALIDATION_FAILED", "Only image/webp is permitted for upload", {
      provided: input.contentType,
      expected: "image/webp",
    });
  }

  const maxBytes = input.maxByteSize ?? MAX_MEDIA_FILE_BYTES;
  if (maxBytes <= 0 || maxBytes > MAX_MEDIA_FILE_BYTES) {
    return domainErr(
      "QUOTA_EXCEEDED",
      `Upload size must be between 1 and ${MAX_MEDIA_FILE_BYTES} bytes (150 KB)`,
      { requested: maxBytes, maximumAllowed: MAX_MEDIA_FILE_BYTES },
    );
  }

  const rawFileId = input.fileId?.trim();
  const fileId = rawFileId && rawFileId.length >= 8 ? rawFileId : generateSafeUuid();

  return ok({ category: normalizedCategory, maxBytes, fileId });
}

/**
 * Builds the canonical S3 key scoped to tenant, category, and file ID.
 */
export function buildMediaS3Key(tenantId: string, category: string, fileId: string): string {
  const sanitizedId = fileId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `media/${tenantId}/${category.toLowerCase()}/${sanitizedId}.webp`;
}

/**
 * Records an ImmutableAuditLog entry and optionally persists it to DynamoDB.
 */
async function recordMediaUploadAuditLog(
  tenantId: string,
  fileKey: string,
  category: string,
  fileId: string,
  maxBytes: number,
  role: string,
  input: PresignMediaUploadInput,
  deps: PresignMediaUploadDependencies,
): Promise<AuditLogEntry | undefined> {
  const nowIso = deps.nowIsoFn ? deps.nowIsoFn() : new Date().toISOString();
  const auditEntryRes = createAuditEntry({
    tenantId,
    actorUserId: input.actorUserId ?? "SYSTEM",
    action: "PRESIGN_MEDIA_UPLOAD",
    entityType: "MEDIA_ASSET",
    entityId: fileKey,
    isoTs: nowIso,
    afterJson: JSON.stringify({
      category,
      fileKey,
      fileId,
      maxByteSize: maxBytes,
      role,
      expiresInSeconds: PRESIGNED_URL_EXPIRY_SECONDS,
    }),
    prevHash: input.prevAuditHash,
  });

  const auditLog = auditEntryRes.ok ? auditEntryRes.value : undefined;

  if (deps.docClient && auditLog) {
    const tableName = process.env.TABLE_NAME ?? "HmsTable";
    await deps.docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `AUDIT#${nowIso}#${auditLog.entryHash}`,
          ...auditLog,
        },
      }),
    );
  }

  return auditLog;
}

/**
 * Generates an S3 presigned PUT URL for WebP media upload with 120s expiry and 150 KB ceiling.
 */
export async function generatePresignedMediaUploadUrl(
  input: PresignMediaUploadInput,
  deps: PresignMediaUploadDependencies = {},
): Promise<Result<PresignMediaUploadOutput, DomainError>> {
  const tenantRes = validateTenantId(input.tenantId);
  if (!tenantRes.ok) {
    return tenantRes;
  }
  const tenantId = tenantRes.value;

  const role = input.userRole ?? "HOTEL_ADMIN";
  const paramRes = validateMediaParameters(input);
  if (!paramRes.ok) {
    return paramRes;
  }
  const { category, maxBytes, fileId } = paramRes.value;

  if (!isRoleAuthorizedForCategory(role, category)) {
    return domainErr(
      "UNAUTHORIZED",
      `Role '${role}' is not authorized to upload media in category '${category}'`,
      { role, category },
    );
  }

  const bucketName = deps.bucketName ?? process.env.MEDIA_BUCKET_NAME ?? "hms-media-bucket";
  const fileKey = buildMediaS3Key(tenantId, category, fileId);

  const s3Client = deps.s3Client ?? getDefaultS3Client();
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    ContentType: "image/webp",
    ContentLength: maxBytes,
  });

  const signUrl = deps.signUrlFn ?? getSignedUrl;
  const uploadUrl = await signUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });

  const auditLog = await recordMediaUploadAuditLog(
    tenantId,
    fileKey,
    category,
    fileId,
    maxBytes,
    role,
    input,
    deps,
  );

  return ok({
    uploadUrl,
    fileKey,
    tenantId,
    category,
    fileId,
    contentType: "image/webp",
    maxByteSize: maxBytes,
    expiresInSeconds: PRESIGNED_URL_EXPIRY_SECONDS,
    auditLog,
  });
}

/**
 * AppSync resolver / Lambda function entry point for presignMediaUpload.
 */
export async function handler(
  event: AppSyncMediaUploadEvent | PresignMediaUploadInput,
  deps: PresignMediaUploadDependencies = {},
): Promise<PresignMediaUploadOutput> {
  const directInput = (event as AppSyncMediaUploadEvent).arguments?.input;
  const identity = (event as AppSyncMediaUploadEvent).identity;

  const tenantFromClaims = identity?.claims?.["custom:tenantId"];
  const roleFromClaims = identity?.claims?.["custom:role"];
  const subFromClaims = identity?.sub ?? identity?.username;

  const resolvedInput: PresignMediaUploadInput = directInput
    ? {
        ...directInput,
        tenantId: directInput.tenantId ?? (tenantFromClaims || ""),
        userRole: directInput.userRole ?? (roleFromClaims || "HOTEL_ADMIN"),
        actorUserId: directInput.actorUserId ?? (subFromClaims || "SYSTEM"),
      }
    : (event as PresignMediaUploadInput);

  const result = await generatePresignedMediaUploadUrl(resolvedInput, deps);
  if (!result.ok) {
    throw new Error(`[${result.error.code}] ${result.error.message}`);
  }
  return result.value;
}
