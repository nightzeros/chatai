"use client";

import { usePathname } from "next/navigation";

import { CopyableId } from "@/components/assistants/copyable-id";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import {
  currentSettingsSection,
  currentWorkspaceItem,
  workspaceHref,
} from "@/lib/workspace-nav";

/**
 * Slim page chrome for an assistant workspace.
 * Destinations live in the app shell sidebar (and mobile drawer).
 */
export function WorkspaceContextBar({
  assistantId,
  assistantName,
  publicId,
}: {
  assistantId: string;
  assistantName: string;
  publicId: string;
}) {
  const pathname = usePathname();
  const page = currentWorkspaceItem(pathname, assistantId);
  const settingsSection = currentSettingsSection(pathname, assistantId);
  const sectionLabel =
    settingsSection != null
      ? settingsSection.charAt(0).toUpperCase() + settingsSection.slice(1)
      : null;

  const crumbs = [
    { label: "Assistants", href: "/dashboard" },
    { label: assistantName, href: workspaceHref(assistantId, "") },
    ...(page ? [{ label: page.label }] : []),
    ...(sectionLabel && page?.href === "/settings" ? [{ label: sectionLabel }] : []),
  ];

  return (
    <div className="space-y-2 border-b border-border pb-4">
      <Breadcrumb items={crumbs} />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="truncate text-lg font-semibold tracking-tight">{assistantName}</h1>
        <CopyableId value={publicId} />
      </div>
    </div>
  );
}
