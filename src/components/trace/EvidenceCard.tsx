'use client';

import { useState } from 'react';
import {
  ExternalLink,
  Play,
  Radio,
  MessageSquare,
  Newspaper,
  CheckCircle2,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import type { EvidenceChunkTrace } from '@/lib/ask-retrieval-trace';

export interface EvidenceCardProps {
  readonly evidence: EvidenceChunkTrace;
  readonly isHighlighted?: boolean;
  readonly onHover?: (hovered: boolean) => void;
}

function formatTimestamp(seconds: number | null | undefined): string | null {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function EvidenceCard({ evidence, isHighlighted = false, onHover }: EvidenceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const tsStr = formatTimestamp(evidence.startTs);
  const scorePct = Math.round(Math.min(1, Math.max(0, evidence.score)) * 100);

  const PlatformIcon =
    evidence.sourceType === 'youtube'
      ? Play
      : evidence.sourceType === 'reddit'
        ? MessageSquare
        : Newspaper;

  const platformBadgeColor =
    evidence.sourceType === 'youtube'
      ? 'text-[#ff4d00] border-[#ff4d00]/30 bg-[#ff4d00]/10'
      : evidence.sourceType === 'reddit'
        ? 'text-[#ff8736] border-[#ff8736]/30 bg-[#ff8736]/10'
        : 'text-primary border-outline-variant bg-surface-container';

  const previewLimit = 220;
  const isLong = evidence.text.length > previewLimit;
  const displayText =
    expanded || !isLong ? evidence.text : `${evidence.text.slice(0, previewLimit)}…`;

  return (
    <article
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={`group relative border p-4 transition-all duration-200 ${
        isHighlighted
          ? 'border-accent bg-surface-container ring-accent shadow-[0_0_24px_rgba(216,107,56,0.18)] ring-1'
          : evidence.isCited
            ? 'border-outline bg-surface-container-low hover:border-accent/80'
            : 'border-outline-variant bg-surface-container-lowest/80 hover:border-outline opacity-85 hover:opacity-100'
      }`}
    >
      {/* Top telemetry bar */}
      <div className="border-outline-variant flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase ${platformBadgeColor}`}
          >
            <PlatformIcon className="size-2.5 fill-current" />
            {evidence.sourceType}
          </span>
          {evidence.channel || evidence.author ? (
            <span className="text-primary truncate font-mono text-xs font-semibold">
              {evidence.channel || evidence.author}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px]">
          {evidence.isCited ? (
            <span className="border-accent bg-accent/15 text-accent flex items-center gap-1 border px-1.5 py-0.5 font-bold">
              <Sparkles className="size-2.5" />
              Cited {evidence.citationIndices.map((i) => `[${i}]`).join(' ')}
            </span>
          ) : null}

          {tsStr ? (
            <span className="border-outline-variant bg-surface-container text-accent flex items-center gap-1 border px-1.5 py-0.5">
              <Radio className="size-2 animate-pulse" />
              {tsStr}
            </span>
          ) : null}

          <span className="text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="text-success size-2.5" />
            {scorePct}% relevance
          </span>
        </div>
      </div>

      {/* Source Title */}
      <h4
        className="text-foreground mt-2.5 line-clamp-1 font-mono text-xs font-bold"
        title={evidence.sourceTitle}
      >
        {evidence.sourceTitle}
      </h4>

      {/* Why Referenced Badge */}
      <div className="text-muted-foreground mt-2 flex items-center gap-1.5 font-mono text-[11px]">
        <span className="bg-accent size-1 rounded-none" />
        <span className="italic">{evidence.whyReferenced}</span>
      </div>

      {/* Verbatim Excerpt */}
      <div className="border-accent/70 bg-surface-container-lowest relative mt-2.5 border-l-2 p-3">
        <p className="text-foreground/90 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          &ldquo;{displayText}&rdquo;
        </p>

        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-accent mt-2 inline-flex items-center gap-1 font-mono text-[10px] tracking-wider uppercase hover:underline"
          >
            <span>{expanded ? 'Show Less' : 'Read Full Excerpt'}</span>
            <ChevronDown
              className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        ) : null}
      </div>

      {/* Footer Link */}
      <div className="border-outline-variant mt-3 flex items-center justify-between border-t pt-2.5 font-mono text-[10px] tracking-wider uppercase">
        <span className="text-muted-foreground">Chunk {evidence.chunkId.slice(0, 8)}</span>
        <a
          href={evidence.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-primary flex items-center gap-1.5 underline-offset-2 transition-colors hover:underline"
        >
          <span>Open Full Source</span>
          <ExternalLink className="size-3" />
        </a>
      </div>
    </article>
  );
}
