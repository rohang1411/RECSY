import React from 'react';
import type { Metadata } from 'next';
import { AuthForm, type AuthReason } from '@/components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to RECSY to keep your daily queries and save history.',
  robots: {
    index: false,
    follow: false,
  },
};

interface LoginPageProps {
  searchParams: Promise<{
    reason?: string;
    next?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const reason = (params.reason as AuthReason) || 'header';
  const next = params.next || '/';

  return (
    <div className="flex min-h-[calc(100vh-140px)] items-center justify-center px-4 py-12">
      <div className="border-border-hairline bg-surface w-full max-w-md border p-6 md:p-8">
        <AuthForm reason={reason} next={next} />
      </div>
    </div>
  );
}
