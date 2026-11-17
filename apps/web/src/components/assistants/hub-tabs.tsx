"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { SectionNav, type SectionNavItem } from "@/components/layout/section-nav";

export type HubTab = {
  id: string;
  label: string;
  href: string;
};

/** Underline tabs for hub pages (Widget, Insights). Thin wrapper over SectionNav. */
export function HubTabs({ tabs, activeId }: { tabs: HubTab[]; activeId: string }) {
  const items: SectionNavItem[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    href: tab.href,
  }));
  return <SectionNav items={items} activeId={activeId} variant="tabs" label="Section" />;
}

/** Query-param tabs (e.g. Widget appearance/embed). */
export function HubQueryTabs({
  param = "tab",
  tabs,
  defaultId,
}: {
  param?: string;
  tabs: Array<{ id: string; label: string }>;
  defaultId: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? defaultId;
  const activeId = tabs.some((t) => t.id === current) ? current : defaultId;

  return (
    <HubTabs
      activeId={activeId}
      tabs={tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        href: `${pathname}?${param}=${tab.id}`,
      }))}
    />
  );
}
