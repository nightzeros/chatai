import { readFile } from "node:fs/promises";

import type { ObjectStorageProvider } from "./types";

export type MemoryObjectStorage = ObjectStorageProvider & {
  objects: Map<string, { bytes: Uint8Array; contentType: string | null }>;
  /** Failure injection for tests. */
  failPut: number;
  failDelete: number;
};

/** In-process storage for tests and CI (no network, no credentials). */
export function createMemoryObjectStorage(): MemoryObjectStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
  const storage: MemoryObjectStorage = {
    id: "memory",
    objects,
    failPut: 0,
    failDelete: 0,

    async putFile(key, filePath, { contentType }) {
      if (storage.failPut > 0) {
        storage.failPut -= 1;
        throw new Error("memory storage: injected put failure");
      }
      const bytes = new Uint8Array(await readFile(filePath));
      objects.set(key, { bytes, contentType });
      return { byteSize: bytes.byteLength };
    },

    async head(key) {
      const obj = objects.get(key);
      return obj ? { byteSize: obj.bytes.byteLength, contentType: obj.contentType } : null;
    },

    async get(key, range) {
      const obj = objects.get(key);
      if (!obj) return null;
      const size = obj.bytes.byteLength;
      if (range && range.start >= size) {
        // Same shape as the S3 SDK's InvalidRange error.
        throw Object.assign(new Error("InvalidRange"), { $metadata: { httpStatusCode: 416 } });
      }
      const start = range ? range.start : 0;
      const end = range ? Math.min(range.end ?? size - 1, size - 1) : size - 1;
      const slice = obj.bytes.slice(start, end + 1);
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(slice);
            controller.close();
          },
        }),
        byteSize: size,
        contentLength: slice.byteLength,
        contentType: obj.contentType,
        range: range ? { start, end } : null,
      };
    },

    async delete(key) {
      if (storage.failDelete > 0) {
        storage.failDelete -= 1;
        throw new Error("memory storage: injected delete failure");
      }
      objects.delete(key);
    },
  };
  return storage;
}
