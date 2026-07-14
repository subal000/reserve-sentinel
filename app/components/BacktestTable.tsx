import { RISK_HSL, riskKey } from "@/lib/scoring";
import { explorerTx } from "@/lib/utils";
import type { BacktestPoint } from "./BacktestChart";

// Full bucket-by-bucket data, collapsed by default. <details>/<summary> gives
// keyboard/screen-reader support and a toggle for free, no JS state needed.
export function BacktestTable({ series }: { series: BacktestPoint[] }) {
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        <span>All {series.length} buckets</span>
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="max-h-96 overflow-y-auto border-t border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-popover">
            <tr className="text-left text-muted-foreground">
              <Th>Bucket (UTC)</Th>
              <Th align="right">Net mint</Th>
              <Th align="right">Minted</Th>
              <Th align="right">Burned</Th>
              <Th align="right">Z-score</Th>
              <Th align="right">Proc. comp</Th>
              <Th align="right">Txns</Th>
            </tr>
          </thead>
          <tbody>
            {series.map((s, i) => (
              <tr key={s.ts} className={i % 2 === 1 ? "bg-muted/30" : undefined}>
                <Td className="font-mono">{s.date}</Td>
                <Td align="right" className="font-mono tnum">
                  {fmt(s.netMint)}
                </Td>
                <Td align="right" className="font-mono tnum text-muted-foreground">
                  {fmt(s.mintVol)}
                </Td>
                <Td align="right" className="font-mono tnum text-muted-foreground">
                  {fmt(s.burnVol)}
                </Td>
                <Td align="right" className="font-mono tnum">
                  {s.z.toFixed(2)}
                </Td>
                <Td align="right" className="font-mono tnum" style={{ color: RISK_HSL[riskKey(s.procComp)] }}>
                  {s.procComp.toFixed(0)}
                </Td>
                <Td align="right">
                  {s.sigs.length > 0 ? (
                    <a
                      href={explorerTx(s.sigs[0])}
                      target="_blank"
                      rel="noreferrer"
                      title={s.sigs.join("\n")}
                      className="font-mono text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {s.sigs.length}↗
                    </a>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({
  children,
  align = "left",
  className = "",
  style,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <td className={`px-3 py-1.5 ${align === "right" ? "text-right" : "text-left"} ${className}`} style={style}>
      {children}
    </td>
  );
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(abs < 1 ? 3 : 0);
}
