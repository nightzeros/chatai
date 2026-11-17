import { describe, expect, it } from "vitest";

import {
  currentSettingsSection,
  currentWorkspaceItem,
  isWorkspaceItemActive,
  workspaceHref,
} from "./workspace-nav";

describe("workspace-nav", () => {
  const id = "asst_1";

  it("builds workspace hrefs", () => {
    expect(workspaceHref(id, "")).toBe("/dashboard/assistants/asst_1");
    expect(workspaceHref(id, "/settings")).toBe("/dashboard/assistants/asst_1/settings");
  });

  it("matches nested settings and insights routes", () => {
    expect(
      isWorkspaceItemActive("/dashboard/assistants/asst_1/settings/models", id, {
        href: "/settings",
        label: "Settings",
      }),
    ).toBe(true);
    expect(
      isWorkspaceItemActive("/dashboard/assistants/asst_1/insights/evals", id, {
        href: "/insights",
        label: "Insights",
      }),
    ).toBe(true);
  });

  it("prefers the longest matching workspace item", () => {
    const item = currentWorkspaceItem("/dashboard/assistants/asst_1/settings/voice", id);
    expect(item?.label).toBe("Settings");
  });

  it("reads the settings section slug", () => {
    expect(currentSettingsSection("/dashboard/assistants/asst_1/settings/privacy", id)).toBe(
      "privacy",
    );
    expect(currentSettingsSection("/dashboard/assistants/asst_1/playground", id)).toBeNull();
  });
});
