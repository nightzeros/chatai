import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { LandingHero } from "@/components/marketing/landing-hero";
import { Button } from "@/components/ui/button";
import { getDocsUrl } from "@/lib/docs-url";
import { getSession } from "@/lib/session";
import { CONTRIBUTING_URL, GITHUB_ISSUES_URL, GITHUB_REPO_URL } from "@/lib/site";

export default async function HomePage() {
  const session = await getSession();
  const docsUrl = getDocsUrl();

  return (
    <div className="atmosphere relative flex min-h-screen flex-col overflow-hidden">
      <div className="atmosphere-grain pointer-events-none absolute inset-0" aria-hidden />
      <SiteHeader signedIn={Boolean(session)} docsUrl={docsUrl} />

      <main className="relative z-10 flex-1">
        <LandingHero signedIn={Boolean(session)} docsUrl={docsUrl} />

        <section className="border-t border-border/70 bg-background/60">
          <div className="mx-auto grid max-w-[var(--content-max)] gap-10 px-4 py-14 md:grid-cols-[1.2fr_1fr] md:px-6 md:py-16">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">How it works</h2>
              <ol className="mt-6 space-y-5">
                {[
                  ["Create", "Spin up an assistant with instructions and a welcome message."],
                  ["Add knowledge", "Upload documents, crawl a site, or paste FAQs — then test in the playground."],
                  ["Embed", "Copy one script tag. Optional signing, domain allowlists, and privacy controls."],
                ].map(([title, body], index) => (
                  <li key={title} className="flex gap-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-xs font-medium tabular-nums text-brand">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-medium text-foreground">{title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border border-border bg-card/80 p-6">
              <h2 className="font-display text-xl font-semibold tracking-tight">Contribute</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                ChatAI is built in the open. Star the repo, open an issue, or read the contributing guide.
                A NightZeros open-source project.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                    Star on GitHub
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={GITHUB_ISSUES_URL} target="_blank" rel="noreferrer">
                    Issues
                  </a>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer">
                    Contributing
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter docsUrl={docsUrl} />
    </div>
  );
}
