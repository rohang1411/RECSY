import type { TableGroup } from '@/services/internal/pipeline-snapshot';

export function DatabaseMap({ groups }: { readonly groups: readonly TableGroup[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((group) => (
        <section
          key={group.name}
          className="border-border/60 bg-card/45 overflow-hidden rounded-lg border backdrop-blur-xl"
        >
          <div
            className="border-border/50 border-b px-4 py-3"
            style={{
              background: `linear-gradient(90deg, color-mix(in oklch, ${group.accent} 16%, transparent), transparent)`,
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-foreground text-sm font-semibold">{group.name}</h3>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {group.description}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {group.tables.length} tables
              </span>
            </div>
          </div>

          <div className="divide-border/50 divide-y">
            {group.tables.map((table) => (
              <article key={table.name} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h4 className="text-foreground font-mono text-sm">{table.name}</h4>
                  <span className="text-foreground font-mono text-sm tabular-nums">
                    {table.rowCount.toLocaleString('en-US')} rows
                  </span>
                </div>
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                  {table.purpose}
                </p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground font-mono uppercase">Written by</p>
                    <p className="text-foreground/90 mt-0.5">{table.writtenBy}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-mono uppercase">Read by</p>
                    <p className="text-foreground/90 mt-0.5">{table.readBy}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
