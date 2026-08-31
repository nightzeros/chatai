/** Shared list of publishable NightZeros client packages (dependency order). */
export const NPM_PUBLIC_PACKAGES = [
  {
    name: "@nightzeros/chatai-widget-core",
    directory: "packages/widget-core",
  },
  {
    name: "@nightzeros/chatai-widget",
    directory: "packages/widget",
  },
  {
    name: "@nightzeros/chatai-react",
    directory: "packages/react",
  },
  {
    name: "@nightzeros/chatai-sdk",
    directory: "packages/sdk",
  },
];

/** Legacy publish names that must not appear in npm tarballs. */
export const LEGACY_PUBLISH_PACKAGE_NAMES = [
  "@chatai/widget-core",
  "@chatai/widget",
  "@chatai/react",
  "@chatai/sdk",
];
