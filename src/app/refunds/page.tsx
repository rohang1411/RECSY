import type { Metadata } from 'next';
import { getLegalDocument } from '@/lib/legal';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description: 'Refund and cancellation policy for RECSY query packs and Pro subscriptions.',
};

export default function RefundsPage() {
  const doc = getLegalDocument('refunds');
  return <LegalDocumentView doc={doc} />;
}
