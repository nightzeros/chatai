import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProductVersion } from "@/lib/product-version";
import { brand, GITHUB_REPO_URL } from "@/lib/site";

export function AboutCard() {
  const version = getProductVersion();

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>About ChatAI</CardTitle>
        <CardDescription>
          Open-source AI assistants grounded in your knowledge. ChatAI is an open-source project
          built by {brand.company.name}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>Version {version}</span>
          <span aria-hidden>·</span>
          <span>{brand.product.projectNumber}</span>
        </div>
        <nav className="flex flex-col gap-2">
          <a
            href={brand.product.marketingUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            ChatAI website
          </a>
          <a
            href={brand.product.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            Documentation
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            GitHub
          </a>
          <a
            href={brand.company.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            {brand.company.name}
          </a>
        </nav>
        <p className="text-xs text-muted-foreground">
          Self-hosted instances use your own origin; links above are the public NightZeros-hosted
          surfaces.
        </p>
      </CardContent>
    </Card>
  );
}
