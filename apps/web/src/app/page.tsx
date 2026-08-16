import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">ChatAI</p>
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Build AI assistants on your knowledge
        </h1>
        <p className="max-w-md text-base text-muted-foreground">
          Create an assistant, upload documents, test answers with citations, then embed a chat widget on
          your site. Open source and self-hostable.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {session ? (
          <Link href="/dashboard">
            <Button>Go to dashboard</Button>
          </Link>
        ) : (
          <>
            <Link href="/signup">
              <Button>Get started</Button>
            </Link>
            <Link href="/login">
              <Button variant="outline">Sign in</Button>
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
