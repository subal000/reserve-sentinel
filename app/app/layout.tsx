import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { ShieldHalf } from "lucide-react";
import { CLUSTER } from "@/lib/anchor";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "ReserveSentinel — risk scores for tokenized stocks",
  description:
    "Real-time, on-chain risk scoring for tokenized RWA stocks on Solana. A free public early-warning feed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
          <div className="container flex h-14 items-center justify-between">
            <Link
              href="/"
              className="group flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ShieldHalf className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="font-semibold tracking-tight">
                Reserve<span className="text-primary">Sentinel</span>
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/basket">Basket</NavLink>
              <NavLink href="/backtest">Backtest</NavLink>
              <span
                className="ml-2 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                title="Reading scores from this cluster"
              >
                {CLUSTER}
              </span>
            </nav>
          </div>
        </header>
        <main className="container py-8">{children}</main>
        <footer className="container border-t border-border py-6 text-xs text-muted-foreground">
          Scores are read directly from on-chain PDAs. Informational only — not financial advice.
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </Link>
  );
}
