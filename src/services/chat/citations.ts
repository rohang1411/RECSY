/**
 * Citation extraction and validation helpers for the chat pipeline.
 *
 * LLM answers include inline citation tags of the form `[c:<uuid>]`.
 * This module:
 * - Extracts all cited chunk IDs from a generated answer string.
 * - Resolves cited IDs against the retrieved chunk set, attaching URL,
 *   title, type, and optional YouTube timestamp to each citation.
 * - Validates that every in-text tag references a retrieved chunk and
 *   strips orphaned tags (hallucinated source references) from the
 *   final answer before it is streamed to the client.
 *
 * Used by: `src/services/chat/answer.ts`.
 */
import type { RetrievedChunk } from '@/services/retrieval/types';

/** Inline citation tag pattern: `[c:<uuid>]` (ASCII case-insensitive `c`). */
const CITATION_TAG_RE =
  /\[c:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/gi;

export interface ResolvedCitation {
  readonly chunkId: string;
  readonly sourceUrl: string;
  readonly title: string;
  readonly type: RetrievedChunk['source']['type'];
  readonly anchor: string | null;
  readonly startTs: number | null;
}

export function extractCitationIds(answer: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(CITATION_TAG_RE.source, CITATION_TAG_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    ids.push(m[1]!.toLowerCase());
  }
  return ids;
}

export function validateCitationTags(
  answer: string,
  allowedChunkIds: ReadonlySet<string>,
): { readonly ok: true } | { readonly ok: false; readonly invalid: string[] } {
  const ids = extractCitationIds(answer);
  const invalid = [...new Set(ids)].filter((id) => !allowedChunkIds.has(id));
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true };
}

function buildCitationUrl(chunk: RetrievedChunk): string {
  try {
    const u = new URL(chunk.source.url);
    if (chunk.source.type === 'youtube' && chunk.startTs != null && !Number.isNaN(chunk.startTs)) {
      u.searchParams.set('t', String(Math.max(0, Math.floor(chunk.startTs))));
    }
    if (chunk.anchor) {
      u.hash = chunk.anchor.startsWith('#') ? chunk.anchor.slice(1) : chunk.anchor;
    }
    return u.toString();
  } catch {
    return chunk.source.url;
  }
}

/**
 * Unique citations in first-appearance order matching `[c:chunkId]` walks
 * of the answer string.
 */
export function resolveCitations(
  answer: string,
  chunks: readonly RetrievedChunk[],
): ResolvedCitation[] {
  const byId = new Map(chunks.map((c) => [c.chunkId.toLowerCase(), c]));
  const seen = new Set<string>();
  const out: ResolvedCitation[] = [];

  const re = new RegExp(CITATION_TAG_RE.source, CITATION_TAG_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const id = m[1]!.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const ch = byId.get(id);
    if (!ch) continue;
    out.push({
      chunkId: id,
      sourceUrl: buildCitationUrl(ch),
      title: ch.source.title,
      type: ch.source.type,
      anchor: ch.anchor ?? null,
      startTs: ch.startTs ?? null,
    });
  }
  return out;
}
