import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type LegalDocSlug = 'terms' | 'privacy' | 'refunds' | 'contact';

export interface LegalDocument {
  slug: LegalDocSlug;
  title: string;
  version: string;
  lastUpdated: string;
  rawMarkdown: string;
  sections: Array<{
    id: string;
    title: string;
    level: number;
    content: string;
  }>;
}

const LEGAL_DIR = join(process.cwd(), 'src', 'content', 'legal');

export function getLegalDocument(slug: LegalDocSlug): LegalDocument {
  const filePath = join(LEGAL_DIR, `${slug}.md`);
  const content = readFileSync(filePath, 'utf8');

  let title = slug.toUpperCase();
  let version = '2026.04.1';
  let lastUpdated = '2026-04-15';
  let body = content;

  // Simple frontmatter parsing
  if (content.startsWith('---')) {
    const endFm = content.indexOf('---', 3);
    if (endFm !== -1) {
      const fmText = content.slice(3, endFm);
      body = content.slice(endFm + 3).trim();

      for (const line of fmText.split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const key = line.slice(0, colonIdx).trim();
          const val = line.slice(colonIdx + 1).trim();
          if (key === 'title') title = val;
          if (key === 'version') version = val;
          if (key === 'lastUpdated') lastUpdated = val;
        }
      }
    }
  }

  // Parse sections based on markdown ### headers
  const sections: LegalDocument['sections'] = [];
  const lines = body.split(/\r?\n/);
  let currentSectionTitle = '';
  let currentSectionId = '';
  let currentSectionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (currentSectionTitle) {
        sections.push({
          id: currentSectionId,
          title: currentSectionTitle,
          level: 3,
          content: currentSectionLines.join('\n').trim(),
        });
      }
      currentSectionTitle = line.replace(/^###\s+/, '').trim();
      currentSectionId = currentSectionTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      currentSectionLines = [];
    } else if (line.startsWith('# ')) {
      // Top level header skip or keep
    } else {
      currentSectionLines.push(line);
    }
  }

  if (currentSectionTitle) {
    sections.push({
      id: currentSectionId,
      title: currentSectionTitle,
      level: 3,
      content: currentSectionLines.join('\n').trim(),
    });
  }

  return {
    slug,
    title,
    version,
    lastUpdated,
    rawMarkdown: body,
    sections,
  };
}
