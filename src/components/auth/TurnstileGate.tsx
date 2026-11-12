'use client';

import React, { useEffect, useRef, useState } from 'react';
import { env } from '@/env';

interface TurnstileGateProps {
  onSuccess: (token: string) => void;
  onError?: (error: unknown) => void;
  action?: string;
  className?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          theme?: 'dark' | 'light' | 'auto';
          action?: string;
          callback?: (token: string) => void;
          'error-callback'?: (err: unknown) => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
    };
    onTurnstileLoaded?: () => void;
  }
}

export function TurnstileGate({
  onSuccess,
  onError,
  action = 'auth',
  className = '',
}: TurnstileGateProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadingWidget, setLoadingWidget] = useState(true);
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) {
      // Mock / Dev bypass: auto-pass with simulated token
      onSuccess('mock-turnstile-token');
      return;
    }

    let isCancelled = false;

    const renderWidget = () => {
      if (isCancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return;

      try {
        const id = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          action,
          callback: (token: string) => {
            if (!isCancelled) {
              setLoadingWidget(false);
              onSuccess(token);
            }
          },
          'error-callback': (err: unknown) => {
            if (!isCancelled) {
              setLoadingWidget(false);
              if (onError) onError(err);
            }
          },
        });
        widgetIdRef.current = id;
        setLoadingWidget(false);
      } catch (err) {
        if (!isCancelled) {
          setLoadingWidget(false);
          if (onError) onError(err);
        }
      }
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      // Load Turnstile script lazily
      const existingScript = document.querySelector('script[src*="challenges.cloudflare.com"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src =
          'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoaded';
        script.async = true;
        script.defer = true;
        window.onTurnstileLoaded = () => {
          renderWidget();
        };
        document.head.appendChild(script);
      } else {
        const checkInterval = setInterval(() => {
          if (window.turnstile) {
            clearInterval(checkInterval);
            renderWidget();
          }
        }, 100);
        return () => clearInterval(checkInterval);
      }
    }

    return () => {
      isCancelled = true;
    };
  }, [siteKey, action, onSuccess, onError]);

  if (!siteKey) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`text-muted-foreground flex min-h-[65px] items-center justify-center font-mono text-xs ${className}`}
    >
      {loadingWidget && (
        <span className="animate-pulse tracking-wider">Checking security verification…</span>
      )}
    </div>
  );
}
