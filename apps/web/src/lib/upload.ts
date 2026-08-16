import path from "node:path";

import { env } from "@/lib/env";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const ALLOWED_EXTENSIONS = new Set(["pdf", "txt", "md", "markdown", "docx"]);

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function resolveUploadDir() {
  return path.isAbsolute(env.UPLOAD_DIR) ? env.UPLOAD_DIR : path.resolve(process.cwd(), env.UPLOAD_DIR);
}

export function uploadPathFor(documentId: string) {
  return path.join(resolveUploadDir(), documentId);
}

export function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function isAllowedUpload(file: { name: string; type: string }) {
  const ext = fileExtension(file.name);
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(file.type);
}
