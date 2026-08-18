import type { ExtractedBlock } from "../types";

export type SourceItem = {
  key: string;
  name: string;
  url?: string;
  mimeType?: string | null;
  storagePath?: string | null;
  content?: string | null;
};

export type ExtractResult = {
  blocks: ExtractedBlock[];
  contentHash: string;
};

export type LoaderContext = {
  fetch: typeof fetch;
  userAgent: string;
};

export type Loader<TConfig = unknown> = {
  type: string;
  discover(config: TConfig, ctx: LoaderContext): Promise<SourceItem[]>;
  extract(item: SourceItem, ctx: LoaderContext): Promise<ExtractResult>;
};

export const defaultLoaderContext: LoaderContext = {
  fetch: globalThis.fetch.bind(globalThis),
  userAgent: "ChatAIBot",
};
