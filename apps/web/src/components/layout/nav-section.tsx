import { cn } from "@/lib/utils";

export function NavSection({
  label,
  children,
  className,
}: {
  label?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3", className)}>
      {label ? (
        <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
          {label}
        </p>
      ) : null}
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}
