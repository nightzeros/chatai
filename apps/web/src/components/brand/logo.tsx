import Link from "next/link";

import { BrandAttribution } from "@/components/brand/attribution";
import { cn } from "@/lib/utils";

export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d="M8 11.5c0-1.1.9-2 2-2h8.5c2.5 0 4.5 2 4.5 4.5S21 18.5 18.5 18.5H14l-3.2 3.2c-.5.5-1.3.1-1.3-.6V11.5z"
        className="fill-brand-foreground"
      />
      <circle cx="12.2" cy="14.2" r="1.1" className="fill-brand" />
      <circle cx="16" cy="14.2" r="1.1" className="fill-brand" />
      <circle cx="19.8" cy="14.2" r="1.1" className="fill-brand" />
    </svg>
  );
}

export function BrandLockup({
  href = "/",
  className,
  markSize = 28,
  showAttribution = false,
}: {
  href?: string;
  className?: string;
  markSize?: number;
  showAttribution?: boolean;
}) {
  return (
    <div className={cn("inline-flex flex-col gap-0.5", className)}>
      <Link
        href={href}
        className="inline-flex items-center gap-2.5 text-foreground transition-opacity hover:opacity-90"
      >
        <BrandMark size={markSize} />
        <span className="font-display text-xl font-semibold tracking-tight">ChatAI</span>
      </Link>
      {showAttribution ? (
        <BrandAttribution variant="stacked" style={{ paddingLeft: markSize + 10 }} />
      ) : null}
    </div>
  );
}
