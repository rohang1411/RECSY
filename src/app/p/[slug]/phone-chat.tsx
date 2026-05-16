'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { CitationChip } from '@/components/phone/CitationChip';
import type { AskRetrievalTrace } from '@/lib/ask-retrieval-trace';
import {
  CLIENT_SETTING_DEFAULTS,
  CLIENT_SETTING_KEYS,
  useClientSetting,
} from '@/lib/client-settings';
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
  return <div className="text-primary text-base leading-7 whitespace-pre-wrap">{parts}</div>;
}

function RetrievalTracePanel({ trace }: { readonly trace: AskRetrievalTrace }) {
  return (
    <div className="border-outline-variant bg-background mt-4 border text-left">
      <p className="meta-label border-outline-variant text-primary border-b p-3">Retrieval trace</p>
      <ol className="divide-outline-variant text-muted-foreground divide-y font-mono text-xs">
        {trace.stages.map((s) => (
          <li key={s.name} className="flex flex-wrap items-baseline justify-between gap-2 p-3">
            <span className="text-primary">{s.name}</span>
            <span>
              {s.count != null ? `${s.count} hit${s.count === 1 ? '' : 's'} / ` : ''}
              {s.ms} ms
            </span>
          </li>
        ))}
      </ol>
      <p className="border-outline-variant text-muted-foreground border-t p-3 font-mono text-xs">
        Final context: {trace.chunkCount} excerpts / {trace.distinctSourceCount} sources / hybrid
        total {trace.totalMs} ms
        {trace.coverageRelaxed ? ' / source diversity limit relaxed' : ''}
      </p>
      {trace.sources.length > 0 ? (
        <ul className="border-outline-variant divide-outline-variant divide-y border-t font-mono text-xs">
          {trace.sources.map((s) => (
            <li key={s.url} className="truncate p-3">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
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
  const [enterToSend] = useClientSetting<boolean>(
    CLIENT_SETTING_KEYS.enterToSend,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.enterToSend],
  );

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
    <section className="px-grid-margin py-10">
      <div className="border-outline-variant bg-background border">
        <div className="border-outline-variant border-b p-5">
          <p className="meta-label">Ask a question</p>
          <h2 className="font-display text-primary mt-3 text-4xl font-extrabold tracking-normal uppercase">
            Ask About This Phone
          </h2>
          <p className="text-muted-foreground mt-3 max-w-3xl text-sm leading-6">
            Excerpts are scoped to this device. For cross-device picks, use the recommender or
            Browse catalog.
          </p>
        </div>

        <div className="bg-outline-variant grid gap-px lg:grid-cols-[1fr_auto]">
          <label className="bg-background p-5">
            <span className="sr-only">Your question</span>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (enterToSend && e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
              rows={3}
              placeholder="How is the battery life for heavy camera use?"
              className="border-outline bg-background placeholder:text-muted-foreground text-primary focus-visible:border-primary w-full resize-y border-b px-0 py-3 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none disabled:opacity-50"
              disabled={busy}
            />
          </label>
          <div className="bg-background flex p-5 lg:items-end">
            <button
              type="button"
              onClick={() => void ask()}
              disabled={busy || !query.trim()}
              className="border-outline text-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background inline-flex h-12 items-center justify-center border px-6 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
            >
              {busy ? 'Thinking' : 'Ask'}
            </button>
          </div>
        </div>

        {error ? (
          <p
            className="border-outline-variant text-destructive border-t p-5 font-mono text-sm"
            role="alert"
          >
            Error: {error}
          </p>
        ) : null}

        {answer ? (
          <article className="border-outline-variant border-t p-5">
            <p className="meta-label text-primary mb-4">Answer</p>
            <AnswerBody text={answer} citations={citations} />
            {meta?.retrievalMs != null ? (
              <p className="text-muted-foreground mt-5 font-mono text-xs">
                Retrieved in {Math.round(meta.retrievalMs)} ms
                {meta.model ? ` / ${meta.model}` : ''}
              </p>
            ) : null}
            {meta?.retrievalTrace ? (
              <details className="group mt-4">
                <summary className="text-muted-foreground hover:text-primary cursor-pointer list-none font-mono text-[11px] tracking-[0.16em] uppercase [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                    Show Retrieval Pipeline
                  </span>
                </summary>
                <RetrievalTracePanel trace={meta.retrievalTrace} />
              </details>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}
