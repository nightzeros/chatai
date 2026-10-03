import { env } from "@/lib/env";

import { createS3ObjectStorage } from "./s3";
import type { ObjectStorageProvider } from "./types";

export type { ObjectRange, ObjectStorageProvider, StoredObjectBody } from "./types";

let override: ObjectStorageProvider | null | undefined;
let cached: ObjectStorageProvider | null | undefined;

/**
 * Configured S3-compatible storage (AWS S3, R2, MinIO), or null when the
 * instance has no bucket/credentials — recording is then unavailable.
 */
export function getObjectStorage(): ObjectStorageProvider | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const bucket = env.OBJECT_STORAGE_BUCKET;
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
  cached =
    bucket && accessKeyId && secretAccessKey
      ? createS3ObjectStorage({
          bucket,
          region: env.OBJECT_STORAGE_REGION,
          endpoint: env.OBJECT_STORAGE_ENDPOINT,
          accessKeyId,
          secretAccessKey,
          forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
        })
      : null;
  return cached;
}

export function isObjectStorageAvailable(): boolean {
  return getObjectStorage() !== null;
}

/** Tests only: `undefined` restores env-based resolution. */
export function setObjectStorageForTests(provider: ObjectStorageProvider | null | undefined): void {
  override = provider;
}
