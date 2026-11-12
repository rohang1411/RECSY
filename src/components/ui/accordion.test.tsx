// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Accordion, type AccordionItem } from './accordion';

const ITEMS: AccordionItem[] = [
  { id: '1', title: 'What is RECSY?', content: 'RECSY is an honest smartphone recommender.' },
  { id: '2', title: 'How does quota work?', content: 'You receive 2 free queries each day.' },
];

describe('Accordion', () => {
  it('renders all accordion headers with aria attributes', () => {
    render(<Accordion items={ITEMS} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false');
    expect(buttons[0]).toHaveTextContent('What is RECSY?');
  });

  it('toggles expansion on click', () => {
    render(<Accordion items={ITEMS} />);
    const firstButton = screen.getByRole('button', { name: /What is RECSY\?/i });
    expect(firstButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(firstButton);
    expect(firstButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('RECSY is an honest smartphone recommender.')).toBeInTheDocument();

    fireEvent.click(firstButton);
    expect(firstButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('collapses other items when allowMultiple is false', () => {
    render(<Accordion items={ITEMS} allowMultiple={false} />);
    const firstBtn = screen.getByRole('button', { name: /What is RECSY\?/i });
    const secondBtn = screen.getByRole('button', { name: /How does quota work\?/i });

    fireEvent.click(firstBtn);
    expect(firstBtn).toHaveAttribute('aria-expanded', 'true');
    expect(secondBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(secondBtn);
    expect(firstBtn).toHaveAttribute('aria-expanded', 'false');
    expect(secondBtn).toHaveAttribute('aria-expanded', 'true');
  });
});
