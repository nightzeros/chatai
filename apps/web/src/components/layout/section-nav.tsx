"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { NavItem } from "@/components/layout/nav-item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SectionNavItem = {
  id: string;
  label: string;
  href: string;
};

type Props = {
  items: SectionNavItem[];
  activeId: string;
  /** Accessible name for the nav. */
  label?: string;
  /**
   * Forced variant. Default (`auto`):
   * - &lt; md: select when &gt;4 items, else tabs
   * - md–lg: tabs when rail would apply, else tabs
   * - ≥ lg: rail when &gt;2 items, else tabs
   */
  variant?: "rail" | "tabs" | "select" | "auto";
  className?: string;
};

export function SectionNav({
  items,
  activeId,
  label = "Section",
  variant = "auto",
  className,
}: Props) {
  const router = useRouter();
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const useRail = variant === "rail" || (variant === "auto" && items.length > 2);
  const useSelectOnly = variant === "select";
  const forceTabs = variant === "tabs";

  if (forceTabs) {
    return (
      <div className={className}>
        <TabsRow items={items} activeId={activeId} label={label} />
      </div>
    );
  }

  if (useSelectOnly) {
    return (
      <div className={className}>
        <SectionSelect
          id="section-nav-select"
          label={label}
          items={items}
          value={active?.href}
          onChange={(value) => router.push(value)}
        />
      </div>
    );
  }

  // auto / rail: select on small, tabs on md–lg when rail, rail on lg+
  return (
    <div className={cn(useRail && "lg:w-40 lg:shrink-0", className)}>
      <div className="md:hidden">
        {items.length > 4 ? (
          <SectionSelect
            id="section-nav-select-sm"
            label={label}
            items={items}
            value={active?.href}
            onChange={(value) => router.push(value)}
          />
        ) : (
          <TabsRow items={items} activeId={activeId} label={label} />
        )}
      </div>

      {useRail ? (
        <>
          <div className="mb-4 hidden md:block lg:hidden">
            <TabsRow items={items} activeId={activeId} label={label} />
          </div>
          <nav className="hidden lg:block" aria-label={label}>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <NavItem href={item.href} active={item.id === activeId}>
                    {item.label}
                  </NavItem>
                </li>
              ))}
            </ul>
          </nav>
        </>
      ) : (
        <div className="hidden md:block">
          <TabsRow items={items} activeId={activeId} label={label} />
        </div>
      )}
    </div>
  );
}

function SectionSelect({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: SectionNavItem[];
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.href}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TabsRow({
  items,
  activeId,
  label,
}: {
  items: SectionNavItem[];
  activeId: string;
  label: string;
}) {
  return (
    <div
      className="flex gap-1 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label={label}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Link
            key={item.id}
            href={item.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
