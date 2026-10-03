import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ObjectRange, ObjectStorageProvider, StoredObjectBody } from "./types";

export type S3ObjectStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.$metadata?.httpStatusCode === 404
  );
}

function parseContentRange(value: string | undefined): { start: number; end: number; size: number } | null {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value) : null;
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), size: Number(match[3]) };
}

export function createS3ObjectStorage(config: S3ObjectStorageConfig): ObjectStorageProvider {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const Bucket = config.bucket;

  return {
    id: "s3",

    async putFile(key, filePath, { contentType }) {
      const { size } = await stat(filePath);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: contentType,
        }),
      );
      return { byteSize: size };
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { byteSize: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async get(key, range?: ObjectRange): Promise<StoredObjectBody | null> {
      try {
        const out = await client.send(
          new GetObjectCommand({
            Bucket,
            Key: key,
            Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
          }),
        );
        if (!out.Body) return null;
        const parsed = parseContentRange(out.ContentRange);
        const contentLength = out.ContentLength ?? 0;
        return {
          body: out.Body.transformToWebStream() as ReadableStream<Uint8Array>,
          byteSize: parsed?.size ?? contentLength,
          contentLength,
          contentType: out.ContentType ?? null,
          range: parsed ? { start: parsed.start, end: parsed.end } : null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
    },
  };
}
