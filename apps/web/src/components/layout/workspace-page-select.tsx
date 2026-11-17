"use client";

import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  flatWorkspaceNav,
  isWorkspaceItemActive,
  workspaceHref,
  type WorkspaceNavItem,
} from "@/lib/workspace-nav";
import { cn } from "@/lib/utils";

export function WorkspacePageSelect({
  assistantId,
  pathname,
  className,
}: {
  assistantId: string;
  pathname: string;
  className?: string;
}) {
  const router = useRouter();
  const items = flatWorkspaceNav();
  const current =
    items.find((item) => isWorkspaceItemActive(pathname, assistantId, item)) ?? items[0];

  return (
    <div className={cn("w-full", className)}>
      <label htmlFor="workspace-page" className="sr-only">
        Page
      </label>
      <Select
        value={current ? workspaceHref(assistantId, current.href) : undefined}
        onValueChange={(value) => router.push(value)}
      >
        <SelectTrigger id="workspace-page" className="h-9 w-full">
          <SelectValue placeholder="Go to page" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item: WorkspaceNavItem) => {
            const href = workspaceHref(assistantId, item.href);
            return (
              <SelectItem key={href} value={href}>
                {item.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
