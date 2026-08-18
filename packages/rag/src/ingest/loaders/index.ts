import { faqLoader, textLoader } from "./text";
import { fileLoader } from "./file";
import { websiteLoader } from "./website";
import type { Loader } from "./types";

const loaders = new Map<string, Loader>();

export function registerLoader(loader: Loader) {
  loaders.set(loader.type, loader);
}

export function getLoader(type: string): Loader {
  const loader = loaders.get(type);
  if (!loader) {
    throw new Error(`Unknown loader type: ${type}`);
  }
  return loader;
}

export function loaderTypeForDocument(type: string) {
  return type === "url" ? "website" : type;
}

registerLoader(fileLoader);
registerLoader(textLoader);
registerLoader(faqLoader);
registerLoader(websiteLoader);

export type { ExtractResult, Loader, LoaderContext, SourceItem } from "./types";
export { defaultLoaderContext } from "./types";
