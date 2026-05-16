import type { ResolvedCitation } from '@/services/chat/citations';

interface CitationChipProps {
  readonly citation: ResolvedCitation | undefined;
  readonly label: string;
}

export function CitationChip({ citation, label }: CitationChipProps) {
  if (!citation) {
    return (
      <span className="border-outline-variant bg-muted text-muted-foreground mx-0.5 inline-flex items-center border px-1.5 py-0.5 align-baseline font-mono text-xs">
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
