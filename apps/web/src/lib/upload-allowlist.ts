export const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "txt",
  "md",
  "markdown",
  "docx",
  "csv",
  "html",
  "htm",
  "json",
]);

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/html",
  "application/json",
]);

export const ALLOWED_UPLOAD_LABEL =
  "PDF, TXT, Markdown, DOCX, CSV, HTML, or JSON";

export function fileExtension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function isAllowedUpload(file: { name: string; type: string }) {
  const ext = fileExtension(file.name);
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(file.type);
}
