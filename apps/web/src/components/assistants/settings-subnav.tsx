"use client";

import { usePathname } from "next/navigation";

import { SectionNav } from "@/components/layout/section-nav";
import { SETTINGS_SECTIONS } from "@/lib/workspace-nav";

export function SettingsSubnav({ assistantId }: { assistantId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/assistants/${assistantId}/settings`;
  const items = SETTINGS_SECTIONS.map((item) => ({
    id: item.href,
    label: item.label,
    href: `${base}/${item.href}`,
  }));
  const activeId =
    items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.id ??
    items[0]?.id ??
    "models";

  return (
    <SectionNav
      label="Settings sections"
      items={items}
      activeId={activeId}
      variant="auto"
      className="md:mb-0"
    />
  );
}
