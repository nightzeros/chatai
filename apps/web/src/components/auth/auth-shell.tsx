import { BrandLockup } from "@/components/brand/logo";
import { BrandAttribution } from "@/components/brand/attribution";
import { getDocsUrl } from "@/lib/docs-url";
import { CONTRIBUTING_URL, GITHUB_REPO_URL } from "@/lib/site";

export function AuthShell({
  children,
  title,
  description,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
}) {
  const docsUrl = getDocsUrl();

  return (
    <div className="atmosphere relative flex min-h-screen flex-col overflow-hidden">
      <div className="atmosphere-grain pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-12">
        <div className="space-y-3 text-center">
          <div className="flex flex-col items-center gap-2">
            <BrandLockup />
            <p className="max-w-xs text-sm text-muted-foreground">
              Open-source AI assistants grounded in your knowledge.
            </p>
            <BrandAttribution variant="stacked" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card/90 p-6 shadow-sm backdrop-blur-sm">{children}</div>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <a href={docsUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
            Docs
          </a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            GitHub
          </a>
          <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            Contribute
          </a>
        </nav>
      </div>
    </div>
  );
}
