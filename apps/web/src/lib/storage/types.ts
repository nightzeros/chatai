export type ObjectRange = { start: number; end?: number };

export type StoredObjectBody = {
  body: ReadableStream<Uint8Array>;
  /** Full object size. */
  byteSize: number;
  /** Bytes in `body` (equals byteSize when no range was requested). */
  contentLength: number;
  contentType: string | null;
  /** Inclusive byte range actually returned, when a range was requested. */
  range: { start: number; end: number } | null;
};

/**
 * Minimal S3-compatible object storage used by Voice recordings.
 * Keys are opaque and must never be sent to browsers.
 */
export interface ObjectStorageProvider {
  readonly id: "s3" | "memory";
  putFile(key: string, filePath: string, options: { contentType: string }): Promise<{ byteSize: number }>;
  head(key: string): Promise<{ byteSize: number; contentType: string | null } | null>;
  /** Null when the object does not exist. */
  get(key: string, range?: ObjectRange): Promise<StoredObjectBody | null>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
}
