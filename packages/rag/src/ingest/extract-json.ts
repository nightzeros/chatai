import { cleanContent } from "./clean";
import type { ExtractedBlock } from "./types";

function objectToBlock(value: Record<string, unknown>): ExtractedBlock | null {
  const lines = Object.entries(value)
    .map(([key, entry]) => {
      if (entry === null || entry === undefined) return null;
      const rendered =
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
          ? String(entry)
          : JSON.stringify(entry);
      const content = cleanContent(rendered);
      return content ? `${key}: ${content}` : null;
    })
    .filter((line): line is string => Boolean(line));

  const content = cleanContent(lines.join("\n"));
  return content ? { content } : null;
}

export function extractFromJson(raw: string): ExtractedBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON file.");
  }

  if (Array.isArray(parsed)) {
    const blocks: ExtractedBlock[] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        const content = cleanContent(item);
        if (content) blocks.push({ content });
        continue;
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const block = objectToBlock(item as Record<string, unknown>);
        if (block) blocks.push(block);
      }
    }
    return blocks;
  }

  if (parsed && typeof parsed === "object") {
    const content = JSON.stringify(parsed, null, 2).trim();
    return content ? [{ content }] : [];
  }

  throw new Error("Invalid JSON file.");
}
