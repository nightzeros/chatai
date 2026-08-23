import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">ChatAI Docs</h1>
      <p className="mb-8 max-w-md text-fd-muted-foreground">
        Install, self-host, embed the widget, and call the API. Start with Getting Started.
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
