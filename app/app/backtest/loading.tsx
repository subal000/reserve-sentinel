export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="h-7 w-64 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full max-w-prose animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-12 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}
