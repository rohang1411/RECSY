import type { ResolvedCitation } from '@/services/chat/citations';

interface CitationChipProps {
  readonly citation: ResolvedCitation | undefined;
  readonly label: string;
}

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function CitationChip({ citation, label }: CitationChipProps) {
  if (!citation || !isSafeUrl(citation.sourceUrl)) {
    return (
      <span
        className="border-outline-variant bg-muted text-muted-foreground mx-0.5 inline-flex items-center border px-1.5 py-0.5 align-baseline font-mono text-xs"
        title={citation?.title}
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={citation.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="border-outline-variant bg-primary/10 text-primary hover:bg-primary hover:text-background mx-0.5 inline-flex items-center border px-1.5 py-0.5 align-baseline font-mono text-xs underline-offset-2 transition-colors hover:underline"
      title={citation.title}
    >
      {label}
    </a>
  );
}
