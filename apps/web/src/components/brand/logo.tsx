import Link from "next/link";

import { BrandAttribution } from "@/components/brand/attribution";
import { cn } from "@/lib/utils";

/** A1 Reply Vector — theme-aware (frame = currentColor; ink contrasts via background). */
export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 text-foreground", className)}
      aria-hidden
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <circle cx="12.25" cy="16" r="3.15" className="fill-background" />
      <path
        d="M17.1 12.85 L23.4 10.55"
        className="stroke-background"
        strokeWidth="2.35"
        strokeLinecap="round"
      />
      <path
        d="M17.1 19.15 L23.4 21.45"
        className="stroke-background"
        strokeWidth="2.35"
        strokeLinecap="round"
      />
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
        aria-label="ChatAI home"
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
