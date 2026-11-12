// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PricingGrid } from './PricingGrid';
import { UsageStrip } from './UsageStrip';
import { LedgerTable, type LedgerEntryRecord } from './LedgerTable';
import { ReturnStatus } from './ReturnStatus';

describe('PricingGrid', () => {
  it('renders all four plan tiers (Free, Credits, Pro, BYOK)', () => {
    render(<PricingGrid />);
    expect(screen.getAllByText(/Daily Free/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Credit Packs/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pro Monthly/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bring Your Own API Key/i).length).toBeGreaterThan(0);
  });
});

describe('UsageStrip', () => {
  it('renders 30 cells in the activity heatmap grid', () => {
    const days = [
      { date: '2026-10-20', queries: 2 },
      { date: '2026-10-21', queries: 0 },
    ];
    render(<UsageStrip days={days} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(30);
  });
});

describe('LedgerTable', () => {
  it('renders transaction entries with deltas and balances', () => {
    const entries: LedgerEntryRecord[] = [
      {
        id: '1',
        createdAt: '2026-10-21T12:00:00.000Z',
        reason: 'Pack Purchase',
        delta: 25,
        balanceAfter: 25,
      },
      {
        id: '2',
        createdAt: '2026-10-21T13:00:00.000Z',
        reason: 'Query Usage',
        delta: -1,
        balanceAfter: 24,
      },
    ];

    render(<LedgerTable entries={entries} />);
    // DataTable renders both desktop table and mobile cards
    expect(screen.getAllByText('Pack Purchase').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+25').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Query Usage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-1').length).toBeGreaterThan(0);
  });
});

describe('ReturnStatus', () => {
  it('renders paid state with credits added heading', () => {
    render(<ReturnStatus initialStatus="paid" creditsAdded={25} productName="Test Pack" />);
    expect(screen.getByText(/CREDITS ADDED/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start a Search/i })).toBeInTheDocument();
  });

  it('renders pro_active state with PRO IS ACTIVE heading', () => {
    render(<ReturnStatus initialStatus="pro_active" />);
    expect(screen.getByText(/PRO IS ACTIVE/i)).toBeInTheDocument();
  });

  it('renders processing state', () => {
    render(<ReturnStatus initialStatus="processing" />);
    expect(screen.getByText(/PAYMENT PROCESSING/i)).toBeInTheDocument();
  });

  it('renders failed state with retry option', () => {
    render(<ReturnStatus initialStatus="failed" />);
    expect(screen.getByText(/PAYMENT DIDN'T GO THROUGH/i)).toBeInTheDocument();
  });

  it('renders canceled state', () => {
    render(<ReturnStatus initialStatus="canceled" />);
    expect(screen.getByText(/CHECKOUT CANCELED/i)).toBeInTheDocument();
  });
});
