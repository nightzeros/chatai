/** Static product frame for the landing hero — honest UI mock, no live API. */
export function ProductShowcase() {
  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_80px_-32px_oklch(0.3_0.05_220/0.45)]">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="ml-3 font-mono text-[11px] text-muted-foreground">dashboard · Support Assistant</span>
        </div>
        <div className="grid gap-0 md:grid-cols-[9.5rem_minmax(0,1fr)]">
          <aside className="hidden border-r border-border bg-muted/20 p-3 md:block">
            <p className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Build</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              <li className="rounded-md bg-accent px-2 py-1.5 font-medium text-foreground">Overview</li>
              <li className="rounded-md px-2 py-1.5 text-muted-foreground">Knowledge</li>
              <li className="rounded-md px-2 py-1.5 text-muted-foreground">Playground</li>
            </ul>
            <p className="mt-3 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Deploy</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li className="rounded-md px-2 py-1.5">Customize</li>
              <li className="rounded-md px-2 py-1.5">Install</li>
            </ul>
          </aside>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div>
              <p className="font-display text-lg font-semibold tracking-tight">Overview</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Knowledge ready · widget signing optional</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["12", "Knowledge"],
                ["48", "Conversations"],
                ["3", "Unanswered"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-lg border border-border bg-background px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="mt-0.5 font-display text-xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex min-h-40 flex-col overflow-hidden rounded-xl border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-xs font-medium">Playground</p>
                <span className="rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">Live</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3 text-xs">
                <div className="ml-auto max-w-[75%] rounded-2xl rounded-tr-md bg-primary px-3 py-2 text-primary-foreground">
                  What is your refund period?
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-muted px-3 py-2 text-foreground">
                  You have a 30-day refund window from the purchase date.
                  <p className="mt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Sources · 2</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-6 -bottom-8 -z-10 h-24 bg-gradient-to-t from-background to-transparent"
      />
    </div>
  );
}
