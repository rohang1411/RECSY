'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { GoogleButton } from './GoogleButton';
import { TurnstileGate } from './TurnstileGate';
import { OtpInput } from '@/components/ui/otp-input';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { readPendingIntent, clearPendingIntent } from '@/lib/pending-intent';
import { quotaStore } from '@/components/quota/quota-store';

export type AuthReason = 'anon_exhausted' | 'signin_required' | 'header' | 'purchase';

export interface AuthFormProps {
  reason?: AuthReason;
  next?: string;
  onSuccess?: () => void;
  className?: string;
}

const REASON_COPY: Record<AuthReason, { heading: string; sentence: string }> = {
  anon_exhausted: {
    heading: "YOU'VE USED TODAY'S 2",
    sentence:
      'Sign in to keep going. Free accounts get 2 queries every day, and today count carries over.',
  },
  signin_required: {
    heading: 'SIGN IN TO CONTINUE',
    sentence: 'RECSY needs an account before it can run queries.',
  },
  header: {
    heading: 'SIGN IN TO RECSY',
    sentence: 'Save your history across devices and keep your daily queries.',
  },
  purchase: {
    heading: 'SIGN IN TO BUY',
    sentence: 'Credits and plans attach to your account.',
  },
};

export function AuthForm({
  reason = 'header',
  next = '/',
  onSuccess,
  className = '',
}: AuthFormProps) {
  const [step, setStep] = useState<'email' | 'otp' | 'success'>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const copy = REASON_COPY[reason] || REASON_COPY.header;
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleAuthSuccess = useCallback(
    (userEmail: string) => {
      setStep('success');
      toast.success(`Signed in as ${userEmail}`);
      quotaStore.refresh();

      // Check pending intent for automated refill / submission
      const intent = readPendingIntent();
      if (intent) {
        clearPendingIntent();
      }

      setTimeout(() => {
        if (onSuccess) {
          onSuccess();
        } else if (next && next !== window.location.pathname) {
          window.location.assign(next);
        }
      }, 600);
    },
    [next, onSuccess],
  );

  // BroadcastChannel listener for multi-tab magic link sync
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('recsy-auth');
      channel.onmessage = (event) => {
        if (event.data?.type === 'SIGNED_IN') {
          handleAuthSuccess(event.data?.email || 'user');
        }
      };
    } catch {
      // BroadcastChannel not available in environment
    }
    return () => {
      channel?.close();
    };
  }, [handleAuthSuccess]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown > 0) {
      cooldownTimerRef.current = setTimeout(() => {
        setCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, [cooldown]);

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage("That doesn't look like an email address.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/auth/otp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: cleanEmail,
          captchaToken: captchaToken || undefined,
          returnTo: next,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send verification code. Please try again.');
      }

      setStep('otp');
      setCooldown(30);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error sending code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (codeToVerify: string) => {
    if (codeToVerify.length !== 6) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/auth/otp/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          token: codeToVerify,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setOtpCode('');
        throw new Error(data.error || "That code didn't work. Request a new one.");
      }

      handleAuthSuccess(email.trim());
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "That code didn't work. Request a new one.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header Context */}
      <div>
        <div className="text-accent mb-2 font-mono text-[11px] font-bold tracking-widest uppercase">
          Authentication
        </div>
        <h2 className="text-foreground text-2xl font-extrabold tracking-tight md:text-3xl">
          {copy.heading}
        </h2>
        <p className="text-muted-foreground mt-2 font-mono text-xs leading-relaxed">
          {copy.sentence}
        </p>
      </div>

      {step === 'success' ? (
        <div className="border-accent bg-accent/5 animate-in fade-in zoom-in-95 border p-8 text-center duration-200">
          <div className="text-accent mb-1 font-mono text-xs tracking-widest uppercase">
            Verified
          </div>
          <div className="text-foreground text-xl font-bold">SIGNED IN</div>
          <div className="bg-accent mt-4 h-0.5 w-full animate-pulse" />
        </div>
      ) : step === 'email' ? (
        <div className="space-y-5">
          {/* Google OAuth Option */}
          <GoogleButton next={next} disabled={loading} />

          {/* Hairline Divider */}
          <div className="relative flex items-center justify-center">
            <div className="border-border-hairline absolute inset-0 flex items-center">
              <div className="border-border-hairline w-full border-t" />
            </div>
            <span className="bg-surface text-muted-foreground relative px-3 font-mono text-[10px] tracking-widest uppercase">
              OR
            </span>
          </div>

          {/* Email OTP Input Form */}
          <form onSubmit={handleSendOtp} className="space-y-4">
            <Field
              type="email"
              label="Email Address"
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              error={errorMessage || undefined}
              disabled={loading}
              autoComplete="email"
              autoFocus
            />

            <TurnstileGate onSuccess={setCaptchaToken} action="otp_send" />

            <Button
              type="submit"
              variant="solid"
              size="lg"
              loading={loading}
              disabled={loading || !email.trim()}
              className="w-full font-mono text-xs tracking-wider uppercase"
            >
              Send Code
            </Button>
          </form>

          {/* Footnote and Micro-copy */}
          <div className="border-border-hairline space-y-2 border-t pt-4 text-center">
            <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
              One-time code, no password. Your 2 free queries carry over.
            </p>
            <p className="text-muted-foreground/80 text-[11px]">
              By signing in you agree to our{' '}
              <Link href="/terms" className="text-accent hover:text-accent-hover underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-accent hover:text-accent-hover underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      ) : (
        /* Step 2: OTP Verification */
        <div className="space-y-6">
          <div className="border-border-hairline bg-surface-elevated/40 border p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-mono uppercase">Sent To</span>
              <span className="text-foreground font-mono font-medium">{email}</span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-muted-foreground block text-center font-mono text-xs tracking-wider uppercase">
              Enter 6-Digit Code
            </label>
            <OtpInput
              value={otpCode}
              onChange={(val) => {
                setOtpCode(val);
                if (errorMessage) setErrorMessage(null);
              }}
              onComplete={handleVerifyOtp}
              disabled={loading}
              error={Boolean(errorMessage)}
              autoFocus
            />
            {errorMessage && (
              <p className="text-destructive mt-2 text-center font-mono text-xs" role="alert">
                {errorMessage}
              </p>
            )}
          </div>

          <Button
            type="button"
            variant="solid"
            size="lg"
            loading={loading}
            disabled={loading || otpCode.length !== 6}
            onClick={() => handleVerifyOtp(otpCode)}
            className="w-full font-mono text-xs tracking-wider uppercase"
          >
            Verify & Continue
          </Button>

          {/* Cooldown & Email Switch */}
          <div className="border-border-hairline flex items-center justify-between border-t pt-4 font-mono text-xs">
            <button
              type="button"
              disabled={cooldown > 0 || loading}
              onClick={() => handleSendOtp()}
              className="text-muted-foreground hover:text-foreground uppercase transition-colors disabled:opacity-40"
            >
              {cooldown > 0
                ? `Resend in 0:${cooldown < 10 ? `0${cooldown}` : cooldown}`
                : 'Resend Code'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setStep('email');
                setOtpCode('');
                setErrorMessage(null);
              }}
              className="text-accent hover:text-accent-hover uppercase transition-colors"
            >
              Change Email
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
