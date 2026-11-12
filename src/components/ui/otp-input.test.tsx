// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OtpInput } from './otp-input';

describe('OtpInput', () => {
  it('renders the accessible numeric one-time-code input', () => {
    render(<OtpInput value="" onChange={() => {}} />);
    const input = screen.getByRole('textbox', { name: /verification code/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('renders entered characters into the segmented display cells', () => {
    render(<OtpInput value="123" onChange={() => {}} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('triggers onComplete when 6 digits are typed', () => {
    const onComplete = vi.fn();
    const onChange = vi.fn();
    render(<OtpInput value="12345" onChange={onChange} onComplete={onComplete} />);
    const input = screen.getByRole('textbox', { name: /verification code/i });
    fireEvent.change(input, { target: { value: '123456' } });
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('strips non-numeric characters from input', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: /verification code/i });
    fireEvent.change(input, { target: { value: 'ABC' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('limits input to length (default 6)', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: /verification code/i });
    fireEvent.change(input, { target: { value: '123456789' } });
    expect(onChange).toHaveBeenCalledWith('123456');
  });
});
