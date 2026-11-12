'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Maximize2, Minimize2, ShieldCheck } from 'lucide-react';
import type { AskRetrievalTrace } from '@/lib/ask-retrieval-trace';
import type { RecommendPickTrace } from '@/services/recommender/recommend-trace';
import { VisualPipelineDag } from './VisualPipelineDag';
import { SynapseWireframe } from './SynapseWireframe';
import { EvidenceCard } from './EvidenceCard';
import { RecommenderDecisionPipeline } from './RecommenderDecisionPipeline';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export interface ProvenanceInspectorSheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly trace?: AskRetrievalTrace;
  readonly recommendTrace?: RecommendPickTrace;
  readonly query?: string;
  readonly answerText?: string;
  readonly phoneTitle?: string;
  readonly pickModel?: string;
  readonly pickBrand?: string;
}

export function ProvenanceInspectorSheet({
  isOpen,
  onClose,
  trace,
  recommendTrace,
  query,
  answerText,
  phoneTitle = 'Smartphone Evidence Trace',
  pickModel = 'Selected Phone',
  pickBrand = 'Smartphone',
}: ProvenanceInspectorSheetProps) {
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'synapse' | 'evidence'>('pipeline');
  const [isFullCanvas, setIsFullCanvas] = useState(false);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const isRecommenderMode = Boolean(recommendTrace);

  const content = (
    <div className="fixed inset-0 z-[100] flex justify-end font-sans">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
      />

      {/* Slide-over Studio Drawer */}
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className={`border-outline bg-background/95 text-foreground relative z-10 flex h-full w-full flex-col border-l shadow-2xl backdrop-blur-md transition-all duration-300 ${
          isFullCanvas ? 'max-w-6xl' : 'max-w-2xl lg:max-w-3xl'
        }`}
      >
        {/* Top Cybernetic Header */}
        <header className="border-outline-variant bg-surface-container-low border-b p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="bg-accent flex size-2 animate-pulse" />
                <p className="text-accent font-mono text-[10px] font-bold tracking-[0.2em] uppercase">
                  {isRecommenderMode
                    ? 'RECOMMENDER DECISION OBSERVATORY // PROVENANCE TRACE'
                    : 'PROVENANCE OBSERVATORY // GROUND TRUTH VERIFICATION'}
                </p>
              </div>
              <h2 className="font-display text-primary mt-1 truncate text-xl font-extrabold tracking-tight uppercase sm:text-2xl">
                {isRecommenderMode ? `${pickBrand} ${pickModel}` : phoneTitle}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullCanvas(!isFullCanvas)}
                title={isFullCanvas ? 'Switch to split drawer' : 'Expand to full canvas'}
                className="border-outline-variant bg-surface-container text-muted-foreground hover:border-outline hover:text-primary hidden items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[11px] tracking-wider uppercase transition-colors sm:inline-flex"
              >
                {isFullCanvas ? (
                  <>
                    <Minimize2 className="size-3.5" />
                    <span>Split</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="size-3.5" />
                    <span>Full Canvas</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="border-outline-variant bg-surface-container text-muted-foreground hover:border-accent hover:text-accent border p-2 transition-colors"
                aria-label="Close provenance observatory"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs for Q&A Mode */}
          {!isRecommenderMode && trace ? (
            <div className="border-outline-variant mt-4 flex flex-wrap gap-2 border-t pt-3 font-mono text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('pipeline')}
                className={`border px-3 py-1.5 font-bold tracking-wider uppercase transition-colors ${
                  activeTab === 'pipeline'
                    ? 'border-accent bg-accent text-black'
                    : 'border-outline-variant bg-surface-container text-muted-foreground hover:border-outline hover:text-primary'
                }`}
              >
                01 // Visual Pipeline DAG
              </button>

              {answerText ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('synapse')}
                  className={`border px-3 py-1.5 font-bold tracking-wider uppercase transition-colors ${
                    activeTab === 'synapse'
                      ? 'border-accent bg-accent text-black'
                      : 'border-outline-variant bg-surface-container text-muted-foreground hover:border-outline hover:text-primary'
                  }`}
                >
                  02 // Claim Synapse Matrix
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setActiveTab('evidence')}
                className={`border px-3 py-1.5 font-bold tracking-wider uppercase transition-colors ${
                  activeTab === 'evidence'
                    ? 'border-accent bg-accent text-black'
                    : 'border-outline-variant bg-surface-container text-muted-foreground hover:border-outline hover:text-primary'
                }`}
              >
                03 // Evidence Vault ({trace.evidenceChunks.length})
              </button>
            </div>
          ) : null}
        </header>

        {/* Scrollable View Area */}
        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {isRecommenderMode && recommendTrace ? (
            <RecommenderDecisionPipeline
              pickModel={pickModel}
              pickBrand={pickBrand}
              trace={recommendTrace}
            />
          ) : trace ? (
            <>
              {activeTab === 'pipeline' && <VisualPipelineDag trace={trace} query={query} />}

              {activeTab === 'synapse' && answerText && (
                <SynapseWireframe answerText={answerText} trace={trace} />
              )}

              {activeTab === 'evidence' && (
                <div className="space-y-4">
                  <div className="border-outline-variant bg-surface-container-low border p-4">
                    <p className="text-primary font-mono text-xs font-bold tracking-wider uppercase">
                      All Context Excerpts Retrieved ({trace.evidenceChunks.length})
                    </p>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">
                      Excerpts ordered by hybrid RRF relevance. Citations highlighted in solar
                      amber.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {trace.evidenceChunks.map((evidence) => (
                      <EvidenceCard key={evidence.chunkId} evidence={evidence} />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="border-outline-variant bg-surface-container-low text-muted-foreground flex items-center justify-between border-t p-3.5 font-mono text-[10px]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-success size-3.5" />
            <span>Citation Validated Ground Truth</span>
          </div>
          <span>RECSY Telemetry Engine</span>
        </footer>
      </motion.aside>
    </div>
  );

  return createPortal(content, document.body);
}
