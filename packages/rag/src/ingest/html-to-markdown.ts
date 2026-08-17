import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import { cleanContent } from "./clean";
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

export function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(
    article?.content ?? document.body?.innerHTML ?? html,
  );
  return cleanContent(markdown);
}

export function extractFromHtml(html: string): ExtractedBlock[] {
  const markdown = htmlToMarkdown(html);
  if (!markdown) return [];
  return markdownHeadings(markdown);
}
