export type WorkspaceNavItem = {
  href: string;
  label: string;
  exact?: boolean;
};

export type WorkspaceNavGroup = {
  id: string;
  label: string;
  items: WorkspaceNavItem[];
};

/** Single source of truth for assistant workspace destinations. */
export const WORKSPACE_NAV_GROUPS: WorkspaceNavGroup[] = [
  {
    id: "build",
    label: "Build",
    items: [
      { href: "", label: "Overview", exact: true },
      { href: "/knowledge", label: "Knowledge" },
      { href: "/identity", label: "Identity" },
      { href: "/playground", label: "Playground" },
    ],
  },
  {
    id: "deploy",
    label: "Deploy",
    items: [{ href: "/widget", label: "Widget" }],
  },
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { href: "/conversations", label: "Conversations" },
      { href: "/insights", label: "Insights" },
    ],
  },
  {
    id: "configure",
    label: "Configure",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

export function flatWorkspaceNav(): WorkspaceNavItem[] {
  return WORKSPACE_NAV_GROUPS.flatMap((group) => group.items);
}

export function workspaceHref(assistantId: string, itemHref: string): string {
  return `/dashboard/assistants/${assistantId}${itemHref}`;
}

export function isWorkspaceItemActive(
  pathname: string,
  assistantId: string,
  item: WorkspaceNavItem,
): boolean {
  const href = workspaceHref(assistantId, item.href);
  if (item.exact) return pathname === href;
  if (item.href === "/settings" || item.href === "/insights" || item.href === "/widget") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function currentWorkspaceItem(
  pathname: string,
  assistantId: string,
): WorkspaceNavItem | null {
  const items = flatWorkspaceNav();
  // Prefer longest matching prefix (e.g. settings over overview).
  let best: WorkspaceNavItem | null = null;
  let bestLen = -1;
  for (const item of items) {
    if (!isWorkspaceItemActive(pathname, assistantId, item)) continue;
    const len = item.href.length;
    if (len > bestLen) {
      best = item;
      bestLen = len;
    }
  }
  return best;
}

export const SETTINGS_SECTIONS = [
  { href: "models", label: "Models" },
  { href: "retrieval", label: "Retrieval" },
  { href: "voice", label: "Voice" },
  { href: "privacy", label: "Privacy" },
  { href: "security", label: "Security" },
] as const;

export function currentSettingsSection(pathname: string, assistantId: string): string | null {
  const base = `/dashboard/assistants/${assistantId}/settings/`;
  if (!pathname.startsWith(base)) return null;
  const rest = pathname.slice(base.length).split("/")[0] ?? "";
  return SETTINGS_SECTIONS.some((s) => s.href === rest) ? rest : null;
}
