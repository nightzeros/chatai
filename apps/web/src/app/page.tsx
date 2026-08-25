import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getDocsUrl } from "@/lib/docs-url";
import { getSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getSession();
  const docsUrl = getDocsUrl();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.96_0.01_250)_0%,_transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top,_oklch(0.22_0.02_250)_0%,_transparent_55%)]"
      />
      <div className="relative flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-semibold tracking-tight text-foreground">ChatAI</p>
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Build AI assistants on your knowledge
        </h1>
        <p className="max-w-md text-base text-muted-foreground">
          Create an assistant, upload documents, test answers with citations, then embed a chat widget on
          your site. Open source and self-hostable.
        </p>
      </div>
      <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
        {session ? (
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        ) : (
          <>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </>
        )}
        <Button asChild variant="ghost">
          <a href={docsUrl} target="_blank" rel="noreferrer">
            Documentation
          </a>
        </Button>
        <Button asChild variant="ghost">
          <a href="https://github.com/master-tecs/chatai" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </Button>
      </div>
    </main>
  );
}
