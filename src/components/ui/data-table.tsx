import React from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  render?: (item: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  data: readonly T[];
  emptyMessage?: string;
  caption?: string;
  className?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  emptyMessage = 'No records found.',
  caption,
  className = '',
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div
        className={`border-border-hairline bg-surface text-muted-foreground border p-8 text-center font-mono text-xs ${className}`}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`border-border-hairline bg-surface overflow-x-auto border ${className}`}>
      {/* Desktop & Tablet Table */}
      <table className="hidden w-full text-left md:table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-border-hairline bg-surface-elevated text-muted-foreground border-b font-mono text-[11px] tracking-wider uppercase">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-4 py-3 font-semibold ${
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                } ${col.className || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border-hairline text-foreground divide-y text-sm">
          {data.map((item, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-surface-elevated/40 transition-colors">
              {columns.map((col) => {
                const alignClass =
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left';
                return (
                  <td
                    key={col.key}
                    className={`px-4 py-3 align-middle ${alignClass} ${col.className || ''}`}
                  >
                    {col.render ? col.render(item, rowIdx) : String(item[col.key] ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile Stacked Rows (under md breakpoint) */}
      <div className="divide-border-hairline divide-y md:hidden">
        {data.map((item, rowIdx) => (
          <div key={rowIdx} className="space-y-2 p-4">
            {columns.map((col) => (
              <div key={col.key} className="flex items-center justify-between gap-4 text-xs">
                <span className="text-muted-foreground font-mono tracking-wide uppercase">
                  {col.header}
                </span>
                <span className="text-foreground text-right font-medium">
                  {col.render ? col.render(item, rowIdx) : String(item[col.key] ?? '')}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
