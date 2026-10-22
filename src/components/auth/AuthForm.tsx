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
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [step, setStep] = useState<'form' | 'otp' | 'success'>('form');
  const [useOtpMode, setUseOtpMode] = useState(false);

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [otpCode, setOtpCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [suggestSignUp, setSuggestSignUp] = useState(false);
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

  // BroadcastChannel listener for multi-tab sync
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

  // Cooldown countdown timer for OTP
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

  // Handle password sign-in
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setSuggestSignUp(false);

    try {
      const res = await fetch('/auth/password/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'user_not_found') {
          setSuggestSignUp(true);
          setErrorMessage(
            data.message || 'No account found with this email. Would you like to create one?',
          );
          return;
        }
        throw new Error(data.message || 'Failed to sign in. Please verify your credentials.');
      }

      handleAuthSuccess(cleanEmail);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error signing in.');
    } finally {
      setLoading(false);
    }
  };

  // Handle password sign-up
  const handlePasswordSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/auth/password/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: cleanEmail,
          password,
          dateOfBirth: dateOfBirth.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to create account.');
      }

      if (data.requiresEmailConfirmation) {
        toast.info('Account created! Please check your email to confirm.');
      }

      handleAuthSuccess(cleanEmail);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error creating account.');
    } finally {
      setLoading(false);
    }
  };

  // Handle send OTP code
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
        headers: { 'Content-Type': 'application/json' },
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

  // Handle verify OTP code
  const handleVerifyOtp = async (codeToVerify: string) => {
    if (codeToVerify.length !== 6) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          {tab === 'signup' ? 'CREATE YOUR ACCOUNT' : copy.heading}
        </h2>
        <p className="text-muted-foreground mt-2 font-mono text-xs leading-relaxed">
          {tab === 'signup'
            ? 'Fill in your details below to activate daily queries and history tracking.'
            : copy.sentence}
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
      ) : step === 'otp' ? (
        /* OTP Verification Step */
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
            <p className="text-muted-foreground text-center font-mono text-[11px]">
              (Or click the direct confirmation link in the email)
            </p>
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
                setStep('form');
                setOtpCode('');
                setErrorMessage(null);
              }}
              className="text-accent hover:text-accent-hover uppercase transition-colors"
            >
              Back to Form
            </button>
          </div>
        </div>
      ) : (
        /* Form Step (Sign In / Sign Up) */
        <div className="space-y-5">
          {/* Google OAuth Option (Always 1-Click Available) */}
          <GoogleButton next={next} disabled={loading} />

          {/* Divider */}
          <div className="relative flex items-center justify-center">
            <div className="border-border-hairline absolute inset-0 flex items-center">
              <div className="border-border-hairline w-full border-t" />
            </div>
            <span className="bg-surface text-muted-foreground relative px-3 font-mono text-[10px] tracking-widest uppercase">
              OR WITH EMAIL
            </span>
          </div>

          {/* Tab Switcher: Sign In vs Create Account */}
          <div className="border-border-hairline bg-surface-elevated/20 grid grid-cols-2 border p-1">
            <button
              type="button"
              onClick={() => {
                setTab('signin');
                setErrorMessage(null);
                setSuggestSignUp(false);
              }}
              className={`py-2 font-mono text-xs font-bold uppercase transition-colors ${
                tab === 'signin'
                  ? 'bg-surface text-foreground border-border-hairline border shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('signup');
                setErrorMessage(null);
                setSuggestSignUp(false);
              }}
              className={`py-2 font-mono text-xs font-bold uppercase transition-colors ${
                tab === 'signup'
                  ? 'bg-surface text-foreground border-border-hairline border shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Error / Suggestion Banner */}
          {errorMessage && (
            <div className="border-destructive/40 bg-destructive/10 text-destructive border p-3 font-mono text-xs">
              <p>{errorMessage}</p>
              {suggestSignUp && (
                <button
                  type="button"
                  onClick={() => {
                    setTab('signup');
                    setErrorMessage(null);
                    setSuggestSignUp(false);
                  }}
                  className="text-accent hover:text-accent-hover mt-2 inline-block font-bold underline"
                >
                  Create account for {email} →
                </button>
              )}
            </div>
          )}

          {/* Sign In Form */}
          {tab === 'signin' && (
            <div>
              {!useOtpMode ? (
                <form onSubmit={handlePasswordSignIn} className="space-y-4">
                  <Field
                    type="email"
                    label="Email Address"
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    disabled={loading}
                    autoComplete="email"
                    autoFocus
                  />

                  <Field
                    type="password"
                    label="Password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    disabled={loading}
                    autoComplete="current-password"
                  />

                  <Button
                    type="submit"
                    variant="solid"
                    size="lg"
                    loading={loading}
                    disabled={loading || !email.trim() || !password}
                    className="w-full font-mono text-xs tracking-wider uppercase"
                  >
                    Sign In
                  </Button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setUseOtpMode(true);
                        setErrorMessage(null);
                      }}
                      className="text-muted-foreground hover:text-foreground font-mono text-xs underline"
                    >
                      Sign in with one-time email code instead
                    </button>
                  </div>
                </form>
              ) : (
                /* OTP Send Mode */
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
                    Send One-Time Code
                  </Button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setUseOtpMode(false);
                        setErrorMessage(null);
                      }}
                      className="text-muted-foreground hover:text-foreground font-mono text-xs underline"
                    >
                      Sign in with password instead
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Sign Up Form */}
          {tab === 'signup' && (
            <form onSubmit={handlePasswordSignUp} className="space-y-4">
              <Field
                type="text"
                label="Full Name"
                placeholder="e.g. Rohan Sharma"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={loading}
                autoComplete="name"
                autoFocus
              />

              <Field
                type="email"
                label="Email Address"
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={loading}
                autoComplete="email"
              />

              <Field
                type="password"
                label="Password (min 8 characters)"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                disabled={loading}
                autoComplete="new-password"
              />

              <div>
                <label className="text-muted-foreground mb-1 block font-mono text-xs tracking-wider uppercase">
                  Date of Birth (Optional)
                </label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  disabled={loading}
                  className="border-border-hairline bg-background text-foreground focus:border-accent w-full border px-3 py-2 font-mono text-xs outline-none"
                />
              </div>

              <Button
                type="submit"
                variant="solid"
                size="lg"
                loading={loading}
                disabled={loading || !fullName.trim() || !email.trim() || password.length < 8}
                className="w-full font-mono text-xs tracking-wider uppercase"
              >
                Create Account
              </Button>
            </form>
          )}

          {/* Footnote and Micro-copy */}
          <div className="border-border-hairline space-y-2 border-t pt-4 text-center">
            <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
              Your data is saved securely and your 2 daily free queries carry over.
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
      )}
    </div>
  );
}
