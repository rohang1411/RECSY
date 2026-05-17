'use client';

import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

export type WorkbenchSource = {
  id: string;
  type: string;
  title: string;
  url: string;
};

export type WorkbenchChunk = {
  id: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  tokens: number;
};

type ChunkWorkbenchProps = {
  readonly sources: readonly WorkbenchSource[];
  readonly chunks: readonly WorkbenchChunk[];
  readonly aspectLabels: readonly string[];
};

function preview(text: string, expanded: boolean) {
  if (expanded || text.length <= 560) return text;
  return `${text.slice(0, 560).trim()}...`;
}

export function ChunkWorkbench({ sources, chunks, aspectLabels }: ChunkWorkbenchProps) {
  const [activeChunkId, setActiveChunkId] = useState(chunks[0]?.id ?? null);
  const [expanded, setExpanded] = useState(false);
  const chunksBySource = useMemo(() => {
    const map = new Map<string, WorkbenchChunk[]>();
    for (const chunk of chunks) {
      const list = map.get(chunk.sourceId) ?? [];
      list.push(chunk);
      map.set(chunk.sourceId, list);
    }
    return map;
  }, [chunks]);
  const activeChunk = chunks.find((chunk) => chunk.id === activeChunkId) ?? chunks[0] ?? null;
  const activeSource = activeChunk
    ? sources.find((source) => source.id === activeChunk.sourceId)
    : null;

  return (
    <section className="border-outline-variant bg-background border lg:col-span-7">
      <div className="border-outline-variant border-b p-5">
        <p className="meta-label text-primary">Chunk workbench</p>
      </div>
      <div className="grid min-h-[520px] lg:grid-cols-[0.95fr_1.05fr]">
        <div className="border-outline-variant max-h-[620px] overflow-y-auto border-r">
          {sources.length > 0 ? (
            sources.map((source) => {
              const sourceChunks = chunksBySource.get(source.id) ?? [];
              return (
                <details
                  key={source.id}
                  className="border-outline-variant border-b"
                  open={sourceChunks.some((chunk) => chunk.id === activeChunk?.id)}
                >
                  <summary className="hover:bg-surface-container cursor-pointer list-none p-4 transition-colors [&::-webkit-details-marker]:hidden">
                    <p className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
                      {source.type}
                    </p>
                    <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">
                      {source.title}
                    </p>
                    <p className="text-accent mt-2 font-mono text-[10px] tracking-[0.12em] uppercase">
                      {sourceChunks.length} chunks
                    </p>
                  </summary>
                  <div className="bg-outline-variant grid gap-px p-px">
                    {sourceChunks.length > 0 ? (
                      sourceChunks.slice(0, 8).map((chunk) => (
                        <button
                          key={chunk.id}
                          type="button"
                          onClick={() => {
                            setActiveChunkId(chunk.id);
                            setExpanded(false);
                          }}
                          aria-pressed={activeChunk?.id === chunk.id}
                          className={cn(
                            'bg-background hover:bg-surface-container focus-visible:bg-surface-container p-3 text-left transition-colors',
                            activeChunk?.id === chunk.id && 'bg-surface-container text-primary',
                          )}
                        >
                          <span className="text-primary font-mono text-xs">
                            Chunk {chunk.chunkIndex}
                          </span>
                          <span className="text-muted-foreground ml-3 font-mono text-[10px] tracking-[0.12em] uppercase">
                            {chunk.tokens} tokens
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="bg-background text-muted-foreground p-4 text-sm">
                        No chunks from this source are visible in the current sample.
                      </p>
                    )}
                  </div>
                </details>
              );
            })
          ) : (
            <p className="text-muted-foreground p-5 text-sm">
              No source or chunk data has been ingested for this phone yet.
            </p>
          )}
        </div>
        <div className="p-5">
          {activeChunk ? (
            <article aria-live="polite">
              <p className="meta-label text-accent">
                {activeSource?.type ?? 'Source'} / chunk {activeChunk.chunkIndex}
              </p>
              <h3 className="text-gradient-steel font-display mt-3 text-3xl font-bold uppercase">
                {activeSource?.title ?? 'Selected evidence'}
              </h3>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="border-outline-variant text-muted-foreground border px-2 py-1 font-mono text-[10px] tracking-[0.12em] uppercase">
                  {activeChunk.tokens} tokens
                </span>
                {aspectLabels.slice(0, 4).map((aspect) => (
                  <span
                    key={aspect}
                    className="border-accent/60 bg-accent/10 text-primary border px-2 py-1 font-mono text-[10px] tracking-[0.12em] uppercase"
                  >
                    {aspect}
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground mt-6 text-sm leading-7 whitespace-pre-line">
                {preview(activeChunk.text, expanded)}
              </p>
              {activeChunk.text.length > 560 ? (
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  aria-expanded={expanded}
                  className="border-outline text-primary hover:border-accent hover:text-accent mt-6 border px-4 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors"
                >
                  {expanded ? 'Collapse chunk' : 'Expand chunk'}
                </button>
              ) : null}
            </article>
          ) : (
            <div className="text-muted-foreground flex min-h-80 items-center justify-center text-sm">
              Select a chunk to inspect extracted evidence.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
