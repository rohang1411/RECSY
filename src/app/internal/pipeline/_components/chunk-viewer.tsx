'use client';

import { Braces, FileText, Filter } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { EvidenceChunk } from '@/services/internal/phone-evidence';

export function ChunkViewer({ chunks }: { readonly chunks: readonly EvidenceChunk[] }) {
  const [sourceId, setSourceId] = useState('all');
  const sourceOptions = useMemo(() => {
    const bySource = new Map<string, { id: string; title: string; type: string; count: number }>();
    for (const chunk of chunks) {
      const current = bySource.get(chunk.sourceId);
      if (current) {
        current.count += 1;
      } else {
        bySource.set(chunk.sourceId, {
          id: chunk.sourceId,
          title: chunk.sourceTitle,
          type: chunk.sourceType,
          count: 1,
        });
      }
    }
    return Array.from(bySource.values()).sort((a, b) => b.count - a.count);
  }, [chunks]);
  const visibleChunks =
    sourceId === 'all' ? chunks : chunks.filter((chunk) => chunk.sourceId === sourceId);

  return (
    <div className="border-border/60 bg-card/45 rounded-lg border p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Braces className="text-primary size-4" aria-hidden />
            Embedded Chunk Viewer
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Text units persisted for vector and full-text retrieval.
          </p>
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <Filter className="size-3.5" aria-hidden />
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="border-border/70 bg-background text-foreground h-9 max-w-64 rounded-md border px-2 text-xs"
          >
            <option value="all">All sources ({chunks.length})</option>
            {sourceOptions.map((source) => (
              <option key={source.id} value={source.id}>
                {source.type}: {source.title.slice(0, 52)} ({source.count})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
        {visibleChunks.length > 0 ? (
          visibleChunks.map((chunk) => (
            <article
              key={chunk.id}
              className="bg-background/70 border-border/50 rounded-md border p-3"
            >
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
                <FileText className="size-3" aria-hidden />
                <span className="font-mono">{chunk.sourceType}</span>
                <span>{chunk.sourceTitle}</span>
                <span className="ml-auto font-mono">chunk {chunk.chunkIndex}</span>
              </div>
              <p className="text-foreground/90 mt-2 text-xs leading-relaxed">{chunk.text}</p>
              <div className="text-muted-foreground mt-2 flex flex-wrap gap-2 font-mono text-[10px]">
                <span>{chunk.tokens} tokens</span>
                <span>{chunk.embeddingModel}</span>
                {chunk.startTs !== null ? <span>t={chunk.startTs}s</span> : null}
              </div>
            </article>
          ))
        ) : (
          <p className="text-muted-foreground border-border/60 rounded-md border border-dashed p-4 text-sm">
            No chunks are stored for this selection yet.
          </p>
        )}
      </div>
    </div>
  );
}
