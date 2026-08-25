"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-9 w-full max-w-xs rounded-md border border-border bg-muted/40" aria-hidden />;
  }

  return (
    <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="Theme">
      {options.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant="ghost"
          className={cn("gap-1.5", theme === value && "bg-accent text-foreground")}
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
        >
          <Icon className="size-3.5" />
          {label}
        </Button>
      ))}
    </div>
  );
}
