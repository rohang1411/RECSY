export function SectionHint({
  label,
  children,
  className = '',
}: {
  readonly label: string;
  readonly children: string;
  readonly className?: string;
}) {
  return (
    <div className={`group/section-hint inline-flex max-w-full items-center gap-3 ${className}`}>
      <p className="meta-label text-primary shrink-0">{label}</p>
      <span className="border-accent pointer-events-none relative z-20 max-w-[min(560px,62vw)] -translate-x-3 border-l bg-[#241009]/95 px-3 py-2 text-xs leading-5 text-[#ffb06f] opacity-0 shadow-[0_0_32px_rgba(216,107,56,0.28)] transition-all duration-300 ease-out group-focus-within/section-hint:translate-x-0 group-focus-within/section-hint:opacity-100 group-hover/section-hint:translate-x-0 group-hover/section-hint:opacity-100">
        {children}
      </span>
    </div>
  );
}
