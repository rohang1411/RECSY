'use client';

import React from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

export interface LedgerEntryRecord extends Record<string, unknown> {
  id: string;
  createdAt: string;
  reason: string;
  delta: number;
  balanceAfter: number;
}

export interface LedgerTableProps {
  entries: readonly LedgerEntryRecord[];
  className?: string;
}

export function LedgerTable({ entries, className = '' }: LedgerTableProps) {
  const columns: DataTableColumn<LedgerEntryRecord>[] = [
    {
      key: 'createdAt',
      header: 'Timestamp',
      className: 'font-mono text-xs text-muted-foreground whitespace-nowrap',
      render: (item) => {
        try {
          const d = new Date(String(item.createdAt));
          return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
        } catch {
          return String(item.createdAt);
        }
      },
    },
    {
      key: 'reason',
      header: 'Transaction',
      className: 'font-mono text-xs font-medium text-foreground',
      render: (item) => String(item.reason).replace(/_/g, ' '),
    },
    {
      key: 'delta',
      header: 'Delta',
      align: 'right',
      className: 'font-mono text-xs font-bold',
      render: (item) => {
        const delta = Number(item.delta);
        if (delta > 0) {
          return <span className="text-accent">+{delta}</span>;
        }
        if (delta < 0) {
          return <span className="text-muted-foreground">{delta}</span>;
        }
        return <span className="text-muted-foreground">0</span>;
      },
    },
    {
      key: 'balanceAfter',
      header: 'Balance',
      align: 'right',
      className: 'font-mono text-xs font-semibold text-foreground',
      render: (item) => `${item.balanceAfter} credits`,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={entries}
      emptyMessage="No purchases or credit transactions yet."
      caption="Financial Credit Ledger"
      className={className}
    />
  );
}
