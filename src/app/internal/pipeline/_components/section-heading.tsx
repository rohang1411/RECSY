import { Activity, Database, type LucideIcon } from 'lucide-react';

const ICONS = {
  activity: Activity,
  database: Database,
} satisfies Record<string, LucideIcon>;

export function SectionHeading({
  eyebrow,
  title,
  description,
  icon,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly icon: keyof typeof ICONS;
}) {
  const Icon = ICONS[icon];

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.22em] uppercase">
          {eyebrow}
        </p>
        <h2 className="text-foreground mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <Icon className="text-primary size-5" aria-hidden />
          {title}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
