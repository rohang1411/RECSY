import type { ResolvedCitation } from '@/services/chat/citations';

interface CitationChipProps {
  readonly citation: ResolvedCitation | undefined;
  readonly label: string;
}

export function CitationChip({ citation, label }: CitationChipProps) {
  if (!citation) {
    return (
      <span className="text-muted-foreground bg-muted/60 mx-0.5 inline-flex items-center rounded px-1.5 py-0.5 align-baseline text-xs">
        {label}
      </span>
    );
  }

  return (
    <a
      href={citation.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-primary/15 text-primary hover:bg-primary/25 mx-0.5 inline-flex items-center rounded px-1.5 py-0.5 align-baseline text-xs font-medium underline-offset-2 hover:underline"
      title={citation.title}
    >
      {label}
    </a>
  );
}
