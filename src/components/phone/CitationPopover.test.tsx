// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CitationChip } from './CitationChip';
import type { ResolvedCitation } from '@/services/chat/citations';

const mockCitation: ResolvedCitation = {
  chunkId: '123e4567-e89b-12d3-a456-426614174000',
  sourceUrl: 'https://youtube.com/watch?v=demo&t=120',
  title: 'Galaxy S25 Ultra Camera Review',
  type: 'youtube',
  anchor: null,
  startTs: 120,
  excerpt: 'Night mode performance is dramatically improved with sharper shadows.',
  author: 'Tech Reviewer',
  channel: 'TechChannel',
  score: 0.95,
};

describe('CitationChip', () => {
  it('renders safe citation chip with link and label', () => {
    render(<CitationChip citation={mockCitation} label="1" />);
    const link = screen.getByRole('link', { name: /1/i });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('https://youtube.com/watch?v=demo&t=120');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders disabled text span for undefined or unsafe citation', () => {
    const unsafeCitation: ResolvedCitation = {
      ...mockCitation,
      sourceUrl: 'javascript:alert(1)',
    };
    render(<CitationChip citation={unsafeCitation} label="2" />);
    const span = screen.getByText('2');
    expect(span.tagName).toBe('SPAN');
  });
});
