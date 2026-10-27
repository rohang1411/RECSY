'use client';

import { ArrowRight, Loader2, Scale } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import { PhoneImage } from '@/components/phone/PhoneImage';
import { QuotaSheet } from '@/components/quota/QuotaSheet';
import { quotaStore } from '@/components/quota/quota-store';
import {
  CLIENT_SETTING_DEFAULTS,
  CLIENT_SETTING_KEYS,
  useClientSetting,
} from '@/lib/client-settings';
import { formatLocalPrice } from '@/lib/format-currency';
import { handleMeteredError, type MeteredErrorResponse } from '@/lib/metered-fetch';
import { savePendingIntent, readPendingIntent, clearPendingIntent } from '@/lib/pending-intent';
import { buildAssistantLines, type RecommendTurnLike } from '@/lib/recommend-lines';
import { clearDraft, getDraft, setDraft } from '@/lib/recommend-sessions/drafts';
import { useSendTurn } from '@/lib/recommend-sessions/use-send-turn';
import { useSession } from '@/lib/recommend-sessions/use-session';
import type { SessionDetail, SessionDetailTurn } from '@/lib/recommend-sessions/api';
import type { RegionConfig } from '@/lib/regions';
import type { QuotaSnapshotLite } from '@/services/metering/types';
import { cn } from '@/lib/utils';

export interface ApiPick {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly score: number;
  readonly summary: string;
  readonly msrpUsd: string | null;
  readonly localPrice: string | null;
  readonly localCurrency: string | null;
  readonly imageUrl: string | null;
}

export interface ChatLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

const getInitialLines = (symbol: string, countryCode: string): ChatLine[] => [
  {
    role: 'assistant',
    text: `Just describe the phone you want, the features you'd like, and any price preference. For example: great camera, under ${symbol}${countryCode === 'IN' ? '60,000' : '700'}, strong battery, not too heavy.`,
  },
];

function rankLabel(index: number): string {
  if (index === 0) return 'Rank 1';
  if (index === 1) return 'Rank 2';
  if (index === 2) return 'Rank 3';
  return `Rank ${index + 1}`;
}

function formatSavedAt(timeMsOrIso: number | string): string {
  const time = typeof timeMsOrIso === 'string' ? new Date(timeMsOrIso).getTime() : timeMsOrIso;
  const diffMs = Date.now() - time;
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'earlier this session';
  if (diffH === 1) return '1 hour ago';
  if (diffH < 24) return `${diffH} hours ago`;
  const diffDays = Math.floor(diffH / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function formatPickPrice(
  pick: ApiPick,
  activeRegion: RegionConfig,
  turnCreatedAt?: string | number | null,
): string | null {
  const price = formatLocalPrice(pick.localPrice ?? pick.msrpUsd, activeRegion);
  if (!price) return null;
  if (!turnCreatedAt) return price;
  const time =
    typeof turnCreatedAt === 'string' ? new Date(turnCreatedAt).getTime() : turnCreatedAt;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - time > SEVEN_DAYS_MS) {
    const dateStr = new Date(time).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${price} (as of ${dateStr})`;
  }
  return price;
}

/** Reconstructs conversation chat lines from stored session turns. */
function reconstructLinesFromTurns(
  turns: SessionDetailTurn[],
  activeRegion: RegionConfig,
): ChatLine[] {
  if (!turns || turns.length === 0) {
    return getInitialLines(activeRegion.symbol, activeRegion.countryCode);
  }

  const lines: ChatLine[] = [];
  for (const turn of turns) {
    lines.push({ role: 'user', text: turn.userMessage });
    const assistantTexts = buildAssistantLines(turn as RecommendTurnLike);
    for (const text of assistantTexts) {
      lines.push({ role: 'assistant', text });
    }
  }
  return lines;
}

/** SSR-safe client mount gate. */
function useClientMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export interface RecommendClientProps {
  readonly activeRegion: RegionConfig;
  readonly sessionId?: string;
  readonly initialSession?: SessionDetail | null;
}

export function RecommendClient({
  activeRegion,
  sessionId,
  initialSession,
}: RecommendClientProps): React.JSX.Element {
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

  return (
    <RecommendClientLoaded
      key={sessionId ?? 'new'}
      activeRegion={activeRegion}
      sessionId={sessionId}
      initialSession={initialSession}
    />
  );
}

function RecommendClientLoaded({
  activeRegion,
  sessionId: propSessionId,
  initialSession,
}: RecommendClientProps): React.JSX.Element {
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(propSessionId);
  const sessionQuery = useSession(currentSessionId, {
    initialData: initialSession ?? undefined,
    enabled: Boolean(currentSessionId),
  });

  const sendTurnMutation = useSendTurn();

  // Active session turns
  const sessionData = sessionQuery.data ?? initialSession ?? null;
  const turns = useMemo(() => sessionData?.turns ?? [], [sessionData?.turns]);
  const turnCount = sessionData?.turnCount ?? turns.length;

  // Answers switcher: each turn with picks
  const answerTurns = useMemo(
    () => turns.filter((turn) => Array.isArray(turn.picks) && turn.picks.length > 0),
    [turns],
  );
  const latestAnswerTurn = answerTurns[answerTurns.length - 1] ?? null;

  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const activeAnswerId = selectedAnswerId ?? latestAnswerTurn?.id ?? null;

  const selectedAnswerTurn = answerTurns.find((t) => t.id === activeAnswerId) ?? latestAnswerTurn;

  // Derived lines from turns plus any in-flight optimistic message
  const [optimisticLines, setOptimisticLines] = useState<ChatLine[]>([]);
  const baseLines = useMemo(
    () => reconstructLinesFromTurns(turns, activeRegion),
    [turns, activeRegion],
  );
  const lines = useMemo(() => [...baseLines, ...optimisticLines], [baseLines, optimisticLines]);

  // Input & Draft state
  const [input, setInput] = useState(() => {
    const draft = getDraft(currentSessionId);
    if (draft) return draft;
    const intent = readPendingIntent();
    if (intent?.text && (!intent.sessionId || intent.sessionId === currentSessionId)) {
      clearPendingIntent();
      return intent.text;
    }
    return '';
  });
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const conversationEndRef = useRef<HTMLLIElement | null>(null);
  const pendingMessageRef = useRef<string>('');
  const [isQuotaSheetOpen, setIsQuotaSheetOpen] = useState(false);
  const [quotaReason, setQuotaReason] = useState<'free_exhausted' | 'sub_exhausted' | 'device_cap'>(
    'free_exhausted',
  );

  const [enterToSend] = useClientSetting<boolean>(
    CLIENT_SETTING_KEYS.enterToSend,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.enterToSend],
  );

  // Debounced draft saving
  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft(currentSessionId, input);
    }, 300);
    return () => clearTimeout(timer);
  }, [currentSessionId, input]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [sendTurnMutation.isPending, lines]);

  const busy = sendTurnMutation.isPending;

  async function handleSend() {
    const message = input.trim();
    if (!message || busy) return;

    // Check turn limit (50 cap)
    if (turnCount >= 50) {
      toast.error('This conversation has reached the 50-turn limit.');
      return;
    }

    pendingMessageRef.current = message;
    setInput('');
    clearDraft(currentSessionId);
    setError(null);
    setPendingQuery(message);
    setOptimisticLines([{ role: 'user', text: message }]);
    quotaStore.setPipFlash('pulse');

    // Section 11.1: If new conversation, generate UUID and update URL
    let targetSessionId = currentSessionId;
    if (!targetSessionId) {
      targetSessionId = crypto.randomUUID();
      setCurrentSessionId(targetSessionId);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/recommend/${targetSessionId}`);
      }
    }

    try {
      const response = await sendTurnMutation.mutateAsync({
        message,
        sessionId: targetSessionId,
      });

      quotaStore.setPipFlash('spent');
      pendingMessageRef.current = '';

      if (response.quota) {
        quotaStore.updateFromQuotaLite(response.quota as unknown as QuotaSnapshotLite);
      }

      // If results returned, update active answer turn
      if (response.kind === 'results' && response.picks && response.picks.length > 0) {
        setSelectedAnswerId(`turn-${response.turnIndex}`);
      }
    } catch (err: unknown) {
      quotaStore.setPipFlash('restored');
      // Restore input and draft on error
      setInput(pendingMessageRef.current);
      setDraft(targetSessionId, pendingMessageRef.current);

      const status = (err as { status?: number })?.status ?? 500;
      const errorData = (err as { details?: MeteredErrorResponse })?.details;
      const action = handleMeteredError(status, errorData, null);

      if (action.kind === 'quota') {
        setQuotaReason(action.reason);
        setIsQuotaSheetOpen(true);
      } else if (action.kind === 'auth') {
        savePendingIntent({
          text: pendingMessageRef.current,
          route: targetSessionId ? `/recommend/${targetSessionId}` : '/recommend',
          sessionId: targetSessionId,
        });
        window.location.href = '/login';
      } else if (action.kind === 'toast') {
        toast.error(action.message);
      } else {
        setError(action.message);
      }
    } finally {
      setOptimisticLines([]);
      setPendingQuery(null);
    }
  }

  // Display picks from the selected answer turn
  const displayPicks = (selectedAnswerTurn?.picks as ApiPick[]) ?? null;
  const meta = selectedAnswerTurn?.resultMeta;
  const displayRelaxed = meta?.relaxed ?? [];
  const displayRefined = meta?.refined ?? false;
  const displayScoresTied = meta?.scoresTied ?? false;
  const displayScorecardMissing = meta?.scorecardMissing ?? false;
  const displayTopAspects = meta?.topAspects ?? [];

  const topPick = displayPicks?.[0] ?? null;
  const runnerUps = displayPicks?.slice(1) ?? [];

  const placeholderText =
    activeRegion.countryCode === 'IN'
      ? 'Under ₹60,000, great camera, long battery, not too heavy...'
      : 'Under $700, great camera, long battery, not too heavy...';

  const isFull = turnCount >= 50;
  const isNearLimit = turnCount >= 45 && !isFull;

  return (
    <div className="px-grid-margin py-10">
      <div className="grid gap-8 xl:grid-cols-12">
        {/* Conversation Column */}
        <section className="border-outline-variant bg-background border xl:col-span-5">
          <div className="border-outline-variant flex items-center justify-between border-b p-5">
            <p className="meta-label text-primary">Conversation</p>
            {sessionData?.title ? (
              <span className="text-muted-foreground max-w-[200px] truncate font-mono text-xs">
                {sessionData.title}
              </span>
            ) : null}
          </div>

          <ul className="divide-outline-variant max-h-[min(520px,55vh)] divide-y overflow-y-auto">
            {lines.map((line, i) => (
              <li key={i} ref={i === lines.length - 1 ? conversationEndRef : null} className="p-4">
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

          {displayRelaxed && displayRelaxed.length > 0 ? (
            <p className="border-outline-variant text-muted-foreground border-t p-4 font-mono text-xs">
              Adjustments: {displayRelaxed.join(' / ')}
            </p>
          ) : null}

          {isNearLimit ? (
            <div className="border-outline-variant bg-surface-container/60 border-t p-3 text-center">
              <p className="text-muted-foreground font-mono text-xs">
                Turn {turnCount}/50. Conversations are capped at 50 turns.
              </p>
            </div>
          ) : null}

          <div className="border-outline-variant border-t p-5">
            {isFull ? (
              <div className="space-y-3 py-4 text-center">
                <p className="text-foreground font-mono text-sm">
                  This conversation is full (50 turns).
                </p>
                <p className="text-muted-foreground font-mono text-xs">
                  Start a new conversation to continue exploring.
                </p>
                <Link
                  href="/recommend"
                  className="border-primary bg-primary/10 text-primary hover:bg-primary inline-flex items-center gap-2 border px-5 py-2 font-mono text-xs uppercase transition-colors hover:text-black"
                >
                  Start new recommendation
                </Link>
              </div>
            ) : (
              <>
                <label className="sr-only" htmlFor="rec-input">
                  Your message
                </label>
                <textarea
                  id="rec-input"
                  rows={4}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  disabled={busy}
                  placeholder={placeholderText}
                  className="border-outline-variant bg-surface-container text-foreground placeholder:text-muted-foreground w-full resize-none border p-3 font-mono text-sm focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={busy || !input.trim()}
                  className="border-primary bg-primary text-background hover:bg-primary/90 mt-3 inline-flex w-full items-center justify-center gap-2 border py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-colors disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      Thinking…
                    </>
                  ) : (
                    'Send message'
                  )}
                </button>
              </>
            )}
          </div>
        </section>

        {/* Results Column */}
        <section className="xl:col-span-7">
          {/* Answer timeline / switcher */}
          {answerTurns.length > 1 ? (
            <div className="mb-5">
              <p className="meta-label text-primary mb-3">Answer timeline</p>
              <div className="bg-outline-variant grid gap-px md:grid-cols-2">
                {answerTurns.map((turn, index) => {
                  const turnPicks = (turn.picks as ApiPick[]) ?? [];
                  const isLatest = index === answerTurns.length - 1;
                  const isSelected = activeAnswerId === turn.id;
                  return (
                    <button
                      key={turn.id}
                      type="button"
                      onClick={() => setSelectedAnswerId(turn.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'interactive-panel p-4 text-left transition-colors',
                        isSelected && 'border-accent bg-surface-container',
                      )}
                    >
                      <span className="meta-label text-accent">
                        {isLatest ? 'Latest answer' : `Answer ${index + 1}`}
                      </span>
                      <span className="text-primary mt-2 block truncate font-mono text-xs">
                        {turn.userMessage}
                      </span>
                      <span className="text-muted-foreground mt-2 block font-mono text-[10px] tracking-[0.12em] uppercase">
                        {turnPicks[0]?.model ?? 'No picks'} / {turnPicks.length} picks /{' '}
                        {formatSavedAt(turn.createdAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {displayPicks && displayPicks.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="meta-label text-primary">
                {answerTurns.length > 1 ? 'Selected recommendations' : 'Recommendations'}
              </p>
              {displayPicks.length >= 2 && displayPicks[0] != null && displayPicks[1] != null ? (
                <Link
                  href={`/compare?a=${encodeURIComponent(displayPicks[0].slug)}&b=${encodeURIComponent(displayPicks[1].slug)}`}
                  className="border-outline text-primary hover:bg-primary hover:text-background inline-flex items-center gap-2 border px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors"
                >
                  <Scale className="size-3.5" aria-hidden />
                  Compare top 2
                </Link>
              ) : null}
            </div>
          ) : null}

          {displayScoresTied || displayScorecardMissing ? (
            <div
              role="note"
              className="border-outline-variant bg-background text-muted-foreground mb-4 border p-4 font-mono text-xs leading-5"
            >
              {displayScorecardMissing ? (
                <p>Notice: no reviewer scorecard data yet. Aspect scores default to 5.0/10.</p>
              ) : null}
              {displayScoresTied && displayPicks && displayPicks.length > 1 ? (
                <p>
                  Notice: There is a tie between the top devices (
                  {displayPicks
                    .slice(0, 2)
                    .map((p) => p.model)
                    .join(' & ')}
                  ). Both match your criteria equally well and are shown side-by-side.
                </p>
              ) : null}
            </div>
          ) : null}

          {pendingQuery && busy ? (
            <div className="interactive-panel relative mb-4 overflow-hidden p-10" aria-busy="true">
              <p className="meta-label text-accent">Building answer</p>
              <p className="text-gradient-steel font-display mt-4 text-4xl font-extrabold uppercase">
                {pendingQuery}
              </p>
              <div className="bg-outline-variant mt-8 h-px overflow-hidden">
                <span className="flow-dot bg-accent block size-2" />
              </div>
            </div>
          ) : null}

          {displayPicks && displayPicks.length > 0 ? (
            displayScoresTied && displayPicks.length >= 2 ? (
              <div className="space-y-px" aria-busy={busy}>
                <div className="bg-outline-variant grid gap-px md:grid-cols-2">
                  <RecommendationCard
                    pick={displayPicks[0]!}
                    index={0}
                    featured
                    className="col-span-1"
                    activeRegion={activeRegion}
                    turnCreatedAt={selectedAnswerTurn?.createdAt}
                  />
                  <RecommendationCard
                    pick={displayPicks[1]!}
                    index={1}
                    featured
                    className="col-span-1"
                    activeRegion={activeRegion}
                    turnCreatedAt={selectedAnswerTurn?.createdAt}
                  />
                </div>
                {displayPicks.length > 2 ? (
                  <div className="bg-outline-variant grid gap-px md:grid-cols-2 lg:grid-cols-3">
                    {displayPicks.slice(2).map((pick, index) => (
                      <RecommendationCard
                        key={pick.phoneId}
                        pick={pick}
                        index={index + 2}
                        activeRegion={activeRegion}
                        turnCreatedAt={selectedAnswerTurn?.createdAt}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="bg-outline-variant grid gap-px lg:grid-cols-12" aria-busy={busy}>
                {topPick ? (
                  <RecommendationCard
                    pick={topPick}
                    index={0}
                    featured
                    className="lg:col-span-8"
                    activeRegion={activeRegion}
                    turnCreatedAt={selectedAnswerTurn?.createdAt}
                  />
                ) : null}
                <div className="bg-outline-variant grid gap-px lg:col-span-4">
                  {runnerUps.map((pick, index) => (
                    <RecommendationCard
                      key={pick.phoneId}
                      pick={pick}
                      index={index + 1}
                      activeRegion={activeRegion}
                      turnCreatedAt={selectedAnswerTurn?.createdAt}
                    />
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="interactive-panel bg-background p-10">
              <p className="heading-scanline text-gradient-steel font-display text-4xl font-extrabold tracking-normal uppercase">
                Tell us what you want
              </p>
              <p className="text-muted-foreground mt-4 max-w-lg text-sm leading-6">
                Your recommendations will appear here after you describe your needs.
              </p>
            </div>
          )}

          {displayPicks && displayPicks.length > 0 ? (
            <p className="text-muted-foreground mt-4 font-mono text-[11px] tracking-[0.14em] uppercase">
              Showing {displayPicks.length} {displayPicks.length === 1 ? 'match' : 'picks'}
              {displayRefined ? ' / updated' : ''}
              {displayTopAspects.length > 0
                ? ` / based on ${displayTopAspects.slice(0, 2).join(' then ')}`
                : ''}
            </p>
          ) : null}
        </section>
      </div>

      <QuotaSheet
        isOpen={isQuotaSheetOpen}
        onClose={() => setIsQuotaSheetOpen(false)}
        reason={quotaReason}
        onSelectProduct={(code) => {
          window.location.href = `/pricing?product=${code}`;
        }}
      />
    </div>
  );
}

function RecommendationCard({
  pick,
  index,
  featured = false,
  className,
  activeRegion,
  turnCreatedAt,
}: {
  readonly pick: ApiPick;
  readonly index: number;
  readonly featured?: boolean;
  readonly className?: string;
  readonly activeRegion: RegionConfig;
  readonly turnCreatedAt?: string | number | null;
}) {
  const price = formatPickPrice(pick, activeRegion, turnCreatedAt);
  return (
    <Link
      href={`/p/${pick.slug}`}
      className={cn(
        'interactive-panel group relative overflow-hidden focus-visible:outline-none',
        featured ? 'min-h-[520px]' : 'min-h-64',
        className,
      )}
    >
      <span className="from-accent/40 pointer-events-none absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r to-transparent transition-transform duration-300 group-hover:scale-x-100 group-focus-visible:scale-x-100" />
      <div
        className={cn('border-outline-variant border-b p-5', featured ? 'min-h-72' : 'min-h-36')}
      >
        <span className="meta-label border-primary border-l-2 pl-3">
          {rankLabel(index)}
          {pick.score != null ? ` / Score ${(pick.score * 10).toFixed(1)}` : ''}
        </span>
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
              'font-display text-gradient-steel mt-2 font-bold tracking-normal uppercase',
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
            <ArrowRight
              className="size-3.5 transition-transform duration-200 group-hover:translate-x-1 group-focus-visible:translate-x-1"
              aria-hidden
            />
          </p>
        </div>
      </div>
    </Link>
  );
}
