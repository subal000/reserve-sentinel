import type { Metadata } from "next";
import { Inter, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { CLUSTER } from "@/lib/anchor";
import { UnwindWordmark } from "@/components/UnwindMark";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Instrument_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Unwind — can you actually sell it?",
  description:
    "Unwind measures what tokenized stocks really sell for, at size, and publishes it on-chain. $39M is pledged as loan collateral; $5M of it can be sold.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
          <div className="container flex h-16 items-center justify-between gap-4">
            <Link
              href="/"
              className="rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <UnwindWordmark />
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/scores">Live scores</NavLink>
              <NavLink href="/basket" className="hidden sm:inline-flex">
                Basket
              </NavLink>
              <NavLink href="/backtest" className="hidden sm:inline-flex">
                Backtest
              </NavLink>
              <span
                className="ml-1 rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
                title="Scores are read from this cluster"
              >
                {CLUSTER}
              </span>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="border-t border-border/70">
          <div className="container flex flex-col gap-3 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              Scores are read directly from on-chain accounts. Informational only — not financial
              advice.
            </p>
            <div className="flex items-center gap-4">
              <a
                className="hover:text-foreground"
                href="https://github.com/subal000/reserve-sentinel"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <a
                className="hover:text-foreground"
                href="https://x.com/unwindfi"
                target="_blank"
                rel="noreferrer"
              >
                @unwindfi
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

function NavLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
    >
      {children}
    </Link>
  );
}
