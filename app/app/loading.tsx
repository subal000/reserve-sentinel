// Skeleton that mirrors the dashboard's card grid, so layout doesn't jump.
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="h-9 w-2/3 max-w-md animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full max-w-prose animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
