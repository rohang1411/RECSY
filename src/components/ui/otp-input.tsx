'use client';

import React, { useRef, useEffect } from 'react';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
  autoFocus?: boolean;
  length?: number;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  error = false,
  autoFocus = true,
  length = 6,
}: OtpInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [autoFocus, disabled]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.replace(/\D/g, '').slice(0, length);
    onChange(rawVal);
    if (rawVal.length === length && onComplete) {
      onComplete(rawVal);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && value.length > 0) {
      // Normal backspace handling
    }
  };

  const digits = value.split('');
  const activeIndex = Math.min(digits.length, length - 1);

  return (
    <div
      className="relative flex items-center justify-center gap-2 md:gap-3"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Hidden native input for mobile virtual keyboard, paste, and screen-readers */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={length}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={`Enter ${length}-digit verification code`}
        aria-invalid={error}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />

      {/* Segmented display cells */}
      {Array.from({ length }).map((_, idx) => {
        const char = digits[idx] || '';
        const isFocused =
          !disabled && (idx === activeIndex || (idx === length - 1 && digits.length === length));
        const isFilled = Boolean(char);

        return (
          <div
            key={idx}
            className={`flex h-12 w-10 items-center justify-center border font-mono text-xl transition-colors md:h-14 md:w-12 ${
              error
                ? 'border-destructive bg-destructive/5 text-destructive'
                : isFocused
                  ? 'border-accent bg-surface-elevated text-foreground shadow-[0_0_0_1px_var(--color-accent)]'
                  : isFilled
                    ? 'border-foreground/40 bg-surface-elevated text-foreground'
                    : 'border-border-hairline bg-surface text-muted-foreground'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-text'}`}
          >
            {char ||
              (isFocused && !disabled && digits.length === idx ? (
                <span className="text-accent animate-pulse font-light">|</span>
              ) : null)}
          </div>
        );
      })}
    </div>
  );
}
