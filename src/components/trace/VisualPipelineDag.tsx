'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Search } from 'lucide-react';
import type { AskRetrievalTrace } from '@/lib/ask-retrieval-trace';
import { EvidenceCard } from './EvidenceCard';

export interface VisualPipelineDagProps {
  readonly trace: AskRetrievalTrace;
  readonly query?: string;
  readonly onSelectSource?: (sourceId: string) => void;
}

export function VisualPipelineDag({
  trace,
  query,
  onSelectSource: _onSelectSource,
}: VisualPipelineDagProps) {
  const [activeStage, setActiveStage] = useState<string>('stage-5');
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(null);

  const embeddingStage = trace.stages.find((s) => s.id === 'embedding');
  const vectorStage = trace.stages.find((s) => s.id === 'vector');
  const ftsStage = trace.stages.find((s) => s.id === 'fts');
  const rrfStage = trace.stages.find((s) => s.id === 'rrf');
  const mmrStage = trace.stages.find((s) => s.id === 'mmr');

  const citedChunks = trace.evidenceChunks.filter((c) => c.isCited);

  return (
    <div className="space-y-6 font-sans">
      {/* Overview Metric Banner */}
      <div className="bg-outline-variant grid gap-px text-left sm:grid-cols-4">
        <div className="bg-surface-container-low p-4">
          <p className="meta-label text-muted-foreground">Total Pipeline Time</p>
          <p className="font-display text-primary mt-1 text-2xl font-extrabold">
            {trace.totalMs} ms
          </p>
          <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
            End-to-end hybrid synthesis
          </p>
        </div>
        <div className="bg-surface-container-low p-4">
          <p className="meta-label text-muted-foreground">Context Excerpts</p>
          <p className="font-display text-accent mt-1 text-2xl font-extrabold">
            {trace.chunkCount}
          </p>
          <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
            Passed through MMR diversity
          </p>
        </div>
        <div className="bg-surface-container-low p-4">
          <p className="meta-label text-muted-foreground">Independent Sources</p>
          <p className="font-display text-primary mt-1 text-2xl font-extrabold">
            {trace.distinctSourceCount}
          </p>
          <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
            {trace.coverageRelaxed
              ? 'Diversity soft limit reached'
              : 'Multi-channel balance verified'}
          </p>
        </div>
        <div className="bg-surface-container-low p-4">
          <p className="meta-label text-muted-foreground">Grounded Citations</p>
          <p className="font-display text-success mt-1 text-2xl font-extrabold">
            {citedChunks.length}
          </p>
          <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
            Direct in-text validations
          </p>
        </div>
      </div>

      {/* Interactive 5-Stage DAG Stepper */}
      <div className="border-outline-variant bg-surface-container-lowest border p-5">
        <div className="border-outline-variant mb-4 flex items-center justify-between border-b pb-3">
          <h3 className="text-primary flex items-center gap-2 font-mono text-xs font-bold tracking-[0.16em] uppercase">
            <span className="bg-accent inline-block size-2" />
            Visual Retrieval Pipeline Flow
          </h3>
          <span className="text-muted-foreground font-mono text-[11px]">
            Click any stage to inspect inner mechanics
          </span>
        </div>

        {/* Stepper Node Bar */}
        <div className="grid gap-2 sm:grid-cols-5">
          {/* Node 1 */}
          <button
            type="button"
            onClick={() => setActiveStage('stage-1')}
            className={`border p-3 text-left transition-all ${
              activeStage === 'stage-1'
                ? 'border-accent bg-surface-container shadow-md'
                : 'border-outline-variant bg-surface-container-low hover:border-outline'
            }`}
          >
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-accent font-bold">01 // EMBED</span>
              <span>{embeddingStage?.ms ?? 0}ms</span>
            </div>
            <p className="text-primary mt-1.5 truncate font-mono text-xs font-bold">Query Vector</p>
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
              768-D representation
            </p>
          </button>

          {/* Node 2 */}
          <button
            type="button"
            onClick={() => setActiveStage('stage-2')}
            className={`border p-3 text-left transition-all ${
              activeStage === 'stage-2'
                ? 'border-accent bg-surface-container shadow-md'
                : 'border-outline-variant bg-surface-container-low hover:border-outline'
            }`}
          >
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-accent font-bold">02 // SEARCH</span>
              <span>{Math.max(vectorStage?.ms ?? 0, ftsStage?.ms ?? 0)}ms</span>
            </div>
            <p className="text-primary mt-1.5 truncate font-mono text-xs font-bold">
              Dual Search Wave
            </p>
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
              {(vectorStage?.count ?? 0) + (ftsStage?.count ?? 0)} candidates
            </p>
          </button>

          {/* Node 3 */}
          <button
            type="button"
            onClick={() => setActiveStage('stage-3')}
            className={`border p-3 text-left transition-all ${
              activeStage === 'stage-3'
                ? 'border-accent bg-surface-container shadow-md'
                : 'border-outline-variant bg-surface-container-low hover:border-outline'
            }`}
          >
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-accent font-bold">03 // FUSION</span>
              <span>{rrfStage?.ms ?? 0}ms</span>
            </div>
            <p className="text-primary mt-1.5 truncate font-mono text-xs font-bold">RRF Blending</p>
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
              {rrfStage?.count ?? 0} fused pool
            </p>
          </button>

          {/* Node 4 */}
          <button
            type="button"
            onClick={() => setActiveStage('stage-4')}
            className={`border p-3 text-left transition-all ${
              activeStage === 'stage-4'
                ? 'border-accent bg-surface-container shadow-md'
                : 'border-outline-variant bg-surface-container-low hover:border-outline'
            }`}
          >
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-accent font-bold">04 // DIVERSIFY</span>
              <span>{mmrStage?.ms ?? 0}ms</span>
            </div>
            <p className="text-primary mt-1.5 truncate font-mono text-xs font-bold">MMR Filter</p>
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
              {trace.chunkCount} selected
            </p>
          </button>

          {/* Node 5 */}
          <button
            type="button"
            onClick={() => setActiveStage('stage-5')}
            className={`border p-3 text-left transition-all ${
              activeStage === 'stage-5'
                ? 'border-accent bg-surface-container shadow-md'
                : 'border-outline-variant bg-surface-container-low hover:border-outline'
            }`}
          >
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-accent font-bold">05 // SYNTHESIS</span>
              <span className="text-success font-bold">GROUNDED</span>
            </div>
            <p className="text-primary mt-1.5 truncate font-mono text-xs font-bold">
              Evidence Vault
            </p>
            <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
              {citedChunks.length} citations
            </p>
          </button>
        </div>

        {/* Stage Detail Panes */}
        <div className="border-outline-variant mt-5 border-t pt-4">
          <AnimatePresence mode="wait">
            {activeStage === 'stage-1' && (
              <motion.div
                key="stage-1"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-accent font-bold tracking-wider uppercase">
                    Stage 01: Dense Query Vector Embedding
                  </span>
                  <span className="text-muted-foreground">
                    {embeddingStage?.ms ?? 0} ms execution
                  </span>
                </div>
                <div className="border-outline-variant bg-surface-container border p-4 font-mono text-xs">
                  <p className="text-muted-foreground">Original Question:</p>
                  <p className="text-primary mt-1 text-sm font-semibold">
                    &ldquo;{query || 'User question'}&rdquo;
                  </p>
                  <div className="text-muted-foreground border-outline-variant mt-3 flex flex-wrap gap-4 border-t pt-3 text-[11px]">
                    <span>
                      Model: <strong className="text-foreground">text-embedding-004</strong>
                    </span>
                    <span>
                      Dimensions: <strong className="text-foreground">768 floats</strong>
                    </span>
                    <span>
                      Scope: <strong className="text-foreground">Device-isolated partition</strong>
                    </span>
                  </div>
                </div>
              </motion.div>
            )}

            {activeStage === 'stage-2' && (
              <motion.div
                key="stage-2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-accent font-bold tracking-wider uppercase">
                    Stage 02: Dual-Stream Retrieval Wave (Dense vs Lexical)
                  </span>
                  <span className="text-muted-foreground">Executed in parallel</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="border-outline-variant bg-surface-container border p-4">
                    <div className="text-primary flex items-center gap-2 font-mono text-xs font-bold">
                      <Cpu className="text-accent size-4" />
                      Vector Cosine Space
                    </div>
                    <p className="text-foreground mt-2 font-mono text-2xl font-extrabold">
                      {vectorStage?.count ?? 0} hits
                    </p>
                    <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                      HNSW vector index query evaluating cosine similarity against all stored phone
                      chunks.
                    </p>
                    <p className="text-accent mt-3 font-mono text-[10px]">
                      Completed in {vectorStage?.ms ?? 0} ms
                    </p>
                  </div>

                  <div className="border-outline-variant bg-surface-container border p-4">
                    <div className="text-primary flex items-center gap-2 font-mono text-xs font-bold">
                      <Search className="text-accent size-4" />
                      PostgreSQL Full-Text Search
                    </div>
                    <p className="text-foreground mt-2 font-mono text-2xl font-extrabold">
                      {ftsStage?.count ?? 0} hits
                    </p>
                    <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                      Lexical ts_rank_cd scoring evaluating exact term presence, stem variations,
                      and proximity.
                    </p>
                    <p className="text-accent mt-3 font-mono text-[10px]">
                      Completed in {ftsStage?.ms ?? 0} ms
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeStage === 'stage-3' && (
              <motion.div
                key="stage-3"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-accent font-bold tracking-wider uppercase">
                    Stage 03: Reciprocal Rank Fusion (RRF Algorithm)
                  </span>
                  <span className="text-muted-foreground">{rrfStage?.ms ?? 0} ms</span>
                </div>
                <div className="border-outline-variant bg-surface-container space-y-3 border p-4 font-mono text-xs">
                  <p className="text-foreground leading-relaxed">
                    Dense semantic scores and lexical BM25 ranks cannot be cross-compared by
                    magnitude. RRF solves this by blending candidates purely by reciprocal rank
                    order:
                  </p>
                  <div className="border-accent bg-surface-container-low text-accent border-l-2 p-2.5 font-bold">
                    RRF Score = &Sigma; [ 1 / ( 60 + rank_i ) ]
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Candidates discovered across BOTH vector and full-text searches receive an
                    amplified boost, ensuring maximum relevance before diversity filtering.
                  </p>
                </div>
              </motion.div>
            )}

            {activeStage === 'stage-4' && (
              <motion.div
                key="stage-4"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-accent font-bold tracking-wider uppercase">
                    Stage 04: Maximal Marginal Relevance (Source Diversity)
                  </span>
                  <span className="text-muted-foreground">{mmrStage?.ms ?? 0} ms</span>
                </div>
                <div className="border-outline-variant bg-surface-container space-y-2.5 border p-4 font-mono text-xs">
                  <p className="text-foreground">
                    MMR with &lambda; = 0.6 prevents single-reviewer domination. If one YouTube
                    review matched 5 candidate chunks, redundant sentences are penalized so
                    independent publications (GSMArena, Reddit) retain seat in context.
                  </p>
                  <div className="grid gap-2 pt-2 sm:grid-cols-3">
                    {trace.sources.map((s) => (
                      <div
                        key={s.id}
                        className="border-outline-variant bg-surface-container-low border p-2 text-[11px]"
                      >
                        <span className="text-accent font-bold uppercase">[{s.type}]</span>
                        <p className="text-primary mt-0.5 truncate font-semibold">{s.title}</p>
                        <p className="text-muted-foreground mt-1 text-[10px] italic">
                          {s.whyReferenced}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeStage === 'stage-5' && (
              <motion.div
                key="stage-5"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-accent font-bold tracking-wider uppercase">
                    Stage 05: Grounded Multi-Source Synthesis & Citation Vault
                  </span>
                  <span className="text-success font-bold">
                    {citedChunks.length} Validated In-Text Claims
                  </span>
                </div>
                <p className="text-muted-foreground font-mono text-xs">
                  Below are the exact excerpts provided to the synthesis model. Highlighted items
                  were explicitly cited in the answer:
                </p>

                {/* Evidence Cards Stack */}
                <div className="space-y-3 pt-2">
                  {trace.evidenceChunks.map((evidence) => (
                    <EvidenceCard
                      key={evidence.chunkId}
                      evidence={evidence}
                      isHighlighted={highlightedChunkId === evidence.chunkId}
                      onHover={(hovered) =>
                        setHighlightedChunkId(hovered ? evidence.chunkId : null)
                      }
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
