'use client';

import { ArrowRight, History, Loader2, Plus, Scale, Share2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import { PhoneImage } from '@/components/phone/PhoneImage';
import { SessionHistorySidebar } from '@/components/recommend/SessionHistorySidebar';
import {
  CLIENT_SETTING_DEFAULTS,
  CLIENT_SETTING_KEYS,
  useClientSetting,
} from '@/lib/client-settings';
import { formatLocalPrice } from '@/lib/format-currency';
import type { RegionConfig } from '@/lib/regions';
import {
  apiDeleteSession,
  apiRenameSession,
  apiRestoreSession,
  apiShareSession,
  apiTogglePinSession,
  fetchClientSessions,
  readCachedSessions,
  type SessionSummary,
  type SessionSyncEvent,
} from '@/lib/recommend-session-store';
import type { RecommendationSnapshot } from '@/lib/recommend-session';
import { cn } from '@/lib/utils';

type ApiPick = {
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
};

interface ChatLine {
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

function formatSavedAt(savedAt: number): string {
  const diffMs = Date.now() - savedAt;
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'earlier this session';
  if (diffH === 1) return '1 hour ago';
  return `${diffH} hours ago`;
}

function makeSnapshotId(): string {
  return `answer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function useClientMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

interface RecommendClientProps {
  readonly activeRegion: RegionConfig;
  readonly initialSessionId?: string;
}

export function RecommendClient({ activeRegion, initialSessionId }: RecommendClientProps) {
  const mounted = useClientMounted();
  if (!mounted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="border-border/80 bg-card/40 rounded-xl border p-4 shadow-sm sm:p-6">
          <div className="text-muted-foreground flex items-center justify-center py-16 font-mono text-sm">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
            Loading Workspace…
          </div>
        </div>
      </div>
    );
  }
  return <RecommendClientLoaded activeRegion={activeRegion} initialSessionId={initialSessionId} />;
}

function RecommendClientLoaded({ activeRegion, initialSessionId }: RecommendClientProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>(() => readCachedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId ?? null);
  const [activeSessionTitle, setActiveSessionTitle] = useState<string>('New Recommendation');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(() => Boolean(initialSessionId));

  const [input, setInput] = useState('');
  const [lines, setLines] = useState<ChatLine[]>(() =>
    getInitialLines(activeRegion.symbol, activeRegion.countryCode),
  );
  const [picks, setPicks] = useState<readonly ApiPick[] | null>(null);
  const [relaxed, setRelaxed] = useState<readonly string[] | null>(null);
  const [refined, setRefined] = useState<boolean>(false);
  const [scoresTied, setScoresTied] = useState<boolean>(false);
  const [scorecardMissing, setScorecardMissing] = useState<boolean>(false);
  const [topAspects, setTopAspects] = useState<readonly string[]>([]);
  const [snapshots, setSnapshots] = useState<readonly RecommendationSnapshot[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationEndRef = useRef<HTMLLIElement | null>(null);
  const [enterToSend] = useClientSetting<boolean>(
    CLIENT_SETTING_KEYS.enterToSend,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.enterToSend],
  );

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    setActiveSessionTitle('New Recommendation');
    setIsLoadingHistory(false);
    setLines(getInitialLines(activeRegion.symbol, activeRegion.countryCode));
    setPicks(null);
    setRelaxed(null);
    setRefined(false);
    setScoresTied(false);
    setScorecardMissing(false);
    setTopAspects([]);
    setSnapshots([]);
    setActiveSnapshotId(null);
    setInput('');
    setError(null);
    setSidebarOpen(false);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/recommend');
    }
  }, [activeRegion.symbol, activeRegion.countryCode]);

  // Load session list on mount
  useEffect(() => {
    let mounted = true;
    fetchClientSessions()
      .then((data) => {
        if (mounted) setSessions(data);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsLoadingSessions(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Multi-tab BroadcastChannel listener
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('recsy_session_bus');

    channel.onmessage = (event: MessageEvent<SessionSyncEvent>) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === 'SESSION_CREATED') {
        setSessions((prev) => [msg.session, ...prev.filter((s) => s.id !== msg.session.id)]);
      } else if (msg.type === 'SESSION_UPDATED') {
        setSessions((prev) =>
          prev.map((s) => (s.id === msg.session.id ? { ...s, ...msg.session } : s)),
        );
        if (activeSessionId === msg.session.id && msg.session.title) {
          setActiveSessionTitle(msg.session.title);
        }
      } else if (msg.type === 'SESSION_DELETED') {
        setSessions((prev) => prev.filter((s) => s.id !== msg.id));
        if (activeSessionId === msg.id) {
          handleNewSession();
        }
      } else if (msg.type === 'SESSION_RESTORED') {
        setSessions((prev) => [msg.session, ...prev.filter((s) => s.id !== msg.session.id)]);
      }
    };

    return () => {
      channel.close();
    };
  }, [activeSessionId, handleNewSession]);

  // Hydrate active session from server when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) return;

    let isSubscribed = true;

    fetch(`/api/recommend/sessions/${activeSessionId}`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) {
            toast.error('Chat session not found');
            handleNewSession();
          }
          throw new Error('Failed to load session');
        }
        return res.json() as Promise<{
          session: { id: string; title: string };
          turns: Array<{
            turnIndex: number;
            userMessage: string;
            assistantText: string;
            kind: 'results' | 'clarify';
            picks: ApiPick[];
            relaxed: string[];
            refined: boolean;
            scoresTied: boolean;
            scorecardMissing: boolean;
            topAspects: string[];
            createdAt: string;
          }>;
        }>;
      })
      .then((data) => {
        if (!isSubscribed) return;
        setActiveSessionTitle(data.session.title || 'Recommendation');

        const initial = getInitialLines(activeRegion.symbol, activeRegion.countryCode);
        const hydratedLines: ChatLine[] = [...initial];
        const hydratedSnapshots: RecommendationSnapshot[] = [];

        for (const turn of data.turns) {
          hydratedLines.push({ role: 'user', text: turn.userMessage });
          hydratedLines.push({ role: 'assistant', text: turn.assistantText });

          if (turn.kind === 'results' && turn.picks.length > 0) {
            hydratedSnapshots.push({
              id: `snapshot-turn-${turn.turnIndex}`,
              query: turn.userMessage,
              assistantText: turn.assistantText,
              picks: turn.picks,
              relaxed: turn.relaxed,
              refined: turn.refined,
              scoresTied: turn.scoresTied,
              scorecardMissing: turn.scorecardMissing,
              topAspects: turn.topAspects,
              savedAt: new Date(turn.createdAt).getTime(),
            });
          }
        }

        setLines(hydratedLines);
        setSnapshots(hydratedSnapshots.reverse());

        const latestTurn = data.turns[data.turns.length - 1];
        if (latestTurn && latestTurn.kind === 'results') {
          setPicks(latestTurn.picks);
          setRelaxed(latestTurn.relaxed);
          setRefined(latestTurn.refined);
          setScoresTied(latestTurn.scoresTied);
          setScorecardMissing(latestTurn.scorecardMissing);
          setTopAspects(latestTurn.topAspects);
          setActiveSnapshotId(`snapshot-turn-${latestTurn.turnIndex}`);
        } else {
          setPicks(null);
          setRelaxed(null);
          setRefined(false);
          setScoresTied(false);
          setScorecardMissing(false);
          setTopAspects([]);
          setActiveSnapshotId(null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isSubscribed) setIsLoadingHistory(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [activeSessionId, activeRegion.symbol, activeRegion.countryCode, handleNewSession]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [busy, lines]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setIsLoadingHistory(true);
    setActiveSessionId(sessionId);
    setSidebarOpen(false);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `/recommend/${sessionId}`);
    }
  }, []);

  const handleRenameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      await apiRenameSession(sessionId, newTitle);
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)));
      if (activeSessionId === sessionId) {
        setActiveSessionTitle(newTitle);
      }
    },
    [activeSessionId],
  );

  const handleTogglePin = useCallback(async (sessionId: string, isPinned: boolean) => {
    await apiTogglePinSession(sessionId, isPinned);
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, isPinned } : s)));
  }, []);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await apiDeleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        handleNewSession();
      }
    },
    [activeSessionId, handleNewSession],
  );

  const handleRestoreSession = useCallback(async (sessionId: string) => {
    const restored = await apiRestoreSession(sessionId);
    setSessions((prev) => [restored, ...prev.filter((s) => s.id !== sessionId)]);
  }, []);

  const handleShareSession = useCallback(async (sessionId: string) => {
    return apiShareSession(sessionId);
  }, []);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;

    setInput('');
    setError(null);
    setPendingQuery(message);
    setLines((prev) => [...prev, { role: 'user', text: message }]);
    setBusy(true);

    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message,
          sessionId: activeSessionId || undefined,
        }),
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

      const rawData = data as {
        kind: 'results' | 'clarify';
        sessionId?: string;
        sessionTitle?: string;
        turnIndex?: number;
        clarifyingQuestion?: string;
        picks?: ApiPick[];
        relaxed?: string[];
        refined?: boolean;
        scoresTied?: boolean;
        scorecardMissing?: boolean;
        topAspects?: string[];
      };

      // Set activeSessionId if this is turn 0 of a fresh session
      if (rawData.sessionId && rawData.sessionId !== activeSessionId) {
        setActiveSessionId(rawData.sessionId);
        if (typeof window !== 'undefined') {
          window.history.pushState(null, '', `/recommend/${rawData.sessionId}`);
        }
      }

      if (rawData.sessionTitle) {
        setActiveSessionTitle(rawData.sessionTitle);
      }

      // Re-fetch sessions list asynchronously to update titles/previews
      fetchClientSessions()
        .then((updated) => setSessions(updated))
        .catch(() => {});

      if (rawData.kind === 'clarify') {
        const q = rawData.clarifyingQuestion || 'Tell me a bit more about what you need.';
        setLines((prev) => [...prev, { role: 'assistant', text: q }]);
      } else if (rawData.kind === 'results') {
        const pickList = rawData.picks || [];
        const relaxedList = rawData.relaxed || [];
        const rawRefined = rawData.refined === true;
        const rawScoresTied = rawData.scoresTied === true;
        const rawScorecardMissing = rawData.scorecardMissing === true;
        const topAspectsList = rawData.topAspects || [];

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

          const snapshot: RecommendationSnapshot = {
            id: makeSnapshotId(),
            query: message,
            assistantText: intro,
            picks: pickList,
            relaxed: relaxedList,
            refined: rawRefined,
            scoresTied: rawScoresTied,
            scorecardMissing: rawScorecardMissing,
            topAspects: topAspectsList,
            savedAt: Date.now(),
          };
          setSnapshots((prev) =>
            [snapshot, ...prev.filter((item) => item.id !== snapshot.id)].slice(0, 8),
          );
          setActiveSnapshotId(snapshot.id);

          if (rawScoresTied && pickList.length > 1) {
            const priorityHint =
              topAspectsList.length >= 2
                ? ` on ${topAspectsList[0]} and ${topAspectsList[1]}`
                : topAspectsList[0]
                  ? ` on ${topAspectsList[0]}`
                  : '';
            const topNames = pickList
              .slice(0, 2)
              .map((p) => `${p.brand} ${p.model}`)
              .join(' and ');
            setLines((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: `It's a tie between ${topNames}${priorityHint}. Their performance across what you said matters is effectively identical, so both are presented side-by-side as top picks!`,
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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setPendingQuery(null);
      setBusy(false);
    }
  }

  const activeSnapshot = snapshots.find((snapshot) => snapshot.id === activeSnapshotId) ?? null;
  const displayPicks = (activeSnapshot?.picks as ApiPick[]) ?? picks;
  const displayRelaxed = activeSnapshot?.relaxed ?? relaxed;
  const displayRefined = activeSnapshot?.refined ?? refined;
  const displayScoresTied = activeSnapshot?.scoresTied ?? scoresTied;
  const displayScorecardMissing = activeSnapshot?.scorecardMissing ?? scorecardMissing;
  const displayTopAspects = activeSnapshot?.topAspects ?? topAspects;
  const topPick = displayPicks?.[0] ?? null;
  const runnerUps = displayPicks?.slice(1) ?? [];

  const placeholderText =
    activeRegion.countryCode === 'IN'
      ? 'Under ₹60,000, great camera, long battery, not too heavy...'
      : 'Under $700, great camera, long battery, not too heavy...';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Workspace Top Toolbar */}
      <div className="border-outline-variant bg-surface-container/40 px-grid-margin flex items-center justify-between gap-4 border-b py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="border-outline hover:bg-surface-container inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-xs uppercase transition-colors"
          >
            <History className="size-3.5" />
            <span>Chats ({sessions.length})</span>
          </button>
          <span className="text-muted-foreground hidden sm:inline">•</span>
          <span className="text-primary hidden truncate font-mono text-xs font-bold sm:inline">
            {activeSessionTitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeSessionId && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const { shareUrl } = await handleShareSession(activeSessionId);
                  await navigator.clipboard.writeText(`${window.location.origin}${shareUrl}`);
                  toast.success('Share link copied to clipboard');
                } catch {
                  toast.error('Failed to share chat');
                }
              }}
              className="border-outline hover:bg-surface-container inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-xs uppercase transition-colors"
            >
              <Share2 className="size-3" />
              <span className="hidden sm:inline">Share</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleNewSession}
            className="border-outline bg-primary text-background hover:bg-primary/90 inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-xs uppercase transition-colors"
          >
            <Plus className="size-3" />
            <span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Main Workspace with History Sidebar Drawer and Chat Pane */}
      <div className="relative flex min-h-0 flex-1">
        {/* Slide-over or Collapsible History Sidebar */}
        {sidebarOpen && (
          <>
            <div
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            />
            <div className="absolute inset-y-0 left-0 z-50 w-72 shrink-0 shadow-2xl lg:relative lg:z-auto lg:shadow-none">
              <SessionHistorySidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                isLoading={isLoadingSessions}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onRenameSession={handleRenameSession}
                onTogglePin={handleTogglePin}
                onDeleteSession={handleDeleteSession}
                onRestoreSession={handleRestoreSession}
                onShareSession={handleShareSession}
                className="h-full"
              />
            </div>
          </>
        )}

        {/* Chat & Recommendations Workspace Pane */}
        <div className="px-grid-margin min-w-0 flex-1 overflow-y-auto py-8">
          {isLoadingHistory ? (
            <div className="text-muted-foreground flex items-center justify-center py-24 font-mono text-sm">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Restoring thread…
            </div>
          ) : (
            <div className="grid gap-8 xl:grid-cols-12">
              {/* Conversation Section */}
              <section className="border-outline-variant bg-background flex h-fit flex-col border xl:col-span-5">
                <div className="border-outline-variant flex items-center justify-between border-b p-5">
                  <p className="meta-label text-primary">Conversation</p>
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {activeSessionTitle}
                  </span>
                </div>
                <ul className="divide-outline-variant max-h-[min(520px,55vh)] divide-y overflow-y-auto">
                  {lines.map((line, i) => (
                    <li
                      key={i}
                      ref={i === lines.length - 1 ? conversationEndRef : null}
                      className="p-4"
                    >
                      <p className="meta-label mb-2">
                        {line.role === 'user'
                          ? `Your request ${String(i).padStart(2, '0')}`
                          : 'RECSY'}
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
                    placeholder={placeholderText}
                    className="border-outline bg-background placeholder:text-muted-foreground text-primary focus-visible:border-primary w-full resize-none border-b px-0 py-3 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none"
                    disabled={busy}
                  />
                  <div className="mt-4 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={busy || !input.trim()}
                      className="border-outline text-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background inline-flex items-center gap-2 border px-5 py-3 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                      Recommend
                    </button>
                    {enterToSend && (
                      <span className="text-muted-foreground font-mono text-[10px]">
                        Press Enter to send
                      </span>
                    )}
                  </div>
                </div>
              </section>

              {/* Recommendations Section */}
              <section className="xl:col-span-7">
                {snapshots.length > 0 ? (
                  <div className="mb-5">
                    <p className="meta-label text-primary mb-3">Answer timeline</p>
                    <div className="bg-outline-variant grid gap-px md:grid-cols-2">
                      {snapshots.map((snapshot, index) => (
                        <button
                          key={snapshot.id}
                          type="button"
                          onClick={() => setActiveSnapshotId(snapshot.id)}
                          aria-current={activeSnapshotId === snapshot.id ? 'true' : undefined}
                          className={cn(
                            'interactive-panel p-4 text-left',
                            activeSnapshotId === snapshot.id &&
                              'border-accent bg-surface-container',
                          )}
                        >
                          <span className="meta-label text-accent">
                            {index === 0 ? 'Latest answer' : `Previous answer ${index}`}
                          </span>
                          <span className="text-primary mt-2 block truncate font-mono text-xs">
                            {snapshot.query}
                          </span>
                          <span className="text-muted-foreground mt-2 block font-mono text-[10px] tracking-[0.12em] uppercase">
                            {snapshot.picks[0]?.model ?? 'No picks'} / {snapshot.picks.length} picks
                            / {formatSavedAt(snapshot.savedAt)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {displayPicks && displayPicks.length > 0 ? (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="meta-label text-primary">
                      {activeSnapshot ? 'Selected recommendations' : 'Recommendations'}
                    </p>
                    {displayPicks.length >= 2 &&
                    displayPicks[0] != null &&
                    displayPicks[1] != null ? (
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
                      <p>
                        Notice: no reviewer scorecard data yet. Aspect scores default to 5.0/10.
                      </p>
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
                  <div
                    className="interactive-panel relative mb-4 overflow-hidden p-10"
                    aria-busy="true"
                  >
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
                        />
                        <RecommendationCard
                          pick={displayPicks[1]!}
                          index={1}
                          featured
                          className="col-span-1"
                          activeRegion={activeRegion}
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
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className="bg-outline-variant grid gap-px lg:grid-cols-12"
                      aria-busy={busy}
                    >
                      {topPick ? (
                        <RecommendationCard
                          pick={topPick}
                          index={0}
                          featured
                          className="lg:col-span-8"
                          activeRegion={activeRegion}
                        />
                      ) : null}
                      <div className="bg-outline-variant grid gap-px lg:col-span-4">
                        {runnerUps.map((pick, index) => (
                          <RecommendationCard
                            key={pick.phoneId}
                            pick={pick}
                            index={index + 1}
                            activeRegion={activeRegion}
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
          )}
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({
  pick,
  index,
  featured = false,
  className,
  activeRegion,
}: {
  readonly pick: ApiPick;
  readonly index: number;
  readonly featured?: boolean;
  readonly className?: string;
  readonly activeRegion: RegionConfig;
}) {
  const price = formatLocalPrice(pick.localPrice ?? pick.msrpUsd, activeRegion);
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
