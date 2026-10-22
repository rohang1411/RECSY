import type { Metadata } from 'next';
import { getLegalDocument } from '@/lib/legal';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of Service and legal agreements for RECSY.',
};

export default function TermsPage() {
  const doc = getLegalDocument('terms');
  return <LegalDocumentView doc={doc} />;
}
