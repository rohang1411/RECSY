'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { CitationChip } from '@/components/phone/CitationChip';
import type { AskRetrievalTrace } from '@/lib/ask-retrieval-trace';
import type { ResolvedCitation } from '@/services/chat/citations';

const CITATION_TAG =
  /\[c:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/gi;

type StreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      citations: ResolvedCitation[];
      usage: { tokensIn: number; tokensOut: number };
      model: string;
      retrievalMs: number;
      retrievalTrace?: AskRetrievalTrace;
    }
  | { type: 'error'; code: string; message: string };

function AnswerBody({ text, citations }: { text: string; citations: ResolvedCitation[] }) {
  const { byId, order } = useMemo(() => {
    const byId = new Map<string, ResolvedCitation>();
    const order = new Map<string, number>();
    let n = 1;
    for (const c of citations) {
      const id = c.chunkId.toLowerCase();
      byId.set(id, c);
      if (!order.has(id)) order.set(id, n++);
    }
    return { byId, order };
  }, [citations]);

  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(CITATION_TAG.source, CITATION_TAG.flags);
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`t-${k++}`}>{text.slice(last, m.index)}</span>);
    }
    const id = m[1]!.toLowerCase();
    const cit = byId.get(id);
    const label = String(order.get(id) ?? '?');
    parts.push(<CitationChip key={`c-${k++}`} citation={cit} label={label} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(<span key={`t-${k++}`}>{text.slice(last)}</span>);
  }
  return (
    <div className="text-foreground text-base leading-relaxed whitespace-pre-wrap">{parts}</div>
  );
}

function RetrievalTracePanel({ trace }: { readonly trace: AskRetrievalTrace }) {
  return (
    <div className="border-border/60 bg-muted/20 mt-4 rounded-lg border px-3 py-2 text-left">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        How this answer was built
      </p>
      <ol className="text-muted-foreground mt-2 space-y-1 text-xs">
        {trace.stages.map((s) => (
          <li key={s.name} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-foreground/90">{s.name}</span>
            <span>
              {s.count != null ? `${s.count} hit${s.count === 1 ? '' : 's'} · ` : ''}
              {s.ms} ms
            </span>
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground mt-2 text-xs">
        Final context: {trace.chunkCount} excerpt{trace.chunkCount === 1 ? '' : 's'} from{' '}
        {trace.distinctSourceCount} source{trace.distinctSourceCount === 1 ? '' : 's'} · hybrid
        total {trace.totalMs} ms
        {trace.coverageRelaxed ? ' · source diversity limit relaxed (small corpus)' : ''}
      </p>
      {trace.sources.length > 0 ? (
        <ul className="border-border/50 mt-2 space-y-1 border-t pt-2 text-xs">
          {trace.sources.map((s) => (
            <li key={s.url} className="truncate">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline"
                title={s.title}
              >
                [{s.type}] {s.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PhoneChat({ phoneSlug }: { phoneSlug: string }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<ResolvedCitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    retrievalMs?: number;
    model?: string;
    retrievalTrace?: AskRetrievalTrace;
  } | null>(null);

  const ask = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setAnswer('');
    setCitations([]);
    setMeta(null);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneSlug, query: q }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const dec = new TextDecoder();
      let buf = '';
      let assembled = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as StreamEvent;
          if (evt.type === 'delta') {
            assembled += evt.text;
            setAnswer(assembled);
          } else if (evt.type === 'done') {
            setCitations(evt.citations);
            setMeta({
              retrievalMs: evt.retrievalMs,
              model: evt.model,
              retrievalTrace: evt.retrievalTrace,
            });
          } else if (evt.type === 'error') {
            throw new Error(evt.message);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [busy, phoneSlug, query]);

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h2 className="text-foreground text-lg font-semibold tracking-tight">Ask about this phone</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Excerpts are from reviews about <strong>this phone only</strong>. Asking to compare other
        models or prices may be out of scope — use{' '}
        <a className="text-primary font-medium hover:underline" href="/recommend">
          Recommend
        </a>{' '}
        or{' '}
        <a className="text-primary font-medium hover:underline" href="/browse">
          Browse
        </a>{' '}
        for cross-device picks. Inline links cite sources.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="text-muted-foreground sr-only">Your question</span>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            placeholder="e.g. How is the battery life for heavy camera use?"
            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full resize-y rounded-lg border px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          onClick={() => void ask()}
          disabled={busy || !query.trim()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 shrink-0 items-center justify-center rounded-lg px-5 text-sm font-medium shadow-sm transition focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {error ? (
        <p className="text-destructive mt-4 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {answer ? (
        <article className="border-border/80 bg-card/40 mt-8 rounded-xl border p-5 shadow-sm">
          <AnswerBody text={answer} citations={citations} />
          {meta?.retrievalMs != null ? (
            <p className="text-muted-foreground mt-4 text-xs">
              Retrieved in {Math.round(meta.retrievalMs)} ms
              {meta.model ? ` · ${meta.model}` : ''}
            </p>
          ) : null}
          {meta?.retrievalTrace ? (
            <details className="group mt-3">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-xs font-medium [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-1.5">
                  <ChevronDown className="text-muted-foreground size-3.5 transition-transform group-open:rotate-180" />
                  Show retrieval pipeline &amp; sources
                </span>
              </summary>
              <RetrievalTracePanel trace={meta.retrievalTrace} />
            </details>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
