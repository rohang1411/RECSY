import { redirect } from 'next/navigation';

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default async function PipelineRedirectPage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (params.phone) {
    const phoneSlug = Array.isArray(params.phone) ? params.phone[0] : params.phone;
    redirect(`/internal/lifecycle?phone=${encodeURIComponent(phoneSlug ?? '')}`);
  }
  redirect('/internal/command-center');
}
