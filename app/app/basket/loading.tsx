export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full max-w-prose animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
