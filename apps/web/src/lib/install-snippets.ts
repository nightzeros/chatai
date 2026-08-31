import { WIDGET_ASSET_PATH } from "./widget-delivery";

export type InstallSnippetInput = {
  deploymentOrigin: string;
  publicId: string;
  /** When true, include data-sign-endpoint on HTML snippets. */
  requireWidgetSigning?: boolean;
};

export type InstallSnippets = {
  publicId: string;
  deploymentOrigin: string;
  hostedHtml: string;
  selfHostedHtml: string;
  selfHostedNote: string;
  signedHtml: string;
  reactTsx: string;
  reactInstall: string;
  securityNote: string;
  verificationChecklist: string[];
};

export function normalizeDeploymentOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("Deployment origin must be an absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Deployment origin must be an absolute http(s) URL.");
  }

  return url.origin;
}

export function buildInstallSnippets(input: InstallSnippetInput): InstallSnippets {
  const deploymentOrigin = normalizeDeploymentOrigin(input.deploymentOrigin);
  const publicId = input.publicId.trim();

  if (!publicId) {
    throw new Error("publicId is required.");
  }

  const widgetSrc = `${deploymentOrigin}${WIDGET_ASSET_PATH}`;
  const signEndpoint = `${deploymentOrigin}/api/v1/widget/sign`;
  const signedHtml = `<script
  src="${widgetSrc}"
  data-assistant-id="${publicId}"
  data-api-url="${deploymentOrigin}"
  data-sign-endpoint="${signEndpoint}"
  async
></script>`;

  const hostedAttrs = input.requireWidgetSigning
    ? ` data-api-url="${deploymentOrigin}" data-sign-endpoint="${signEndpoint}"`
    : "";

  return {
    publicId,
    deploymentOrigin,
    hostedHtml: `<script src="${widgetSrc}" data-assistant-id="${publicId}"${hostedAttrs} async></script>`,
    selfHostedHtml: `<script src="https://static.example.com/chat.js" data-assistant-id="${publicId}" data-api-url="${deploymentOrigin}"${
      input.requireWidgetSigning ? ` data-sign-endpoint="${signEndpoint}"` : ""
    } async></script>`,
    selfHostedNote: `Copy ${WIDGET_ASSET_PATH} from this ChatAI instance and host the same file on your static origin. Keep data-api-url pointed at ${deploymentOrigin} so the widget can reach the public chat API.`,
    signedHtml,
    reactInstall: 'pnpm add @nightzeros/chatai-react',
    reactTsx: [
      'import { ChatWidget } from "@nightzeros/chatai-react";',
      "",
      "export function SupportChat() {",
      "  return (",
      "    <ChatWidget",
      `      assistantId="${publicId}"`,
      `      apiUrl="${deploymentOrigin}"`,
      ...(input.requireWidgetSigning
        ? [`      signEndpoint="${signEndpoint}"`,]
        : []),
      "    />",
      "  );",
      "}",
    ].join("\n"),
    securityNote:
      "Anyone with this public ID can open the widget and chat. Treat publicId as a publishable capability, not a secret. Security settings (domain allowlist, rate limits, optional short-lived widget HMAC) are layered defenses — not absolute proof of request origin.",
    verificationChecklist: [
      "Open a page that includes the script tag.",
      "Confirm the launcher appears and opens a chat panel.",
      "Send a question and check Network for /api/v1/assistants/.../config and /api/v1/chat.",
      "Confirm streamed answers arrive and sources follow your Customize settings.",
      ...(input.requireWidgetSigning
        ? ["Confirm chat requests include X-ChatAI-Signature after calling /api/v1/widget/sign."]
        : []),
    ],
  };
}
