export default function AssistantLoading() {
  return (
    <div className="flex h-[min(720px,calc(100dvh-16rem))] min-h-[28rem] items-center justify-center rounded-xl border border-border bg-muted/20">
      <p className="text-sm text-muted-foreground">Loading assistant…</p>
    </div>
  );
}
