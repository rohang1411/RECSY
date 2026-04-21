'use client';

import { ArrowRight, Loader2, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';

type ApiPick = {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly score: number;
  readonly summary: string;
};

interface ChatLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export function RecommendClient() {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([
    {
      role: 'assistant',
      text: 'What kind of phone are you looking for? Mention budget, must-haves, and what matters most (camera, battery, gaming, etc.).',
    },
  ]);
  const [picks, setPicks] = useState<readonly ApiPick[] | null>(null);
  const [relaxed, setRelaxed] = useState<readonly string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setError(null);
    setPicks(null);
    setRelaxed(null);
    setLines((prev) => [...prev, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data && typeof data === 'object' && 'message' in data
            ? String((data as { message: unknown }).message)
            : `Request failed (${res.status})`;
        throw new Error(msg);
      }
      if (!data || typeof data !== 'object' || !('kind' in data)) {
        throw new Error('Invalid response');
      }
      const kind = (data as { kind: unknown }).kind;
      if (kind === 'clarify') {
        const raw = data as unknown as { clarifyingQuestion?: unknown };
        const q =
          typeof raw.clarifyingQuestion === 'string'
            ? raw.clarifyingQuestion
            : 'Tell me a bit more about what you need.';
        setLines((prev) => [...prev, { role: 'assistant', text: q }]);
      } else if (kind === 'results') {
        const rawPicks = (data as { picks?: unknown }).picks;
        const pickList = Array.isArray(rawPicks) ? (rawPicks as ApiPick[]) : [];
        const rawRelaxed = (data as { relaxed?: unknown }).relaxed;
        const relaxedList = Array.isArray(rawRelaxed)
          ? (rawRelaxed as string[]).filter((s): s is string => typeof s === 'string')
          : [];
        setPicks(pickList);
        setRelaxed(relaxedList);
        if (pickList.length === 0) {
          setLines((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: 'Nothing in the corpus survived your deal-breakers and filters. Try removing a deal-breaker or raising the budget, then send again.',
            },
          ]);
        } else {
          const intro =
            relaxedList.length > 0
              ? `Here are picks tuned to what you said. (Adjusted: ${relaxedList.join(', ')}.)`
              : 'Here are picks tuned to what you said.';
          setLines((prev) => [...prev, { role: 'assistant', text: intro }]);
        }
      } else {
        throw new Error('Unknown response kind');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [busy, input]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="border-border/80 bg-card/40 rounded-xl border p-4 shadow-sm sm:p-6">
        <ul className="max-h-[min(420px,50vh)] space-y-4 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <li
              key={i}
              className={cn(
                'flex gap-3 text-sm leading-relaxed',
                line.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {line.role === 'assistant' ? (
                <span className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                  <MessageCircle className="size-4" aria-hidden />
                </span>
              ) : null}
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2',
                  line.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
                )}
              >
                {line.text}
              </div>
            </li>
          ))}
        </ul>

        {error ? (
          <p className="text-destructive mt-4 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {relaxed && relaxed.length > 0 ? (
          <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
            Adjustments: {relaxed.join(' · ')}
          </p>
        ) : null}

        {picks && picks.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {picks.map((p) => (
              <li key={p.phoneId}>
                <Link
                  href={`/p/${p.slug}`}
                  className="border-border/80 bg-background hover:bg-muted/50 focus-visible:ring-ring block rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {p.brand}
                      </p>
                      <p className="text-foreground text-base font-semibold">{p.model}</p>
                      <p className="text-muted-foreground mt-1 text-sm">{p.summary}</p>
                    </div>
                    <span className="text-foreground text-sm font-medium tabular-nums">
                      {p.score.toFixed(2)}
                    </span>
                  </div>
                  <span className="text-primary mt-3 inline-flex items-center gap-1 text-sm font-medium">
                    Open phone page
                    <ArrowRight className="size-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="sr-only" htmlFor="rec-input">
            Your message
          </label>
          <textarea
            id="rec-input"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="e.g. Under $700, great camera, long battery, not too heavy…"
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex-1 resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
