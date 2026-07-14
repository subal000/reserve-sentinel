import { ISSUER_NAME, TRUST_TIER_LABEL } from "@/lib/scoring";

// Shows the issuer and a 0–3 trust-tier meter (filled pips = more custodial backing).
export function IssuerBadge({ issuer, trustTier }: { issuer: number; trustTier: number }) {
  return (
    <div
      className="flex items-center gap-2"
      title={`${ISSUER_NAME[issuer] ?? "Unknown"} · Trust tier ${trustTier}/3 — ${TRUST_TIER_LABEL[trustTier] ?? ""}`}
    >
      <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {ISSUER_NAME[issuer] ?? "Unknown"}
      </span>
      <span className="flex items-center gap-0.5" aria-label={`Trust tier ${trustTier} of 3`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-3 rounded-full ${i < trustTier ? "bg-primary" : "bg-muted"}`}
            aria-hidden="true"
          />
        ))}
      </span>
    </div>
  );
}
