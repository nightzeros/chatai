import { describe, expect, it } from "vitest";

import { buildInstallSnippets, normalizeDeploymentOrigin } from "./install-snippets";

describe("normalizeDeploymentOrigin", () => {
  it("strips trailing slashes from absolute origins", () => {
    expect(normalizeDeploymentOrigin("https://chat.example.com/")).toBe("https://chat.example.com");
  });

  it("rejects relative origins", () => {
    expect(() => normalizeDeploymentOrigin("/widget")).toThrow(/absolute/i);
  });
});

describe("buildInstallSnippets", () => {
  const snippets = buildInstallSnippets({
    deploymentOrigin: "https://chat.example.com/",
    publicId: "asst_demo123",
  });

  it("builds a hosted script embed with async and no secrets", () => {
    expect(snippets.hostedHtml).toBe(
      `<script src="https://chat.example.com/widget/chat.js" data-assistant-id="asst_demo123" async></script>`,
    );
    expect(snippets.hostedHtml).not.toMatch(/secret|api[_-]?key|bearer/i);
    expect(snippets.hostedHtml).not.toContain("data-api-url");
  });

  it("builds a self-hosted script that points chat.js elsewhere and sets data-api-url", () => {
    expect(snippets.selfHostedHtml).toBe(
      `<script src="https://static.example.com/chat.js" data-assistant-id="asst_demo123" data-api-url="https://chat.example.com" async></script>`,
    );
    expect(snippets.selfHostedNote).toMatch(/copy/i);
    expect(snippets.selfHostedNote).toMatch(/\/widget\/chat\.js/);
  });

  it("builds a signed embed snippet with data-sign-endpoint", () => {
    expect(snippets.signedHtml).toContain('data-sign-endpoint="https://chat.example.com/api/v1/widget/sign"');
    expect(snippets.signedHtml).toContain('data-assistant-id="asst_demo123"');
  });

  it("builds a React snippet against the shared package API", () => {
    expect(snippets.reactTsx).toContain('import { ChatWidget } from "@nightzeros/chatai-react";');
    expect(snippets.reactTsx).toContain('assistantId="asst_demo123"');
    expect(snippets.reactTsx).toContain('apiUrl="https://chat.example.com"');
    expect(snippets.reactInstall).toContain("@nightzeros/chatai-react");
    expect(snippets.reactInstall).toContain("pnpm add");
  });

  it("documents security controls available in settings", () => {
    expect(snippets.publicId).toBe("asst_demo123");
    expect(snippets.securityNote).toMatch(/public/i);
    expect(snippets.securityNote).toMatch(/allowlist|signing|rate limit/i);
    expect(snippets.verificationChecklist.length).toBeGreaterThanOrEqual(3);
  });

  it("includes sign endpoint attrs when requireWidgetSigning is enabled", () => {
    const signed = buildInstallSnippets({
      deploymentOrigin: "https://chat.example.com",
      publicId: "asst_demo123",
      requireWidgetSigning: true,
    });
    expect(signed.hostedHtml).toContain("data-sign-endpoint=");
    expect(signed.reactTsx).toContain("signEndpoint=");
  });
});
