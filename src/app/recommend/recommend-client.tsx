'use client';

import { ArrowRight, Loader2, MessageCircle, Scale } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { PhoneImage } from '@/components/phone/PhoneImage';
import {
  CLIENT_SETTING_DEFAULTS,
  CLIENT_SETTING_KEYS,
  useClientSetting,
} from '@/lib/client-settings';
import { formatUsdFromNumericString } from '@/lib/format-usd';
import { cn } from '@/lib/utils';

type ApiPick = {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly score: number;
  readonly summary: string;
  readonly msrpUsd: string | null;
  readonly imageUrl: string | null;
};

interface ChatLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

function rankLabel(index: number): string {
  if (index === 0) return 'Top pick';
  if (index === 1) return 'Runner-up';
  if (index === 2) return '3rd';
  return `#${index + 1}`;
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
  const [refined, setRefined] = useState<boolean>(false);
  const [scoresTied, setScoresTied] = useState<boolean>(false);
  const [scorecardMissing, setScorecardMissing] = useState<boolean>(false);
  const [topAspects, setTopAspects] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enterToSend] = useClientSetting<boolean>(
    CLIENT_SETTING_KEYS.enterToSend,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.enterToSend],
  );

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setError(null);
    setPicks(null);
    setRelaxed(null);
    setRefined(false);
    setScoresTied(false);
    setScorecardMissing(false);
    setTopAspects([]);
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
        const rawRefined = (data as { refined?: unknown }).refined === true;
        const rawScoresTied = (data as { scoresTied?: unknown }).scoresTied === true;
        const rawScorecardMissing =
          (data as { scorecardMissing?: unknown }).scorecardMissing === true;
        const rawTopAspects = (data as { topAspects?: unknown }).topAspects;
        const topAspectsList = Array.isArray(rawTopAspects)
          ? (rawTopAspects as string[]).filter((s): s is string => typeof s === 'string')
          : [];
        setPicks(pickList);
        setRelaxed(relaxedList);
        setRefined(rawRefined);
        setScoresTied(rawScoresTied);
        setScorecardMissing(rawScorecardMissing);
        setTopAspects(topAspectsList);
        if (pickList.length === 0) {
          setLines((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: 'Nothing in the corpus survived your deal-breakers and filters. Try removing a deal-breaker or raising the budget, then send again.',
            },
          ]);
        } else {
          const countLabel =
            pickList.length === 1
              ? 'one match'
              : pickList.length === 2
                ? 'two picks'
                : `top ${pickList.length}`;
          const base = rawRefined
            ? `Re-ranked your earlier picks — here is the ${countLabel}.`
            : `Here ${pickList.length === 1 ? 'is' : 'are'} the ${countLabel}, ranked for what you said matters.`;
          const intro =
            relaxedList.length > 0 ? `${base} (Adjusted: ${relaxedList.join(', ')}.)` : base;
          setLines((prev) => [...prev, { role: 'assistant', text: intro }]);

          // Honest follow-up when ranking could not separate the picks.
          if (rawScoresTied && pickList.length > 1) {
            const priorityHint =
              topAspectsList.length >= 2
                ? ` on ${topAspectsList[0]} and ${topAspectsList[1]}`
                : topAspectsList[0]
                  ? ` on ${topAspectsList[0]}`
                  : '';
            const reason = rawScorecardMissing
              ? 'because no reviewer scorecard has been ingested yet, so every aspect falls back to a neutral 5.0'
              : 'because the weighted aspect scores are effectively identical for your priorities';
            setLines((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: `These picks are effectively tied${priorityHint} — ${reason}. Any of them is a defensible choice; ingest reviews (see docs) or add a sharper constraint (e.g. budget, must-have) to break the tie.`,
              },
            ]);
          } else if (rawScorecardMissing && pickList.length > 0) {
            setLines((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: `Heads up: no reviewer scorecard has been ingested yet, so this ranking is driven by specs and your priorities only — aspect scores all default to 5.0.`,
              },
            ]);
          }
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
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Showing {picks.length} {picks.length === 1 ? 'match' : 'picks'}, ranked
                {refined ? ' · re-ranked from your earlier picks' : ''}
                {topAspects.length > 0 ? ` · by ${topAspects.slice(0, 2).join(' then ')}` : ''}
              </p>
              {picks.length >= 2 && picks[0] != null && picks[1] != null ? (
                <Link
                  href={`/compare?a=${encodeURIComponent(picks[0].slug)}&b=${encodeURIComponent(picks[1].slug)}`}
                  className="text-primary focus-visible:ring-ring inline-flex items-center gap-1.5 text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <Scale className="size-3.5" aria-hidden />
                  Compare top 2
                </Link>
              ) : null}
            </div>
            {scoresTied || scorecardMissing ? (
              <div
                role="note"
                className="border-border/80 bg-muted/40 text-muted-foreground rounded-md border px-3 py-2 text-xs leading-relaxed"
              >
                {scorecardMissing ? (
                  <p>
                    No reviewer scorecard data yet — aspect scores default to 5.0/10, so this is a
                    specs- and priorities-only ranking.
                  </p>
                ) : null}
                {scoresTied && picks.length > 1 ? (
                  <p className={scorecardMissing ? 'mt-1' : undefined}>
                    Top {picks.length} picks are within a rounding error on your priorities — treat
                    as a tie.
                  </p>
                ) : null}
              </div>
            ) : null}
            <ul className="space-y-3">
              {picks.map((p, idx) => {
                const price = formatUsdFromNumericString(p.msrpUsd);
                return (
                  <li key={p.phoneId}>
                    <Link
                      href={`/p/${p.slug}`}
                      className="border-border/80 bg-background hover:bg-muted/50 focus-visible:ring-ring block rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      <div className="flex gap-4">
                        <div className="shrink-0">
                          <PhoneImage
                            src={p.imageUrl}
                            label={`${p.brand} ${p.model}`}
                            size={88}
                            className="shrink-0"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                                    idx === 0
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-muted-foreground border-border/80 border',
                                  )}
                                  aria-label={`Rank ${idx + 1}`}
                                >
                                  {rankLabel(idx)}
                                </span>
                                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                                  {p.brand}
                                </p>
                              </div>
                              <p className="text-foreground mt-1 text-base font-semibold">
                                {p.model}
                              </p>
                            </div>
                            <div className="text-right text-sm">
                              <span className="text-foreground block font-medium tabular-nums">
                                {p.score.toFixed(2)}
                              </span>
                              <span className="text-muted-foreground">score</span>
                            </div>
                          </div>
                          {price ? (
                            <p className="text-foreground mt-1 text-sm font-medium tabular-nums">
                              {price}
                            </p>
                          ) : null}
                          <p className="text-muted-foreground mt-1 text-sm">{p.summary}</p>
                        </div>
                      </div>
                      <span className="text-primary mt-3 inline-flex items-center gap-1 text-sm font-medium">
                        Open phone page
                        <ArrowRight className="size-3.5" aria-hidden />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
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
              if (enterToSend && e.key === 'Enter' && !e.shiftKey) {
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
