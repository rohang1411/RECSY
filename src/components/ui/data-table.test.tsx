// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from './data-table';

interface TestItem extends Record<string, unknown> {
  id: string;
  name: string;
  score: number;
}

const COLUMNS: DataTableColumn<TestItem>[] = [
  { key: 'name', header: 'Phone Model' },
  { key: 'score', header: 'Benchmark Score', align: 'right' },
];

const DATA: TestItem[] = [
  { id: '1', name: 'Pixel 9 Pro', score: 92 },
  { id: '2', name: 'iPhone 16 Pro', score: 95 },
];

describe('DataTable', () => {
  it('renders table headers and rows for data items', () => {
    render(<DataTable columns={COLUMNS} data={DATA} caption="Phone Rankings" />);
    // DataTable renders both desktop <table> and mobile stacked cards
    expect(screen.getAllByText('Phone Model').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Benchmark Score').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pixel 9 Pro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('iPhone 16 Pro').length).toBeGreaterThan(0);
  });

  it('renders custom empty message when data is empty', () => {
    render(
      <DataTable columns={COLUMNS} data={[]} emptyMessage="No phones found matching criteria" />,
    );
    expect(screen.getByText('No phones found matching criteria')).toBeInTheDocument();
  });
});
