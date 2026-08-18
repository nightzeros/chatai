import path from "node:path";

import { env } from "@/lib/env";

import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  ALLOWED_UPLOAD_LABEL,
  fileExtension,
  isAllowedUpload,
} from "./upload-allowlist";

export {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  ALLOWED_UPLOAD_LABEL,
  fileExtension,
  isAllowedUpload,
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function resolveUploadDir() {
  return path.isAbsolute(env.UPLOAD_DIR) ? env.UPLOAD_DIR : path.resolve(process.cwd(), env.UPLOAD_DIR);
}

export function uploadPathFor(documentId: string) {
  return path.join(resolveUploadDir(), documentId);
}
