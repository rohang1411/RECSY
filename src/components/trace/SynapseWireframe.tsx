'use client';

import { useState, useMemo } from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import type { AskRetrievalTrace, EvidenceChunkTrace } from '@/lib/ask-retrieval-trace';
import { EvidenceCard } from './EvidenceCard';

export interface SynapseWireframeProps {
  readonly answerText: string;
  readonly trace: AskRetrievalTrace;
}

interface ParsedSentence {
  readonly id: string;
  readonly rawText: string;
  readonly cleanText: string;
  readonly citedChunkIds: readonly string[];
}

const CITATION_REGEX =
  /\[c:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/gi;

function parseSentences(text: string): ParsedSentence[] {
  if (!text) return [];

  // Punctuation-preserving sentence split
  const rawParts = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return rawParts.map((raw, idx) => {
    const ids: string[] = [];
    const re = new RegExp(CITATION_REGEX.source, CITATION_REGEX.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      ids.push(m[1]!.toLowerCase());
    }

    const clean = raw.replace(CITATION_REGEX, '').trim();

    return {
      id: `sentence-${idx}`,
      rawText: raw,
      cleanText: clean,
      citedChunkIds: ids,
    };
  });
}

export function SynapseWireframe({ answerText, trace }: SynapseWireframeProps) {
  const [hoveredSentenceId, setHoveredSentenceId] = useState<string | null>(null);
  const [hoveredChunkId, setHoveredChunkId] = useState<string | null>(null);

  const sentences = useMemo(() => parseSentences(answerText), [answerText]);

  const chunkMap = useMemo(() => {
    const map = new Map<string, EvidenceChunkTrace>();
    for (const c of trace.evidenceChunks) {
      map.set(c.chunkId.toLowerCase(), c);
    }
    return map;
  }, [trace.evidenceChunks]);

  // Determine active highlights based on hover
  const activeHighlightedChunkIds = useMemo(() => {
    if (hoveredChunkId) return new Set([hoveredChunkId.toLowerCase()]);
    if (hoveredSentenceId) {
      const sentence = sentences.find((s) => s.id === hoveredSentenceId);
      return new Set(sentence?.citedChunkIds.map((id) => id.toLowerCase()) ?? []);
    }
    return new Set<string>();
  }, [hoveredChunkId, hoveredSentenceId, sentences]);

  const activeHighlightedSentenceIds = useMemo(() => {
    if (hoveredSentenceId) return new Set([hoveredSentenceId]);
    if (hoveredChunkId) {
      const sIds = new Set<string>();
      for (const s of sentences) {
        if (s.citedChunkIds.some((id) => id.toLowerCase() === hoveredChunkId.toLowerCase())) {
          sIds.add(s.id);
        }
      }
      return sIds;
    }
    return new Set<string>();
  }, [hoveredChunkId, hoveredSentenceId, sentences]);

  return (
    <div className="space-y-4 font-sans">
      <div className="border-outline-variant bg-surface-container-low border p-4">
        <h4 className="text-primary flex items-center gap-2 font-mono text-xs font-bold tracking-[0.16em] uppercase">
          <Sparkles className="text-accent size-3.5" />
          Interactive Claim-to-Evidence Matrix
        </h4>
        <p className="text-muted-foreground mt-1 font-mono text-xs">
          Hover over any generated statement on the left to illuminate the exact reviewer excerpt
          that validated it.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left Column: Synthesized Sentence Claims */}
        <div className="space-y-2.5 lg:col-span-6">
          <p className="meta-label text-muted-foreground border-outline-variant border-b pb-1">
            Synthesized Statements ({sentences.length})
          </p>

          <div className="space-y-2">
            {sentences.map((s, idx) => {
              const isClaimHighlighted = activeHighlightedSentenceIds.has(s.id);
              const hasCitations = s.citedChunkIds.length > 0;

              return (
                <div
                  key={s.id}
                  onMouseEnter={() => setHoveredSentenceId(s.id)}
                  onMouseLeave={() => setHoveredSentenceId(null)}
                  className={`cursor-default border p-3.5 text-left transition-all duration-150 ${
                    isClaimHighlighted
                      ? 'border-accent bg-surface-container ring-accent shadow-[0_0_18px_rgba(216,107,56,0.14)] ring-1'
                      : hasCitations
                        ? 'border-outline-variant bg-surface-container-low hover:border-outline'
                        : 'border-outline-variant/60 bg-surface-container-lowest/70 opacity-70'
                  }`}
                >
                  <div className="border-outline-variant/60 flex items-center justify-between border-b pb-1.5 font-mono text-[10px]">
                    <span className="text-accent font-bold">
                      STATEMENT {String(idx + 1).padStart(2, '0')}
                    </span>
                    {hasCitations ? (
                      <span className="text-success flex items-center gap-1">
                        <CheckCircle2 className="size-2.5" />
                        {s.citedChunkIds.length} Verified{' '}
                        {s.citedChunkIds.length === 1 ? 'Source' : 'Sources'}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">Contextual connective</span>
                    )}
                  </div>

                  <p className="text-foreground mt-2 font-mono text-xs leading-relaxed">
                    {s.cleanText}
                  </p>

                  {hasCitations ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {s.citedChunkIds.map((cId) => {
                        const chunk = chunkMap.get(cId.toLowerCase());
                        return (
                          <span
                            key={cId}
                            className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                              activeHighlightedChunkIds.has(cId.toLowerCase())
                                ? 'border-accent bg-accent font-bold text-black'
                                : 'border-outline-variant bg-surface-container text-muted-foreground'
                            }`}
                          >
                            [{chunk?.sourceType ?? 'src'}:{' '}
                            {chunk?.channel ||
                              chunk?.author ||
                              chunk?.sourceTitle.slice(0, 16) ||
                              cId.slice(0, 6)}
                            ]
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Referenced Evidence Chunks */}
        <div className="space-y-2.5 lg:col-span-6">
          <p className="meta-label text-muted-foreground border-outline-variant border-b pb-1">
            Corresponding Review Passages ({trace.evidenceChunks.length})
          </p>

          <div className="space-y-3">
            {trace.evidenceChunks.map((evidence) => {
              const isChunkHighlighted = activeHighlightedChunkIds.has(
                evidence.chunkId.toLowerCase(),
              );

              return (
                <div
                  key={evidence.chunkId}
                  onMouseEnter={() => setHoveredChunkId(evidence.chunkId)}
                  onMouseLeave={() => setHoveredChunkId(null)}
                >
                  <EvidenceCard evidence={evidence} isHighlighted={isChunkHighlighted} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
