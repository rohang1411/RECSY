'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ThumbsUp, ThumbsDown, Award } from 'lucide-react';
import type { AspectScoreTrace } from '@/services/recommender/recommend-trace';

export interface AspectEqualizerProps {
  readonly aspects: readonly AspectScoreTrace[];
}

export function AspectEqualizer({ aspects }: AspectEqualizerProps) {
  const [expandedAspect, setExpandedAspect] = useState<string | null>(aspects[0]?.aspect ?? null);

  return (
    <div className="space-y-3 font-sans">
      <div className="border-outline-variant bg-surface-container-low border p-4">
        <h4 className="text-primary flex items-center gap-2 font-mono text-xs font-bold tracking-[0.16em] uppercase">
          <Award className="text-accent size-3.5" />
          Multi-Aspect Score Equalizer & Reviewer Consensus
        </h4>
        <p className="text-muted-foreground mt-1 font-mono text-xs">
          How your stated priorities multiplied review scores into the final ranking. Click any
          aspect to read reviewer quotes.
        </p>
      </div>

      <div className="space-y-2">
        {aspects.map((asp, idx) => {
          const isExpanded = expandedAspect === asp.aspect;
          const weightPct = Math.round(asp.weight * 100);
          const scoreBarWidth = `${Math.min(100, Math.max(8, asp.score * 10))}%`;
          const hasQuotes = asp.supportingQuotes.length > 0 || asp.dissentingQuotes.length > 0;

          return (
            <div
              key={asp.aspect}
              className={`border transition-all duration-150 ${
                isExpanded
                  ? 'border-accent bg-surface-container shadow-[0_0_18px_rgba(216,107,56,0.12)]'
                  : 'border-outline-variant bg-surface-container-low hover:border-outline'
              }`}
            >
              <button
                type="button"
                onClick={() => setExpandedAspect(isExpanded ? null : asp.aspect)}
                className="flex w-full flex-col justify-between gap-3 p-4 text-left sm:flex-row sm:items-center"
              >
                {/* Left: Aspect name & user weight badge */}
                <div className="min-w-36">
                  <div className="text-primary flex items-center gap-2 font-mono text-xs font-bold uppercase">
                    <span className="text-accent font-mono text-[10px]">#{idx + 1}</span>
                    <span>{asp.aspect}</span>
                  </div>
                  <div className="text-muted-foreground mt-1 flex items-center gap-2 font-mono text-[10px]">
                    <span className="border-outline-variant bg-surface-container py-0.2 border px-1.5">
                      Weight: <strong className="text-foreground">{weightPct}%</strong>
                    </span>
                    <span>Conf: {Math.round(asp.confidence * 100)}%</span>
                  </div>
                </div>

                {/* Center: Graphical score bar */}
                <div className="w-full max-w-md flex-1">
                  <div className="text-muted-foreground mb-1 flex items-center justify-between font-mono text-[10px]">
                    <span>Aspect Score</span>
                    <span className="text-primary text-xs font-bold">{asp.score} / 10</span>
                  </div>
                  <div className="bg-surface-container-highest h-2 w-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: scoreBarWidth }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                      className={`h-full ${idx === 0 ? 'bg-accent' : 'bg-primary'}`}
                    />
                  </div>
                </div>

                {/* Right: Contribution score & expand chevron */}
                <div className="flex min-w-28 items-center justify-between gap-3 text-right sm:justify-end">
                  <div>
                    <span className="text-muted-foreground block font-mono text-[10px] uppercase">
                      Contribution
                    </span>
                    <span className="text-foreground font-mono text-xs font-extrabold">
                      +{asp.contribution.toFixed(2)} pts
                    </span>
                  </div>
                  <ChevronDown
                    className={`text-muted-foreground size-4 transition-transform duration-200 ${
                      isExpanded ? 'text-accent rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {/* Expandable Reviewer Consensus Panel */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-outline-variant bg-surface-container-lowest space-y-3 overflow-hidden border-t p-4"
                  >
                    {asp.summary ? (
                      <p className="text-foreground/90 border-accent border-l-2 py-1 pl-3 font-mono text-xs italic">
                        &ldquo;{asp.summary}&rdquo;
                      </p>
                    ) : null}

                    {/* Supporting Reviewer Quotes */}
                    {asp.supportingQuotes.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-success flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider uppercase">
                          <ThumbsUp className="size-3" />
                          Reviewer Consensus (Supporting Evidence)
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {asp.supportingQuotes.map((q, qIdx) => (
                            <div
                              key={qIdx}
                              className="border-outline-variant bg-surface-container-low text-foreground/80 border p-2.5 font-mono text-xs"
                            >
                              <p className="line-clamp-3 italic">&ldquo;{q.excerpt}&rdquo;</p>
                              {q.sourceTitle ? (
                                <p className="text-muted-foreground mt-1 truncate text-[10px]">
                                  — {q.sourceTitle}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Dissenting Reviewer Quotes */}
                    {asp.dissentingQuotes.length > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-warning flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider uppercase">
                          <ThumbsDown className="size-3" />
                          Critical Notes & Tradeoffs (Reviewer Dissent)
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {asp.dissentingQuotes.map((q, qIdx) => (
                            <div
                              key={qIdx}
                              className="border-outline-variant bg-surface-container-low text-foreground/80 border p-2.5 font-mono text-xs"
                            >
                              <p className="line-clamp-3 italic">&ldquo;{q.excerpt}&rdquo;</p>
                              {q.sourceTitle ? (
                                <p className="text-muted-foreground mt-1 truncate text-[10px]">
                                  — {q.sourceTitle}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {!hasQuotes && !asp.summary ? (
                      <p className="text-muted-foreground font-mono text-xs italic">
                        Aspect scored via normalized hardware benchmark specifications.
                      </p>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
