'use client';

import { ArrowRight, Loader2, Scale } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { PhoneImage } from '@/components/phone/PhoneImage';
import {
  CLIENT_SETTING_DEFAULTS,
  CLIENT_SETTING_KEYS,
  useClientSetting,
} from '@/lib/client-settings';
import { formatUsdFromNumericString } from '@/lib/format-usd';
import {
  clearRecommendSession,
  readRecommendSession,
  writeRecommendSession,
} from '@/lib/recommend-session';
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

const INITIAL_LINES: ChatLine[] = [
  {
    role: 'assistant',
    text: 'What kind of phone are you looking for? Mention budget, must-haves, and what matters most (camera, battery, gaming, etc.).',
  },
];

function rankLabel(index: number): string {
  if (index === 0) return 'Rank 1';
  if (index === 1) return 'Rank 2';
  if (index === 2) return 'Rank 3';
  return `Rank ${index + 1}`;
}

function formatSavedAt(savedAt: number): string {
  const diffMs = Date.now() - savedAt;
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'earlier this session';
  if (diffH === 1) return '1 hour ago';
  return `${diffH} hours ago`;
}

/** SSR-safe client mount gate (same pattern as `useClientSetting`). */
function useClientMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function RecommendClient() {
  const mounted = useClientMounted();
  if (!mounted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="border-border/80 bg-card/40 rounded-xl border p-4 shadow-sm sm:p-6">
          <div className="text-muted-foreground flex items-center justify-center py-16 text-sm">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
            Loading…
          </div>
        </div>
      </div>
    );
  }
  return <RecommendClientLoaded />;
}

function RecommendClientLoaded() {
  const session = readRecommendSession();
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<ChatLine[]>([
    {
      role: 'assistant',
      text: "Just describe the phone you want, the features you'd like, and any price preference. For example: great camera, under $700, strong battery, not too heavy.",
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
  /** Timestamp (ms) of the restored session, or null if this is a live session. */
  const [restoredAt, setRestoredAt] = useState<number | null>(() => session?.savedAt ?? null);
  const [enterToSend] = useClientSetting<boolean>(
    CLIENT_SETTING_KEYS.enterToSend,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.enterToSend],
  );

  const skipNextWriteRef = useRef(true);

  useEffect(() => {
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      return;
    }
    writeRecommendSession({
      savedAt: Date.now(),
      lines,
      picks,
      relaxed,
      refined,
      scoresTied,
      scorecardMissing,
      topAspects,
    });
  }, [lines, picks, relaxed, refined, scoresTied, scorecardMissing, topAspects]);

  const clearRestoredSession = useCallback(() => {
    clearRecommendSession();
    setLines(INITIAL_LINES);
    setPicks(null);
    setRelaxed(null);
    setRefined(false);
    setScoresTied(false);
    setScorecardMissing(false);
    setTopAspects([]);
    setRestoredAt(null);
    setError(null);
  }, []);

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
    setRestoredAt(null);
    // Clear any restored session so the new query owns the slot from scratch.
    clearRecommendSession();
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
              text: 'No catalog entries matched those preferences. Try relaxing one must-have or changing the budget, then ask again.',
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
            ? `Updated your recommendations. Returning ${countLabel}.`
            : `Recommendations are ready. Returning ${countLabel}.`;
          const intro =
            relaxedList.length > 0 ? `${base} Adjusted: ${relaxedList.join(', ')}.` : base;
          setLines((prev) => [...prev, { role: 'assistant', text: intro }]);

          if (rawScoresTied && pickList.length > 1) {
            const priorityHint =
              topAspectsList.length >= 2
                ? ` on ${topAspectsList[0]} and ${topAspectsList[1]}`
                : topAspectsList[0]
                  ? ` on ${topAspectsList[0]}`
                  : '';
            const reason = rawScorecardMissing
              ? 'because no reviewer scorecard has been ingested yet, so every aspect falls back to neutral 5.0'
              : 'because the weighted aspect scores are effectively identical for your priorities';
            setLines((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: `These picks are effectively tied${priorityHint}: ${reason}. Add a sharper constraint to break the tie.`,
              },
            ]);
          } else if (rawScorecardMissing && pickList.length > 0) {
            setLines((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: 'No reviewer scorecard has been ingested yet, so this ranking is specs- and priorities-only.',
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

  const topPick = picks?.[0] ?? null;
  const runnerUps = picks?.slice(1) ?? [];

  return (
    <div className="px-grid-margin py-10">
      <div className="grid gap-8 xl:grid-cols-12">
        <section className="border-outline-variant bg-background border xl:col-span-5">
          <div className="border-outline-variant border-b p-5">
            <p className="meta-label text-primary">Conversation</p>
          </div>
          <ul className="divide-outline-variant max-h-[min(520px,55vh)] divide-y overflow-y-auto">
            {lines.map((line, i) => (
              <li key={i} className="p-4">
                <p className="meta-label mb-2">
                  {line.role === 'user' ? `Your request ${String(i).padStart(2, '0')}` : 'RECSY'}
                </p>
                <p
                  className={cn(
                    'font-mono text-sm leading-6',
                    line.role === 'user' ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {line.text}
                </p>
              </li>
            ))}
          </ul>

          {error ? (
            <p
              className="border-outline-variant text-destructive border-t p-4 font-mono text-sm"
              role="alert"
            >
              Error: {error}
            </p>
          ) : null}

          {relaxed && relaxed.length > 0 ? (
            <p className="border-outline-variant text-muted-foreground border-t p-4 font-mono text-xs">
              Adjustments: {relaxed.join(' / ')}
            </p>
          ) : null}

          <div className="border-outline-variant border-t p-5">
            <label className="sr-only" htmlFor="rec-input">
              Your message
            </label>
            <textarea
              id="rec-input"
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (enterToSend && e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Under $700, great camera, long battery, not too heavy..."
              className="border-outline bg-background placeholder:text-muted-foreground text-primary focus-visible:border-primary w-full resize-none border-b px-0 py-3 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="border-outline text-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background mt-4 inline-flex items-center gap-2 border px-5 py-3 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Recommend
            </button>
          </div>
        </section>

        <section className="xl:col-span-7">
          {picks && picks.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="meta-label text-primary">Recommendations</p>
              {picks.length >= 2 && picks[0] != null && picks[1] != null ? (
                <Link
                  href={`/compare?a=${encodeURIComponent(picks[0].slug)}&b=${encodeURIComponent(picks[1].slug)}`}
                  className="border-outline text-primary hover:bg-primary hover:text-background inline-flex items-center gap-2 border px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors"
                >
                  <Scale className="size-3.5" aria-hidden />
                  Compare top 2
                </Link>
              ) : null}
            </div>
          ) : null}
          {scoresTied || scorecardMissing ? (
            <div
              role="note"
              className="border-outline-variant bg-background text-muted-foreground mb-4 border p-4 font-mono text-xs leading-5"
            >
              {scorecardMissing ? (
                <p>Notice: no reviewer scorecard data yet. Aspect scores default to 5.0/10.</p>
              ) : null}
              {scoresTied && picks && picks.length > 1 ? (
                <p>
                  Notice: the top {picks.length} picks are within rounding error for your
                  priorities.
                </p>
              ) : null}
            </div>
          ) : null}

          {picks && picks.length > 0 ? (
            <div className="bg-outline-variant grid gap-px lg:grid-cols-12">
              {topPick ? (
                <RecommendationCard pick={topPick} index={0} featured className="lg:col-span-8" />
              ) : null}
              <div className="bg-outline-variant grid gap-px lg:col-span-4">
                {runnerUps.map((pick, index) => (
                  <RecommendationCard key={pick.phoneId} pick={pick} index={index + 1} />
                ))}
              </div>
            </div>
          ) : (
            <div className="border-outline-variant bg-background border p-10">
              <p className="font-display text-primary text-4xl font-extrabold tracking-normal uppercase">
                Tell us what you want
              </p>
              <p className="text-muted-foreground mt-4 max-w-lg text-sm leading-6">
                Your recommendations will appear here after you describe your needs.
              </p>
            </div>
          )}

          {picks && picks.length > 0 ? (
            <p className="text-muted-foreground mt-4 font-mono text-[11px] tracking-[0.14em] uppercase">
              Showing {picks.length} {picks.length === 1 ? 'match' : 'picks'}
              {refined ? ' / updated' : ''}
              {topAspects.length > 0 ? ` / based on ${topAspects.slice(0, 2).join(' then ')}` : ''}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function RecommendationCard({
  pick,
  index,
  featured = false,
  className,
}: {
  readonly pick: ApiPick;
  readonly index: number;
  readonly featured?: boolean;
  readonly className?: string;
}) {
  const price = formatUsdFromNumericString(pick.msrpUsd);
  return (
    <Link
      href={`/p/${pick.slug}`}
      className={cn(
        'group bg-background hover:bg-surface-container focus-visible:bg-surface-container transition-colors duration-150 focus-visible:outline-none',
        featured ? 'min-h-[520px]' : 'min-h-64',
        className,
      )}
    >
      <div
        className={cn('border-outline-variant border-b p-5', featured ? 'min-h-72' : 'min-h-36')}
      >
        <div className="flex items-start justify-between gap-4">
          <span className="border-primary text-primary border px-2 py-1 font-mono text-[10px] tracking-[0.16em]">
            {rankLabel(index)}
          </span>
          <span className="text-primary font-mono text-xs tabular-nums">
            {pick.score.toFixed(2)}
          </span>
        </div>
        <PhoneImage
          src={pick.imageUrl}
          label={`${pick.brand} ${pick.model}`}
          size={featured ? 260 : 132}
          className={cn('mx-auto mt-4', featured ? 'h-64 w-64' : 'h-32 w-32')}
        />
      </div>
      <div className={cn('p-5', featured ? 'grid gap-5 lg:grid-cols-2' : '')}>
        <div>
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.16em] uppercase">
            {pick.brand}
          </p>
          <h3
            className={cn(
              'font-display text-primary mt-2 font-bold tracking-normal uppercase',
              featured ? 'text-5xl leading-none' : 'text-2xl',
            )}
          >
            {pick.model}
          </h3>
          {price ? <p className="text-primary mt-3 font-mono text-sm">{price}</p> : null}
        </div>
        <div>
          <p className="text-muted-foreground text-sm leading-6">{pick.summary}</p>
          <p className="text-primary mt-5 inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
            Phone details
            <ArrowRight className="size-3.5" aria-hidden />
          </p>
        </div>
      </div>
    </Link>
  );
}
