// @vitest-environment jsdom
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { RegionPrice } from './RegionPrice';
import type { PhoneRegionalPrice } from '@/services/cache/public-data';

describe('RegionPrice component', () => {
  const samplePrices: Record<string, PhoneRegionalPrice> = {
    US: {
      price: '799',
      currency: 'USD',
      isEstimated: false,
      isAvailable: true,
    },
    IN: {
      price: '79999',
      currency: 'INR',
      isEstimated: false,
      isAvailable: true,
    },
  };

  beforeEach(() => {
    document.cookie = 'recsy_region=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  it('renders US dollar price by default', async () => {
    await act(async () => {
      render(<RegionPrice regionalPrices={samplePrices} msrpUsd="799" />);
    });
    expect(screen.getByText(/\$799/)).toBeDefined();
  });

  it('renders Indian Rupee price when recsy_region cookie is IN', async () => {
    document.cookie = 'recsy_region=IN; path=/;';
    await act(async () => {
      render(<RegionPrice regionalPrices={samplePrices} msrpUsd="799" />);
    });
    expect(screen.getByText(/₹79,999/)).toBeDefined();
  });

  it('falls back to msrpUsd when regional price is not configured', async () => {
    const pricesOnlyUS: Record<string, PhoneRegionalPrice> = {
      US: {
        price: '999',
        currency: 'USD',
        isEstimated: false,
        isAvailable: true,
      },
    };
    document.cookie = 'recsy_region=IN; path=/;';
    await act(async () => {
      render(<RegionPrice regionalPrices={pricesOnlyUS} msrpUsd="999" />);
    });
    // Fallback uses the raw USD price formatted into local INR or USD fallback
    expect(screen.getByText(/999/)).toBeDefined();
  });

  it('renders TBD when neither regional nor msrp price is available', async () => {
    await act(async () => {
      render(<RegionPrice regionalPrices={{}} msrpUsd={null} />);
    });
    expect(screen.getByText('TBD')).toBeDefined();
  });

  it('renders estimated indicator ~ when price is estimated', async () => {
    const estimatedPrices: Record<string, PhoneRegionalPrice> = {
      US: {
        price: '499',
        currency: 'USD',
        isEstimated: true,
        isAvailable: true,
      },
    };
    await act(async () => {
      render(<RegionPrice regionalPrices={estimatedPrices} msrpUsd="499" />);
    });
    expect(screen.getByText(/~\$499/)).toBeDefined();
  });
});
