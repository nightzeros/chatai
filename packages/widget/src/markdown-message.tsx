/** @jsxImportSource preact */
import type { ComponentChildren, VNode } from "preact";

export function isSafeHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:");
}

type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineToken[] }
  | { type: "strong"; children: InlineToken[] }
  | { type: "em"; children: InlineToken[] };

type Block =
  | { type: "paragraph"; children: InlineToken[] }
  | { type: "code"; value: string; language?: string }
  | { type: "ul"; items: InlineToken[][] }
  | { type: "ol"; items: InlineToken[][] };

const AUTOLINK_RE = /(https?:\/\/[^\s<>()]+|mailto:[^\s<>()]+)/g;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/;
const INLINE_CODE_RE = /`([^`]+)`/;
const STRONG_RE = /\*\*([^*]+)\*\*|__([^_]+)__/;
const EM_RE = /\*([^*]+)\*|_([^_]+)_/;

function pushText(tokens: InlineToken[], value: string) {
  if (!value) return;
  AUTOLINK_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = AUTOLINK_RE.exec(value))) {
    const raw = match[1] ?? "";
    if (match.index > last) {
      tokens.push({ type: "text", value: value.slice(last, match.index) });
    }
    const href = raw.replace(/[.,;:!?)]+$/, "");
    const trailing = raw.slice(href.length);
    if (isSafeHref(href)) {
      tokens.push({ type: "link", href, children: [{ type: "text", value: href }] });
    } else {
      tokens.push({ type: "text", value: raw });
    }
    if (trailing) tokens.push({ type: "text", value: trailing });
    last = match.index + match[0].length;
  }
  if (last < value.length) {
    tokens.push({ type: "text", value: value.slice(last) });
  }
}

function parseInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = input;

  while (rest.length > 0) {
    const code = INLINE_CODE_RE.exec(rest);
    const link = MD_LINK_RE.exec(rest);
    const strong = STRONG_RE.exec(rest);
    const em = EM_RE.exec(rest);

    const candidates = [
      code ? { kind: "code" as const, index: code.index, match: code } : null,
      link ? { kind: "link" as const, index: link.index, match: link } : null,
      strong ? { kind: "strong" as const, index: strong.index, match: strong } : null,
      em ? { kind: "em" as const, index: em.index, match: em } : null,
    ].filter((c): c is NonNullable<typeof c> => c != null);

    if (candidates.length === 0) {
      pushText(tokens, rest);
      break;
    }

    candidates.sort((a, b) => a.index - b.index || a.match[0].length - b.match[0].length);
    const next = candidates[0];
    if (!next) break;
    if (next.index > 0) {
      pushText(tokens, rest.slice(0, next.index));
    }

    if (next.kind === "code") {
      tokens.push({ type: "code", value: next.match[1] ?? "" });
    } else if (next.kind === "link") {
      const href = next.match[2] ?? "";
      const label = next.match[1] ?? "";
      if (isSafeHref(href)) {
        tokens.push({ type: "link", href, children: parseInline(label) });
      } else {
        pushText(tokens, next.match[0]);
      }
    } else if (next.kind === "strong") {
      const inner = next.match[1] ?? next.match[2] ?? "";
      tokens.push({ type: "strong", children: parseInline(inner) });
    } else {
      const inner = next.match[1] ?? next.match[2] ?? "";
      tokens.push({ type: "em", children: parseInline(inner) });
    }

    rest = rest.slice(next.index + next.match[0].length);
  }

  return tokens;
}

function isUnorderedItem(line: string) {
  return /^[-*+]\s+/.test(line);
}

function isOrderedItem(line: string) {
  return /^\d+\.\s+/.test(line);
}

export function parseMarkdownBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || undefined;
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", value: body.join("\n"), language });
      continue;
    }

    if (isUnorderedItem(line) || isOrderedItem(line)) {
      const ordered = isOrderedItem(line);
      const items: InlineToken[][] = [];
      while (i < lines.length) {
        const itemLine = lines[i] ?? "";
        if (!(ordered ? isOrderedItem(itemLine) : isUnorderedItem(itemLine))) break;
        const text = itemLine.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, "");
        items.push(parseInline(text));
        i += 1;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (
        next.trim() === "" ||
        next.startsWith("```") ||
        isUnorderedItem(next) ||
        isOrderedItem(next)
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  }

  return blocks;
}

function renderInline(tokens: InlineToken[], keyPrefix: string): ComponentChildren[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "text":
        return token.value;
      case "code":
        return (
          <code key={key} className="chatai-md-code">
            {token.value}
          </code>
        );
      case "link":
        return (
          <a key={key} href={token.href} target="_blank" rel="noreferrer" className="chatai-md-link">
            {renderInline(token.children, key)}
          </a>
        );
      case "strong":
        return <strong key={key}>{renderInline(token.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(token.children, key)}</em>;
      default:
        return null;
    }
  });
}

function renderBlocks(blocks: Block[]): VNode[] {
  return blocks.map((block, index) => {
    const key = `b-${index}`;
    if (block.type === "paragraph") {
      return (
        <p key={key} className="chatai-md-p">
          {renderInline(block.children, key)}
        </p>
      );
    }
    if (block.type === "code") {
      return (
        <pre key={key} className="chatai-md-pre">
          <code className={block.language ? `language-${block.language}` : undefined}>{block.value}</code>
        </pre>
      );
    }
    const ListTag = block.type === "ol" ? "ol" : "ul";
    return (
      <ListTag key={key} className={block.type === "ol" ? "chatai-md-ol" : "chatai-md-ul"}>
        {block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
        ))}
      </ListTag>
    );
  });
}

export function MarkdownMessage({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const blocks = content ? parseMarkdownBlocks(content) : [];

  return (
    <div className="chatai-md">
      {blocks.length > 0 ? renderBlocks(blocks) : null}
      {streaming ? <span className="chatai-md-caret" aria-hidden /> : null}
    </div>
  );
}
