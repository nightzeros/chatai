import { cleanContent } from "./clean";
import type { ExtractedBlock } from "./types";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function rowToBlock(headers: string[], values: string[]) {
  const lines = headers
    .map((header, index) => {
      const value = values[index]?.trim() ?? "";
      if (!header || !value) return null;
      return `${header}: ${value}`;
    })
    .filter((line): line is string => Boolean(line));

  const content = cleanContent(lines.join("\n"));
  return content ? { content } : null;
}

export function extractFromCsv(raw: string): ExtractedBlock[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error("CSV files must include a header row.");
  }

  const headers = parseCsvLine(lines[0] ?? "");
  if (headers.every((header) => header.length === 0)) {
    throw new Error("CSV files must include a header row.");
  }

  const blocks: ExtractedBlock[] = [];
  for (const line of lines.slice(1)) {
    const block = rowToBlock(headers, parseCsvLine(line));
    if (block) blocks.push(block);
  }

  return blocks;
}
