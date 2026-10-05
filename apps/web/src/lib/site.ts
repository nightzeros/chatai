/** Public site URLs for OSS discoverability. */
export const GITHUB_REPO_URL = "https://github.com/nightzeros/chatai";
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
export const CONTRIBUTING_URL = `${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`;

/** Public brand metadata — navigation/marketing only; runtime URLs stay env-based. */
export const brand = {
  company: {
    name: "NightZeros",
    url: "https://nightzeros.com",
  },
  product: {
    name: "ChatAI",
    projectNumber: "NZ/001",
    marketingUrl: "https://nightzeros.com/chatai",
    appUrl: "https://app.nightzeros.com",
    docsUrl: "https://docs.nightzeros.com",
  },
} as const;

export const COMPANY_CONTACT_EMAIL = "hello@nightzeros.com";
