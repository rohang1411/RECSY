import type { Metadata } from 'next';
import { getLegalDocument } from '@/lib/legal';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';

export const metadata: Metadata = {
  title: 'Contact & Support',
  description: 'Contact information, support channels, and legal representation for RECSY.',
};

export default function ContactPage() {
  const doc = getLegalDocument('contact');
  return <LegalDocumentView doc={doc} />;
}
