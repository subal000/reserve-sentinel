// The Unwind mark: a coil releasing into a straight line — a position being
// unwound. Geometry matches brand/unwind/*.svg; the gradient id is suffixed so
// several marks can share a page without colliding.
export function UnwindMark({ size = 28, id = "m" }: { size?: number; id?: string }) {
  return (
    <svg
      width={size}
      height={(size * 44) / 64}
      viewBox="12 14 52 28"
      fill="none"
      role="img"
      aria-label="Unwind"
    >
      <defs>
        <linearGradient id={`unwind-${id}`} gradientUnits="userSpaceOnUse" x1="21" y1="0" x2="61" y2="0">
          <stop offset="0" stopColor="currentColor" />
          <stop offset=".22" stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity=".1" />
        </linearGradient>
      </defs>
      <path d="M21 33 H58" stroke={`url(#unwind-${id})`} strokeWidth="4.6" strokeLinecap="round" />
      <path d="M30 24 A9 9 0 1 0 21 33" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" />
    </svg>
  );
}

export function UnwindWordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <UnwindMark size={size} id="nav" />
      <span className="font-display text-[17px] font-semibold tracking-tight">Unwind</span>
    </span>
  );
}
