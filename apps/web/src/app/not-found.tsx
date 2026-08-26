import Link from "next/link";

import { BrandLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <BrandLockup showAttribution />
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">The page you requested does not exist.</p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Go home</Link>
      </Button>
    </div>
  );
}
