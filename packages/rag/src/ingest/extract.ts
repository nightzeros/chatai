import { readFile } from "node:fs/promises";

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

import { cleanContent } from "./clean";
import { extractFromCsv } from "./extract-csv";
import { extractFromHtml, htmlToMarkdown } from "./html-to-markdown";
import { extractFromJson } from "./extract-json";
import type { ExtractedBlock } from "./types";

function markdownHeadings(text: string): ExtractedBlock[] {
  const lines = text.split("\n");
  const blocks: ExtractedBlock[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const content = cleanContent(buffer.join("\n"));
    if (content) {
      blocks.push({ content, ...(heading ? { heading } : {}) });
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]?.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

function fileKind(name: string, mimeType?: string | null) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const mime = mimeType ?? "";
  return { ext, mime };
}

export async function extractFromFile(input: {
  storagePath: string;
  mimeType?: string | null;
  name: string;
}): Promise<ExtractedBlock[]> {
  const { ext, mime } = fileKind(input.name, input.mimeType);

  if (ext === "pdf" || mime === "application/pdf") {
    const bytes = await readFile(input.storagePath);
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    return pages
      .map((pageText, index) => ({
        content: cleanContent(pageText),
        page: index + 1,
      }))
      .filter((block) => block.content.length > 0);
  }

  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const buffer = await readFile(input.storagePath);
    const result = await mammoth.extractRawText({ buffer });
    const content = cleanContent(result.value);
    return content ? [{ content }] : [];
  }

  const raw = await readFile(input.storagePath, "utf8");

  if (ext === "csv" || mime === "text/csv") {
    return extractFromCsv(raw);
  }

  if (ext === "json" || mime === "application/json") {
    return extractFromJson(raw);
  }

  if (ext === "html" || ext === "htm" || mime === "text/html") {
    return extractFromHtml(raw);
  }

  const content = cleanContent(raw);
  if (!content) return [];
  if (ext === "md" || ext === "markdown" || mime === "text/markdown") {
    return markdownHeadings(content);
  }
  return [{ content }];
}

export function extractFromText(content: string): ExtractedBlock[] {
  const cleaned = cleanContent(content);
  return cleaned ? markdownHeadings(cleaned) : [];
}

export { htmlToMarkdown };
