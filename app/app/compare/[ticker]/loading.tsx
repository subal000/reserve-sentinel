export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-96 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
