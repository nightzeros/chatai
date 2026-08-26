import Link from "next/link";

import { brand } from "@/lib/brand";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">ChatAI Docs</h1>
      <p className="mb-2 max-w-md text-fd-muted-foreground">
        Install, self-host, embed the widget, and call the API. Start with Getting Started.
      </p>
      <p className="mb-8 text-sm text-fd-muted-foreground">
        A{" "}
        <a
          href={brand.company.url}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          {brand.company.name}
        </a>{" "}
        project
      </p>
      <Link
        href="/docs"
        className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
      >
        Open documentation
      </Link>
    </main>
  );
}
