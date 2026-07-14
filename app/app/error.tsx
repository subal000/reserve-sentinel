"use client";

// Route-level error boundary with a real recovery action.
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-risk-high/40 bg-risk-high/10 p-6">
      <p className="font-medium text-foreground">Something went wrong.</p>
      <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm transition-colors hover:bg-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px"
      >
        Try again
      </button>
    </div>
  );
}
