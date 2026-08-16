"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <p className="text-sm font-medium">Something went wrong</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {error.message || "We could not load this page. Try again or return to your assistants list."}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => reset()}>
          Try again
        </Button>
        <Button type="button" onClick={() => (window.location.href = "/dashboard")}>
          Back to assistants
        </Button>
      </div>
    </div>
  );
}
