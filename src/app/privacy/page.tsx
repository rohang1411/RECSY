import type { Metadata } from 'next';
import { getLegalDocument } from '@/lib/legal';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy, data retention rules, and sub-processors for RECSY.',
};

export default function PrivacyPage() {
  const doc = getLegalDocument('privacy');
  return <LegalDocumentView doc={doc} />;
}
