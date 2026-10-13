'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';

export default function OperatorLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/internal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Authentication failed');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/internal/command-center');
        router.refresh();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setLoading(false);
    }
  }

  return (
    <main className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center p-6 font-mono">
      <div className="border-outline-variant bg-surface-container/40 w-full max-w-md border p-8 backdrop-blur-md">
        <div className="mb-6 flex items-center gap-2">
          <KeyRound className="text-accent size-5" />
          <h1 className="text-primary text-sm font-bold tracking-[0.14em] uppercase">
            RECSY / Operator Access
          </h1>
        </div>

        <p className="text-muted-foreground mb-6 text-xs leading-relaxed">
          Internal observability and diagnostics are restricted to authenticated operators to
          prevent unauthorized database egress.
        </p>

        {error && (
          <div className="mb-6 flex items-center gap-2 border border-[#ff3b30]/40 bg-[#ff3b30]/10 p-3 text-xs text-[#ff3b30]">
            <ShieldAlert className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-6 flex items-center gap-2 border border-[#39ff88]/40 bg-[#39ff88]/10 p-3 text-xs text-[#39ff88]">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>Session verified. Redirecting...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="token"
              className="text-muted-foreground mb-2 block text-[11px] tracking-[0.12em] uppercase"
            >
              Operator Access Token
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter INTERNAL_OPERATOR_TOKEN..."
              required
              disabled={loading || success}
              className="border-outline bg-background text-primary placeholder:text-muted-foreground/40 focus:border-accent w-full border px-3 py-2 text-xs focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading || success || !token.trim()}
            className="border-outline bg-primary text-background hover:bg-accent flex w-full items-center justify-center gap-2 border px-4 py-2.5 text-xs font-bold uppercase transition-colors hover:text-black disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Establish Session'}
            <ArrowRight className="size-3.5" />
          </button>
        </form>
      </div>
    </main>
  );
}
