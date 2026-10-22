import React from 'react';
import Link from 'next/link';
import type { LegalDocument, LegalDocSlug } from '@/lib/legal';

interface Props {
  doc: LegalDocument;
}

const NAV_ITEMS: readonly { slug: LegalDocSlug; label: string; href: string }[] = [
  { slug: 'terms', label: 'Terms of Service', href: '/terms' },
  { slug: 'privacy', label: 'Privacy Policy', href: '/privacy' },
  { slug: 'refunds', label: 'Refund Policy', href: '/refunds' },
  { slug: 'contact', label: 'Contact & Support', href: '/contact' },
];

function renderMarkdownInline(text: string): React.ReactNode {
  // Simple inline parser for **bold**, [link](url), and `code`
  const parts: React.ReactNode[] = [];
  let index = 0;
  const regex = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > index) {
      parts.push(text.slice(index, match.index));
    }

    if (match[2]) {
      // Bold
      parts.push(
        <strong key={match.index} className="text-foreground font-semibold">
          {match[2]}
        </strong>,
      );
    } else if (match[3] && match[4]) {
      // Link
      const isExternal = match[4].startsWith('http');
      parts.push(
        <Link
          key={match.index}
          href={match[4]}
          className="text-accent hover:text-accent-hover underline underline-offset-4"
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {match[3]}
        </Link>,
      );
    } else if (match[5]) {
      // Code
      parts.push(
        <code
          key={match.index}
          className="bg-surface-elevated border-border-hairline text-text-secondary px-1.5 py-0.5 font-mono text-[13px]"
        >
          {match[5]}
        </code>,
      );
    }

    index = regex.lastIndex;
  }

  if (index < text.length) {
    parts.push(text.slice(index));
  }

  return parts;
}

function renderContentBlock(content: string): React.ReactNode {
  const blocks = content.split(/\n\n+/);

  return blocks.map((block, bIdx) => {
    const trimmed = block.trim();
    if (!trimmed) return null;

    // Check if table
    if (trimmed.includes('|') && trimmed.includes('\n|')) {
      const rows = trimmed
        .split('\n')
        .map((r) => r.trim())
        .filter((r) => r.startsWith('|') && r.endsWith('|'));
      if (rows.length >= 2) {
        const headerRow = rows[0]!
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        const dataRows = rows.slice(2); // Skip separator row

        return (
          <div key={bIdx} className="border-border-hairline my-6 overflow-x-auto border">
            <table className="text-text-secondary w-full text-left text-sm">
              <thead className="border-border-hairline bg-surface-elevated text-text-primary border-b font-mono text-xs tracking-wider uppercase">
                <tr>
                  {headerRow.map((cell, cIdx) => (
                    <th key={cIdx} className="px-4 py-3 font-medium">
                      {renderMarkdownInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-border-hairline divide-y">
                {dataRows.map((rowStr, rIdx) => {
                  const cells = rowStr
                    .slice(1, -1)
                    .split('|')
                    .map((c) => c.trim());
                  return (
                    <tr key={rIdx} className="hover:bg-surface-elevated/50">
                      {cells.map((cell, cIdx) => (
                        <td key={cIdx} className="px-4 py-3 align-top leading-relaxed">
                          {renderMarkdownInline(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
    }

    // Check if bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items = trimmed
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- ') || l.startsWith('* '));
      return (
        <ul key={bIdx} className="text-text-secondary my-4 space-y-2 pl-4">
          {items.map((item, iIdx) => (
            <li key={iIdx} className="flex items-start gap-2 text-sm leading-relaxed">
              <span className="text-accent font-mono select-none">›</span>
              <span>{renderMarkdownInline(item.replace(/^[-*]\s+/, ''))}</span>
            </li>
          ))}
        </ul>
      );
    }

    // Check if placeholder warning banner
    if (trimmed.includes('LEGAL_PLACEHOLDER:')) {
      return (
        <div
          key={bIdx}
          className="border-accent bg-accent-soft text-text-secondary my-4 border-l-2 p-4 font-mono text-xs"
        >
          <span className="text-accent font-semibold">[REVIEW PENDING] </span>
          {trimmed.replace('LEGAL_PLACEHOLDER:', '').trim()}
        </div>
      );
    }

    // Standard paragraph
    return (
      <p key={bIdx} className="text-text-secondary my-3 text-sm leading-relaxed">
        {renderMarkdownInline(trimmed)}
      </p>
    );
  });
}

export function LegalDocumentView({ doc }: Props) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Top Breadcrumb & Navigation Header */}
      <div className="border-border-hairline bg-surface border-b">
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              <span>←</span>
              <span>Back to RECSY</span>
            </Link>
            <div className="flex items-center gap-2">
              <span className="border-border-hairline bg-surface-elevated text-text-secondary border px-2 py-0.5 font-mono text-[11px] tracking-wider uppercase">
                v{doc.version}
              </span>
              <span className="border-border-hairline bg-surface-elevated text-text-secondary border px-2 py-0.5 font-mono text-[11px] tracking-wider uppercase">
                Updated: {doc.lastUpdated}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
        {/* Title Header */}
        <div className="border-border-hairline bg-surface mb-8 border p-6 md:p-8">
          <div className="text-accent mb-2 font-mono text-xs font-semibold tracking-widest uppercase">
            Legal & Compliance
          </div>
          <h1 className="text-foreground text-3xl font-extrabold tracking-tight md:text-4xl">
            {doc.title}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
            Technical policy disclosures, terms, and compliance guarantees for the RECSY platform.
          </p>

          {/* Navigation Tabs */}
          <div className="border-border-hairline mt-6 flex flex-wrap gap-2 border-t pt-4">
            {NAV_ITEMS.map((item) => {
              const isActive = item.slug === doc.slug;
              return (
                <Link
                  key={item.slug}
                  href={item.href}
                  className={`border px-3.5 py-1.5 font-mono text-xs tracking-wide uppercase transition-colors ${
                    isActive
                      ? 'border-accent bg-accent/10 text-accent font-bold'
                      : 'border-border-hairline text-muted-foreground hover:border-foreground hover:text-foreground'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Content Layout: Sidebar + Sections */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          {/* Table of Contents Rail */}
          {doc.sections.length > 0 && (
            <aside className="lg:col-span-1">
              <div className="border-border-hairline bg-surface sticky top-20 border p-4">
                <div className="text-muted-foreground mb-3 font-mono text-[11px] font-bold tracking-wider uppercase">
                  Sections
                </div>
                <nav className="space-y-1.5">
                  {doc.sections.map((section) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="text-muted-foreground hover:text-accent block truncate font-mono text-xs leading-normal transition-colors"
                    >
                      {section.title}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>
          )}

          {/* Document Content */}
          <div className={`${doc.sections.length > 0 ? 'lg:col-span-3' : 'lg:col-span-4'}`}>
            <div className="border-border-hairline bg-surface border p-6 md:p-10">
              {doc.sections.length > 0 ? (
                <div className="divide-border-hairline divide-y">
                  {doc.sections.map((section, idx) => (
                    <section
                      key={section.id}
                      id={section.id}
                      className={idx === 0 ? 'pb-8' : 'scroll-mt-24 py-8'}
                    >
                      <h2 className="text-foreground text-lg font-bold tracking-tight md:text-xl">
                        {section.title}
                      </h2>
                      <div className="mt-4">{renderContentBlock(section.content)}</div>
                    </section>
                  ))}
                </div>
              ) : (
                <div>{renderContentBlock(doc.rawMarkdown)}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
